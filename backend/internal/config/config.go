// Package config centraliza la lectura de configuración desde variables de entorno.
// En español: aquí se leen los "ajustes" del backend (puerto, tokens y versión) una
// sola vez al arrancar, para que el resto del código no tenga que saber de dónde
// vienen esos valores. Así toda la configuración entra por un único lugar y es fácil
// de auditar.
package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

// defaultPort es el puerto por defecto del servidor HTTP cuando no se define PORT.
// En español: si nadie nos dice en qué puerto escuchar, usamos el 8080, que es el
// que esperan tanto Docker Compose como el frontend.
const defaultPort = "8080"

// defaultSeedPath es la ruta por defecto del archivo semilla del catálogo (seed.json).
// En español: si nadie define SEED_PATH, buscamos el catálogo en "seed/seed.json", relativo al
// directorio de trabajo del proceso. En la imagen de Docker se sobreescribe a la ruta absoluta
// donde se copia el seed; en desarrollo local basta con este valor relativo.
const defaultSeedPath = "seed/seed.json"

// defaultAuthDataPath es la ruta del ANTIGUO archivo de usuarios (users.json).
//
// En español: ya no es donde viven las cuentas —eso ahora es la base de datos—, pero se sigue
// leyendo al arrancar para IMPORTAR de una sola vez las cuentas que hubiera creado la versión
// anterior. Una vez importado, el archivo se renombra a users.json.migrated y esta ruta deja de
// encontrar nada. Ver internal/store/legacy_import.go.
const defaultAuthDataPath = "data/users.json"

// defaultDatabasePath es la ruta por defecto del archivo de base de datos (SQLite).
//
// En español: vive en el mismo directorio ESCRIBIBLE que ya usaba el archivo de cuentas (montado
// como volumen en Docker), así que no hace falta ningún volumen nuevo: las cuentas siguen
// persistiendo entre reinicios exactamente igual que antes, solo que en un formato que sí sabe
// hacer transacciones y borrados en cascada.
const defaultDatabasePath = "data/tsk.db"

// defaultRequireInvite es si, cuando nadie dice lo contrario, hace falta invitación para registrarse.
//
// En español: el valor por defecto es SÍ, y es deliberado. Un despliegue en el que se olvidara
// configurar esta variable quedaría cerrado (nadie entra sin código) en vez de abierto de par en
// par. Cuando la beta se abra al público se pone REQUIRE_INVITE=false de forma explícita.
const defaultRequireInvite = true

// httpsScheme es el prefijo de una dirección web cifrada, con el que se decide si la cookie de
// sesión puede exigir conexión segura.
const httpsScheme = "https://"

// defaultCORSAllowedOrigin es el origen del frontend permitido por CORS cuando no se define el env.
// En español: este default solo aplica al correr el binario SUELTO (go run, sin Compose): asumimos el
// escenario de desarrollo habitual, donde mdm7mo coexiste con btb y su web corre en el puerto 3100.
// Bajo Docker Compose este valor NUNCA se usa: compose.yaml define CORS_ALLOWED_ORIGIN=:3000 (base,
// standalone) y compose.ports.yaml lo cambia a :3100 (coexistencia con btb). La fuente de verdad en
// contenedor es el compose, no esta constante.
const defaultCORSAllowedOrigin = "http://localhost:3100"

// defaultWritableSeedPath es dónde vive el catálogo actualizable si no se configura otra ruta.
// En español: comparte el directorio escribible con las cuentas, que es el único que sobrevive a un
// reinicio del contenedor.
const defaultWritableSeedPath = "data/seed.json"

