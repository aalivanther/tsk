package server

// Archivo: metrics.go — Las MÉTRICAS del servidor: números que dicen cómo va el servicio.
//
// En español: los registros (logs) cuentan qué pasó en una petición concreta; las métricas cuentan
// cómo va el servicio EN CONJUNTO ("¿cuántas llamadas atendí?", "¿cuántas fallaron?", "¿cuánto
// tardan?", "¿al catálogo le quedan días de vida?"). Sin ellas, la única forma de enterarse de que
// algo va mal es que alguien se queje.
//
// Se exponen en /metrics con el formato de texto de Prometheus, que es el estándar de facto: lo
// entienden Prometheus, Grafana y prácticamente cualquier herramienta de monitoreo, incluidos los
// planes gratuitos. Se implementa a mano, SIN añadir la librería oficial, por dos motivos: el conjunto
// de métricas es pequeño y conocido, y así el binario no crece ni suma dependencias que auditar.
//
// IMPORTANTE sobre el formato: los nombres y etiquetas siguen la convención de Prometheus
// (sufijo _total para contadores, _seconds para duraciones, histograma con buckets acumulativos).

import (
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// latencyBucketsSeconds son los cortes del histograma de duración de las llamadas, en segundos.
// En español: un histograma cuenta cuántas llamadas cayeron por debajo de cada corte. Estos valores
// cubren desde lo instantáneo (1 ms) hasta lo preocupante (5 s), que es el rango útil para este API:
// las lecturas del catálogo viven en memoria y responden en milisegundos.
var latencyBucketsSeconds = []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5}

// RateLimitScope dice QUÉ valla rechazó una petición por exceso de peticiones.
//
// En español: separar las dos vallas en la misma métrica es lo que la hace útil de verdad. Un pico
// en la cuota general significa casi siempre que alguien está raspando el catálogo en bucle —molesto
// pero inofensivo—. Un pico en la cuota de autenticación significa que alguien está probando
// contraseñas o sondeando qué correos tienen cuenta, que es un incidente de seguridad. Sin la
// distinción, ambas cosas se ven exactamente igual desde fuera y la alarma no sirve para decidir.
type RateLimitScope string

const (
	// RateLimitScopeAPI es la cuota general del API (todas las rutas, 240/min por cliente).
	RateLimitScopeAPI RateLimitScope = "api"
	// RateLimitScopeAuth es la cuota estricta de las operaciones sensibles de cuenta (10/min por IP).
	RateLimitScopeAuth RateLimitScope = "auth"
)

// rateLimitScopes son todas las vallas conocidas, en el orden en que se publican.
//
// En español: se publican SIEMPRE las dos, aunque valgan cero. Una serie que no existe no se puede
// vigilar: quien monta una alarma sobre "los rechazos de autenticación suben" necesita que la línea
// esté ahí desde el primer segundo, no que aparezca de repente el día del ataque.
var rateLimitScopes = []RateLimitScope{RateLimitScopeAPI, RateLimitScopeAuth}

// procedureKey identifica una serie de métricas: el procedimiento llamado y con qué código terminó.
type procedureKey struct {
	// procedure es la ruta del RPC (por ejemplo "/mdm7mo.catalog.v1.CatalogService/ListReleases").
	procedure string
	// code es el resultado: "ok" si fue bien, o el código de error de Connect si falló.
	code string
}

// procedureStats acumula lo observado de una serie: cuántas llamadas, cuánto tiempo y su histograma.
type procedureStats struct {
	// count es cuántas llamadas se han atendido en esta serie.
	count uint64
	// sumSeconds es la suma de todas sus duraciones (con count da la media).
	sumSeconds float64
	// buckets[i] es cuántas llamadas duraron MENOS que latencyBucketsSeconds[i].
	buckets []uint64
}

