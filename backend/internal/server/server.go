// Package server arma el servidor HTTP del backend y sus interceptores transversales.
// En español: aquí se construye el "motor" de red que atiende las peticiones y se
// definen dos "filtros" comunes a todas las llamadas Connect: uno que registra cada
// llamada (logging) y otro que atrapa fallos inesperados (recovery) para que un error
// en una petición no tumbe todo el servidor.
package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"connectrpc.com/connect"
)

// Tiempos de espera del servidor HTTP, con nombre para no usar números mágicos.
// En español: son "relojes de seguridad". Si una fase de la conexión tarda más de lo
// permitido, el servidor la corta para no quedarse colgado consumiendo recursos.
const (
	// readHeaderTimeout limita cuánto puede tardar el cliente en mandar las cabeceras.
	// En español: protege contra clientes lentos o maliciosos que abren la conexión y
	// no terminan de enviar la solicitud (ataque "slowloris").
	readHeaderTimeout = 10 * time.Second

	// readTimeout limita el tiempo total para leer toda la petición (cabeceras + cuerpo).
	readTimeout = 30 * time.Second

	// writeTimeout limita el tiempo total para escribir la respuesta al cliente.
	writeTimeout = 30 * time.Second

	// idleTimeout cierra conexiones reutilizables que llevan demasiado tiempo ociosas.
	idleTimeout = 120 * time.Second
)

// New construye el servidor HTTP listo para escuchar en la dirección indicada.
// En español: recibe la dirección (ej. ":8080"), el conjunto de rutas ya montadas
// (handler) y el logger, y devuelve un *http.Server configurado con h2c NATIVO y con
// los relojes de seguridad puestos. No arranca el servidor: solo lo prepara.
func New(address string, handler http.Handler, logger *slog.Logger) *http.Server {
	// Configuramos los protocolos HTTP soportados usando la API NATIVA de Go.
	// En español: habilitamos HTTP/1.1 normal y, además, HTTP/2 "en claro" (sin TLS),
	// conocido como h2c. Connect necesita HTTP/2 para sus llamadas gRPC; al activarlo
	// de forma nativa evitamos depender del paquete externo x/net/http2/h2c.
	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)            // HTTP/1.1 clásico, para /healthz y clientes simples.
	protocols.SetUnencryptedHTTP2(true) // h2c: HTTP/2 sin cifrar, requerido por Connect en local.

	return &http.Server{
		Addr:              address,
		Handler:           handler,
		Protocols:         protocols,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
		// Conectamos el logger del servidor (errores internos de net/http) al slog.
		// En español: si net/http reporta un problema de bajo nivel, queda en nuestros
		// logs estructurados en vez de perderse por la salida estándar.
		ErrorLog: slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}
}

// LoggingInterceptor crea un interceptor de Connect que registra cada llamada.
// En español: es un "filtro" que envuelve cada petición del servicio. Antes de pasarla,
// anota el momento; después de responder, calcula cuánto tardó y registra el método y
// la duración. Sirve para observar el comportamiento real del backend.
func LoggingInterceptor(logger *slog.Logger, metrics *Metrics) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, request connect.AnyRequest) (connect.AnyResponse, error) {
			// Marcamos el inicio para medir la duración total de la llamada.
			start := time.Now()

			// Ejecutamos el siguiente eslabón de la cadena (la lógica real del handler).
			response, err := next(ctx, request)

			// Calculamos cuánto tardó y elegimos el nivel de log según haya error o no.
			duration := time.Since(start)
			// Usamos []slog.Attr (no []any) porque LogAttrs exige atributos tipados:
			// es la vía de logging más eficiente de slog (evita conversiones en cada llamada).
			attributes := []slog.Attr{
				slog.String("procedure", request.Spec().Procedure), // ruta RPC, ej. /...catalog.v1.CatalogService/GetServiceInfo
				slog.Duration("duration", duration),
			}
			// El identificador de petición permite SEGUIR una misma petición por todos los registros
			// que genera. Sin él, ante un fallo hay que adivinar qué líneas del log pertenecen al
			// mismo suceso. Lo pone el middleware RequestID en la puerta del servidor.
			if requestID, ok := RequestIDFromContext(ctx); ok {
				attributes = append(attributes, slog.String("request_id", requestID))
			}

			// Anotamos la llamada en las métricas: cuántas van, cómo terminaron y cuánto tardan.
			// El "código" es "ok" si fue bien, o el código de error de Connect si falló.
			resultCode := "ok"
			if err != nil {
				resultCode = connect.CodeOf(err).String()
			}
			metrics.ObserveCall(request.Spec().Procedure, resultCode, duration)

			// Si hubo error lo registramos como aviso con su contexto; si no, como info.
			// En español: separar éxito de fallo facilita detectar problemas en los logs.
			if err != nil {
				logger.LogAttrs(ctx, slog.LevelWarn, "rpc call failed",
					append(attributes, slog.String("error", err.Error()))...)
			} else {
				logger.LogAttrs(ctx, slog.LevelInfo, "rpc call handled", attributes...)
			}

			return response, err
		}
	}
}

// RecoveryInterceptor crea un interceptor de Connect que atrapa panics inesperados.
// En español: es la "red de seguridad". Si la lógica de un handler revienta de forma
// imprevista (un panic), este filtro lo captura, deja constancia en los logs con la
// traza, y convierte el desastre en un error controlado para el cliente, en lugar de
// derribar todo el proceso del servidor.
func RecoveryInterceptor(logger *slog.Logger, metrics *Metrics) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, request connect.AnyRequest) (response connect.AnyResponse, err error) {
			// defer + recover es el mecanismo de Go para interceptar un panic en curso.
			// En español: registramos una rutina de "rescate" que se ejecuta justo si la
			// llamada de abajo entra en pánico, antes de que el error escale.
			defer func() {
				if recovered := recover(); recovered != nil {
					// Guardamos la traza de la pila para poder investigar la causa después.
					stack := debug.Stack()
					logger.LogAttrs(
						ctx, slog.LevelError, "recovered from panic in rpc handler",
						slog.String("procedure", request.Spec().Procedure),
						slog.Any("panic", recovered),
						slog.String("stack", string(stack)),
					)
					// Contamos el pánico como métrica: debería valer siempre cero, así que
					// cualquier incremento es una alarma que merece investigarse de inmediato.
					metrics.ObservePanicRecovered()
					// Devolvemos un error interno genérico (sin filtrar detalles internos
					// al cliente) para que la respuesta sea limpia y predecible.
					err = connect.NewError(connect.CodeInternal, fmt.Errorf("internal server error"))
				}
			}()

			// Ejecutamos la llamada real; si entra en pánico, lo de arriba lo atrapa.
			return next(ctx, request)
		}
	}
}
