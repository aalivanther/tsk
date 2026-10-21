// Archivo: handler_test.go — Pruebas del ciclo de vida completo de una cuenta.
//
// En español: comprueban el comportamiento tal como lo ve el frontend, llamando a los mismos
// métodos que expone el servicio: registrarse, entrar, cerrar sesión, cambiar la contraseña,
// restablecerla cuando se olvida y borrar la cuenta. Lo que más se vigila aquí son las promesas de
// seguridad: que cerrar sesión cierre de verdad, que cambiar la contraseña eche a todo el mundo y
// que borrar la cuenta no deje nada detrás.
package auth

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	authv1 "mdm7mo/gen/mdm7mo/auth/v1"
	"mdm7mo/internal/store"
)

// testTokenHashKey es la clave con la que las pruebas calculan las huellas de los tokens.
const testTokenHashKey = "clave-de-pruebas-para-huellas-de-tokens-0123456789"

// testPassword es la contraseña válida que usan las pruebas cuando el valor concreto da igual.
const testPassword = "contrasena-de-prueba"

// recordingDelivery es un canal de entrega que emite el permiso y apunta el token resultante.
//
// En español: sustituye al canal real (que solo avisa a quien administra) para que las pruebas
// puedan usar el token de restablecimiento sin leer logs. Representa al canal "de verdad" que algún
// día enviará correos: tira de la cuerda de emisión, porque va a entregar el token a alguien.
type recordingDelivery struct {
	// lastToken es el último token de restablecimiento entregado.
	lastToken string
	// lastRecipient es a quién iba dirigido.
	lastRecipient ResetRecipient
	// deliveries cuenta cuántas entregas se hicieron.
	deliveries int
}

// DeliverPasswordReset emite el permiso y apunta la entrega en vez de mandarla a ningún sitio.
func (d *recordingDelivery) DeliverPasswordReset(
	ctx context.Context,
	recipient ResetRecipient,
	issueReset IssueReset,
) error {
	resetToken, _, err := issueReset(ctx)
	if err != nil {
		return err
	}
	d.lastToken = resetToken
	d.lastRecipient = recipient
	d.deliveries++
	return nil
}

// notifyingDelivery es un canal que NO entrega tokens: solo cuenta los avisos, igual que hace el
// canal manual de la alpha (AdminDelivery). Se usa para comprobar que un canal así no provoca la
// emisión de ningún permiso.
type notifyingDelivery struct {
	// notices cuenta cuántos avisos se emitieron.
	notices int
}

// DeliverPasswordReset se limita a apuntar el aviso, sin tirar de la cuerda de emisión.
func (d *notifyingDelivery) DeliverPasswordReset(
	_ context.Context,
	_ ResetRecipient,
	_ IssueReset,
) error {
	d.notices++
	return nil
}

// testEnvironment agrupa todo lo que una prueba necesita para trabajar con el handler.
type testEnvironment struct {
	handler  *Handler
	store    *store.Store
	delivery *recordingDelivery
}

