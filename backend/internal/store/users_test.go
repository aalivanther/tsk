// Archivo: users_test.go — Pruebas de las cuentas: alta, búsqueda, unicidad del correo, borrado en
// cascada e inhabilitación.
package store

import (
	"context"
	"errors"
	"testing"
)

// TestCreateAndFindUser comprueba el alta y las dos formas de buscar una cuenta.
//
// En español: además, verifica que el correo se guarda y se busca NORMALIZADO. Si no fuera así,
// "Ana@Example.com" y "ana@example.com " parecerían cuentas distintas y la misma persona podría
// registrarse dos veces sin darse cuenta.
func TestCreateAndFindUser(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	created, err := persistentStore.CreateUser(ctx, NewUser{
		ID:           "id-1",
		Email:        "  ADRIAN@Example.com ",
		DisplayName:  "Adrián",
		PasswordHash: "hash-bcrypt-simulado",
	})
	if err != nil {
		t.Fatalf("CreateUser devolvió error: %v", err)
	}
	if created.Email != "adrian@example.com" {
		t.Fatalf("el correo debería guardarse normalizado, se guardó %q", created.Email)
	}

	cases := []struct {
		name   string
		lookup func() (User, error)
	}{
		{
			name:   "por correo escrito exactamente igual",
			lookup: func() (User, error) { return persistentStore.FindUserByEmail(ctx, "adrian@example.com") },
		},
		{
			name:   "por correo con mayúsculas y espacios",
			lookup: func() (User, error) { return persistentStore.FindUserByEmail(ctx, "  Adrian@EXAMPLE.com ") },
		},
		{
			name:   "por identificador",
			lookup: func() (User, error) { return persistentStore.FindUserByID(ctx, "id-1") },
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			found, err := testCase.lookup()
			if err != nil {
				t.Fatalf("la búsqueda devolvió error: %v", err)
			}
			if found.ID != "id-1" {
				t.Fatalf("se esperaba la cuenta id-1 y se obtuvo %q", found.ID)
			}
			if found.DisplayName != "Adrián" {
				t.Fatalf("el nombre visible se guardó mal: %q", found.DisplayName)
			}
			if !found.CreatedAt.Equal(created.CreatedAt) {
				t.Fatalf("la fecha de alta cambió al leerla: %v vs %v", found.CreatedAt, created.CreatedAt)
			}
		})
	}
}

// TestFindUserReturnsNotFoundForUnknownAccounts comprueba el error de "no existe".
func TestFindUserReturnsNotFoundForUnknownAccounts(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	cases := []struct {
		name   string
		lookup func() (User, error)
	}{
		{
			name:   "correo sin cuenta",
			lookup: func() (User, error) { return persistentStore.FindUserByEmail(ctx, "nadie@example.com") },
		},
		{
			name:   "identificador inexistente",
			lookup: func() (User, error) { return persistentStore.FindUserByID(ctx, "id-inventado") },
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := testCase.lookup(); !errors.Is(err, ErrUserNotFound) {
				t.Fatalf("se esperaba ErrUserNotFound y se obtuvo %v", err)
			}
		})
	}
}

// TestEmailUniquenessIsEnforced comprueba que no se pueden crear dos cuentas con el mismo correo.
//
// En español: la unicidad la impone la BASE DE DATOS, no una comprobación previa del código. Es la
// diferencia importante: una comprobación previa deja un hueco entre "miro si existe" y "lo creo"
// por el que dos registros simultáneos se colarían los dos.
func TestEmailUniquenessIsEnforced(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	createTestUser(t, persistentStore, "repetido@example.com")

	cases := []struct {
		name  string
		email string
	}{
		{name: "mismo correo exacto", email: "repetido@example.com"},
		{name: "mismo correo en mayúsculas", email: "REPETIDO@example.com"},
		{name: "mismo correo con espacios", email: "  repetido@example.com  "},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := persistentStore.CreateUser(ctx, NewUser{
				ID:           "otro-id-" + testCase.name,
				Email:        testCase.email,
				DisplayName:  "Otra persona",
				PasswordHash: "otro-hash",
			})
			if !errors.Is(err, ErrEmailTaken) {
				t.Fatalf("se esperaba ErrEmailTaken y se obtuvo %v", err)
			}
		})
	}
}

