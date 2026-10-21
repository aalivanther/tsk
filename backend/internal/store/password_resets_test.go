// Archivo: password_resets_test.go — Pruebas del restablecimiento de contraseña.
//
// En español: el token de restablecimiento es, mientras vive, una llave maestra de la cuenta. Las
// pruebas comprueban que sirve UNA sola vez, que caduca, que cambia de verdad la contraseña y que
// al usarlo se cierran todas las sesiones que hubiera abiertas.
package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

// TestPasswordResetChangesThePasswordAndRevokesSessions comprueba el camino feliz completo.
func TestPasswordResetChangesThePasswordAndRevokesSessions(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "olvidadiza@example.com")

	// Dos sesiones abiertas: son las que el restablecimiento debe cerrar.
	firstSession, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}
	secondSession, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}

	reset, err := persistentStore.CreatePasswordReset(ctx, user.ID, DefaultPasswordResetTTL)
	if err != nil {
		t.Fatalf("CreatePasswordReset devolvió error: %v", err)
	}

	affectedUserID, revokedSessions, err := persistentStore.ConsumePasswordReset(ctx, reset.Token, "hash-nuevo")
	if err != nil {
		t.Fatalf("ConsumePasswordReset devolvió error: %v", err)
	}
	if affectedUserID != user.ID {
		t.Fatalf("el restablecimiento debería afectar a %q y afectó a %q", user.ID, affectedUserID)
	}
	if revokedSessions != 2 {
		t.Fatalf("se esperaban 2 sesiones cerradas y se cerraron %d", revokedSessions)
	}

	// La contraseña nueva quedó guardada.
	updated, err := persistentStore.FindUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("FindUserByID devolvió error: %v", err)
	}
	if updated.PasswordHash != "hash-nuevo" {
		t.Fatalf("la contraseña no se actualizó: %q", updated.PasswordHash)
	}

	// Y las dos sesiones anteriores ya no valen.
	for name, token := range map[string]string{"primera": firstSession.Token, "segunda": secondSession.Token} {
		if _, err := persistentStore.LookupSession(ctx, token); !errors.Is(err, ErrSessionNotFound) {
			t.Fatalf("la sesión %s debería estar cerrada, se obtuvo %v", name, err)
		}
	}
}

// TestPasswordResetTokenWorksOnlyOnce comprueba el "un solo uso".
//
// En español: si el token siguiera valiendo tras usarse, cualquiera que lo encontrara después en un
// historial de mensajes podría volver a tomar el control de la cuenta.
func TestPasswordResetTokenWorksOnlyOnce(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "unavez@example.com")
	reset, err := persistentStore.CreatePasswordReset(ctx, user.ID, DefaultPasswordResetTTL)
	if err != nil {
		t.Fatalf("CreatePasswordReset devolvió error: %v", err)
	}

	if _, _, err := persistentStore.ConsumePasswordReset(ctx, reset.Token, "hash-nuevo"); err != nil {
		t.Fatalf("el primer canje debería funcionar: %v", err)
	}

	_, _, err = persistentStore.ConsumePasswordReset(ctx, reset.Token, "hash-de-un-atacante")
	if !errors.Is(err, ErrResetTokenNotUsable) {
		t.Fatalf("se esperaba ErrResetTokenNotUsable en el segundo canje y se obtuvo %v", err)
	}

	// Y la contraseña sigue siendo la del primer canje, no la del segundo intento.
	updated, err := persistentStore.FindUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("FindUserByID devolvió error: %v", err)
	}
	if updated.PasswordHash != "hash-nuevo" {
		t.Fatalf("el segundo intento no debía cambiar nada, la contraseña es %q", updated.PasswordHash)
	}
}

