// Package catalog (archivo de pruebas) verifica el ADELGAZADO de una ficha a su forma de lista.
//
// En español: estas pruebas fijan por escrito las dos promesas del resumen, que son justo las dos
// que, si se rompieran, no darían ningún error y solo se notarían tarde:
//
//  1. Que los campos pesados NO salgan por el listado. Si alguien volviera a copiarlos "por comodidad",
//     la página de inicio recuperaría los megabytes que este trabajo le quitó y nadie se enteraría
//     hasta volver a medirla.
//  2. Que los tres datos DERIVADOS (nombre de la saga, quién dirige y reparto principal) se deduzcan
//     con las mismas reglas que usaba la interfaz. Si aquí se dedujeran distinto, la sección de
//     "Conexiones" enseñaría relaciones diferentes sin fallar en ningún sitio.
package catalog

import (
	"testing"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// newFullRelease fabrica una ficha COMPLETA con todos los campos pesados rellenos.
// En español: es el material de prueba; trae de todo justamente para poder comprobar que el resumen
// deja fuera lo que tiene que dejar fuera.
func newFullRelease() *catalogv1.Release {
	return &catalogv1.Release{
		Id:          "rel-full",
		Type:        catalogv1.TitleType_SERIES,
		Category:    catalogv1.Category_STREAMING,
		Title:       "Réquiem",
		Overview:    "Una sinopsis de prueba.",
		ReleaseDate: "2026-06-10",
		PosterUrl:   "https://example.test/poster.jpg",
		BackdropUrl: "https://example.test/backdrop.jpg",
		Genres:      []string{"Drama", "Época"},
		Ratings:     &catalogv1.Ratings{Tmdb: 8.6, Imdb: "8.4"},
		Availability: &catalogv1.Availability{
			Platforms: []string{"Netflix"},
			Networks:  []string{"HBO"},
		},
		OriginalLanguage: "Inglés",
		SpokenLanguages:  []string{"Inglés", "Español"},
		OverviewLanguage: "es-MX",
		Images:           []*catalogv1.Image{{Url: "https://example.test/1.jpg", Label: "Escena 01"}},
		Videos:           []*catalogv1.Video{{YoutubeKey: "abc123", Playable: true}},
		Schedule: &catalogv1.Schedule{
			Episodes: []*catalogv1.EpisodeDate{{Season: 1, Number: 1, AirDate: "2026-06-10"}},
		},
		Saga: &catalogv1.Collection{
			Name:  "Réquiem",
			Items: []*catalogv1.CollectionItem{{Title: "Réquiem: Origen", Year: "2024"}},
		},
		Cast: []*catalogv1.Credit{
			{Name: "Ana Ruiz", Role: "Margarita"},
			{Name: "Luis Pardo", Role: "Tomás"},
		},
		Crew: []*catalogv1.Credit{
			{Name: "Lucía Arenas", Role: "Director"},
			{Name: "Pedro Sosa", Role: "Producer"},
		},
	}
}

// TestSummaryOfCopiesListFields comprueba que el resumen conserva TODO lo que las listas dibujan.
func TestSummaryOfCopiesListFields(t *testing.T) {
	t.Parallel()

	release := newFullRelease()
	summary := summaryOf(release)

	if summary == nil {
		t.Fatal("summaryOf returned nil for a valid release")
	}
	if got := summary.GetId(); got != release.GetId() {
		t.Errorf("id = %q, want %q", got, release.GetId())
	}
	if got := summary.GetType(); got != release.GetType() {
		t.Errorf("type = %v, want %v", got, release.GetType())
	}
	if got := summary.GetCategory(); got != release.GetCategory() {
		t.Errorf("category = %v, want %v", got, release.GetCategory())
	}
	if got := summary.GetTitle(); got != release.GetTitle() {
		t.Errorf("title = %q, want %q", got, release.GetTitle())
	}
	if got := summary.GetOverview(); got != release.GetOverview() {
		t.Errorf("overview = %q, want %q", got, release.GetOverview())
	}
	if got := summary.GetReleaseDate(); got != release.GetReleaseDate() {
		t.Errorf("release_date = %q, want %q", got, release.GetReleaseDate())
	}
	if got := summary.GetPosterUrl(); got != release.GetPosterUrl() {
		t.Errorf("poster_url = %q, want %q", got, release.GetPosterUrl())
	}
	if got := summary.GetBackdropUrl(); got != release.GetBackdropUrl() {
		t.Errorf("backdrop_url = %q, want %q", got, release.GetBackdropUrl())
	}
	if got := len(summary.GetGenres()); got != len(release.GetGenres()) {
		t.Errorf("genres length = %d, want %d", got, len(release.GetGenres()))
	}
	if got := summary.GetRatings().GetTmdb(); got != release.GetRatings().GetTmdb() {
		t.Errorf("ratings.tmdb = %v, want %v", got, release.GetRatings().GetTmdb())
	}
	if got := summary.GetAvailability().GetPlatforms(); len(got) != 1 || got[0] != "Netflix" {
		t.Errorf("availability.platforms = %v, want [Netflix]", got)
	}
}

// TestSummaryOfDropsHeavyFields comprueba que lo pesado NO viaja en el resumen.
//
// En español: esta es la prueba que protege el trabajo entero. El resumen ni siquiera TIENE dónde
// guardar el reparto, la galería o el calendario —el contrato no los declara—, así que lo que se
// verifica aquí es lo único que sí se puede colar: que de la saga solo salga el nombre y que la
// ficha original siga intacta después de resumirla (resumir no debe vaciar el catálogo en memoria).
func TestSummaryOfDropsHeavyFields(t *testing.T) {
	t.Parallel()

	release := newFullRelease()
	summary := summaryOf(release)

	if got := summary.GetSagaName(); got != "Réquiem" {
		t.Errorf("saga_name = %q, want %q", got, "Réquiem")
	}

	// La ficha de origen no se toca: el catálogo vive en memoria y lo comparten todas las peticiones.
	if len(release.GetCast()) != 2 {
		t.Errorf("summaryOf modified the source release cast: got %d credits, want 2", len(release.GetCast()))
	}
	if len(release.GetImages()) != 1 {
		t.Errorf("summaryOf modified the source release images: got %d, want 1", len(release.GetImages()))
	}
	if release.GetSaga() == nil || len(release.GetSaga().GetItems()) != 1 {
		t.Error("summaryOf modified the source release saga")
	}
}

// TestSummaryOfDerivesNames comprueba las reglas de deducción de dirección y reparto principal.
func TestSummaryOfDerivesNames(t *testing.T) {
	t.Parallel()

	summary := summaryOf(newFullRelease())

	directors := summary.GetDirectorNames()
	if len(directors) != 1 || directors[0] != "Lucía Arenas" {
		t.Errorf("director_names = %v, want [Lucía Arenas] (el productor no dirige)", directors)
	}

	leadCast := summary.GetLeadCastNames()
	if len(leadCast) != 2 || leadCast[0] != "Ana Ruiz" || leadCast[1] != "Luis Pardo" {
		t.Errorf("lead_cast_names = %v, want [Ana Ruiz Luis Pardo]", leadCast)
	}
}

// TestSummaryOfNormalizesNames comprueba los casos raros de los nombres: espacios, vacíos, repetidos,
// puesto escrito en otro idioma y un reparto más largo que el límite.
func TestSummaryOfNormalizesNames(t *testing.T) {
	t.Parallel()

	// Fabricamos un reparto de doce personas para comprobar que solo entran las diez primeras.
	longCast := make([]*catalogv1.Credit, 0, 12)
	longCast = append(
		longCast,
		&catalogv1.Credit{Name: "  Ana Ruiz  "}, // con espacios de sobra: se recortan.
		&catalogv1.Credit{Name: ""},             // sin nombre: no conecta con nada, se descarta.
		&catalogv1.Credit{Name: "Ana Ruiz"},     // repetida: no se cuenta dos veces.
	)
	for _, name := range []string{"P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12"} {
		longCast = append(longCast, &catalogv1.Credit{Name: name})
	}

	release := &catalogv1.Release{
		Id:   "rel-names",
		Cast: longCast,
		Crew: []*catalogv1.Credit{
			{Name: "Lucía Arenas", Role: "  DIRECTOR "},          // mayúsculas y espacios: se reconoce igual.
			{Name: "Marta Gil", Role: "Series Director"},         // la forma de las series.
			{Name: "Iván Paz", Role: "Dirección"},                // la forma en español.
			{Name: "Lucía Arenas", Role: "director"},             // repetida con otra grafía del puesto.
			{Name: "Sara Lima", Role: "Director of Photography"}, // NO es dirección.
		},
	}

	summary := summaryOf(release)

	wantDirectors := []string{"Lucía Arenas", "Marta Gil", "Iván Paz"}
	gotDirectors := summary.GetDirectorNames()
	if len(gotDirectors) != len(wantDirectors) {
		t.Fatalf("director_names = %v, want %v", gotDirectors, wantDirectors)
	}
	for index, want := range wantDirectors {
		if gotDirectors[index] != want {
			t.Errorf("director_names[%d] = %q, want %q", index, gotDirectors[index], want)
		}
	}

	// De los doce créditos solo se miran los diez primeros; de esos, uno va vacío y otro repetido.
	gotLeadCast := summary.GetLeadCastNames()
	wantLeadCast := []string{"Ana Ruiz", "P4", "P5", "P6", "P7", "P8", "P9", "P10"}
	if len(gotLeadCast) != len(wantLeadCast) {
		t.Fatalf("lead_cast_names = %v, want %v", gotLeadCast, wantLeadCast)
	}
	for index, want := range wantLeadCast {
		if gotLeadCast[index] != want {
			t.Errorf("lead_cast_names[%d] = %q, want %q", index, gotLeadCast[index], want)
		}
	}
}

// TestSummaryOfWithoutSaga comprueba que un estreno sin saga da un nombre de saga vacío, no un fallo.
func TestSummaryOfWithoutSaga(t *testing.T) {
	t.Parallel()

	summary := summaryOf(&catalogv1.Release{Id: "rel-sin-saga", Title: "Suelta"})

	if got := summary.GetSagaName(); got != "" {
		t.Errorf("saga_name = %q, want vacío", got)
	}
	if got := len(summary.GetDirectorNames()); got != 0 {
		t.Errorf("director_names length = %d, want 0", got)
	}
	if got := len(summary.GetLeadCastNames()); got != 0 {
		t.Errorf("lead_cast_names length = %d, want 0", got)
	}
}

// TestSummaryCarriesTheOverviewLanguage fija que la etiqueta del idioma viaja en el resumen.
//
// En español: la vista previa que se abre al pulsar un día pinta la sinopsis desde el resumen, no
// desde la ficha completa. Sin esta etiqueta no tenía forma de avisar de que el texto no está en
// español, y le pasa a 112 de los 422 estrenos del catálogo (64 en inglés, 47 en español de España y
// 1 sin sinopsis). Enseñar un texto en otro idioma callándolo hace parecer que el producto está a
// medio traducir.
func TestSummaryCarriesTheOverviewLanguage(t *testing.T) {
	t.Parallel()

	release := newFullRelease()
	release.OverviewLanguage = "en-US"

	summary := summaryOf(release)

	if summary.GetOverviewLanguage() != "en-US" {
		t.Errorf("summary.overviewLanguage = %q, want %q", summary.GetOverviewLanguage(), "en-US")
	}
}

// TestDirectorNamesNeedBothTheRoleAndTheDepartment fija la regla combinada de dirección.
//
// LO QUE MIDE, en español: el área de TMDB ("Directing") agrupa a TODO el departamento de dirección,
// no a quien firma la obra. Contado sobre el catálogo vigente, de 540 créditos con esa área solo 471
// son dirección de verdad; los otros 69 (el 12,8 %) son asistentes de dirección, supervisión de guion
// o dirección de segunda unidad. Por eso el puesto es quien decide y el área actúa de filtro: un
// "Casting Director", que TMDB clasifica en Producción, no puede colarse como director.
//
// El área VACÍA se acepta a propósito: es un dato que se empezó a guardar tarde, y los respaldos y
// la curaduría antiguos traen el puesto pero no el área. Exigirla dejaría esos catálogos sin ningún
// director reconocido y la conexión "mismo director" desaparecería sin que nada fallara.
func TestDirectorNamesNeedBothTheRoleAndTheDepartment(t *testing.T) {
	t.Parallel()

	release := &catalogv1.Release{
		Id:    "rel-dir",
		Title: "Prueba de dirección",
		Crew: []*catalogv1.Credit{
			{Name: "Quien dirige", Role: "Director", Department: "Directing"},
			{Name: "Quien dirige la serie", Role: "Series Director", Department: "Directing"},
			{Name: "Sin area anotada", Role: "Director", Department: ""},
			{Name: "Asistente de direccion", Role: "Assistant Director", Department: "Directing"},
			{Name: "Supervisora de guion", Role: "Script Supervisor", Department: "Directing"},
			{Name: "Segunda unidad", Role: "Second Unit Director", Department: "Directing"},
			{Name: "Reparto de actores", Role: "Director", Department: "Production"},
			{Name: "Quien produce", Role: "Producer", Department: "Production"},
		},
	}

	names := directorNamesOf(release)

	want := []string{"Quien dirige", "Quien dirige la serie", "Sin area anotada"}
	if len(names) != len(want) {
		t.Fatalf("directorNamesOf returned %v, want %v", names, want)
	}
	for index, wantName := range want {
		if names[index] != wantName {
			t.Errorf("names[%d] = %q, want %q", index, names[index], wantName)
		}
	}
}
