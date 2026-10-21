// Archivo: auth_interceptor_test.go — Pruebas del interceptor de autenticación (seguridad pura).
//
// En español: comprueban el comportamiento OBSERVABLE del filtro que identifica a quien llama. Con
// una sesión válida adjunta la identidad; con una sesión desconocida, caducada, revocada o ausente,
// la llamada sigue como ANÓNIMA pero NO se rechaza — en este producto se puede explorar el catálogo
// sin cuenta, y son los handlers quienes exigen identidad cuando la necesitan. También verifican la
// regla de prioridad entre la cookie y la cabecera Authorization.
package server

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"connectrpc.com/connect"

	"mdm7mo/internal/auth"
	"mdm7mo/internal/store"
)

// validSessionToken es el token que la sesión falsa de estas pruebas reconoce como bueno.
const validSessionToken = "token-de-sesion-valido-para-pruebas"

// sessionOwnerID es la cuenta a la que pertenece esa sesión.
const sessionOwnerID = "user-123"

// fakeSessionLookup imita al almacén: reconoce UN token concreto y rechaza todos los demás.
// En español: permite probar el interceptor sin montar una base de datos, porque lo único que el
// interceptor sabe hacer con el almacén es preguntarle "¿de quién es este token?".
type fakeSessionLookup struct {
	// knownToken es el único token que esta pieza considera válido.
	knownToken string
	// failWithInternalError hace que la consulta falle con un error REAL (no "no encontrado"),
	// para probar qué ocurre cuando la base de datos no responde.
	failWithInternalError bool
	// lastRequestedToken guarda el último token consultado, para comprobar CUÁL se leyó.
	lastRequestedToken string
}

// LookupSession responde como lo haría el almacén de verdad.
func (f *fakeSessionLookup) LookupSession(_ context.Context, token string) (store.Session, error) {
	f.lastRequestedToken = token
	if f.failWithInternalError {
		return store.Session{}, errors.New("la base de datos no responde")
	}
	if token != f.knownToken {
		return store.Session{}, store.ErrSessionNotFound
	}
	return store.Session{UserID: sessionOwnerID}, nil
}

// fakeRequest implementa lo mínimo de connect.AnyRequest que el interceptor usa (las cabeceras).
type fakeRequest struct {
	connect.AnyRequest
	header http.Header
}

// Header devuelve las cabeceras de la petición falsa (lo único que consulta el interceptor).
func (f *fakeRequest) Header() http.Header {
	return f.header
}

// silentLogger es un registro que no escribe nada, para que la salida de las pruebas quede limpia
// aunque el interceptor deje constancia de algún aviso.
func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// runInterceptor ejecuta el interceptor con las cabeceras dadas y devuelve la identidad que llegó al
// handler (cadena vacía si la llamada quedó anónima), junto con el token que se adjuntó.
func runInterceptor(t *testing.T, sessions *fakeSessionLookup, header http.Header) (string, string) {
	t.Helper()

	var seenUserID, seenSessionToken string
	next := connect.UnaryFunc(func(ctx context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		if identity, ok := auth.IdentityFromContext(ctx); ok {
			seenUserID = identity.UserID
			seenSessionToken = identity.SessionToken
		}
		return nil, nil
	})

	interceptor := AuthInterceptor(sessions, silentLogger())
	if _, err := interceptor(next)(context.Background(), &fakeRequest{header: header}); err != nil {
		t.Fatalf("interceptor returned unexpected error: %v", err)
	}
	return seenUserID, seenSessionToken
}

// headerWithCookie arma unas cabeceras con la cookie de sesión ya formada.
func headerWithCookie(value string) http.Header {
	header := http.Header{}
	header.Set(cookieHeader, auth.SessionCookieName+"="+value)
	return header
}

