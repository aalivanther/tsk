// Archivo: profiles_test.go — Pruebas del guardado del perfil con revisión optimista.
//
// En español: comprueban que el perfil se guarda y se lee, y sobre todo que dos dispositivos
// editando a la vez no se pisan: el segundo en guardar recibe un rechazo con el documento actual
// del servidor para poder fusionar, en vez de sobrescribir a ciegas el trabajo del primero.
package store

import (
	"context"
	"errors"
	"testing"
)

// TestGetProfileOnAFreshAccountIsEmpty comprueba el estado inicial de un perfil.
// En español: no tener nada guardado no es un error; es "revisión 0, documento vacío", que es
// justo lo que el cliente necesita saber para subir el suyo por primera vez.
func TestGetProfileOnAFreshAccountIsEmpty(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "nueva@example.com")

	profile, err := persistentStore.GetProfile(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetProfile devolvió error: %v", err)
	}
	if profile.Document != "" || profile.Revision != 0 {
		t.Fatalf("un perfil sin guardar debería venir vacío y en revisión 0, vino %+v", profile)
	}
	if !profile.UpdatedAt.IsZero() {
		t.Fatalf("un perfil sin guardar no debería tener fecha de guardado, tiene %v", profile.UpdatedAt)
	}
}

// TestPutProfileStoresAndBumpsRevision comprueba el guardado sucesivo y la cuenta de revisiones.
func TestPutProfileStoresAndBumpsRevision(t *testing.T) {
	persistentStore, clock := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "guarda@example.com")

	cases := []struct {
		name         string
		document     string
		baseRevision int64
		wantRevision int64
	}{
		{
			name:         "primer guardado sobre un perfil vacío",
			document:     `{"watchlist":["movie-1"]}`,
			baseRevision: 0,
			wantRevision: 1,
		},
		{
			name:         "segundo guardado sobre la revisión anterior",
			document:     `{"watchlist":["movie-1","movie-2"]}`,
			baseRevision: 1,
			wantRevision: 2,
		},
		{
			name:         "tercer guardado encadenado",
			document:     `{"watchlist":["movie-1","movie-2"],"watched":["series-9"]}`,
			baseRevision: 2,
			wantRevision: 3,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			clock.Advance(oneDay)

			saved, err := persistentStore.PutProfile(ctx, user.ID, testCase.document, testCase.baseRevision)
			if err != nil {
				t.Fatalf("PutProfile devolvió error: %v", err)
			}
			if saved.Revision != testCase.wantRevision {
				t.Fatalf("la revisión debería ser %d y es %d", testCase.wantRevision, saved.Revision)
			}
			if !saved.UpdatedAt.Equal(clock.Now()) {
				t.Fatalf("la fecha de guardado debería ser %v y es %v", clock.Now(), saved.UpdatedAt)
			}

			// Y lo guardado es lo que se lee después.
			read, err := persistentStore.GetProfile(ctx, user.ID)
			if err != nil {
				t.Fatalf("GetProfile devolvió error: %v", err)
			}
			if read.Document != testCase.document {
				t.Fatalf("el documento leído no coincide con el guardado:\n leído:   %s\n guardado: %s",
					read.Document, testCase.document)
			}
			if read.Revision != testCase.wantRevision {
				t.Fatalf("la revisión leída debería ser %d y es %d", testCase.wantRevision, read.Revision)
			}
		})
	}
}

// TestPutProfileRejectsStaleRevision es la prueba del CONFLICTO de revisión.
//
// En español: el teléfono y la computadora leen el mismo perfil (revisión 1). El teléfono guarda
// primero y el perfil pasa a revisión 2. Cuando la computadora intenta guardar diciendo "yo partía
// de la 1", el servidor la rechaza y le devuelve lo que él tiene, para que fusione y reintente. Sin
// esto, la computadora borraría en silencio lo que acababa de hacer el teléfono.
func TestPutProfileRejectsStaleRevision(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "conflicto@example.com")

	// Estado de partida compartido por ambos dispositivos: revisión 1.
	if _, err := persistentStore.PutProfile(ctx, user.ID, `{"watchlist":["movie-1"]}`, 0); err != nil {
		t.Fatalf("PutProfile inicial devolvió error: %v", err)
	}

	// El teléfono guarda primero y se lleva la revisión 2.
	phoneDocument := `{"watchlist":["movie-1","desde-el-telefono"]}`
	if _, err := persistentStore.PutProfile(ctx, user.ID, phoneDocument, 1); err != nil {
		t.Fatalf("el guardado del teléfono devolvió error: %v", err)
	}

	// La computadora llega tarde, todavía creyendo que va por la revisión 1.
	serverProfile, err := persistentStore.PutProfile(ctx, user.ID, `{"watchlist":["desde-la-computadora"]}`, 1)
	if !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("se esperaba ErrRevisionConflict y se obtuvo %v", err)
	}

	// El rechazo viene acompañado del documento del servidor: eso es lo que permite fusionar.
	if serverProfile.Revision != 2 {
		t.Fatalf("el conflicto debería informar de la revisión 2 y informó de la %d", serverProfile.Revision)
	}
	if serverProfile.Document != phoneDocument {
		t.Fatalf("el conflicto debería traer el documento del servidor, trajo %q", serverProfile.Document)
	}

	// Y lo guardado sigue siendo lo del teléfono: el guardado tardío no pisó nada.
	stored, err := persistentStore.GetProfile(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetProfile devolvió error: %v", err)
	}
	if stored.Document != phoneDocument {
		t.Fatalf("el guardado rechazado no debía cambiar nada, quedó %q", stored.Document)
	}
}

// TestPutProfileRejectsWrongBaseRevisionOnAnEmptyProfile comprueba el conflicto en el primer guardado.
// En español: si un cliente dice "partía de la revisión 5" cuando el servidor no tiene nada, algo va
// mal en ese cliente y hay que rechazarlo, no aceptarlo por si acaso.
func TestPutProfileRejectsWrongBaseRevisionOnAnEmptyProfile(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "primera@example.com")

	if _, err := persistentStore.PutProfile(ctx, user.ID, `{"watchlist":[]}`, 5); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("se esperaba ErrRevisionConflict y se obtuvo %v", err)
	}
}

// TestProfilesAreIsolatedBetweenAccounts comprueba que el perfil de cada cuenta es solo suyo.
func TestProfilesAreIsolatedBetweenAccounts(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	first := createTestUser(t, persistentStore, "una@example.com")
	second := createTestUser(t, persistentStore, "otra@example.com")

	if _, err := persistentStore.PutProfile(ctx, first.ID, `{"watchlist":["de-la-primera"]}`, 0); err != nil {
		t.Fatalf("PutProfile devolvió error: %v", err)
	}

	otherProfile, err := persistentStore.GetProfile(ctx, second.ID)
	if err != nil {
		t.Fatalf("GetProfile devolvió error: %v", err)
	}
	if otherProfile.Revision != 0 || otherProfile.Document != "" {
		t.Fatalf("el perfil de la otra cuenta debería estar vacío, es %+v", otherProfile)
	}
}
