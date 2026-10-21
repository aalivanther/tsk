// Archivo: curated.go — CURADURÍA verificada contra TMDB para el seedgen.
//
// En español: el descubrimiento automático (discover) solo trae lo que TMDB ya tiene FECHADO en MX. El
// futuro (jun/jul) y la emisión por CADENA quedan escasos. Esta curaduría cierra ese hueco SIN inventar:
// el operador escribe una lista de títulos (resultado de investigación web de calendarios MX) en un
// archivo JSON; aquí RESOLVEMOS cada uno contra TMDB (por id o por búsqueda) y traemos sus DATOS REALES
// (sinopsis, póster, reparto, saga, galería). Solo se permiten OVERRIDES de los campos que TMDB no puede
// saber del futuro mexicano: la fecha de estreno en MX, la categoría (CINE/STREAMING/CADENAS/INDIE) y el
// "dónde verlo" (plataformas/cadenas). Si un título NO existe en TMDB, se OMITE con un aviso: nunca se
// fabrica un estreno sin respaldo real.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
	"mdm7mo/internal/providers/omdb"
	"mdm7mo/internal/providers/tmdb"
)

// CuratedFile es el contenedor del archivo de curaduría: { "curated": [ ... ] }.
type CuratedFile struct {
	// Curated es la lista de entradas curadas a resolver y enriquecer contra TMDB.
	Curated []CuratedEntry `json:"curated"`
}

// CuratedEntry es UN título curado: cómo encontrarlo en TMDB y qué overrides aplicar.
// En español: "query" o "tmdbId" identifican el título; "kind" dice si es película o serie; los demás
// campos SOBREESCRIBEN lo que TMDB no sabe del estreno mexicano futuro (categoría, fecha, dónde verlo).
type CuratedEntry struct {
	// Query es el título a buscar en TMDB (si no se da TmdbID). Ej. "Stranger Things".
	Query string `json:"query"`
	// TmdbID es el id directo de TMDB (opcional; si está, no se busca por nombre).
	TmdbID int `json:"tmdbId"`
	// Kind es "movie" o "tv".
	Kind string `json:"kind"`
	// Category es la categoría a forzar: "CINE" | "STREAMING" | "CADENAS" | "INDIE" (opcional).
	Category string `json:"category"`
	// ReleaseDate es la fecha de estreno REAL en MX (AAAA-MM-DD) de la investigación (override; el futuro
	// no está fechado en TMDB). Para series de regreso, es la fecha de estreno de la NUEVA temporada.
	ReleaseDate string `json:"releaseDate"`
	// Platforms es el "dónde verlo" en MX (plataformas de streaming), override opcional.
	Platforms []string `json:"platforms"`
	// Networks son las cadenas/redes que la emiten (para CADENAS), override opcional.
	Networks []string `json:"networks"`
	// Title es un override opcional del título mostrado (ej. para precisar "— T5"); vacío = el de TMDB.
	Title string `json:"title"`
}

// loadCurated lee y deserializa el archivo de curaduría. Devuelve la lista de entradas.
func loadCurated(path string) ([]CuratedEntry, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read curated file %q: %w", path, err)
	}
	file := &CuratedFile{}
	if err := json.Unmarshal(bytes, file); err != nil {
		return nil, fmt.Errorf("failed to parse curated file %q: %w", path, err)
	}
	return file.Curated, nil
}

// parseCuratedCategory traduce el texto de categoría de la curaduría al enum del modelo.
// En español: "CADENAS" mapea a TV (la categoría de emisión por cadena). Devuelve UNSPECIFIED si el
// texto no se reconoce, para que el llamador NO aplique override (conserva la categoría que dio el mapper).
func parseCuratedCategory(raw string) catalogv1.Category {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "CINE":
		return catalogv1.Category_CINE
	case "STREAMING":
		return catalogv1.Category_STREAMING
	case "CADENAS", "TV":
		return catalogv1.Category_TV
	case "INDIE":
		return catalogv1.Category_INDIE
	default:
		return catalogv1.Category_CATEGORY_UNSPECIFIED
	}
}

// resolveCuratedID resuelve el id de TMDB de una entrada: directo si trae TmdbID, o por búsqueda.
// En español: si hay TmdbID lo usamos tal cual. Si no, buscamos por nombre y preferimos el resultado con
// fecha de 2026 (el estreno relevante); si ninguno es de 2026, tomamos el primero (más popular). Devuelve
// false si la búsqueda no arroja NINGÚN resultado (entonces el título se omite: no se inventa).
func resolveCuratedID(ctx context.Context, client *tmdb.Client, logger *slog.Logger, entry CuratedEntry) (int, bool) {
	if entry.TmdbID > 0 {
		return entry.TmdbID, true
	}
	results, err := client.Search(ctx, entry.Kind, entry.Query)
	if err != nil {
		logger.Warn("curated: search failed", slog.String("query", entry.Query), slog.String("error", err.Error()))
		return 0, false
	}
	if len(results) == 0 {
		logger.Warn("curated: no TMDB match, skipping", slog.String("query", entry.Query))
		return 0, false
	}
	// Preferimos un resultado cuya fecha (release o first_air) sea de 2026.
	for _, result := range results {
		date := result.ReleaseDate
		if date == "" {
			date = result.FirstAirDate
		}
		if strings.HasPrefix(date, "2026") {
			return result.ID, true
		}
	}
	// Si ninguno es de 2026 (típico de series de regreso: su first_air_date es viejo), tomamos el primero.
	return results[0].ID, true
}