// TestPasswordResetRejectionCases recorre las formas en que un token de restablecimiento no vale.
func TestPasswordResetRejectionCases(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name string
		// prepare deja el almacén en el estado necesario y devuelve el token que se va a canjear.
		prepare func(t *testing.T, persistentStore *Store, clock *testClock) string
	}{
		{
			name:    "token vacío",
			prepare: func(_ *testing.T, _ *Store, _ *testClock) string { return "" },
		},
		{
			name:    "token inventado",
			prepare: func(_ *testing.T, _ *Store, _ *testClock) string { return "token-que-nadie-emitio" },
		},
		{
			name: "token caducado",
			prepare: func(t *testing.T, persistentStore *Store, clock *testClock) string {
				t.Helper()
				user := createTestUser(t, persistentStore, "caducado@example.com")
				reset, err := persistentStore.CreatePasswordReset(ctx, user.ID, time.Hour)
				if err != nil {
					t.Fatalf("CreatePasswordReset devolvió error: %v", err)
				}
				clock.Advance(2 * time.Hour)
				return reset.Token
			},
		},
		{
			name: "token invalidado al pedir otro restablecimiento",
			prepare: func(t *testing.T, persistentStore *Store, _ *testClock) string {
				t.Helper()
				user := createTestUser(t, persistentStore, "dosveces@example.com")
				first, err := persistentStore.CreatePasswordReset(ctx, user.ID, DefaultPasswordResetTTL)
				if err != nil {
					t.Fatalf("CreatePasswordReset devolvió error: %v", err)
				}
				// Pedir otro deja el primero sin efecto: no pueden convivir dos llaves maestras.
				if _, err := persistentStore.CreatePasswordReset(ctx, user.ID, DefaultPasswordResetTTL); err != nil {
					t.Fatalf("CreatePasswordReset devolvió error: %v", err)
				}
				return first.Token
			},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			persistentStore, clock := newTestStore(t)
			token := testCase.prepare(t, persistentStore, clock)

			_, _, err := persistentStore.ConsumePasswordReset(ctx, token, "hash-nuevo")
			if !errors.Is(err, ErrResetTokenNotUsable) {
				t.Fatalf("se esperaba ErrResetTokenNotUsable y se obtuvo %v", err)
			}
		})
	}
}

// TestPasswordResetTokenIsNotStoredInClear comprueba que en la base solo queda su huella.
func TestPasswordResetTokenIsNotStoredInClear(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "huella-reset@example.com")
	reset, err := persistentStore.CreatePasswordReset(ctx, user.ID, DefaultPasswordResetTTL)
	if err != nil {
		t.Fatalf("CreatePasswordReset devolvió error: %v", err)
	}

	var rowsWithTheTokenInClear int
	if err := persistentStore.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM password_resets WHERE token_hash = ?`,
		reset.Token,
	).Scan(&rowsWithTheTokenInClear); err != nil {
		t.Fatalf("no se pudo consultar la tabla de restablecimientos: %v", err)
	}
	if rowsWithTheTokenInClear != 0 {
		t.Fatal("el token de restablecimiento está guardado en claro en la base de datos")
	}
}

// TestUpdatePasswordAndRevokeSessionsGoTogether comprueba que cambiar la contraseña cierra sesiones.
//
// En español: las dos cosas están unidas en la misma operación precisamente para que nadie pueda
// hacer una sin la otra. Si se pudieran separar, cambiar la contraseña dejaría dentro a quien
// hubiera entrado con la vieja, que es de quien uno se quiere deshacer al cambiarla.
func TestUpdatePasswordAndRevokeSessionsGoTogether(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "cambia@example.com")
	issued, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}

	revoked, err := persistentStore.UpdatePasswordAndRevokeSessions(ctx, user.ID, "hash-nuevo")
	if err != nil {
		t.Fatalf("UpdatePasswordAndRevokeSessions devolvió error: %v", err)
	}
	if revoked != 1 {
		t.Fatalf("se esperaba 1 sesión cerrada y se cerraron %d", revoked)
	}
	if _, err := persistentStore.LookupSession(ctx, issued.Token); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("la sesión debería estar cerrada tras el cambio, se obtuvo %v", err)
	}

	updated, err := persistentStore.FindUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("FindUserByID devolvió error: %v", err)
	}
	if updated.PasswordHash != "hash-nuevo" {
		t.Fatalf("la contraseña no se actualizó: %q", updated.PasswordHash)
	}
}

// TestUpdatePasswordReportsMissingAccount comprueba el error al cambiar la contraseña de una cuenta
// que no existe.
func TestUpdatePasswordReportsMissingAccount(t *testing.T) {
	persistentStore, _ := newTestStore(t)

	_, err := persistentStore.UpdatePasswordAndRevokeSessions(context.Background(), "id-inventado", "hash")
	if !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("se esperaba ErrUserNotFound y se obtuvo %v", err)
	}
}
