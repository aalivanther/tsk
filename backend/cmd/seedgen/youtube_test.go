// Archivo: youtube_test.go — Pruebas de la verificación de videos y de la clasificación de canales.
//
// En español: aquí se comprueba la pieza que decide si un tráiler entra al catálogo o se queda fuera.
// Es lógica delicada: si se equivoca por exceso, la persona ve una caja negra; si se equivoca por
// defecto, se borran tráilers que funcionaban. Las pruebas usan un servidor de mentira que responde
// lo mismo que YouTube (200, 401, 403, 404) y, sobre todo, uno que FALLA las primeras veces y luego
// responde bien, para demostrar que los reintentos hacen su trabajo.

package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// silentLogger devuelve un registrador que no imprime nada, para no ensuciar la salida de las pruebas.
func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
}

// TestAttemptOEmbedTranslatesEveryAnswer verifica que cada respuesta de YouTube se traduce bien.
// En español: es la tabla de equivalencias completa. Un 200 significa "sí se puede incrustar" y trae
// el nombre del canal; un 403 significa "es privado"; un 401, "el dueño prohibió incrustarlo"; un
// 404, "ya no existe". Los tres últimos son los que hoy producen la caja negra en la aplicación.
func TestAttemptOEmbedTranslatesEveryAnswer(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name           string
		statusCode     int
		body           string
		wantPlayable   bool
		wantVerifiable bool
		wantChannel    string
		wantReason     string
		wantOutcome    oEmbedOutcome
		wantTransient  bool
	}{
		{
			name:           "video incrustable con canal",
			statusCode:     http.StatusOK,
			body:           `{"author_name":"Warner Bros. Pictures"}`,
			wantPlayable:   true,
			wantVerifiable: true,
			wantChannel:    "Warner Bros. Pictures",
			wantOutcome:    oEmbedOutcomeDecided,
		},
		{
			// El 403 NO es un veredicto por sí solo: puede ser un video privado o un bloqueo antibot.
			// Por eso sale con su propio resultado, que obliga a preguntar una segunda vez.
			name:           "video privado o bloqueo antibot: hay que repetir",
			statusCode:     http.StatusForbidden,
			body:           "",
			wantVerifiable: true,
			wantReason:     discardReasonPrivate,
			wantOutcome:    oEmbedOutcomeForbidden,
		},
		{
			name:           "incrustacion prohibida por el dueno",
			statusCode:     http.StatusUnauthorized,
			body:           "",
			wantVerifiable: true,
			wantReason:     discardReasonEmbeddingDisabled,
			wantOutcome:    oEmbedOutcomeDecided,
		},
		{
			name:           "video borrado",
			statusCode:     http.StatusNotFound,
			body:           "",
			wantVerifiable: true,
			wantReason:     discardReasonNotFound,
			wantOutcome:    oEmbedOutcomeDecided,
		},
		{
			name:           "peticion rechazada",
			statusCode:     http.StatusBadRequest,
			body:           "",
			wantVerifiable: true,
			wantReason:     discardReasonBadRequest,
			wantOutcome:    oEmbedOutcomeDecided,
		},
		{
			name:          "servidor con problemas: se reintenta",
			statusCode:    http.StatusServiceUnavailable,
			body:          "",
			wantOutcome:   oEmbedOutcomeRetryable,
			wantTransient: true,
		},
		{
			name:          "nos piden bajar el ritmo: se reintenta",
			statusCode:    http.StatusTooManyRequests,
			body:          "",
			wantOutcome:   oEmbedOutcomeRetryable,
			wantTransient: true,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(testCase.statusCode)
				_, _ = writer.Write([]byte(testCase.body))
			}))
			defer server.Close()

			check, outcome, transientError := attemptOEmbed(t.Context(), server.Client(), server.URL)

			if outcome != testCase.wantOutcome {
				t.Fatalf("outcome = %v, want %v", outcome, testCase.wantOutcome)
			}
			if testCase.wantTransient && transientError == nil {
				t.Fatal("transientError is nil, want a retryable error")
			}
			if testCase.wantOutcome == oEmbedOutcomeRetryable {
				return
			}
			if check.verifiable != testCase.wantVerifiable {
				t.Errorf("verifiable = %v, want %v", check.verifiable, testCase.wantVerifiable)
			}
			if check.playable != testCase.wantPlayable {
				t.Errorf("playable = %v, want %v", check.playable, testCase.wantPlayable)
			}
			if check.channel != testCase.wantChannel {
				t.Errorf("channel = %q, want %q", check.channel, testCase.wantChannel)
			}
			if check.discardReason != testCase.wantReason {
				t.Errorf("discardReason = %q, want %q", check.discardReason, testCase.wantReason)
			}
		})
	}
}