// newTestEnvironment arma un handler completo sobre una base de datos limpia y desechable.
func newTestEnvironment(t *testing.T, requireInvite bool) *testEnvironment {
	t.Helper()

	persistentStore, err := store.Open(store.Options{
		Path:         filepath.Join(t.TempDir(), "tsk.db"),
		TokenHashKey: testTokenHashKey,
		Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("store.Open devolvió error: %v", err)
	}
	t.Cleanup(func() {
		if err := persistentStore.Close(); err != nil {
			t.Errorf("Close devolvió error: %v", err)
		}
	})

	delivery := &recordingDelivery{}
	handler, err := NewHandler(HandlerOptions{
		Store:         persistentStore,
		RequireInvite: requireInvite,
		ResetDelivery: delivery,
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("NewHandler devolvió error: %v", err)
	}

	return &testEnvironment{handler: handler, store: persistentStore, delivery: delivery}
}

// openedSession es una sesión recién abierta tal y como la ve un cliente de verdad: los datos
// públicos de la cuenta por un lado y el token por el otro, sacado de la COOKIE (que es el único
// sitio por el que viaja desde que dejó de devolverse en el cuerpo de la respuesta).
type openedSession struct {
	user  *authv1.User
	token string
}

// GetUser devuelve la cuenta autenticada.
func (s openedSession) GetUser() *authv1.User { return s.user }

// GetToken devuelve el token de sesión leído de la cookie.
func (s openedSession) GetToken() string { return s.token }

// sessionTokenFromSetCookie extrae el valor de la cookie de sesión de una respuesta.
//
// En español: comprobar la sesión leyendo la cookie, y no un campo del mensaje, es deliberado. Es
// exactamente lo que hace un navegador, así que si algún día alguien dejara de emitir la cookie, las
// pruebas fallarían en vez de seguir en verde apoyándose en un camino que ya no existe.
func sessionTokenFromSetCookie(t *testing.T, header http.Header) string {
	t.Helper()

	raw := header.Get(setCookieHeader)
	if raw == "" {
		t.Fatal("la respuesta no trae cookie de sesión")
	}
	parsed := (&http.Response{Header: http.Header{setCookieHeader: []string{raw}}}).Cookies()
	for _, cookie := range parsed {
		if cookie.Name == SessionCookieName {
			return cookie.Value
		}
	}
	t.Fatalf("la cookie %q no aparece en %q", SessionCookieName, raw)
	return ""
}

// registerAccount da de alta una cuenta de prueba y devuelve la sesión emitida.
func (e *testEnvironment) registerAccount(t *testing.T, email string) openedSession {
	t.Helper()

	response, err := e.handler.Register(context.Background(), connect.NewRequest(&authv1.RegisterRequest{
		Email:       email,
		Password:    testPassword,
		DisplayName: "Persona de prueba",
	}))
	if err != nil {
		t.Fatalf("Register devolvió error: %v", err)
	}
	return openedSession{
		user:  response.Msg.GetUser(),
		token: sessionTokenFromSetCookie(t, response.Header()),
	}
}

// contextWithSession arma el context que el interceptor prepararía para una sesión concreta.
func contextWithSession(userID, sessionToken string) context.Context {
	return WithIdentity(context.Background(), Identity{UserID: userID, SessionToken: sessionToken})
}

// TestRegisterOpensASessionAndSetsTheCookie comprueba el alta con su sesión y su cookie.
func TestRegisterOpensASessionAndSetsTheCookie(t *testing.T) {
	environment := newTestEnvironment(t, false)

	response, err := environment.handler.Register(context.Background(), connect.NewRequest(&authv1.RegisterRequest{
		Email:       "Nueva@Example.com",
		Password:    testPassword,
		DisplayName: "Adrián",
	}))
	if err != nil {
		t.Fatalf("Register devolvió error: %v", err)
	}

	if got := response.Msg.GetUser().GetEmail(); got != "nueva@example.com" {
		t.Fatalf("el correo debería normalizarse a minúsculas, es %q", got)
	}
	if response.Msg.GetUser().GetId() == "" {
		t.Fatal("Register no asignó identificador a la cuenta")
	}

	// La cookie de sesión viaja en la respuesta, marcada como no legible por JavaScript.
	setCookie := response.Header().Get(setCookieHeader)
	if !strings.Contains(setCookie, SessionCookieName+"=") {
		t.Fatalf("la respuesta debería traer la cookie de sesión, trae %q", setCookie)
	}
	if !strings.Contains(setCookie, "HttpOnly") {
		t.Fatalf("la cookie de sesión debe ser HttpOnly, es %q", setCookie)
	}

	// Y la sesión existe de verdad en el servidor: el token vale.
	if _, err := environment.store.LookupSession(context.Background(), sessionTokenFromSetCookie(t, response.Header())); err != nil {
		t.Fatalf("la sesión emitida debería reconocerse: %v", err)
	}
}

// TestRegisterUsesTheEmailLocalPartWhenThereIsNoDisplayName comprueba el nombre de respaldo.
func TestRegisterUsesTheEmailLocalPartWhenThereIsNoDisplayName(t *testing.T) {
	environment := newTestEnvironment(t, false)

	response, err := environment.handler.Register(context.Background(), connect.NewRequest(&authv1.RegisterRequest{
		Email:    "sinnombre@example.com",
		Password: testPassword,
	}))
	if err != nil {
		t.Fatalf("Register devolvió error: %v", err)
	}
	if got := response.Msg.GetUser().GetDisplayName(); got != "sinnombre" {
		t.Fatalf("el nombre de respaldo debería ser %q y es %q", "sinnombre", got)
	}
}

// TestRegisterRejectsInvalidInput recorre los datos que no se aceptan al registrarse.
func TestRegisterRejectsInvalidInput(t *testing.T) {
	environment := newTestEnvironment(t, false)

	cases := []struct {
		name     string
		request  *authv1.RegisterRequest
		wantCode connect.Code
	}{
		{
			name:     "correo sin arroba",
			request:  &authv1.RegisterRequest{Email: "sinarroba", Password: testPassword},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name:     "correo sin punto en el dominio",
			request:  &authv1.RegisterRequest{Email: "alguien@dominio", Password: testPassword},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name:     "contraseña demasiado corta",
			request:  &authv1.RegisterRequest{Email: "ok@example.com", Password: "corta"},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "contraseña más larga de lo que bcrypt procesa",
			request: &authv1.RegisterRequest{
				Email:    "ok@example.com",
				Password: strings.Repeat("x", maxPasswordLength+1),
			},
			wantCode: connect.CodeInvalidArgument,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := environment.handler.Register(context.Background(), connect.NewRequest(testCase.request))
			if connect.CodeOf(err) != testCase.wantCode {
				t.Fatalf("se esperaba el código %v y se obtuvo %v (error: %v)", testCase.wantCode, connect.CodeOf(err), err)
			}
		})
	}
}

// TestRegisterRejectsDuplicateEmailWithoutRevealingIt comprueba la respuesta al correo repetido.
// En español: el mensaje es deliberadamente neutro para que el registro no sirva de buscador de
// cuentas ajenas.
func TestRegisterRejectsDuplicateEmailWithoutRevealingIt(t *testing.T) {
	environment := newTestEnvironment(t, false)
	environment.registerAccount(t, "repetida@example.com")

	_, err := environment.handler.Register(context.Background(), connect.NewRequest(&authv1.RegisterRequest{
		Email:    "repetida@example.com",
		Password: testPassword,
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("se esperaba AlreadyExists y se obtuvo %v", err)
	}
	if strings.Contains(strings.ToLower(err.Error()), "ya existe") {
		t.Fatalf("el mensaje no debe confirmar que la cuenta existe: %v", err)
	}
}

// TestRegisterRequiresAnInviteWhenTheAlphaIsClosed comprueba el interruptor de la alpha cerrada.
func TestRegisterRequiresAnInviteWhenTheAlphaIsClosed(t *testing.T) {
	environment := newTestEnvironment(t, true)
	ctx := context.Background()

	// Sin código: rechazado.
	_, err := environment.handler.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
		Email:    "sininvitacion@example.com",
		Password: testPassword,
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("sin invitación se esperaba PermissionDenied y se obtuvo %v", err)
	}

	// Con un código inventado: también rechazado.
	_, err = environment.handler.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
		Email:      "inventado@example.com",
		Password:   testPassword,
		InviteCode: "TSK-0000-0000",
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("con un código falso se esperaba PermissionDenied y se obtuvo %v", err)
	}

	// Con un código real: entra, y el código queda quemado para el siguiente.
	invite, err := environment.store.CreateInvite(ctx, "para la prueba", store.DefaultInviteTTL)
	if err != nil {
		t.Fatalf("CreateInvite devolvió error: %v", err)
	}
	if _, err := environment.handler.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
		Email:      "invitada@example.com",
		Password:   testPassword,
		InviteCode: invite.Code,
	})); err != nil {
		t.Fatalf("con una invitación válida el registro debería funcionar: %v", err)
	}

	_, err = environment.handler.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
		Email:      "segunda@example.com",
		Password:   testPassword,
		InviteCode: invite.Code,
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("un código ya canjeado debería rechazarse, se obtuvo %v", err)
	}
}

