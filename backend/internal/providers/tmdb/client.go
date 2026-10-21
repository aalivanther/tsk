// Package tmdb es el cliente del proveedor TMDB (The Movie Database, API v3).
// En español: este paquete es el "mensajero" que habla con la API de TMDB. Sabe armar las URLs
// correctas, poner la llave secreta en el lugar seguro (en una cabecera, NUNCA en la URL ni en
// los logs), hacer las peticiones, reintentar con paciencia si TMDB nos pide bajar el ritmo (error
// 429) y traducir las respuestas a los "moldes" Go de types.go. Es la única pieza que toca la red:
// el resto del proyecto le pide datos a este cliente y nunca a TMDB directamente.
package tmdb

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// BaseURL es la raíz de la API v3 de TMDB.
// En español: todas las peticiones cuelgan de esta dirección (verificada el 2026-05-30).
const BaseURL = "https://api.themoviedb.org/3"

// ImageBaseURLDefault es la base por defecto para construir URLs de imágenes de TMDB.
// En español: es un respaldo razonable por si aún no se consultó /configuration; lo correcto es
// pedir /configuration al arranque y sobreescribir esta base con la "secure_base_url" oficial.
const ImageBaseURLDefault = "https://image.tmdb.org/t/p/"

// defaultHTTPTimeout es el tiempo máximo que esperamos por una respuesta de TMDB.
// En español: si TMDB no contesta en este plazo, abortamos la petición en vez de colgarnos para
// siempre. 15 segundos es holgado para una API rápida pero protege ante caídas o redes lentas.
const defaultHTTPTimeout = 15 * time.Second

// defaultLanguage es el idioma por defecto de las respuestas (contenido localizado es-MX).
const defaultLanguage = "es-MX"

// defaultRegion es la región por defecto para estrenos y proveedores (México).
const defaultRegion = "MX"

// maxRetries es el número máximo de intentos ante un 429 (límite de tasa) antes de rendirse.
// En español: TMDB puede pedirnos bajar el ritmo con un 429; reintentamos hasta 3 veces
// respetando el tiempo que nos indique, y si tras eso sigue fallando, devolvemos el error.
const maxRetries = 3

// defaultRetryBackoff es la espera de respaldo entre reintentos cuando TMDB no indica Retry-After.
// En español: si el 429 no trae una cabecera "Retry-After", esperamos este tiempo fijo antes de
// reintentar, para no martillear la API.
const defaultRetryBackoff = 1 * time.Second

// defaultPosterSize es el tamaño de póster usado al construir URLs cuando no se especifica otro.
// En español: "w500" es un buen equilibrio entre nitidez y peso para las fichas del catálogo.
const defaultPosterSize = "w500"

// defaultBackdropSize es el tamaño de imagen de fondo usado al construir URLs por defecto.
// En español: "w1280" da una imagen de fondo amplia y nítida sin llegar al peso de "original".
const defaultBackdropSize = "w1280"

// maxResponseBytes es lo máximo que se acepta leer de UNA respuesta de TMDB.
//
// Por qué hay un tope y por qué está justo aquí, en español: la respuesta más pesada que pide este
// cliente es el detalle de una película con todos sus bloques embebidos (videos, créditos,
// proveedores, traducciones), y ronda unos pocos cientos de kilobytes. Sin ningún tope, el cliente
// se traga y analiza lo que sea que llegue por esa conexión: se comprobó leyendo 27 MB de una sentada
// sin una sola queja. Eso convierte cualquier respuesta anómala —un servidor equivocado, un proxy
// que devuelve una página de error interminable, una respuesta manipulada— en un consumo de memoria
// sin techo dentro de un proceso que ya está haciendo cientos de peticiones. Ocho megabytes dejan
// veinte veces de margen sobre la respuesta más grande que existe de verdad y ponen un techo firme.
const maxResponseBytes = 8 * 1024 * 1024

// maxDiscoverPages es el tope de páginas que pedimos al descubrir estrenos de un mes.
// En español: DECISIÓN EXPLÍCITA. /discover/movie pagina los resultados (20 por página) y nos dice
// cuántas páginas hay en total. Iteramos página a página acumulando ids, pero PONEMOS UN LÍMITE de
// 10 páginas (hasta 200 estrenos por mes) por dos razones: (1) protegernos de una consulta que, por
// un filtro mal puesto, devuelva cientos de páginas y dispare las llamadas a TMDB; (2) 200 estrenos
// de cine en un solo mes en México es más que de sobra para el catálogo. Si algún mes real superara
// este tope, se sube aquí de forma consciente, no por accidente.
const maxDiscoverPages = 10

// includeVideoLanguageValue son los idiomas de video que pedimos en el sub-recurso videos.
//
// EL LITERAL "es-MX" ES OBLIGATORIO Y NO SE PUEDE ABREVIAR. En español: TMDB no guarda "los videos
// en español" en un solo montón; los guarda en montones separados por idioma + país (es-MX, es-ES,
// en-US…). Cuando se le pide "es" a secas, TMDB entiende "es-ES" y abre ÚNICAMENTE el montón de
// España: el de México ni se toca. Lo mismo pasa con "es-419" (el código de "español de
// Latinoamérica"), que también devuelve el montón de España. Verificado contra la API real sobre
// Spider-Man: Un nuevo día (movie/969681):
//
//	include_video_language=es,en,null   -> 139 videos: 136 en-US, 3 es-ES, CERO es-MX
//	include_video_language=es-MX        ->   8 videos, todos es-MX (5 de ellos tráilers oficiales)
//
// Es decir: con el valor antiguo el catálogo servía el doblaje de España a un público mexicano
// existiendo el mexicano, y nadie podía verlo porque el dato no llegaba a entrar. Se piden también
// los idiomas de las demás opciones del perfil (pt-BR, fr-FR, ja-JP) y "null" (videos sin idioma
// marcado), para que la elección del frontend tenga con qué trabajar en los cinco idiomas.
//
// Sobre el rumor del límite de 5 idiomas: NO se reproduce. Probado con 7 valores contra la API real,
// devolvió los 147 videos correctamente.
const includeVideoLanguageValue = "es-MX,es-ES,en,pt-BR,fr-FR,ja-JP,null"

