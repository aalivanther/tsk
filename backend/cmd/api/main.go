// Command api es el punto de entrada del backend Go del proyecto MDM 7mo.
// En español: este es el "interruptor de arranque" del servidor. Aquí se juntan todas
// las piezas: se leen los ajustes, se preparan los registros (logs), se montan las
// rutas (el servicio de catálogo y la salud del servicio), se enciende el servidor con
// HTTP/2 en claro (h2c nativo) y se programa un apagado ordenado cuando el sistema pide
// detener el proceso.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"connectrpc.com/connect"

	// catalogv1connect es el adaptador HTTP generado por connect-go para CatalogService.
	// En español: lo genera `buf generate`; nos da la función que crea la ruta y el
	// handler HTTP del servicio a partir de nuestra implementación.
	"mdm7mo/gen/mdm7mo/auth/v1/authv1connect"
	"mdm7mo/gen/mdm7mo/catalog/v1/catalogv1connect"
	"mdm7mo/gen/mdm7mo/profile/v1/profilev1connect"
	"mdm7mo/internal/auth"
	"mdm7mo/internal/catalog"
	"mdm7mo/internal/config"
	"mdm7mo/internal/localsettings"
	"mdm7mo/internal/profile"
	"mdm7mo/internal/server"
	"mdm7mo/internal/store"
)

// healthCheckPath es la ruta del chequeo de salud del servicio.
// En español: la dirección que Docker/Compose y los operadores consultan para saber si
// el backend está vivo y respondiendo.
const healthCheckPath = "/healthz"

// shutdownTimeout es el tiempo máximo que damos para terminar peticiones en curso al apagar.
// En español: cuando llega la orden de apagado, esperamos hasta este límite a que las
// llamadas activas terminen con dignidad antes de cerrar a la fuerza.
const shutdownTimeout = 15 * time.Second

// healthProbeTimeout es el tiempo máximo del sondeo de salud del subcomando "healthcheck".
// En español: si el servidor no responde en este plazo, el sondeo se considera fallido.
const healthProbeTimeout = 3 * time.Second

// readyCheckPath es la ruta del chequeo de PREPARACIÓN del servicio.
// En español: /healthz responde "sigo vivo" (el proceso no se ha colgado); /readyz responde "además,
// puedo hacer mi trabajo". La diferencia importa: un servicio puede estar vivo pero inútil, y quien
// vigila necesita distinguir "reinicia esto" de "esto necesita atención humana".
const readyCheckPath = "/readyz"

// metricsPath es la ruta donde se publican las métricas en formato Prometheus.
const metricsPath = "/metrics"

// minCatalogDaysForReady es cuántos días de futuro debe tener el catálogo para considerarse LISTO.
// En español: si al catálogo le quedan menos de dos semanas de estrenos por delante, el servicio
// responde y está sano, pero el producto está a punto de verse vacío. Marcarlo como "no listo" hace
// que quien vigila se entere ANTES de que el usuario vea una línea de tiempo sin futuro.
const minCatalogDaysForReady = 14

// main arranca el servidor y bloquea hasta que se ordene un apagado ordenado.
// En español: orquesta todo el ciclo de vida del backend. Si algo falla de forma fatal
// durante el arranque, registra el motivo y termina el proceso con código de error.
func main() {
	// Creamos el logger estructurado (slog) que escribe en formato JSON a la salida estándar.
	// En español: todos los registros del servidor saldrán como líneas JSON, fáciles de
	// leer por herramientas de observabilidad y por humanos.
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Subcomando "healthcheck": sondea /healthz del propio servidor y termina con código 0 (sano)
	// o 1 (enfermo). En español: la imagen final es distroless (sin shell, sin curl), así que el
	// healthcheck de Docker no puede usar herramientas externas; en su lugar ejecuta este MISMO
	// binario con el argumento "healthcheck" (ver compose.yaml). No requiere configuración completa:
	// solo el puerto.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(runHealthProbe())
	}

	// Ejecutamos la lógica principal en run(); si devuelve error, lo registramos y salimos.
	// En español: separar run() de main() permite manejar el error de arranque en un único
	// lugar y mantener main() corto y claro.
	if err := run(logger); err != nil {
		logger.Error("server terminated with error", slog.String("error", err.Error()))
		os.Exit(1)
	}
}

