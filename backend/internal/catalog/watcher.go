package catalog

// Archivo: watcher.go — El VIGILANTE del catálogo: mantiene vivo el número de días que le quedan y
// recoge en caliente un catálogo nuevo si alguien lo instala.
//
// En español: el problema que resuelve esta pieza es concreto y era grave. El catálogo tiene fecha
// de caducidad —cubre unos meses de estrenos— y existe una métrica (tsk_catalog_days_remaining) y un
// chequeo (/readyz) cuyo único trabajo es avisar con semanas de antelación de que se está agotando.
// Pero ese número se calculaba UNA sola vez, al arrancar el proceso. Como el servidor puede pasar
// meses encendido, un proceso que llevara 60 días en marcha seguía anunciando los mismos "quedan 120
// días" del día del arranque: la alarma estaba congelada justo cuando más falta hacía, y el runbook
// le decía al operador que se fiara de ella.
//
// El vigilante corre en segundo plano y, cada cierto tiempo, hace dos cosas:
//
//  1. RECALCULA el estado del catálogo (cuántos estrenos y cuántos días de futuro le quedan) contra
//     la fecha de HOY y a partir del catálogo que está sirviendo en este momento. Con esto el número
//     baja solo, día a día, y tanto la métrica como /readyz dicen la verdad sin reiniciar nada.
//
//  2. MIRA si el archivo de catálogo actualizable ha cambiado desde la última vez. Si cambió, lo
//     carga, lo valida entero y —solo si es correcto— lo pone en servicio de un golpe. Es la otra
//     mitad del refresco sin reinicio: quien administra instala el archivo nuevo con
//     `make seed-install` y el servidor lo recoge solo, sin reconstruir ni redesplegar nada.
//
// Si el archivo nuevo estuviera roto, no se toca el catálogo vigente: se deja constancia del motivo
// y se sigue sirviendo el anterior. Es preferible un catálogo viejo pero correcto a uno nuevo y
// corrupto.

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"time"
)

// DefaultRefreshInterval es cada cuánto revisa el vigilante, si nadie configura otra cosa.
//
// En español: un minuto. La cifra la manda el caso de uso más impaciente de los dos que vigila:
//
//   - Los días que quedan de catálogo bajan UNA VEZ AL DÍA. Para eso, revisar cada hora sobraba.
//   - Pero instalar un catálogo nuevo es una acción MANUAL, y quien la hace se queda mirando la
//     pantalla esperando ver el cambio. Con una revisión por hora, la herramienta decía "instalado"
//     y el servidor seguía sirviendo lo viejo durante un rato indeterminado; la reacción natural es
//     pensar que no funcionó y volver a intentarlo. Se probó y pasó exactamente eso.
//
// Revisar cada minuto cuesta mirar la fecha de un archivo y, solo si cambió, releerlo; cuando no
// cambió (que es casi siempre) el trabajo es recorrer una lista que ya está en memoria. Es
// imperceptible incluso mil veces al día.
const DefaultRefreshInterval = time.Minute

// StateSink es quien recibe el estado del catálogo cada vez que se recalcula.
//
// En español: se declara como una "toma de corriente" (una interfaz mínima) en vez de recibir
// directamente el registro de métricas del servidor por un motivo práctico: así este paquete no
// necesita conocer al paquete del servidor, y las pruebas pueden enchufar un receptor de mentira que
// se limita a apuntar los valores. El único enchufe real hoy es server.Metrics.
type StateSink interface {
	// SetCatalogState anota cuántos estrenos hay cargados y cuántos días de futuro les quedan.
	SetCatalogState(releases, daysRemaining int)
}

// WatcherOptions son las piezas con las que se arma el vigilante del catálogo.
type WatcherOptions struct {
	// Handler es el servicio de catálogo cuyo almacén hay que vigilar y, llegado el caso, relevar.
	// Obligatorio.
	Handler *Handler

	// State es quien recibe el estado recalculado (en producción, las métricas). Obligatorio.
	State StateSink

	// WritableSeedPath es la ruta del catálogo ACTUALIZABLE que hay que vigilar. Si viene vacía, el
	// vigilante sigue recalculando los días restantes pero nunca releva el catálogo: es una
	// configuración válida (una instalación que solo use el catálogo de dentro de la imagen).
	WritableSeedPath string

	// Interval es cada cuánto se revisa. Si es cero o negativo se usa DefaultRefreshInterval.
	Interval time.Duration

	// Now es el reloj del vigilante. Si es nil se usa el del sistema. Existe para que las pruebas
	// puedan situarse en una fecha concreta y comprobar el cálculo de días sin depender de "hoy".
	Now func() time.Time

	// Logger es donde el vigilante deja constancia de los relevos y de los archivos que no sirven.
	// Si es nil se usa el del proceso.
	Logger *slog.Logger
}