// TestOneForbiddenAnswerDoesNotCondemnAVideo es la prueba del bloqueo antibot.
//
// En español: YouTube contesta 403 tanto cuando un video es privado como cuando decide que le
// estamos preguntando demasiado. Antes, un solo 403 borraba el tráiler para siempre y además lo
// apuntaba como "privado", así que ni siquiera quedaba constancia de que había sido un problema de
// red. Aquí el servidor responde 403 UNA vez y a la siguiente contesta con normalidad: el video
// tiene que sobrevivir.
func TestOneForbiddenAnswerDoesNotCondemnAVideo(t *testing.T) {
	t.Parallel()

	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		if attempts.Add(1) == 1 {
			writer.WriteHeader(http.StatusForbidden)
			return
		}
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"author_name":"A24"}`))
	}))
	defer server.Close()

	check := checkSingleVideoKeyAt(t.Context(), server.Client(), server.URL, "anyKey")

	if !check.playable {
		t.Fatalf("playable = false (reason %q), want true: one 403 can be an antibot block", check.discardReason)
	}
	if got := attempts.Load(); got != 2 {
		t.Errorf("the server was called %d times, want 2 (the 403 plus the good answer)", got)
	}
}

// TestTwoForbiddenAnswersMeanThePrivateVideoIsReal comprueba la otra mitad de la regla del 403.
// En español: si el "prohibido" se repite después de esperar, ya no es un bloqueo pasajero: el video
// es privado de verdad y sí se descarta. Sin esta mitad, un video privado no se quitaría nunca.
func TestTwoForbiddenAnswersMeanThePrivateVideoIsReal(t *testing.T) {
	t.Parallel()

	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		writer.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	check := checkSingleVideoKeyAt(t.Context(), server.Client(), server.URL, "anyKey")

	if check.playable {
		t.Fatal("playable = true, want false for a video that answers 403 twice in a row")
	}
	if !check.verifiable {
		t.Error("verifiable = false, want true: two 403 in a row are a firm answer")
	}
	if check.discardReason != discardReasonPrivate {
		t.Errorf("discardReason = %q, want %q", check.discardReason, discardReasonPrivate)
	}
	if got := attempts.Load(); got != oEmbedForbiddenAttemptsBeforeGivingUp {
		t.Errorf("the server was called %d times, want %d", got, oEmbedForbiddenAttemptsBeforeGivingUp)
	}
}

// TestCheckSingleVideoKeyRetriesTransientFailures es LA prueba que justifica los reintentos.
//
// En español: reproduce exactamente el fallo que se midió contra YouTube. Un servidor que corta las
// dos primeras peticiones y a la tercera responde con normalidad. Sin reintentos, ese video se daría
// por muerto y se borraría del catálogo aunque estuviera perfectamente. Con reintentos, se recupera.
func TestCheckSingleVideoKeyRetriesTransientFailures(t *testing.T) {
	t.Parallel()

	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		// Las dos primeras peticiones fallan como si la conexión se hubiera saturado.
		if attempts.Add(1) <= 2 {
			writer.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"author_name":"Netflix"}`))
	}))
	defer server.Close()

	check := checkSingleVideoKeyAt(t.Context(), server.Client(), server.URL, "anyKey")

	if !check.playable {
		t.Fatalf("playable = false (reason %q), want true: retries must recover a transient failure",
			check.discardReason)
	}
	if check.channel != "Netflix" {
		t.Errorf("channel = %q, want %q", check.channel, "Netflix")
	}
	if got := attempts.Load(); got != 3 {
		t.Errorf("the server was called %d times, want 3 (two failures plus the good one)", got)
	}
}

