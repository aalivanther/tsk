// Command seedgen genera el archivo semilla (seed.json) del catálogo a partir de datos reales de TMDB.
// En español: este programa de línea de comandos construye el catálogo real consultando TMDB. Para
// cada mes pedido descubre los estrenos de cine en México, baja el detalle de cada película, lo
// traduce al modelo propio (Release) y junta todo en un archivo JSON con la forma {"releases":[...]}.
//
// ALCANCE: seedgen cubre PELÍCULAS (estrenos de CINE y DIGITALES) y SERIES. Para series, /discover/tv
// no acepta `region`, pero SÍ acepta `watch_region`=MX + `with_watch_monetization_types`=flatrate +
// `air_date.*`, con lo que obtenemos las series disponibles en México por mes (estrenos y nuevas
// temporadas). La categoría de cada título (CINE / STREAMING / CADENAS / INDIE) la decide el mapper con
// señales fiables de TMDB (tipos de estreno, proveedores, networks). No se inventan datos.
//
// Este programa hace llamadas REALES a la red: necesita la variable de entorno TMDB_READ_TOKEN. Sin
// token, no corre (no inventa datos). No debe ejecutarse en entornos sin token.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"google.golang.org/protobuf/encoding/protojson"

	// catalogv1 contiene los mensajes generados a partir de catalog.proto (Release, ListReleaseDetailsResponse).
	// En español: el seed se escribe con la MISMA forma que usa el backend al cargarlo, reutilizando
	// ListReleaseDetailsResponse como envoltorio {"releases":[...]}. Se usa ESE mensaje y no el del
	// listado porque el listado ya no devuelve fichas completas, y el archivo del catálogo sí las lleva.
	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
	// omdb es el cliente OPCIONAL que enriquece cada película con las calificaciones extra de IMDb,
	// Rotten Tomatoes y Metacritic. En español: solo se usa si hay OMDB_API_KEY; degrada elegante.
	"mdm7mo/internal/localsettings"
	"mdm7mo/internal/providers/omdb"
	"mdm7mo/internal/providers/tmdb"
)

// defaultOutputPath es la ruta por defecto donde se escribe el seed generado.
// En español: escribimos en "seed/seed.generated.json", una ruta SCRATCH que NUNCA pisa el seed
// curado de producción ("seed/seed.json", que conserva las series curadas a mano). Así, generar el
// seed desde TMDB es seguro por defecto: produce solo las películas en un archivo aparte que luego
// se revisa y se fusiona con las series curadas. El llamador puede cambiarlo con -out si lo desea.
const defaultOutputPath = "seed/seed.generated.json"

// curatedSeedPath es la ruta del seed CURADO de producción, que NO debe sobreescribirse por accidente.
// En español: "seed/seed.json" conserva las series curadas a mano (que seedgen no genera). Si el
// operador apunta -out a este archivo, abortamos salvo que pase -force a propósito (ver
// guardCuratedSeedPath). Así protegemos el trabajo manual de un comando que solo produce películas.
const curatedSeedPath = "seed/seed.json"

// seedMonth es UN mes concreto del calendario: año y mes juntos.
//
// Por qué no basta con el número del mes, en español: el generador trabajaba con un año suelto y una
// lista de meses ("2026" + "6,7,8"). Eso funciona mientras la ventana no cruce diciembre, y deja de
// funcionar justo cuando más falta hace: en noviembre, la ventana natural es nov-dic-ene-feb, y con un
// año único no hay forma de expresarla. Llevando el año pegado a cada mes, el cruce de año deja de ser
// un caso especial.
type seedMonth struct {
	year  int
	month int
}

// key devuelve la forma "AAAA-MM" del mes, que es como se comparan las fechas de los estrenos.
func (m seedMonth) key() string {
	return fmt.Sprintf("%04d-%02d", m.year, m.month)
}

// monthsAroundToday calcula la ventana de meses a generar tomando HOY como referencia.
//
// En español: devuelve `total` meses consecutivos empezando `before` meses ANTES del mes actual. Es la
// misma cuenta que hace la aplicación al decidir qué pedirle al servidor, y tenerla aquí es lo que
// evita el fallo que se coló hasta producción: los meses del generador estaban escritos a mano, así
// que al cambiar de mes el catálogo se quedaba corto por un lado y sobraba por el otro, sin que nada
// avisara. Con la ventana derivada de hoy, "make seed" acierta siempre sin que nadie edite nada.
func monthsAroundToday(today time.Time, before, total int) []seedMonth {
	months := make([]seedMonth, 0, total)
	// AddDate normaliza solo el desbordamiento de mes (mes 13 -> enero del año siguiente), así que el
	// cruce de año sale gratis. Se ancla al día 1 porque solo interesan año y mes.
	start := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -before, 0)
	for offset := range total {
		shifted := start.AddDate(0, offset, 0)
		months = append(months, seedMonth{year: shifted.Year(), month: int(shifted.Month())})
	}
	return months
}