// TestLoginSucceedsAndFailsWithTheSameMessage comprueba el inicio de sesión y su anti-enumeración.
func TestLoginSucceedsAndFailsWithTheSameMessage(t *testing.T) {
	environment := newTestEnvironment(t, false)
	ctx := context.Background()
	environment.registerAccount(t, "entra@example.com")

	// Camino feliz: entra y recibe una sesión NUEVA (distinta de la del registro).
	response, err := environment.handler.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
		Email:    "  ENTRA@example.com ",
		Password: testPassword,
	}))
	if err != nil {
		t.Fatalf("Login devolvió error: %v", err)
	}
	if _, err := environment.store.LookupSession(ctx, sessionTokenFromSetCookie(t, response.Header())); err != nil {
		t.Fatalf("la sesión del inicio de sesión debería reconocerse: %v", err)
	}

	// Caminos fallidos: mismo código y mismo mensaje, exista o no la cuenta.
	cases := []struct {
		name    string
		request *authv1.LoginRequest
	}{
		{
			name:    "contraseña incorrecta de una cuenta que existe",
			request: &authv1.LoginRequest{Email: "entra@example.com", Password: "otra-cosa"},
		},
		{
			name:    "cuenta que no existe",
			request: &authv1.LoginRequest{Email: "fantasma@example.com", Password: testPassword},
		},
	}

	var messages []string
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := environment.handler.Login(ctx, connect.NewRequest(testCase.request))
			if connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("se esperaba Unauthenticated y se obtuvo %v", err)
			}
			messages = append(messages, err.Error())
		})
	}
	if len(messages) == 2 && messages[0] != messages[1] {
		t.Fatalf("los dos fallos deben dar el MISMO mensaje para no delatar qué correos existen:\n%q\n%q",
			messages[0], messages[1])
	}
}