// defaultCatalogRefreshInterval es cada cuánto el servidor revisa el estado del catálogo si nadie
// configura otra cosa.
//
// En español: un minuto, el mismo valor y por el mismo motivo que explica internal/catalog/watcher.go.
//
// Aquí decía una hora, y ese desacuerdo tenía consecuencias: como este valor es el que gana, la
// constante del vigilante era letra muerta y el problema que aquel archivo describía —instalar un
// catálogo nuevo, ver que el servidor sigue sirviendo el viejo y concluir que la herramienta no
// funcionó— seguía ocurriendo en el despliegue real. Dos sitios con el mismo dato y distinto valor no
// es redundancia: es que uno de los dos miente.
//
// El valor se repite aquí en vez de importar aquel paquete para que la configuración no dependa de la
// lógica del producto; el precio de esa independencia es tener que moverlos a la vez.
const defaultCatalogRefreshInterval = time.Minute

// minCatalogRefreshInterval es lo más seguido que se acepta revisar el catálogo.
//
// En español: existe para que una variable de entorno mal escrita (un "0s" o un "1ns") no convierta
// al vigilante en un bucle que se come una CPU entera sin aportar nada. Un segundo sigue siendo
// absurdamente frecuente para lo que vigila, pero es útil para poder OBSERVAR el mecanismo
// funcionando en una comprobación manual sin esperar una hora.
const minCatalogRefreshInterval = time.Second

// defaultTrustedProxyHops es cuántos proxies de confianza se asumen si no se declara ninguno.
// En español: cero, es decir, "el servidor recibe conexiones directas". Es el valor correcto en
// desarrollo y el ÚNICO seguro por defecto: en cuanto se confía en una cabecera sin haberlo declarado,
// cualquiera puede falsificar su dirección y saltarse los límites de intentos.
const defaultTrustedProxyHops = 0

// buildVersion es la versión del proyecto inyectada en tiempo de compilación.
// En español: este valor se "graba" al construir el binario con la bandera
// -ldflags "-X mdm7mo/internal/config.buildVersion=<X>". Si nadie la inyecta (por
// ejemplo, al correr con `go run` en desarrollo), queda el valor de respaldo de abajo.
// La fuente de verdad de la versión es el archivo VERSION en la raíz del monorepo;
// el Dockerfile lo lee y lo pasa por aquí para no depender de rutas de archivos en
// tiempo de ejecución.
var buildVersion = "0.1.75"