// defaultYear y defaultMonths son el periodo que se genera cuando NO se usa -window.
//
// AVISO IMPORTANTE SOBRE ESTOS DOS VALORES, en español: son una fecha escrita a mano, así que
// envejecen solos. Y de hecho envejecieron: durante meses el comentario de aquí decía "mayo ya pasó;
// junio y julio están por venir" cuando el calendario iba ya por agosto de 2026, de modo que la
// documentación del propio archivo describía un futuro que era pasado. Es exactamente el fallo que
// motivó la existencia de -window, que deriva la ventana de HOY y no se desfasa nunca.
//
// Por eso estos valores NO describen "el periodo actual" ni pretenden hacerlo: son solo un punto de
// partida fijo para quien invoque la herramienta a mano sin decir qué quiere. La forma correcta de
// generar el catálogo es "make seed", que usa -window; ver el objetivo `seed` del Makefile. Si algún
// día hay que regenerar un periodo concreto, se nombra en la línea de comandos con -year/-months, que
// es justo para lo que están.
const defaultYear = 2026

// defaultMonths es la lista de meses (separados por comas) que acompaña a defaultYear.
// En español: se expresa como texto para pasarlo cómodo por línea de comandos. Leer el aviso de
// defaultYear antes de fiarse de estos meses.
const defaultMonths = "5,6,7"

// defaultRegion es la región por defecto (México).
const defaultRegion = "MX"

// jsonIndent es la sangría usada al escribir el JSON, para que el archivo sea legible por humanos.
const jsonIndent = "  "

// outputFilePermissions son los permisos del archivo de salida (lectura/escritura del dueño, lectura del resto).
const outputFilePermissions = 0o644

// seedTemporarySuffix es lo que se le añade al nombre del archivo mientras se está escribiendo.
// En español: el catálogo se escribe primero con este nombre y solo se renombra al definitivo cuando
// está completo y grabado en disco (ver writeSeedFile). Así nunca existe un instante en el que el
// archivo bueno esté a medias.
const seedTemporarySuffix = ".tmp"

// generationTimeout es el plazo máximo total para generar el seed completo.
//
// En español: la generación hace muchas llamadas a TMDB; este plazo evita que un cuelgue de red deje
// el proceso corriendo para siempre. Es holgado porque hay muchas peticiones secuenciales, y desde
// que existe la verificación de videos hay además unos cuantos miles de comprobaciones contra YouTube
// que van de seis en seis a propósito (ver oEmbedMaxConcurrency en youtube.go). Subir el ritmo para
// terminar antes es justo lo que no hay que hacer: provoca falsos negativos y borra tráilers buenos.
const generationTimeout = 30 * time.Minute

// main es el punto de entrada del CLI: ejecuta run() y traduce su error en un código de salida.
// En español: separamos la lógica en run() para poder devolver errores normales y manejar en un solo
// lugar la salida con código 1 y el mensaje a stderr.
func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "seedgen: %v\n", err)
		os.Exit(1)
	}
}

