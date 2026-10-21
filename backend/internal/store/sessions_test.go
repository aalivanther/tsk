// Archivo: sessions_test.go — Pruebas de las sesiones: emisión, verificación, caducidad,
// deslizamiento, revocación individual y revocación masiva.
//
// En español: estas pruebas son el corazón de la seguridad de las cuentas. Comprueban lo que el
// sistema anterior NO podía hacer: cerrar una sesión de verdad.
package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

// TestSessionIsIssuedAndVerified comprueba que una sesión recién abierta se reconoce.
func TestSessionIsIssuedAndVerified(t *testing.T) {
	persistentStore, clock := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "sesion@example.com")

	issued, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}
	if issued.Token == "" {
		t.Fatal("CreateSession no devolvió ningún token")
	}
	if !issued.Session.ExpiresAt.Equal(clock.Now().Add(SessionTTL)) {
		t.Fatalf("la caducidad debería ser dentro de %v, se obtuvo %v", SessionTTL, issued.Session.ExpiresAt)
	}

	session, err := persistentStore.LookupSession(ctx, issued.Token)
	if err != nil {
		t.Fatalf("LookupSession devolvió error: %v", err)
	}
	if session.UserID != user.ID {
		t.Fatalf("la sesión debería ser de %q y es de %q", user.ID, session.UserID)
	}
}