// TestCheckSingleVideoKeyGivesUpAfterAllAttempts verifica que no se insiste para siempre.
//
// En español: si el servicio no responde nunca, se deja de intentar, pero —y esto es lo importante—
// el resultado NO afirma nada sobre el video: sale marcado como "no se pudo comprobar" (verifiable
// en false), que es lo que hace que quien llama lo conserve en vez de borrarlo.
func TestCheckSingleVideoKeyGivesUpAfterAllAttempts(t *testing.T) {
	t.Parallel()

	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		writer.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	check := checkSingleVideoKeyAt(t.Context(), server.Client(), server.URL, "anyKey")

	if check.playable {
		t.Fatal("playable = true, want false when the service never answers")
	}
	if check.verifiable {
		t.Fatal("verifiable = true, want false: a service that never answers proves nothing about the video")
	}
	if check.discardReason != discardReasonUnverifiable {
		t.Errorf("discardReason = %q, want the plain category %q", check.discardReason, discardReasonUnverifiable)
	}
	if got := attempts.Load(); got != oEmbedMaxAttempts {
		t.Errorf("the server was called %d times, want %d", got, oEmbedMaxAttempts)
	}
}

// TestDiscardReasonsStayCategoriesNotOneKeyPerVideo protege el resumen de descartes.
//
// EL DEFECTO QUE VIGILA, en español: el motivo del descarte se usa como CLAVE para agrupar el
// resumen final ("privados: 3, borrados: 12"). Cuando en ese motivo se metía el mensaje del fallo
// —que lleva dentro la dirección consultada, distinta para cada video—, cada video estrenaba su
// propia categoría: 20 videos producían 20 motivos, y el resumen que prometía evitar leer mil líneas
// imprimía 1518. Esta prueba comprueba veinte videos contra un servicio caído y exige que salga UNA
// sola categoría.
func TestDiscardReasonsStayCategoriesNotOneKeyPerVideo(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	// Se consultan de golpe (con el mismo reparto en paralelo que usa el generador) para que la
	// prueba no tarde tantas esperas de reintento como videos.
	keys := make([]string, 0, oEmbedMaxConcurrency)
	for index := range oEmbedMaxConcurrency {
		keys = append(keys, fmt.Sprintf("key%02d", index))
	}
	checks := checkVideoKeysAt(t.Context(), silentLogger(), keys, server.URL)

	reasons := make(map[string]bool)
	for key, check := range checks {
		reasons[check.discardReason] = true
		if strings.Contains(check.discardReason, "http") {
			t.Fatalf("the reason for %q is %q and contains a URL; the reason must be a category",
				key, check.discardReason)
		}
		// El fallo concreto no se pierde: vive aparte, en el detalle, que sí puede ser distinto por
		// video porque nunca se usa para agrupar.
		if check.discardDetail == "" {
			t.Errorf("the check for %q has no detail; the concrete failure must still be reported", key)
		}
	}

	if len(reasons) != 1 {
		t.Errorf("%d videos produced %d different reasons, want 1 category", len(keys), len(reasons))
	}
}