// run lee las banderas, valida el token, genera el catálogo y escribe el archivo de salida.
// En español: orquesta todo el proceso. Devuelve un error con contexto si algo falla (token ausente,
// fallo de red, error de escritura), que main() convierte en salida con código de error.
func run() error {
	// Definimos las banderas de línea de comandos con sus valores por defecto.
	outputPath := flag.String("out", defaultOutputPath, "ruta del archivo de salida del seed (JSON)")
	year := flag.Int("year", defaultYear, "año de los estrenos a generar")
	monthsRaw := flag.String("months", defaultMonths, "meses a generar, separados por comas (ej. \"6,7\"); se ignora si se usa -window")
	// -window es la forma RECOMENDADA de generar el catálogo: la ventana se deriva de la fecha de hoy,
	// así que nunca se queda desfasada. -year/-months siguen existiendo para regenerar un periodo
	// concreto del pasado o preparar uno futuro a mano.
	window := flag.Int("window", 0, "genera N meses consecutivos a partir de HOY (0 = usar -year/-months)")
	windowBefore := flag.Int("window-before", 1, "cuántos meses ANTES del actual empieza la ventana de -window")
	region := flag.String("region", defaultRegion, "región para estrenos y proveedores (ej. \"MX\")")
	// force permite, de forma EXPLÍCITA y consciente, escribir sobre el seed curado de producción.
	// En español: por seguridad, escribir sobre "seed/seed.json" está bloqueado salvo que el operador
	// pase -force a propósito (ver guardCuratedSeedPath). Así no se pisa el seed curado por accidente.
	force := flag.Bool("force", false, "permite escribir sobre el seed curado de producción (seed/seed.json)")
	// curated apunta a un archivo JSON de CURADURÍA (títulos investigados a mano) que se resuelven y
	// enriquecen contra TMDB y se AÑADEN a lo descubierto. Vacío = sin curaduría (solo discover).
	curatedPath := flag.String("curated", "", "ruta de un archivo JSON de curaduría (títulos extra verificados contra TMDB)")
	flag.Parse()

	// Guarda de seguridad: si -out apunta al seed curado de producción, abortamos salvo -force.
	if err := guardCuratedSeedPath(*outputPath, *force); err != nil {
		return err
	}

	// Preparamos un logger que escribe a stderr (la salida de progreso NO debe contaminar stdout ni
	// el archivo). NUNCA registramos el token: es un secreto.
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	// El token sale del entorno o, si ahí está vacío, del archivo que guarda la página
	// de configuración. Sin uno de los dos no hay llamadas reales.
	readToken, err := localsettings.FirstSet("TMDB_READ_TOKEN", func(doc localsettings.Document) string {
		return doc.TMDBReadToken
	})
	if err != nil {
		return err
	}
	if readToken == "" {
		return fmt.Errorf("set TMDB_READ_TOKEN or save it from the local configuration page")
	}

	// Decidimos QUÉ meses se generan. Con -window la ventana se deriva de hoy (lo recomendado, porque
	// no se desfasa nunca); sin él, se toman los meses explícitos de -year/-months.
	var months []seedMonth
	if *window > 0 {
		if *windowBefore < 0 {
			return fmt.Errorf("invalid -window-before value %d: cannot be negative", *windowBefore)
		}
		months = monthsAroundToday(time.Now().UTC(), *windowBefore, *window)
		logger.Info(
			"month window derived from today",
			slog.String("first", months[0].key()),
			slog.String("last", months[len(months)-1].key()),
		)
	} else {
		explicitMonths, err := parseMonths(*monthsRaw)
		if err != nil {
			return fmt.Errorf("invalid -months value %q: %w", *monthsRaw, err)
		}
		months = make([]seedMonth, 0, len(explicitMonths))
		for _, month := range explicitMonths {
			months = append(months, seedMonth{year: *year, month: month})
		}
	}

	// Creamos el cliente de TMDB con la región pedida (idioma por defecto es-MX).
	// Se le pasa el mismo registrador que usa el resto del generador para que los avisos del cliente
	// (por ejemplo, una entrada de TMDB ilegible que se salta) salgan mezclados en orden con el
	// progreso de la generación, y no por otro canal distinto.
	client := tmdb.NewClient(readToken, tmdb.WithRegion(*region), tmdb.WithLogger(logger))

	// Leemos la API key OPCIONAL de OMDb del entorno y creamos su cliente. OMDb es complementario: si
	// la key viene vacía, el cliente queda DESACTIVADO (Enabled() = false) y ni se intenta el
	// enriquecimiento. Como con el token de TMDB, la key de OMDb NUNCA se loguea: es un secreto.
	omdbAPIKey, err := localsettings.FirstSet("OMDB_API_KEY", func(doc localsettings.Document) string {
		return doc.OMDBAPIKey
	})
	if err != nil {
		return err
	}
	omdbClient := omdb.NewClient(omdbAPIKey)
	if omdbClient.Enabled() {
		logger.Info("omdb enabled, external ratings enrichment will run for movies and series with an imdb_id")
	} else {
		// AVISO GRANDE Y UNA SOLA VEZ, en vez de un apunte discreto que nadie lee.
		//
		// Por qué se sube a WARN, en español: el mensaje anterior decía "omdb disabled, skipping ratings
		// enrichment" al mismo nivel que las cien líneas de progreso normal, así que se perdía entre ellas.
		// El resultado fue que el catálogo llevaba meses con las tres calificaciones externas (IMDb, Rotten
		// Tomatoes y Metacritic) completamente vacías —0 de 422 estrenos— y nada en la salida del generador
		// lo señalaba como algo que hubiera que arreglar. Ahora se dice como aviso, se nombra la variable
		// que hay que rellenar y se dice exactamente qué campos van a quedar vacíos. Sigue sin ser un error
		// (el catálogo es perfectamente válido sin esas notas, la rareza sale de la de TMDB), pero deja de
		// ser invisible. Se registra UNA sola vez, aquí, y no una vez por título: repetirlo 422 veces
		// convertiría el aviso en ruido y volvería a esconder el problema.
		logger.Warn(
			"omdb disabled: set OMDB_API_KEY to fill external ratings; imdb, rotten_tomatoes and metacritic will be empty for every release in this seed",
		)
	}

	// Contexto con plazo total para toda la generación; se cancela solo al terminar run().
	ctx, cancel := context.WithTimeout(context.Background(), generationTimeout)
	defer cancel()

	// Consultamos /configuration una vez al inicio para fijar la base oficial de imágenes (y cachearla).
	// En español: así las URLs de póster/backdrop salen con la base correcta de TMDB.
	if _, err := client.Configuration(ctx); err != nil {
		return fmt.Errorf("failed to load TMDB configuration: %w", err)
	}
	logger.Info("tmdb configuration loaded")

	// Generamos los estrenos de todos los meses pedidos (enriquecidos con OMDb si está activo).
	releases, err := generateReleases(ctx, client, omdbClient, logger, months)
	if err != nil {
		return fmt.Errorf("failed to generate releases: %w", err)
	}

	// CURADURÍA: si se pidió, resolvemos los títulos investigados a mano contra TMDB (datos reales) y los
	// AÑADIMOS a lo descubierto, deduplicando por id. Cierra el hueco del futuro (jun/jul) y de las cadenas,
	// que el discover no fecha, SIN inventar (lo que no exista en TMDB se omite con aviso).
	if *curatedPath != "" {
		entries, curErr := loadCurated(*curatedPath)
		if curErr != nil {
			return fmt.Errorf("failed to load curated file: %w", curErr)
		}
		logger.Info("curating extra titles from TMDB", slog.Int("entries", len(entries)))
		// Reconstruimos el conjunto de ids ya presentes para deduplicar la curaduría contra el discover.
		seen := make(map[string]bool, len(releases))
		for _, release := range releases {
			seen[release.GetId()] = true
		}
		curated := processCurated(ctx, client, omdbClient, logger, entries, seen)
		releases = append(releases, curated...)
		logger.Info("curated titles added", slog.Int("count", len(curated)))
	}

	// Guarda de calidad: descartamos los estrenos cuya fecha cae FUERA de la ventana pedida.
	// En español: TMDB puede devolver, dentro de un descubrimiento del mes, un título cuya fecha de
	// estreno en México resuelve a otro año (típicamente una reposición o un dato de catálogo antiguo;
	// se observó "Los Concursantes" con fecha de 2016 al pedir 2026). Un título así aparecería en la
	// línea de tiempo en un año que nadie pidió, así que lo dejamos fuera y lo registramos.
	releases, discarded := keepReleasesInWindow(releases, months)
	for _, out := range discarded {
		logger.Warn(
			"release discarded: release date outside the requested window",
			slog.String("id", out.GetId()),
			slog.String("title", out.GetTitle()),
			slog.String("release_date", out.GetReleaseDate()),
		)
	}

	// VERIFICACIÓN DE VIDEOS: preguntamos a YouTube, uno por uno, si cada tráiler existe de verdad y
	// si permite reproducirse dentro de nuestra página. Los que no pasan la prueba NO SE ESCRIBEN.
	//
	// Por qué este paso existe, en español: hasta ahora el catálogo guardaba el código de un video y
	// no lo volvía a mirar nunca. Con el tiempo, algunos estudios ponen sus tráilers en privado o los
	// borran, y la persona que abría la ficha se encontraba una caja negra sin ninguna explicación. Es
	// el defecto que reportó el dueño. Comprobar aquí es la única barrera que lo cierra de raíz: si un
	// video llega al navegador es porque ya se verificó que reproduce. Ver youtube.go.
	verifiedAt := time.Now().UTC().Format(isoDateLayout)
	videoStats := verifyAndFilterVideos(ctx, logger, releases, verifiedAt)
	logVideoAudit(logger, videoStats)

	// Guarda de calidad: si la verificación de videos no se pudo hacer de verdad, NO escribimos.
	//
	// En español: esta línea es la que impide que un corte de red se convierta en un catálogo sin
	// tráilers. Antes, con el servicio de comprobación caído, la generación seguía adelante, borraba
	// todos los videos y escribía el archivo con código de salida cero. Ahora se para aquí, antes de
	// tocar el disco, y el catálogo que ya estuviera instalado se queda como estaba (ver
	// guardVideoVerificationHealth y maxUnverifiableVideoShare en youtube.go).
	if err := guardVideoVerificationHealth(ctx, videoStats); err != nil {
		return err
	}

	// Guarda de calidad: si no se generó NINGÚN estreno, NO escribimos un archivo vacío y fallamos.
	// En español: un seed vacío sería peor que no tener archivo (rompería el catálogo silenciosamente).
	// Esto suele indicar un token inválido, una región/mes sin estrenos o un fallo masivo de red, así
	// que salimos con error claro para que el operador investigue, sin tocar el disco.
	if len(releases) == 0 {
		return fmt.Errorf(
			"generated 0 releases for months %s..%s in region %q: refusing to write an empty seed",
			months[0].key(), months[len(months)-1].key(), *region,
		)
	}

	// Escribimos el archivo de salida con la forma {"releases":[...]}.
	if err := writeSeedFile(*outputPath, releases); err != nil {
		return fmt.Errorf("failed to write seed file %q: %w", *outputPath, err)
	}

	logger.Info("seed generated", slog.String("out", *outputPath), slog.Int("releases", len(releases)))
	return nil
}

