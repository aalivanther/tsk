// Archivo: youtube.go — Verificación REAL de que cada video existe y se puede incrustar.
//
// En español: hasta ahora el catálogo guardaba el código de un video de YouTube y se olvidaba. Nadie
// comprobaba nunca que ese video siguiera vivo. El resultado es el defecto que reportó el dueño: se
// abre la ficha y aparece una caja negra que dice "Este video es privado". Medido sobre el catálogo
// anterior: de 447 códigos guardados, 3 eran privados y 1 tenía la incrustación prohibida. Son pocos
// hoy, pero el número solo crece: cada semana algún estudio despublica un tráiler.
//
// La solución es preguntar antes de escribir. YouTube ofrece un servicio gratuito llamado oEmbed que,
// dado un video, responde con sus datos si se puede incrustar y con un error si no. De paso entrega
// algo que TMDB no da y que hace falta para elegir bien: EL NOMBRE DEL CANAL que lo publicó.
//
// LA REGLA ES ABSOLUTA: lo que no se comprueba que reproduce, NO SE MARCA COMO REPRODUCIBLE. Así el
// frontend no necesita adivinar nada: si un video le llega marcado, es porque alguien ya lo verificó.
//
// OJO CON LA VERSIÓN ANTERIOR DE ESA REGLA, que decía "lo que no se comprueba NO ENTRA": sonaba más
// estricta y era mucho peor. Trataba igual dos cosas distintas —"YouTube dice que este video está
// roto" y "no pude preguntarle a YouTube"— y borraba el video en ambos casos. El efecto medido: con
// el servicio de comprobación caído, un catálogo de 10 fichas con 20 tráilers sanos salía con
// kept=0, discarded=20, y el archivo se escribía igual con código de salida cero. Es decir, un corte
// de red de un par de minutos vaciaba de tráilers el catálogo entero sin que nada avisara. Hoy hay
// dos barreras: lo que no se pudo comprobar SE CONSERVA tal cual (sin marcarlo reproducible), y si
// los no comprobables pasan de una minoría el generador aborta SIN ESCRIBIR NADA.
//
// DETALLE OPERATIVO APRENDIDO A GOLPES, y es el error más fácil de cometer al implementar esto: en la
// primera medición se lanzaron 20 peticiones simultáneas y LAS 20 fallaron con error de conexión — no
// porque los videos estuvieran mal, sino por la ráfaga. Reintentadas de una en una, las 20 respondían
// que todo bien. Sin límite de concurrencia y sin reintentos, esta verificación produciría falsos
// negativos en masa y BORRARÍA TRÁILERS BUENOS del catálogo. Por eso el tope es 6 y hay reintentos.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"sync"
	"time"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// youTubeOEmbedEndpoint es el servicio gratuito de YouTube que describe un video incrustable.
// En español: no necesita clave ni registro; se le pasa la URL del video y responde en JSON.
const youTubeOEmbedEndpoint = "https://www.youtube.com/oembed"

// youTubeWatchURLPrefix es la forma de URL de video que oEmbed espera recibir.
const youTubeWatchURLPrefix = "https://www.youtube.com/watch?v="

// oEmbedMaxConcurrency es cuántas comprobaciones se hacen A LA VEZ, como máximo.
//
// SEIS, Y NO MÁS. En español: este número no es una preferencia estética, es el resultado de una
// medición. Con 20 peticiones en paralelo, YouTube cortó las 20 primeras conexiones; los mismos 20
// videos, consultados con calma, respondieron que estaban perfectamente. Subir este número vuelve a
// abrir esa puerta, y el daño no se ve: el generador no falla, simplemente borra tráilers que sí
// funcionaban.
const oEmbedMaxConcurrency = 6

// oEmbedMaxAttempts es cuántas veces se intenta una misma comprobación antes de darla por perdida.
// En español: cuatro intentos, porque los fallos que hemos visto son transitorios (la conexión se
// corta por la ráfaga) y desaparecen al segundo intento.
const oEmbedMaxAttempts = 4

// oEmbedRetryBaseDelay es la espera antes del PRIMER reintento; después se va duplicando.
// En español: espera creciente (500 ms, 1 s, 2 s). Darle tiempo al servidor es justamente lo que
// convierte un falso negativo en una respuesta correcta.
const oEmbedRetryBaseDelay = 500 * time.Millisecond

// oEmbedHTTPTimeout es lo máximo que esperamos por una respuesta de oEmbed.
const oEmbedHTTPTimeout = 10 * time.Second

