// Archivo: main_test.go — Pruebas del generador de seed (seedgen) que NO tocan TMDB.
// En español: estas pruebas verifican la lógica pura del CLI sin hacer ninguna llamada de red: el
// parseo y deduplicado de meses, la guarda que protege el seed curado de producción, y la escritura
// del archivo de seed a un directorio temporal con estrenos válidos. No necesitan token ni internet.

package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
	"mdm7mo/internal/providers/omdb"
	"mdm7mo/internal/providers/tmdb"
)

// TestParseMonthsRangeFormatAndDedup verifica el parseo, validación y deduplicado de meses.
// En español: comprueba un caso válido normal, el deduplicado de meses repetidos (conservando el
// primer orden), y los errores ante valores vacíos, no numéricos o fuera del rango 1-12.
func TestParseMonthsRangeFormatAndDedup(t *testing.T) {
	t.Parallel()

	// Caso válido normal: dos meses distintos en orden.
	months, err := parseMonths("6,7")
	if err != nil {
		t.Fatalf("parseMonths(\"6,7\") returned an unexpected error: %v", err)
	}
	if len(months) != 2 || months[0] != 6 || months[1] != 7 {
		t.Errorf("parseMonths(\"6,7\") = %v, want [6 7]", months)
	}

	// Deduplicado: "6,6,7,7" debe quedar en [6 7] (primer orden de aparición).
	deduped, err := parseMonths("6,6,7,7")
	if err != nil {
		t.Fatalf("parseMonths(\"6,6,7,7\") returned an unexpected error: %v", err)
	}
	if len(deduped) != 2 || deduped[0] != 6 || deduped[1] != 7 {
		t.Errorf("parseMonths(\"6,6,7,7\") = %v, want [6 7] (deduplicated)", deduped)
	}

	// Espacios alrededor de los números deben recortarse.
	spaced, err := parseMonths(" 6 , 7 ")
	if err != nil {
		t.Fatalf("parseMonths(\" 6 , 7 \") returned an unexpected error: %v", err)
	}
	if len(spaced) != 2 || spaced[0] != 6 || spaced[1] != 7 {
		t.Errorf("parseMonths(\" 6 , 7 \") = %v, want [6 7]", spaced)
	}

	// Errores: entrada vacía, no numérica y fuera de rango.
	errorCases := []string{
		"6,,7",  // entrada vacía
		"6,abc", // no numérica
		"0",     // fuera de rango (menor que 1)
		"13",    // fuera de rango (mayor que 12)
	}
	for _, raw := range errorCases {
		if _, err := parseMonths(raw); err == nil {
			t.Errorf("parseMonths(%q) returned nil error, want an error", raw)
		}
	}
}

// TestGuardCuratedSeedPath verifica la guarda que protege el seed curado de producción.
// En español: apuntar -out a "seed/seed.json" debe abortar (salvo -force); apuntar a la ruta scratch
// o usar -force debe permitir continuar. Probamos variantes de la ruta (con "./" y "//") para
// confirmar que la normalización las cubre y no se puede burlar la guarda con un rodeo trivial.
func TestGuardCuratedSeedPath(t *testing.T) {
	t.Parallel()

	// La ruta del seed curado SIN -force debe producir error.
	if err := guardCuratedSeedPath(curatedSeedPath, false); err == nil {
		t.Errorf("guardCuratedSeedPath(%q, false) = nil, want an error", curatedSeedPath)
	}

	// Variantes equivalentes de la ruta curada también deben bloquearse (normalización).
	for _, variant := range []string{"seed/./seed.json", "seed//seed.json"} {
		if err := guardCuratedSeedPath(variant, false); err == nil {
			t.Errorf("guardCuratedSeedPath(%q, false) = nil, want an error (normalized path)", variant)
		}
	}

	// Con -force, escribir sobre el seed curado se permite (el operador asume el riesgo).
	if err := guardCuratedSeedPath(curatedSeedPath, true); err != nil {
		t.Errorf("guardCuratedSeedPath(%q, true) = %v, want nil (force overrides)", curatedSeedPath, err)
	}

	// La ruta scratch por defecto NO debe bloquearse nunca.
	if err := guardCuratedSeedPath(defaultOutputPath, false); err != nil {
		t.Errorf("guardCuratedSeedPath(%q, false) = %v, want nil (scratch path)", defaultOutputPath, err)
	}
}