// movieAppendToResponse son los bloques extra que pedimos embebidos en el detalle de una PELÍCULA.
//
// En español: "append_to_response" es la forma que da TMDB de traer varios recursos en UNA sola
// petición, en vez de una por cada cosa. Aquí pedimos los videos, los créditos (reparto y equipo), dónde
// verla, cómo se estrenó por país y —desde ahora— las traducciones de la ficha, que son el plan B para
// la sinopsis cuando no existe en español de México. Cada bloque añadido aquí es una petición de red que
// NO se hace: por eso conviene pedirlo todo junto aunque a veces no se use.
const movieAppendToResponse = "videos,credits,watch/providers,release_dates,translations"

// tvAppendToResponse son los bloques extra que pedimos embebidos en el detalle de una SERIE.
//
// En español: casi los mismos que en películas, con dos diferencias propias de la televisión.
// "aggregate_credits" son los créditos acumulados de todas las temporadas (la única forma de tener el
// reparto recurrente de una serie larga), y "external_ids" trae el identificador de IMDb, que el detalle
// de una serie NO incluye suelto —a diferencia del de una película— y sin el cual no se puede preguntar
// a OMDb por sus calificaciones. Que faltara ese bloque es parte de por qué las 234 series del catálogo
// no tenían ni una nota de IMDb, Rotten Tomatoes o Metacritic.
const tvAppendToResponse = "videos,credits,aggregate_credits,watch/providers,translations,external_ids"

// includeImageLanguageValue son los idiomas de imagen que pedimos en la galería (/images).
// En español: las imágenes NO tienen el problema de los videos (una escena no está "doblada"), así
// que aquí basta con español, inglés y las que no llevan idioma. Es una constante aparte a propósito:
// antes ambos parámetros compartían el mismo valor, y arreglar los videos habría cambiado de rebote
// el comportamiento de la galería sin que nadie lo pidiera.
const includeImageLanguageValue = "es,en,null"

// Client es el cliente HTTP que consulta la API de TMDB.
// En español: guarda todo lo necesario para hablar con TMDB de forma consistente: el cliente HTTP
// (con su tiempo de espera), las URLs base (de API e imágenes), la llave secreta, el idioma y la
// región por defecto, y una caché de la configuración para no pedirla en cada llamada.
type Client struct {
	// httpClient es el cliente HTTP subyacente (con su timeout) que hace las peticiones de red.
	httpClient *http.Client
	// baseURL es la raíz de la API; se puede inyectar otra en pruebas (servidor httptest).
	baseURL string
	// imageBaseURL es la base para construir URLs de imágenes; se actualiza tras /configuration.
	imageBaseURL string
	// readToken es el Read Access Token de TMDB (Bearer). Es un secreto: solo viaja en cabeceras.
	readToken string
	// language es el idioma de las respuestas (ej. "es-MX").
	language string
	// region es la región para estrenos/proveedores (ej. "MX").
	region string

	// logger es donde el cliente deja constancia de lo que decide tragarse sin fallar.
	//
	// En español: este cliente casi nunca registra nada, y está bien que así sea. Existe por un caso
	// muy concreto: cuando una entrada suelta de un listado viene mal formada, la respuesta correcta
	// es saltarla y seguir con las demás, NO tumbar la generación entera. Pero "saltarla" sin dejar
	// rastro sería tragarse un error en silencio, que es justo lo que las reglas del proyecto
	// prohíben. Con el registro, el operador ve cuántas entradas se saltaron y en qué consulta.
	logger *slog.Logger

	// configMu protege config e imageBaseURL para que el cliente sea seguro en uso CONCURRENTE.
	// En español: Configuration() escribe estos dos campos y BuildImageURL() los lee; si dos
	// goroutines usaran el cliente a la vez sin este candado, habría una carrera de datos
	// (confirmada con `go test -race` antes de este fix). Hoy seedgen/schedulegen lo usan de forma
	// secuencial, pero el cliente no debe depender de esa suposición para ser correcto.
	configMu sync.RWMutex
	// config es la configuración cacheada de TMDB (se llena la primera vez que se consulta).
	config *Configuration
}

// Option es una función de configuración opcional para personalizar el Client al crearlo.
// En español: usamos el patrón "opciones funcionales" para que NewClient tenga valores por defecto
// sensatos y, a la vez, permita inyectar piezas concretas (sobre todo en pruebas) sin multiplicar
// constructores. Cada Option recibe el Client a medio construir y ajusta un detalle.
type Option func(*Client)

// WithHTTPClient inyecta un *http.Client a medida (por ejemplo, el de un servidor de pruebas).
// En español: en los tests usamos httptest, cuyo cliente apunta a un servidor local; esta opción
// permite sustituir el cliente HTTP real por ese de pruebas.
func WithHTTPClient(httpClient *http.Client) Option {
	return func(client *Client) {
		client.httpClient = httpClient
	}
}

