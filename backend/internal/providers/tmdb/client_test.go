// Archivo: client_test.go — Pruebas del cliente HTTP de TMDB con un servidor falso (httptest).
// En español: estas pruebas NO tocan la API real de TMDB (no hay token ni red): levantan un
// servidor local que responde con JSON fijo (fixtures) y comprueban que el cliente se comporta
// bien. Se verifican cinco cosas: (1) que el token viaja en la cabecera y NUNCA en la URL, (2) que
// DiscoverMovies extrae bien los ids, (3) que MovieDetails parsea el detalle con sus bloques
// embebidos, (4) que ante un 429 ("baja el ritmo") reintenta y termina con éxito, y (5) que
// BuildImageURL arma bien la URL y devuelve vacío cuando no hay imagen.

package tmdb

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// testReadToken es un token de mentira solo para las pruebas (no es un secreto real).
// En español: lo usamos para comprobar que el cliente lo pone en la cabecera Authorization.
const testReadToken = "test-read-token-123"

// newTestClient crea un Client apuntando al servidor de pruebas, con tiempos cortos para no demorar.
// En español: inyecta vía opciones la URL base del httptest y su cliente HTTP, de modo que todas las
// peticiones del cliente caen en el servidor falso en lugar de en TMDB real.
func newTestClient(server *httptest.Server) *Client {
	return NewClient(
		testReadToken,
		WithBaseURL(server.URL),
		WithHTTPClient(server.Client()),
	)
}

// TestDoGETSendsBearerTokenAndKeepsItOutOfURL verifica el manejo seguro del token.
// En español: el servidor falso inspecciona cada petición. Comprueba que llega la cabecera
// "Authorization: Bearer <token>" y que el token NO aparece en la ruta ni en la query (donde podría
// filtrarse en logs). Si algo de eso falla, marca la prueba como fallida.
func TestDoGETSendsBearerTokenAndKeepsItOutOfURL(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		// La cabecera Authorization debe traer exactamente "Bearer <token>".
		gotAuthorization := request.Header.Get("Authorization")
		wantAuthorization := "Bearer " + testReadToken
		if gotAuthorization != wantAuthorization {
			t.Errorf("Authorization header = %q, want %q", gotAuthorization, wantAuthorization)
		}

		// El cliente debe pedir JSON.
		if accept := request.Header.Get("Accept"); accept != "application/json" {
			t.Errorf("Accept header = %q, want %q", accept, "application/json")
		}

		// El token NUNCA debe aparecer en la URL completa (ruta + query): sería una fuga de secreto.
		if strings.Contains(request.URL.String(), testReadToken) {
			t.Errorf("request URL %q must not contain the token", request.URL.String())
		}

		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, "{}")
	}))
	defer server.Close()

	client := newTestClient(server)

	// Llamamos a Configuration (que internamente usa doGET) solo para disparar una petición.
	if _, err := client.Configuration(context.Background()); err != nil {
		t.Fatalf("Configuration returned an unexpected error: %v", err)
	}
}

// TestDiscoverMoviesParsesIDs verifica que DiscoverMovies extrae los ids de la página de resultados.
// En español: el servidor falso devuelve una página con tres películas; la prueba comprueba que el
// cliente devuelve exactamente esos tres ids en orden. De paso valida que la petición lleva el
// parámetro region (no el token) en la query.
func TestDiscoverMoviesParsesIDs(t *testing.T) {
	t.Parallel()

	const discoverFixture = `{
		"results": [
			{"id": 101, "title": "Uno"},
			{"id": 202, "title": "Dos"},
			{"id": 303, "title": "Tres"}
		]
	}`

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		// Confirmamos que la query lleva la región configurada y que el token no se cuela en la URL.
		if region := request.URL.Query().Get("region"); region != defaultRegion {
			t.Errorf("region query = %q, want %q", region, defaultRegion)
		}
		if strings.Contains(request.URL.String(), testReadToken) {
			t.Errorf("request URL %q must not contain the token", request.URL.String())
		}
		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, discoverFixture)
	}))
	defer server.Close()

	client := newTestClient(server)

	movieIDs, err := client.DiscoverMovies(context.Background(), 2026, 6)
	if err != nil {
		t.Fatalf("DiscoverMovies returned an unexpected error: %v", err)
	}

	wantIDs := []int{101, 202, 303}
	if len(movieIDs) != len(wantIDs) {
		t.Fatalf("DiscoverMovies returned %d ids, want %d", len(movieIDs), len(wantIDs))
	}
	for index, wantID := range wantIDs {
		if movieIDs[index] != wantID {
			t.Errorf("movieIDs[%d] = %d, want %d", index, movieIDs[index], wantID)
		}
	}
}

