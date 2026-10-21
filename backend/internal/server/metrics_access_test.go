// Archivo: metrics_access_test.go — Pruebas del portero de /metrics.
//
// En español: comprueban las tres situaciones que importan. Sin clave configurada la puerta está
// cerrada para todos (y no abierta, que era el fallo). Con clave, hay que presentarla y una
// equivocada no entra. Y la respuesta de /metrics nunca sale con los permisos de CORS puestos, para
// que ninguna página web pueda leerla desde el navegador de quien la visite.
package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// testMetricsAccessKey es la clave con la que se prueba el portero.
const testMetricsAccessKey = "clave-de-pruebas-para-metricas-0123456789"

// newProtectedMetricsHandler arma unas métricas de mentira detrás del portero.
func newProtectedMetricsHandler(accessKey string) http.Handler {
	inner := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte("tsk_uptime_seconds 1\n"))
	})
	return MetricsGuard(accessKey, inner)
}

// TestMetricsAreClosedWhenNoKeyIsConfigured: sin clave, nadie entra.
//
// En español: es la decisión deliberada. La alternativa —quedar abierto cuando falta la variable—
// significaría que un despliegue al que se le olvide configurarla queda expuesto sin que nadie se
// entere, que es exactamente el fallo que se está corrigiendo.
func TestMetricsAreClosedWhenNoKeyIsConfigured(t *testing.T) {
	handler := newProtectedMetricsHandler("")

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 when no metrics key is configured, got %d", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "tsk_uptime_seconds") {
		t.Fatalf("no metric may leak when the endpoint is closed, got:\n%s", recorder.Body.String())
	}
}

// TestMetricsRequireTheConfiguredKey recorre quién entra y quién no cuando sí hay clave.
func TestMetricsRequireTheConfiguredKey(t *testing.T) {
	handler := newProtectedMetricsHandler(testMetricsAccessKey)

	cases := []struct {
		name          string
		authorization string
		wantStatus    int
	}{
		{name: "sin cabecera", authorization: "", wantStatus: http.StatusUnauthorized},
		{name: "clave equivocada", authorization: "Bearer clave-que-no-es", wantStatus: http.StatusUnauthorized},
		{name: "clave sin el prefijo Bearer", authorization: testMetricsAccessKey, wantStatus: http.StatusUnauthorized},
		{name: "clave correcta", authorization: "Bearer " + testMetricsAccessKey, wantStatus: http.StatusOK},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
			if testCase.authorization != "" {
				request.Header.Set("Authorization", testCase.authorization)
			}

			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)

			if recorder.Code != testCase.wantStatus {
				t.Fatalf("want status %d, got %d", testCase.wantStatus, recorder.Code)
			}
			leaked := strings.Contains(recorder.Body.String(), "tsk_uptime_seconds")
			if testCase.wantStatus == http.StatusOK && !leaked {
				t.Fatalf("want the metrics body with a valid key, got:\n%s", recorder.Body.String())
			}
			if testCase.wantStatus != http.StatusOK && leaked {
				t.Fatalf("no metric may leak on a rejected request, got:\n%s", recorder.Body.String())
			}
		})
	}
}

// TestMetricsResponseDropsTheCORSPermissions comprueba que /metrics no queda legible desde una
// página web.
//
// En español: el middleware de CORS que envuelve todas las rutas pone el permiso de origen y el de
// credenciales para que el frontend pueda llamar al API. Sobre /metrics ese permiso sobra y es
// peligroso, así que el portero lo retira de esta respuesta concreta. Se comprueba simulando el
// mismo montaje real: CORS por fuera, portero por dentro.
func TestMetricsResponseDropsTheCORSPermissions(t *testing.T) {
	protected := newProtectedMetricsHandler(testMetricsAccessKey)
	handler := CORS("http://localhost:3100", protected)

	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	request.Header.Set("Authorization", "Bearer "+testMetricsAccessKey)

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200 with a valid key, got %d", recorder.Code)
	}
	for _, header := range []string{"Access-Control-Allow-Origin", "Access-Control-Allow-Credentials"} {
		if value := recorder.Header().Get(header); value != "" {
			t.Fatalf("the metrics response must not carry %s, got %q", header, value)
		}
	}
}