// oEmbedForbiddenAttemptsBeforeGivingUp es cuántos "prohibido" (403) SEGUIDOS hacen falta para dar
// un video por privado.
//
// DOS, Y NO UNO. En español: YouTube usa el mismo código de respuesta (403) para dos cosas que no se
// parecen en nada. Una es "este video es privado", que es un hecho permanente. La otra es "creo que
// eres un robot y hoy no te contesto", que es un bloqueo temporal que aparece justo cuando el
// generador hace muchas consultas seguidas — es decir, exactamente durante `make seed`. Con un solo
// 403 bastando para condenar el video, un rato de bloqueo antibot borraba tráilers perfectamente
// vivos y además los apuntaba como "privados", así que ni siquiera quedaba rastro de que el problema
// había sido de red. Exigiendo dos 403 seguidos, con una espera creciente entre ellos, el bloqueo
// temporal se disuelve en la espera y solo el video realmente privado responde igual las dos veces.
const oEmbedForbiddenAttemptsBeforeGivingUp = 2

// maxOEmbedBodyBytes es lo máximo que se acepta leer de una respuesta de oEmbed.
//
// Por qué existe un tope, en español: la respuesta legítima de oEmbed es un JSON de unos cientos de
// bytes. Leer sin límite significa que cualquier cosa que responda en esa dirección —un portal
// cautivo de una red wifi, un proxy mal configurado, un servidor equivocado— puede hacer que el
// generador se trague cientos de megabytes en memoria. Con el tope, eso deja de ser posible: se
// corta la lectura y el video se trata como "no se pudo comprobar", que es la verdad.
const maxOEmbedBodyBytes = 64 * 1024

// maxUnverifiableVideoShare es qué proporción de videos SIN COMPROBAR se tolera antes de dar la
// generación por inválida.
//
// EL 5 %, Y ESTE NÚMERO ES UNA SALVAGUARDA, NO UN AJUSTE FINO. En español: si YouTube deja de
// responder a mitad de la generación —se cae la red, se agota el plazo, el servicio devuelve errores
// o nos bloquea—, el generador se queda sin poder comprobar nada. Sin esta guarda, el resultado era
// un catálogo entero con los videos apagados que se escribía en disco igual y con código de salida
// cero, o sea, "todo bien". Un corte de red de dos minutos podía dejar el producto sin un solo
// tráiler y nadie se enteraba. Con la guarda, en cuanto los no comprobables pasan de una minoría
// clara, el generador se detiene con un error y NO TOCA EL DISCO: el catálogo que ya estaba
// instalado sigue intacto. Un 5 % deja sitio de sobra a los tropiezos sueltos que siempre hay (un
// video que tarda de más, un corte puntual) sin dejar pasar un fallo general.
const maxUnverifiableVideoShare = 0.05

// isoDateLayout es el formato de fecha (AAAA-MM-DD) con el que se sella la verificación.
const isoDateLayout = "2006-01-02"

// Motivos de descarte. En español: son las claves con las que se cuenta y se registra POR QUÉ se cayó
// cada video, para que el informe de generación diga algo útil y no solo "se descartaron 12".
const (
	// discardReasonPrivate: el dueño puso el video en privado. oEmbed responde 403.
	discardReasonPrivate = "private video (403)"
	// discardReasonEmbeddingDisabled: el video existe pero prohíbe incrustarse en otras webs (401).
	discardReasonEmbeddingDisabled = "embedding disabled by owner (401)"
	// discardReasonNotFound: el video ya no existe (borrado). oEmbed responde 404.
	discardReasonNotFound = "video not found (404)"
	// discardReasonBadRequest: oEmbed rechaza la petición (400); en la práctica, código inválido.
	discardReasonBadRequest = "rejected by oembed (400)"
	// discardReasonUnverifiable: se agotaron los reintentos por fallos de red. NO sabemos si el video
	// está bien, así que NO SE BORRA: se conserva tal y como estaba (ver verifyVideosWithEndpoint).
	// Se cuenta aparte de los videos realmente rotos, para que un problema de red no se confunda nunca
	// con un catálogo deteriorado.
	discardReasonUnverifiable = "unverifiable after retries (network)"
	// discardReasonOversizedBody: en esa dirección contestó algo que no es oEmbed (un portal cautivo,
	// un proxy). Tampoco es un veredicto sobre el video: cuenta como "no se pudo comprobar".
	discardReasonOversizedBody = "unverifiable: response exceeded the size limit"
)

// unexpectedStatusReason arma el motivo de un código de respuesta que no sabemos interpretar.
//
// Por qué es una función y no un texto suelto, en español: los motivos se usan como CLAVE para
// agrupar el resumen final ("privados: 3, borrados: 12"). Si en la clave entrara algo que cambia de
// un video a otro —la dirección consultada, el mensaje del fallo—, cada video estrenaría su propia
// categoría y el resumen pasaría de cuatro líneas a una por video, que es justo lo que el resumen
// existe para evitar. El código de respuesta sí es una categoría legítima: hay un puñado de valores
// posibles, no uno por video.
func unexpectedStatusReason(statusCode int) string {
	return fmt.Sprintf("unexpected oembed status %d", statusCode)
}