// movieDetailsFixture es un detalle de película de mentira con sus bloques embebidos.
// En español: cubre los campos que el cliente y el mapper usan: básicos, géneros, idiomas, saga,
// videos (un tráiler oficial de YouTube), créditos y proveedores de MX. Lo reutilizan varias pruebas.
const movieDetailsFixture = `{
	"id": 862,
	"title": "Toy Story",
	"overview": "Los juguetes cobran vida.",
	"release_date": "2026-06-12",
	"poster_path": "/poster.jpg",
	"backdrop_path": "/backdrop.jpg",
	"original_language": "en",
	"vote_average": 8.3,
	"genres": [{"id": 16, "name": "Animación"}, {"id": 35, "name": "Comedia"}],
	"belongs_to_collection": {"id": 10, "name": "Colección Toy Story", "poster_path": "/c.jpg", "backdrop_path": "/cb.jpg"},
	"spoken_languages": [{"english_name": "English"}, {"english_name": "Spanish"}],
	"videos": {"results": [
		{"key": "teaserKEY", "site": "YouTube", "type": "Teaser", "official": true},
		{"key": "trailerKEY", "site": "YouTube", "type": "Trailer", "official": true}
	]},
	"credits": {
		"cast": [
			{"name": "Tom Hanks", "character": "Woody", "profile_path": "/th.jpg", "order": 0},
			{"name": "Tim Allen", "character": "Buzz", "profile_path": "/ta.jpg", "order": 1}
		],
		"crew": [
			{"name": "John Lasseter", "job": "Director", "department": "Directing"}
		]
	},
	"watch/providers": {"results": {"MX": {
		"link": "https://www.justwatch.com/mx",
		"flatrate": [{"provider_name": "Disney Plus"}],
		"rent": [{"provider_name": "Apple TV"}],
		"buy": []
	}}}
}`

// TestMovieDetailsParsesDetailsAndAppend verifica que MovieDetails parsea detalle y bloques embebidos.
// En español: comprueba que los campos básicos, los géneros, la saga, el reparto, los videos y los
// proveedores de MX llegan bien deserializados desde el JSON del servidor falso.
func TestMovieDetailsParsesDetailsAndAppend(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		// Confirmamos que se pide append_to_response (la llamada eficiente de un solo viaje).
		if appendParam := request.URL.Query().Get("append_to_response"); appendParam == "" {
			t.Errorf("append_to_response query is empty, want the embedded resources list")
		}
		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, movieDetailsFixture)
	}))
	defer server.Close()

	client := newTestClient(server)

	details, err := client.MovieDetails(context.Background(), 862)
	if err != nil {
		t.Fatalf("MovieDetails returned an unexpected error: %v", err)
	}

	// Campos básicos.
	if details.Title != "Toy Story" {
		t.Errorf("Title = %q, want %q", details.Title, "Toy Story")
	}
	if details.ReleaseDate != "2026-06-12" {
		t.Errorf("ReleaseDate = %q, want %q", details.ReleaseDate, "2026-06-12")
	}
	if details.VoteAverage != 8.3 {
		t.Errorf("VoteAverage = %v, want %v", details.VoteAverage, 8.3)
	}

	// Géneros embebidos.
	if len(details.Genres) != 2 || details.Genres[0].Name != "Animación" {
		t.Errorf("Genres = %+v, want first genre %q", details.Genres, "Animación")
	}

	// Saga (belongs_to_collection) embebida.
	if details.BelongsToCollection == nil || details.BelongsToCollection.Name != "Colección Toy Story" {
		t.Errorf("BelongsToCollection = %+v, want name %q", details.BelongsToCollection, "Colección Toy Story")
	}

	// Videos embebidos.
	if len(details.Videos.Results) != 2 {
		t.Fatalf("Videos.Results has %d entries, want 2", len(details.Videos.Results))
	}

	// Créditos embebidos.
	if len(details.Credits.Cast) != 2 || details.Credits.Cast[0].Name != "Tom Hanks" {
		t.Errorf("Credits.Cast = %+v, want first cast %q", details.Credits.Cast, "Tom Hanks")
	}

	// Proveedores de MX embebidos (la clave json real es "watch/providers").
	mexico := details.WatchProviders.Results.MX
	if mexico == nil {
		t.Fatalf("WatchProviders.Results.MX is nil, want providers for MX")
	}
	if len(mexico.Flatrate) != 1 || mexico.Flatrate[0].ProviderName != "Disney Plus" {
		t.Errorf("MX flatrate = %+v, want %q", mexico.Flatrate, "Disney Plus")
	}
}