// TestMeRequiresASession comprueba que "quién soy" exige identidad.
func TestMeRequiresASession(t *testing.T) {
	environment := newTestEnvironment(t, false)
	session := environment.registerAccount(t, "quiensoy@example.com")

	// Sin sesión en el context: rechazado.
	_, err := environment.handler.Me(context.Background(), connect.NewRequest(&authv1.MeRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("sin sesión se esperaba Unauthenticated y se obtuvo %v", err)
	}

	// Con sesión: devuelve la cuenta.
	ctx := contextWithSession(session.GetUser().GetId(), session.GetToken())
	response, err := environment.handler.Me(ctx, connect.NewRequest(&authv1.MeRequest{}))
	if err != nil {
		t.Fatalf("Me devolvió error: %v", err)
	}
	if response.Msg.GetUser().GetEmail() != "quiensoy@example.com" {
		t.Fatalf("Me devolvió la cuenta equivocada: %q", response.Msg.GetUser().GetEmail())
	}
}

// TestLogoutClosesOnlyTheCurrentSession comprueba que salir no echa al resto de dispositivos.
func TestLogoutClosesOnlyTheCurrentSession(t *testing.T) {
	environment := newTestEnvironment(t, false)
	ctx := context.Background()

	first := environment.registerAccount(t, "salir@example.com")
	second, err := environment.handler.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
		Email:    "salir@example.com",
		Password: testPassword,
	}))
	if err != nil {
		t.Fatalf("Login devolvió error: %v", err)
	}

	response, err := environment.handler.Logout(
		contextWithSession(first.GetUser().GetId(), first.GetToken()),
		connect.NewRequest(&authv1.LogoutRequest{}),
	)
	if err != nil {
		t.Fatalf("Logout devolvió error: %v", err)
	}

	// La respuesta pide al navegador que borre la cookie.
	if setCookie := response.Header().Get(setCookieHeader); !strings.Contains(setCookie, "Max-Age=0") {
		t.Fatalf("Logout debería vaciar la cookie de sesión, mandó %q", setCookie)
	}

	// La sesión cerrada ya no vale...
	if _, err := environment.store.LookupSession(ctx, first.GetToken()); err == nil {
		t.Fatal("la sesión cerrada debería dejar de valer")
	}
	// ...pero la otra sigue viva.
	if _, err := environment.store.LookupSession(ctx, sessionTokenFromSetCookie(t, second.Header())); err != nil {
		t.Fatalf("la otra sesión debería seguir abierta: %v", err)
	}
}

// TestLogoutRequiresASession comprueba que no se puede cerrar sesión sin tener una.
func TestLogoutRequiresASession(t *testing.T) {
	environment := newTestEnvironment(t, false)

	_, err := environment.handler.Logout(context.Background(), connect.NewRequest(&authv1.LogoutRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("se esperaba Unauthenticated y se obtuvo %v", err)
	}
}

// TestChangePasswordRevokesEverySession es la prueba central del cambio de contraseña.
//
// En español: comprueba las dos mitades de la promesa. La contraseña nueva funciona y la vieja no;
// y TODAS las sesiones que había abiertas (incluida la que hizo el cambio) quedan cerradas.
func TestChangePasswordRevokesEverySession(t *testing.T) {
	environment := newTestEnvironment(t, false)
	ctx := context.Background()

	first := environment.registerAccount(t, "cambia@example.com")
	second, err := environment.handler.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
		Email:    "cambia@example.com",
		Password: testPassword,
	}))
	if err != nil {
		t.Fatalf("Login devolvió error: %v", err)
	}

	const newPassword = "contrasena-nueva-y-distinta"
	if _, err := environment.handler.ChangePassword(
		contextWithSession(first.GetUser().GetId(), first.GetToken()),
		connect.NewRequest(&authv1.ChangePasswordRequest{
			CurrentPassword: testPassword,
			NewPassword:     newPassword,
		}),
	); err != nil {
		t.Fatalf("ChangePassword devolvió error: %v", err)
	}

	// Las dos sesiones que había abiertas quedaron cerradas.
	for name, token := range map[string]string{"la del registro": first.GetToken(), "la del login": sessionTokenFromSetCookie(t, second.Header())} {
		if _, err := environment.store.LookupSession(ctx, token); err == nil {
			t.Fatalf("la sesión %s debería haberse cerrado tras el cambio de contraseña", name)
		}
	}

	// La contraseña vieja ya no sirve.
	if _, err := environment.handler.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
		Email:    "cambia@example.com",
		Password: testPassword,
	})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("la contraseña vieja no debería servir, se obtuvo %v", err)
	}

	// La nueva sí.
	if _, err := environment.handler.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
		Email:    "cambia@example.com",
		Password: newPassword,
	})); err != nil {
		t.Fatalf("la contraseña nueva debería servir: %v", err)
	}
}

// TestChangePasswordRejectsBadInput recorre los casos en que el cambio no se acepta.
func TestChangePasswordRejectsBadInput(t *testing.T) {
	environment := newTestEnvironment(t, false)
	session := environment.registerAccount(t, "valida@example.com")
	ctx := contextWithSession(session.GetUser().GetId(), session.GetToken())

	cases := []struct {
		name     string
		request  *authv1.ChangePasswordRequest
		wantCode connect.Code
	}{
		{
			name:     "la contraseña actual no coincide",
			request:  &authv1.ChangePasswordRequest{CurrentPassword: "equivocada", NewPassword: "otra-valida-larga"},
			wantCode: connect.CodeUnauthenticated,
		},
		{
			name:     "la contraseña nueva es demasiado corta",
			request:  &authv1.ChangePasswordRequest{CurrentPassword: testPassword, NewPassword: "corta"},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name:     "la contraseña nueva es igual que la actual",
			request:  &authv1.ChangePasswordRequest{CurrentPassword: testPassword, NewPassword: testPassword},
			wantCode: connect.CodeInvalidArgument,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := environment.handler.ChangePassword(ctx, connect.NewRequest(testCase.request))
			if connect.CodeOf(err) != testCase.wantCode {
				t.Fatalf("se esperaba %v y se obtuvo %v (error: %v)", testCase.wantCode, connect.CodeOf(err), err)
			}
		})
	}

	// Y tras todos los intentos fallidos, la sesión sigue viva: nada se revocó por error.
	if _, err := environment.store.LookupSession(context.Background(), session.GetToken()); err != nil {
		t.Fatalf("un cambio rechazado no debe cerrar la sesión: %v", err)
	}
}