// Metrics guarda todos los contadores del servidor. Es seguro usarlo desde varias goroutines.
// En español: cada petición que entra escribe aquí, y todas entran en paralelo, así que el acceso va
// protegido por un candado. Las operaciones son sumas muy breves: el candado no frena el servicio.
type Metrics struct {
	mu sync.Mutex
	// byProcedure acumula las estadísticas de cada procedimiento y resultado.
	byProcedure map[procedureKey]*procedureStats
	// rateLimitedByScope cuenta cuántas peticiones rechazó (con un 429) cada una de las dos vallas.
	rateLimitedByScope map[RateLimitScope]uint64
	// panicsRecovered cuenta cuántos pánicos atrapó el interceptor de recuperación. Debería ser 0
	// siempre; cualquier valor mayor es una señal de alarma que merece investigación inmediata.
	panicsRecovered uint64
	// catalogReleases es cuántos estrenos tiene cargado el catálogo ahora mismo.
	catalogReleases int
	// catalogDaysRemaining es cuántos días faltan para que el catálogo se quede sin futuro que
	// mostrar. En español: es LA métrica de este producto — cuando llega a cero, la línea de tiempo
	// se ve vacía aunque el servicio esté perfectamente "vivo". Permite avisar con semanas de margen.
	catalogDaysRemaining int
	// startedAt marca cuándo arrancó el proceso, para exponer su tiempo en marcha.
	startedAt time.Time
}

// NewMetrics crea el registro de métricas de un servidor recién arrancado.
func NewMetrics() *Metrics {
	return &Metrics{
		byProcedure:        make(map[procedureKey]*procedureStats),
		rateLimitedByScope: make(map[RateLimitScope]uint64, len(rateLimitScopes)),
		startedAt:          time.Now(),
	}
}

// ObserveCall registra una llamada atendida: su procedimiento, su resultado y cuánto tardó.
func (m *Metrics) ObserveCall(procedure, code string, duration time.Duration) {
	seconds := duration.Seconds()

	m.mu.Lock()
	defer m.mu.Unlock()

	key := procedureKey{procedure: procedure, code: code}
	stats, exists := m.byProcedure[key]
	if !exists {
		stats = &procedureStats{buckets: make([]uint64, len(latencyBucketsSeconds))}
		m.byProcedure[key] = stats
	}
	stats.count++
	stats.sumSeconds += seconds
	for index, upperBound := range latencyBucketsSeconds {
		if seconds <= upperBound {
			stats.buckets[index]++
		}
	}
}

// ObserveRateLimited registra que una petición fue rechazada por exceder su cuota, indicando cuál de
// las dos vallas la rechazó. La llaman los middleware RateLimit y AuthAttemptLimit (ver limits.go).
func (m *Metrics) ObserveRateLimited(scope RateLimitScope) {
	m.mu.Lock()
	m.rateLimitedByScope[scope]++
	m.mu.Unlock()
}

// RateLimitedCount devuelve cuántas peticiones ha rechazado una valla concreta.
// En español: existe para que las pruebas puedan comprobar que el contador se mueve de verdad sin
// tener que leer y descifrar el texto completo de /metrics.
func (m *Metrics) RateLimitedCount(scope RateLimitScope) uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.rateLimitedByScope[scope]
}

// ObservePanicRecovered registra que se atrapó un pánico dentro de un handler.
func (m *Metrics) ObservePanicRecovered() {
	m.mu.Lock()
	m.panicsRecovered++
	m.mu.Unlock()
}

// SetCatalogState actualiza el estado del catálogo: cuántos estrenos tiene y cuántos días de futuro
// le quedan. Lo llama quien carga o recarga el catálogo.
func (m *Metrics) SetCatalogState(releases, daysRemaining int) {
	m.mu.Lock()
	m.catalogReleases = releases
	m.catalogDaysRemaining = daysRemaining
	m.mu.Unlock()
}

// CatalogDaysRemaining devuelve los días de futuro que le quedan al catálogo (lo usa /readyz).
func (m *Metrics) CatalogDaysRemaining() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.catalogDaysRemaining
}

// Handler devuelve el handler HTTP que expone las métricas en formato de texto de Prometheus.
//
// En español: quien monte esta ruta debe envolverla con MetricsGuard (ver metrics_access.go). Este
// handler NO comprueba ninguna credencial a propósito: su único trabajo es escribir los números, y
// mezclar aquí el control de acceso haría más difícil ver que ninguno de los dos tiene un hueco.
func (m *Metrics) Handler() http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		if _, err := writer.Write([]byte(m.render())); err != nil {
			// Si el cliente cortó la conexión a media escritura no hay nada que se pueda hacer con la
			// respuesta —ya no hay a quién responder—, pero tampoco se silencia: queda registrado como
			// aviso. Es un aviso y no un error porque la causa habitual (alguien pulsó Ctrl+C en medio
			// de un curl) es completamente normal; lo que interesa es poder verlo si ocurre a menudo,
			// porque entonces ya no sería normal sino una red que corta conexiones.
			slog.Default().Warn(
				"failed to write the metrics response",
				slog.String("remote_addr", request.RemoteAddr),
				slog.String("error", err.Error()),
			)
		}
	})
}