// TestDoGETRetriesOn429 verifica el reintento ante el límite de tasa (HTTP 429).
// En español: el servidor falso responde 429 en la primera petición y 200 en la segunda. La prueba
// comprueba que el cliente reintenta (en total dos peticiones) y termina con éxito devolviendo el
// cuerpo de la respuesta buena. Usamos un Retry-After de 0 (vía cabecera ausente) y un servidor que
// responde de inmediato para que la prueba sea rápida.
func TestDoGETRetriesOn429(t *testing.T) {
	t.Parallel()

	// requestCount cuenta cuántas peticiones recibió el servidor (de forma segura entre goroutines).
	var requestCount atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		currentCount := requestCount.Add(1)
		if currentCount == 1 {
			// Primera vez: pedimos bajar el ritmo con un Retry-After de 1 segundo... pero como la
			// prueba debe ser rápida, indicamos 0 para que el backoff de respaldo no demore de más.
			responseWriter.Header().Set("Retry-After", "0")
			responseWriter.WriteHeader(http.StatusTooManyRequests)
			return
		}
		// Segunda vez: respondemos OK con un detalle válido.
		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, movieDetailsFixture)
	}))
	defer server.Close()

	client := newTestClient(server)

	// Usamos un contexto con plazo razonable para no quedar colgados si algo va mal.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	details, err := client.MovieDetails(ctx, 862)
	if err != nil {
		t.Fatalf("MovieDetails returned an unexpected error after a 429: %v", err)
	}
	if details.Title != "Toy Story" {
		t.Errorf("Title = %q, want %q (the successful retry body)", details.Title, "Toy Story")
	}

	// Deben haberse hecho exactamente dos peticiones: la del 429 y el reintento exitoso.
	if got := requestCount.Load(); got != 2 {
		t.Errorf("server received %d requests, want 2 (one 429 + one retry)", got)
	}
}

