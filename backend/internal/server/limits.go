package server

// Archivo: limits.go — Límites de protección del servidor (cuota por cliente y tamaño de cuerpo).
// En español: dos "vallas" de robustez que faltaban en el pase de cierre:
//   1) RateLimit: una CUOTA de peticiones por cliente (por IP). Un cliente que dispara cientos de
//      peticiones por minuto recibe 429 ("Too Many Requests") en vez de saturar el backend.
//   2) MaxBodyBytes: un TOPE al tamaño del cuerpo de cada petición. El API solo recibe mensajes
//      pequeños (consultas y login); un cuerpo gigante es, en el mejor caso, un error y, en el peor,
//      un intento de agotar la memoria. Se corta en la puerta.
// Ambos son middleware HTTP estándar (envuelven al handler), así protegen TODAS las rutas (Connect y
// /healthz) sin tocar la lógica de los servicios.

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

// maxRequestBodyBytes es el tamaño máximo permitido del cuerpo de una petición (1 MiB).
// En español: los mensajes reales del API (filtros de catálogo, credenciales) pesan unos pocos KB;
// 1 MiB deja margen de sobra sin permitir cuerpos absurdos.
const maxRequestBodyBytes = 1 << 20

// rateLimitWindow es la ventana de tiempo de la cuota por cliente.
const rateLimitWindow = time.Minute

// rateLimitMaxRequests es cuántas peticiones por ventana se permiten a cada cliente (por IP).
// En español: la home hace ~4 llamadas por carga; 240/min por IP es holgado para uso humano real y
// suficiente para frenar a un cliente que martilla el API en bucle.
const rateLimitMaxRequests = 240

// clientCounterTTL es cuánto conservamos el contador de un cliente inactivo antes de olvidarlo.
// En español: limpieza para que el mapa de contadores no crezca sin límite con IPs que ya no vuelven.
const clientCounterTTL = 5 * time.Minute

// authAttemptWindow es la ventana de la cuota ESTRICTA de las operaciones sensibles de cuenta.
const authAttemptWindow = time.Minute

// authAttemptMaxRequests es cuántas operaciones sensibles de cuenta por ventana se permiten a cada IP.
// En español: un humano que se equivoca de contraseña reintenta un puñado de veces por minuto; una
// máquina probando contraseñas, tokens de restablecimiento o sondeando emails necesita cientos.
// 10/min corta la fuerza bruta (con bcrypt de por medio, probar un diccionario se vuelve inviable)
// sin estorbar a una persona real: nadie cambia su contraseña diez veces en un minuto.
const authAttemptMaxRequests = 10

// clientCounter lleva la cuenta de peticiones de UN cliente dentro de su ventana actual.
type clientCounter struct {
	// windowStart marca el inicio de la ventana vigente; al expirar, el contador se reinicia.
	windowStart time.Time
	// count es cuántas peticiones lleva el cliente dentro de la ventana vigente.
	count int
}

// rateLimiter guarda los contadores por cliente con su candado (acceso concurrente seguro).
// En español: es un contador de "cuántas veces ha llamado cada cliente en su ventana"; los campos
// window y maxRequests permiten reusar la misma pieza con cuotas distintas (la general del API y la
// estricta de autenticación).
type rateLimiter struct {
	mu       sync.Mutex
	counters map[string]*clientCounter
	// lastSweep recuerda cuándo se barrieron por última vez los contadores viejos.
	lastSweep time.Time
	// window es la duración de la ventana de conteo de este limitador.
	window time.Duration
	// maxRequests es el máximo de peticiones permitidas por cliente dentro de la ventana.
	maxRequests int
}

// newRateLimiter crea un limitador con su ventana y su máximo. En español: pequeño constructor para
// que nadie pueda armar un limitador "a medias" (con ventana o máximo en cero, que no limitaría nada).
func newRateLimiter(window time.Duration, maxRequests int) *rateLimiter {
	return &rateLimiter{
		counters:    make(map[string]*clientCounter),
		window:      window,
		maxRequests: maxRequests,
	}
}

// allow decide si la petición de un cliente entra en su cuota (true) o debe rechazarse (false).
// En español: ventana fija por cliente: si su ventana expiró, se reinicia el conteo; si no, se
// incrementa y se compara contra el máximo. También barre contadores viejos de vez en cuando (de
// forma perezosa, sin goroutine de fondo: menos piezas móviles).
func (l *rateLimiter) allow(clientKey string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Barrido perezoso: como mucho una vez por TTL, olvidamos los clientes inactivos.
	if now.Sub(l.lastSweep) > clientCounterTTL {
		for key, counter := range l.counters {
			if now.Sub(counter.windowStart) > clientCounterTTL {
				delete(l.counters, key)
			}
		}
		l.lastSweep = now
	}

	counter, exists := l.counters[clientKey]
	if !exists || now.Sub(counter.windowStart) >= l.window {
		// Cliente nuevo o ventana expirada: arranca una ventana fresca con esta petición.
		l.counters[clientKey] = &clientCounter{windowStart: now, count: 1}
		return true
	}

	counter.count++
	return counter.count <= l.maxRequests
}