// oEmbedOutcome es en qué quedó UN intento de consulta a oEmbed.
//
// En español: son las cuatro cosas que pueden pasar al preguntar por un video, y cada una lleva a
// una decisión distinta. Existen como valores con nombre —en vez de un simple "sí/no"— porque la
// diferencia entre "el video está roto" y "no pude preguntarlo" es la que decide si un tráiler se
// borra del catálogo o se conserva, y confundirlas fue exactamente el defecto que se corrigió.
type oEmbedOutcome int

const (
	// oEmbedOutcomeDecided: oEmbed contestó con un veredicto FIRME (se puede incrustar, o no existe,
	// o el dueño lo prohibió). Preguntar otra vez daría lo mismo.
	oEmbedOutcomeDecided oEmbedOutcome = iota
	// oEmbedOutcomeRetryable: el intento no concluyó nada por un fallo pasajero (conexión cortada,
	// 429, servidor con problemas). Se espera y se vuelve a intentar.
	oEmbedOutcomeRetryable
	// oEmbedOutcomeForbidden: llegó un 403, que significa "video privado" O "bloqueo antibot". Hace
	// falta repetirlo para distinguirlos (ver oEmbedForbiddenAttemptsBeforeGivingUp).
	oEmbedOutcomeForbidden
	// oEmbedOutcomeUnverifiable: el intento falló de una forma que no se arregla insistiendo, pero
	// que TAMPOCO dice nada del video (la dirección del servicio es inválida, contestó algo que no es
	// oEmbed). No se reintenta y el video se conserva sin verificar.
	oEmbedOutcomeUnverifiable
)

// oEmbedResponse es la parte de la respuesta de oEmbed que nos interesa.
// En español: oEmbed devuelve bastantes campos (miniatura, ancho, alto, HTML del reproductor); el
// único que el proyecto necesita es el nombre del canal, que TMDB no entrega por ningún lado.
type oEmbedResponse struct {
	// AuthorName es el nombre del canal de YouTube que publicó el video (ej. "Warner Bros.").
	AuthorName string `json:"author_name"`
}

// videoCheck es el veredicto sobre UN video: si se pudo comprobar, si se puede reproducir, de qué
// canal es y, si no se puede, por qué.
type videoCheck struct {
	// channel es el nombre del canal que lo publicó; vacío si no se pudo obtener.
	channel string
	// verifiable dice si oEmbed llegó a dar una respuesta FIRME sobre este video.
	//
	// Es el campo más importante de los cuatro, en español: separa "sé que este video no sirve" de
	// "no pude preguntar". Con false, playable no significa nada (no se sabe) y el video NO se toca:
	// se conserva en el catálogo exactamente como estaba, con la fecha de verificación que ya
	// tuviera. Sin esta distinción, un corte de red se traducía en un catálogo sin tráilers.
	verifiable bool
	// playable indica si el video existe, no es privado y permite incrustarse. Solo tiene sentido
	// cuando verifiable es true.
	playable bool
	// discardReason es la CATEGORÍA del descarte (una de las constantes de arriba), sin ningún dato
	// que cambie de un video a otro. Es lo que se cuenta en el resumen.
	discardReason string
	// discardDetail es el fallo concreto en texto libre (el mensaje de error, con su dirección).
	// Se registra por video y NUNCA se usa para agrupar: ver unexpectedStatusReason.
	discardDetail string
}

// videoAuditStats resume lo que pasó en la verificación, para poder informarlo con números reales.
type videoAuditStats struct {
	// uniqueKeys es cuántos videos DISTINTOS se comprobaron (un mismo video puede salir en dos fichas).
	uniqueKeys int
	// unverifiableKeys es cuántos de esos videos distintos NO se pudieron comprobar. Es el numerador
	// de la proporción con la que se decide si la generación entera es de fiar (ver
	// maxUnverifiableVideoShare).
	unverifiableKeys int
	// kept es cuántos videos se comprobaron con éxito y se escriben al catálogo marcados como buenos.
	kept int
	// preserved es cuántos videos se conservan SIN haber podido comprobarlos. Siguen en el archivo
	// con su estado anterior (normalmente "sin verificar", así que la aplicación no los enseña),
	// pero no se pierden: la información sobrevive al corte de red.
	preserved int
	// discarded es cuántos se tiraron porque oEmbed confirmó que no se pueden reproducir.
	discarded int
	// discardedByReason cuenta los descartes agrupados por motivo (ver las constantes de arriba).
	discardedByReason map[string]int
	// releasesWithVideo es cuántos estrenos conservan al menos un video tras la verificación.
	releasesWithVideo int
	// releasesWithPlayableVideo es cuántos conservan al menos un video COMPROBADO. Es el número que
	// de verdad describe lo que va a ver la gente; el de arriba incluye los conservados sin verificar.
	releasesWithPlayableVideo int
}