// TestBuildImageURL verifica la construcción de URLs de imagen y el caso de imagen ausente.
// En español: con una ruta válida debe unir base + tamaño + ruta; con ruta vacía debe devolver "".
func TestBuildImageURL(t *testing.T) {
	t.Parallel()

	// Construimos un cliente directo (sin servidor): BuildImageURL no toca la red.
	client := NewClient(testReadToken)

	// Caso con ruta válida: base por defecto + tamaño + ruta.
	gotURL := client.BuildImageURL("/poster.jpg", "w500")
	wantURL := ImageBaseURLDefault + "w500" + "/poster.jpg"
	if gotURL != wantURL {
		t.Errorf("BuildImageURL(%q, %q) = %q, want %q", "/poster.jpg", "w500", gotURL, wantURL)
	}

	// Caso con ruta vacía: debe devolver cadena vacía (la imagen no existe).
	if emptyURL := client.BuildImageURL("", "w500"); emptyURL != "" {
		t.Errorf("BuildImageURL(\"\", \"w500\") = %q, want empty string", emptyURL)
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

// tvDetailsFixture es un detalle de serie de mentira con aggregate_credits y proveedores de MX.
// En español: cubre las claves propias de TV (name, first_air_date) y trae el reparto en
// aggregate_credits (la fuente preferida para series). Lo usan las pruebas de TVDetails.
const tvDetailsFixture = `{
	"id": 1399,
	"name": "La Casa del Dragón",
	"overview": "Intrigas en Poniente.",
	"first_air_date": "2026-06-01",
	"poster_path": "/tvposter.jpg",
	"backdrop_path": "/tvbackdrop.jpg",
	"original_language": "en",
	"vote_average": 8.5,
	"genres": [{"id": 18, "name": "Drama"}],
	"spoken_languages": [{"english_name": "English"}],
	"videos": {"results": [
		{"key": "tvTrailerKEY", "site": "YouTube", "type": "Trailer", "official": true}
	]},
	"credits": {"cast": [{"name": "Relleno", "character": "Extra", "order": 0}]},
	"aggregate_credits": {
		"cast": [{"name": "Matt Smith", "character": "Daemon", "profile_path": "/ms.jpg", "order": 0}],
		"crew": [{"name": "Ryan Condal", "job": "Creator", "department": "Writing"}]
	},
	"watch/providers": {"results": {"MX": {"flatrate": [{"provider_name": "Max"}]}}}
}`

// TestTVDetailsParsesDetailsAndAggregateCredits verifica el parseo de una serie y su aggregate_credits.
// En español: comprueba que TVDetails deserializa las claves de TV y que el reparto acumulado
// (aggregate_credits) llega bien y es distinto del Credits simple, para que el mapper prefiera el
// acumulado. También confirma que se pide include_video_language en la query.
func TestTVDetailsParsesDetailsAndAggregateCredits(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		// El sub-recurso videos debe pedir varios idiomas para no perder tráilers en inglés.
		if includeLanguages := request.URL.Query().Get("include_video_language"); includeLanguages == "" {
			t.Errorf("include_video_language query is empty, want the language list")
		}
		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, tvDetailsFixture)
	}))
	defer server.Close()

	client := newTestClient(server)

	details, err := client.TVDetails(context.Background(), 1399)
	if err != nil {
		t.Fatalf("TVDetails returned an unexpected error: %v", err)
	}

	// Claves propias de TV.
	if details.Name != "La Casa del Dragón" {
		t.Errorf("Name = %q, want %q", details.Name, "La Casa del Dragón")
	}
	if details.FirstAirDate != "2026-06-01" {
		t.Errorf("FirstAirDate = %q, want %q", details.FirstAirDate, "2026-06-01")
	}

	// El reparto acumulado debe estar presente y traer a Matt Smith.
	if len(details.AggregateCredits.Cast) != 1 || details.AggregateCredits.Cast[0].Name != "Matt Smith" {
		t.Errorf("AggregateCredits.Cast = %+v, want single member Matt Smith", details.AggregateCredits.Cast)
	}
	// El Credits simple también se deserializa, pero con el actor de relleno (para verificar que el
	// mapper sabe distinguir ambas fuentes).
	if len(details.Credits.Cast) != 1 || details.Credits.Cast[0].Name != "Relleno" {
		t.Errorf("Credits.Cast = %+v, want single filler member", details.Credits.Cast)
	}
}

// collectionFixture es el detalle de mentira de una saga con dos entradas.
// En español: lo usa la prueba de CollectionDetails para confirmar el parseo de las partes.
const collectionFixture = `{
	"id": 10,
	"name": "Colección Toy Story",
	"parts": [
		{"title": "Toy Story", "release_date": "1995-11-22", "poster_path": "/ts1.jpg"},
		{"title": "Toy Story 2", "release_date": "1999-11-24", "poster_path": "/ts2.jpg"}
	]
}`