// keepReleasesInWindow separa los estrenos en dos grupos: los que caen dentro de la ventana pedida
// (año + meses) y los que no. En español: devuelve primero los que se conservan y después los
// descartados, para que el llamador pueda registrar exactamente qué se dejó fuera y por qué.
// Un estreno sin fecha o con fecha mal formada se descarta: no se puede ubicar en la línea de tiempo.
func keepReleasesInWindow(
	releases []*catalogv1.Release,
	months []seedMonth,
) (kept, discarded []*catalogv1.Release) {
	// Conjunto de "AAAA-MM" aceptados, para comparar con el prefijo de la fecha ISO sin parsear fechas.
	allowed := make(map[string]bool, len(months))
	for _, month := range months {
		allowed[month.key()] = true
	}

	kept = make([]*catalogv1.Release, 0, len(releases))
	for _, release := range releases {
		date := release.GetReleaseDate()
		const yearMonthLength = 7 // "AAAA-MM"
		if len(date) >= yearMonthLength && allowed[date[:yearMonthLength]] {
			kept = append(kept, release)
			continue
		}
		discarded = append(discarded, release)
	}
	return kept, discarded
}

// guardCuratedSeedPath bloquea escribir sobre el seed curado de producción salvo que se fuerce.
//
// En español: compara la ruta de salida pedida con la del seed curado ("seed/seed.json"). Si las dos
// apuntan AL MISMO ARCHIVO, devuelve un error que pide usar la ruta scratch
// ("seed/seed.generated.json") o el flag -force. Con -force en true no estorba (el operador asume el
// riesgo de forma consciente).
//
// EL DETALLE QUE HACÍA INÚTIL ESTA GUARDA: comparar los dos textos, aunque estuvieran normalizados,
// solo detecta que se haya escrito exactamente la misma ruta relativa. Bastaba con nombrar el mismo
// archivo de otra manera para pasar de largo. Medido: tanto "/Users/…/backend/seed/seed.json" (la
// ruta absoluta) como "backend/seed/seed.json" (la misma ruta vista desde la raíz del repositorio en
// vez de desde backend/) atravesaban la guarda sin -force, y el generador se comía el seed curado —
// que es el único sitio donde viven las series curadas a mano, y no hay control de versiones del que
// recuperarlas.
//
// La comparación correcta no es entre nombres, sino entre ARCHIVOS. Por eso ahora ambas rutas se
// convierten a su forma absoluta y se resuelven los enlaces simbólicos antes de compararlas. Y si el
// archivo curado ya existe, se compara además su IDENTIDAD en el sistema de archivos (os.SameFile),
// que es lo único que reconoce dos nombres distintos del mismo archivo real, enlaces duros incluidos.
func guardCuratedSeedPath(outputPath string, force bool) error {
	// Con -force, el operador decide a propósito sobreescribir: no bloqueamos.
	if force {
		return nil
	}

	resolvedOutput, err := resolvePath(outputPath)
	if err != nil {
		return fmt.Errorf("could not resolve the output path %q: %w", outputPath, err)
	}
	resolvedCurated, err := resolvePath(curatedSeedPath)
	if err != nil {
		return fmt.Errorf("could not resolve the curated seed path %q: %w", curatedSeedPath, err)
	}

	// Primera comparación: la misma ruta real, escrita como se escriba.
	sameName := resolvedOutput == resolvedCurated

	// Segunda comparación: el mismo archivo real aunque las rutas no coincidan (enlaces duros). Solo
	// se puede hacer si ambos existen ya; que no existan no es un problema, la comparación de arriba
	// cubre el caso normal.
	sameFile := false
	if outputInfo, outputErr := os.Stat(resolvedOutput); outputErr == nil {
		if curatedInfo, curatedErr := os.Stat(resolvedCurated); curatedErr == nil {
			sameFile = os.SameFile(outputInfo, curatedInfo)
		}
	}

	if sameName || sameFile {
		return fmt.Errorf(
			"refusing to overwrite the curated seed %q (resolved to %q): write to the scratch path %q instead, or pass -force to override",
			curatedSeedPath, resolvedCurated, defaultOutputPath,
		)
	}
	return nil
}

