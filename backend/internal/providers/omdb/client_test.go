// Archivo: client_test.go — Pruebas del cliente HTTP de OMDb con un servidor falso (httptest).
// En español: estas pruebas NO tocan la API real de OMDb (no hay key real ni red): levantan un
// servidor local que responde con JSON fijo (fixtures) y comprueban que el cliente se comporta
// bien. Se verifican: (1) que ByIMDbID parsea imdbRating y el array Ratings[] (Rotten Tomatoes y
// Metacritic), (2) que un "N/A" se convierte en cadena vacía, (3) que Response="False" produce un
// error con el motivo de OMDb, (4) que con la key viajan el imdbID y la apikey correctos en la
// query, y (5) que un cliente desactivado (sin API key) devuelve ErrDisabled SIN tocar la red.

package omdb

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// testAPIKey es una API key de mentira solo para las pruebas (no es un secreto real).
// En español: la usamos para comprobar que el cliente la pone en el parámetro apikey de la query.
const testAPIKey = "test-omdb-key-123"

// testIMDbID es un IMDb ID de mentira para las pruebas.
const testIMDbID = "tt0114709"

// newTestClient crea un Client apuntando al servidor de pruebas, con la API key de mentira.
// En español: inyecta vía opciones la URL base del httptest y su cliente HTTP, de modo que todas las
// peticiones del cliente caen en el servidor falso en lugar de en OMDb real.
func newTestClient(server *httptest.Server) *Client {
	return NewClient(
		testAPIKey,
		WithBaseURL(server.URL),
		WithHTTPClient(server.Client()),
	)
}

// TestByIMDbIDDoesNotLeakAPIKeyOnTransportError verifica que la apikey NUNCA aparece en el error.
// En español: este es el caso de seguridad crítico. Cuando la petición falla por transporte (aquí
// forzamos "conexión rechazada" apuntando a un servidor ya cerrado), Go devuelve un *url.Error que,
// sin saneamiento, incluiría la URL completa CON la apikey. Comprobamos que el mensaje de error
// resultante NO contiene la key, para garantizar que un fallo de red no filtre el secreto al log.
func TestByIMDbIDDoesNotLeakAPIKeyOnTransportError(t *testing.T) {
	t.Parallel()

	// Levantamos un servidor solo para obtener una URL válida y lo cerramos de inmediato: cualquier
	// petición a esa dirección fallará con "conexión rechazada", que es justo el error de transporte
	// que queremos provocar.
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	closedURL := server.URL
	server.Close()

	client := NewClient(testAPIKey, WithBaseURL(closedURL))

	_, err := client.ByIMDbID(context.Background(), testIMDbID)
	if err == nil {
		t.Fatal("ByIMDbID expected a transport error against a closed server, got nil")
	}

	// El requisito central: el secreto no debe filtrarse en el texto del error bajo ninguna circunstancia.
	if strings.Contains(err.Error(), testAPIKey) {
		t.Errorf("error message leaked the API key: %q", err.Error())
	}
}

// fullRatingsFixture es una respuesta de OMDb con éxito y las tres calificaciones presentes.
// En español: trae imdbRating y un array Ratings[] con IMDb, Rotten Tomatoes y Metacritic; la usa la
// prueba que comprueba el parseo completo.
const fullRatingsFixture = `{
	"Title": "Toy Story",
	"Response": "True",
	"imdbRating": "8.3",
	"Ratings": [
		{"Source": "Internet Movie Database", "Value": "8.3/10"},
		{"Source": "Rotten Tomatoes", "Value": "100%"},
		{"Source": "Metacritic", "Value": "96/100"}
	]
}`

// TestByIMDbIDParsesRatings verifica el parseo de imdbRating y del array Ratings[].
// En español: el servidor falso responde con éxito y las tres calificaciones; la prueba comprueba
// que IMDb sale de imdbRating y que Rotten Tomatoes y Metacritic se extraen del array por su fuente.
// De paso confirma que la query lleva el imdbID y la apikey correctos.
func TestByIMDbIDParsesRatings(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		// La query debe llevar el imdbID en "i" y la API key en "apikey" (OMDb lo exige así).
		if gotID := request.URL.Query().Get("i"); gotID != testIMDbID {
			t.Errorf("query i = %q, want %q", gotID, testIMDbID)
		}
		if gotKey := request.URL.Query().Get("apikey"); gotKey != testAPIKey {
			t.Errorf("query apikey = %q, want %q", gotKey, testAPIKey)
		}
		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, fullRatingsFixture)
	}))
	defer server.Close()

	client := newTestClient(server)

	result, err := client.ByIMDbID(context.Background(), testIMDbID)
	if err != nil {
		t.Fatalf("ByIMDbID returned an unexpected error: %v", err)
	}

	if result.IMDb != "8.3" {
		t.Errorf("IMDb = %q, want %q", result.IMDb, "8.3")
	}
	if result.RottenTomatoes != "100%" {
		t.Errorf("RottenTomatoes = %q, want %q", result.RottenTomatoes, "100%")
	}
	if result.Metacritic != "96/100" {
		t.Errorf("Metacritic = %q, want %q", result.Metacritic, "96/100")
	}
}

// naFixture es una respuesta con éxito pero donde imdbRating es "N/A" y faltan algunas fuentes.
// En español: imdbRating viene "N/A" (debe quedar vacío), hay Rotten Tomatoes presente, y Metacritic
// también viene "N/A" dentro del array (debe quedar vacío). La usa la prueba del manejo de "N/A".
const naFixture = `{
	"Title": "Pelicula Sin Datos",
	"Response": "True",
	"imdbRating": "N/A",
	"Ratings": [
		{"Source": "Rotten Tomatoes", "Value": "62%"},
		{"Source": "Metacritic", "Value": "N/A"}
	]
}`