// TestCollectionDetailsParsesParts verifica el parseo del detalle de una saga.
// En español: comprueba que CollectionDetails deserializa el nombre de la saga y sus entradas
// (título y fecha de cada parte), que el seedgen usa para llenar los items de la colección.
func TestCollectionDetailsParsesParts(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, collectionFixture)
	}))
	defer server.Close()

	client := newTestClient(server)

	collection, err := client.CollectionDetails(context.Background(), 10)
	if err != nil {
		t.Fatalf("CollectionDetails returned an unexpected error: %v", err)
	}

	if collection.Name != "Colección Toy Story" {
		t.Errorf("Name = %q, want %q", collection.Name, "Colección Toy Story")
	}
	if len(collection.Parts) != 2 {
		t.Fatalf("Parts has %d entries, want 2", len(collection.Parts))
	}
	if collection.Parts[0].Title != "Toy Story" || collection.Parts[0].ReleaseDate != "1995-11-22" {
		t.Errorf("Parts[0] = %+v, want {Toy Story, 1995-11-22}", collection.Parts[0])
	}
}

// TestDoGETReturnsErrorOnNon2xx verifica que un estado fuera de 2xx (que no sea 429) produce error.
// En español: el servidor falso responde 500; el cliente NO debe reintentar (eso es solo para 429) y
// debe devolver un error con el código. Comprobamos que MovieDetails propaga ese error.
func TestDoGETReturnsErrorOnNon2xx(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusInternalServerError)
		writeBody(t, responseWriter, `{"status_message":"boom"}`)
	}))
	defer server.Close()

	client := newTestClient(server)

	_, err := client.MovieDetails(context.Background(), 862)
	if err == nil {
		t.Fatal("MovieDetails returned nil error, want an error for HTTP 500")
	}
	// El error debe mencionar el código 500 (sin volcar el token).
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("error %q, want it to mention status 500", err.Error())
	}
	if strings.Contains(err.Error(), testReadToken) {
		t.Errorf("error %q must not contain the token", err.Error())
	}
}

// TestWithLanguageAndRegionAreApplied verifica que las opciones de idioma y región llegan a la query.
// En español: creamos un cliente con WithLanguage y WithRegion personalizados y comprobamos que esos
// valores (no los por defecto) viajan en los parámetros language/region de la petición.
func TestWithLanguageAndRegionAreApplied(t *testing.T) {
	t.Parallel()

	const customLanguage = "fr-FR"
	const customRegion = "FR"

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if language := request.URL.Query().Get("language"); language != customLanguage {
			t.Errorf("language query = %q, want %q", language, customLanguage)
		}
		if region := request.URL.Query().Get("region"); region != customRegion {
			t.Errorf("region query = %q, want %q", region, customRegion)
		}
		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, movieDetailsFixture)
	}))
	defer server.Close()

	client := NewClient(
		testReadToken,
		WithBaseURL(server.URL),
		WithHTTPClient(server.Client()),
		WithLanguage(customLanguage),
		WithRegion(customRegion),
	)

	if _, err := client.MovieDetails(context.Background(), 862); err != nil {
		t.Fatalf("MovieDetails returned an unexpected error: %v", err)
	}
}