// WithBaseURL inyecta una URL base distinta (por ejemplo, la del servidor httptest de pruebas).
// En español: en producción se usa BaseURL (la API real de TMDB); en pruebas apuntamos a un
// servidor local que devuelve JSON fijo, sin tocar la red.
func WithBaseURL(baseURL string) Option {
	return func(client *Client) {
		client.baseURL = baseURL
	}
}

// WithLanguage cambia el idioma por defecto de las respuestas.
// En español: por defecto es "es-MX"; esta opción permite ajustarlo si hiciera falta.
func WithLanguage(language string) Option {
	return func(client *Client) {
		client.language = language
	}
}

// WithRegion cambia la región por defecto para estrenos y proveedores.
// En español: por defecto es "MX"; esta opción permite ajustarla si hiciera falta.
func WithRegion(region string) Option {
	return func(client *Client) {
		client.region = region
	}
}

// WithLogger inyecta el registrador que usará el cliente para avisar de lo que se salta.
// En español: si no se pasa ninguno, se usa el del proceso (slog.Default). Las herramientas que ya
// tienen su propio registrador —seedgen, schedulegen— pasan el suyo para que todos los avisos de una
// misma ejecución salgan juntos y con el mismo formato.
func WithLogger(logger *slog.Logger) Option {
	return func(client *Client) {
		if logger != nil {
			client.logger = logger
		}
	}
}

// NewClient construye un Client de TMDB con valores por defecto y aplica las opciones recibidas.
// En español: crea el cliente listo para usar. Por defecto trae un cliente HTTP con tiempo de
// espera de 15s, idioma es-MX, región MX y la URL base de la API real. Las opciones permiten
// sobreescribir esos defaults (clave para inyectar el servidor de pruebas).
func NewClient(readToken string, options ...Option) *Client {
	client := &Client{
		httpClient:   &http.Client{Timeout: defaultHTTPTimeout},
		baseURL:      BaseURL,
		imageBaseURL: ImageBaseURLDefault,
		readToken:    readToken,
		language:     defaultLanguage,
		region:       defaultRegion,
		logger:       slog.Default(),
	}

	// Aplicamos cada opción en orden, para que las personalizaciones pisen los valores por defecto.
	for _, applyOption := range options {
		applyOption(client)
	}

	return client
}

// doGET hace una petición GET a un path de la API con sus parámetros de consulta y devuelve el cuerpo.
// En español: es el corazón del cliente. Arma la URL final, pone la llave secreta en la cabecera
// Authorization (NUNCA en la URL ni en logs), pide JSON, y si TMDB responde 429 ("baja el ritmo")
// reintenta hasta maxRetries respetando el tiempo que indique la cabecera Retry-After. Devuelve los
// bytes crudos del cuerpo o un error con contexto envuelto con %w.
func (c *Client) doGET(ctx context.Context, path string, query url.Values) ([]byte, error) {
	// Construimos la URL completa: base + path + "?" + parámetros de consulta.
	// En español: el token NO va aquí (iría en la URL y podría filtrarse en logs); va en la cabecera.
	fullURL := c.baseURL + path
	if encodedQuery := query.Encode(); encodedQuery != "" {
		fullURL = fullURL + "?" + encodedQuery
	}

	// Reintentamos ante 429 hasta maxRetries veces; cada vuelta hace una petición fresca.
	// En español: guardamos el último error para devolverlo si todos los intentos se agotan.
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		// Creamos la petición ligada al contexto, para que se cancele si el contexto se cancela.
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
		if err != nil {
			return nil, fmt.Errorf("tmdb: failed to build request for %s: %w", path, err)
		}

		// Ponemos la llave secreta en la cabecera (Bearer) y pedimos JSON. El token nunca se loguea.
		request.Header.Set("Authorization", "Bearer "+c.readToken)
		request.Header.Set("Accept", "application/json")

		// Ejecutamos la petición. Un fallo de TRANSPORTE (red caída, conexión cortada, DNS) suele ser
		// transitorio: en vez de rendirnos al primer parpadeo (lo que en seedgen se traducía en
		// películas perdidas en silencio), reintentamos con el backoff de respaldo. Si la causa es la
		// cancelación del contexto, NO reintentamos: el llamador pidió abortar.
		response, err := c.httpClient.Do(request)
		if err != nil {
			if ctx.Err() != nil {
				return nil, fmt.Errorf("tmdb: request to %s cancelled: %w", path, ctx.Err())
			}
			lastErr = fmt.Errorf("tmdb: request to %s failed: %w", path, err)
			if attempt == maxRetries {
				break
			}
			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("tmdb: context cancelled while waiting to retry %s: %w", path, ctx.Err())
			case <-time.After(defaultRetryBackoff):
			}
			continue
		}

		// Si TMDB nos pide bajar el ritmo (429), esperamos y reintentamos (salvo que ya no queden vueltas).
		if response.StatusCode == http.StatusTooManyRequests {
			// Cerramos el cuerpo de este intento fallido para no filtrar conexiones.
			_ = response.Body.Close()
			lastErr = fmt.Errorf("tmdb: rate limited (429) on %s after attempt %d", path, attempt)

			// Si era el último intento, no esperamos de más: salimos del bucle con el error.
			if attempt == maxRetries {
				break
			}

			// Calculamos cuánto esperar según Retry-After y aguardamos respetando el contexto: si el
			// contexto se cancela durante la espera, abortamos. parseRetryAfter interpreta tanto el
			// formato "segundos" como el formato fecha HTTP; si la cabecera no es válida, usamos el
			// backoff de respaldo. Un Retry-After de 0 significa "reintenta de inmediato" (espera 0).
			waitDuration, hadValidHeader := parseRetryAfter(response.Header.Get("Retry-After"), time.Now())
			if !hadValidHeader {
				waitDuration = defaultRetryBackoff
			}
			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("tmdb: context cancelled while waiting to retry %s: %w", path, ctx.Err())
			case <-time.After(waitDuration):
			}
			continue
		}

		// Un error 5xx es un problema DEL SERVIDOR de TMDB (mantenimiento, gateway caído) y casi
		// siempre pasa solo: también lo reintentamos con backoff, igual que un fallo de red.
		if response.StatusCode >= http.StatusInternalServerError {
			_ = response.Body.Close()
			lastErr = fmt.Errorf("tmdb: server error %d from %s on attempt %d", response.StatusCode, path, attempt)
			if attempt == maxRetries {
				break
			}
			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("tmdb: context cancelled while waiting to retry %s: %w", path, ctx.Err())
			case <-time.After(defaultRetryBackoff):
			}
			continue
		}

		// A partir de aquí ya no reintentamos: leemos el cuerpo y cerramos al terminar.
		//
		// La lectura va ACOTADA a maxResponseBytes. Se pide un byte de más a propósito: es la forma de
		// distinguir "la respuesta cabía justo en el tope" de "la respuesta se pasó y la hemos cortado".
		// Sin esa distinción se analizaría un JSON truncado como si fuera completo, que es peor que
		// fallar: produciría un catálogo al que le faltan cosas sin que nadie lo sepa.
		bodyBytes, readErr := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
		_ = response.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("tmdb: failed to read response body from %s: %w", path, readErr)
		}
		if len(bodyBytes) > maxResponseBytes {
			return nil, fmt.Errorf(
				"tmdb: response body from %s exceeds the %d byte limit", path, maxResponseBytes,
			)
		}

		// Cualquier código fuera del rango 2xx es un fallo: devolvemos el código (sin volcar el token).
		if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
			return nil, fmt.Errorf("tmdb: unexpected status %d from %s", response.StatusCode, path)
		}

		return bodyBytes, nil
	}

	// Si llegamos aquí, agotamos los reintentos (429, 5xx o fallos de red): devolvemos el último error.
	return nil, fmt.Errorf("tmdb: exhausted %d retries on %s: %w", maxRetries, path, lastErr)
}

