package catalog

// Archivo: refresher.go — La recarga del catálogo SIN reiniciar el servidor.
//
// En español: el catálogo de estrenos vive en un archivo (el "seed") que se genera consultando TMDB.
// Hasta ahora ese archivo viajaba DENTRO de la imagen del programa, así que actualizarlo obligaba a
// reconstruir la imagen y volver a desplegar. Eso tiene una consecuencia incómoda: el catálogo tiene
// fecha de caducidad —cubre unos meses— y cuando se agota, la línea de tiempo se ve vacía aunque
// todo funcione perfectamente.
//
// Esta pieza resuelve las dos mitades del problema:
//   1. Al arrancar, el servidor PREFIERE un seed que esté en el directorio escribible (el que se
//      puede actualizar) y solo si no existe usa el que viene dentro de la imagen. Así el catálogo
//      deja de estar clavado al programa.
//   2. Un seed nuevo se puede cargar EN CALIENTE: se valida entero antes de tocar nada y, si es
//      correcto, se sustituye el catálogo de un golpe (ver Handler.SwapStore). Si el archivo nuevo
//      estuviera roto, no se toca el catálogo vigente y el servicio sigue sirviendo lo que tenía:
//      es preferible un catálogo viejo pero correcto a uno nuevo pero corrupto.
//
// Lo que este archivo NO hace: llamar a TMDB. La generación del seed es trabajo de las herramientas
// (seedgen/schedulegen), que se ejecutan aparte y dejan el archivo listo. Esa separación mantiene al
// servidor libre de la lógica de ingesta y de las credenciales de TMDB.
//
// QUIÉN USA CADA PIEZA (para que no quede ninguna sin cablear):
//   - LoadPreferringWritable la llama el arranque del servidor (cmd/api/main.go).
//   - InstallSeed la llama la herramienta de administración (`admintool install-seed`, expuesta como
//     `make seed-install`). Es un COMANDO y no una ruta HTTP a propósito: instalar un catálogo nuevo
//     es una operación del dueño del servicio, y una ruta —por muy protegida que estuviera— sería
//     una puerta más que vigilar en un servicio que hoy no tiene ningún concepto de administrador.
//   - Handler.SwapStore la llama el vigilante de este mismo paquete (watcher.go), que detecta que el
//     archivo escribible cambió y hace el relevo en caliente, sin reiniciar nada.

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// Source describe de dónde salió el catálogo que está cargado. Sirve para registrarlo con claridad.
type Source string

const (
	// SourceWritable significa que el catálogo se cargó del directorio escribible (el actualizable).
	SourceWritable Source = "writable"
	// SourceEmbedded significa que se cargó del archivo que viaja dentro de la imagen (el de respaldo).
	SourceEmbedded Source = "embedded"
)

// LoadResult resume una carga del catálogo: los estrenos, de dónde salieron y su horizonte.
type LoadResult struct {
	// Releases son los estrenos ya validados.
	Releases []*catalogv1.Release
	// Source indica de qué archivo se leyeron.
	Source Source
	// Path es la ruta concreta del archivo usado.
	Path string
	// DaysRemaining es cuántos días de FUTURO le quedan al catálogo desde hoy.
	DaysRemaining int
}

// LoadPreferringWritable carga el catálogo prefiriendo el archivo escribible sobre el de la imagen.
//
// En español: si existe un seed en la ruta escribible Y es válido, se usa ese, porque es el que se
// puede actualizar sin reconstruir nada. Si no existe, se usa el de la imagen. Si existe pero está
// ROTO, se registra el problema y se cae al de la imagen: un archivo corrupto no debe impedir que el
// servicio arranque, pero tampoco debe usarse en silencio.
func LoadPreferringWritable(writablePath, embeddedPath string, now time.Time, logger *slog.Logger) (LoadResult, error) {
	if writablePath != "" {
		releases, err := LoadSeed(writablePath)
		switch {
		case err == nil:
			return LoadResult{
				Releases:      releases,
				Source:        SourceWritable,
				Path:          writablePath,
				DaysRemaining: DaysRemaining(releases, now),
			}, nil
		case errors.Is(err, fs.ErrNotExist):
			// Ojo con la forma de preguntar "¿es que el archivo no existe?": tiene que ser errors.Is,
			// NO os.IsNotExist. LoadSeed envuelve el error original con %w para añadirle contexto, y
			// os.IsNotExist mira SOLO la capa exterior: con un error envuelto responde siempre "no".
			// Por eso, hasta esta corrección, el arranque normal de un despliegue nuevo (sin seed
			// actualizable todavía) caía en la rama de abajo y escribía un ERROR de falsa alarma como
			// primera línea del registro. errors.Is sí desenvuelve capa por capa hasta el error real.
			//
			// Que el archivo no exista es lo normal en un despliegue nuevo, no un problema.
			logger.Info(
				"no writable catalog seed yet, falling back to the one shipped with the image",
				slog.String("writable_path", writablePath),
			)
		default:
			// Existe pero no sirve. Se avisa alto y claro, y se sigue con el de la imagen.
			logger.Error(
				"writable catalog seed is unusable, falling back to the one shipped with the image",
				slog.String("writable_path", writablePath),
				slog.String("error", err.Error()),
			)
		}
	}

	releases, err := LoadSeed(embeddedPath)
	if err != nil {
		return LoadResult{}, fmt.Errorf("catalog: failed to load the embedded seed %q: %w", embeddedPath, err)
	}
	return LoadResult{
		Releases:      releases,
		Source:        SourceEmbedded,
		Path:          embeddedPath,
		DaysRemaining: DaysRemaining(releases, now),
	}, nil
}