// unverifiableShare devuelve qué proporción de los videos distintos quedó sin comprobar (0 a 1).
// En español: es la cifra que se compara contra maxUnverifiableVideoShare. Si no había videos que
// comprobar, devuelve 0: no hay nada de lo que sospechar.
func (s videoAuditStats) unverifiableShare() float64 {
	if s.uniqueKeys == 0 {
		return 0
	}
	return float64(s.unverifiableKeys) / float64(s.uniqueKeys)
}

// verifyAndFilterVideos comprueba TODOS los videos del catálogo y quita los que YouTube confirma que
// no se pueden reproducir.
//
// En español: es el paso que convierte una lista de códigos en una promesa. Recorre todas las fichas,
// junta los códigos de video distintos, pregunta por cada uno a oEmbed (de seis en seis, con
// reintentos) y después vuelve a recorrer las fichas repartiendo cada video en uno de tres montones:
//
//   - COMPROBADO Y BUENO: se queda y se le sella el canal, su clasificación y la fecha de hoy.
//   - COMPROBADO Y ROTO: se borra. Es para lo que existe este paso.
//   - NO SE PUDO COMPROBAR: se queda TAL CUAL, sin tocarle nada. No se ha descubierto nada malo de
//     él; lo único que pasó es que hoy no se pudo preguntar. Antes este montón se trataba como el
//     anterior y por eso un corte de red borraba el catálogo entero de tráilers.
//
// Devuelve un resumen con números. Ese resumen no es decorativo: con él, quien llama decide si la
// verificación fue lo bastante fiable como para escribir el archivo (ver guardVideoVerificationHealth).
func verifyAndFilterVideos(
	ctx context.Context,
	logger *slog.Logger,
	releases []*catalogv1.Release,
	verifiedAt string,
) videoAuditStats {
	return verifyVideosWithEndpoint(ctx, logger, releases, verifiedAt, youTubeOEmbedEndpoint)
}