// parseRetryAfter interpreta la cabecera Retry-After y devuelve cuánto esperar y si era válida.
// En español: el estándar HTTP permite DOS formatos para Retry-After y los soportamos ambos:
//  1. Un entero de segundos (ej. "5" = espera 5 segundos). El valor 0 es válido y significa
//     "reintenta de inmediato" (devolvemos espera 0, NO el backoff fijo).
//  2. Una fecha HTTP (ej. "Wed, 21 Oct 2026 07:28:00 GMT"). Si es futura respecto a "now",
//     esperamos hasta esa fecha; si ya pasó, esperamos 0 (reintento inmediato).
//
// El segundo valor devuelto (hadValidHeader) indica si la cabecera trajo un valor interpretable.
// Cuando es false (cabecera vacía o con basura), el llamador aplica el backoff de respaldo. El
// parámetro "now" se inyecta para poder probar el formato fecha de forma determinista.
func parseRetryAfter(retryAfterHeader string, now time.Time) (waitDuration time.Duration, hadValidHeader bool) {
	trimmedHeader := strings.TrimSpace(retryAfterHeader)
	if trimmedHeader == "" {
		return 0, false
	}

	// Formato 1: entero de segundos. Aceptamos 0 (reintento inmediato); rechazamos negativos.
	if seconds, err := strconv.Atoi(trimmedHeader); err == nil {
		if seconds < 0 {
			return 0, false
		}
		return time.Duration(seconds) * time.Second, true
	}

	// Formato 2: fecha HTTP. Usamos http.ParseTime, que entiende los tres formatos de fecha del
	// estándar. Si es futura, esperamos la diferencia; si ya pasó, esperamos 0 (reintento inmediato).
	if retryTime, err := http.ParseTime(trimmedHeader); err == nil {
		until := retryTime.Sub(now)
		if until < 0 {
			until = 0
		}
		return until, true
	}

	// La cabecera trae algo que no es ni número ni fecha válida: no es interpretable.
	return 0, false
}

// Configuration consulta GET /configuration, la cachea y actualiza la base de URLs de imágenes.
// En español: TMDB pide consultar esto al arranque para saber la base oficial de imágenes y los
// tamaños válidos. Lo pedimos una sola vez (lo guardamos en c.config) y, de paso, fijamos
// imageBaseURL con la "secure_base_url" oficial para construir URLs de imagen correctas.
func (c *Client) Configuration(ctx context.Context) (*Configuration, error) {
	// Si ya la pedimos antes, devolvemos la copia cacheada sin volver a la red (lectura bajo candado).
	c.configMu.RLock()
	cached := c.config
	c.configMu.RUnlock()
	if cached != nil {
		return cached, nil
	}

	bodyBytes, err := c.doGET(ctx, "/configuration", url.Values{})
	if err != nil {
		return nil, fmt.Errorf("tmdb: failed to fetch configuration: %w", err)
	}

	configuration := &Configuration{}
	if err := json.Unmarshal(bodyBytes, configuration); err != nil {
		return nil, fmt.Errorf("tmdb: failed to parse configuration response: %w", err)
	}

	// Escribimos la caché y la base de imágenes bajo el candado de escritura. Si dos goroutines
	// llegaron aquí a la vez (ambas vieron la caché vacía), la segunda simplemente pisa el mismo
	// resultado: una petición de más a /configuration, pero nunca datos corruptos.
	c.configMu.Lock()
	if configuration.Images.SecureBaseURL != "" {
		c.imageBaseURL = configuration.Images.SecureBaseURL
	}
	c.config = configuration
	c.configMu.Unlock()

	return configuration, nil
}