// resolvePath convierte una ruta en su forma absoluta y sin enlaces simbólicos, para poder comparar
// dos rutas sabiendo si nombran el mismo archivo.
//
// En español: hay dos pasos y ninguno sobra. filepath.Abs completa la ruta con el directorio actual,
// que es lo que hace comparables "seed/seed.json" y "/…/backend/seed/seed.json". EvalSymlinks
// además sigue los atajos del sistema de archivos, que es lo que hace comparables dos nombres
// distintos del mismo archivo. Si la ruta todavía no existe —el caso normal al generar un archivo
// nuevo— EvalSymlinks no puede resolverla y se conserva la absoluta, que ya es suficiente.
func resolvePath(path string) (string, error) {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("failed to make the path absolute: %w", err)
	}

	resolvedPath, err := filepath.EvalSymlinks(absolutePath)
	if err != nil {
		// Que el archivo no exista es lo esperado al escribir uno nuevo: nos quedamos con la absoluta.
		if errors.Is(err, fs.ErrNotExist) {
			return filepath.Clean(absolutePath), nil
		}
		return "", fmt.Errorf("failed to resolve symlinks: %w", err)
	}
	return filepath.Clean(resolvedPath), nil
}

// generateReleases recorre cada mes, descubre películas, baja su detalle y las mapea a Release.
// En español: para cada mes pide los ids de estreno, y por cada id baja el detalle completo y lo
// traduce al modelo propio. Si una película falla al bajar, lo registra y sigue con las demás (un
// estreno roto no debe abortar todo el seed), pero sí propaga errores de descubrimiento (que afectan
// a un mes entero). DEDUPLICA por Id: si dos meses (o dos páginas) trajeran el mismo estreno, solo se
// añade una vez. Devuelve la lista acumulada en orden de primera aparición. Si omdbClient está activo,
// ENRIQUECE cada película (con imdb_id) con las calificaciones extra de OMDb, degradando elegante.
func generateReleases(
	ctx context.Context,
	client *tmdb.Client,
	omdbClient *omdb.Client,
	logger *slog.Logger,
	months []seedMonth,
) ([]*catalogv1.Release, error) {
	allReleases := make([]*catalogv1.Release, 0)
	// seenReleaseIDs recuerda qué ids ya añadimos para no duplicar un estreno que aparezca dos veces
	// (el mismo título puede salir en cine y en digital, o repetirse entre meses/páginas).
	seenReleaseIDs := make(map[string]bool)

	for _, window := range months {
		year, month := window.year, window.month
		// --- PELÍCULAS: estrenos de CINE (theatrical) + estrenos DIGITALES (plataforma/TV) ---
		// Juntamos ambos descubrimientos: así el catálogo cubre tanto salas como el grueso de estrenos
		// directos a streaming. La categoría final (CINE/STREAMING/INDIE) la decide el mapper por título.
		logger.Info("discovering movies", slog.Int("year", year), slog.Int("month", month))
		theatricalIDs, err := client.DiscoverMovies(ctx, year, month)
		if err != nil {
			return nil, fmt.Errorf("failed to discover theatrical movies for %04d-%02d: %w", year, month, err)
		}
		digitalIDs, err := client.DiscoverDigitalMovies(ctx, year, month)
		if err != nil {
			return nil, fmt.Errorf("failed to discover digital movies for %04d-%02d: %w", year, month, err)
		}
		movieIDs := append(append([]int{}, theatricalIDs...), digitalIDs...)
		logger.Info("movies discovered", slog.Int("month", month),
			slog.Int("theatrical", len(theatricalIDs)), slog.Int("digital", len(digitalIDs)))

		for _, movieID := range movieIDs {
			release := processMovie(ctx, client, omdbClient, logger, movieID, seenReleaseIDs)
			if release != nil {
				allReleases = append(allReleases, release)
			}
		}

		// --- SERIES: lo que está al aire ese mes en MX (estrenos y nuevas temporadas) ---
		logger.Info("discovering tv", slog.Int("year", year), slog.Int("month", month))
		tvIDs, err := client.DiscoverTV(ctx, year, month)
		if err != nil {
			return nil, fmt.Errorf("failed to discover tv for %04d-%02d: %w", year, month, err)
		}
		logger.Info("tv discovered", slog.Int("month", month), slog.Int("count", len(tvIDs)))

		for _, tvID := range tvIDs {
			release := processTV(ctx, client, omdbClient, logger, tvID, year, month, seenReleaseIDs)
			if release != nil {
				allReleases = append(allReleases, release)
			}
		}
	}

	return allReleases, nil
}

