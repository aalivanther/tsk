package server

// Archivo: metrics_access.go — El portero de /metrics.
//
// En español: /metrics estaba abierto a cualquiera que supiera la dirección del servidor, y eso no
// es una cifra inocente. Ahí dentro se leen los nombres exactos de TODAS las operaciones del
// servicio (el mapa completo del API, incluidas las de cuentas), cuántas veces falla cada una y con
// qué error, cuánto tarda y cuánto lleva el proceso en marcha. Es información de reconocimiento
// gratuita para quien quiera atacar el servicio, y además delata patrones de uso.
//
// La decisión tomada y por qué:
//
//   - Se protege con una CLAVE que viaja en la cabecera Authorization ("Bearer <clave>"). Es el
//     mecanismo que ya entienden de fábrica Prometheus (bearer_token), Grafana Agent y un simple
//     curl, así que no obliga a inventar nada ni a instalar un proxy delante.
//   - Sin clave configurada, /metrics queda CERRADO para todo el mundo. Es deliberado y es el mismo
//     criterio que ya sigue el panel interno de la web: se prefiere quedarse fuera uno mismo —y
//     enterarse en el acto— a dejar la puerta abierta al mundo sin darse cuenta. El caso contrario
//     (abierto si no hay clave) significaría que un despliegue al que se le olvide la variable queda
//     expuesto, que es exactamente el fallo que se está corrigiendo.
//   - NO se protegen /healthz ni /readyz, y no es un olvido. /healthz es lo que ejecuta el
//     healthcheck de Docker, que no puede llevar credenciales; y ambos existen precisamente para que
//     alguien de fuera pueda preguntar "¿estás bien?" sin más. Lo que devuelven —"ok" y los días de
//     catálogo que quedan— no dice nada que sirva para atacar el servicio.

import (
	"crypto/subtle"
	"log/slog"
	"net/http"
	"strings"
)

// metricsAuthorizationScheme es el prefijo que precede a la clave en la cabecera Authorization.
const metricsAuthorizationScheme = "Bearer "

// authorizationHeader es el nombre de la cabecera por la que viaja la clave de /metrics.
const authorizationHeader = "Authorization"

// corsAllowOriginHeader y corsAllowCredentialsHeader son las cabeceras de CORS que se RETIRAN de la
// respuesta de /metrics (ver el comentario dentro de MetricsGuard).
const (
	corsAllowOriginHeader      = "Access-Control-Allow-Origin"
	corsAllowCredentialsHeader = "Access-Control-Allow-Credentials"
)

// metricsClosedMessage es lo que se responde cuando no hay clave configurada.
const metricsClosedMessage = "metrics are closed: no METRICS_ACCESS_KEY is configured on this server\n"

// metricsUnauthorizedMessage es lo que se responde cuando la clave presentada no es la correcta.
const metricsUnauthorizedMessage = "metrics require a valid access key in the Authorization header\n"

// MetricsGuard envuelve el handler de métricas exigiendo la clave de acceso configurada.
//
// En español: si la clave no está configurada, nadie entra. Si está, hay que presentarla en la
// cabecera Authorization como "Bearer <clave>". La comparación se hace en tiempo constante: comparar
// dos textos con el operador normal tarda más cuanto más coinciden por delante, y esa diferencia de
// tiempo, medida muchas veces, permite adivinar la clave letra a letra. subtle.ConstantTimeCompare
// tarda siempre lo mismo y cierra esa puerta.
func MetricsGuard(accessKey string, next http.Handler) http.Handler {
	trimmedKey := strings.TrimSpace(accessKey)

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		// /metrics no es un API de navegador: ninguna página web tiene por qué poder leerlo. Las
		// cabeceras de CORS las pone el middleware de más afuera (que envuelve TODAS las rutas), así
		// que aquí se retiran para esta respuesta concreta. Importa especialmente Allow-Credentials:
		// combinado con un origen permitido, es lo que dejaría a una pestaña abierta del frontend
		// leer las métricas enteras desde el navegador de cualquiera.
		writer.Header().Del(corsAllowOriginHeader)
		writer.Header().Del(corsAllowCredentialsHeader)

		if trimmedKey == "" {
			// Cerrado por configuración. Se responde 503 y no 401 porque el problema no es de quien
			// pregunta —no hay ninguna clave que pudiera presentar—, sino del servidor, al que le
			// falta un ajuste. Decirlo con claridad ahorra media hora de búsqueda a quien opera.
			writeMetricsRefusal(writer, request, http.StatusServiceUnavailable, metricsClosedMessage)
			return
		}

		// Se EXIGE el esquema "Bearer " y no se acepta la clave a secas. Aceptar las dos formas sería
		// más cómodo, pero un contrato con dos maneras válidas de hacer lo mismo acaba en que cada
		// herramienta usa una y nadie sabe cuál es la buena. Que falte el esquema no es un secreto, así
		// que comprobarlo antes que la clave no delata nada.
		authorization := request.Header.Get(authorizationHeader)
		if !strings.HasPrefix(authorization, metricsAuthorizationScheme) {
			writeMetricsRefusal(writer, request, http.StatusUnauthorized, metricsUnauthorizedMessage)
			return
		}

		presented := strings.TrimPrefix(authorization, metricsAuthorizationScheme)
		if subtle.ConstantTimeCompare([]byte(presented), []byte(trimmedKey)) != 1 {
			writeMetricsRefusal(writer, request, http.StatusUnauthorized, metricsUnauthorizedMessage)
			return
		}

		next.ServeHTTP(writer, request)
	})
}

// writeMetricsRefusal responde un rechazo de /metrics con su motivo en texto plano.
//
// En español: se separa en su propia función para que las dos negativas se escriban exactamente
// igual y ninguna se olvide de registrar un fallo de escritura.
func writeMetricsRefusal(writer http.ResponseWriter, request *http.Request, status int, message string) {
	writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
	writer.WriteHeader(status)
	if _, err := writer.Write([]byte(message)); err != nil {
		slog.Default().Warn(
			"failed to write the metrics refusal response",
			slog.String("remote_addr", request.RemoteAddr),
			slog.String("error", err.Error()),
		)
	}
}