// TestSessionTokenIsNotStoredInClear comprueba que en la base solo queda la HUELLA del token.
//
// En español: es la propiedad que hace que una copia robada de la base de datos no sirva para
// entrar como nadie. Se busca el token literal entre las filas guardadas y no debe aparecer.
func TestSessionTokenIsNotStoredInClear(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "huella@example.com")
	issued, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}

	var storedRows int
	if err := persistentStore.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM sessions WHERE token_hash = ?`,
		issued.Token,
	).Scan(&storedRows); err != nil {
		t.Fatalf("no se pudo consultar la tabla de sesiones: %v", err)
	}
	if storedRows != 0 {
		t.Fatal("el token de sesión está guardado en claro en la base de datos")
	}
}

// TestSessionExpiresAfterItsLifetime comprueba que una sesión sin usar caduca.
func TestSessionExpiresAfterItsLifetime(t *testing.T) {
	persistentStore, clock := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "caduca@example.com")
	issued, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}

	cases := []struct {
		name           string
		advance        time.Duration
		wantRecognized bool
	}{
		{name: "justo antes de caducar sigue valiendo", advance: SessionTTL - time.Minute, wantRecognized: true},
		{name: "pasada la caducidad ya no vale", advance: SessionTTL + time.Minute, wantRecognized: false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			// Cada caso parte del mismo estado: se reabre una sesión nueva y se adelanta el reloj.
			freshStore, freshClock := newTestStore(t)
			freshUser := createTestUser(t, freshStore, "caduca@example.com")
			freshSession, err := freshStore.CreateSession(ctx, freshUser.ID)
			if err != nil {
				t.Fatalf("CreateSession devolvió error: %v", err)
			}

			freshClock.Advance(testCase.advance)

			_, err = freshStore.LookupSession(ctx, freshSession.Token)
			recognized := err == nil
			if recognized != testCase.wantRecognized {
				t.Fatalf("reconocida=%v, se esperaba %v (error: %v)", recognized, testCase.wantRecognized, err)
			}
			if !testCase.wantRecognized && !errors.Is(err, ErrSessionNotFound) {
				t.Fatalf("se esperaba ErrSessionNotFound y se obtuvo %v", err)
			}
		})
	}

	// El token de la sesión de fuera del bucle sigue estando vivo: nada de lo anterior lo tocó.
	clock.Advance(time.Minute)
	if _, err := persistentStore.LookupSession(ctx, issued.Token); err != nil {
		t.Fatalf("la sesión original debería seguir viva: %v", err)
	}
}

// TestSessionSlidesExpiryOnlyAfterADayOfUse comprueba la sesión "deslizante".
//
// En español: usar la aplicación empuja la caducidad hacia adelante, pero NO en cada petición (eso
// sería escribir en disco constantemente para nada). Solo cuando ha pasado más de un día desde el
// último uso. Esta prueba comprueba las dos mitades de esa regla.
func TestSessionSlidesExpiryOnlyAfterADayOfUse(t *testing.T) {
	persistentStore, clock := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "deslizante@example.com")
	issued, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}
	originalExpiry := issued.Session.ExpiresAt

	// Un rato después: se usa la sesión, pero la caducidad NO se mueve (no ha pasado un día).
	clock.Advance(time.Hour)
	session, err := persistentStore.LookupSession(ctx, issued.Token)
	if err != nil {
		t.Fatalf("LookupSession devolvió error: %v", err)
	}
	if !session.ExpiresAt.Equal(originalExpiry) {
		t.Fatalf("la caducidad no debía moverse todavía: %v vs %v", session.ExpiresAt, originalExpiry)
	}

	// Dos días después: ahora sí, la caducidad se empuja treinta días desde este momento.
	clock.Advance(2 * oneDay)
	session, err = persistentStore.LookupSession(ctx, issued.Token)
	if err != nil {
		t.Fatalf("LookupSession devolvió error: %v", err)
	}
	wantExpiry := clock.Now().Add(SessionTTL)
	if !session.ExpiresAt.Equal(wantExpiry) {
		t.Fatalf("la caducidad debería ser %v y es %v", wantExpiry, session.ExpiresAt)
	}

	// Y el empujón quedó GUARDADO: se comprueba consultando otra vez desde cero.
	reread, err := persistentStore.LookupSession(ctx, issued.Token)
	if err != nil {
		t.Fatalf("LookupSession devolvió error: %v", err)
	}
	if !reread.ExpiresAt.Equal(wantExpiry) {
		t.Fatalf("el empujón de caducidad no se guardó: %v", reread.ExpiresAt)
	}
}

// TestSessionDiesAtItsAbsoluteCapEvenWhenUsedEveryDay es la prueba del TOPE ABSOLUTO.
//
// En español: reproduce el agujero que se ha tapado. Antes, la caducidad se empujaba treinta días
// hacia adelante cada vez que alguien usaba la aplicación, así que quien entra a diario nunca la
// alcanzaba: su sesión se renovaba sola para siempre y en la práctica no caducaba jamás — un token
// copiado valía indefinidamente. Aquí se simula justo eso: se usa la sesión cada dos días durante
// más de un año, y aun así tiene que morir al llegar a su tope de 90 días.
func TestSessionDiesAtItsAbsoluteCapEvenWhenUsedEveryDay(t *testing.T) {
	persistentStore, clock := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "eterna@example.com")
	issued, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}

	// La fecha de muerte se fija al nacer y no la mueve nada.
	wantAbsolute := clock.Now().Add(SessionAbsoluteTTL)
	if !issued.Session.AbsoluteExpiresAt.Equal(wantAbsolute) {
		t.Fatalf("el tope absoluto debería ser %v y es %v", wantAbsolute, issued.Session.AbsoluteExpiresAt)
	}

	// Uso constante: cada dos días se entra, lo que empuja la caducidad deslizante una y otra vez.
	// Se para justo antes del tope para comprobar que hasta ahí la sesión aguanta.
	const useEvery = 2 * oneDay
	for elapsed := time.Duration(0); elapsed < SessionAbsoluteTTL-useEvery; elapsed += useEvery {
		clock.Advance(useEvery)
		session, err := persistentStore.LookupSession(ctx, issued.Token)
		if err != nil {
			t.Fatalf("la sesión debería seguir viva a los %v de uso continuado: %v", elapsed+useEvery, err)
		}
		// Y la caducidad guardada nunca puede prometer más allá del tope absoluto.
		if session.ExpiresAt.After(session.AbsoluteExpiresAt) {
			t.Fatalf(
				"la caducidad deslizante (%v) no puede pasar del tope absoluto (%v)",
				session.ExpiresAt, session.AbsoluteExpiresAt,
			)
		}
	}

	// Se cruza el tope: por mucho que se haya usado, la sesión deja de valer.
	clock.Advance(2 * useEvery)
	if _, err := persistentStore.LookupSession(ctx, issued.Token); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("pasada su vida máxima la sesión debe dejar de valer, se obtuvo %v", err)
	}

	// Y deja de contar como abierta para quien administra.
	openSessions, err := persistentStore.CountOpenSessions(ctx, user.ID)
	if err != nil {
		t.Fatalf("CountOpenSessions devolvió error: %v", err)
	}
	if openSessions != 0 {
		t.Fatalf("una sesión pasada de su tope no debe contar como abierta, se contaron %d", openSessions)
	}
}

// TestSessionsPastTheirAbsoluteCapArePurged comprueba que la limpieza también barre las sesiones que
// murieron por el tope absoluto, no solo las que se quedaron sin usar.
func TestSessionsPastTheirAbsoluteCapArePurged(t *testing.T) {
	persistentStore, clock := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "barrida@example.com")
	old, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}

	// Se mantiene viva con uso constante hasta poco antes del tope...
	for elapsed := time.Duration(0); elapsed < SessionAbsoluteTTL-2*oneDay; elapsed += 2 * oneDay {
		clock.Advance(2 * oneDay)
		if _, err := persistentStore.LookupSession(ctx, old.Token); err != nil {
			t.Fatalf("la sesión debería seguir viva: %v", err)
		}
	}
	// ...y después se cruza el tope.
	clock.Advance(4 * oneDay)

	// Una sesión nueva y una consulta cualquiera disparan el barrido perezoso.
	fresh, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}
	if _, err := persistentStore.LookupSession(ctx, fresh.Token); err != nil {
		t.Fatalf("LookupSession devolvió error: %v", err)
	}

	var remainingRows int
	if err := persistentStore.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions`).Scan(&remainingRows); err != nil {
		t.Fatalf("no se pudieron contar las sesiones guardadas: %v", err)
	}
	if remainingRows != 1 {
		t.Fatalf("debería quedar solo la sesión nueva y quedan %d filas", remainingRows)
	}
}