// TestGuardCuratedSeedPathCannotBeDodgedWithAnotherSpelling cierra el agujero por el que se colaba.
//
// EL AGUJERO, en español: la guarda comparaba TEXTOS, así que solo reconocía el seed curado si se
// escribía exactamente igual que la constante. Nombrar el mismo archivo de otra forma bastaba para
// pasar de largo, y se comprobó con dos formas que cualquiera usaría sin mala intención: la ruta
// absoluta ("/…/backend/seed/seed.json") y la misma ruta vista desde la raíz del repositorio
// ("backend/seed/seed.json") en vez de desde backend/. Las dos pasaban y el generador se comía el
// seed curado —que guarda las series investigadas a mano y del que no hay copia recuperable, porque
// el proyecto no usa control de versiones—.
//
// La prueba se monta en un directorio temporal con la misma forma que el repositorio real y prueba
// las tres maneras de nombrar el mismo archivo, incluida una a través de un enlace simbólico.
func TestGuardCuratedSeedPathCannotBeDodgedWithAnotherSpelling(t *testing.T) {
	// Sin t.Parallel: esta prueba cambia el directorio de trabajo, que es un ajuste de TODO el
	// proceso. Corriendo en paralelo con otras, se lo cambiaría también a ellas.
	repositoryRoot := t.TempDir()
	backendDirectory := filepath.Join(repositoryRoot, "backend")
	seedDirectory := filepath.Join(backendDirectory, "seed")
	if err := os.MkdirAll(seedDirectory, 0o755); err != nil {
		t.Fatalf("failed to prepare the fake repository: %v", err)
	}
	curatedFile := filepath.Join(seedDirectory, "seed.json")
	if err := os.WriteFile(curatedFile, []byte(`{"releases":[]}`), 0o644); err != nil {
		t.Fatalf("failed to create the fake curated seed: %v", err)
	}

	// Un enlace simbólico que apunta al mismo archivo con otro nombre: el rodeo más sutil de todos.
	linkedFile := filepath.Join(seedDirectory, "atajo.json")
	if err := os.Symlink(curatedFile, linkedFile); err != nil {
		t.Fatalf("failed to create the symlink: %v", err)
	}

	// El generador se ejecuta siempre desde dentro de backend/, así que la constante relativa
	// "seed/seed.json" apunta al archivo de arriba.
	t.Chdir(backendDirectory)

	dodges := []struct {
		name string
		path string
	}{
		{name: "ruta relativa de siempre", path: curatedSeedPath},
		{name: "ruta absoluta", path: curatedFile},
		{name: "ruta desde la raiz del repositorio", path: "../backend/seed/seed.json"},
		{name: "enlace simbolico al mismo archivo", path: linkedFile},
	}

	for _, dodge := range dodges {
		if err := guardCuratedSeedPath(dodge.path, false); err == nil {
			t.Errorf("guardCuratedSeedPath(%q, false) = nil, want an error (%s)", dodge.path, dodge.name)
		}
	}

	// Y la ruta scratch de verdad sigue permitida, escrita como se escriba.
	for _, allowed := range []string{defaultOutputPath, filepath.Join(seedDirectory, "seed.generated.json")} {
		if err := guardCuratedSeedPath(allowed, false); err != nil {
			t.Errorf("guardCuratedSeedPath(%q, false) = %v, want nil", allowed, err)
		}
	}
}