// TestDeleteUserCascadesProfileAndSessions comprueba que borrar una cuenta se lleva TODO lo suyo.
//
// En español: es el requisito legal de "cancelación" del aviso de privacidad. Después de borrar no
// puede quedar ni el perfil ni ninguna sesión abierta: si quedara una sesión, alguien con ese token
// seguiría entrando a una cuenta que ya no existe.
func TestDeleteUserCascadesProfileAndSessions(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "borrame@example.com")

	// Le damos una sesión abierta y un perfil guardado, que es lo que debe desaparecer con ella.
	issued, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}
	if _, err := persistentStore.PutProfile(ctx, user.ID, `{"watchlist":["movie-1"]}`, 0); err != nil {
		t.Fatalf("PutProfile devolvió error: %v", err)
	}

	if err := persistentStore.DeleteUser(ctx, user.ID); err != nil {
		t.Fatalf("DeleteUser devolvió error: %v", err)
	}

	// La cuenta ya no está.
	if _, err := persistentStore.FindUserByID(ctx, user.ID); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("la cuenta debería haber desaparecido, se obtuvo %v", err)
	}
	// La sesión tampoco: el token que antes valía ya no abre nada.
	if _, err := persistentStore.LookupSession(ctx, issued.Token); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("la sesión debería haberse borrado en cascada, se obtuvo %v", err)
	}
	// Y el perfil se fue con ella.
	profile, err := persistentStore.GetProfile(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetProfile devolvió error: %v", err)
	}
	if profile.Revision != 0 || profile.Document != "" {
		t.Fatalf("el perfil debería haberse borrado en cascada, quedó %+v", profile)
	}
}

// TestDeleteUserReportsMissingAccount comprueba que borrar algo que no existe se avisa.
func TestDeleteUserReportsMissingAccount(t *testing.T) {
	persistentStore, _ := newTestStore(t)

	if err := persistentStore.DeleteUser(context.Background(), "id-inventado"); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("se esperaba ErrUserNotFound y se obtuvo %v", err)
	}
}

// TestDisabledAccountBehavesAsMissing comprueba que la columna de inhabilitación tiene efecto real.
//
// En español: marcar una cuenta como inhabilitada (por ejemplo, para suspender a alguien durante la
// alpha sin borrar su rastro) debe hacer que, a todos los efectos, deje de existir: no se encuentra
// ni por correo ni por identificador, así que no puede iniciar sesión.
func TestDisabledAccountBehavesAsMissing(t *testing.T) {
	persistentStore, clock := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "suspendida@example.com")

	if _, err := persistentStore.db.ExecContext(
		ctx,
		`UPDATE users SET deleted_at = ? WHERE id = ?`,
		clock.Now().Unix(),
		user.ID,
	); err != nil {
		t.Fatalf("no se pudo inhabilitar la cuenta: %v", err)
	}

	if _, err := persistentStore.FindUserByEmail(ctx, "suspendida@example.com"); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("una cuenta inhabilitada no debe encontrarse por correo, se obtuvo %v", err)
	}
	if _, err := persistentStore.FindUserByID(ctx, user.ID); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("una cuenta inhabilitada no debe encontrarse por identificador, se obtuvo %v", err)
	}
}

// TestListUsersSummarizesAccounts comprueba el resumen que consulta la herramienta de administración.
func TestListUsersSummarizesAccounts(t *testing.T) {
	persistentStore, clock := newTestStore(t)
	ctx := context.Background()

	older := createTestUser(t, persistentStore, "antigua@example.com")
	// Adelantamos el reloj para que la segunda cuenta sea claramente más nueva.
	clock.Advance(oneDay)
	newer := createTestUser(t, persistentStore, "nueva@example.com")

	if _, err := persistentStore.CreateSession(ctx, newer.ID); err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}
	if _, err := persistentStore.PutProfile(ctx, newer.ID, `{"watchlist":[]}`, 0); err != nil {
		t.Fatalf("PutProfile devolvió error: %v", err)
	}

	summaries, err := persistentStore.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers devolvió error: %v", err)
	}
	if len(summaries) != 2 {
		t.Fatalf("se esperaban 2 cuentas y se obtuvieron %d", len(summaries))
	}

	byID := make(map[string]UserSummary, len(summaries))
	for _, summary := range summaries {
		byID[summary.User.ID] = summary
	}

	if got := byID[newer.ID]; got.OpenSessions != 1 || !got.HasProfile {
		t.Fatalf("la cuenta nueva debería tener 1 sesión y perfil, se obtuvo %+v", got)
	}
	if got := byID[older.ID]; got.OpenSessions != 0 || got.HasProfile {
		t.Fatalf("la cuenta antigua no debería tener sesiones ni perfil, se obtuvo %+v", got)
	}
}