// TestParseRetryAfter verifica la interpretación de la cabecera Retry-After en sus dos formatos.
// En español: cubre el entero de segundos (incluido 0 = reintento inmediato), una fecha HTTP futura
// (esperar hasta ella), una fecha ya pasada (esperar 0), la cabecera vacía y basura (no válida).
func TestParseRetryAfter(t *testing.T) {
	t.Parallel()

	// Punto de referencia fijo para que el formato fecha sea determinista.
	now := time.Date(2026, time.May, 30, 12, 0, 0, 0, time.UTC)

	// Entero de segundos positivo.
	if gotWait, gotValid := parseRetryAfter("5", now); !gotValid || gotWait != 5*time.Second {
		t.Errorf("parseRetryAfter(\"5\") = (%v, %v), want (5s, true)", gotWait, gotValid)
	}

	// Entero 0: válido y con espera 0 (reintento inmediato), NO el backoff fijo.
	if gotWait, gotValid := parseRetryAfter("0", now); !gotValid || gotWait != 0 {
		t.Errorf("parseRetryAfter(\"0\") = (%v, %v), want (0, true)", gotWait, gotValid)
	}

	// Entero negativo: no válido (el llamador usará el backoff de respaldo).
	if _, gotValid := parseRetryAfter("-3", now); gotValid {
		t.Error("parseRetryAfter(\"-3\") reported valid, want invalid")
	}

	// Fecha HTTP futura (now + 30s): espera ~30s.
	futureDate := now.Add(30 * time.Second).Format(http.TimeFormat)
	if gotWait, gotValid := parseRetryAfter(futureDate, now); !gotValid || gotWait != 30*time.Second {
		t.Errorf("parseRetryAfter(future date) = (%v, %v), want (30s, true)", gotWait, gotValid)
	}

	// Fecha HTTP ya pasada: válida pero con espera 0 (no esperamos en el pasado).
	pastDate := now.Add(-1 * time.Hour).Format(http.TimeFormat)
	if gotWait, gotValid := parseRetryAfter(pastDate, now); !gotValid || gotWait != 0 {
		t.Errorf("parseRetryAfter(past date) = (%v, %v), want (0, true)", gotWait, gotValid)
	}

	// Cabecera vacía: no válida.
	if _, gotValid := parseRetryAfter("", now); gotValid {
		t.Error("parseRetryAfter(\"\") reported valid, want invalid")
	}

	// Basura: no válida.
	if _, gotValid := parseRetryAfter("not-a-date", now); gotValid {
		t.Error("parseRetryAfter(\"not-a-date\") reported valid, want invalid")
	}
}

// TestDiscoverMoviesPaginates verifica que DiscoverMovies recorre todas las páginas disponibles.
// En español: el servidor falso reporta total_pages=2 y devuelve ids distintos en cada página; la
// prueba comprueba que el cliente pide ambas páginas (page=1 y page=2) y junta los ids de las dos.
func TestDiscoverMoviesPaginates(t *testing.T) {
	t.Parallel()

	// requestedPages recuerda qué números de página pidió el cliente (para verificar que pidió ambas).
	var requestedPages []string

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		page := request.URL.Query().Get("page")
		requestedPages = append(requestedPages, page)

		responseWriter.WriteHeader(http.StatusOK)
		// La página 2 trae ids distintos; ambas reportan total_pages=2 para forzar dos vueltas.
		switch page {
		case "2":
			writeBody(t, responseWriter, `{"page": 2, "total_pages": 2, "results": [{"id": 303}, {"id": 404}]}`)
		default:
			// page=1 (o ausente): primera página.
			writeBody(t, responseWriter, `{"page": 1, "total_pages": 2, "results": [{"id": 101}, {"id": 202}]}`)
		}
	}))
	defer server.Close()

	client := newTestClient(server)

	movieIDs, err := client.DiscoverMovies(context.Background(), 2026, 6)
	if err != nil {
		t.Fatalf("DiscoverMovies returned an unexpected error: %v", err)
	}

	// Deben venir los ids de las DOS páginas en orden.
	wantIDs := []int{101, 202, 303, 404}
	if len(movieIDs) != len(wantIDs) {
		t.Fatalf("DiscoverMovies returned %d ids %v, want %d %v", len(movieIDs), movieIDs, len(wantIDs), wantIDs)
	}
	for index, wantID := range wantIDs {
		if movieIDs[index] != wantID {
			t.Errorf("movieIDs[%d] = %d, want %d", index, movieIDs[index], wantID)
		}
	}

	// Deben haberse pedido exactamente dos páginas: "1" y "2".
	if len(requestedPages) != 2 || requestedPages[0] != "1" || requestedPages[1] != "2" {
		t.Errorf("requested pages = %v, want [1 2]", requestedPages)
	}
}