// verifyVideosWithEndpoint es verifyAndFilterVideos con la dirección del servicio como parámetro.
//
// En español: en producción esa dirección es siempre la de YouTube. Se deja inyectable para que las
// pruebas puedan levantar un servidor propio que responda "este video es privado" o "este servidor
// está caído" a voluntad. Sin eso, la única forma de probar esta lógica sería depender de que un
// video concreto de internet siga estando roto mañana, que no es una prueba: es una casualidad.
func verifyVideosWithEndpoint(
	ctx context.Context,
	logger *slog.Logger,
	releases []*catalogv1.Release,
	verifiedAt string,
	oEmbedEndpoint string,
) videoAuditStats {
	// --- Paso 1: juntar los códigos de video DISTINTOS de todo el catálogo -----------------------
	// En español: el mismo tráiler puede aparecer en dos fichas (una película y su reestreno). Se
	// comprueba una sola vez y el resultado se reutiliza; así se ahorran peticiones sin perder rigor.
	uniqueKeys := collectUniqueVideoKeys(releases)

	stats := videoAuditStats{
		uniqueKeys:        len(uniqueKeys),
		discardedByReason: make(map[string]int),
	}
	if len(uniqueKeys) == 0 {
		logger.Info("video verification skipped: the catalog has no videos to check")
		return stats
	}

	logger.Info(
		"verifying videos against youtube oembed",
		slog.Int("unique_keys", len(uniqueKeys)),
		slog.Int("max_concurrency", oEmbedMaxConcurrency),
	)

	// --- Paso 2: preguntar a oEmbed por cada código, con concurrencia limitada -------------------
	checksByKey := checkVideoKeysAt(ctx, logger, uniqueKeys, oEmbedEndpoint)

	// --- Paso 3: contar cuántos videos distintos quedaron sin comprobar ---------------------------
	// En español: se cuenta ANTES de tocar las fichas porque esta proporción es la que decide si la
	// generación entera es de fiar. Un video que ni siquiera aparece en el mapa de veredictos (porque
	// se agotó el plazo total antes de llegar a él) cuenta igual que uno que falló: tampoco se
	// comprobó.
	for _, key := range uniqueKeys {
		check, wasChecked := checksByKey[key]
		if !wasChecked || !check.verifiable {
			stats.unverifiableKeys++
		}
	}

	// --- Paso 4: reescribir cada ficha según el veredicto de cada video ---------------------------
	for _, release := range releases {
		keptVideos := make([]*catalogv1.Video, 0, len(release.GetVideos()))
		playableInThisRelease := 0

		for _, video := range release.GetVideos() {
			check, wasChecked := checksByKey[video.GetYoutubeKey()]

			switch {
			case wasChecked && check.verifiable && check.playable:
				// Comprobado y bueno: le sellamos el canal, su clasificación y la fecha de hoy.
				video.Channel = check.channel
				video.ChannelKind = classifyChannel(check.channel)
				video.Playable = true
				video.VerifiedAt = verifiedAt
				keptVideos = append(keptVideos, video)
				playableInThisRelease++
				stats.kept++

			case wasChecked && check.verifiable:
				// Comprobado y roto: YouTube confirmó que este video no se puede reproducir dentro de
				// nuestra página. Este SÍ se borra, que es justamente para lo que existe la verificación.
				stats.discarded++
				stats.discardedByReason[check.discardReason]++
				logger.Warn(
					"video discarded: it cannot be played embedded",
					slog.String("release_id", release.GetId()),
					slog.String("release_title", release.GetTitle()),
					slog.String("youtube_key", video.GetYoutubeKey()),
					slog.String("video_title", video.GetTitle()),
					slog.String("reason", check.discardReason),
					slog.String("detail", check.discardDetail),
				)

			default:
				// NO se pudo comprobar. Aquí estaba el defecto grave: antes este caso borraba el video
				// igual que si estuviera roto, así que un corte de red vaciaba de tráilers el catálogo
				// entero y el archivo se escribía igual. Ahora el video se conserva EXACTAMENTE como
				// estaba —con su marca de verificación anterior, si la tenía—, porque no se ha
				// descubierto nada malo sobre él: solo que hoy no se pudo preguntar. Aparte de esto, la
				// proporción de casos así decide si la generación completa se da por buena o se aborta
				// sin escribir nada (ver maxUnverifiableVideoShare).
				stats.preserved++
				if video.GetPlayable() {
					playableInThisRelease++
				}
				keptVideos = append(keptVideos, video)
				logger.Warn(
					"video kept without verification: youtube could not be asked about it",
					slog.String("release_id", release.GetId()),
					slog.String("release_title", release.GetTitle()),
					slog.String("youtube_key", video.GetYoutubeKey()),
					slog.String("video_title", video.GetTitle()),
					slog.String("reason", unverifiableReasonOf(check, wasChecked)),
					slog.String("detail", check.discardDetail),
					slog.String("previous_verified_at", video.GetVerifiedAt()),
				)
			}
		}

		// Si no quedó ninguno, la ficha se queda SIN lista de videos. Es un estado normal y previsto
		// (1 de cada 5 títulos no tiene ningún video en TMDB: 87 de 422 medidos sobre el catálogo
		// vigente), no un error.
		if len(keptVideos) == 0 {
			release.Videos = nil
			continue
		}
		release.Videos = keptVideos
		stats.releasesWithVideo++
		if playableInThisRelease > 0 {
			stats.releasesWithPlayableVideo++
		}
	}

	return stats
}

// unverifiableReasonOf dice, en una categoría, por qué un video se quedó sin comprobar.
// En español: si hubo veredicto (aunque fuera "no pude"), se usa el motivo que traiga; si el video
// ni siquiera llegó a consultarse —porque se agotó el plazo total antes de su turno—, se nombra ese
// caso con la categoría general de "no verificable".
func unverifiableReasonOf(check videoCheck, wasChecked bool) string {
	if wasChecked && check.discardReason != "" {
		return check.discardReason
	}
	return discardReasonUnverifiable
}