// render construye el texto completo de las métricas.
// En español: se ordenan las series por nombre para que la salida sea DETERMINISTA — así dos
// consultas seguidas producen el mismo texto y las diferencias que se vean son reales, no ruido.
func (m *Metrics) render() string {
	m.mu.Lock()
	defer m.mu.Unlock()

	var out strings.Builder

	out.WriteString("# HELP tsk_uptime_seconds Tiempo que lleva el proceso en marcha.\n")
	out.WriteString("# TYPE tsk_uptime_seconds gauge\n")
	fmt.Fprintf(&out, "tsk_uptime_seconds %g\n", time.Since(m.startedAt).Seconds())

	out.WriteString("# HELP tsk_catalog_releases Estrenos cargados en el catálogo.\n")
	out.WriteString("# TYPE tsk_catalog_releases gauge\n")
	fmt.Fprintf(&out, "tsk_catalog_releases %d\n", m.catalogReleases)

	out.WriteString("# HELP tsk_catalog_days_remaining Días de futuro que le quedan al catálogo.\n")
	out.WriteString("# TYPE tsk_catalog_days_remaining gauge\n")
	fmt.Fprintf(&out, "tsk_catalog_days_remaining %d\n", m.catalogDaysRemaining)

	out.WriteString("# HELP tsk_rate_limited_total Peticiones rechazadas por exceder su cuota.\n")
	out.WriteString("# TYPE tsk_rate_limited_total counter\n")
	for _, scope := range rateLimitScopes {
		fmt.Fprintf(&out, "tsk_rate_limited_total{scope=%q} %d\n", scope, m.rateLimitedByScope[scope])
	}

	out.WriteString("# HELP tsk_panics_recovered_total Pánicos atrapados dentro de los handlers.\n")
	out.WriteString("# TYPE tsk_panics_recovered_total counter\n")
	fmt.Fprintf(&out, "tsk_panics_recovered_total %d\n", m.panicsRecovered)

	// Ordenamos las series para que la salida no dependa del recorrido aleatorio del mapa.
	keys := make([]procedureKey, 0, len(m.byProcedure))
	for key := range m.byProcedure {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].procedure != keys[j].procedure {
			return keys[i].procedure < keys[j].procedure
		}
		return keys[i].code < keys[j].code
	})

	out.WriteString("# HELP tsk_rpc_calls_total Llamadas RPC atendidas, por procedimiento y resultado.\n")
	out.WriteString("# TYPE tsk_rpc_calls_total counter\n")
	for _, key := range keys {
		fmt.Fprintf(&out, "tsk_rpc_calls_total{procedure=%q,code=%q} %d\n",
			key.procedure, key.code, m.byProcedure[key].count)
	}

	out.WriteString("# HELP tsk_rpc_duration_seconds Duración de las llamadas RPC.\n")
	out.WriteString("# TYPE tsk_rpc_duration_seconds histogram\n")
	for _, key := range keys {
		stats := m.byProcedure[key]
		for index, upperBound := range latencyBucketsSeconds {
			fmt.Fprintf(&out, "tsk_rpc_duration_seconds_bucket{procedure=%q,code=%q,le=%q} %d\n",
				key.procedure, key.code, strconv.FormatFloat(upperBound, 'g', -1, 64), stats.buckets[index])
		}
		// El bucket "+Inf" es obligatorio en el formato y siempre vale el total de observaciones.
		fmt.Fprintf(&out, "tsk_rpc_duration_seconds_bucket{procedure=%q,code=%q,le=\"+Inf\"} %d\n",
			key.procedure, key.code, stats.count)
		fmt.Fprintf(&out, "tsk_rpc_duration_seconds_sum{procedure=%q,code=%q} %g\n",
			key.procedure, key.code, stats.sumSeconds)
		fmt.Fprintf(&out, "tsk_rpc_duration_seconds_count{procedure=%q,code=%q} %d\n",
			key.procedure, key.code, stats.count)
	}

	return out.String()
}