// discoverPageEnvelope es la respuesta de un descubrimiento vista "por fuera": la paginación y las
// entradas SIN ABRIR TODAVÍA.
//
// En español: json.RawMessage significa "guárdame este trozo de JSON tal cual, ya lo miraré luego".
// Ese aplazamiento es toda la idea: permite leer la paginación y después examinar cada entrada por
// separado, de forma que una entrada rota afecte solo a esa entrada. Leyendo la respuesta de una
// sola pieza, como se hacía antes, un único carácter inesperado en una película invalidaba la página
// completa, el error subía y la generación entera se detenía.
type discoverPageEnvelope struct {
	// TotalPages es cuántas páginas de resultados existen en total para esta consulta.
	TotalPages int `json:"total_pages"`
	// Results son las entradas de esta página, todavía sin interpretar.
	Results []json.RawMessage `json:"results"`
}

// maxMalformedEntryLogLength es cuánto de una entrada mal formada se copia al registro.
// En español: lo suficiente para reconocer el problema de un vistazo, no tanto como para llenar la
// pantalla con una película entera por cada entrada rara.
const maxMalformedEntryLogLength = 200

// parseDiscoverPage saca los ids de UNA página de descubrimiento saltándose las entradas rotas.
//
// EL FALLO QUE ARREGLA, en español: TMDB devuelve el identificador como número, pero se observó una
// respuesta en la que llegaba entrecomillado ("id":"842", texto donde se espera número). Con la
// lectura de una sola pieza, esa comilla tumbaba la generación COMPLETA del catálogo: no se perdía
// una película, se perdían todas. Y era una incoherencia dentro de la misma herramienta, porque el
// detalle de una película sí sabía degradar bien (si una película no se puede leer, se registra el
// aviso y se sigue con las siguientes). Ahora el descubrimiento se comporta igual: la entrada
// ilegible se salta y se deja constancia; el resto del mes se genera con normalidad.
//
// Devuelve error SOLO si la respuesta entera es ilegible (no es JSON, o no tiene la forma esperada):
// eso ya no es una entrada rota, es que no estamos hablando con TMDB.
func (c *Client) parseDiscoverPage(bodyBytes []byte, endpoint string, page int) ([]int, int, error) {
	envelope := &discoverPageEnvelope{}
	if err := json.Unmarshal(bodyBytes, envelope); err != nil {
		return nil, 0, fmt.Errorf("tmdb: failed to parse the %s page %d envelope: %w", endpoint, page, err)
	}

	ids := make([]int, 0, len(envelope.Results))
	skipped := 0

	for _, rawResult := range envelope.Results {
		result := &DiscoverMovieResult{}
		if err := json.Unmarshal(rawResult, result); err != nil {
			skipped++
			c.logger.Warn(
				"tmdb discover entry skipped: it could not be read",
				slog.String("endpoint", endpoint),
				slog.Int("page", page),
				slog.String("entry", truncateForLog(string(rawResult))),
				slog.String("error", err.Error()),
			)
			continue
		}
		// Una entrada sin identificador utilizable no sirve para nada: con ese id no se puede pedir el
		// detalle. Se cuenta igual que una entrada rota, porque el efecto es el mismo.
		if result.ID <= 0 {
			skipped++
			c.logger.Warn(
				"tmdb discover entry skipped: it has no usable id",
				slog.String("endpoint", endpoint),
				slog.Int("page", page),
				slog.String("entry", truncateForLog(string(rawResult))),
			)
			continue
		}
		ids = append(ids, result.ID)
	}

	if skipped > 0 {
		c.logger.Warn(
			"tmdb discover page had unreadable entries",
			slog.String("endpoint", endpoint),
			slog.Int("page", page),
			slog.Int("skipped", skipped),
			slog.Int("kept", len(ids)),
		)
	}

	return ids, envelope.TotalPages, nil
}

// truncateForLog recorta un texto para que quepa en una línea de registro sin perder su utilidad.
// En español: si el texto es corto se devuelve tal cual; si es largo se corta y se marca con "…"
// para que quede claro que hay más y nadie crea que el dato terminaba ahí.
func truncateForLog(text string) string {
	if len(text) <= maxMalformedEntryLogLength {
		return text
	}
	return text[:maxMalformedEntryLogLength] + "…"
}