// TestVerifyAndFilterVideosRemovesWhatDoesNotPlay es la prueba de la promesa completa.
//
// En español: un catálogo con tres videos —uno sano, uno privado y uno con la incrustación
// prohibida— tiene que salir de aquí con UN solo video, el sano, con su canal ya clasificado y con la
// fecha de verificación puesta. Los otros dos no pueden llegar al navegador de nadie.
func TestVerifyAndFilterVideosRemovesWhatDoesNotPlay(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Query().Get("url") {
		case youTubeWatchURLPrefix + "goodKey":
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(`{"author_name":"Pixar"}`))
		case youTubeWatchURLPrefix + "privateKey":
			writer.WriteHeader(http.StatusForbidden)
		default:
			writer.WriteHeader(http.StatusUnauthorized)
		}
	}))
	defer server.Close()

	releases := []*catalogv1.Release{
		{
			Id:    "una-pelicula-tmdb-1",
			Title: "Una película",
			Videos: []*catalogv1.Video{
				{YoutubeKey: "goodKey", Kind: catalogv1.VideoKind_VIDEO_KIND_TRAILER},
				{YoutubeKey: "privateKey", Kind: catalogv1.VideoKind_VIDEO_KIND_TRAILER},
				{YoutubeKey: "noEmbedKey", Kind: catalogv1.VideoKind_VIDEO_KIND_TEASER},
			},
		},
		{
			Id:     "sin-videos-tmdb-2",
			Title:  "Sin videos",
			Videos: nil,
		},
	}

	stats := verifyVideosWithEndpoint(t.Context(), silentLogger(), releases, "2026-07-29", server.URL)

	if len(releases[0].GetVideos()) != 1 {
		t.Fatalf("the release kept %d videos, want 1 (only the one that plays)", len(releases[0].GetVideos()))
	}
	survivor := releases[0].GetVideos()[0]
	if survivor.GetYoutubeKey() != "goodKey" {
		t.Errorf("the surviving video is %q, want %q", survivor.GetYoutubeKey(), "goodKey")
	}
	if !survivor.GetPlayable() {
		t.Error("the surviving video is not marked as playable")
	}
	if survivor.GetChannel() != "Pixar" {
		t.Errorf("channel = %q, want %q", survivor.GetChannel(), "Pixar")
	}
	if survivor.GetChannelKind() != catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR {
		t.Errorf("channelKind = %v, want DISTRIBUTOR", survivor.GetChannelKind())
	}
	if survivor.GetVerifiedAt() != "2026-07-29" {
		t.Errorf("verifiedAt = %q, want %q", survivor.GetVerifiedAt(), "2026-07-29")
	}

	if stats.kept != 1 {
		t.Errorf("stats.kept = %d, want 1", stats.kept)
	}
	if stats.discarded != 2 {
		t.Errorf("stats.discarded = %d, want 2", stats.discarded)
	}
	if stats.discardedByReason[discardReasonPrivate] != 1 {
		t.Errorf("private discards = %d, want 1", stats.discardedByReason[discardReasonPrivate])
	}
	if stats.discardedByReason[discardReasonEmbeddingDisabled] != 1 {
		t.Errorf("embedding-disabled discards = %d, want 1",
			stats.discardedByReason[discardReasonEmbeddingDisabled])
	}
	if stats.releasesWithVideo != 1 {
		t.Errorf("stats.releasesWithVideo = %d, want 1", stats.releasesWithVideo)
	}
}