// TestWriteSeedFileNeverLeavesATruncatedCatalog es la prueba de la escritura indivisible.
//
// EL DESTROZO QUE EVITA, en español: escribir directamente sobre el archivo definitivo lo VACÍA en
// ese mismo instante, antes de tener ni un byte del contenido nuevo. Si algo falla en ese hueco, lo
// que queda en disco no es el catálogo viejo ni el nuevo: es un archivo truncado. Se midió sobre el
// archivo real: 3143 bytes antes, 2 bytes después.
//
// Para provocar el fallo sin depender de la suerte, se pone un DIRECTORIO justo donde la escritura
// necesita crear su archivo temporal. Es un fallo real de sistema de archivos, ocurre a mitad de la
// operación, y lo que se exige es que el archivo bueno salga de ahí exactamente como entró.
func TestWriteSeedFileNeverLeavesATruncatedCatalog(t *testing.T) {
	t.Parallel()

	workDirectory := t.TempDir()
	outputPath := filepath.Join(workDirectory, "seed.json")

	// El catálogo que ya estaba en servicio, con su contenido y su tamaño conocidos.
	previousContents := []byte(`{"releases":[{"id":"anterior","title":"El catálogo de antes"}]}`)
	if err := os.WriteFile(outputPath, previousContents, 0o644); err != nil {
		t.Fatalf("failed to create the previous catalog: %v", err)
	}

	// El obstáculo: un directorio con el nombre exacto que necesita el archivo temporal.
	if err := os.Mkdir(outputPath+seedTemporarySuffix, 0o755); err != nil {
		t.Fatalf("failed to place the obstacle: %v", err)
	}

	releases := []*catalogv1.Release{{Id: "nuevo", Title: "El catálogo nuevo"}}
	if err := writeSeedFile(outputPath, releases); err == nil {
		t.Fatal("writeSeedFile returned nil; it must fail when it cannot write its temporary file")
	}

	// LO IMPORTANTE: el archivo que estaba en servicio sigue completo e intacto.
	afterContents, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("the previous catalog disappeared: %v", err)
	}
	if string(afterContents) != string(previousContents) {
		t.Fatalf("the previous catalog changed: %d bytes before, %d bytes after; it must be untouched",
			len(previousContents), len(afterContents))
	}
}

// TestWriteSeedFileLeavesNoLeftovers comprueba que la escritura buena no deja basura detrás.
// En español: el archivo temporal es un medio, no un resultado. Si se quedara en el directorio, la
// siguiente ejecución se lo encontraría y alguien acabaría preguntándose cuál de los dos vale.
func TestWriteSeedFileLeavesNoLeftovers(t *testing.T) {
	t.Parallel()

	workDirectory := t.TempDir()
	outputPath := filepath.Join(workDirectory, "seed.json")

	releases := []*catalogv1.Release{{Id: "nuevo", Title: "El catálogo nuevo"}}
	if err := writeSeedFile(outputPath, releases); err != nil {
		t.Fatalf("writeSeedFile returned an unexpected error: %v", err)
	}

	entries, err := os.ReadDir(workDirectory)
	if err != nil {
		t.Fatalf("failed to list the directory: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "seed.json" {
		names := make([]string, 0, len(entries))
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		t.Errorf("the directory contains %v, want only [seed.json]", names)
	}
}

// TestWriteSeedFile verifica la escritura del archivo de seed con estrenos válidos.
// En español: escribe un seed con dos estrenos a un directorio temporal (t.TempDir, que el runtime
// limpia solo) y vuelve a leerlo para confirmar que el JSON tiene la forma {"releases":[...]} y que
// los datos sobreviven el ida y vuelta. No toca TMDB ni el seed real del proyecto.
func TestWriteSeedFile(t *testing.T) {
	t.Parallel()

	releases := []*catalogv1.Release{
		{
			Id:    "toy-story-tmdb-862",
			Type:  catalogv1.TitleType_MOVIE,
			Title: "Toy Story",
		},
		{
			Id:    "la-casa-del-dragon-tmdb-1399",
			Type:  catalogv1.TitleType_SERIES,
			Title: "La Casa del Dragón",
		},
	}

	// Escribimos en un archivo dentro del directorio temporal de la prueba.
	outputPath := filepath.Join(t.TempDir(), "seed.generated.json")
	if err := writeSeedFile(outputPath, releases); err != nil {
		t.Fatalf("writeSeedFile returned an unexpected error: %v", err)
	}

	// Leemos el archivo de vuelta.
	rawBytes, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("failed to read back the seed file: %v", err)
	}

	// Deserializamos a un mapa genérico para inspeccionar la forma sin acoplarnos al orden de campos.
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal(rawBytes, &decoded); err != nil {
		t.Fatalf("seed file is not valid JSON: %v", err)
	}

	// Debe existir la clave "releases" (camelCase, igual que el seed que lee el backend).
	releasesRaw, ok := decoded["releases"]
	if !ok {
		t.Fatalf("seed JSON has no \"releases\" key; got keys %v", keysOf(decoded))
	}

	// Y debe contener exactamente dos estrenos con sus títulos.
	var decodedReleases []map[string]any
	if err := json.Unmarshal(releasesRaw, &decodedReleases); err != nil {
		t.Fatalf("\"releases\" is not a JSON array: %v", err)
	}
	if len(decodedReleases) != 2 {
		t.Fatalf("seed has %d releases, want 2", len(decodedReleases))
	}
	if decodedReleases[0]["title"] != "Toy Story" {
		t.Errorf("releases[0].title = %v, want %q", decodedReleases[0]["title"], "Toy Story")
	}
}