// TestDeleteAccountRemovesEverything comprueba el borrado definitivo de una cuenta.
func TestDeleteAccountRemovesEverything(t *testing.T) {
	environment := newTestEnvironment(t, false)
	ctx := context.Background()

	session := environment.registerAccount(t, "adios@example.com")
	userID := session.GetUser().GetId()

	// Le damos un perfil guardado, que debe irse con la cuenta.
	if _, err := environment.store.PutProfile(ctx, userID, `{"watchlist":["movie-1"]}`, 0); err != nil {
		t.Fatalf("PutProfile devolvió error: %v", err)
	}

	response, err := environment.handler.DeleteAccount(
		contextWithSession(userID, session.GetToken()),
		connect.NewRequest(&authv1.DeleteAccountRequest{Password: testPassword}),
	)
	if err != nil {
		t.Fatalf("DeleteAccount devolvió error: %v", err)
	}
	if setCookie := response.Header().Get(setCookieHeader); !strings.Contains(setCookie, "Max-Age=0") {
		t.Fatalf("DeleteAccount debería vaciar la cookie de sesión, mandó %q", setCookie)
	}

	// La cuenta ya no existe, ni por correo ni para iniciar sesión.
	if _, err := environment.store.FindUserByEmail(ctx, "adios@example.com"); err == nil {
		t.Fatal("la cuenta debería haber desaparecido")
	}
	if _, err := environment.handler.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
		Email:    "adios@example.com",
		Password: testPassword,
	})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("no debería poder iniciarse sesión en una cuenta borrada, se obtuvo %v", err)
	}
	// La sesión murió con ella.
	if _, err := environment.store.LookupSession(ctx, session.GetToken()); err == nil {
		t.Fatal("la sesión de una cuenta borrada debería dejar de valer")
	}
	// Y el perfil también.
	profile, err := environment.store.GetProfile(ctx, userID)
	if err != nil {
		t.Fatalf("GetProfile devolvió error: %v", err)
	}
	if profile.Revision != 0 {
		t.Fatalf("el perfil debería haberse borrado en cascada, quedó en la revisión %d", profile.Revision)
	}
}

// TestDeleteAccountRequiresThePassword comprueba la confirmación de una acción irreversible.
func TestDeleteAccountRequiresThePassword(t *testing.T) {
	environment := newTestEnvironment(t, false)
	session := environment.registerAccount(t, "conserva@example.com")

	_, err := environment.handler.DeleteAccount(
		contextWithSession(session.GetUser().GetId(), session.GetToken()),
		connect.NewRequest(&authv1.DeleteAccountRequest{Password: "equivocada"}),
	)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("se esperaba Unauthenticated y se obtuvo %v", err)
	}

	// La cuenta sigue ahí: un intento fallido no borra nada.
	if _, err := environment.store.FindUserByEmail(context.Background(), "conserva@example.com"); err != nil {
		t.Fatalf("la cuenta no debía borrarse: %v", err)
	}
}

// TestPasswordResetFullFlow comprueba el restablecimiento de principio a fin.
func TestPasswordResetFullFlow(t *testing.T) {
	environment := newTestEnvironment(t, false)
	ctx := context.Background()

	session := environment.registerAccount(t, "olvide@example.com")

	if _, err := environment.handler.RequestPasswordReset(ctx, connect.NewRequest(
		&authv1.RequestPasswordResetRequest{Email: "olvide@example.com"},
	)); err != nil {
		t.Fatalf("RequestPasswordReset devolvió error: %v", err)
	}
	if environment.delivery.deliveries != 1 {
		t.Fatalf("se esperaba 1 entrega y hubo %d", environment.delivery.deliveries)
	}
	if environment.delivery.lastRecipient.Email != "olvide@example.com" {
		t.Fatalf("la entrega iba a la cuenta equivocada: %+v", environment.delivery.lastRecipient)
	}

	const newPassword = "contrasena-restablecida"
	if _, err := environment.handler.ResetPassword(ctx, connect.NewRequest(&authv1.ResetPasswordRequest{
		ResetToken:  environment.delivery.lastToken,
		NewPassword: newPassword,
	})); err != nil {
		t.Fatalf("ResetPassword devolvió error: %v", err)
	}

	// La sesión que había abierta se cerró.
	if _, err := environment.store.LookupSession(ctx, session.GetToken()); err == nil {
		t.Fatal("el restablecimiento debería cerrar las sesiones abiertas")
	}
	// Y la contraseña nueva es la que vale.
	if _, err := environment.handler.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
		Email:    "olvide@example.com",
		Password: newPassword,
	})); err != nil {
		t.Fatalf("la contraseña restablecida debería servir: %v", err)
	}
}