// processMovie baja el detalle de una película, la mapea, la enriquece (OMDb, saga, galería) y la
// devuelve lista para añadir. Devuelve nil si falla la descarga o si es un duplicado ya añadido.
// En español: aísla todo el trabajo por título para que un fallo puntual no tumbe el seed completo.
func processMovie(
	ctx context.Context,
	client *tmdb.Client,
	omdbClient *omdb.Client,
	logger *slog.Logger,
	movieID int,
	seenReleaseIDs map[string]bool,
) *catalogv1.Release {
	details, err := client.MovieDetails(ctx, movieID)
	if err != nil {
		logger.Warn("skipping movie due to fetch error",
			slog.Int("movie_id", movieID), slog.String("error", err.Error()))
		return nil
	}

	release := tmdb.MapMovieToRelease(details, client)

	// Si ya añadimos este estreno (mismo Id) en otra fuente/mes, lo saltamos para no duplicar.
	if seenReleaseIDs[release.GetId()] {
		return nil
	}
	seenReleaseIDs[release.GetId()] = true

	// Calificaciones extra de OMDb (degrada elegante: nunca rompe el seed).
	enrichWithOMDb(ctx, omdbClient, logger, release, details.ImdbID)

	// Saga (colección): MapMovieToRelease deja el nombre pero sin items; aquí los completamos.
	if details.BelongsToCollection != nil {
		collection, collErr := client.CollectionDetails(ctx, details.BelongsToCollection.ID)
		if collErr != nil {
			logger.Warn("could not load collection items",
				slog.Int("collection_id", details.BelongsToCollection.ID), slog.String("error", collErr.Error()))
		} else if release.GetSaga() != nil {
			release.Saga.Items = tmdb.MapCollectionToItems(collection, client)
		}
	}

	// Galería de escenas (backdrops): llamada aparte, también degrada elegante.
	fillGallery(ctx, client, logger, release, "movie", movieID)

	return release
}

