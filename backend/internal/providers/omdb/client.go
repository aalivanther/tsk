// Package omdb es el cliente del proveedor OMDb (Open Movie Database), usado para ENRIQUECER las
// calificaciones de un estreno con datos de IMDb, Rotten Tomatoes y Metacritic.
// En español: OMDb es una fuente COMPLEMENTARIA y OPCIONAL. La rareza del proyecto se deriva de la
// calificación de TMDB (que siempre está); OMDb solo añade, cuando se puede, esas tres
// calificaciones extra de texto. Por eso este cliente está detrás de un "feature-flag": si no hay
// API key configurada, OMDb queda DESACTIVADO y nunca se llama a la red. Cuando sí hay key, este
// paquete arma la petición correcta, la lanza y traduce la respuesta a un Result sencillo.
//
// Cumplimiento legal: OMDb se publica bajo licencia CC BY-NC 4.0 (atribución + uso no comercial),
// compatible con el carácter no comercial del proyecto. La UI debe atribuir a OMDb y declarar que
// NO está avalada por IMDb.com ni afiliada a ella. El tier gratuito tiene un límite de 1000
// peticiones al día, por eso el enriquecimiento se hace al generar el seed (no en tiempo real) y
// degrada elegante: si OMDb falla o devuelve "N/A", simplemente no se añade el dato extra.
package omdb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// BaseURL es la raíz de la API de OMDb (verificada el 2026-05-30).
// En español: todas las peticiones cuelgan de esta dirección.
const BaseURL = "https://www.omdbapi.com/"

// defaultHTTPTimeout es el tiempo máximo que esperamos por una respuesta de OMDb.
// En español: si OMDb no contesta en este plazo, abortamos la petición en vez de colgarnos para
// siempre. 15 segundos es holgado pero protege ante caídas o redes lentas.
const defaultHTTPTimeout = 15 * time.Second

// notAvailableValue es el texto que OMDb usa para "dato ausente".
// En español: OMDb devuelve la cadena "N/A" cuando no tiene un valor (a veces incluso para datos
// que existen, es una limitación conocida de su API). Lo tratamos SIEMPRE como vacío.
const notAvailableValue = "N/A"

// Estas constantes son los nombres EXACTOS de cada fuente dentro del array Ratings[] de OMDb.
// En español: OMDb agrupa las calificaciones extra en una lista, y cada entrada se identifica por su
// "Source" (su nombre de fuente). Comparamos contra estos textos literales para extraer la que toca.
const (
	// sourceRottenTomatoes es el nombre con el que OMDb etiqueta la calificación de Rotten Tomatoes.
	sourceRottenTomatoes = "Rotten Tomatoes"
	// sourceMetacritic es el nombre con el que OMDb etiqueta la calificación de Metacritic.
	sourceMetacritic = "Metacritic"
)

// ErrDisabled indica que el cliente está DESACTIVADO porque no se configuró una API key.
// En español: es un error "sentinela" (uno que el llamador puede reconocer con errors.Is) para
// distinguir "OMDb está apagado a propósito" de "OMDb falló de verdad". El seedgen lo usa para
// saltarse el enriquecimiento sin tratarlo como un fallo real.
var ErrDisabled = errors.New("omdb: client is disabled because no API key was configured")

