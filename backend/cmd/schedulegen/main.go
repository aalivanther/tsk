// Command schedulegen completa el seed con el CALENDARIO DE EMISIÓN (Schedule) de cada serie.
// En español: este programa de línea de comandos lee el seed curado (seed/seed.json), localiza las
// SERIES (cuyo id termina en "tmdb-<número>"), consulta a TMDB las temporadas relevantes de cada una
// y escribe en cada serie su mensaje Schedule con las FECHAS REALES de emisión de sus episodios.
// Las películas no se tocan (su única fecha es release_date). El resto del seed queda intacto.
//
// Este programa hace llamadas REALES a la red: necesita la variable de entorno TMDB_READ_TOKEN. Sin
// token, no corre (no inventa datos). Reescribe el archivo del seed EN SITIO con el mismo formato
// (protojson camelCase con sangría de 2 espacios), igual que seedgen.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"google.golang.org/protobuf/encoding/protojson"

	// catalogv1 contiene los mensajes generados a partir de catalog.proto (Release, Schedule, etc.).
	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
	"mdm7mo/internal/localsettings"
	"mdm7mo/internal/providers/tmdb"
)

// defaultSeedPath es la ruta por defecto del seed a completar (el curado de producción).
// En español: a diferencia de seedgen (que protege este archivo), schedulegen SÍ lo modifica a
// propósito: su único trabajo es AÑADIR el campo schedule a las series existentes, sin tocar nada más.
const defaultSeedPath = "seed/seed.json"

// defaultWindowFrom es el inicio por defecto de la ventana de episodios a conservar (el catálogo de
// Fase 0 arranca en mayo de 2026). Episodios anteriores a esta fecha no aportan a la línea de tiempo.
const defaultWindowFrom = "2026-05-01"

// defaultRegion es la región por defecto (México), igual que en seedgen.
const defaultRegion = "MX"

// jsonIndent es la sangría usada al escribir el JSON, para que el archivo sea legible por humanos.
const jsonIndent = "  "

// outputFilePermissions son los permisos del archivo de salida (lectura/escritura del dueño, lectura del resto).
const outputFilePermissions = 0o644

// generationTimeout es el plazo máximo total para completar los calendarios de todas las series.
// En español: ~60 series con 2-3 llamadas cada una; el plazo holgado evita cuelgues infinitos de red.
const generationTimeout = 10 * time.Minute

// seasonLookbackDays es cuántos días ANTES de la ventana puede haber arrancado una temporada y aún
// interesarnos: una temporada semanal que empezó en marzo sigue emitiendo episodios dentro de la
// ventana de mayo-julio, así que hay que consultarla aunque su fecha de estreno quede fuera.
const seasonLookbackDays = 120

// isoDateLayout es el formato ISO 8601 de fecha (AAAA-MM-DD) que usan TMDB y el modelo canónico.
const isoDateLayout = "2006-01-02"

// tmdbIDPattern extrae el id numérico de TMDB del final del id propio del seed (ej. "gloria-tmdb-283657").
var tmdbIDPattern = regexp.MustCompile(`tmdb-(\d+)$`)

// main es el punto de entrada del CLI: ejecuta run() y traduce su error en un código de salida.
func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "schedulegen: %v\n", err)
		os.Exit(1)
	}
}

// run contiene la lógica completa: leer el seed, completar los calendarios y reescribir el archivo.
func run() error {
	seedPath := flag.String("seed", defaultSeedPath, "ruta del seed a completar (se reescribe en sitio)")
	windowFromRaw := flag.String("from", defaultWindowFrom, "fecha mínima (AAAA-MM-DD) de los episodios a conservar")
	region := flag.String("region", defaultRegion, "región para las consultas a TMDB (ej. \"MX\")")
	flag.Parse()

	// Sin token no corremos: este programa existe para traer datos REALES, nunca inventados.
	// El token puede venir del entorno o del archivo que guarda la página de configuración.
	readToken, err := localsettings.FirstSet("TMDB_READ_TOKEN", func(doc localsettings.Document) string {
		return doc.TMDBReadToken
	})
	if err != nil {
		return err
	}
	if readToken == "" {
		return fmt.Errorf("set TMDB_READ_TOKEN or save it from the local configuration page")
	}

	// Validamos la fecha de inicio de la ventana ANTES de tocar la red o el archivo.
	windowFrom, err := time.Parse(isoDateLayout, strings.TrimSpace(*windowFromRaw))
	if err != nil {
		return fmt.Errorf("invalid -from date %q (want AAAA-MM-DD): %w", *windowFromRaw, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), generationTimeout)
	defer cancel()

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	client := tmdb.NewClient(readToken, tmdb.WithRegion(*region))

	// Leemos el seed completo con la misma forma {"releases":[...]} que usa el backend.
	response, err := readSeedFile(*seedPath)
	if err != nil {
		return err
	}

	// Completamos el calendario de cada serie. Contamos resultados para un reporte fiel al final.
	seriesTotal := 0
	seriesWithSchedule := 0
	episodesTotal := 0
	for _, release := range response.Releases {
		if release.Type != catalogv1.TitleType_SERIES {
			continue
		}
		seriesTotal++

		schedule, err := buildScheduleForSeries(ctx, client, release, windowFrom, logger)
		if err != nil {
			// Una serie que falla NO tumba el resto: reportamos y seguimos (degradación elegante).
			// El error completo queda en el log para diagnóstico; la serie queda sin calendario.
			logger.Warn("failed to build schedule; series left without calendar",
				"id", release.Id, "error", err)
			continue
		}
		if schedule != nil && len(schedule.Episodes) > 0 {
			release.Schedule = schedule
			seriesWithSchedule++
			episodesTotal += len(schedule.Episodes)
		}
	}

	if err := writeSeedFile(*seedPath, response); err != nil {
		return err
	}

	logger.Info(
		"schedules written",
		"seed", *seedPath,
		"series_total", seriesTotal,
		"series_with_schedule", seriesWithSchedule,
		"episodes_total", episodesTotal,
	)
	return nil
}