// DiscoverMovies pide los estrenos de cine de un mes/año en la región configurada y devuelve sus ids.
// En español: usa /discover/movie acotando por el primer y último día del mes, pidiendo solo
// estrenos de cine/limitados (with_release_type=3|2) y ordenando por fecha ascendente. TMDB pagina
// los resultados (20 por página), así que ITERAMOS: pedimos la página 1, leemos cuántas páginas hay
// en total y seguimos pidiendo las siguientes hasta juntarlas todas (con tope maxDiscoverPages para
// no desbocarnos). Devuelve la lista completa de ids para luego pedir el detalle de cada uno.
// Verificado el 2026-05-30: /discover/movie SÍ acepta region (a diferencia de /discover/tv).
func (c *Client) DiscoverMovies(ctx context.Context, year, month int) ([]int, error) {
	// Calculamos el primer y el último día del mes para acotar el rango de fechas de estreno.
	firstDay, lastDay := monthDateRange(year, month)

	// Acumulamos los ids de TODAS las páginas aquí.
	movieIDs := make([]int, 0)

	// totalPages arranca en 1: tras la primera respuesta sabremos el total real y ajustaremos el tope.
	totalPages := 1
	for page := 1; page <= totalPages && page <= maxDiscoverPages; page++ {
		// Armamos los parámetros de consulta. El token NO va aquí: viaja en la cabecera (ver doGET).
		query := url.Values{}
		query.Set("region", c.region)
		query.Set("release_date.gte", firstDay)
		query.Set("release_date.lte", lastDay)
		// with_release_type 3|2 = estreno en cines (3) o estreno limitado (2); es lo que cuenta como "cine".
		query.Set("with_release_type", "3|2")
		query.Set("sort_by", "primary_release_date.asc")
		query.Set("language", c.language)
		// page indica a TMDB qué página de resultados queremos (empieza en 1).
		query.Set("page", strconv.Itoa(page))

		bodyBytes, err := c.doGET(ctx, "/discover/movie", query)
		if err != nil {
			return nil, fmt.Errorf("tmdb: failed to discover movies for %04d-%02d page %d: %w", year, month, page, err)
		}

		// Leemos la página tolerando entradas sueltas mal formadas (ver parseDiscoverPage): una
		// película ilegible no puede costar el catálogo entero.
		pageIDs, pageTotal, err := c.parseDiscoverPage(bodyBytes, "/discover/movie (theatrical)", page)
		if err != nil {
			return nil, fmt.Errorf("tmdb: failed to parse discover response for %04d-%02d page %d: %w", year, month, page, err)
		}

		// Tras la primera página ya conocemos el total real de páginas: ajustamos la condición del bucle.
		if pageTotal > totalPages {
			totalPages = pageTotal
		}

		// Extraemos únicamente los ids de esta página; el detalle se pide después por separado.
		movieIDs = append(movieIDs, pageIDs...)
	}

	return movieIDs, nil
}

// DiscoverDigitalMovies descubre las películas que se ESTRENAN EN DIGITAL (plataforma) en un mes/año
// en la región configurada, y devuelve sus ids. En español: a diferencia de DiscoverMovies (que pide
// estrenos de CINE, tipos 3|2), aquí pedimos los tipos DIGITAL (4) y TV (6) — las películas que llegan
// directo a streaming/TV en México. Así el catálogo cubre también el grueso de estrenos de plataforma
// (que pueden ser ~10 por semana), no solo lo que pasa por salas. Pagina igual que DiscoverMovies.
func (c *Client) DiscoverDigitalMovies(ctx context.Context, year, month int) ([]int, error) {
	firstDay, lastDay := monthDateRange(year, month)
	movieIDs := make([]int, 0)

	totalPages := 1
	for page := 1; page <= totalPages && page <= maxDiscoverPages; page++ {
		query := url.Values{}
		query.Set("region", c.region)
		query.Set("release_date.gte", firstDay)
		query.Set("release_date.lte", lastDay)
		// with_release_type 4|6 = estreno DIGITAL (4) o por TV (6): lo que llega directo a plataforma.
		query.Set("with_release_type", "4|6")
		query.Set("sort_by", "primary_release_date.asc")
		query.Set("language", c.language)
		query.Set("page", strconv.Itoa(page))

		bodyBytes, err := c.doGET(ctx, "/discover/movie", query)
		if err != nil {
			return nil, fmt.Errorf("tmdb: failed to discover digital movies for %04d-%02d page %d: %w", year, month, page, err)
		}

		pageIDs, pageTotal, err := c.parseDiscoverPage(bodyBytes, "/discover/movie (digital)", page)
		if err != nil {
			return nil, fmt.Errorf("tmdb: failed to parse digital discover response for %04d-%02d page %d: %w", year, month, page, err)
		}

		if pageTotal > totalPages {
			totalPages = pageTotal
		}
		movieIDs = append(movieIDs, pageIDs...)
	}

	return movieIDs, nil
}

// DiscoverTV descubre las SERIES QUE EMITEN EPISODIOS en un mes/año, disponibles en MX, y devuelve
// sus ids.
//
// En español: TMDB no acepta `region` en /discover/tv, pero sí `watch_region`=MX +
// `with_watch_monetization_types=flatrate`. Se acota por `air_date.gte/lte`, es decir, por la fecha
// en que la serie EMITE, no por la de su primer episodio.
//
// AVISO SOBRE ESTE COMENTARIO, porque llevaba tiempo mintiendo: hasta ahora decía justo lo
// contrario —"acotamos por first_air_date: SOLO series cuyo primer episodio cae en el mes"— mientras
// el código de abajo pedía `air_date.*` desde hacía versiones. Peor aún, el comentario interno de la
// propia consulta explicaba el cambio a `air_date.*` y sus motivos, así que el archivo se
// contradecía a sí mismo con cuatro líneas de diferencia. Un comentario que dice lo contrario del
// código es peor que ninguno: quien lo lee toma decisiones creyendo un comportamiento que no existe.
//
// El criterio VIGENTE, y por qué: con `first_air_date.*` solo aparecían series ESTRENADAS ese mes, y
// quedaban fuera todas las temporadas nuevas de series ya existentes —que es la mayor parte de lo
// que a la gente le interesa ("vuelve La casa del dragón")—, dejando los meses futuros casi vacíos
// de series. Con `air_date.*` entran también esas temporadas. El precio conocido es que también
// entran series a media temporada; ese sobrante lo filtra después el generador, que se queda solo
// con las que ESTRENAN temporada en el mes (ver SeasonPremiereInMonth y processTV en seedgen).
//
// Verificado el 2026-06-02: watch_region=MX + air_date.* devuelven resultados como aquí se describe.
func (c *Client) DiscoverTV(ctx context.Context, year, month int) ([]int, error) {
	firstDay, lastDay := monthDateRange(year, month)
	tvIDs := make([]int, 0)

	totalPages := 1
	for page := 1; page <= totalPages && page <= maxDiscoverPages; page++ {
		query := url.Values{}
		query.Set("watch_region", c.region)
		query.Set("with_watch_monetization_types", "flatrate")
		// air_date.* acota por la fecha en que la serie EMITE EPISODIOS dentro del mes; el porqué de
		// esta elección y lo que cuesta está explicado entero en el comentario de la función.
		query.Set("air_date.gte", firstDay)
		query.Set("air_date.lte", lastDay)
		query.Set("sort_by", "popularity.desc")
		query.Set("language", c.language)
		query.Set("page", strconv.Itoa(page))

		bodyBytes, err := c.doGET(ctx, "/discover/tv", query)
		if err != nil {
			return nil, fmt.Errorf("tmdb: failed to discover tv for %04d-%02d page %d: %w", year, month, page, err)
		}

		// La forma de la respuesta (page/total_pages/results[].id) es idéntica a la de películas, así
		// que se lee con el mismo lector tolerante.
		pageIDs, pageTotal, err := c.parseDiscoverPage(bodyBytes, "/discover/tv", page)
		if err != nil {
			return nil, fmt.Errorf("tmdb: failed to parse tv discover response for %04d-%02d page %d: %w", year, month, page, err)
		}

		if pageTotal > totalPages {
			totalPages = pageTotal
		}
		tvIDs = append(tvIDs, pageIDs...)
	}

	return tvIDs, nil
}