// runHealthProbe consulta el /healthz del servidor local y devuelve el código de salida del sondeo.
// En español: hace una petición HTTP mínima al propio proceso servidor (misma red del contenedor).
// Devuelve 0 si respondió 200; 1 en cualquier otro caso (sin respuesta, error o estado != 200).
func runHealthProbe() int {
	// El puerto sale de PORT (mismo env que usa el servidor); por defecto 8080.
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	probeURL := "http://" + net.JoinHostPort("127.0.0.1", port) + healthCheckPath

	client := &http.Client{Timeout: healthProbeTimeout}
	response, err := client.Get(probeURL)
	if err != nil {
		return 1
	}
	// Cerramos el cuerpo siempre (aunque no lo leamos) para no filtrar la conexión.
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

// run contiene el arranque, el servicio y el apagado ordenado del servidor.
// En español: lee los ajustes, monta las rutas, enciende el servidor en segundo plano y
// se queda esperando una señal del sistema operativo (Ctrl+C o SIGTERM de Docker) para
// apagar todo de forma limpia. Devuelve error solo ante un fallo real e inesperado.
func run(logger *slog.Logger) error {
	// Cargamos la configuración desde variables de entorno (puerto, versión, tokens, ruta del seed).
	envCfg := config.Load()
	// El archivo local completa las llaves que no vinieron en el entorno. Si falta la clave de
	// sesión, este proceso queda en preparación: no abre catálogo ni cuentas hasta el reinicio.
	cfg, setupMode, err := localsettings.Bootstrap(envCfg)
	if err != nil {
		logger.Error("failed to prepare local settings", slog.String("error", err.Error()))
		return err
	}
	logger.Info("local settings ready", slog.Bool("setup_mode", setupMode))
	if setupMode {
		return runSetup(logger, cfg.Port, envCfg)
	}

	// Validamos los ajustes OBLIGATORIOS (hoy: la clave de firma de sesiones). Sin ellos no arrancamos.
	if err := cfg.Validate(); err != nil {
		logger.Error("invalid configuration at startup", slog.String("error", err.Error()))
		return err
	}

	// Cargamos el catálogo desde el archivo semilla (seed.json) ANTES de abrir el servidor.
	// En español: el catálogo de Fase 0 vive en un archivo en disco. Si no se puede leer o está
	// roto, el backend no debe arrancar a medias: registramos el motivo y devolvemos el error,
	// lo que provoca una salida fatal (mejor no encender que servir datos incompletos).
	// Se PREFIERE el catálogo actualizable (directorio escribible) sobre el que viaja dentro de la
	// imagen: así se puede renovar sin reconstruir ni redesplegar nada. Si el actualizable no existe
	// (despliegue nuevo) o está roto, se cae al de la imagen dejando constancia del motivo.
	loaded, err := catalog.LoadPreferringWritable(cfg.WritableSeedPath, cfg.SeedPath, time.Now(), logger)
	if err != nil {
		logger.Error(
			"failed to load catalog seed at startup",
			slog.String("seed_path", cfg.SeedPath),
			slog.String("writable_seed_path", cfg.WritableSeedPath),
			slog.String("error", err.Error()),
		)
		return err
	}
	releases := loaded.Releases
	logger.Info(
		"catalog seed loaded",
		slog.String("seed_path", loaded.Path),
		slog.String("source", string(loaded.Source)),
		slog.Int("releases", len(releases)),
		slog.Int("days_remaining", loaded.DaysRemaining),
	)

	// Construimos el almacén en memoria con los estrenos cargados (arma el índice por ID).
	// En español: a partir de aquí el catálogo está listo para responder consultas al instante.
	// Se llama catalogStore (y no simplemente "store") porque ahora existe además el paquete "store",
	// que es la base de datos de las cuentas: son dos cosas distintas y confundirlas sería fácil.
	catalogStore := catalog.NewStore(releases)

	// Registro de MÉTRICAS del servicio: cuántas llamadas se atienden, cómo terminan, cuánto tardan y
	// —lo más importante para este producto— cuántos días de futuro le quedan al catálogo. Este
	// primer apunte deja el estado correcto ANTES de abrir el servidor, para que /readyz nunca
	// responda con un número sin rellenar; a partir de ahí lo mantiene al día el vigilante (más abajo).
	metrics := server.NewMetrics()
	metrics.SetCatalogState(len(releases), loaded.DaysRemaining)

	// Creamos un contexto que se cancela automáticamente al recibir SIGINT o SIGTERM.
	// En español: este contexto es el "botón de apagado". Cuando el sistema pide detener
	// el proceso (Ctrl+C en local o `docker stop`), el contexto se cancela y empezamos
	// el apagado ordenado. El stop() libera los manejadores de señal al terminar.
	rootContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Preparamos los interceptores comunes a todas las llamadas del servicio.
	// En español: en Connect, el PRIMER interceptor de la lista es el más EXTERNO (envuelve
	// a los siguientes). Ponemos logging primero (externo) y recovery después (interno). Así,
	// si un handler entra en pánico, recovery —el más cercano al handler— lo atrapa y lo
	// convierte en un error controlado; ese error sube hasta logging, que SÍ alcanza a
	// registrar la llamada fallida con su duración. Si recovery fuera el externo, el logging
	// de duración nunca correría para las llamadas que panican.
	// Resolvedor de la dirección del cliente: decide de QUIÉN es cada petición para aplicarle su cuota.
	// En español: detrás de un proxy, la conexión ya no viene del usuario sino del proxy; sin esto,
	// todos los usuarios compartirían un único contador y el límite de intentos de inicio de sesión
	// (10 por minuto) valdría para toda la aplicación a la vez. Ver internal/server/clientip.go.
	clientIPResolver := server.NewClientIPResolver(cfg.TrustedProxyHops)
	logger.Info("client ip resolution configured", slog.Int("trusted_proxy_hops", cfg.TrustedProxyHops))

	// AVISO GRANDE cuando no hay proxies declarados.
	//
	// Por qué está aquí, en español: el límite de intentos de contraseña identifica a cada visitante
	// por su dirección. Desde que el navegador habla con el servidor a través de la propia web (el
	// puente "/rpc"), TODAS las peticiones llegan con la dirección de ese intermediario, no con la de
	// la persona. Con cero proxies declarados, el servidor las mete a todas en el mismo contador: once
	// intentos fallidos de UN desconocido dejan sin poder entrar a TODO el mundo.
	//
	// No se puede detectar solo si hay un intermediario delante, así que no se puede arreglar desde
	// aquí. Lo que sí se puede es que nadie lo descubra por las malas: este aviso sale en cada
	// arranque, dice exactamente qué pasa y qué dos variables lo resuelven. En local es inofensivo
	// (hay una sola persona); en un despliegue de verdad es la diferencia entre tener límite y no
	// tenerlo.
	if cfg.TrustedProxyHops == 0 {
		logger.Warn(
			"no trusted proxies configured: every visitor shares a single rate-limit bucket, " +
				"so one attacker can lock everyone out of sign-in. " +
				"Behind a platform that rewrites X-Forwarded-For, set TRUSTED_PROXY_HOPS=1 on the API " +
				"and TRUST_PLATFORM_FORWARDED_HEADERS=true on the web container. Both, or neither.",
		)
	}

	// Base de datos: cuentas, sesiones, invitaciones, restablecimientos y perfiles. Al abrirla se
	// aplican solas las migraciones pendientes (es idempotente: arrancar mil veces no cambia nada).
	// Si algo falla aquí, el servidor NO arranca: es preferible no encender a servir con la
	// persistencia rota y perder datos de usuarios sin enterarse.
	persistentStore, err := store.Open(store.Options{
		Path:         cfg.DatabasePath,
		TokenHashKey: cfg.SessionSigningKey,
		Logger:       logger,
	})
	if err != nil {
		logger.Error(
			"failed to open the persistent store",
			slog.String("db_path", cfg.DatabasePath),
			slog.String("error", err.Error()),
		)
		return err
	}
	// Cerramos la base al terminar para que se vacíen sus escrituras pendientes al disco.
	defer func() {
		if err := persistentStore.Close(); err != nil {
			logger.Error("failed to close the persistent store", slog.String("error", err.Error()))
		}
	}()

	// Importación de una sola vez del antiguo archivo users.json (si existe y la base está vacía).
	// En español: es el puente para no perder las cuentas creadas por la versión anterior.
	importedAccounts, err := persistentStore.ImportLegacyUsersFile(rootContext, cfg.AuthDataPath)
	if err != nil {
		logger.Error(
			"failed to import the legacy users file",
			slog.String("auth_data_path", cfg.AuthDataPath),
			slog.String("error", err.Error()),
		)
		return err
	}
	if importedAccounts > 0 {
		logger.Info("legacy accounts imported into the database", slog.Int("accounts", importedAccounts))
	}

	// El interceptor de auth (traduce la cookie o la cabecera Authorization en una identidad) va como
	// el MÁS INTERNO, para que los handlers ya tengan resuelto de quién es la llamada. Logging sigue
	// externo y recovery en medio (atrapa pánicos antes de que lleguen al logging de duración).
	interceptors := connect.WithInterceptors(
		server.LoggingInterceptor(logger, metrics),
		server.RecoveryInterceptor(logger, metrics),
		server.AuthInterceptor(persistentStore, logger),
	)

	// requireProtocolHeader obliga a que toda llamada traiga la cabecera del protocolo Connect.
	//
	// En español: es una defensa pequeña y gratuita contra las órdenes lanzadas desde otra página. Un
	// formulario HTML de un sitio ajeno PUEDE enviar datos a nuestro servidor con la cookie de sesión
	// del usuario adjunta, pero NO puede añadirle cabeceras propias: el navegador no se lo permite.
	// Al exigir una, cualquier intento por esa vía queda descartado antes de tocar nada.
	requireProtocolHeader := connect.WithRequireConnectProtocolHeader()

	// Construimos la implementación del servicio de catálogo con la versión y el almacén de datos.
	catalogHandler := catalog.NewHandler(cfg.Version, catalogStore)

	// VIGILANTE del catálogo. En español: es la pieza que impide que la alarma del catálogo se quede
	// congelada. Sin él, los días de futuro que le quedan al catálogo se calculaban UNA vez, al
	// arrancar, y ahí se quedaban: un proceso que llevara dos meses encendido seguía anunciando los
	// mismos días del primer día, así que tanto la métrica como /readyz mentían justo cuando más
	// falta hacía la advertencia. El vigilante vuelve a contarlos cada cierto tiempo contra la fecha
	// de hoy y, de paso, recoge en caliente un catálogo nuevo si alguien lo instaló.
	catalogWatcher, err := catalog.NewWatcher(catalog.WatcherOptions{
		Handler:          catalogHandler,
		State:            metrics,
		WritableSeedPath: cfg.WritableSeedPath,
		Interval:         cfg.CatalogRefreshInterval,
		Logger:           logger,
	})
	if err != nil {
		logger.Error("failed to build the catalog watcher", slog.String("error", err.Error()))
		return err
	}
	// Corre en una tarea paralela y termina solo cuando se cancela el contexto del apagado.
	go catalogWatcher.Run(rootContext)

	// Pedimos al código generado por connect-go la ruta y el handler HTTP del servicio.
	// En español: NewCatalogServiceHandler toma nuestra implementación y nos devuelve dos
	// cosas: la ruta donde "vive" el servicio y el handler HTTP que sabe atender Connect,
	// gRPC y gRPC-Web sobre esa ruta.
	catalogPath, catalogHTTPHandler := catalogv1connect.NewCatalogServiceHandler(catalogHandler, interceptors, requireProtocolHeader)

	// Servicio de AUTENTICACIÓN: el ciclo de vida completo de una cuenta (registro, inicio y cierre
	// de sesión, cambio de contraseña, restablecimiento y borrado), con los mismos interceptores.
	// El canal de entrega de restablecimientos es el MANUAL: escribe el token en el registro del
	// servidor para que quien administra la alpha se lo haga llegar a su dueño (ver auth/delivery.go).
	authHandler, err := auth.NewHandler(auth.HandlerOptions{
		Store:         persistentStore,
		RequireInvite: cfg.RequireInvite,
		CookieOptions: auth.SessionCookieOptions{Secure: cfg.SessionCookieSecure},
		ResetDelivery: auth.NewAdminDelivery(logger, cfg.CORSAllowedOrigin),
		Logger:        logger,
	})
	if err != nil {
		logger.Error("failed to build the auth service", slog.String("error", err.Error()))
		return err
	}
	authPath, authHTTPHandler := authv1connect.NewAuthServiceHandler(authHandler, interceptors, requireProtocolHeader)
	logger.Info(
		"auth service configured",
		slog.Bool("require_invite", cfg.RequireInvite),
		slog.Bool("session_cookie_secure", cfg.SessionCookieSecure),
	)

	// Servicio de PERFIL: guarda en el servidor la lista de "quiero ver", lo visto, las reseñas y los
	// ajustes de cada cuenta, para que el perfil deje de vivir solo en un navegador concreto.
	profileHandler, err := profile.NewHandler(persistentStore)
	if err != nil {
		logger.Error("failed to build the profile service", slog.String("error", err.Error()))
		return err
	}
	profilePath, profileHTTPHandler := profilev1connect.NewProfileServiceHandler(profileHandler, interceptors, requireProtocolHeader)

	// Creamos el enrutador y montamos las rutas del servidor.
	// En español: el mux es el "recepcionista" que decide qué pieza atiende cada URL.
	mux := http.NewServeMux()
	mux.Handle(catalogPath, catalogHTTPHandler) // El servicio de catálogo (Connect/gRPC).
	// El servicio de autenticación lleva una valla EXTRA: cuota estricta por IP (10/min) para TODAS
	// sus operaciones sensibles — entrar, registrarse, pedir y canjear un restablecimiento, cambiar
	// la contraseña y borrar la cuenta (ver authAttemptSuffixes en internal/server/limits.go). La
	// cuota general del API (240/min, más abajo) es holgada a propósito para la navegación; sin esta
	// valla, esos 240/min serían 240 intentos de contraseña o de token por minuto.
	mux.Handle(authPath, server.AuthAttemptLimit(clientIPResolver, metrics, authHTTPHandler))
	// El servicio de perfil va con la cuota general: no recibe credenciales que adivinar, y sus
	// llamadas son frecuentes por diseño (el frontend guarda con retardo tras cada cambio).
	mux.Handle(profilePath, profileHTTPHandler)
	mux.HandleFunc(healthCheckPath, healthCheckHandler)
	// /readyz: preparación real del servicio, no solo "estoy vivo" (ver minCatalogDaysForReady).
	mux.Handle(readyCheckPath, readyCheckHandler(metrics))
	// /metrics: los números del servicio en formato Prometheus, para vigilancia externa. Va detrás de
	// una clave de acceso (METRICS_ACCESS_KEY) porque no es información inocente: enseña el mapa
	// completo de operaciones del API, cuáles fallan y cuánto lleva vivo el proceso. Sin clave
	// configurada queda cerrado para todos; /healthz y /readyz siguen abiertos a propósito, que es lo
	// que necesitan el healthcheck de Docker y quien vigile el servicio desde fuera.
	mux.Handle(metricsPath, server.MetricsGuard(cfg.MetricsAccessKey, metrics.Handler()))
	logger.Info("metrics endpoint configured", slog.Bool("access_key_configured", cfg.MetricsAccessKey != ""))
	server.MountSetup(mux, server.SetupOptions{
		Path:      localsettings.Path(),
		SetupMode: false,
		Env:       envCfg,
		Restart:   func() { requestProcessRestart(logger) },
	})

	// Calculamos la dirección de escucha a partir del puerto configurado.
	// En español: usamos net.JoinHostPort para formar ":8080" de forma segura. El host
	// vacío significa "escuchar en todas las interfaces de red", necesario dentro de Docker.
	address := net.JoinHostPort("", cfg.Port)

	// Envolvemos el enrutador con CORS para que el FRONTEND (otro origen, p. ej. :3100) pueda llamar al
	// API desde el navegador (el login es client-side). Solo se permite el origen configurado.
	// Antes de CORS, el guardián que rechaza las órdenes nacidas en OTRO sitio web. Desde que la
	// sesión viaja en una cookie, el navegador la adjunta solo; sin esta valla, una página cualquiera
	// podría pedirle al servidor que cambie la contraseña o borre la cuenta de quien la visite.
	handler := server.CSRFGuard(cfg.CORSAllowedOrigin, mux)

	// Envolvemos el enrutador con CORS para que el FRONTEND pueda llamar al API desde el navegador
	// cuando vive en otra dirección. Solo se permite el origen configurado.
	handler = server.CORS(cfg.CORSAllowedOrigin, handler)

	// Vallas de robustez en la puerta (pase de cierre): primero el TOPE de tamaño de cuerpo (este API
	// solo recibe mensajes pequeños) y, por fuera de todo, la CUOTA de peticiones por cliente (429 al
	// excederla). Al ir por fuera, protegen TODAS las rutas, incluido el preflight CORS y /healthz.
	handler = server.MaxBodyBytes(handler)
	handler = server.RateLimit(clientIPResolver, metrics, handler)
	// El identificador de petición va en la CAPA MÁS EXTERNA: así lo tienen todas las demás, incluidas
	// las peticiones que se rechazan por cuota antes de llegar al servicio.
	handler = server.RequestID(handler)

	// Construimos el servidor HTTP con h2c nativo y los relojes de seguridad.
	httpServer := server.New(address, handler, logger)
	logger.Info(
		"http server starting",
		slog.String("address", address),
		slog.String("version", cfg.Version),
	)
	return serve(httpServer, logger, rootContext, stop)
}

// runSetup arranca el proceso cuando todavía no hay clave de sesión usable.
// Solo abre la salud (para que Docker deje subir la web) y las rutas /setup.
func runSetup(logger *slog.Logger, port string, envCfg config.Config) error {
	logger.Info("setup mode: catalog and accounts stay closed until the local configuration page turns them on")
	mux := http.NewServeMux()
	mux.HandleFunc(healthCheckPath, healthCheckHandler)
	mux.HandleFunc(readyCheckPath, func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.Header().Set("Content-Type", "text/plain; charset=utf-8")
		responseWriter.WriteHeader(http.StatusServiceUnavailable)
		_, _ = responseWriter.Write([]byte("setup\n"))
	})
	server.MountSetup(mux, server.SetupOptions{
		Path:      localsettings.Path(),
		SetupMode: true,
		Env:       envCfg,
		Restart:   func() { requestProcessRestart(logger) },
	})

	rootContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	address := net.JoinHostPort("", port)
	handler := server.RequestID(server.MaxBodyBytes(mux))
	httpServer := server.New(address, handler, logger)
	logger.Info("http server starting", slog.String("address", address), slog.String("mode", "setup"))
	return serve(httpServer, logger, rootContext, stop)
}