// processTV baja el detalle de una serie, la mapea (con su saga de temporadas), la enriquece con las
// calificaciones externas de OMDb y le añade la galería.
// Devuelve nil si falla la descarga o si es un duplicado.
//
// SOBRE EL ENRIQUECIMIENTO DE LAS SERIES, en español: hasta ahora esta función NO llamaba a OMDb, con la
// justificación de que las series "no tienen imdb_id fiable". Es falso: el detalle de una serie no lo
// trae suelto, pero TMDB lo entrega en el bloque "external_ids", que ahora se pide en la misma llamada
// (ver tvAppendToResponse). El efecto de aquella omisión era que las 234 series del catálogo se quedaban
// sin nota de IMDb, Rotten Tomatoes ni Metacritic incluso si la clave de OMDb estuviera configurada: el
// enriquecimiento simplemente nunca se intentaba para ellas. Ahora se intenta, con el mismo trato
// tolerante que las películas (si OMDb está apagado o falla, se sigue sin romper nada).
func processTV(
	ctx context.Context,
	client *tmdb.Client,
	omdbClient *omdb.Client,
	logger *slog.Logger,
	tvID int,
	year int,
	month int,
	seenReleaseIDs map[string]bool,
) *catalogv1.Release {
	details, err := client.TVDetails(ctx, tvID)
	if err != nil {
		logger.Warn("skipping tv due to fetch error",
			slog.Int("tv_id", tvID), slog.String("error", err.Error()))
		return nil
	}

	// Solo nos quedamos con las series que ESTRENAN TEMPORADA en el mes consultado. En español: el
	// descubrimiento por fecha de emisión trae todo lo que tiene episodios ese mes, incluidas series
	// a media temporada; eso no es una novedad para el usuario (el capítulo 15 de algo que empezó en
	// marzo). Si no hay estreno de temporada, la descartamos con un registro de por qué.
	premiereDate := tmdb.SeasonPremiereInMonth(details, year, month)
	if premiereDate == "" {
		logger.Debug("skipping tv: no season premiere in the requested month",
			slog.Int("tv_id", tvID), slog.String("title", details.Name),
			slog.Int("year", year), slog.Int("month", month))
		return nil
	}

	release := tmdb.MapTVToRelease(details, client, premiereDate)

	if seenReleaseIDs[release.GetId()] {
		return nil
	}
	seenReleaseIDs[release.GetId()] = true

	// Calificaciones externas de OMDb, usando el identificador de IMDb que llega en "external_ids".
	// Degrada elegante igual que en películas: nunca rompe el seed.
	enrichWithOMDb(ctx, omdbClient, logger, release, details.ExternalIDs.ImdbID)

	fillGallery(ctx, client, logger, release, "tv", tvID)

	return release
}

// fillGallery baja la galería de imágenes de un título y la asigna al Release. Degrada elegante: si la
// llamada falla, registra un warning y deja la galería vacía (no rompe el seed).
func fillGallery(
	ctx context.Context,
	client *tmdb.Client,
	logger *slog.Logger,
	release *catalogv1.Release,
	kind string,
	id int,
) {
	images, err := client.Images(ctx, kind, id)
	if err != nil {
		logger.Warn("could not load gallery images",
			slog.String("kind", kind), slog.Int("id", id), slog.String("error", err.Error()))
		return
	}
	release.Images = tmdb.MapImagesToGallery(images, client)
}

// enrichWithOMDb completa las calificaciones extra de un estreno (IMDb, Rotten Tomatoes, Metacritic)
// usando OMDb, SIN abortar nunca por su culpa (degrada elegante).
// En español: OMDb es complementario. La regla es no romper el seed por él:
//   - Si el cliente está desactivado (sin OMDB_API_KEY), ByIMDbID devuelve ErrDisabled y aquí no
//     hacemos nada (ni siquiera lo registramos como warning: es el estado normal "OMDb apagado").
//   - Si el título no trae imdb_id, no hay forma de consultar OMDb: lo saltamos en silencio. En las
//     películas ese identificador viene suelto en el detalle; en las series llega en "external_ids".
//   - Si OMDb falla por cualquier otra razón (red, "N/A", título no encontrado), lo registramos como
//     WARNING y seguimos: el rating de TMDB (base de la rareza) ya está, así que el estreno es válido.
//
// Cuando sí hay datos, rellena los tres campos de release.Ratings. No pisa el rating de TMDB (ese ya
// venía del mapper); solo añade lo que TMDB no da.
func enrichWithOMDb(
	ctx context.Context,
	omdbClient *omdb.Client,
	logger *slog.Logger,
	release *catalogv1.Release,
	imdbID string,
) {
	// Si OMDb está apagado a propósito, no intentamos nada (no es un fallo: es la configuración normal).
	if !omdbClient.Enabled() {
		return
	}

	// Sin imdb_id no podemos consultar OMDb (se busca por IMDb ID). Lo dejamos pasar sin ruido.
	if imdbID == "" {
		return
	}

	// Consultamos OMDb. Cualquier error (incluida la cuota agotada o un "N/A" generalizado) se trata
	// como un aviso, NO como un fallo del seed: por eso solo logueamos warning y volvemos.
	omdbResult, err := omdbClient.ByIMDbID(ctx, imdbID)
	if err != nil {
		logger.Warn(
			"omdb enrichment skipped for release",
			slog.String("release_id", release.GetId()),
			slog.String("imdb_id", imdbID),
			slog.String("error", err.Error()),
		)
		return
	}

	// Garantizamos que el contenedor de calificaciones exista antes de rellenarlo. El mapper siempre lo
	// crea (con el rating de TMDB dentro), pero comprobarlo evita un acceso a nil si eso cambiara.
	if release.Ratings == nil {
		release.Ratings = &catalogv1.Ratings{}
	}

	// Rellenamos solo los campos de OMDb; el rating de TMDB (release.Ratings.Tmdb) se conserva intacto.
	release.Ratings.Imdb = omdbResult.IMDb
	release.Ratings.RottenTomatoes = omdbResult.RottenTomatoes
	release.Ratings.Metacritic = omdbResult.Metacritic
}