// keysOf devuelve las claves de un mapa, solo para enriquecer los mensajes de error de las pruebas.
// En español: ayudante diminuto que lista las claves presentes cuando falta la esperada.
func keysOf(m map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	return keys
}

// TestMonthsAroundTodayDerivesTheWindowFromToday comprueba la ventana relativa a la fecha de hoy.
//
// En español: esta función existe para que "make seed" acierte siempre sin que nadie edite meses a
// mano. Los meses estaban escritos a mano, y el efecto fue exactamente el que se ve venir cuando algo
// así se escribe a mano: al pasar el tiempo, el catálogo se quedó corto por delante y sobrando por
// detrás, sin que nada avisara. Quien abría la aplicación veía un mes sin estrenos y concluía, con
// razón, que estaba desactualizada.
func TestMonthsAroundTodayDerivesTheWindowFromToday(t *testing.T) {
	cases := map[string]struct {
		today  time.Time
		before int
		total  int
		want   []string
	}{
		"un mes atrás y el resto adelante": {
			today:  time.Date(2026, 7, 29, 0, 0, 0, 0, time.UTC),
			before: 1,
			total:  6,
			want:   []string{"2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"},
		},
		"CRUCE DE AÑO: en noviembre la ventana entra en el año siguiente": {
			// Es el caso que el diseño anterior NO podía expresar: con un año único y una lista de
			// meses, no había forma de pedir "nov, dic, ene, feb". Aquí sale gratis.
			today:  time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC),
			before: 1,
			total:  6,
			want:   []string{"2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"},
		},
		"CRUCE DE AÑO hacia atrás: en enero la ventana empieza en diciembre": {
			today:  time.Date(2027, 1, 15, 0, 0, 0, 0, time.UTC),
			before: 1,
			total:  3,
			want:   []string{"2026-12", "2027-01", "2027-02"},
		},
		"sin mirar atrás, la ventana arranca en el mes actual": {
			today:  time.Date(2026, 7, 29, 0, 0, 0, 0, time.UTC),
			before: 0,
			total:  2,
			want:   []string{"2026-07", "2026-08"},
		},
		"el último día del mes sigue contando como ese mes": {
			// El anclaje al día 1 evita que un 31 de diciembre a las 23:59 se cuele en enero.
			today:  time.Date(2026, 12, 31, 23, 59, 0, 0, time.UTC),
			before: 1,
			total:  3,
			want:   []string{"2026-11", "2026-12", "2027-01"},
		},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			months := monthsAroundToday(testCase.today, testCase.before, testCase.total)

			if len(months) != len(testCase.want) {
				t.Fatalf("want %d months, got %d (%v)", len(testCase.want), len(months), months)
			}
			for index, month := range months {
				if month.key() != testCase.want[index] {
					t.Fatalf("month %d: want %q, got %q", index, testCase.want[index], month.key())
				}
			}
		})
	}
}