// TestNetworkOutageDoesNotEmptyTheCatalog es LA prueba de este arreglo, y reproduce exactamente el
// escenario destructivo que se midió.
//
// En español: diez fichas, veinte tráilers, todos perfectamente sanos, y el servicio de comprobación
// de YouTube CAÍDO (el servidor se cierra antes de empezar, así que ninguna consulta llega). Antes,
// el resultado era kept=0 y discarded=20: los veinte tráilers se borraban del catálogo, el archivo
// se escribía igual y el programa terminaba diciendo que todo había ido bien. Ahora tienen que
// conservarse los veinte, y la guarda tiene que impedir que ese resultado llegue al disco.
func TestNetworkOutageDoesNotEmptyTheCatalog(t *testing.T) {
	t.Parallel()

	// Un servidor que se cierra de inmediato: su dirección ya no acepta conexiones. Es la forma más
	// fiel de simular "no hay red" sin depender de la red de verdad.
	deadServer := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadEndpoint := deadServer.URL
	deadServer.Close()

	const (
		releaseCount   = 10
		videosPerFilm  = 2
		expectedVideos = releaseCount * videosPerFilm
	)

	releases := make([]*catalogv1.Release, 0, releaseCount)
	for releaseIndex := range releaseCount {
		videos := make([]*catalogv1.Video, 0, videosPerFilm)
		for videoIndex := range videosPerFilm {
			videos = append(videos, &catalogv1.Video{
				YoutubeKey: fmt.Sprintf("key-%02d-%d", releaseIndex, videoIndex),
				Kind:       catalogv1.VideoKind_VIDEO_KIND_TRAILER,
				// Estos dos campos simulan un video que YA se había verificado en una corrida anterior:
				// lo que se exige es que ese sello NO se pierda por un corte de red de hoy.
				Playable:   true,
				VerifiedAt: "2026-07-01",
			})
		}
		releases = append(releases, &catalogv1.Release{
			Id:     fmt.Sprintf("pelicula-%02d", releaseIndex),
			Title:  fmt.Sprintf("Película %02d", releaseIndex),
			Videos: videos,
		})
	}

	stats := verifyVideosWithEndpoint(t.Context(), silentLogger(), releases, "2026-08-02", deadEndpoint)

	// 1) Ni un solo video se ha perdido.
	survivingVideos := 0
	for _, release := range releases {
		survivingVideos += len(release.GetVideos())
		for _, video := range release.GetVideos() {
			if video.GetVerifiedAt() != "2026-07-01" {
				t.Errorf("video %q lost its previous verifiedAt: got %q, want %q",
					video.GetYoutubeKey(), video.GetVerifiedAt(), "2026-07-01")
			}
		}
	}
	if survivingVideos != expectedVideos {
		t.Fatalf("the catalog kept %d videos, want %d: a network outage must not delete trailers",
			survivingVideos, expectedVideos)
	}

	// 2) Los números lo dicen con claridad: nada descartado, todo conservado sin verificar.
	if stats.discarded != 0 {
		t.Errorf("stats.discarded = %d, want 0", stats.discarded)
	}
	if stats.kept != 0 {
		t.Errorf("stats.kept = %d, want 0 (nothing could be verified)", stats.kept)
	}
	if stats.preserved != expectedVideos {
		t.Errorf("stats.preserved = %d, want %d", stats.preserved, expectedVideos)
	}
	if stats.unverifiableKeys != expectedVideos {
		t.Errorf("stats.unverifiableKeys = %d, want %d", stats.unverifiableKeys, expectedVideos)
	}

	// 3) Y, sobre todo, ese resultado NO puede llegar al disco.
	if err := guardVideoVerificationHealth(t.Context(), stats); err == nil {
		t.Fatal("guardVideoVerificationHealth returned nil; a full outage must refuse to write the seed")
	}
}

// TestGuardVideoVerificationHealth comprueba dónde está exactamente la frontera de la guarda.
//
// En español: la guarda no puede ser tan estricta que un tropiezo suelto tumbe una generación buena,
// ni tan laxa que deje pasar un apagón. Aquí se fijan los tres casos que definen esa frontera.
func TestGuardVideoVerificationHealth(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name             string
		uniqueKeys       int
		unverifiableKeys int
		wantError        bool
	}{
		{name: "todo comprobado", uniqueKeys: 400, unverifiableKeys: 0, wantError: false},
		{name: "un tropiezo suelto (0,25 %)", uniqueKeys: 400, unverifiableKeys: 1, wantError: false},
		{name: "justo en el limite (5 %)", uniqueKeys: 400, unverifiableKeys: 20, wantError: false},
		{name: "un video por encima del limite", uniqueKeys: 400, unverifiableKeys: 21, wantError: true},
		{name: "apagon completo", uniqueKeys: 400, unverifiableKeys: 400, wantError: true},
		{name: "catalogo sin videos", uniqueKeys: 0, unverifiableKeys: 0, wantError: false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			stats := videoAuditStats{
				uniqueKeys:       testCase.uniqueKeys,
				unverifiableKeys: testCase.unverifiableKeys,
			}
			err := guardVideoVerificationHealth(t.Context(), stats)
			if testCase.wantError && err == nil {
				t.Fatalf("guardVideoVerificationHealth = nil, want an error (%d of %d unverifiable)",
					testCase.unverifiableKeys, testCase.uniqueKeys)
			}
			if !testCase.wantError && err != nil {
				t.Fatalf("guardVideoVerificationHealth = %v, want nil", err)
			}
		})
	}
}