// TestByIMDbIDTreatsNAAsEmpty verifica que cualquier "N/A" se convierte en cadena vacía.
// En español: el servidor falso responde con imdbRating="N/A" y Metacritic="N/A". La prueba
// comprueba que ambos quedan vacíos y que la única fuente real (Rotten Tomatoes) sí se conserva.
func TestByIMDbIDTreatsNAAsEmpty(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, naFixture)
	}))
	defer server.Close()

	client := newTestClient(server)

	result, err := client.ByIMDbID(context.Background(), testIMDbID)
	if err != nil {
		t.Fatalf("ByIMDbID returned an unexpected error: %v", err)
	}

	// imdbRating="N/A" debe quedar vacío.
	if result.IMDb != "" {
		t.Errorf("IMDb = %q, want empty string (N/A becomes empty)", result.IMDb)
	}
	// Rotten Tomatoes real se conserva.
	if result.RottenTomatoes != "62%" {
		t.Errorf("RottenTomatoes = %q, want %q", result.RottenTomatoes, "62%")
	}
	// Metacritic="N/A" dentro del array debe quedar vacío.
	if result.Metacritic != "" {
		t.Errorf("Metacritic = %q, want empty string (N/A becomes empty)", result.Metacritic)
	}
}

// falseResponseFixture es una respuesta de OMDb con fallo (Response="False" y su motivo).
// En español: la usa la prueba que comprueba que un Response="False" produce un error con el motivo.
const falseResponseFixture = `{"Response": "False", "Error": "Incorrect IMDb ID."}`

// TestByIMDbIDReturnsErrorOnResponseFalse verifica que Response="False" produce un error con el motivo.
// En español: el servidor falso responde con éxito HTTP (200) pero con Response="False" y un Error;
// el cliente debe devolver un error que incluya ese motivo de OMDb.
func TestByIMDbIDReturnsErrorOnResponseFalse(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, falseResponseFixture)
	}))
	defer server.Close()

	client := newTestClient(server)

	_, err := client.ByIMDbID(context.Background(), testIMDbID)
	if err == nil {
		t.Fatal("ByIMDbID returned nil error, want an error for Response=False")
	}
	// El error debe mencionar el motivo que OMDb explicó.
	if !contains(err.Error(), "Incorrect IMDb ID.") {
		t.Errorf("error %q, want it to mention the OMDb error message", err.Error())
	}
}

// TestByIMDbIDDisabledClientReturnsErrDisabledWithoutNetwork verifica el feature-flag.
// En español: creamos un cliente SIN API key apuntando a un servidor que falla la prueba si recibe
// cualquier petición. ByIMDbID debe devolver ErrDisabled (reconocible con errors.Is) sin tocar la
// red, demostrando que el flag apaga OMDb por completo.
func TestByIMDbIDDisabledClientReturnsErrDisabledWithoutNetwork(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		// Si llega cualquier petición, el flag NO apagó la red: la prueba debe fallar.
		t.Error("disabled client must not perform any network request")
	}))
	defer server.Close()

	// API key vacía => cliente desactivado. Inyectamos el servidor para demostrar que NO se llama.
	client := NewClient(
		"",
		WithBaseURL(server.URL),
		WithHTTPClient(server.Client()),
	)

	if client.Enabled() {
		t.Fatal("Enabled() = true for an empty API key, want false")
	}

	_, err := client.ByIMDbID(context.Background(), testIMDbID)
	if !errors.Is(err, ErrDisabled) {
		t.Fatalf("ByIMDbID error = %v, want ErrDisabled", err)
	}
}

// TestByIMDbIDEmptyIMDbIDReturnsError verifica que un imdbID vacío es un error de uso.
// En español: aunque el cliente esté activo, pedir con imdbID vacío no tiene sentido; debe devolver
// un error sin tocar la red (el servidor falla la prueba si recibe algo).
func TestByIMDbIDEmptyIMDbIDReturnsError(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Error("empty imdbID must not perform any network request")
	}))
	defer server.Close()

	client := newTestClient(server)

	if _, err := client.ByIMDbID(context.Background(), ""); err == nil {
		t.Fatal("ByIMDbID with empty imdbID returned nil error, want an error")
	}
}

// writeBody escribe el cuerpo de respuesta del servidor falso y falla la prueba si la escritura falla.
// En español: pequeño ayudante para no silenciar errores de escritura (las reglas prohíben tragar
// errores). t.Helper hace que un fallo apunte a la línea del test que llamó, no a esta interna.
func writeBody(t *testing.T, responseWriter http.ResponseWriter, body string) {
	t.Helper()
	if _, err := responseWriter.Write([]byte(body)); err != nil {
		t.Fatalf("failed to write test response body: %v", err)
	}
}

// contains indica si la cadena "haystack" contiene a "needle".
// En español: ayudante mínimo para comprobar que un mensaje de error menciona cierto texto, sin
// arrastrar dependencias extra en el test.
func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

// indexOf devuelve la posición de "needle" dentro de "haystack", o -1 si no aparece.
// En español: búsqueda simple de subcadena (la usa "contains"); recorre las posiciones posibles y
// compara el trozo de igual longitud.
func indexOf(haystack, needle string) int {
	for start := 0; start+len(needle) <= len(haystack); start++ {
		if haystack[start:start+len(needle)] == needle {
			return start
		}
	}
	return -1
}