// Client es el cliente HTTP que consulta la API de OMDb.
// En español: guarda lo necesario para hablar con OMDb de forma consistente: el cliente HTTP (con su
// timeout), la URL base (inyectable en pruebas) y la API key. La key es un secreto: OMDb obliga a
// pasarla en la URL (no acepta cabecera), así que tenemos especial cuidado de NUNCA loguear la URL
// completa con la key dentro (solo se loguea el imdbID).
type Client struct {
	// httpClient es el cliente HTTP subyacente (con su timeout) que hace las peticiones de red.
	httpClient *http.Client
	// baseURL es la raíz de la API; se puede inyectar otra en pruebas (servidor httptest).
	baseURL string
	// apiKey es la llave de OMDb. Es un secreto: viaja en la query (OMDb lo exige) y nunca se loguea.
	apiKey string
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
// En español: en producción se usa BaseURL (la API real de OMDb); en pruebas apuntamos a un
// servidor local que devuelve JSON fijo, sin tocar la red.
func WithBaseURL(baseURL string) Option {
	return func(client *Client) {
		client.baseURL = baseURL
	}
}

// NewClient construye un Client de OMDb con valores por defecto y aplica las opciones recibidas.
// En español: crea el cliente listo para usar. Por defecto trae un cliente HTTP con tiempo de espera
// de 15s y la URL base de la API real. Si la API key viene vacía, el cliente queda DESACTIVADO (ver
// Enabled): es válido crearlo así, simplemente no llamará a la red.
func NewClient(apiKey string, options ...Option) *Client {
	client := &Client{
		httpClient: &http.Client{Timeout: defaultHTTPTimeout},
		baseURL:    BaseURL,
		apiKey:     apiKey,
	}

	// Aplicamos cada opción en orden, para que las personalizaciones pisen los valores por defecto.
	for _, applyOption := range options {
		applyOption(client)
	}

	return client
}

// Enabled indica si el cliente está activo (tiene API key) y por tanto puede llamar a OMDb.
// En español: es el "feature-flag". Devuelve true solo si hay una API key configurada. Si devuelve
// false, OMDb está desactivado a propósito y NO se debe llamar a la red: ByIMDbID devolverá
// ErrDisabled sin hacer ninguna petición.
func (c *Client) Enabled() bool {
	return c.apiKey != ""
}

// Result son las calificaciones extra de un título según OMDb, ya limpias y listas para usar.
// En español: tres textos opcionales. Cada uno queda en cadena vacía ("") si OMDb no lo trae o si lo
// devuelve como "N/A". Así el llamador no tiene que volver a tratar el caso "N/A": ya viene resuelto.
type Result struct {
	// IMDb es la calificación de IMDb (ej. "8.3"); vacío si OMDb no la trae o la da como "N/A".
	IMDb string
	// RottenTomatoes es el porcentaje de Rotten Tomatoes (ej. "95%"); vacío si falta o es "N/A".
	RottenTomatoes string
	// Metacritic es el puntaje de Metacritic (ej. "78/100" o "78"); vacío si falta o es "N/A".
	Metacritic string
}

// omdbRating es una entrada del array Ratings[] de la respuesta de OMDb.
// En español: cada entrada tiene una fuente ("Source", ej. "Rotten Tomatoes") y un valor ("Value",
// ej. "95%"). Recorremos la lista para extraer las fuentes que nos interesan.
type omdbRating struct {
	// Source es el nombre de la fuente de la calificación (ej. "Rotten Tomatoes", "Metacritic").
	Source string `json:"Source"`
	// Value es la calificación en texto tal como la entrega esa fuente (ej. "95%", "78/100").
	Value string `json:"Value"`
}

// omdbResponse es la respuesta de OMDb a una consulta por IMDb ID.
// En español: solo leemos los campos que usamos. "Response" indica si la consulta tuvo éxito ("True"
// o "False"); "Error" trae el motivo cuando Response es "False"; "imdbRating" es la calificación de
// IMDb; y "Ratings" es la lista con Rotten Tomatoes y Metacritic (entre otras).
type omdbResponse struct {
	// Response es "True" si la consulta encontró el título, o "False" si hubo un problema.
	Response string `json:"Response"`
	// Error trae el mensaje de error de OMDb cuando Response es "False" (ej. "Incorrect IMDb ID.").
	Error string `json:"Error"`
	// ImdbRating es la calificación de IMDb (texto, ej. "8.3"); puede venir "N/A".
	ImdbRating string `json:"imdbRating"`
	// Ratings es la lista de calificaciones por fuente (IMDb, Rotten Tomatoes, Metacritic...).
	Ratings []omdbRating `json:"Ratings"`
}

// ByIMDbID consulta OMDb por el IMDb ID de un título y devuelve sus calificaciones extra limpias.
// En español: este es el método principal. Pasos:
//  1. Si el cliente está desactivado (sin API key), devuelve ErrDisabled SIN tocar la red.
//  2. Si el imdbID viene vacío, es un error de uso (no hay nada que consultar).
//  3. Arma la URL "BaseURL?i=<imdbID>&apikey=<key>". La key va en la query porque OMDb lo EXIGE
//     (no acepta cabecera de autorización), así que NUNCA logueamos la URL completa: en logs solo
//     aparece el imdbID, jamás la key.
//  4. Lanza la petición, lee el cuerpo y lo deserializa.
//  5. Si OMDb responde Response="False", devuelve un error con el campo Error que OMDb explicó.
//  6. Mapea imdbRating a IMDb y, recorriendo Ratings[], extrae Rotten Tomatoes y Metacritic.
//     Cualquier valor ausente o "N/A" queda como cadena vacía.
func (c *Client) ByIMDbID(ctx context.Context, imdbID string) (*Result, error) {
	// Feature-flag: sin API key, OMDb está apagado. No tocamos la red; devolvemos el sentinela.
	if !c.Enabled() {
		return nil, ErrDisabled
	}

	// Validación de entrada: sin imdbID no hay nada que consultar.
	if imdbID == "" {
		return nil, fmt.Errorf("omdb: imdbID must not be empty")
	}

	// Armamos los parámetros de consulta. La key va aquí porque OMDb lo exige; por eso esta URL es
	// SENSIBLE y no debe loguearse completa. url.Values se encarga de codificar los valores.
	query := url.Values{}
	query.Set("i", imdbID)
	query.Set("apikey", c.apiKey)
	fullURL := c.baseURL + "?" + query.Encode()

	// Creamos la petición ligada al contexto, para que se cancele si el contexto se cancela.
	// Nota: el mensaje de error usa solo el imdbID, nunca fullURL (que lleva la key).
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
	if err != nil {
		// redactURLError quita la URL (que lleva la apikey) del error antes de propagarlo.
		return nil, fmt.Errorf("omdb: failed to build request for imdbID %q: %w", imdbID, redactURLError(err))
	}
	request.Header.Set("Accept", "application/json")

	// Ejecutamos la petición.
	response, err := c.httpClient.Do(request)
	if err != nil {
		// CRÍTICO: un fallo de transporte (timeout, conexión rechazada) llega como *url.Error, cuyo
		// texto incrusta la URL COMPLETA —y con ella la apikey—. redactURLError descarta esa URL y
		// deja solo la causa ("context deadline exceeded", etc.), para que el secreto JAMÁS llegue al log.
		return nil, fmt.Errorf("omdb: request for imdbID %q failed: %w", imdbID, redactURLError(err))
	}

	// Leemos el cuerpo y cerramos al terminar (sin tragar el error de lectura).
	bodyBytes, readErr := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if readErr != nil {
		return nil, fmt.Errorf("omdb: failed to read response body for imdbID %q: %w", imdbID, readErr)
	}

	// Cualquier código fuera del rango 2xx es un fallo HTTP: devolvemos el código (sin volcar la key).
	// Además intentamos rescatar el motivo que OMDb pone en el cuerpo (ej. con HTTP 401 manda
	// {"Response":"False","Error":"Request limit reached!"}). Así, si se agota la cuota de 1000/día,
	// el motivo queda visible en el warning del log, sin exponer la URL ni la apikey.
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		reason := ""
		errorBody := &omdbResponse{}
		if json.Unmarshal(bodyBytes, errorBody) == nil && errorBody.Error != "" {
			reason = ": " + errorBody.Error
		}
		return nil, fmt.Errorf("omdb: unexpected status %d for imdbID %q%s", response.StatusCode, imdbID, reason)
	}

	// Deserializamos el JSON a nuestro molde.
	parsed := &omdbResponse{}
	if err := json.Unmarshal(bodyBytes, parsed); err != nil {
		return nil, fmt.Errorf("omdb: failed to parse response for imdbID %q: %w", imdbID, err)
	}

	// OMDb marca el éxito con Response="True". Si es "False", reportamos el motivo que OMDb dio.
	if parsed.Response != "True" {
		return nil, fmt.Errorf("omdb: lookup failed for imdbID %q: %s", imdbID, parsed.Error)
	}

	// Construimos el Result ya limpio: imdbRating directo (tratando "N/A" como vacío) y las otras dos
	// fuentes extraídas del array Ratings[] por su nombre de fuente.
	result := &Result{
		IMDb:           cleanValue(parsed.ImdbRating),
		RottenTomatoes: cleanValue(findRatingBySource(parsed.Ratings, sourceRottenTomatoes)),
		Metacritic:     cleanValue(findRatingBySource(parsed.Ratings, sourceMetacritic)),
	}
	return result, nil
}

