// Archivo: clientip_test.go — Pruebas de cómo se identifica al cliente detrás de un proxy.
//
// En español: esta pieza decide a quién se le cuenta cada petición para aplicarle su límite. Si se
// equivoca en un sentido, todos los usuarios comparten un contador y se bloquean entre sí; si se
// equivoca en el otro, cualquiera puede falsificar su dirección y saltarse el límite. Estas pruebas
// fijan los dos comportamientos: sin proxies declarados NO se hace caso a la cabecera, y con proxies
// declarados se cuenta desde la derecha, que es la parte que escriben nuestros propios proxies.
package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// requestWithForwardedFor arma una petición de prueba con su dirección de conexión y su cabecera.
func requestWithForwardedFor(remoteAddr, forwardedFor string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/rpc", nil)
	request.RemoteAddr = remoteAddr
	if forwardedFor != "" {
		request.Header.Set("X-Forwarded-For", forwardedFor)
	}
	return request
}

// TestClientIPIgnoresHeaderWithoutTrustedProxies: sin proxies declarados, la cabecera NO se cree.
// Es el caso de desarrollo y el único seguro por defecto: la cabecera la puede escribir cualquiera.
func TestClientIPIgnoresHeaderWithoutTrustedProxies(t *testing.T) {
	resolver := NewClientIPResolver(0)

	// Un atacante manda una dirección falsa esperando que le asignemos un contador nuevo.
	got := resolver.ClientIP(requestWithForwardedFor("198.51.100.5:44321", "1.2.3.4"))
	if got != "198.51.100.5" {
		t.Fatalf("want the real connection address 198.51.100.5, got %q", got)
	}
}

// TestClientIPUsesTrustedHopFromTheRight: con 1 proxy declarado, vale la ÚLTIMA entrada de la lista,
// que es la que escribió nuestro proxy; las anteriores las pudo poner el cliente.
func TestClientIPUsesTrustedHopFromTheRight(t *testing.T) {
	resolver := NewClientIPResolver(1)

	// El cliente intentó inyectar 9.9.9.9; nuestro proxy anotó después su origen real.
	got := resolver.ClientIP(requestWithForwardedFor("10.0.0.1:9999", "9.9.9.9, 203.0.113.7"))
	if got != "203.0.113.7" {
		t.Fatalf("want the address written by our proxy (203.0.113.7), got %q", got)
	}
}

// TestClientIPWithTwoTrustedProxies: con 2 proxies, se salta una entrada más hacia la izquierda.
func TestClientIPWithTwoTrustedProxies(t *testing.T) {
	resolver := NewClientIPResolver(2)

	got := resolver.ClientIP(requestWithForwardedFor("10.0.0.1:9999", "9.9.9.9, 203.0.113.7, 10.0.0.9"))
	if got != "203.0.113.7" {
		t.Fatalf("want 203.0.113.7 skipping two hops from the right, got %q", got)
	}
}

// TestClientIPFallsBackWhenChainIsShorterThanDeclared: si la cadena tiene menos entradas de las
// declaradas, se usa la más a la izquierda que EXISTE, nunca una posición inventada.
func TestClientIPFallsBackWhenChainIsShorterThanDeclared(t *testing.T) {
	resolver := NewClientIPResolver(3)

	got := resolver.ClientIP(requestWithForwardedFor("10.0.0.1:9999", "203.0.113.7"))
	if got != "203.0.113.7" {
		t.Fatalf("want the only available address 203.0.113.7, got %q", got)
	}
}

// TestClientIPIgnoresGarbageEntries: la cabecera puede traer basura inyectada; solo valen direcciones
// válidas. Si no queda ninguna, se usa la dirección real de la conexión.
func TestClientIPIgnoresGarbageEntries(t *testing.T) {
	resolver := NewClientIPResolver(1)

	if got := resolver.ClientIP(requestWithForwardedFor("10.0.0.1:9999", "no-soy-una-ip, , ")); got != "10.0.0.1" {
		t.Fatalf("want fallback to the real address 10.0.0.1 when the header has no valid entries, got %q", got)
	}

	// Con basura a la izquierda y una IP válida a la derecha, gana la válida de la derecha.
	if got := resolver.ClientIP(requestWithForwardedFor("10.0.0.1:9999", "basura, 203.0.113.7")); got != "203.0.113.7" {
		t.Fatalf("want 203.0.113.7, got %q", got)
	}
}

// TestClientIPAcceptsAddressesWithPortAndIPv6: algunos proxies anotan "ip:puerto" o IPv6 entre
// corchetes; en ambos casos debe quedarse solo con la dirección.
func TestClientIPAcceptsAddressesWithPortAndIPv6(t *testing.T) {
	resolver := NewClientIPResolver(1)

	if got := resolver.ClientIP(requestWithForwardedFor("10.0.0.1:9999", "203.0.113.7:5555")); got != "203.0.113.7" {
		t.Fatalf("want the address without its port, got %q", got)
	}
	if got := resolver.ClientIP(requestWithForwardedFor("10.0.0.1:9999", "[2001:db8::1]:443")); got != "2001:db8::1" {
		t.Fatalf("want the IPv6 address without brackets or port, got %q", got)
	}
}

// TestClientIPNegativeHopsAreTreatedAsZero: una configuración absurda cae al comportamiento seguro.
func TestClientIPNegativeHopsAreTreatedAsZero(t *testing.T) {
	resolver := NewClientIPResolver(-5)

	got := resolver.ClientIP(requestWithForwardedFor("198.51.100.5:44321", "1.2.3.4"))
	if got != "198.51.100.5" {
		t.Fatalf("want the real address when hops are misconfigured, got %q", got)
	}
}

// TestRateLimitIsPerClientBehindProxy es la prueba de FONDO: dos usuarios distintos detrás del MISMO
// proxy deben tener contadores independientes. Sin resolvedor, compartirían uno solo y el segundo
// usuario quedaría bloqueado por culpa del primero — el fallo que este trabajo viene a corregir.
func TestRateLimitIsPerClientBehindProxy(t *testing.T) {
	okHandler := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusOK)
	})
	handler := AuthAttemptLimit(NewClientIPResolver(1), NewMetrics(), okHandler)

	// El primer usuario agota su cuota de intentos.
	var lastStatus int
	for i := 0; i < authAttemptMaxRequests+1; i++ {
		recorder := httptest.NewRecorder()
		request := requestWithForwardedFor("10.0.0.1:9999", "203.0.113.7")
		request.URL.Path = "/mdm7mo.auth.v1.AuthService/Login"
		handler.ServeHTTP(recorder, request)
		lastStatus = recorder.Code
	}
	if lastStatus != http.StatusTooManyRequests {
		t.Fatalf("want 429 for the client that exhausted its quota, got %d", lastStatus)
	}

	// El segundo usuario, detrás del MISMO proxy, debe seguir pudiendo intentarlo.
	recorder := httptest.NewRecorder()
	request := requestWithForwardedFor("10.0.0.1:9999", "203.0.113.8")
	request.URL.Path = "/mdm7mo.auth.v1.AuthService/Login"
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200 for a different user behind the same proxy, got %d", recorder.Code)
	}
}
