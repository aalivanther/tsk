// Archivo: limits_test.go — Pruebas de los límites de protección (cuota por cliente y tope de cuerpo).
// En español: verifican el comportamiento observable de las dos vallas: que la cuota deja pasar el uso
// normal y corta el abuso (429), que cada cliente tiene SU cuota, que la ventana se reinicia con el
// tiempo, y que un cuerpo más grande que el tope se rechaza al leerlo.
package server

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestRateLimiterAllowsWithinQuota comprueba que un cliente puede hacer hasta el máximo de la ventana.
func TestRateLimiterAllowsWithinQuota(t *testing.T) {
	limiter := newRateLimiter(rateLimitWindow, rateLimitMaxRequests)
	now := time.Now()

	for i := 0; i < rateLimitMaxRequests; i++ {
		if !limiter.allow("10.0.0.1", now) {
			t.Fatalf("request %d within quota was rejected", i+1)
		}
	}
}

// TestRateLimiterRejectsOverQuota comprueba que la petición que EXCEDE la cuota se rechaza.
func TestRateLimiterRejectsOverQuota(t *testing.T) {
	limiter := newRateLimiter(rateLimitWindow, rateLimitMaxRequests)
	now := time.Now()

	for i := 0; i < rateLimitMaxRequests; i++ {
		limiter.allow("10.0.0.1", now)
	}
	if limiter.allow("10.0.0.1", now) {
		t.Fatal("request over quota was allowed")
	}
}

// TestRateLimiterIsPerClient comprueba que la cuota de un cliente NO afecta a otro.
func TestRateLimiterIsPerClient(t *testing.T) {
	limiter := newRateLimiter(rateLimitWindow, rateLimitMaxRequests)
	now := time.Now()

	for i := 0; i < rateLimitMaxRequests+5; i++ {
		limiter.allow("10.0.0.1", now)
	}
	if !limiter.allow("10.0.0.2", now) {
		t.Fatal("a different client was rejected because of another client's quota")
	}
}

// TestRateLimiterResetsAfterWindow comprueba que, pasada la ventana, el cliente vuelve a tener cuota.
func TestRateLimiterResetsAfterWindow(t *testing.T) {
	limiter := newRateLimiter(rateLimitWindow, rateLimitMaxRequests)
	start := time.Now()

	for i := 0; i < rateLimitMaxRequests+1; i++ {
		limiter.allow("10.0.0.1", start)
	}
	afterWindow := start.Add(rateLimitWindow + time.Second)
	if !limiter.allow("10.0.0.1", afterWindow) {
		t.Fatal("client was rejected after its window expired")
	}
}

// TestRateLimitMiddlewareReturns429 comprueba el comportamiento HTTP completo del middleware: el
// cliente que excede la cuota recibe 429 con cabecera Retry-After; antes de eso recibe 200.
func TestRateLimitMiddlewareReturns429(t *testing.T) {
	okHandler := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusOK)
	})
	metrics := NewMetrics()
	handler := RateLimit(NewClientIPResolver(0), metrics, okHandler)

	var lastStatus int
	var lastRetryAfter string
	for i := 0; i < rateLimitMaxRequests+1; i++ {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/rpc", nil)
		request.RemoteAddr = "192.0.2.7:51234"
		handler.ServeHTTP(recorder, request)
		lastStatus = recorder.Code
		lastRetryAfter = recorder.Header().Get("Retry-After")
	}

	if lastStatus != http.StatusTooManyRequests {
		t.Fatalf("want status %d after exceeding quota, got %d", http.StatusTooManyRequests, lastStatus)
	}
	if lastRetryAfter == "" {
		t.Fatal("want Retry-After header on 429 response, got empty")
	}
	// El rechazo tiene que quedar APUNTADO. En español: el contador existía y nadie lo incrementaba
	// nunca, así que la métrica que detectaría un ataque valía cero para siempre.
	if got := metrics.RateLimitedCount(RateLimitScopeAPI); got != 1 {
		t.Fatalf("want the API rate limit rejection counted once, got %d", got)
	}
	// Y no se contamina el contador de la otra valla: son señales distintas.
	if got := metrics.RateLimitedCount(RateLimitScopeAuth); got != 0 {
		t.Fatalf("want the auth scope untouched by the general quota, got %d", got)
	}
}

