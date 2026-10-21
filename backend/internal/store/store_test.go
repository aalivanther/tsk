// Archivo: store_test.go — Piezas compartidas por todas las pruebas del almacén, y pruebas del
// arranque de la base de datos (migraciones).
//
// En español: aquí viven los ayudantes que abren una base de datos limpia y desechable para cada
// prueba, además de un reloj falso con el que se puede "adelantar el tiempo" a voluntad. Sin ese
// reloj no habría forma razonable de comprobar que una sesión caduca a los 30 días.
package store

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// testTokenHashKey es la clave con la que las pruebas calculan las huellas de los tokens.
// En español: no es un secreto real; solo tiene que existir y ser la misma durante toda la prueba.
const testTokenHashKey = "clave-de-pruebas-para-huellas-de-tokens-0123456789"

// oneDay es un día completo, para adelantar el reloj falso de forma legible en las pruebas.
const oneDay = 24 * time.Hour

// testClock es un reloj que las pruebas mueven a mano.
//
// En español: es la pieza que permite comprobar caducidades sin esperar de verdad. Se pone en una
// fecha concreta y luego se "adelanta" tantos días u horas como haga falta. Lleva un candado porque
// la prueba de la carrera de invitaciones lo consulta desde varias tareas a la vez.
type testClock struct {
	mutex   sync.Mutex
	current time.Time
}

// newTestClock crea el reloj falso en una fecha fija y conocida.
func newTestClock() *testClock {
	return &testClock{current: time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)}
}

// Now devuelve la hora actual del reloj falso.
func (c *testClock) Now() time.Time {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	return c.current
}

// Advance adelanta el reloj falso el tiempo indicado.
func (c *testClock) Advance(duration time.Duration) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	c.current = c.current.Add(duration)
}

// newTestStore abre una base de datos nueva y desechable para una prueba, con el reloj falso.
//
// En español: cada prueba trabaja sobre su propio archivo, dentro de un directorio temporal que Go
// borra al terminar. Así ninguna prueba puede ensuciar a otra ni depender del orden en que corran.
func newTestStore(t *testing.T) (*Store, *testClock) {
	t.Helper()

	clock := newTestClock()
	databasePath := filepath.Join(t.TempDir(), "tsk.db")

	persistentStore, err := Open(Options{
		Path:         databasePath,
		TokenHashKey: testTokenHashKey,
		Now:          clock.Now,
		Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("Open devolvió error: %v", err)
	}
	t.Cleanup(func() {
		if err := persistentStore.Close(); err != nil {
			t.Errorf("Close devolvió error: %v", err)
		}
	})

	return persistentStore, clock
}

// createTestUser da de alta una cuenta de prueba y devuelve sus datos.
func createTestUser(t *testing.T, persistentStore *Store, email string) User {
	t.Helper()

	user, err := persistentStore.CreateUser(context.Background(), NewUser{
		ID:           "id-" + email,
		Email:        email,
		DisplayName:  "Persona de prueba",
		PasswordHash: "hash-bcrypt-simulado",
	})
	if err != nil {
		t.Fatalf("CreateUser devolvió error para %q: %v", email, err)
	}
	return user
}

// TestOpenRejectsIncompleteOptions comprueba que abrir el almacén sin lo imprescindible falla claro.
// En español: sin ruta no hay dónde guardar, y sin clave las huellas de los tokens no serían
// secretas. Es mejor negarse a arrancar que arrancar mal.
func TestOpenRejectsIncompleteOptions(t *testing.T) {
	cases := []struct {
		name    string
		options Options
	}{
		{
			name:    "sin ruta de base de datos",
			options: Options{TokenHashKey: testTokenHashKey},
		},
		{
			name:    "sin clave para las huellas de tokens",
			options: Options{Path: filepath.Join(t.TempDir(), "tsk.db")},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := Open(testCase.options); err == nil {
				t.Fatal("se esperaba un error de configuración y no hubo ninguno")
			}
		})
	}
}

// TestMigrationsAreIdempotent comprueba que aplicar las migraciones varias veces no cambia nada.
//
// En español: es la garantía de que reiniciar el servidor es seguro. La base se abre, se cierra y se
// vuelve a abrir tres veces sobre el MISMO archivo; al final debe haber exactamente las mismas
// migraciones registradas que la primera vez, y los datos creados en medio deben seguir ahí.
func TestMigrationsAreIdempotent(t *testing.T) {
	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "tsk.db")
	clock := newTestClock()

	openOnce := func() *Store {
		t.Helper()
		persistentStore, err := Open(Options{
			Path:         databasePath,
			TokenHashKey: testTokenHashKey,
			Now:          clock.Now,
			Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		})
		if err != nil {
			t.Fatalf("Open devolvió error: %v", err)
		}
		return persistentStore
	}

	// Primera apertura: crea el esquema y da de alta una cuenta.
	first := openOnce()
	createTestUser(t, first, "primera@example.com")
	migrationsAfterFirstOpen := countMigrations(t, first)
	if migrationsAfterFirstOpen == 0 {
		t.Fatal("la primera apertura no registró ninguna migración")
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close devolvió error: %v", err)
	}

	// Aperturas siguientes: no deben volver a aplicar nada ni tocar los datos.
	for attempt := 2; attempt <= 3; attempt++ {
		reopened := openOnce()

		if got := countMigrations(t, reopened); got != migrationsAfterFirstOpen {
			t.Fatalf("apertura %d: hay %d migraciones registradas y debería haber %d", attempt, got, migrationsAfterFirstOpen)
		}
		if _, err := reopened.FindUserByEmail(ctx, "primera@example.com"); err != nil {
			t.Fatalf("apertura %d: la cuenta creada antes se perdió: %v", attempt, err)
		}
		if err := reopened.Close(); err != nil {
			t.Fatalf("Close devolvió error: %v", err)
		}
	}
}

// TestForeignKeysAreEnforced comprueba que las relaciones entre tablas se respetan de verdad.
//
// En español: SQLite trae esa comprobación APAGADA por omisión. Si quedara apagada, se podrían
// guardar sesiones o perfiles de cuentas que no existen, y el borrado en cascada no funcionaría.
// Esta prueba confirma que el ajuste está puesto: intentar guardar un perfil de una cuenta
// inexistente tiene que fallar.
func TestForeignKeysAreEnforced(t *testing.T) {
	persistentStore, _ := newTestStore(t)

	if _, err := persistentStore.PutProfile(context.Background(), "cuenta-que-no-existe", `{}`, 0); err == nil {
		t.Fatal("se pudo guardar un perfil de una cuenta inexistente; las claves foráneas no están activas")
	}
}

// countMigrations dice cuántas migraciones hay registradas como aplicadas.
func countMigrations(t *testing.T, persistentStore *Store) int {
	t.Helper()

	var count int
	if err := persistentStore.db.QueryRowContext(
		context.Background(),
		`SELECT COUNT(*) FROM schema_migrations`,
	).Scan(&count); err != nil {
		t.Fatalf("no se pudieron contar las migraciones: %v", err)
	}
	return count
}