// collectUniqueVideoKeys junta, sin repetir, todos los códigos de video del catálogo.
// En español: devuelve la lista ORDENADA alfabéticamente. El orden no cambia el resultado, pero hace
// que dos ejecuciones del generador recorran los mismos videos en el mismo orden, lo que vuelve los
// registros comparables entre corridas.
func collectUniqueVideoKeys(releases []*catalogv1.Release) []string {
	seen := make(map[string]bool)
	for _, release := range releases {
		for _, video := range release.GetVideos() {
			key := video.GetYoutubeKey()
			if key == "" {
				continue
			}
			seen[key] = true
		}
	}
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// checkVideoKeysAt consulta oEmbed para cada código, como mucho seis a la vez, y devuelve el veredicto.
//
// En español: reparte el trabajo entre seis "trabajadores" que van tomando códigos de una cola común.
// Seis es el tope medido (ver oEmbedMaxConcurrency). Cada trabajador escribe su resultado en un mapa
// compartido protegido por un candado, porque varios pueden terminar a la vez.
func checkVideoKeysAt(
	ctx context.Context,
	logger *slog.Logger,
	keys []string,
	oEmbedEndpoint string,
) map[string]videoCheck {
	// Cliente HTTP propio con su plazo de espera: no reutilizamos el de TMDB porque este habla con
	// otro servicio y queremos que un atasco aquí no arrastre al otro.
	httpClient := &http.Client{Timeout: oEmbedHTTPTimeout}

	checksByKey := make(map[string]videoCheck, len(keys))
	// resultsMutex protege el mapa: sin él, dos trabajadores escribiendo a la vez lo corromperían.
	var resultsMutex sync.Mutex

	// pendingKeys es la cola de trabajo: los trabajadores van sacando de aquí hasta vaciarla.
	pendingKeys := make(chan string)

	var workers sync.WaitGroup
	for range oEmbedMaxConcurrency {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for key := range pendingKeys {
				check := checkSingleVideoKeyAt(ctx, httpClient, oEmbedEndpoint, key)
				resultsMutex.Lock()
				checksByKey[key] = check
				resultsMutex.Unlock()
			}
		}()
	}

	// Vamos entregando los códigos a la cola. Si el contexto se cancela (se acabó el plazo total de
	// generación), dejamos de repartir: los que falten quedarán sin veredicto y por tanto fuera.
	for _, key := range keys {
		select {
		case <-ctx.Done():
			logger.Warn(
				"video verification interrupted: the overall deadline expired",
				slog.String("error", ctx.Err().Error()),
			)
			close(pendingKeys)
			workers.Wait()
			return checksByKey
		case pendingKeys <- key:
		}
	}
	close(pendingKeys)
	workers.Wait()

	return checksByKey
}

// checkSingleVideoKeyAt pregunta a oEmbed por UN video y traduce la respuesta a un veredicto.
//
// En español: reintenta hasta oEmbedMaxAttempts veces cuando el fallo es de red o del servidor (esos
// se arreglan solos al segundo intento), esperando cada vez el doble que la anterior. NO reintenta
// cuando la respuesta es un veredicto claro (200 = sí, 401/404 = no): repetir una respuesta firme
// solo gasta tiempo. El 403 es el caso especial: hace falta verlo DOS veces seguidas para creerlo
// (ver oEmbedForbiddenAttemptsBeforeGivingUp).
//
// Cuando se agotan los intentos sin veredicto, devuelve un resultado con verifiable en false, que es
// la señal de "no se descubrió nada malo de este video, conservadlo tal cual".
func checkSingleVideoKeyAt(
	ctx context.Context,
	httpClient *http.Client,
	oEmbedEndpoint string,
	youtubeKey string,
) videoCheck {
	// Armamos la URL de consulta: el endpoint de oEmbed con la dirección del video y formato JSON.
	query := url.Values{}
	query.Set("url", youTubeWatchURLPrefix+youtubeKey)
	query.Set("format", "json")
	requestURL := oEmbedEndpoint + "?" + query.Encode()

	// lastTransientError guarda el último fallo pasajero, para poder explicarlo si se agotan los intentos.
	var lastTransientError error
	// consecutiveForbidden cuenta los 403 SEGUIDOS. Se pone a cero en cuanto llega otra cosa, porque
	// lo que distingue al video privado del bloqueo antibot es precisamente la insistencia.
	consecutiveForbidden := 0
	retryDelay := oEmbedRetryBaseDelay

	for attempt := 1; attempt <= oEmbedMaxAttempts; attempt++ {
		check, outcome, transientError := attemptOEmbed(ctx, httpClient, requestURL)

		switch outcome {
		case oEmbedOutcomeDecided:
			// oEmbed dio un veredicto firme (sí o no): no tiene sentido volver a preguntar lo mismo.
			return check

		case oEmbedOutcomeUnverifiable:
			// Falló de una forma que no se arregla insistiendo pero que no dice nada del video.
			return check

		case oEmbedOutcomeForbidden:
			consecutiveForbidden++
			if consecutiveForbidden >= oEmbedForbiddenAttemptsBeforeGivingUp {
				// Dos "prohibido" seguidos con una espera de por medio: ya no es un bloqueo pasajero,
				// el video es privado de verdad.
				return check
			}
			// Todavía puede ser un bloqueo antibot: se anota como fallo pasajero y se vuelve a preguntar.
			lastTransientError = fmt.Errorf("oembed returned status %d (private video or antibot block)", http.StatusForbidden)

		case oEmbedOutcomeRetryable:
			// Fallo pasajero (conexión cortada, 429, servidor con problemas): esperamos y reintentamos.
			consecutiveForbidden = 0
			lastTransientError = transientError
		}

		if !waitBeforeRetry(ctx, attempt, retryDelay) {
			break
		}
		// La espera se duplica en cada vuelta (500 ms, 1 s, 2 s): dar aire es lo que arregla la ráfaga
		// y también lo que deja pasar un bloqueo antibot.
		retryDelay *= 2
	}

	// Se agotaron los intentos sin un veredicto claro. NO sabemos si el video está bien, así que no
	// afirmamos nada sobre él: verifiable queda en false y quien llama lo conservará tal como estaba.
	detail := ""
	if lastTransientError != nil {
		detail = lastTransientError.Error()
	}
	return videoCheck{
		verifiable:    false,
		playable:      false,
		discardReason: discardReasonUnverifiable,
		discardDetail: detail,
	}
}