// TestPasswordResetTokenIsSingleUse comprueba que el permiso solo sirve una vez.
func TestPasswordResetTokenIsSingleUse(t *testing.T) {
	environment := newTestEnvironment(t, false)
	ctx := context.Background()

	environment.registerAccount(t, "unavez@example.com")
	if _, err := environment.handler.RequestPasswordReset(ctx, connect.NewRequest(
		&authv1.RequestPasswordResetRequest{Email: "unavez@example.com"},
	)); err != nil {
		t.Fatalf("RequestPasswordReset devolvió error: %v", err)
	}
	resetToken := environment.delivery.lastToken

	if _, err := environment.handler.ResetPassword(ctx, connect.NewRequest(&authv1.ResetPasswordRequest{
		ResetToken:  resetToken,
		NewPassword: "primera-contrasena-nueva",
	})); err != nil {
		t.Fatalf("el primer restablecimiento debería funcionar: %v", err)
	}

	_, err := environment.handler.ResetPassword(ctx, connect.NewRequest(&authv1.ResetPasswordRequest{
		ResetToken:  resetToken,
		NewPassword: "segunda-contrasena-de-atacante",
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("el segundo uso debería rechazarse con PermissionDenied, se obtuvo %v", err)
	}

	// Y la contraseña sigue siendo la del primer restablecimiento.
	if _, err := environment.handler.Login(ctx, connect.NewRequest(&authv1.LoginRequest{
		Email:    "unavez@example.com",
		Password: "primera-contrasena-nueva",
	})); err != nil {
		t.Fatalf("la contraseña del primer restablecimiento debería seguir valiendo: %v", err)
	}
}

// TestRequestPasswordResetDoesNotRevealWhoHasAnAccount comprueba la anti-enumeración.
//
// En español: pedir el restablecimiento de un correo que no existe tiene que responder exactamente
// igual que si existiera. De lo contrario, esta llamada sería un buscador de cuentas registradas.
func TestRequestPasswordResetDoesNotRevealWhoHasAnAccount(t *testing.T) {
	environment := newTestEnvironment(t, false)

	if _, err := environment.handler.RequestPasswordReset(context.Background(), connect.NewRequest(
		&authv1.RequestPasswordResetRequest{Email: "fantasma@example.com"},
	)); err != nil {
		t.Fatalf("una cuenta inexistente debería responder igual que una real, y devolvió %v", err)
	}
	if environment.delivery.deliveries != 0 {
		t.Fatalf("no debía entregarse ningún token y se entregaron %d", environment.delivery.deliveries)
	}
}

// TestRequestPasswordResetTakesTheSameTimeWhetherTheAccountExistsOrNot es la prueba del ORÁCULO DE
// TIEMPOS, que es la mitad de la anti-enumeración que faltaba.
//
// En español: antes de la corrección, el mensaje era idéntico exista o no la cuenta, pero el RELOJ
// no: una cuenta existente tardaba 1,078 ms (consulta, emisión y entrega) y una inexistente 0,476 ms
// (no hacía nada). Con esa diferencia del doble, cualquiera podía recorrer una lista de correos y
// quedarse con los que "tardan", sin leer ni un solo mensaje. Esta prueba comprueba que ahora los
// dos caminos cumplen el mismo tiempo mínimo y que la diferencia entre ellos es despreciable.
//
// Se mide con el MÍNIMO de varias repeticiones y no con la media: el mínimo es el estimador menos
// contaminado por el ruido de la máquina (una pausa del recolector de basura solo puede hacer que
// una medida salga más alta, nunca más baja), y es además lo que mediría quien atacara, porque le
// basta con la respuesta más rápida que consiga.
func TestRequestPasswordResetTakesTheSameTimeWhetherTheAccountExistsOrNot(t *testing.T) {
	environment := newTestEnvironment(t, false)
	ctx := context.Background()
	environment.registerAccount(t, "existe@example.com")

	// measure devuelve el tiempo MÍNIMO observado al pedir el restablecimiento de un correo.
	measure := func(email string) time.Duration {
		fastest := time.Duration(0)
		for attempt := range passwordResetTimingSamples {
			startedAt := time.Now()
			if _, err := environment.handler.RequestPasswordReset(ctx, connect.NewRequest(
				&authv1.RequestPasswordResetRequest{Email: email},
			)); err != nil {
				t.Fatalf("RequestPasswordReset(%q) devolvió error: %v", email, err)
			}
			elapsed := time.Since(startedAt)
			if attempt == 0 || elapsed < fastest {
				fastest = elapsed
			}
		}
		return fastest
	}

	existing := measure("existe@example.com")
	missing := measure("fantasma@example.com")

	// Se dejan los números medidos en la salida de la prueba: si algún día esta defensa se rompe,
	// quien lo investigue verá de un vistazo cuánto tardó cada camino en vez de tener que medirlo.
	t.Logf("tiempo mínimo — cuenta existente: %v · cuenta inexistente: %v", existing, missing)

	// Primera comprobación, la que no depende de la máquina: ninguno de los dos caminos puede
	// responder antes del suelo de tiempo. Si alguno lo hiciera, la igualación no se estaría
	// aplicando en ese camino.
	if existing < passwordResetResponseFloor {
		t.Fatalf("la cuenta existente respondió en %v, por debajo del suelo de %v", existing, passwordResetResponseFloor)
	}
	if missing < passwordResetResponseFloor {
		t.Fatalf("la cuenta inexistente respondió en %v, por debajo del suelo de %v", missing, passwordResetResponseFloor)
	}

	// Segunda comprobación: la diferencia entre ambos caminos tiene que ser una fracción pequeña del
	// suelo. El margen es holgado a propósito para que la prueba no sea frágil en una máquina
	// ocupada; aun así, la señal original (2,26 veces más lento un camino que el otro) lo rompería
	// con mucho margen.
	difference := existing - missing
	if difference < 0 {
		difference = -difference
	}
	maximumDifference := passwordResetResponseFloor / 2
	if difference > maximumDifference {
		t.Fatalf(
			"los dos caminos deben tardar prácticamente lo mismo: existente=%v inexistente=%v diferencia=%v (máximo %v)",
			existing, missing, difference, maximumDifference,
		)
	}
}

// passwordResetTimingSamples es cuántas veces se repite cada medición de tiempo.
// En español: con el suelo en 50 ms, cinco repeticiones por camino cuestan medio segundo en total y
// bastan para que el mínimo sea estable.
const passwordResetTimingSamples = 5

// TestNotifyOnlyChannelDoesNotInvalidateTheAdminIssuedReset comprueba la decisión de la entrega
// manual: un canal que solo AVISA no provoca la emisión de ningún permiso.
//
// En español: importa porque emitir un permiso ANULA el anterior de esa cuenta. Si el formulario
// público emitiera uno que nadie puede leer, cualquiera que conociera un correo podría inutilizar
// una y otra vez el permiso que quien administra acabara de entregarle a su dueño por mensaje —una
// forma sencilla de dejar a alguien sin poder recuperar su cuenta—. La prueba reproduce justo ese
// ataque: se emite el permiso "a mano" (como hace `make admin-reset`), se martillea el formulario
// público y el permiso original tiene que seguir sirviendo.
func TestNotifyOnlyChannelDoesNotInvalidateTheAdminIssuedReset(t *testing.T) {
	environment := newTestEnvironment(t, false)
	ctx := context.Background()
	session := environment.registerAccount(t, "avisa@example.com")

	// Quien administra emite el permiso y se lo entrega a su dueño por un canal privado.
	adminIssued, err := environment.store.CreatePasswordReset(ctx, session.GetUser().GetId(), store.DefaultPasswordResetTTL)
	if err != nil {
		t.Fatalf("CreatePasswordReset devolvió error: %v", err)
	}

	// Se cambia el canal por uno que solo avisa, como el de la alpha, y se martillea el formulario.
	notifying := &notifyingDelivery{}
	environment.handler.resetDelivery = notifying

	const publicRequests = 3
	for range publicRequests {
		if _, err := environment.handler.RequestPasswordReset(ctx, connect.NewRequest(
			&authv1.RequestPasswordResetRequest{Email: "avisa@example.com"},
		)); err != nil {
			t.Fatalf("RequestPasswordReset devolvió error: %v", err)
		}
	}
	if notifying.notices != publicRequests {
		t.Fatalf("se esperaban %d avisos y hubo %d", publicRequests, notifying.notices)
	}

	// El permiso que se entregó a mano sigue valiendo: nadie lo anuló por el camino.
	if _, err := environment.handler.ResetPassword(ctx, connect.NewRequest(&authv1.ResetPasswordRequest{
		ResetToken:  adminIssued.Token,
		NewPassword: "contrasena-nueva-del-rescate",
	})); err != nil {
		t.Fatalf("el permiso emitido a mano debería seguir sirviendo: %v", err)
	}
}

// TestAdminDeliveryNeverWritesTheTokenToTheLog comprueba que el canal manual no deja secretos en el
// registro del servidor.
//
// En español: es la prueba de la corrección más delicada de este archivo. Un registro se rota, se
// copia a otros sistemas para analizarlo y lo puede leer cualquiera con acceso a la máquina; una
// llave maestra de una cuenta no puede vivir ahí. Se captura la salida real del registro y se busca
// que no aparezca ningún token.
func TestAdminDeliveryNeverWritesTheTokenToTheLog(t *testing.T) {
	var captured strings.Builder
	logger := slog.New(slog.NewTextHandler(&captured, &slog.HandlerOptions{Level: slog.LevelDebug}))
	delivery := NewAdminDelivery(logger, "https://ejemplo.test")

	const secretToken = "TOKEN-SECRETISIMO-QUE-NO-DEBE-APARECER"
	issueWasCalled := false
	issueReset := func(context.Context) (string, time.Time, error) {
		issueWasCalled = true
		return secretToken, time.Now().Add(time.Hour), nil
	}

	if err := delivery.DeliverPasswordReset(
		context.Background(),
		ResetRecipient{UserID: "u-1", Email: "persona@example.com", DisplayName: "Persona"},
		issueReset,
	); err != nil {
		t.Fatalf("DeliverPasswordReset devolvió error: %v", err)
	}

	if issueWasCalled {
		t.Fatal("el canal manual no debe emitir ningún permiso: nadie va a recibir ese token")
	}

	written := captured.String()
	if strings.Contains(written, secretToken) {
		t.Fatalf("el token acabó escrito en el registro:\n%s", written)
	}
	// Y el aviso sí tiene que servir para algo: debe decir a quién atender y con qué comando.
	for _, expected := range []string{"persona@example.com", "make admin-reset"} {
		if !strings.Contains(written, expected) {
			t.Fatalf("el aviso debería contener %q para que se pueda atender:\n%s", expected, written)
		}
	}
}

// TestRegisterDoesNotRevealAccountsWithoutAValidInvite comprueba la otra mitad de la decisión sobre
// el código de error del registro.
//
// En español: se ha decidido CONSERVAR el código AlreadyExists cuando el correo ya tiene cuenta,
// porque sin él nadie sabría que lo que le toca es iniciar sesión (ver el razonamiento completo en
// Handler.Register). Esa decisión solo se sostiene si, durante la alpha cerrada, no se puede llegar
// a esa respuesta sin gastar una invitación válida. Antes sí se podía: el alta fallaba primero por
// correo repetido y solo después por invitación, así que un código inventado bastaba para preguntar
// "¿esta persona está registrada?". Esta prueba fija que ahora ambos casos responden lo mismo.
func TestRegisterDoesNotRevealAccountsWithoutAValidInvite(t *testing.T) {
	environment := newTestEnvironment(t, true)
	ctx := context.Background()

	// Se crea una cuenta con una invitación de verdad, para tener un correo que SÍ existe.
	invite, err := environment.store.CreateInvite(ctx, "para la prueba", store.DefaultInviteTTL)
	if err != nil {
		t.Fatalf("CreateInvite devolvió error: %v", err)
	}
	if _, err := environment.handler.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
		Email:      "registrada@example.com",
		Password:   testPassword,
		InviteCode: invite.Code,
	})); err != nil {
		t.Fatalf("el registro con invitación válida debería funcionar: %v", err)
	}

	// Con un código inventado, un correo QUE EXISTE y uno que NO deben responder exactamente igual.
	const madeUpInviteCode = "TSK-0000-0000"
	cases := []struct {
		name  string
		email string
	}{
		{name: "correo que ya tiene cuenta", email: "registrada@example.com"},
		{name: "correo que no tiene cuenta", email: "desconocida@example.com"},
	}

	var responses []string
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := environment.handler.Register(ctx, connect.NewRequest(&authv1.RegisterRequest{
				Email:      testCase.email,
				Password:   testPassword,
				InviteCode: madeUpInviteCode,
			}))
			if connect.CodeOf(err) != connect.CodePermissionDenied {
				t.Fatalf("sin invitación válida se esperaba PermissionDenied y se obtuvo %v", err)
			}
			responses = append(responses, err.Error())
		})
	}
	if len(responses) == 2 && responses[0] != responses[1] {
		t.Fatalf("las dos respuestas deben ser IDÉNTICAS para no delatar qué correos existen:\n%q\n%q",
			responses[0], responses[1])
	}
}