// TestSessionIsRevokedIndividually comprueba que cerrar sesión anula SOLO esa sesión.
//
// En español: si alguien tiene la aplicación abierta en el teléfono y en la computadora, salir en
// una no debe echarlo de la otra. Esta es la diferencia principal con el sistema anterior, donde
// "cerrar sesión" solo tiraba el token en el cliente y el servidor lo seguía aceptando.
func TestSessionIsRevokedIndividually(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "revocar@example.com")

	phone, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession (teléfono) devolvió error: %v", err)
	}
	laptop, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession (computadora) devolvió error: %v", err)
	}

	if err := persistentStore.DeleteSession(ctx, phone.Token); err != nil {
		t.Fatalf("DeleteSession devolvió error: %v", err)
	}

	if _, err := persistentStore.LookupSession(ctx, phone.Token); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("la sesión cerrada debería dejar de valer, se obtuvo %v", err)
	}
	if _, err := persistentStore.LookupSession(ctx, laptop.Token); err != nil {
		t.Fatalf("la otra sesión debería seguir viva: %v", err)
	}
}

// TestDeleteUserSessionsRevokesEveryDevice comprueba el "cerrar sesión en todos mis dispositivos".
func TestDeleteUserSessionsRevokesEveryDevice(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "todas@example.com")
	otherUser := createTestUser(t, persistentStore, "ajena@example.com")

	var tokens []string
	for range 3 {
		issued, err := persistentStore.CreateSession(ctx, user.ID)
		if err != nil {
			t.Fatalf("CreateSession devolvió error: %v", err)
		}
		tokens = append(tokens, issued.Token)
	}
	untouched, err := persistentStore.CreateSession(ctx, otherUser.ID)
	if err != nil {
		t.Fatalf("CreateSession (otra cuenta) devolvió error: %v", err)
	}

	revoked, err := persistentStore.DeleteUserSessions(ctx, user.ID)
	if err != nil {
		t.Fatalf("DeleteUserSessions devolvió error: %v", err)
	}
	if revoked != 3 {
		t.Fatalf("se esperaban 3 sesiones cerradas y se cerraron %d", revoked)
	}

	for index, token := range tokens {
		if _, err := persistentStore.LookupSession(ctx, token); !errors.Is(err, ErrSessionNotFound) {
			t.Fatalf("la sesión %d debería estar cerrada, se obtuvo %v", index, err)
		}
	}
	// Las sesiones de OTRA cuenta no se tocan: revocar es una acción por cuenta, no global.
	if _, err := persistentStore.LookupSession(ctx, untouched.Token); err != nil {
		t.Fatalf("la sesión de otra cuenta no debía tocarse: %v", err)
	}
}