// buildScheduleForSeries arma el Schedule de UNA serie consultando sus temporadas relevantes en TMDB.
// En español: saca el id numérico de TMDB del id propio, pide el detalle de la serie (sus temporadas),
// elige las temporadas que pueden aportar episodios dentro de la ventana (estrenadas desde
// "ventana - seasonLookbackDays" en adelante) y junta los episodios con fecha >= ventana, ordenados.
// Devuelve nil (sin error) si la serie no tiene id de TMDB reconocible o no hay episodios que aporten.
func buildScheduleForSeries(
	ctx context.Context,
	client *tmdb.Client,
	release *catalogv1.Release,
	windowFrom time.Time,
	logger *slog.Logger,
) (*catalogv1.Schedule, error) {
	tvID, ok := tmdbIDFromSeedID(release.Id)
	if !ok {
		// Sin id de TMDB no hay fuente real de fechas: la serie queda sin calendario, sin error.
		logger.Warn("series id has no tmdb suffix; skipping", "id", release.Id)
		return nil, nil
	}

	details, err := client.TVDetails(ctx, tvID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch tv details: %w", err)
	}

	// Fecha mínima de estreno de temporada que nos interesa: la ventana menos el margen de arrastre
	// (una temporada que arrancó hasta seasonLookbackDays antes puede seguir emitiendo en la ventana).
	seasonCutoff := windowFrom.AddDate(0, 0, -seasonLookbackDays)

	episodes := make([]*catalogv1.EpisodeDate, 0)
	for _, season := range details.Seasons {
		// La temporada 0 son ESPECIALES (detrás de cámaras, recaps): no forman el calendario de emisión.
		if season.SeasonNumber == 0 {
			continue
		}
		// Sin fecha de estreno de temporada no podemos saber si aporta: la saltamos sin inventar.
		seasonAir, err := time.Parse(isoDateLayout, season.AirDate)
		if err != nil {
			continue
		}
		if seasonAir.Before(seasonCutoff) {
			continue
		}

		seasonDetails, err := client.SeasonDetails(ctx, tvID, season.SeasonNumber)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch season %d: %w", season.SeasonNumber, err)
		}
		for _, episode := range seasonDetails.Episodes {
			airDate, err := time.Parse(isoDateLayout, episode.AirDate)
			if err != nil {
				// Episodio sin fecha conocida: no aporta al calendario; no inventamos fechas.
				continue
			}
			if airDate.Before(windowFrom) {
				continue
			}
			episodes = append(episodes, &catalogv1.EpisodeDate{
				Season:  int32(episode.SeasonNumber),
				Number:  int32(episode.EpisodeNumber),
				AirDate: episode.AirDate,
				Name:    episode.Name,
			})
		}
	}

	if len(episodes) == 0 {
		return nil, nil
	}

	// Orden estable por fecha y, a igualdad, por temporada y número: el frontend los recibe listos.
	sort.Slice(episodes, func(left, right int) bool {
		if episodes[left].AirDate != episodes[right].AirDate {
			return episodes[left].AirDate < episodes[right].AirDate
		}
		if episodes[left].Season != episodes[right].Season {
			return episodes[left].Season < episodes[right].Season
		}
		return episodes[left].Number < episodes[right].Number
	})

	return &catalogv1.Schedule{Episodes: episodes}, nil
}

// tmdbIDFromSeedID extrae el id numérico de TMDB del id propio del seed (sufijo "tmdb-<número>").
func tmdbIDFromSeedID(seedID string) (int, bool) {
	matches := tmdbIDPattern.FindStringSubmatch(seedID)
	if matches == nil {
		return 0, false
	}
	id, err := strconv.Atoi(matches[1])
	if err != nil {
		return 0, false
	}
	return id, true
}

// readSeedFile lee el seed con la forma {"releases":[...]} usando protojson (la misma del backend).
// En español: el molde es ListReleaseDetailsResponse porque el archivo del catálogo lleva las fichas
// COMPLETAS; el mensaje del listado dejó de llevarlas al pasar a devolver resúmenes.
func readSeedFile(path string) (*catalogv1.ListReleaseDetailsResponse, error) {
	rawBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read seed file %q: %w", path, err)
	}
	response := &catalogv1.ListReleaseDetailsResponse{}
	if err := protojson.Unmarshal(rawBytes, response); err != nil {
		return nil, fmt.Errorf("failed to parse seed file %q: %w", path, err)
	}
	return response, nil
}

// writeSeedFile reescribe el seed con el MISMO formato que seedgen (camelCase + sangría legible).
func writeSeedFile(path string, response *catalogv1.ListReleaseDetailsResponse) error {
	marshalOptions := protojson.MarshalOptions{
		UseProtoNames: false,
		Indent:        jsonIndent,
	}
	jsonBytes, err := marshalOptions.Marshal(response)
	if err != nil {
		return fmt.Errorf("failed to marshal seed to JSON: %w", err)
	}
	if err := os.WriteFile(path, jsonBytes, outputFilePermissions); err != nil {
		return fmt.Errorf("failed to write seed file %q: %w", path, err)
	}
	return nil
}