// Search busca títulos por nombre (GET /search/{movie|tv}) y devuelve las coincidencias.
// En español: la usa la CURADURÍA para resolver el id de TMDB de un título dado por su nombre (cuando
// no se conoce el id). `kind` es "movie" o "tv". Devuelve los resultados crudos; el llamador elige el
// mejor (normalmente el de fecha 2026). NO inventa nada: si no hay coincidencias, la lista viene vacía.
func (c *Client) Search(ctx context.Context, kind, query string) ([]SearchResult, error) {
	values := url.Values{}
	values.Set("query", query)
	values.Set("language", c.language)
	values.Set("include_adult", "false")

	bodyBytes, err := c.doGET(ctx, "/search/"+kind, values)
	if err != nil {
		return nil, fmt.Errorf("tmdb: failed to search %s for %q: %w", kind, query, err)
	}

	searchResponse := &SearchResponse{}
	if err := json.Unmarshal(bodyBytes, searchResponse); err != nil {
		return nil, fmt.Errorf("tmdb: failed to parse %s search for %q: %w", kind, query, err)
	}
	return searchResponse.Results, nil
}

// Images pide la galería de imágenes de un título (GET /{kind}/{id}/images) y devuelve sus backdrops.
// En español: el detalle (movie/tv) NO incluye la galería completa; esta llamada aparte la trae. Pedimos
// imágenes en es/en/null para no quedarnos sin escenas cuando no hay versión en es-MX. `kind` es "movie"
// o "tv". Lo usa el seedgen para poblar la galería de la ficha con escenas reales.
func (c *Client) Images(ctx context.Context, kind string, id int) (*ImageList, error) {
	query := url.Values{}
	query.Set("include_image_language", includeImageLanguageValue)

	path := "/" + kind + "/" + strconv.Itoa(id) + "/images"
	bodyBytes, err := c.doGET(ctx, path, query)
	if err != nil {
		return nil, fmt.Errorf("tmdb: failed to fetch %s images for id %d: %w", kind, id, err)
	}

	images := &ImageList{}
	if err := json.Unmarshal(bodyBytes, images); err != nil {
		return nil, fmt.Errorf("tmdb: failed to parse %s images for id %d: %w", kind, id, err)
	}
	return images, nil
}

// MovieDetails pide el detalle completo de una película (con bloques embebidos) por su id.
// En español: una sola llamada trae los datos básicos más videos, créditos, proveedores y fechas de
// estreno (append_to_response), evitando varias peticiones. Devuelve el detalle ya deserializado.
func (c *Client) MovieDetails(ctx context.Context, id int) (*MovieDetails, error) {
	query := url.Values{}
	// append_to_response embebe varios recursos en una sola respuesta para ahorrar peticiones.
	// "translations" se pide para TODOS los títulos, no solo para los que salen sin sinopsis: viene en la
	// misma petición (no cuesta una llamada extra) y así el resultado no depende de si el texto en español
	// llegó o no. Ver ResolveOverview para el orden en que se elige el idioma.
	query.Set("append_to_response", movieAppendToResponse)
	query.Set("language", c.language)
	query.Set("region", c.region)
	// include_video_language abre los montones de videos por idioma+país que nos interesan. El
	// literal "es-MX" es imprescindible: sin él TMDB no devuelve ni un solo video mexicano (ver la
	// explicación completa y la medición en includeVideoLanguageValue).
	query.Set("include_video_language", includeVideoLanguageValue)

	path := "/movie/" + strconv.Itoa(id)
	bodyBytes, err := c.doGET(ctx, path, query)
	if err != nil {
		return nil, fmt.Errorf("tmdb: failed to fetch movie details for id %d: %w", id, err)
	}

	movieDetails := &MovieDetails{}
	if err := json.Unmarshal(bodyBytes, movieDetails); err != nil {
		return nil, fmt.Errorf("tmdb: failed to parse movie details for id %d: %w", id, err)
	}
	return movieDetails, nil
}