// Watcher es el vigilante en marcha. Se crea con NewWatcher y se pone a trabajar con Run.
type Watcher struct {
	// handler es el servicio de catálogo al que se le releva el almacén.
	handler *Handler

	// state es quien recibe el estado recalculado.
	state StateSink

	// writableSeedPath es el archivo actualizable que se vigila (vacío = no se vigila ninguno).
	writableSeedPath string

	// interval es cada cuánto se revisa.
	interval time.Duration

	// now es el reloj.
	now func() time.Time

	// logger es el registro.
	logger *slog.Logger

	// lastSeenSeedStamp es la "firma" (fecha de modificación + tamaño) que tenía el archivo
	// vigilado la última vez que se miró. Comparar contra ella es lo que evita releer y relevar el
	// catálogo en cada vuelta cuando no ha cambiado nada.
	//
	// No lleva candado y no le hace falta: lo lee y lo escribe SOLO la goroutine de Run, que es una
	// sola. El estado compartido de verdad (el almacén del handler) sí está protegido, con un
	// puntero atómico.
	lastSeenSeedStamp seedStamp
}

// seedStamp es la firma de un archivo de catálogo: cuándo se modificó y cuánto ocupa.
//
// En español: se usan los dos datos juntos porque cada uno por separado se puede repetir. Dos
// versiones distintas del catálogo pueden pesar lo mismo, y dos escrituras muy seguidas pueden
// compartir el mismo segundo de modificación en algunos sistemas de archivos. La pareja completa
// falla mucho menos, y en el peor caso el coste de equivocarse es releer un archivo pequeño de más.
type seedStamp struct {
	// modifiedAt es la fecha de última modificación que reporta el sistema de archivos.
	modifiedAt time.Time
	// sizeBytes es el tamaño del archivo en bytes.
	sizeBytes int64
}

// exists dice si la firma corresponde a un archivo que se pudo mirar de verdad.
func (s seedStamp) exists() bool {
	return !s.modifiedAt.IsZero()
}

// NewWatcher arma el vigilante del catálogo y anota la firma del archivo que ya está en servicio.
//
// En español: anotar la firma AQUÍ, al construirlo, es importante. Si no lo hiciéramos, la primera
// revisión vería un archivo que "nunca había visto" y volvería a cargar y relevar exactamente el
// mismo catálogo que ya estaba puesto: trabajo inútil y una línea de registro que confundiría a
// quien la leyera ("¿por qué se recargó el catálogo si nadie tocó nada?").
//
// Devuelve error si falta alguna pieza imprescindible: un vigilante a medias sería peor que ninguno,
// porque daría la falsa sensación de que el número se está actualizando.
func NewWatcher(options WatcherOptions) (*Watcher, error) {
	// Los dos mensajes van en INGLÉS, como todo mensaje técnico de error o de registro del proyecto
	// (regla §3): los lee quien opera el servicio, no el público de la aplicación. Estaban escritos en
	// español, que es lo que aquí corresponde a los COMENTARIOS, no a los mensajes. Los textos que sí
	// ve el usuario —los que salen por connect.NewError hacia la aplicación— siguen en es-MX, y eso
	// también es correcto: son contenido, no diagnóstico.
	if options.Handler == nil {
		return nil, errors.New("catalog: the watcher needs the catalog handler")
	}
	if options.State == nil {
		return nil, errors.New("catalog: the watcher needs a sink to publish the refreshed state to")
	}

	interval := options.Interval
	if interval <= 0 {
		interval = DefaultRefreshInterval
	}
	clock := options.Now
	if clock == nil {
		clock = time.Now
	}
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}

	watcher := &Watcher{
		handler:          options.Handler,
		state:            options.State,
		writableSeedPath: options.WritableSeedPath,
		interval:         interval,
		now:              clock,
		logger:           logger,
	}
	watcher.lastSeenSeedStamp = watcher.readSeedStamp()

	return watcher, nil
}

// Run pone a trabajar al vigilante y no devuelve el control hasta que se ordena el apagado.
//
// En español: está pensado para lanzarse en una tarea paralela ("go watcher.Run(ctx)"). Termina —de
// forma limpia y sin dejar nada a medias— en cuanto el contexto se cancela, que es lo que ocurre
// cuando el sistema pide detener el proceso.
func (w *Watcher) Run(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	w.logger.Info(
		"catalog watcher started",
		slog.Duration("interval", w.interval),
		slog.String("writable_seed_path", w.writableSeedPath),
	)

	for {
		select {
		case <-ctx.Done():
			w.logger.Info("catalog watcher stopped")
			return
		case <-ticker.C:
			w.RefreshOnce()
		}
	}
}