// Config agrupa todos los ajustes del backend leídos del entorno.
// En español: es la "ficha de ajustes" del servidor. Se llena una vez al arrancar y
// luego se pasa a quien la necesite (el servidor, el handler del catálogo, etc.).
type Config struct {
	// Port es el puerto TCP donde el servidor HTTP escucha peticiones.
	// En español: el "número de puerta" por la que entran las peticiones de red.
	Port string

	// Version es la versión del proyecto (esquema propio, ej. "0.0.1").
	// En español: la etiqueta de versión que devolvemos en GetServiceInfo para saber
	// qué build está corriendo.
	Version string

	// SeedPath es la ruta del archivo semilla del catálogo (seed.json) que se carga al arrancar.
	// En español: indica dónde está el archivo con el catálogo curado de Fase 0. El backend lo
	// lee una sola vez al encender para tener los estrenos en memoria. Su valor sale de SEED_PATH
	// o, si no está, del valor por defecto "seed/seed.json".
	SeedPath string

	// TMDBReadToken es el token de lectura de TMDB (Bearer / Read Access Token).
	// En español: la "llave" para consultar la API de TMDB. Es un secreto que vive solo
	// en el servidor. En Sprint 1 se lee pero todavía NO se usa (lo usarán fases
	// posteriores que consultan estrenos reales).
	TMDBReadToken string

	// OMDBAPIKey es la API key de OMDb (fuente de datos opcional, detrás de feature-flag).
	// En español: otra "llave" secreta, opcional. También se lee pero NO se usa aún en S1.
	OMDBAPIKey string

	// SessionSigningKey es la clave secreta con la que se calcula la HUELLA de los tokens que se
	// guardan en la base de datos (sesiones, restablecimientos e invitaciones).
	//
	// En español: los tokens nunca se guardan tal cual, sino convertidos en una huella irreversible
	// calculada CON esta clave. Eso significa que quien obtuviera una copia de la base de datos, pero
	// no esta clave, no podría convertir esas huellas en credenciales utilizables ni comprobar si un
	// código de invitación adivinado es correcto. Es OBLIGATORIA y no tiene valor por defecto: un
	// valor por omisión escrito en el código sería un secreto público. Se valida al arrancar (ver
	// Config.Validate). Ojo si se cambia: al cambiarla, todas las sesiones abiertas, los
	// restablecimientos pendientes y las invitaciones sin canjear dejan de reconocerse.
	SessionSigningKey string

	// AuthDataPath es la ruta del ANTIGUO archivo JSON de cuentas (users.json). Ya no se escribe en
	// él: solo se lee una vez al arrancar para importar a la base de datos las cuentas que hubiera
	// creado la versión anterior, tras lo cual el archivo se renombra. Sale de AUTH_DATA_PATH.
	AuthDataPath string

	// DatabasePath es la ruta del archivo de base de datos donde viven cuentas, sesiones,
	// invitaciones, restablecimientos y perfiles. Sale de DB_PATH o del valor por defecto.
	DatabasePath string

	// RequireInvite dice si hace falta un código de invitación para poder registrarse.
	// En español: es el interruptor de la "alpha cerrada". Sale de REQUIRE_INVITE; por defecto está
	// ACTIVADO, de modo que un despliegue mal configurado queda cerrado y no abierto a cualquiera.
	RequireInvite bool

	// SessionCookieSecure dice si la cookie de sesión exige conexión cifrada (HTTPS).
	//
	// En español: en producción tiene que estar activo o la sesión viajaría legible por la red; en
	// desarrollo local, que va por http sin cifrar, tiene que estar apagado o el navegador nunca
	// mandaría la cookie. Por eso NO se fija a mano: se deduce del origen del frontend configurado
	// (si empieza por https://, se activa). SESSION_COOKIE_SECURE permite forzarlo cuando la
	// deducción no aplica, por ejemplo cuando la web habla con el API a través de su propio dominio
	// y no hay origen cruzado que mirar.
	SessionCookieSecure bool

	// CORSAllowedOrigin es el origen del frontend autorizado a llamar al API desde el navegador (login).
	CORSAllowedOrigin string

	// WritableSeedPath es la ruta del catálogo ACTUALIZABLE (en el directorio escribible).
	// En español: el catálogo tiene fecha de caducidad y hay que poder renovarlo sin reconstruir la
	// imagen del programa. Al arrancar se prefiere este archivo; si no existe, se usa el que viaja
	// dentro de la imagen (SeedPath). Ver internal/catalog/refresher.go.
	WritableSeedPath string

	// TrustedProxyHops es cuántos proxies PROPIOS hay entre el usuario y este servidor.
	// En español: sirve para saber de quién es realmente cada petición cuando hay un proxy delante
	// (ver internal/server/clientip.go). 0 = conexiones directas, que es lo normal en desarrollo y la
	// opción segura: con 0 se ignora la cabecera X-Forwarded-For, que cualquiera puede falsificar.
	// Al desplegar detrás de una plataforma de hosting suele valer 1.
	TrustedProxyHops int

	// CatalogRefreshInterval es cada cuánto el servidor revisa el estado del catálogo.
	//
	// En español: cada cuánto vuelve a contar los días de futuro que le quedan al catálogo (para que
	// la métrica y /readyz no se queden clavados en el valor del arranque) y mira si alguien instaló
	// un catálogo nuevo. Sale de CATALOG_REFRESH_INTERVAL, escrito como duración de Go ("1h", "30m",
	// "5s"). Se puede bajar a segundos para COMPROBAR a mano que el mecanismo funciona sin esperar
	// una hora entera.
	CatalogRefreshInterval time.Duration

	// MetricsAccessKey es la clave que hay que presentar para poder leer /metrics.
	//
	// En español: /metrics no es información pública. Enseña los nombres de todas las operaciones del
	// servicio, cuántas fallan y con qué error, y cuánto lleva el proceso en marcha: un mapa gratis
	// para quien quiera atacarlo. Sale de METRICS_ACCESS_KEY y NO tiene valor por defecto: sin ella,
	// /metrics no se abre para nadie. Se prefiere quedarse fuera uno mismo (y darse cuenta al
	// instante) a dejarlo abierto al mundo sin enterarse — es el mismo criterio que ya se aplica al
	// panel interno de la web. Ojo: esto NO afecta a /healthz ni a /readyz, que siguen siendo
	// públicos porque son justo lo que necesita consultar quien vigila el servicio desde fuera.
	MetricsAccessKey string
}

