// Archivo: requestid_test.go — Pruebas del identificador de petición.
// En español: comprueban que cada petición recibe su "número de ticket", que se devuelve al cliente,
// que se respeta el que venga de fuera (para seguir una petición entre servicios) y que NO se acepta
// un identificador con caracteres raros, porque acabaría escrito en los registros del servidor.
package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// captureRequestID ejecuta el middleware y devuelve el identificador que llegó al handler y el que
// se envió de vuelta al cliente en la cabecera.
func captureRequestID(t *testing.T, incoming string) (fromContext, fromHeader string) {
	t.Helper()

	handler := RequestID(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if id, ok := RequestIDFromContext(request.Context()); ok {
			fromContext = id
		}
		writer.WriteHeader(http.StatusOK)
	}))

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	if incoming != "" {
		request.Header.Set("X-Request-Id", incoming)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	return fromContext, recorder.Header().Get("X-Request-Id")
}

// TestRequestIDIsGeneratedAndReturned: sin cabecera de entrada, se genera uno y se devuelve.
func TestRequestIDIsGeneratedAndReturned(t *testing.T) {
	fromContext, fromHeader := captureRequestID(t, "")

	if fromContext == "" {
		t.Fatal("want a request id available to the handler, got none")
	}
	if fromContext != fromHeader {
		t.Fatalf("want the same id in context and response header, got %q and %q", fromContext, fromHeader)
	}
	if len(fromContext) != requestIDBytes*2 {
		t.Fatalf("want a %d-character hex id, got %q", requestIDBytes*2, fromContext)
	}
}

// TestRequestIDRespectsIncomingValue: si el cliente ya trae uno válido, se conserva. Eso permite
// seguir una misma petición a través de varios servicios.
func TestRequestIDRespectsIncomingValue(t *testing.T) {
	fromContext, fromHeader := captureRequestID(t, "peticion-abc-123")

	if fromContext != "peticion-abc-123" || fromHeader != "peticion-abc-123" {
		t.Fatalf("want the incoming id preserved, got context=%q header=%q", fromContext, fromHeader)
	}
}

// TestRequestIDRejectsUnsafeIncomingValues: un identificador con caracteres raros o gigantesco se
// descarta y se genera uno limpio. El motivo es que este valor acaba escrito en los registros.
func TestRequestIDRejectsUnsafeIncomingValues(t *testing.T) {
	unsafeValues := []string{
		"salto\nde-linea",
		`comillas"y{llaves}`,
		"espacios en medio",
		strings.Repeat("x", maxAcceptedRequestIDLength+1),
	}

	for _, unsafe := range unsafeValues {
		fromContext, _ := captureRequestID(t, unsafe)
		if fromContext == unsafe {
			t.Fatalf("unsafe request id %q was accepted; it must be replaced by a generated one", unsafe)
		}
		if fromContext == "" {
			t.Fatalf("want a generated id after rejecting %q, got none", unsafe)
		}
	}
}