// TestLookupSessionRejectsEmptyAndUnknownTokens comprueba los casos de token que no vale.
func TestLookupSessionRejectsEmptyAndUnknownTokens(t *testing.T) {
	persistentStore, _ := newTestStore(t)
	ctx := context.Background()

	cases := []struct {
		name  string
		token string
	}{
		{name: "token vacío", token: ""},
		{name: "token inventado", token: "esto-no-es-un-token-emitido"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := persistentStore.LookupSession(ctx, testCase.token); !errors.Is(err, ErrSessionNotFound) {
				t.Fatalf("se esperaba ErrSessionNotFound y se obtuvo %v", err)
			}
		})
	}
}

// TestExpiredSessionsArePurgedLazily comprueba la limpieza perezosa de sesiones muertas.
//
// En español: no hay ninguna tarea programada barriendo la base; la limpieza ocurre de paso, cuando
// llega una petición y ha pasado suficiente tiempo desde la última vez. Esta prueba comprueba que
// las filas caducadas acaban desapareciendo de verdad y no se acumulan para siempre.
func TestExpiredSessionsArePurgedLazily(t *testing.T) {
	persistentStore, clock := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "limpieza@example.com")
	if _, err := persistentStore.CreateSession(ctx, user.ID); err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}

	// Pasa mucho más que la vida de una sesión: la fila sigue ahí, pero ya no vale.
	clock.Advance(SessionTTL + oneDay)

	// Una sesión nueva y una consulta cualquiera disparan el barrido.
	fresh, err := persistentStore.CreateSession(ctx, user.ID)
	if err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}
	if _, err := persistentStore.LookupSession(ctx, fresh.Token); err != nil {
		t.Fatalf("LookupSession devolvió error: %v", err)
	}

	var remainingRows int
	if err := persistentStore.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions`).Scan(&remainingRows); err != nil {
		t.Fatalf("no se pudieron contar las sesiones guardadas: %v", err)
	}
	if remainingRows != 1 {
		t.Fatalf("debería quedar solo la sesión viva y quedan %d filas", remainingRows)
	}
}

// TestCountOpenSessionsIgnoresExpiredOnes comprueba que el recuento solo cuenta las sesiones vivas.
func TestCountOpenSessionsIgnoresExpiredOnes(t *testing.T) {
	persistentStore, clock := newTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, persistentStore, "recuento@example.com")
	if _, err := persistentStore.CreateSession(ctx, user.ID); err != nil {
		t.Fatalf("CreateSession devolvió error: %v", err)
	}

	openBefore, err := persistentStore.CountOpenSessions(ctx, user.ID)
	if err != nil {
		t.Fatalf("CountOpenSessions devolvió error: %v", err)
	}
	if openBefore != 1 {
		t.Fatalf("se esperaba 1 sesión abierta y hay %d", openBefore)
	}

	clock.Advance(SessionTTL + time.Minute)

	openAfter, err := persistentStore.CountOpenSessions(ctx, user.ID)
	if err != nil {
		t.Fatalf("CountOpenSessions devolvió error: %v", err)
	}
	if openAfter != 0 {
		t.Fatalf("una sesión caducada no debe contar como abierta, se contaron %d", openAfter)
	}
}