// TestKeepReleasesInWindowAcceptsMonthsFromDifferentYears comprueba el filtro con ventanas que cruzan
// de año.
//
// En español: el filtro descarta los estrenos cuya fecha cae fuera de los meses pedidos (TMDB devuelve
// de vez en cuando reposiciones con fechas antiguas). Lo que se vigila aquí es que, ahora que la
// ventana puede abarcar dos años, no se cuele ni se descarte nada por el cambio de año.
func TestKeepReleasesInWindowAcceptsMonthsFromDifferentYears(t *testing.T) {
	months := []seedMonth{
		{year: 2026, month: 12},
		{year: 2027, month: 1},
	}
	releases := []*catalogv1.Release{
		{Id: "diciembre", ReleaseDate: "2026-12-18"},
		{Id: "enero", ReleaseDate: "2027-01-09"},
		{Id: "reposicion-vieja", ReleaseDate: "2016-09-25"},
		{Id: "fuera-por-un-mes", ReleaseDate: "2027-02-02"},
	}

	kept, discarded := keepReleasesInWindow(releases, months)

	if len(kept) != 2 {
		t.Fatalf("want 2 kept releases, got %d", len(kept))
	}
	if kept[0].GetId() != "diciembre" || kept[1].GetId() != "enero" {
		t.Fatalf("want the December and January releases kept, got %q and %q", kept[0].GetId(), kept[1].GetId())
	}
	if len(discarded) != 2 {
		t.Fatalf("want 2 discarded releases, got %d", len(discarded))
	}
}

