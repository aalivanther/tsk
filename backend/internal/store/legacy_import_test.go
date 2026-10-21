// Archivo: legacy_import_test.go — Pruebas de la importación del antiguo archivo users.json.
//
// En español: esta migración solo ocurre una vez en la vida de cada instalación, pero si sale mal se
// pierden todas las cuentas existentes. Por eso se prueba con detalle: qué pasa cuando el archivo no
// está, cuando está y la base está vacía, cuando la base ya tiene cuentas y cuando el archivo está
// roto.
package store

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// legacyUsersJSON es el contenido de un archivo users.json de la versión anterior, con dos cuentas.
const legacyUsersJSON = `{
  "users": [
    {
      "id": "user-antiguo-1",
      "email": "Antigua.Uno@Example.com",
      "displayName": "Antigua Uno",
      "passwordHash": "$2a$10$hashsimuladodelaprimeracuenta",
      "createdAt": "2026-06-01T10:00:00Z"
    },
    {
      "id": "user-antiguo-2",
      "email": "antigua.dos@example.com",
      "displayName": "Antigua Dos",
      "passwordHash": "$2a$10$hashsimuladodelasegundacuenta",
      "createdAt": "2026-06-15T18:30:00Z"
    }
  ]
}`

// writeLegacyFile deja un archivo users.json de prueba en disco y devuelve su ruta.
func writeLegacyFile(t *testing.T, content string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "users.json")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("no se pudo escribir el archivo antiguo de prueba: %v", err)
	}
	return path
}

// TestImportLegacyUsersFileBringsAccountsIn comprueba el camino principal de la migración.
//
// En español: con el archivo presente y la base vacía, las cuentas entran, se pueden buscar por su
// correo (normalizado) y el archivo se renombra para que no se vuelva a importar nunca.
func TestImportLegacyUsersFileBringsAccountsIn(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	legacyPath := writeLegacyFile(t, legacyUsersJSON)

	imported, err := persistentStore.ImportLegacyUsersFile(ctx, legacyPath)
	if err != nil {
		t.Fatalf("ImportLegacyUsersFile devolvió error: %v", err)
	}
	if imported != 2 {
		t.Fatalf("se esperaban 2 cuentas importadas y se importaron %d", imported)
	}

	cases := []struct {
		name        string
		email       string
		wantID      string
		wantName    string
		wantCreated string
	}{
		{
			name:        "cuenta con el correo en mayúsculas queda normalizado",
			email:       "antigua.uno@example.com",
			wantID:      "user-antiguo-1",
			wantName:    "Antigua Uno",
			wantCreated: "2026-06-01T10:00:00Z",
		},
		{
			name:        "cuenta con el correo ya en minúsculas",
			email:       "antigua.dos@example.com",
			wantID:      "user-antiguo-2",
			wantName:    "Antigua Dos",
			wantCreated: "2026-06-15T18:30:00Z",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			user, err := persistentStore.FindUserByEmail(ctx, testCase.email)
			if err != nil {
				t.Fatalf("la cuenta importada no se encuentra: %v", err)
			}
			if user.ID != testCase.wantID {
				t.Fatalf("el identificador debería ser %q y es %q", testCase.wantID, user.ID)
			}
			if user.DisplayName != testCase.wantName {
				t.Fatalf("el nombre visible debería ser %q y es %q", testCase.wantName, user.DisplayName)
			}
			// La fecha de alta original se conserva: no se sustituye por la fecha de la migración.
			if got := user.CreatedAt.Format("2006-01-02T15:04:05Z"); got != testCase.wantCreated {
				t.Fatalf("la fecha de alta debería ser %q y es %q", testCase.wantCreated, got)
			}
			// Y la contraseña sigue funcionando porque su huella se copió tal cual.
			if user.PasswordHash == "" {
				t.Fatal("la huella de la contraseña no se importó")
			}
		})
	}

	// El archivo original ya no está donde se busca, sino renombrado como copia de seguridad. Se
	// pregunta con errors.Is y no con os.IsNotExist por costumbre: os.IsNotExist no desenvuelve los
	// errores, así que en cuanto alguien añade contexto con %w deja de funcionar en silencio.
	if _, err := os.Stat(legacyPath); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("el archivo antiguo debería haberse renombrado, sigue en su sitio (%v)", err)
	}
	if _, err := os.Stat(legacyPath + legacyMigratedSuffix); err != nil {
		t.Fatalf("debería existir la copia renombrada del archivo antiguo: %v", err)
	}
}