// TestDiscoverSkipsUnreadableEntriesInsteadOfFailing es la prueba del degradado del descubrimiento.
//
// EL FALLO QUE VIGILA, en español: TMDB devuelve el identificador como número, pero se observó una
// respuesta con el identificador entrecomillado ("id":"842", texto donde se espera número). Con la
// lectura de una sola pieza, esa comilla no costaba una película: tumbaba la generación COMPLETA del
// catálogo, porque el error subía hasta arriba y detenía el mes entero. Y era incoherente con el
// resto de la herramienta: el detalle de una película sí sabía saltarse la que fallaba y seguir.
//
// Aquí la página trae dos entradas buenas, una con el id entrecomillado y una sin id utilizable. Lo
// que se exige es que salgan las dos buenas y que no haya error.
func TestDiscoverSkipsUnreadableEntriesInsteadOfFailing(t *testing.T) {
	t.Parallel()

	const pageWithABadEntry = `{
		"total_pages": 1,
		"results": [
			{"id": 101, "title": "La buena"},
			{"id": "842", "title": "La del id entrecomillado"},
			{"title": "La que no trae id"},
			{"id": 303, "title": "La otra buena"}
		]
	}`

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, pageWithABadEntry)
	}))
	defer server.Close()

	client := newTestClient(server)
	client.logger = silentTestLogger()

	movieIDs, err := client.DiscoverMovies(context.Background(), 2026, 6)
	if err != nil {
		t.Fatalf("DiscoverMovies returned an error: %v; one bad entry must not stop the whole generation", err)
	}

	wantIDs := []int{101, 303}
	if len(movieIDs) != len(wantIDs) {
		t.Fatalf("DiscoverMovies returned %v, want %v (the readable entries)", movieIDs, wantIDs)
	}
	for index, wantID := range wantIDs {
		if movieIDs[index] != wantID {
			t.Errorf("movieIDs[%d] = %d, want %d", index, movieIDs[index], wantID)
		}
	}
}

// TestDiscoverStillFailsWhenTheWholeAnswerIsUnreadable marca el otro lado de la frontera.
// En español: tolerar entradas sueltas rotas no significa tragarse cualquier cosa. Si la respuesta
// entera no es lo que esperamos, ya no es una película mal formada: es que no estamos hablando con
// TMDB, y eso sí tiene que detener la generación con un error.
func TestDiscoverStillFailsWhenTheWholeAnswerIsUnreadable(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
		writeBody(t, responseWriter, "esto no es JSON en absoluto")
	}))
	defer server.Close()

	client := newTestClient(server)
	client.logger = silentTestLogger()

	if _, err := client.DiscoverMovies(context.Background(), 2026, 6); err == nil {
		t.Fatal("DiscoverMovies returned nil error for an unreadable answer, want an error")
	}
}

// TestDoGETRefusesAnOversizedBody comprueba el tope de tamaño de respuesta.
//
// En español: sin tope, el cliente leía y analizaba lo que fuera que llegara por la conexión (se
// midieron 27 MB tragados sin una queja), lo que convierte cualquier respuesta anómala en un consumo
// de memoria sin techo. Ahora la lectura se corta en maxResponseBytes y se devuelve un error que
// nombra el límite, en vez de analizar un JSON cortado por la mitad como si estuviera completo.
func TestDoGETRefusesAnOversizedBody(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
		// Se manda un byte más que el tope: lo mínimo para pasarse.
		oversized := make([]byte, maxResponseBytes+1)
		for index := range oversized {
			oversized[index] = 'a'
		}
		_, _ = responseWriter.Write(oversized)
	}))
	defer server.Close()

	client := newTestClient(server)

	_, err := client.doGET(context.Background(), "/configuration", url.Values{})
	if err == nil {
		t.Fatal("doGET returned nil error for an oversized body, want an error")
	}
	if !strings.Contains(err.Error(), "exceeds") {
		t.Errorf("error = %v, want it to mention that the size limit was exceeded", err)
	}
}

// silentTestLogger devuelve un registrador que no imprime nada, para que los avisos previstos de
// estas pruebas no ensucien la salida.
func silentTestLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
}