// TestGuardVideoVerificationHealthRefusesAfterCancellation cubre el otro motivo para no escribir.
// En español: si se agotó el plazo total o alguien canceló la ejecución, media generación no llegó
// ni a intentarse. El archivo que saldría estaría incompleto por razones que nada tienen que ver con
// el catálogo, así que no se escribe aunque los números de la verificación parezcan buenos.
func TestGuardVideoVerificationHealthRefusesAfterCancellation(t *testing.T) {
	t.Parallel()

	cancelledContext, cancel := context.WithCancel(t.Context())
	cancel()

	stats := videoAuditStats{uniqueKeys: 400, unverifiableKeys: 0}
	if err := guardVideoVerificationHealth(cancelledContext, stats); err == nil {
		t.Fatal("guardVideoVerificationHealth = nil, want an error when the context is cancelled")
	}
}

// TestCheckVideoKeysNeverExceedsTheConcurrencyCap es la prueba del número 6.
//
// En español: el tope de seis peticiones simultáneas no es una preferencia, es lo que evita que
// YouTube corte las conexiones y el generador borre tráilers buenos creyéndolos rotos. Esta prueba
// cuenta cuántas peticiones hay abiertas A LA VEZ y falla si alguna vez pasan de seis.
func TestCheckVideoKeysNeverExceedsTheConcurrencyCap(t *testing.T) {
	t.Parallel()

	var inFlightMutex sync.Mutex
	inFlight := 0
	maxObserved := 0

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		inFlightMutex.Lock()
		inFlight++
		if inFlight > maxObserved {
			maxObserved = inFlight
		}
		inFlightMutex.Unlock()

		// Una pausa mínima para que las peticiones se solapen de verdad y la medición signifique algo.
		time.Sleep(20 * time.Millisecond)

		inFlightMutex.Lock()
		inFlight--
		inFlightMutex.Unlock()

		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"author_name":"Canal"}`))
	}))
	defer server.Close()

	keys := make([]string, 0, 40)
	for index := range 40 {
		keys = append(keys, "key"+string(rune('a'+index%26))+string(rune('0'+index/26)))
	}

	checks := checkVideoKeysAt(t.Context(), silentLogger(), keys, server.URL)

	if len(checks) != len(keys) {
		t.Fatalf("got %d verdicts, want %d (one per video)", len(checks), len(keys))
	}
	inFlightMutex.Lock()
	observed := maxObserved
	inFlightMutex.Unlock()
	if observed > oEmbedMaxConcurrency {
		t.Errorf("there were %d simultaneous requests, the cap is %d", observed, oEmbedMaxConcurrency)
	}
}

// TestCollectUniqueVideoKeysDeduplicatesAndSorts verifica el recuento de videos a comprobar.
// En español: el mismo tráiler puede aparecer en dos fichas; comprobarlo dos veces gastaría una
// petición de más. Además la lista sale ordenada para que dos corridas del generador recorran los
// videos en el mismo orden y sus registros se puedan comparar.
func TestCollectUniqueVideoKeysDeduplicatesAndSorts(t *testing.T) {
	t.Parallel()

	releases := []*catalogv1.Release{
		{Videos: []*catalogv1.Video{{YoutubeKey: "zeta"}, {YoutubeKey: "alfa"}}},
		{Videos: []*catalogv1.Video{{YoutubeKey: "alfa"}, {YoutubeKey: ""}}},
		{Videos: nil},
	}

	keys := collectUniqueVideoKeys(releases)

	want := []string{"alfa", "zeta"}
	if len(keys) != len(want) {
		t.Fatalf("collectUniqueVideoKeys returned %v, want %v", keys, want)
	}
	for index, wantKey := range want {
		if keys[index] != wantKey {
			t.Errorf("keys[%d] = %q, want %q", index, keys[index], wantKey)
		}
	}
}