// retryAfterSeconds es lo que se le dice a un cliente rechazado sobre cuándo puede volver a probar.
// En español: coincide con la ventana de ambas cuotas (un minuto), que es cuando el contador se
// reinicia de verdad. Orientar a los clientes educados evita que se pongan a reintentar en bucle.
const retryAfterSeconds = "60"

// RateLimit envuelve un handler con la cuota de peticiones por cliente (429 al excederla).
// En español: va en la "puerta" del servidor (antes del enrutador) para proteger todas las rutas.
// El resolvedor decide QUIÉN es el cliente: la dirección de la conexión, o la que anotó un proxy de
// confianza cuando se ha declarado que lo hay (ver clientip.go, y por qué importa muchísimo).
// Cada rechazo se APUNTA en las métricas: un contador que nadie incrementa es una alarma muerta.
func RateLimit(resolver *ClientIPResolver, metrics *Metrics, next http.Handler) http.Handler {
	limiter := newRateLimiter(rateLimitWindow, rateLimitMaxRequests)
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !limiter.allow(resolver.ClientIP(request), time.Now()) {
			metrics.ObserveRateLimited(RateLimitScopeAPI)
			// Retry-After orienta a clientes educados sobre cuándo reintentar (en segundos).
			writer.Header().Set("Retry-After", retryAfterSeconds)
			http.Error(writer, "too many requests", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

// authAttemptSuffixes son los finales de ruta de las operaciones SENSIBLES de cuenta, las que
// merecen la cuota estricta.
//
// En español: la lista de antes solo tenía Login y Register, y eso dejaba fuera cuatro operaciones
// que son igual de golosas para quien ataca. Cada una está aquí por un motivo concreto:
//
//   - Login: probar contraseñas de una cuenta conocida.
//   - Register: sondear qué correos ya tienen cuenta.
//   - RequestPasswordReset: sondear correos por otra puerta, y además inundar de peticiones de
//     restablecimiento a quien administra el servicio.
//   - ResetPassword: probar tokens de restablecimiento al azar. Es una llave maestra temporal de una
//     cuenta, así que adivinarla vale más que adivinar la contraseña.
//   - ChangePassword y DeleteAccount: ambas piden la contraseña actual como confirmación, así que
//     con sesión robada (o con la aplicación abierta y desatendida) se pueden usar para adivinarla.
//
// Qué NO está aquí, y por qué: "Me" y "Logout". Ninguna de las dos recibe un secreto que se pueda
// adivinar (funcionan con el token ya emitido) y "Me" se llama en CADA carga de página, así que
// meterla en una cuota de 10/min rompería la navegación normal de una persona real.
var authAttemptSuffixes = []string{
	"/Login",
	"/Register",
	"/RequestPasswordReset",
	"/ResetPassword",
	"/ChangePassword",
	"/DeleteAccount",
}

// isAuthAttemptPath dice si la ruta corresponde a una operación sensible de cuenta.
func isAuthAttemptPath(path string) bool {
	for _, suffix := range authAttemptSuffixes {
		if strings.HasSuffix(path, suffix) {
			return true
		}
	}
	return false
}

// AuthAttemptLimit envuelve un handler con la cuota ESTRICTA de operaciones de cuenta por IP.
// En español: la cuota general del API (240/min) es holgada a propósito, pero deja pasar ~240 intentos
// de contraseña por minuto — suficiente para fuerza bruta o para sondear qué emails tienen cuenta. Esta
// valla adicional aplica a las operaciones sensibles listadas arriba (10/min por IP) y deja el resto
// del tráfico intacto. Los rechazos se apuntan aparte de los de la cuota general (RateLimitScopeAuth)
// porque significan cosas muy distintas: ver el comentario de RateLimitScope en metrics.go.
func AuthAttemptLimit(resolver *ClientIPResolver, metrics *Metrics, next http.Handler) http.Handler {
	limiter := newRateLimiter(authAttemptWindow, authAttemptMaxRequests)
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if isAuthAttemptPath(request.URL.Path) && !limiter.allow(resolver.ClientIP(request), time.Now()) {
			metrics.ObserveRateLimited(RateLimitScopeAuth)
			// Retry-After orienta a clientes educados sobre cuándo reintentar (en segundos).
			writer.Header().Set("Retry-After", retryAfterSeconds)
			http.Error(writer, "too many auth attempts", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

// MaxBodyBytes envuelve un handler limitando el tamaño del cuerpo de cada petición.
// En español: MaxBytesReader corta la lectura al pasarse del tope y hace que el handler de abajo
// reciba un error claro al leer, en vez de tragarse un cuerpo gigante en memoria.
func MaxBodyBytes(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		request.Body = http.MaxBytesReader(writer, request.Body, maxRequestBodyBytes)
		next.ServeHTTP(writer, request)
	})
}