// TestAuthAttemptLimitCoversEverySensitiveOperation comprueba la valla estricta de cuenta.
//
// En español: antes solo cubría Login y Register, y eso dejaba a 240/min cuatro operaciones igual de
// golosas: pedir un restablecimiento (sondear correos e inundar a quien administra), canjearlo
// (probar tokens al azar, que son llaves maestras temporales), cambiar la contraseña y borrar la
// cuenta (las dos piden la contraseña actual, así que sirven para adivinarla). Esta prueba recorre
// las SEIS y comprueba además que la navegación normal —Me, Logout— sigue pasando.
func TestAuthAttemptLimitCoversEverySensitiveOperation(t *testing.T) {
	const authServicePrefix = "/mdm7mo.auth.v1.AuthService"

	// Cada operación sensible se prueba desde SU PROPIA IP, con su cuota recién estrenada, para
	// comprobar una por una que la valla la reconoce como sensible.
	sensitiveOperations := []string{
		"Login",
		"Register",
		"RequestPasswordReset",
		"ResetPassword",
		"ChangePassword",
		"DeleteAccount",
	}

	for index, operation := range sensitiveOperations {
		t.Run(operation, func(t *testing.T) {
			okHandler := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(http.StatusOK)
			})
			metrics := NewMetrics()
			handler := AuthAttemptLimit(NewClientIPResolver(0), metrics, okHandler)
			clientAddress := fmt.Sprintf("198.51.100.%d:40000", index+1)

			var lastStatus int
			for range authAttemptMaxRequests + 1 {
				recorder := httptest.NewRecorder()
				request := httptest.NewRequest(http.MethodPost, authServicePrefix+"/"+operation, nil)
				request.RemoteAddr = clientAddress
				handler.ServeHTTP(recorder, request)
				lastStatus = recorder.Code
			}
			if lastStatus != http.StatusTooManyRequests {
				t.Fatalf("want 429 after exceeding the strict quota on %s, got %d", operation, lastStatus)
			}
			// El rechazo se apunta bajo la valla de autenticación, no bajo la general.
			if got := metrics.RateLimitedCount(RateLimitScopeAuth); got != 1 {
				t.Fatalf("want the auth rate limit rejection counted once, got %d", got)
			}
			if got := metrics.RateLimitedCount(RateLimitScopeAPI); got != 0 {
				t.Fatalf("want the api scope untouched by the strict quota, got %d", got)
			}
		})
	}

	// Las operaciones que NO reciben secretos que adivinar siguen pasando aunque la cuota de esa IP
	// esté agotada: "Me" se llama en cada carga de página y frenarla rompería la navegación normal.
	okHandler := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusOK)
	})
	handler := AuthAttemptLimit(NewClientIPResolver(0), NewMetrics(), okHandler)

	const sharedClientAddress = "198.51.100.200:40000"
	for range authAttemptMaxRequests + 1 {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, authServicePrefix+"/Login", nil)
		request.RemoteAddr = sharedClientAddress
		handler.ServeHTTP(recorder, request)
	}

	for _, operation := range []string{"Me", "Logout"} {
		t.Run("no se frena "+operation, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, authServicePrefix+"/"+operation, nil)
			request.RemoteAddr = sharedClientAddress
			handler.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusOK {
				t.Fatalf("want 200 for %s (not a sensitive operation), got %d", operation, recorder.Code)
			}
		})
	}

	// Otra IP conserva su propia cuota.
	recorder := httptest.NewRecorder()
	otherIPRequest := httptest.NewRequest(http.MethodPost, authServicePrefix+"/Login", nil)
	otherIPRequest.RemoteAddr = "198.51.100.201:40000"
	handler.ServeHTTP(recorder, otherIPRequest)
	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200 for a different IP with fresh quota, got %d", recorder.Code)
	}
}

// TestMaxBodyBytesRejectsHugeBody comprueba que un cuerpo mayor al tope falla al leerse y que uno
// pequeño se lee completo sin problema.
func TestMaxBodyBytesRejectsHugeBody(t *testing.T) {
	var readErr error
	var readBytes int
	echoHandler := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		readErr = err
		readBytes = len(body)
		writer.WriteHeader(http.StatusOK)
	})
	handler := MaxBodyBytes(echoHandler)

	// Cuerpo pequeño: debe leerse entero, sin error.
	smallBody := strings.NewReader("hola")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/rpc", smallBody))
	if readErr != nil {
		t.Fatalf("small body read failed: %v", readErr)
	}
	if readBytes != 4 {
		t.Fatalf("want 4 bytes read from small body, got %d", readBytes)
	}

	// Cuerpo gigante (tope + 1): la lectura debe fallar (MaxBytesReader corta).
	hugeBody := strings.NewReader(strings.Repeat("x", maxRequestBodyBytes+1))
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/rpc", hugeBody))
	if readErr == nil {
		t.Fatal("huge body read succeeded; want it to fail at the size cap")
	}
}