// redactURLError quita la URL sensible de un error de red de la librería http.
// En español: cuando una petición falla por transporte (timeout, conexión rechazada), Go devuelve
// un *url.Error cuyo texto INCLUYE la URL completa —y nuestra URL de OMDb lleva la apikey en la
// query—. Esta función detecta ese tipo de error y devuelve solo su causa interna (urlErr.Err, ej.
// "context deadline exceeded"), descartando la URL para que la key nunca termine en un log o mensaje.
// Si el error no es un *url.Error, lo devuelve tal cual.
func redactURLError(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return urlErr.Err
	}
	return err
}

// findRatingBySource busca en el array Ratings[] la calificación de una fuente concreta.
// En español: recorre la lista y devuelve el "Value" de la entrada cuya "Source" coincide con el
// nombre pedido (ej. "Rotten Tomatoes"). Si esa fuente no aparece, devuelve cadena vacía.
func findRatingBySource(ratings []omdbRating, source string) string {
	for _, rating := range ratings {
		if rating.Source == source {
			return rating.Value
		}
	}
	return ""
}

// cleanValue normaliza un valor de OMDb: deja vacío lo ausente o lo que venga como "N/A".
// En español: OMDb usa "N/A" para "no hay dato" (a veces incluso cuando el dato existe). Aquí lo
// convertimos SIEMPRE en cadena vacía, para que el resto del código no tenga que volver a tratarlo.
// También recortamos espacios para no guardar valores con relleno.
func cleanValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == notAvailableValue {
		return ""
	}
	return trimmed
}