// DaysRemaining calcula cuántos días de FUTURO le quedan al catálogo desde una fecha dada.
//
// En español: busca el estreno con la fecha más lejana y cuenta los días que faltan. Si todo ya
// pasó, devuelve 0: el catálogo está agotado y la línea de tiempo se verá sin futuro. Este número es
// la señal que permite avisar con semanas de antelación (se publica como métrica y lo usa /readyz).
// Las fechas mal formadas se ignoran en vez de romper el cálculo.
func DaysRemaining(releases []*catalogv1.Release, now time.Time) int {
	var latest time.Time
	for _, release := range releases {
		parsed, err := time.Parse(isoDateLayout, release.GetReleaseDate())
		if err != nil {
			continue
		}
		if parsed.After(latest) {
			latest = parsed
		}
	}
	if latest.IsZero() {
		return 0
	}

	// Se compara a nivel de DÍA para que el resultado no dependa de la hora a la que se pregunte.
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	days := int(latest.Sub(today).Hours() / 24)
	if days < 0 {
		return 0
	}
	return days
}

// InstallSeed valida un archivo de seed candidato y, si es correcto, lo instala como el seed vigente
// en la ruta escribible. Devuelve el resultado de la carga para que el llamador haga el relevo.
//
// En español: el orden importa muchísimo. Primero se VALIDA el candidato (se carga entero y se
// comprueba con las mismas reglas que al arrancar); solo si pasa, se copia a su sitio definitivo con
// una escritura ATÓMICA (se escribe a un temporal y se renombra). Así nunca existe un momento en el
// que el archivo oficial esté a medio escribir: si el proceso muriera en mitad de la operación, el
// seed anterior seguiría intacto.
func InstallSeed(candidatePath, writablePath string, now time.Time) (LoadResult, error) {
	releases, err := LoadSeed(candidatePath)
	if err != nil {
		return LoadResult{}, fmt.Errorf("catalog: the candidate seed %q is not valid: %w", candidatePath, err)
	}

	raw, err := os.ReadFile(candidatePath)
	if err != nil {
		return LoadResult{}, fmt.Errorf("catalog: failed to read the candidate seed %q: %w", candidatePath, err)
	}

	// El directorio destino puede no existir todavía (primer refresco de un despliegue nuevo).
	if err := os.MkdirAll(filepath.Dir(writablePath), seedDirPermissions); err != nil {
		return LoadResult{}, fmt.Errorf("catalog: failed to prepare the seed directory: %w", err)
	}

	// Escritura atómica: primero a un archivo temporal en el MISMO directorio (para que el renombrado
	// no cruce sistemas de archivos) y después se renombra sobre el definitivo.
	temporaryPath := writablePath + ".tmp"
	if err := os.WriteFile(temporaryPath, raw, seedFilePermissions); err != nil {
		return LoadResult{}, fmt.Errorf("catalog: failed to write the temporary seed: %w", err)
	}
	if err := os.Rename(temporaryPath, writablePath); err != nil {
		// Si el renombrado falla, se limpia el temporal para no dejar basura.
		_ = os.Remove(temporaryPath)
		return LoadResult{}, fmt.Errorf("catalog: failed to install the new seed: %w", err)
	}

	return LoadResult{
		Releases:      releases,
		Source:        SourceWritable,
		Path:          writablePath,
		DaysRemaining: DaysRemaining(releases, now),
	}, nil
}

// seedFilePermissions son los permisos del archivo de seed instalado (lectura/escritura del dueño).
const seedFilePermissions = 0o644

// seedDirPermissions son los permisos del directorio que contiene el seed escribible.
const seedDirPermissions = 0o755