// attemptOEmbed hace UN intento de consulta y traduce la respuesta.
//
// En español: devuelve tres cosas y las tres importan:
//   - check: el veredicto, cuando lo hay.
//   - outcome: en qué quedó el intento (firme, reintentable, prohibido o no comprobable). Es lo que
//     decide si se vuelve a preguntar y si el video se borra o se conserva.
//   - transientError: qué falló, cuando el intento no concluyó. Es lo que se reintenta.
//
// Separar un intento del bucle de reintentos es lo que mantiene ambas cosas legibles: aquí solo se
// interpretan códigos de respuesta, y quien llama solo decide cuánto insistir.
func attemptOEmbed(
	ctx context.Context,
	httpClient *http.Client,
	requestURL string,
) (check videoCheck, outcome oEmbedOutcome, transientError error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		// Construir la petición solo falla si la dirección del servicio es inválida, y eso no dice
		// nada del video: le pasaría igual a todos. Se marca como NO comprobable (el video se
		// conserva) en vez de como veredicto, que era lo que antes lo borraba sin motivo.
		return videoCheck{
			verifiable:    false,
			discardReason: discardReasonUnverifiable,
			discardDetail: fmt.Sprintf("oembed request could not be built: %v", err),
		}, oEmbedOutcomeUnverifiable, nil
	}
	request.Header.Set("Accept", "application/json")

	response, err := httpClient.Do(request)
	if err != nil {
		// Fallo de TRANSPORTE: la conexión se cortó o no se pudo abrir. Es exactamente el síntoma que
		// producía la ráfaga de peticiones, y se cura esperando un poco.
		return videoCheck{}, oEmbedOutcomeRetryable, fmt.Errorf("oembed request failed: %w", err)
	}

	statusCode := response.StatusCode
	// Lectura ACOTADA: se pide un byte más que el tope para poder distinguir "cabe justo" de "se
	// pasó". Sin este límite, cualquier cosa que conteste en esa dirección puede hacer que el
	// generador cargue en memoria todo lo que quiera mandar (se midieron 27 MB tragados sin queja).
	bodyBytes, readErr := io.ReadAll(io.LimitReader(response.Body, maxOEmbedBodyBytes+1))
	_ = response.Body.Close()

	switch {
	case statusCode == http.StatusOK:
		if readErr != nil {
			// La respuesta empezó a llegar y se cortó a mitad: pasajero, se reintenta.
			return videoCheck{}, oEmbedOutcomeRetryable, fmt.Errorf("oembed body could not be read: %w", readErr)
		}
		if len(bodyBytes) > maxOEmbedBodyBytes {
			// Contestó algo enorme: no es oEmbed. No sabemos nada del video, así que se conserva.
			return videoCheck{
				verifiable:    false,
				discardReason: discardReasonOversizedBody,
				discardDetail: fmt.Sprintf("oembed body exceeded %d bytes", maxOEmbedBodyBytes),
			}, oEmbedOutcomeUnverifiable, nil
		}
		// El video se puede incrustar. Leemos el nombre del canal; si el JSON viniera raro, el video
		// sigue siendo válido y simplemente se queda sin canal (caerá en "sin clasificar").
		parsed := &oEmbedResponse{}
		if err := json.Unmarshal(bodyBytes, parsed); err != nil {
			return videoCheck{channel: "", verifiable: true, playable: true}, oEmbedOutcomeDecided, nil
		}
		return videoCheck{channel: parsed.AuthorName, verifiable: true, playable: true}, oEmbedOutcomeDecided, nil

	case statusCode == http.StatusUnauthorized:
		// 401: el video existe, pero su dueño prohibió incrustarlo en otras webs. Dentro de nuestra
		// página solo se vería "El propietario del video inhabilitó la reproducción en otros sitios".
		return videoCheck{
			verifiable:    true,
			discardReason: discardReasonEmbeddingDisabled,
		}, oEmbedOutcomeDecided, nil

	case statusCode == http.StatusForbidden:
		// 403: puede ser "video privado" o "bloqueo antibot". El veredicto que se devuelve es el de
		// privado, pero solo se aceptará si el siguiente intento dice lo mismo (ver el bucle).
		return videoCheck{
			verifiable:    true,
			discardReason: discardReasonPrivate,
		}, oEmbedOutcomeForbidden, nil

	case statusCode == http.StatusNotFound:
		// 404: el video ya no existe (lo borraron).
		return videoCheck{
			verifiable:    true,
			discardReason: discardReasonNotFound,
		}, oEmbedOutcomeDecided, nil

	case statusCode == http.StatusBadRequest:
		// 400: oEmbed no acepta la petición; en la práctica significa código de video inválido.
		return videoCheck{
			verifiable:    true,
			discardReason: discardReasonBadRequest,
		}, oEmbedOutcomeDecided, nil

	case statusCode == http.StatusTooManyRequests || statusCode >= http.StatusInternalServerError:
		// El servicio nos pide bajar el ritmo o está teniendo un mal momento: esto sí se reintenta.
		return videoCheck{}, oEmbedOutcomeRetryable, fmt.Errorf("oembed returned status %d", statusCode)

	default:
		// Cualquier otro código es un "no" que no sabemos nombrar: se descarta con el código a la
		// vista, agrupado por ese código y no por video (ver unexpectedStatusReason).
		return videoCheck{
			verifiable:    true,
			discardReason: unexpectedStatusReason(statusCode),
		}, oEmbedOutcomeDecided, nil
	}
}