// minSessionSigningKeyLength es la longitud mínima aceptada para la clave de firma de sesiones.
// En español: una clave HMAC corta se puede adivinar por fuerza bruta y con ella se forjarían
// sesiones de cualquier usuario. 32 caracteres es el mínimo razonable (equivale a "openssl rand
// -hex 16" o mejor; recomendamos "openssl rand -hex 32", que produce 64 caracteres).
const minSessionSigningKeyLength = 32

// Validate comprueba los ajustes OBLIGATORIOS al arrancar. En español: exige la clave de firma de
// sesiones (sin la cual la autenticación no es segura) y que tenga una longitud mínima decente
// (una clave de 2 letras "existe" pero es forjable). Devuelve un error claro para fallar rápido.
func (c Config) Validate() error {
	if c.SessionSigningKey == "" {
		return errMissingSessionSigningKey
	}
	if len(c.SessionSigningKey) < minSessionSigningKeyLength {
		return errShortSessionSigningKey
	}
	return nil
}

// errMissingSessionSigningKey es el error de arranque cuando falta SESSION_SIGNING_KEY.
var errMissingSessionSigningKey = errors.New(
	"config: SESSION_SIGNING_KEY es obligatorio (clave para firmar tokens de sesión)",
)

// errShortSessionSigningKey es el error de arranque cuando SESSION_SIGNING_KEY es demasiado corta
// para ser segura (mínimo 32 caracteres; genera una con "openssl rand -hex 32").
var errShortSessionSigningKey = errors.New(
	"config: SESSION_SIGNING_KEY es demasiado corta (mínimo 32 caracteres; usa 'openssl rand -hex 32')",
)