// TVDetails pide el detalle completo de una serie (con bloques embebidos) por su id.
// En español: análogo a MovieDetails pero sobre /tv/{id}. Las series usan claves distintas (name,
// first_air_date) y pueden traer reparto en credits o en aggregate_credits; ambos se deserializan.
func (c *Client) TVDetails(ctx context.Context, id int) (*TVDetails, error) {
	query := url.Values{}
	query.Set("append_to_response", tvAppendToResponse)
	query.Set("language", c.language)
	query.Set("region", c.region)
	// include_video_language abre los montones de videos por idioma+país que nos interesan. El
	// literal "es-MX" es imprescindible: sin él TMDB no devuelve ni un solo video mexicano (ver la
	// explicación completa y la medición en includeVideoLanguageValue).
	query.Set("include_video_language", includeVideoLanguageValue)

	path := "/tv/" + strconv.Itoa(id)
	bodyBytes, err := c.doGET(ctx, path, query)
	if err != nil {
		return nil, fmt.Errorf("tmdb: failed to fetch tv details for id %d: %w", id, err)
	}

	tvDetails := &TVDetails{}
	if err := json.Unmarshal(bodyBytes, tvDetails); err != nil {
		return nil, fmt.Errorf("tmdb: failed to parse tv details for id %d: %w", id, err)
	}
	return tvDetails, nil
}

// SeasonDetails pide UNA temporada de una serie con sus episodios (GET /tv/{id}/season/{n}).
// En español: cada episodio trae su fecha real de emisión (air_date); con ellas la herramienta
// schedulegen arma el calendario de la serie (mensaje Schedule del modelo canónico).
func (c *Client) SeasonDetails(ctx context.Context, tvID, seasonNumber int) (*SeasonDetails, error) {
	query := url.Values{}
	query.Set("language", c.language)

	path := "/tv/" + strconv.Itoa(tvID) + "/season/" + strconv.Itoa(seasonNumber)
	bodyBytes, err := c.doGET(ctx, path, query)
	if err != nil {
		return nil, fmt.Errorf("tmdb: failed to fetch season %d for tv id %d: %w", seasonNumber, tvID, err)
	}

	seasonDetails := &SeasonDetails{}
	if err := json.Unmarshal(bodyBytes, seasonDetails); err != nil {
		return nil, fmt.Errorf("tmdb: failed to parse season %d for tv id %d: %w", seasonNumber, tvID, err)
	}
	return seasonDetails, nil
}

// CollectionDetails pide el detalle de una saga/colección por su id (GET /collection/{id}).
// En español: con el id que trae belongs_to_collection de una película se obtienen aquí todas las
// entradas de la saga, para mapearlas a los CollectionItem del modelo (lo usa el seedgen).
func (c *Client) CollectionDetails(ctx context.Context, id int) (*Collection, error) {
	query := url.Values{}
	query.Set("language", c.language)

	path := "/collection/" + strconv.Itoa(id)
	bodyBytes, err := c.doGET(ctx, path, query)
	if err != nil {
		return nil, fmt.Errorf("tmdb: failed to fetch collection details for id %d: %w", id, err)
	}

	collection := &Collection{}
	if err := json.Unmarshal(bodyBytes, collection); err != nil {
		return nil, fmt.Errorf("tmdb: failed to parse collection details for id %d: %w", id, err)
	}
	return collection, nil
}

// Language devuelve el idioma con el que este cliente pide el contenido (ej. "es-MX").
// En español: el traductor necesita saberlo para poder ANOTAR en qué idioma quedó cada sinopsis. Si el
// texto vino en la petición principal, está en este idioma; si hubo que recurrir a una traducción, la
// etiqueta será otra. Se expone como método de solo lectura para no abrir el campo interno.
func (c *Client) Language() string {
	return c.language
}

// Region devuelve la región configurada (ej. "MX").
// En español: la usa el traductor para preferir, entre varias traducciones al mismo idioma, la del país
// del proyecto: el español de México antes que el de España.
func (c *Client) Region() string {
	return c.region
}

// BuildImageURL construye la URL absoluta de una imagen a partir de su ruta relativa y un tamaño.
// En español: TMDB entrega solo la "cola" de la ruta (ej. "/abc.jpg"); aquí la unimos con la base
// oficial de imágenes y el tamaño pedido (ej. "w500") para formar una URL completa. Si la ruta
// viene vacía (la imagen no existe), devolvemos cadena vacía para no construir una URL inválida.
func (c *Client) BuildImageURL(path, size string) string {
	if path == "" {
		return ""
	}
	// Lectura bajo candado: imageBaseURL puede ser actualizada por Configuration() en otra goroutine.
	c.configMu.RLock()
	base := c.imageBaseURL
	c.configMu.RUnlock()
	return base + size + path
}

// monthDateRange devuelve el primer y el último día (ISO AAAA-MM-DD) de un mes/año dado.
// En español: para acotar el descubrimiento de estrenos por mes necesitamos ambos extremos. El
// primer día siempre es el 01; el último lo obtenemos avanzando al primer día del mes siguiente y
// restando un día, lo que maneja correctamente meses de 28/29/30/31 días (incluido febrero bisiesto).
func monthDateRange(year, month int) (firstDay, lastDay string) {
	// Primer día del mes pedido, a medianoche UTC.
	firstOfMonth := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	// Primer día del mes siguiente; restando un día caemos en el último día del mes pedido.
	firstOfNextMonth := firstOfMonth.AddDate(0, 1, 0)
	lastOfMonth := firstOfNextMonth.AddDate(0, 0, -1)

	const isoDateLayout = "2006-01-02"
	return firstOfMonth.Format(isoDateLayout), lastOfMonth.Format(isoDateLayout)
}