// writeSeedFile serializa los estrenos al formato JSON del seed y los escribe en disco DE UN GOLPE.
//
// En español: envuelve la lista en ListReleaseDetailsResponse (la misma forma {"releases":[...]} que
// lee el backend) y la convierte a JSON con nombres en camelCase (UseProtoNames:false) y sangría
// legible.
//
// POR QUÉ NO SE ESCRIBE DIRECTAMENTE SOBRE EL ARCHIVO, que es lo que hacía antes: abrir el archivo
// definitivo para escribir lo VACÍA en ese mismo instante, antes de tener ni un byte del contenido
// nuevo. Si el proceso muere, el disco se llena o alguien lo interrumpe en ese hueco, lo que queda
// en disco no es el catálogo viejo ni el nuevo: es un archivo truncado. Se midió: 3143 bytes antes,
// 2 bytes después. Y como ese archivo es el que sirve el catálogo, el destrozo es de producción.
//
// La forma correcta es la misma que ya usa la instalación del catálogo (catalog.InstallSeed): se
// escribe TODO en un archivo temporal del MISMO directorio, se fuerza a disco con Sync (para que no
// se quede en la memoria intermedia del sistema) y solo entonces se renombra sobre el definitivo. El
// renombrado dentro de un mismo sistema de archivos es una operación indivisible: o está el archivo
// viejo entero, o está el nuevo entero. No existe el estado intermedio.
func writeSeedFile(outputPath string, releases []*catalogv1.Release) error {
	response := &catalogv1.ListReleaseDetailsResponse{Releases: releases}

	// Configuramos la serialización: nombres camelCase (los que usa el seed actual) y sangría de 2 espacios.
	marshalOptions := protojson.MarshalOptions{
		UseProtoNames: false,
		Indent:        jsonIndent,
	}

	jsonBytes, err := marshalOptions.Marshal(response)
	if err != nil {
		return fmt.Errorf("failed to marshal releases to JSON: %w", err)
	}

	// El temporal vive en el mismo directorio que el destino a propósito: renombrar entre dos
	// sistemas de archivos distintos no es una operación indivisible (sería copiar y borrar), y el
	// directorio de destino puede estar montado aparte.
	temporaryPath := outputPath + seedTemporarySuffix
	if err := writeFileAndSync(temporaryPath, jsonBytes); err != nil {
		// Si algo falló a mitad, el destrozo se queda en el temporal; el archivo bueno no se tocó.
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("failed to write the temporary seed file %q: %w", temporaryPath, err)
	}

	if err := os.Rename(temporaryPath, outputPath); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("failed to move the temporary seed file into place: %w", err)
	}

	return nil
}

// writeFileAndSync escribe el contenido completo en una ruta y no vuelve hasta que está EN EL DISCO.
//
// En español: escribir en un archivo normalmente solo deja los datos en la memoria intermedia del
// sistema operativo, que los volcará al disco cuando le parezca. Si la máquina se apaga en ese rato,
// el renombrado puede haber quedado hecho y el contenido no, que es la peor combinación posible: un
// catálogo oficial que apunta a un archivo vacío. Sync obliga a que el contenido esté grabado antes
// de seguir. Se cierra explícitamente comprobando el error de cierre, porque en algunos sistemas es
// el cierre —y no la escritura— el que informa de que el disco se llenó.
func writeFileAndSync(path string, contents []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, outputFilePermissions)
	if err != nil {
		return fmt.Errorf("failed to create the file: %w", err)
	}

	if _, err := file.Write(contents); err != nil {
		_ = file.Close()
		return fmt.Errorf("failed to write the contents: %w", err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return fmt.Errorf("failed to flush the contents to disk: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("failed to close the file: %w", err)
	}

	return nil
}

// parseMonths convierte una lista de meses en texto ("6,7") a una lista de enteros válidos y únicos.
// En español: separa por comas, recorta espacios, convierte cada parte a número y comprueba que esté
// en el rango de meses válidos. Devuelve error claro si algún valor está vacío, no es número o se sale
// del rango, para no generar un seed con meses imposibles. Además DEDUPLICA: si el mismo mes aparece
// varias veces (ej. "6,6,7"), lo conservamos una sola vez y en su primer orden de aparición, para no
// procesar dos veces el mismo mes ni duplicar estrenos.
func parseMonths(raw string) ([]int, error) {
	parts := strings.Split(raw, ",")
	months := make([]int, 0, len(parts))
	// seenMonths recuerda qué meses ya añadimos para descartar repetidos.
	seenMonths := make(map[int]bool, len(parts))

	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			return nil, fmt.Errorf("found an empty month entry")
		}
		month, err := strconv.Atoi(trimmed)
		if err != nil {
			return nil, fmt.Errorf("month %q is not a number: %w", trimmed, err)
		}
		const firstMonth, lastMonth = 1, 12
		if month < firstMonth || month > lastMonth {
			return nil, fmt.Errorf("month %d is out of range (must be %d-%d)", month, firstMonth, lastMonth)
		}
		// Saltamos los meses repetidos: solo conservamos la primera aparición.
		if seenMonths[month] {
			continue
		}
		seenMonths[month] = true
		months = append(months, month)
	}

	return months, nil
}