// TestProcessTVEnrichesRatingsFromOMDb comprueba que UNA SERIE recibe sus calificaciones externas.
//
// Por qué esta prueba existe, en español: durante meses las 234 series del catálogo no tuvieron ni una
// nota de IMDb, Rotten Tomatoes o Metacritic. Se creía que era culpa de que faltaba la clave de OMDb en
// la configuración, y solo era la mitad del problema: la función que procesa las series NO LLAMABA al
// enriquecimiento, así que habrían seguido vacías aunque la clave estuviera puesta. Como la clave sigue
// sin estar (es cosa del dueño), esa segunda mitad no se puede comprobar abriendo la aplicación. Esta
// prueba la comprueba de verdad: levanta un TMDB de mentira y un OMDb de mentira, y verifica que las
// notas acaban en la ficha de la serie. Si alguien vuelve a quitar esa llamada, la prueba lo caza.
//
// De paso fija el camino por el que viaja el identificador de IMDb de una serie: TMDB no lo pone suelto
// en el detalle (como sí hace en las películas), sino dentro del bloque "external_ids".
func TestProcessTVEnrichesRatingsFromOMDb(t *testing.T) {
	t.Parallel()

	const seriesIMDbID = "tt0944947"

	// TMDB de mentira: responde el detalle de la serie (con su temporada estrenada en el mes que se
	// pedirá y su identificador de IMDb) y una galería vacía. No sale a internet.
	fakeTMDB := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(request.URL.Path, "/images") {
			_, _ = writer.Write([]byte(`{"backdrops":[]}`))
			return
		}
		_, _ = writer.Write([]byte(`{
			"id": 1399,
			"name": "Serie de prueba",
			"overview": "Sinopsis en español.",
			"first_air_date": "2026-06-01",
			"seasons": [{"season_number": 2, "air_date": "2026-06-15", "name": "Temporada 2"}],
			"external_ids": {"imdb_id": "` + seriesIMDbID + `"}
		}`))
	}))
	defer fakeTMDB.Close()

	// OMDb de mentira: devuelve las tres calificaciones para el identificador de la serie.
	fakeOMDb := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got := request.URL.Query().Get("i"); got != seriesIMDbID {
			t.Errorf("omdb was asked for imdbID %q, want %q", got, seriesIMDbID)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"Response": "True",
			"imdbRating": "9.2",
			"Ratings": [
				{"Source": "Rotten Tomatoes", "Value": "89%"},
				{"Source": "Metacritic", "Value": "86/100"}
			]
		}`))
	}))
	defer fakeOMDb.Close()

	tmdbClient := tmdb.NewClient("fake-token", tmdb.WithBaseURL(fakeTMDB.URL))
	omdbClient := omdb.NewClient("fake-key", omdb.WithBaseURL(fakeOMDb.URL))
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	release := processTV(
		context.Background(), tmdbClient, omdbClient, logger,
		1399, 2026, 6, map[string]bool{},
	)
	if release == nil {
		t.Fatal("processTV returned nil, want a mapped release")
	}

	// Las tres calificaciones externas deben haber llegado a la ficha de la SERIE.
	if got := release.GetRatings().GetImdb(); got != "9.2" {
		t.Errorf("Ratings.Imdb = %q, want %q: the series was not enriched with OMDb", got, "9.2")
	}
	if got := release.GetRatings().GetRottenTomatoes(); got != "89%" {
		t.Errorf("Ratings.RottenTomatoes = %q, want %q", got, "89%")
	}
	if got := release.GetRatings().GetMetacritic(); got != "86/100" {
		t.Errorf("Ratings.Metacritic = %q, want %q", got, "86/100")
	}
}

// TestProcessTVWithoutOMDbKeyLeavesRatingsEmpty comprueba que sin clave de OMDb no se rompe nada.
// En español: es el estado real del proyecto hoy (la clave está vacía). El enriquecimiento debe saltarse
// en silencio y la serie debe generarse igual de válida, solo que sin las tres notas externas. Un
// catálogo sin esas notas es correcto; un generador que falla por no tenerlas, no.
func TestProcessTVWithoutOMDbKeyLeavesRatingsEmpty(t *testing.T) {
	t.Parallel()

	fakeTMDB := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(request.URL.Path, "/images") {
			_, _ = writer.Write([]byte(`{"backdrops":[]}`))
			return
		}
		_, _ = writer.Write([]byte(`{
			"id": 1399,
			"name": "Serie sin OMDb",
			"first_air_date": "2026-06-01",
			"vote_average": 8.1,
			"seasons": [{"season_number": 2, "air_date": "2026-06-15", "name": "Temporada 2"}],
			"external_ids": {"imdb_id": "tt0944947"}
		}`))
	}))
	defer fakeTMDB.Close()

	tmdbClient := tmdb.NewClient("fake-token", tmdb.WithBaseURL(fakeTMDB.URL))
	// Clave vacía: el cliente queda desactivado, igual que en el proyecto ahora mismo.
	omdbClient := omdb.NewClient("")
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	release := processTV(
		context.Background(), tmdbClient, omdbClient, logger,
		1399, 2026, 6, map[string]bool{},
	)
	if release == nil {
		t.Fatal("processTV returned nil, want a mapped release even without OMDb")
	}
	if release.GetRatings().GetImdb() != "" {
		t.Errorf("Ratings.Imdb = %q, want empty when OMDb is disabled", release.GetRatings().GetImdb())
	}
	// La nota de TMDB, que es la base de la rareza, debe seguir intacta: no depende de OMDb.
	if release.GetRatings().GetTmdb() != 8.1 {
		t.Errorf("Ratings.Tmdb = %v, want 8.1 (TMDB rating must survive without OMDb)", release.GetRatings().GetTmdb())
	}
}