// RefreshOnce hace UNA revisión completa: releva el catálogo si el archivo cambió y, pase lo que
// pase, recalcula y publica el estado vigente.
//
// En español: es pública para que las pruebas puedan provocar una revisión sin esperar a que salte
// el temporizador. El orden importa: primero el posible relevo y después el recálculo, de modo que
// el estado publicado corresponda siempre al catálogo que se está sirviendo en este mismo instante.
func (w *Watcher) RefreshOnce() {
	w.reloadWritableSeedIfChanged()
	w.publishCurrentState()
}

// reloadWritableSeedIfChanged mira el archivo actualizable y, si cambió y es válido, lo pone en servicio.
func (w *Watcher) reloadWritableSeedIfChanged() {
	if w.writableSeedPath == "" {
		return
	}

	stamp := w.readSeedStamp()
	if !stamp.exists() {
		// El archivo no está (todavía no se ha instalado ninguno, o se retiró). No es un problema:
		// el catálogo que viaja dentro de la imagen sigue sirviendo.
		return
	}
	if stamp == w.lastSeenSeedStamp {
		// Nadie lo ha tocado desde la última revisión: no hay nada que hacer.
		return
	}

	// Se anota la firma ANTES de intentar cargarlo, y a propósito. Si el archivo estuviera roto, no
	// queremos volver a intentarlo —y volver a quejarnos— en cada vuelta del temporizador: se avisa
	// una vez por cambio del archivo, y el siguiente intento ocurrirá cuando alguien lo corrija (lo
	// que cambiará su firma otra vez).
	w.lastSeenSeedStamp = stamp

	releases, err := LoadSeed(w.writableSeedPath)
	if err != nil {
		w.logger.Error(
			"the updated catalog seed is unusable; keeping the one already in service",
			slog.String("writable_seed_path", w.writableSeedPath),
			slog.String("error", err.Error()),
		)
		return
	}

	// El relevo: se construye el almacén nuevo ENTERO y luego se sustituye de un golpe. Ninguna
	// petición en curso llega a ver un catálogo a medio construir (ver Handler.SwapStore).
	previous := w.handler.SwapStore(NewStore(releases))

	previousReleaseCount := 0
	if previous != nil {
		previousReleaseCount = len(previous.Releases())
	}
	w.logger.Info(
		"catalog reloaded from the updated seed without restarting",
		slog.String("writable_seed_path", w.writableSeedPath),
		slog.Int("previous_releases", previousReleaseCount),
		slog.Int("releases", len(releases)),
		slog.Int("days_remaining", DaysRemaining(releases, w.now())),
	)
}

// publishCurrentState recalcula el estado del catálogo vigente contra la fecha de hoy y lo entrega.
//
// En español: esta es la línea que hace que la alarma deje de estar congelada. Los días restantes se
// vuelven a contar desde HOY, no desde el día del arranque, así que el número baja solo mientras el
// proceso sigue vivo y /readyz acaba pasando a "no listo" cuando toca.
func (w *Watcher) publishCurrentState() {
	store := w.handler.currentStore()
	if store == nil {
		// No debería ocurrir nunca (el handler nace con un almacén puesto), pero publicar ceros a
		// ciegas dispararía una falsa alarma de catálogo agotado. Se deja constancia y no se toca nada.
		w.logger.Error("the catalog handler has no store in service; catalog state was not refreshed")
		return
	}

	releases := store.Releases()
	w.state.SetCatalogState(len(releases), DaysRemaining(releases, w.now()))
}

// readSeedStamp mira el archivo vigilado y devuelve su firma, o una firma vacía si no se pudo mirar.
//
// En español: que el archivo no exista es normal y silencioso (todavía no se ha instalado ninguno).
// Cualquier OTRO fallo al mirarlo (permisos, disco) sí se registra, porque significa que el refresco
// automático no va a funcionar y nadie se enteraría de otro modo.
func (w *Watcher) readSeedStamp() seedStamp {
	if w.writableSeedPath == "" {
		return seedStamp{}
	}

	info, err := os.Stat(w.writableSeedPath)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			w.logger.Warn(
				"could not check the updated catalog seed file",
				slog.String("writable_seed_path", w.writableSeedPath),
				slog.String("error", err.Error()),
			)
		}
		return seedStamp{}
	}

	return seedStamp{modifiedAt: info.ModTime(), sizeBytes: info.Size()}
}