// applyCuratedOverrides aplica los overrides de la entrada al Release ya mapeado de TMDB.
// En español: solo toca lo que la investigación corrige sobre TMDB: título (si se forzó), categoría,
// fecha de MX y "dónde verlo". El resto (sinopsis, póster, reparto, saga, galería) se conserva real de TMDB.
func applyCuratedOverrides(release *catalogv1.Release, entry CuratedEntry) {
	if entry.Title != "" {
		release.Title = entry.Title
	}
	if category := parseCuratedCategory(entry.Category); category != catalogv1.Category_CATEGORY_UNSPECIFIED {
		release.Category = category
	}
	if entry.ReleaseDate != "" {
		release.ReleaseDate = entry.ReleaseDate
	}
	if release.Availability == nil {
		release.Availability = &catalogv1.Availability{}
	}
	if len(entry.Platforms) > 0 {
		release.Availability.Platforms = entry.Platforms
	}
	if len(entry.Networks) > 0 {
		release.Availability.Networks = entry.Networks
	}
}

// processCurated resuelve y enriquece cada entrada curada, devolviendo los Release listos para añadir.
// En español: por cada entrada baja el detalle REAL de TMDB (película o serie), lo mapea, le aplica los
// overrides de la investigación (categoría/fecha/dónde-verlo) y le añade saga y galería. Deduplica contra
// los ids ya vistos (seen) para no repetir un título que el discover ya trajo. Un fallo puntual se registra
// y se sigue (un título roto no tumba la curaduría).
func processCurated(
	ctx context.Context,
	client *tmdb.Client,
	omdbClient *omdb.Client,
	logger *slog.Logger,
	entries []CuratedEntry,
	seenReleaseIDs map[string]bool,
) []*catalogv1.Release {
	curatedReleases := make([]*catalogv1.Release, 0, len(entries))

	for _, entry := range entries {
		tmdbID, ok := resolveCuratedID(ctx, client, logger, entry)
		if !ok {
			continue
		}

		var release *catalogv1.Release
		switch entry.Kind {
		case "movie":
			details, err := client.MovieDetails(ctx, tmdbID)
			if err != nil {
				logger.Warn("curated: movie details failed", slog.Int("id", tmdbID), slog.String("error", err.Error()))
				continue
			}
			release = tmdb.MapMovieToRelease(details, client)
			enrichWithOMDb(ctx, omdbClient, logger, release, details.ImdbID)
			if details.BelongsToCollection != nil {
				if collection, collErr := client.CollectionDetails(ctx, details.BelongsToCollection.ID); collErr == nil && release.GetSaga() != nil {
					release.Saga.Items = tmdb.MapCollectionToItems(collection, client)
				}
			}
		case "tv":
			details, err := client.TVDetails(ctx, tmdbID)
			if err != nil {
				logger.Warn("curated: tv details failed", slog.Int("id", tmdbID), slog.String("error", err.Error()))
				continue
			}
			// Sin mes de referencia: la curaduría trae su propia fecha investigada a mano, que se
			// aplica más abajo; por eso aquí no se fuerza ninguna fecha de estreno de temporada.
			release = tmdb.MapTVToRelease(details, client, "")
			// Calificaciones externas de la serie, por el identificador de IMDb que llega en
			// "external_ids". Antes esta rama no lo hacía y una serie curada quedaba sin notas externas
			// aunque OMDb estuviera configurado; ahora recibe el mismo trato que una película curada.
			enrichWithOMDb(ctx, omdbClient, logger, release, details.ExternalIDs.ImdbID)
		default:
			logger.Warn("curated: unknown kind, skipping", slog.String("kind", entry.Kind), slog.String("query", entry.Query))
			continue
		}

		// Aplicamos los overrides de la investigación (lo que TMDB no sabe del estreno mexicano futuro).
		applyCuratedOverrides(release, entry)

		// Galería real (escenas) del título.
		fillGallery(ctx, client, logger, release, entry.Kind, tmdbID)

		// Dedup: si el discover ya trajo este título (mismo id), no lo repetimos.
		if seenReleaseIDs[release.GetId()] {
			logger.Info("curated: already present from discover, skipping", slog.String("release_id", release.GetId()))
			continue
		}
		seenReleaseIDs[release.GetId()] = true

		logger.Info("curated: added",
			slog.String("title", release.GetTitle()),
			slog.String("category", release.GetCategory().String()),
			slog.String("date", release.GetReleaseDate()))
		curatedReleases = append(curatedReleases, release)
	}

	return curatedReleases
}