// TestImportLegacyUsersFileIsSkippedWhenNotNeeded recorre los casos en los que NO se importa nada.
func TestImportLegacyUsersFileIsSkippedWhenNotNeeded(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name string
		// prepare deja el estado necesario y devuelve la ruta que se le pasará a la importación.
		prepare func(t *testing.T, persistentStore *Store) string
	}{
		{
			name: "no hay ninguna ruta configurada",
			prepare: func(_ *testing.T, _ *Store) string {
				return ""
			},
		},
		{
			name: "el archivo antiguo no existe (instalación nueva o ya migrada)",
			prepare: func(t *testing.T, _ *Store) string {
				t.Helper()
				return filepath.Join(t.TempDir(), "users.json")
			},
		},
		{
			name: "la base ya tiene cuentas, así que manda la base",
			prepare: func(t *testing.T, persistentStore *Store) string {
				t.Helper()
				createTestUser(t, persistentStore, "ya-existente@example.com")
				return writeLegacyFile(t, legacyUsersJSON)
			},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			persistentStore, _ := newTestStore(t)
			legacyPath := testCase.prepare(t, persistentStore)

			imported, err := persistentStore.ImportLegacyUsersFile(ctx, legacyPath)
			if err != nil {
				t.Fatalf("ImportLegacyUsersFile devolvió error: %v", err)
			}
			if imported != 0 {
				t.Fatalf("no debía importarse nada y se importaron %d cuentas", imported)
			}
		})
	}
}

// TestImportLegacyUsersFileDoesNotTouchAnExistingDatabase comprueba que, con cuentas ya en la base,
// ni se importa ni se renombra el archivo.
//
// En español: renombrarlo sin haber importado nada sería peor que no hacer nada, porque escondería
// el archivo antiguo dejando sus cuentas fuera para siempre.
func TestImportLegacyUsersFileDoesNotTouchAnExistingDatabase(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	createTestUser(t, persistentStore, "ya-existente@example.com")
	legacyPath := writeLegacyFile(t, legacyUsersJSON)

	if _, err := persistentStore.ImportLegacyUsersFile(ctx, legacyPath); err != nil {
		t.Fatalf("ImportLegacyUsersFile devolvió error: %v", err)
	}

	if _, err := os.Stat(legacyPath); err != nil {
		t.Fatalf("el archivo antiguo debía quedarse donde estaba: %v", err)
	}
	if _, err := persistentStore.FindUserByEmail(ctx, "antigua.uno@example.com"); err == nil {
		t.Fatal("no debía importarse ninguna cuenta del archivo antiguo")
	}
}

// TestImportLegacyUsersFileRejectsBrokenFiles comprueba que un archivo ilegible detiene el arranque.
//
// En español: si el archivo de cuentas está corrupto o incompleto, seguir adelante significaría
// arrancar sin las cuentas de la gente sin que nadie se entere. Es mejor fallar ruidosamente.
func TestImportLegacyUsersFileRejectsBrokenFiles(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name    string
		content string
	}{
		{
			name:    "no es JSON válido",
			content: "{esto no es json",
		},
		{
			name:    "una cuenta sin identificador",
			content: `{"users":[{"id":"","email":"a@example.com","passwordHash":"h"}]}`,
		},
		{
			name:    "una cuenta sin correo",
			content: `{"users":[{"id":"x","email":"","passwordHash":"h"}]}`,
		},
		{
			name:    "una cuenta sin huella de contraseña",
			content: `{"users":[{"id":"x","email":"a@example.com","passwordHash":""}]}`,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			persistentStore, _ := newTestStore(t)
			legacyPath := writeLegacyFile(t, testCase.content)

			if _, err := persistentStore.ImportLegacyUsersFile(ctx, legacyPath); err == nil {
				t.Fatal("se esperaba un error de importación y no hubo ninguno")
			}
			// El archivo roto se queda donde está, para poder mirarlo y arreglarlo.
			if _, err := os.Stat(legacyPath); err != nil {
				t.Fatalf("el archivo roto debía conservarse: %v", err)
			}
		})
	}
}

// TestImportLegacyUsersFileAcceptsAnEmptyFile comprueba el caso del archivo creado pero sin cuentas.
// En español: ocurre si alguien arrancó la versión anterior y nunca se registró. No es un error, y
// el archivo debe quedar igualmente migrado para no volver a mirarlo.
func TestImportLegacyUsersFileAcceptsAnEmptyFile(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	legacyPath := writeLegacyFile(t, `{"users":[]}`)

	imported, err := persistentStore.ImportLegacyUsersFile(ctx, legacyPath)
	if err != nil {
		t.Fatalf("ImportLegacyUsersFile devolvió error: %v", err)
	}
	if imported != 0 {
		t.Fatalf("no había cuentas que importar y se importaron %d", imported)
	}
	if _, err := os.Stat(legacyPath + legacyMigratedSuffix); err != nil {
		t.Fatalf("el archivo vacío también debía quedar renombrado: %v", err)
	}
}
