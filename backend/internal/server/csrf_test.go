package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Archivo: csrf_test.go — Pruebas del guardián de peticiones venidas de otros sitios.
//
// En español: lo que se comprueba aquí es una promesa concreta al usuario — que ninguna página ajena
// pueda dar órdenes en su nombre aprovechando que tiene la sesión abierta. Cada caso es un intento
// realista, no una comprobación de tecnicismos.

// allowedFrontendOrigin es la dirección de nuestro propio frontend en las pruebas.
const allowedFrontendOrigin = "https://storykeeper.example"

// newGuardedHandler arma el guardián sobre un handler que solo anota si llegó a ejecutarse.
func newGuardedHandler(t *testing.T) (http.Handler, *bool) {
	t.Helper()

	reached := false
	guarded := CSRFGuard(allowedFrontendOrigin, http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		reached = true
		writer.WriteHeader(http.StatusOK)
	}))
	return guarded, &reached
}

// TestCSRFGuardRejectsRequestsFromAnotherSite: el caso que da nombre al archivo.
//
// En español: alguien con la sesión abierta visita una página cualquiera, y esa página intenta pedirle
// al servidor que borre su cuenta. El navegador delata que la orden nace de otro sitio y aquí se corta.
func TestCSRFGuardRejectsRequestsFromAnotherSite(t *testing.T) {
	cases := map[string]http.Header{
		"el navegador avisa de que viene de otro sitio": {
			"Sec-Fetch-Site": []string{"cross-site"},
		},
		"la dirección declarada es la de otro sitio": {
			"Origin": []string{"https://sitio-malicioso.example"},
		},
		"la petición viene de un contexto sin dirección propia": {
			"Origin": []string{"null"},
		},
		"un sitio que solo se parece al nuestro en el principio": {
			"Origin": []string{"https://storykeeper.example.attacker.test"},
		},
	}

	for name, header := range cases {
		t.Run(name, func(t *testing.T) {
			guarded, reached := newGuardedHandler(t)

			request := httptest.NewRequest(http.MethodPost, "/mdm7mo.auth.v1.AuthService/DeleteAccount", nil)
			request.Header = header
			recorder := httptest.NewRecorder()

			guarded.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusForbidden {
				t.Fatalf("la petición debería rechazarse con 403, respondió %d", recorder.Code)
			}
			if *reached {
				t.Fatal("el servicio NO debería haberse ejecutado: la orden venía de otro sitio")
			}
		})
	}
}

// TestCSRFGuardAllowsRequestsFromOurOwnFrontend: el uso normal no se ve afectado.
func TestCSRFGuardAllowsRequestsFromOurOwnFrontend(t *testing.T) {
	cases := map[string]http.Header{
		"el navegador confirma que es nuestro propio sitio": {
			"Sec-Fetch-Site": []string{"same-origin"},
			"Origin":         []string{allowedFrontendOrigin},
		},
		"un subdominio del mismo sitio": {
			"Sec-Fetch-Site": []string{"same-site"},
		},
		"la persona escribió la dirección o abrió un marcador": {
			"Sec-Fetch-Site": []string{"none"},
		},
		"solo llega la dirección, y es la nuestra": {
			"Origin": []string{allowedFrontendOrigin},
		},
		"la dirección nuestra escrita con otras mayúsculas": {
			"Origin": []string{"https://StoryKeeper.example"},
		},
	}

	for name, header := range cases {
		t.Run(name, func(t *testing.T) {
			guarded, reached := newGuardedHandler(t)

			request := httptest.NewRequest(http.MethodPost, "/mdm7mo.auth.v1.AuthService/Login", nil)
			request.Header = header
			recorder := httptest.NewRecorder()

			guarded.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusOK {
				t.Fatalf("la petición legítima debería pasar, respondió %d", recorder.Code)
			}
			if !*reached {
				t.Fatal("el servicio debería haberse ejecutado")
			}
		})
	}
}

// TestCSRFGuardAllowsClientsThatAreNotBrowsers: las herramientas siguen funcionando.
//
// En español: una petición sin ninguna señal de origen no viene de un navegador (es una prueba
// automatizada, un script de administración, otro servidor). No hay sesión ajena que aprovechar, así
// que bloquearla solo rompería herramientas legítimas sin proteger a nadie.
func TestCSRFGuardAllowsClientsThatAreNotBrowsers(t *testing.T) {
	guarded, reached := newGuardedHandler(t)

	request := httptest.NewRequest(http.MethodPost, "/mdm7mo.auth.v1.AuthService/Login", nil)
	recorder := httptest.NewRecorder()

	guarded.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("un cliente que no es navegador debería pasar, respondió %d", recorder.Code)
	}
	if !*reached {
		t.Fatal("el servicio debería haberse ejecutado")
	}
}

// TestCSRFGuardDoesNotBlockReading: consultar el catálogo desde cualquier sitio sigue permitido.
//
// En español: el catálogo es público y de solo lectura. Restringir de dónde puede consultarse no
// protegería nada (no hay nada que cambiar) y en cambio impediría enlazarlo desde fuera.
func TestCSRFGuardDoesNotBlockReading(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		t.Run(method, func(t *testing.T) {
			guarded, reached := newGuardedHandler(t)

			request := httptest.NewRequest(method, "/mdm7mo.catalog.v1.CatalogService/ListReleases", nil)
			request.Header.Set("Sec-Fetch-Site", "cross-site")
			request.Header.Set("Origin", "https://sitio-cualquiera.example")
			recorder := httptest.NewRecorder()

			guarded.ServeHTTP(recorder, request)

			if !*reached {
				t.Fatalf("una consulta de solo lectura no debería bloquearse, respondió %d", recorder.Code)
			}
		})
	}
}