// TestAuthInterceptorAttachesIdentityFromCookie: cookie de sesión válida -> identidad.
// En español: este es el ÚNICO camino por el que se reconoce a alguien. Si esta prueba falla, nadie
// puede iniciar sesión en la aplicación.
func TestAuthInterceptorAttachesIdentityFromCookie(t *testing.T) {
	sessions := &fakeSessionLookup{knownToken: validSessionToken}

	userID, sessionToken := runInterceptor(t, sessions, headerWithCookie(validSessionToken))

	if userID != sessionOwnerID {
		t.Fatalf("want identity %q attached from the cookie, got %q", sessionOwnerID, userID)
	}
	// El token se arrastra en la identidad porque "cerrar sesión" necesita saber CUÁL cerrar.
	if sessionToken != validSessionToken {
		t.Fatalf("want session token %q carried in the identity, got %q", validSessionToken, sessionToken)
	}
}

// TestAuthInterceptorIgnoresTheAuthorizationHeader: una credencial en la cabecera Authorization NO
// abre sesión.
//
// En español: esta prueba protege una decisión de seguridad, no un detalle técnico. La sesión vive en
// una cookie que el JavaScript de la página no puede leer; ese es todo su valor. Si además se
// admitiera un token por la cabecera, alguien tendría que guardarlo en un sitio SÍ legible para poder
// enviarlo, y la protección se perdería entera. Aceptar la cabecera "por compatibilidad" es
// exactamente el cambio que esta prueba existe para impedir.
func TestAuthInterceptorIgnoresTheAuthorizationHeader(t *testing.T) {
	sessions := &fakeSessionLookup{knownToken: validSessionToken}

	header := http.Header{}
	header.Set("Authorization", "Bearer "+validSessionToken)

	userID, _ := runInterceptor(t, sessions, header)

	if userID != "" {
		t.Fatalf("la cabecera Authorization no debe identificar a nadie, identificó a %q", userID)
	}
	if sessions.lastRequestedToken != "" {
		t.Fatalf("no debería ni consultarse el token de la cabecera, se consultó %q", sessions.lastRequestedToken)
	}
}

// TestAuthInterceptorStaysAnonymousForUnknownOrMissingSession: sesión desconocida, revocada,
// caducada o ausente -> la llamada sigue, pero sin identidad y sin error.
func TestAuthInterceptorStaysAnonymousForUnknownOrMissingSession(t *testing.T) {
	sessions := &fakeSessionLookup{knownToken: validSessionToken}

	cases := []struct {
		name   string
		header http.Header
	}{
		{
			name:   "sin ninguna cabecera de credencial",
			header: http.Header{},
		},
		{
			name:   "cookie vacía",
			header: headerWithCookie(""),
		},
		{
			name:   "cookie con un token que el servidor no conoce",
			header: headerWithCookie("token-que-el-servidor-no-conoce"),
		},
		{
			name:   "cookie con un valor larguísimo y sin estructura",
			header: headerWithCookie(strings.Repeat("x", 500)),
		},
		{
			name:   "cookie con un token que ya no vale",
			header: headerWithCookie("token-revocado"),
		},
		{
			name:   "cabecera Cookie con basura que no es una cookie",
			header: http.Header{cookieHeader: []string{"=====;;;"}},
		},
		{
			name:   "cookie con otro nombre",
			header: http.Header{cookieHeader: []string{"otra_cookie=" + validSessionToken}},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if userID, _ := runInterceptor(t, sessions, testCase.header); userID != "" {
				t.Fatalf("want the call to stay anonymous, got identity %q", userID)
			}
		})
	}
}

// TestAuthInterceptorStaysAnonymousWhenLookupFails: si la base de datos falla, la llamada continúa
// como anónima en vez de reventar.
// En español: un problema del servidor no debe convertir una petición que se podía servir sin
// sesión (ver el catálogo) en un error para el usuario. Queda registrado en los logs, eso sí.
func TestAuthInterceptorStaysAnonymousWhenLookupFails(t *testing.T) {
	sessions := &fakeSessionLookup{knownToken: validSessionToken, failWithInternalError: true}

	userID, _ := runInterceptor(t, sessions, headerWithCookie(validSessionToken))

	if userID != "" {
		t.Fatalf("want the call to stay anonymous when the lookup fails, got identity %q", userID)
	}
}