// requestProcessRestart pide el apagado del proceso. Docker lo vuelve a crear y el
// proceso nuevo lee la clave que ya quedó guardada.
func requestProcessRestart(logger *slog.Logger) {
	logger.Info("restart requested by local setup")
	go func() {
		time.Sleep(250 * time.Millisecond)
		if err := syscall.Kill(os.Getpid(), syscall.SIGTERM); err != nil {
			logger.Error("failed to signal restart", slog.String("error", err.Error()))
		}
	}()
}

// serve escucha hasta que el servidor falle o llegue la señal de apagado.
func serve(httpServer *http.Server, logger *slog.Logger, rootContext context.Context, stop context.CancelFunc) error {
	serverErrors := make(chan error, 1)
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrors <- err
		}
		close(serverErrors)
	}()

	select {
	case err := <-serverErrors:
		if err != nil {
			return err
		}
		return nil

	case <-rootContext.Done():
		logger.Info("shutdown signal received, draining connections")
		stop()
		shutdownContext, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := httpServer.Shutdown(shutdownContext); err != nil {
			return err
		}
		logger.Info("http server stopped gracefully")
		return nil
	}
}

// healthCheckHandler responde al chequeo de salud con un 200 y el texto "ok".
// En español: es la respuesta mínima que confirma "estoy vivo". La usan Docker Compose
// y los operadores para saber que el backend arrancó y atiende peticiones HTTP simples.
func healthCheckHandler(responseWriter http.ResponseWriter, _ *http.Request) {
	responseWriter.Header().Set("Content-Type", "text/plain; charset=utf-8")
	responseWriter.WriteHeader(http.StatusOK)
	// Escribimos el cuerpo y registramos cualquier fallo de escritura (no lo silenciamos).
	if _, err := responseWriter.Write([]byte("ok")); err != nil {
		slog.Default().Warn("failed to write health check response", slog.String("error", err.Error()))
	}
}