// TestResetPasswordRejectsBadTokens recorre los tokens de restablecimiento que no valen.
func TestResetPasswordRejectsBadTokens(t *testing.T) {
	environment := newTestEnvironment(t, false)

	cases := []struct {
		name     string
		request  *authv1.ResetPasswordRequest
		wantCode connect.Code
	}{
		{
			name:     "token vacío",
			request:  &authv1.ResetPasswordRequest{ResetToken: "", NewPassword: "contrasena-valida"},
			wantCode: connect.CodePermissionDenied,
		},
		{
			name:     "token inventado",
			request:  &authv1.ResetPasswordRequest{ResetToken: "token-falso", NewPassword: "contrasena-valida"},
			wantCode: connect.CodePermissionDenied,
		},
		{
			name:     "contraseña nueva demasiado corta",
			request:  &authv1.ResetPasswordRequest{ResetToken: "token-falso", NewPassword: "abc"},
			wantCode: connect.CodeInvalidArgument,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := environment.handler.ResetPassword(context.Background(), connect.NewRequest(testCase.request))
			if connect.CodeOf(err) != testCase.wantCode {
				t.Fatalf("se esperaba %v y se obtuvo %v (error: %v)", testCase.wantCode, connect.CodeOf(err), err)
			}
		})
	}
}

// TestNewHandlerRejectsMissingPieces comprueba que el handler no se arma incompleto.
func TestNewHandlerRejectsMissingPieces(t *testing.T) {
	cases := []struct {
		name    string
		options HandlerOptions
	}{
		{name: "sin almacén", options: HandlerOptions{ResetDelivery: &recordingDelivery{}}},
		{name: "sin canal de entrega", options: HandlerOptions{Store: &store.Store{}}},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := NewHandler(testCase.options); err == nil {
				t.Fatal("se esperaba un error y no hubo ninguno")
			}
		})
	}
}