// Load lee la configuración desde las variables de entorno y devuelve un Config listo.
// En español: esta función mira las variables de entorno del proceso (PORT,
// TMDB_READ_TOKEN, OMDB_API_KEY), aplica valores por defecto sensatos y entrega una
// ficha de ajustes completa. No falla: si algo no está, usa el valor por defecto.
func Load() Config {
	corsAllowedOrigin := getEnvOrDefault("CORS_ALLOWED_ORIGIN", defaultCORSAllowedOrigin)

	return Config{
		// Si PORT no está definido o viene vacío, usamos el puerto por defecto.
		Port: getEnvOrDefault("PORT", defaultPort),
		// La versión la trae el binario (inyectada por ldflags) o el respaldo de arriba.
		Version: buildVersion,
		// La ruta del seed sale de SEED_PATH; si no está, usamos la ruta relativa por defecto.
		SeedPath: getEnvOrDefault("SEED_PATH", defaultSeedPath),
		// Los secretos se leen tal cual; si no existen, quedan como cadena vacía.
		TMDBReadToken: os.Getenv("TMDB_READ_TOKEN"),
		OMDBAPIKey:    os.Getenv("OMDB_API_KEY"),
		// Clave de firma de sesiones (obligatoria; se valida en Validate). Recortamos espacios accidentales.
		SessionSigningKey: strings.TrimSpace(os.Getenv("SESSION_SIGNING_KEY")),
		// Ruta del archivo de cuentas ANTIGUO (solo para importarlo) y origen CORS.
		AuthDataPath:      getEnvOrDefault("AUTH_DATA_PATH", defaultAuthDataPath),
		CORSAllowedOrigin: corsAllowedOrigin,
		// Ruta de la base de datos, interruptor de la alpha cerrada y seguridad de la cookie.
		DatabasePath:  getEnvOrDefault("DB_PATH", defaultDatabasePath),
		RequireInvite: getEnvBoolOrDefault("REQUIRE_INVITE", defaultRequireInvite),
		// La cookie exige HTTPS si el frontend configurado ya habla por HTTPS; se puede forzar con
		// SESSION_COOKIE_SECURE cuando no hay origen cruzado del que deducirlo.
		SessionCookieSecure: getEnvBoolOrDefault(
			"SESSION_COOKIE_SECURE",
			strings.HasPrefix(strings.ToLower(corsAllowedOrigin), httpsScheme),
		),
		// Número de proxies de confianza. Si la variable no es un número válido, se asume 0 (sin
		// proxy): ante una configuración dudosa, la opción segura es no fiarse de ninguna cabecera.
		WritableSeedPath: getEnvOrDefault("WRITABLE_SEED_PATH", defaultWritableSeedPath),
		TrustedProxyHops: getEnvIntOrDefault("TRUSTED_PROXY_HOPS", defaultTrustedProxyHops),
		// Cada cuánto se revisa el catálogo, y la clave para poder leer /metrics (sin clave, cerrado).
		CatalogRefreshInterval: getEnvDurationOrDefault(
			"CATALOG_REFRESH_INTERVAL",
			defaultCatalogRefreshInterval,
			minCatalogRefreshInterval,
		),
		MetricsAccessKey: strings.TrimSpace(os.Getenv("METRICS_ACCESS_KEY")),
	}
}

// getEnvDurationOrDefault lee una variable de entorno como duración de tiempo ("1h", "30m", "5s").
//
// En español: si la variable no está, no se entiende o queda por debajo del mínimo aceptable,
// devuelve el valor por defecto. El mínimo existe porque hay duraciones que son sintácticamente
// válidas pero operativamente absurdas (revisar algo cada nanosegundo quemaría una CPU entera): ante
// una configuración dudosa se aplica el valor sensato en vez de obedecer al pie de la letra.
func getEnvDurationOrDefault(key string, fallback, minimum time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value < minimum {
		return fallback
	}
	return value
}

// getEnvIntOrDefault lee una variable de entorno como número entero.
// En español: si la variable no está, está vacía, no es un número o es negativa, devuelve el valor por
// defecto. Nunca falla: una configuración mal escrita no debe impedir que el servidor arranque, pero
// tampoco debe interpretarse de forma creativa.
func getEnvIntOrDefault(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return fallback
	}
	return value
}

// getEnvBoolOrDefault lee una variable de entorno como interruptor de sí/no.
//
// En español: acepta las formas habituales de escribir un sí o un no ("true"/"false", "1"/"0",
// "yes"/"no", "on"/"off"), sin distinguir mayúsculas. Si la variable no está o dice algo que no se
// entiende, devuelve el valor por defecto: una configuración mal escrita no debe impedir arrancar,
// pero tampoco debe interpretarse de forma creativa (por ejemplo, tomar "quizá" como un sí y abrir
// el registro a cualquiera).
func getEnvBoolOrDefault(key string, fallback bool) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch raw {
	case "true", "1", "yes", "y", "on":
		return true
	case "false", "0", "no", "n", "off":
		return false
	default:
		return fallback
	}
}

// getEnvOrDefault devuelve el valor de una variable de entorno o un valor por defecto.
// En español: pequeño ayudante que evita repetir el patrón "si la variable está vacía,
// usa este otro valor". También recorta espacios para tolerar configuraciones con
// espacios accidentales alrededor del valor.
func getEnvOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}