// readyCheckHandler responde al chequeo de PREPARACIÓN del servicio.
// En español: devuelve 200 si el servicio puede hacer su trabajo de verdad, y 503 si está vivo pero
// degradado. Hoy la única condición es que al catálogo le queden días de futuro por mostrar: un
// catálogo agotado deja la línea de tiempo vacía aunque todo lo demás funcione. El cuerpo explica el
// motivo en texto plano para que quien lo consulte sepa qué mirar sin bucear en los registros.
func readyCheckHandler(metrics *server.Metrics) http.Handler {
	return http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		daysRemaining := metrics.CatalogDaysRemaining()
		responseWriter.Header().Set("Content-Type", "text/plain; charset=utf-8")

		if daysRemaining < minCatalogDaysForReady {
			responseWriter.WriteHeader(http.StatusServiceUnavailable)
			body := fmt.Sprintf(
				"not ready: catalog has %d days of upcoming releases left (minimum %d)\n",
				daysRemaining, minCatalogDaysForReady,
			)
			if _, err := responseWriter.Write([]byte(body)); err != nil {
				slog.Default().Warn("failed to write readiness response", slog.String("error", err.Error()))
			}
			return
		}

		responseWriter.WriteHeader(http.StatusOK)
		body := fmt.Sprintf("ready: catalog has %d days of upcoming releases left\n", daysRemaining)
		if _, err := responseWriter.Write([]byte(body)); err != nil {
			slog.Default().Warn("failed to write readiness response", slog.String("error", err.Error()))
		}
	})
}