// waitBeforeRetry duerme antes del siguiente intento y dice si merece la pena seguir intentándolo.
//
// En español: devuelve false cuando ya era el último intento (no hay que esperar para nada) o cuando
// el contexto se canceló (el generador se está apagando). Devuelve true tras esperar cuando todavía
// queda al menos un intento por hacer.
func waitBeforeRetry(ctx context.Context, attempt int, delay time.Duration) bool {
	if attempt >= oEmbedMaxAttempts {
		return false
	}
	select {
	case <-ctx.Done():
		return false
	case <-time.After(delay):
		return true
	}
}

// logVideoAudit vuelca el resumen de la verificación en los registros, con números reales.
// En español: es lo que permite responder "¿cuántos tráilers se descartaron y por qué?" sin tener que
// leer mil líneas de aviso. Los motivos se imprimen ordenados para que dos corridas se puedan comparar.
func logVideoAudit(logger *slog.Logger, stats videoAuditStats) {
	logger.Info(
		"video verification finished",
		slog.Int("checked_unique_keys", stats.uniqueKeys),
		slog.Int("unverifiable_unique_keys", stats.unverifiableKeys),
		slog.Int("videos_kept", stats.kept),
		slog.Int("videos_preserved_unverified", stats.preserved),
		slog.Int("videos_discarded", stats.discarded),
		slog.Int("releases_with_video", stats.releasesWithVideo),
		slog.Int("releases_with_playable_video", stats.releasesWithPlayableVideo),
	)

	reasons := make([]string, 0, len(stats.discardedByReason))
	for reason := range stats.discardedByReason {
		reasons = append(reasons, reason)
	}
	sort.Strings(reasons)
	for _, reason := range reasons {
		logger.Info(
			"videos discarded by reason",
			slog.String("reason", reason),
			slog.Int("count", stats.discardedByReason[reason]),
		)
	}
}

// guardVideoVerificationHealth decide si lo que salió de la verificación merece llegar al disco.
//
// En español: es el freno de mano del generador y responde a una sola pregunta —"¿estaba YouTube
// contestando mientras se generaba esto?"—. Devuelve error, y por tanto impide escribir el archivo,
// en dos casos:
//
//  1. El plazo total se agotó o alguien canceló la ejecución. Entonces media generación no llegó ni
//     a intentarse y el archivo resultante estaría incompleto por razones que nada tienen que ver
//     con el catálogo real.
//  2. La proporción de videos que no se pudieron comprobar supera maxUnverifiableVideoShare. Eso ya
//     no son tropiezos sueltos: es el servicio caído, la red cortada o un bloqueo, y el archivo que
//     saldría describiría el estado de la conexión, no el del catálogo.
//
// Que esto sea un ERROR y no un aviso es el punto entero: mientras fue un aviso, el archivo se
// escribía igual y el proceso terminaba diciendo que todo había ido bien.
func guardVideoVerificationHealth(ctx context.Context, stats videoAuditStats) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf(
			"video verification did not finish (checked %d of %d unique videos): refusing to write the seed: %w",
			stats.uniqueKeys-stats.unverifiableKeys, stats.uniqueKeys, err,
		)
	}

	share := stats.unverifiableShare()
	if share > maxUnverifiableVideoShare {
		return fmt.Errorf(
			"%d of %d unique videos (%.1f%%) could not be verified, above the %.1f%% limit: youtube looks unreachable, refusing to write the seed",
			stats.unverifiableKeys, stats.uniqueKeys, share*100, maxUnverifiableVideoShare*100,
		)
	}

	return nil
}
