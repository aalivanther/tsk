// Archivo: mapper_test.go — Pruebas de la traducción de TMDB al modelo canónico Release.
// En español: esta prueba arma a mano un MovieDetails de mentira (un "fixture") y comprueba que
// MapMovieToRelease lo convierte en un Release con todos los campos correctos: título, fecha, póster
// no vacío, la LISTA DE VIDEOS con todas sus etiquetas (idioma, región, doblaje, año), el reparto
// mapeado, la calificación de TMDB y las plataformas sacadas de los proveedores de MX. No toca la red.

package tmdb

import (
	"fmt"
	"strings"
	"testing"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// TestMapMovieToRelease verifica el mapeo completo de una película de TMDB a Release.
// En español: el fixture incluye trampas a propósito (un teaser y un tráiler no oficial antes del
// tráiler oficial) para confirmar que el orden de calidad pone el oficial delante SIN tirar los
// demás: la elección de cuál se enseña ya no se hace aquí, sino en la aplicación, que es la única que
// sabe qué idioma prefiere la persona. Además comprueba los demás campos clave del Release.
func TestMapMovieToRelease(t *testing.T) {
	t.Parallel()

	// Construimos el detalle de mentira directamente con los structs de types.go.
	details := &MovieDetails{
		ID:               862,
		Title:            "Toy Story",
		Overview:         "Los juguetes cobran vida.",
		ReleaseDate:      "2026-06-12",
		PosterPath:       "/poster.jpg",
		BackdropPath:     "/backdrop.jpg",
		OriginalLanguage: "en",
		VoteAverage:      8.3,
		Genres: []Genre{
			{Name: "Animación"},
			{Name: "Comedia"},
		},
		BelongsToCollection: &BelongsToCollection{
			ID:   10,
			Name: "Colección Toy Story",
		},
		SpokenLanguages: []SpokenLanguage{
			{EnglishName: "English"},
			{EnglishName: "Spanish"},
		},
		Videos: Videos{Results: []Video{
			// Un teaser oficial en inglés: se conserva, porque la cadena de elección lo usa cuando no
			// hay tráiler en el idioma pedido.
			{Key: "teaserKEY", Site: "YouTube", Type: "Teaser", Official: true, LanguageCode: "en", RegionCode: "US"},
			// Un tráiler NO oficial: se conserva, pero queda por detrás del oficial en el orden.
			{Key: "unofficialKEY", Site: "YouTube", Type: "Trailer", Official: false, LanguageCode: "en", RegionCode: "US"},
			// El tráiler OFICIAL: debe quedar el primero de la lista tras ordenar por calidad.
			{Key: "officialTrailerKEY", Site: "YouTube", Type: "Trailer", Official: true, LanguageCode: "en", RegionCode: "US"},
		}},
		Credits: Credits{
			Cast: []CastMember{
				{ID: 31, Name: "Tom Hanks", Character: "Woody", ProfilePath: "/th.jpg", KnownForDepartment: "Acting", Order: 0},
				{ID: 12898, Name: "Tim Allen", Character: "Buzz", ProfilePath: "/ta.jpg", KnownForDepartment: "Acting", Order: 1},
			},
			Crew: []CrewMember{
				{ID: 7879, Name: "John Lasseter", Job: "Director", Department: "Directing", ProfilePath: "/jl.jpg"},
			},
		},
		WatchProviders: WatchProviders{Results: WatchProvidersResults{MX: &WatchProvidersCountry{
			Link:     "https://www.justwatch.com/mx",
			Flatrate: []WatchProvider{{ProviderName: "Disney Plus"}},
			Rent:     []WatchProvider{{ProviderName: "Apple TV"}},
		}}},
	}

	// El mapper necesita un Client solo para construir URLs de imagen (no hace red aquí).
	client := NewClient("unused-token-for-mapping")

	release := MapMovieToRelease(details, client)

	// Tipo: debe ser película.
	if release.GetType() != catalogv1.TitleType_MOVIE {
		t.Errorf("Type = %v, want MOVIE", release.GetType())
	}

	// Título y fecha.
	if release.GetTitle() != "Toy Story" {
		t.Errorf("Title = %q, want %q", release.GetTitle(), "Toy Story")
	}
	if release.GetReleaseDate() != "2026-06-12" {
		t.Errorf("ReleaseDate = %q, want %q", release.GetReleaseDate(), "2026-06-12")
	}

	// id: slug del título + sufijo con el id de TMDB.
	if release.GetId() != "toy-story-tmdb-862" {
		t.Errorf("Id = %q, want %q", release.GetId(), "toy-story-tmdb-862")
	}

	// Póster: no debe estar vacío y debe terminar con la ruta del póster.
	if release.GetPosterUrl() == "" {
		t.Error("PosterUrl is empty, want a non-empty image URL")
	}
	if !strings.HasSuffix(release.GetPosterUrl(), "/poster.jpg") {
		t.Errorf("PosterUrl = %q, want it to end with %q", release.GetPosterUrl(), "/poster.jpg")
	}

	// Videos: se conservan los TRES de YouTube (ya no se elige uno solo aquí), y el oficial queda
	// delante porque el orden de calidad pone la oficialidad por encima de todo lo demás.
	if len(release.GetVideos()) != 3 {
		t.Fatalf("Videos has %d entries, want 3", len(release.GetVideos()))
	}
	if release.GetVideos()[0].GetYoutubeKey() != "officialTrailerKEY" {
		t.Errorf("Videos[0].YoutubeKey = %q, want %q", release.GetVideos()[0].GetYoutubeKey(), "officialTrailerKEY")
	}
	// Ninguno viene verificado desde el mapper: eso lo hace seedgen consultando oEmbed.
	if release.GetVideos()[0].GetPlayable() {
		t.Error("Videos[0].Playable = true, want false: the mapper must not claim an unverified video plays")
	}

	// Géneros: nombres en el mismo orden.
	wantGenres := []string{"Animación", "Comedia"}
	if len(release.GetGenres()) != len(wantGenres) {
		t.Fatalf("Genres = %v, want %v", release.GetGenres(), wantGenres)
	}
	for index, wantGenre := range wantGenres {
		if release.GetGenres()[index] != wantGenre {
			t.Errorf("Genres[%d] = %q, want %q", index, release.GetGenres()[index], wantGenre)
		}
	}

	// Reparto mapeado: nombre y personaje como "role".
	if len(release.GetCast()) != 2 {
		t.Fatalf("Cast has %d members, want 2", len(release.GetCast()))
	}
	if release.GetCast()[0].GetName() != "Tom Hanks" || release.GetCast()[0].GetRole() != "Woody" {
		t.Errorf("Cast[0] = {name=%q, role=%q}, want {Tom Hanks, Woody}",
			release.GetCast()[0].GetName(), release.GetCast()[0].GetRole())
	}
	// El número de identidad de la persona se GUARDA: es lo que permite reconocer al mismo actor en dos
	// títulos sin comparar nombres escritos. Antes se tiraba siempre.
	if release.GetCast()[0].GetPersonTmdbId() != 31 {
		t.Errorf("Cast[0].PersonTmdbId = %d, want 31", release.GetCast()[0].GetPersonTmdbId())
	}
	if release.GetCast()[0].GetDepartment() != "Acting" {
		t.Errorf("Cast[0].Department = %q, want %q", release.GetCast()[0].GetDepartment(), "Acting")
	}

	// Equipo: el director mapeado con su función como "role".
	if len(release.GetCrew()) != 1 || release.GetCrew()[0].GetRole() != "Director" {
		t.Errorf("Crew = %+v, want one member with role %q", release.GetCrew(), "Director")
	}
	// LA FOTO DEL EQUIPO: TMDB la entrega y hasta ahora se descartaba al leer (0 de 3.429 personas del
	// catálogo tenían cara). Esta comprobación existe para que no vuelva a perderse en silencio.
	if !strings.HasSuffix(release.GetCrew()[0].GetPhotoUrl(), "/jl.jpg") {
		t.Errorf("Crew[0].PhotoUrl = %q, want it to end with %q", release.GetCrew()[0].GetPhotoUrl(), "/jl.jpg")
	}
	if release.GetCrew()[0].GetPersonTmdbId() != 7879 {
		t.Errorf("Crew[0].PersonTmdbId = %d, want 7879", release.GetCrew()[0].GetPersonTmdbId())
	}
	if release.GetCrew()[0].GetDepartment() != "Directing" {
		t.Errorf("Crew[0].Department = %q, want %q", release.GetCrew()[0].GetDepartment(), "Directing")
	}

	// Sinopsis: vino en la petición principal (español de México), así que se marca con ese idioma y NO
	// hace falta ningún aviso en la interfaz.
	if release.GetOverview() != "Los juguetes cobran vida." {
		t.Errorf("Overview = %q, want the es-MX text", release.GetOverview())
	}
	if release.GetOverviewLanguage() != defaultLanguage {
		t.Errorf("OverviewLanguage = %q, want %q", release.GetOverviewLanguage(), defaultLanguage)
	}

	// Calificación de TMDB: base de la rareza.
	if release.GetRatings().GetTmdb() != 8.3 {
		t.Errorf("Ratings.Tmdb = %v, want %v", release.GetRatings().GetTmdb(), 8.3)
	}

	// Disponibilidad: plataformas sacadas del flatrate de MX.
	platforms := release.GetAvailability().GetPlatforms()
	if len(platforms) != 1 || platforms[0] != "Disney Plus" {
		t.Errorf("Availability.Platforms = %v, want [Disney Plus]", platforms)
	}

	// Saga: nombre presente; los items se llenan en seedgen, así que aquí deben venir vacíos.
	if release.GetSaga() == nil || release.GetSaga().GetName() != "Colección Toy Story" {
		t.Errorf("Saga = %+v, want name %q", release.GetSaga(), "Colección Toy Story")
	}
	if len(release.GetSaga().GetItems()) != 0 {
		t.Errorf("Saga.Items = %v, want empty (filled later in seedgen)", release.GetSaga().GetItems())
	}
}

// TestMapTVToRelease verifica el mapeo de una serie de TMDB a Release.
// En español: comprueba que para series se usan las claves propias (name, first_air_date), que el
// reparto sale de aggregate_credits cuando existe (créditos acumulados de temporadas) y que las
// series NO llevan saga (TMDB no la expone para TV). El fixture pone flatrate en MX, así que la
// categoría esperada es STREAMING.
func TestMapTVToRelease(t *testing.T) {
	t.Parallel()

	details := &TVDetails{
		ID:               1399,
		Name:             "La Casa del Dragón",
		Overview:         "Intrigas en Poniente.",
		FirstAirDate:     "2026-06-01",
		PosterPath:       "/tvposter.jpg",
		BackdropPath:     "/tvbackdrop.jpg",
		OriginalLanguage: "en",
		VoteAverage:      8.5,
		Genres: []Genre{
			{Name: "Drama"},
			{Name: "Fantasía"},
		},
		SpokenLanguages: []SpokenLanguage{
			{EnglishName: "English"},
		},
		Videos: Videos{Results: []Video{
			{Key: "tvTrailerKEY", Site: "YouTube", Type: "Trailer", Official: true},
		}},
		// Credits simple con un actor "de relleno": NO debe usarse porque hay aggregate_credits.
		Credits: Credits{
			Cast: []CastMember{
				{Name: "Relleno", Character: "Extra", Order: 0},
			},
		},
		// AggregateCredits es la fuente preferida para series: debe ganar sobre Credits.
		AggregateCredits: Credits{
			// FORMA REAL DE UNA SERIE: en aggregate_credits el personaje NO viene en "Character" sino
			// dentro de la lista "Roles", y el oficio no viene en "Job" sino dentro de "Jobs". El fixture
			// antiguo usaba la forma de las PELÍCULAS, así que la prueba pasaba mientras el catálogo real
			// se quedaba sin un solo personaje en las 234 series. Aquí se reproduce la forma auténtica,
			// comprobada contra la API el 2026-07-29, con dos papeles para forzar el desempate por
			// episodios: debe ganar "Daemon Targaryen" (73 episodios), no "Joven Daemon" (2).
			Cast: []CastMember{
				{
					ID:                 136532,
					Name:               "Matt Smith",
					ProfilePath:        "/ms.jpg",
					KnownForDepartment: "Acting",
					Order:              0,
					TotalEpisodeCount:  75,
					Roles: []AggregateRole{
						{Character: "Joven Daemon", EpisodeCount: 2},
						{Character: "Daemon Targaryen", EpisodeCount: 73},
					},
				},
			},
			Crew: []CrewMember{
				{
					ID:                1223867,
					Name:              "Ryan Condal",
					Department:        "Writing",
					ProfilePath:       "/rc.jpg",
					TotalEpisodeCount: 20,
					Jobs: []AggregateJob{
						{Job: "Executive Producer", EpisodeCount: 8},
						{Job: "Creator", EpisodeCount: 20},
					},
				},
			},
		},
		WatchProviders: WatchProviders{Results: WatchProvidersResults{MX: &WatchProvidersCountry{
			Flatrate: []WatchProvider{{ProviderName: "Max"}},
		}}},
	}

	client := NewClient("unused-token-for-mapping")

	// Sin fecha forzada: el mapeo debe caer a la fecha del primer episodio de la serie.
	release := MapTVToRelease(details, client, "")

	// Tipo: debe ser serie.
	if release.GetType() != catalogv1.TitleType_SERIES {
		t.Errorf("Type = %v, want SERIES", release.GetType())
	}

	// Título y fecha vienen de las claves propias de TV (name, first_air_date).
	if release.GetTitle() != "La Casa del Dragón" {
		t.Errorf("Title = %q, want %q", release.GetTitle(), "La Casa del Dragón")
	}
	if release.GetReleaseDate() != "2026-06-01" {
		t.Errorf("ReleaseDate = %q, want %q", release.GetReleaseDate(), "2026-06-01")
	}

	// Categoría: hay flatrate en MX, así que es STREAMING.
	if release.GetCategory() != catalogv1.Category_STREAMING {
		t.Errorf("Category = %v, want STREAMING (flatrate present)", release.GetCategory())
	}

	// Reparto: debe venir de aggregate_credits (Matt Smith), no del Credits de relleno.
	if len(release.GetCast()) != 1 || release.GetCast()[0].GetName() != "Matt Smith" {
		t.Fatalf("Cast = %+v, want single member from aggregate_credits (Matt Smith)", release.GetCast())
	}

	// EL PERSONAJE DE UNA SERIE: sale de la lista "roles" y gana el de más episodios. Este es el defecto
	// que dejaba el papel vacío en el 100 % de los actores de serie del catálogo.
	if release.GetCast()[0].GetRole() != "Daemon Targaryen" {
		t.Errorf("Cast[0].Role = %q, want %q (the role with most episodes)",
			release.GetCast()[0].GetRole(), "Daemon Targaryen")
	}
	if release.GetCast()[0].GetEpisodeCount() != 75 {
		t.Errorf("Cast[0].EpisodeCount = %d, want 75", release.GetCast()[0].GetEpisodeCount())
	}
	if release.GetCast()[0].GetPersonTmdbId() != 136532 {
		t.Errorf("Cast[0].PersonTmdbId = %d, want 136532", release.GetCast()[0].GetPersonTmdbId())
	}

	// EL OFICIO DEL EQUIPO DE UNA SERIE: sale de la lista "jobs", también por número de episodios.
	if len(release.GetCrew()) != 1 {
		t.Fatalf("Crew has %d members, want 1", len(release.GetCrew()))
	}
	if release.GetCrew()[0].GetRole() != "Creator" {
		t.Errorf("Crew[0].Role = %q, want %q (the job with most episodes)",
			release.GetCrew()[0].GetRole(), "Creator")
	}
	if !strings.HasSuffix(release.GetCrew()[0].GetPhotoUrl(), "/rc.jpg") {
		t.Errorf("Crew[0].PhotoUrl = %q, want it to end with %q", release.GetCrew()[0].GetPhotoUrl(), "/rc.jpg")
	}

	// Las series no tienen saga en TMDB: el campo debe quedar nil.
	if release.GetSaga() != nil {
		t.Errorf("Saga = %+v, want nil for a series", release.GetSaga())
	}
}

// TestCategoryForTV verifica la categoría de una serie según haya o no proveedores en MX.
// En español: con flatrate en MX la serie es STREAMING; sin flatrate la asumimos emitida por cadena
// (TV). Probamos ambos caminos con dos fixtures mínimos.
func TestCategoryForTV(t *testing.T) {
	t.Parallel()

	// Con flatrate en MX -> STREAMING.
	streamingDetails := &TVDetails{
		WatchProviders: WatchProviders{Results: WatchProvidersResults{MX: &WatchProvidersCountry{
			Flatrate: []WatchProvider{{ProviderName: "Netflix"}},
		}}},
	}
	if got := categoryForTV(streamingDetails); got != catalogv1.Category_STREAMING {
		t.Errorf("categoryForTV(with flatrate) = %v, want STREAMING", got)
	}

	// Sin proveedores de MX -> TV (cadena).
	tvDetails := &TVDetails{
		WatchProviders: WatchProviders{Results: WatchProvidersResults{MX: nil}},
	}
	if got := categoryForTV(tvDetails); got != catalogv1.Category_TV {
		t.Errorf("categoryForTV(no providers) = %v, want TV", got)
	}
}

// TestCategoryForMovieWithReleaseTypes verifica la categoría según los tipos de estreno de MX.
// En español: si MX tuvo estreno THEATRICAL (tipo 3) -> CINE; si solo hubo DIGITAL (tipo 4) -> STREAMING.
// Esta es la regla fiable del punto de auditoría: la fuente de verdad son release_dates, no solo la fecha.
func TestCategoryForMovieWithReleaseTypes(t *testing.T) {
	t.Parallel()

	// Caso CINE: MX trae un estreno theatrical (tipo 3).
	theatrical := &MovieDetails{
		ReleaseDate: "2026-06-12",
		ReleaseDates: ReleaseDatesAppend{Results: []CountryReleaseDates{
			{CountryCode: "MX", Dates: []ReleaseDateEntry{{Type: releaseTypeTheatrical}}},
		}},
	}
	if got := categoryForMovie(theatrical); got != catalogv1.Category_CINE {
		t.Errorf("categoryForMovie(theatrical) = %v, want CINE", got)
	}

	// Caso STREAMING: MX solo trae un estreno digital (tipo 4), sin theatrical.
	digital := &MovieDetails{
		ReleaseDate: "2026-06-12",
		ReleaseDates: ReleaseDatesAppend{Results: []CountryReleaseDates{
			{CountryCode: "MX", Dates: []ReleaseDateEntry{{Type: releaseTypeDigital}}},
		}},
	}
	if got := categoryForMovie(digital); got != catalogv1.Category_STREAMING {
		t.Errorf("categoryForMovie(digital only) = %v, want STREAMING", got)
	}

	// Caso STREAMING por flatrate: sin tipos de MX pero con proveedores de suscripción.
	flatrateOnly := &MovieDetails{
		WatchProviders: WatchProviders{Results: WatchProvidersResults{MX: &WatchProvidersCountry{
			Flatrate: []WatchProvider{{ProviderName: "Prime Video"}},
		}}},
	}
	if got := categoryForMovie(flatrateOnly); got != catalogv1.Category_STREAMING {
		t.Errorf("categoryForMovie(flatrate only) = %v, want STREAMING", got)
	}

	// Caso FALLBACK: sin tipos de MX y sin flatrate -> CINE (conservador).
	noSignals := &MovieDetails{ReleaseDate: "2026-06-12"}
	if got := categoryForMovie(noSignals); got != catalogv1.Category_CINE {
		t.Errorf("categoryForMovie(no signals) = %v, want CINE (fallback)", got)
	}
}

// TestMapCollectionToItems verifica el mapeo de una saga a sus entradas (CollectionItem).
// En español: comprueba que cada entrada lleva título, año (extraído de la fecha ISO) y póster no
// vacío. Incluye una entrada con fecha corta/ inválida para confirmar que yearFromISODate la maneja.
func TestMapCollectionToItems(t *testing.T) {
	t.Parallel()

	collection := &Collection{
		ID:   10,
		Name: "Colección Toy Story",
		Parts: []CollectionPart{
			{Title: "Toy Story", ReleaseDate: "1995-11-22", PosterPath: "/ts1.jpg"},
			{Title: "Toy Story 2", ReleaseDate: "1999-11-24", PosterPath: "/ts2.jpg"},
			// Fecha corta/inválida: el año debe salir vacío sin romper el mapeo.
			{Title: "Sin Fecha", ReleaseDate: "99", PosterPath: "/sf.jpg"},
		},
	}

	client := NewClient("unused-token-for-mapping")

	items := MapCollectionToItems(collection, client)
	if len(items) != 3 {
		t.Fatalf("MapCollectionToItems returned %d items, want 3", len(items))
	}

	// Primera entrada: título, año y póster correctos.
	if items[0].GetTitle() != "Toy Story" || items[0].GetYear() != "1995" {
		t.Errorf("items[0] = {title=%q, year=%q}, want {Toy Story, 1995}", items[0].GetTitle(), items[0].GetYear())
	}
	if items[0].GetPosterUrl() == "" {
		t.Error("items[0].PosterUrl is empty, want a non-empty image URL")
	}

	// Entrada con fecha inválida: el año debe quedar vacío.
	if items[2].GetYear() != "" {
		t.Errorf("items[2].Year = %q, want empty (short/invalid date)", items[2].GetYear())
	}

	// Una colección nil debe producir nil (sin pánico).
	if got := MapCollectionToItems(nil, client); got != nil {
		t.Errorf("MapCollectionToItems(nil) = %v, want nil", got)
	}
}

// TestYearFromISODate verifica la extracción del año desde una fecha ISO, con casos límite.
// En español: una fecha completa da su año; una cadena demasiado corta o vacía da cadena vacía.
func TestYearFromISODate(t *testing.T) {
	t.Parallel()

	cases := []struct {
		isoDate  string
		wantYear string
	}{
		{isoDate: "2026-06-12", wantYear: "2026"},
		{isoDate: "1999", wantYear: "1999"},
		{isoDate: "99", wantYear: ""},
		{isoDate: "", wantYear: ""},
	}
	for _, testCase := range cases {
		if got := yearFromISODate(testCase.isoDate); got != testCase.wantYear {
			t.Errorf("yearFromISODate(%q) = %q, want %q", testCase.isoDate, got, testCase.wantYear)
		}
	}
}

// TestMapVideosTagsEveryVideo verifica que el mapeo conserva las etiquetas de cada video.
// En español: es la prueba del fallo que dejaba el catálogo sin tráilers mexicanos. Antes se
// guardaban cuatro datos y se tiraban el idioma y la región, así que era imposible distinguir el
// doblaje de México del de España. Aquí se comprueba que ambos sobreviven, junto con la deducción de
// "doblado"/"subtitulado" a partir del título del video y el año de publicación.
func TestMapVideosTagsEveryVideo(t *testing.T) {
	t.Parallel()

	videos := []Video{
		{
			Key: "mxDubbed", Site: "YouTube", Type: "Trailer", Official: true,
			LanguageCode: "es", RegionCode: "MX", Name: "Tráiler Oficial | Doblado",
			Size: 1080, PublishedAt: "2026-07-21T16:00:24.000Z",
		},
		{
			Key: "mxSubbed", Site: "YouTube", Type: "Trailer", Official: true,
			LanguageCode: "es", RegionCode: "MX", Name: "Nuevo Tráiler (Subtitulado)",
			Size: 1080, PublishedAt: "2026-06-02T10:00:00.000Z",
		},
		{
			Key: "esSpain", Site: "YouTube", Type: "Trailer", Official: true,
			LanguageCode: "es", RegionCode: "ES", Name: "Tráiler en español",
			Size: 720, PublishedAt: "2026-05-01T10:00:00.000Z",
		},
		// Un video que NO está en YouTube: no se puede incrustar, así que no entra.
		{Key: "vimeoKey", Site: "Vimeo", Type: "Trailer", Official: true, LanguageCode: "en"},
		// Una clase que la aplicación nunca muestra: tampoco entra (ver usableVideoKinds).
		{Key: "bloopers", Site: "YouTube", Type: "Bloopers", Official: true, LanguageCode: "en"},
	}

	mapped := MapVideos(videos)
	if len(mapped) != 3 {
		t.Fatalf("MapVideos returned %d videos, want 3 (only usable YouTube videos)", len(mapped))
	}

	byKey := make(map[string]*catalogv1.Video, len(mapped))
	for _, video := range mapped {
		byKey[video.GetYoutubeKey()] = video
	}

	mexicanDubbed, found := byKey["mxDubbed"]
	if !found {
		t.Fatal("the Mexican dubbed trailer is missing from the mapped videos")
	}
	if mexicanDubbed.GetLanguage() != "es" || mexicanDubbed.GetRegion() != "MX" {
		t.Errorf("mxDubbed language/region = %q/%q, want es/MX",
			mexicanDubbed.GetLanguage(), mexicanDubbed.GetRegion())
	}
	if mexicanDubbed.GetDubbing() != catalogv1.DubbingKind_DUBBING_KIND_DUBBED {
		t.Errorf("mxDubbed dubbing = %v, want DUBBED", mexicanDubbed.GetDubbing())
	}
	if mexicanDubbed.GetPublishedYear() != 2026 {
		t.Errorf("mxDubbed publishedYear = %d, want 2026", mexicanDubbed.GetPublishedYear())
	}
	if mexicanDubbed.GetResolution() != 1080 {
		t.Errorf("mxDubbed resolution = %d, want 1080", mexicanDubbed.GetResolution())
	}
	if mexicanDubbed.GetKind() != catalogv1.VideoKind_VIDEO_KIND_TRAILER {
		t.Errorf("mxDubbed kind = %v, want TRAILER", mexicanDubbed.GetKind())
	}

	if byKey["mxSubbed"].GetDubbing() != catalogv1.DubbingKind_DUBBING_KIND_SUBTITLED {
		t.Errorf("mxSubbed dubbing = %v, want SUBTITLED", byKey["mxSubbed"].GetDubbing())
	}
	if byKey["esSpain"].GetRegion() != "ES" {
		t.Errorf("esSpain region = %q, want ES", byKey["esSpain"].GetRegion())
	}
	// Sin marcas en el título, la deducción honesta es "audio original".
	if byKey["esSpain"].GetDubbing() != catalogv1.DubbingKind_DUBBING_KIND_ORIGINAL {
		t.Errorf("esSpain dubbing = %v, want ORIGINAL", byKey["esSpain"].GetDubbing())
	}
}

// TestMapVideosIsDeterministicAndBounded verifica que el mapeo es reproducible y no se desborda.
// En español: dos generaciones con los mismos datos tienen que producir exactamente la misma lista
// (si no, el archivo del catálogo cambia sin que nadie haya cambiado nada), y un título con decenas
// de videos del mismo tipo no puede meterlos todos: se conservan los dos mejores de cada combinación
// idioma+región+clase.
func TestMapVideosIsDeterministicAndBounded(t *testing.T) {
	t.Parallel()

	videos := make([]Video, 0, 8)
	for index := range 8 {
		videos = append(videos, Video{
			Key:          fmt.Sprintf("clip%02d", index),
			Site:         "YouTube",
			Type:         "Clip",
			Official:     true,
			LanguageCode: "en",
			RegionCode:   "US",
			Name:         "Clip",
			Size:         1080,
			PublishedAt:  "2026-01-01T00:00:00.000Z",
		})
	}

	first := MapVideos(videos)
	if len(first) != maxVideosPerBucket {
		t.Fatalf("MapVideos kept %d clips, want %d (one bucket cannot exceed its cap)",
			len(first), maxVideosPerBucket)
	}

	// Reordenamos la entrada: el resultado tiene que ser idéntico, porque el desempate final es el
	// código de YouTube en orden alfabético y no el orden en que TMDB los devolvió.
	shuffled := []Video{videos[5], videos[0], videos[7], videos[2], videos[1], videos[6], videos[3], videos[4]}
	second := MapVideos(shuffled)
	if len(second) != len(first) {
		t.Fatalf("MapVideos is not deterministic: %d videos vs %d", len(second), len(first))
	}
	for index := range first {
		if first[index].GetYoutubeKey() != second[index].GetYoutubeKey() {
			t.Errorf("MapVideos is not deterministic at %d: %q vs %q",
				index, first[index].GetYoutubeKey(), second[index].GetYoutubeKey())
		}
	}
}

// TestDetectDubbingReadsTheVideoTitle verifica la deducción de doblaje a partir del título.
// En español: es una heurística declarada, no un dato certificado, y por eso se prueba caso a caso.
// Importa porque TMDB etiqueta como es-MX tanto el doblaje latino como el tráiler en inglés con
// subtítulos en español latino: sin esta distinción, quien pide español podría acabar oyendo inglés.
func TestDetectDubbingReadsTheVideoTitle(t *testing.T) {
	t.Parallel()

	cases := []struct {
		videoTitle string
		want       catalogv1.DubbingKind
	}{
		{videoTitle: "Tráiler Oficial | Doblado", want: catalogv1.DubbingKind_DUBBING_KIND_DUBBED},
		{videoTitle: "TRAILER OFICIAL DOBLAJE LATINO", want: catalogv1.DubbingKind_DUBBING_KIND_DUBBED},
		{videoTitle: "Official Trailer (Dubbed)", want: catalogv1.DubbingKind_DUBBING_KIND_DUBBED},
		{videoTitle: "Nuevo Tráiler (Subtitulado)", want: catalogv1.DubbingKind_DUBBING_KIND_SUBTITLED},
		{videoTitle: "Official Trailer | ENG SUB", want: catalogv1.DubbingKind_DUBBING_KIND_SUBTITLED},
		{videoTitle: "Official Trailer", want: catalogv1.DubbingKind_DUBBING_KIND_ORIGINAL},
		{videoTitle: "", want: catalogv1.DubbingKind_DUBBING_KIND_UNSPECIFIED},
	}
	for _, testCase := range cases {
		if got := detectDubbing(testCase.videoTitle); got != testCase.want {
			t.Errorf("detectDubbing(%q) = %v, want %v", testCase.videoTitle, got, testCase.want)
		}
	}
}

// TestPublishedYearParsesTMDBDates verifica la extracción del año de publicación.
// En español: entre dos tráilers igual de buenos gana el más reciente, así que este año decide. Una
// fecha ausente o rota devuelve 0, que en el desempate significa "no sé cuándo" y va al final.
func TestPublishedYearParsesTMDBDates(t *testing.T) {
	t.Parallel()

	cases := []struct {
		publishedAt string
		want        int32
	}{
		{publishedAt: "2026-07-21T16:00:24.000Z", want: 2026},
		{publishedAt: "1998-01-01", want: 1998},
		{publishedAt: "no es fecha", want: 0},
		{publishedAt: "2026", want: 0},
		{publishedAt: "", want: 0},
	}
	for _, testCase := range cases {
		if got := publishedYear(testCase.publishedAt); got != testCase.want {
			t.Errorf("publishedYear(%q) = %d, want %d", testCase.publishedAt, got, testCase.want)
		}
	}
}

// TestSlugifyWithAccentsAndNonASCII verifica la transliteración de acentos y el respaldo no-latino.
// En español: "Vértigo Neón" debe transliterar acentos a ASCII -> "vertigo-neon"; un título 100%
// no-latino ("日本語") no produce ningún carácter ASCII, así que slugify devuelve el respaldo "title"
// y buildReleaseID forma un id que NO empieza con guion ("title-tmdb-N").
func TestSlugifyWithAccentsAndNonASCII(t *testing.T) {
	t.Parallel()

	// Acentos latinos: deben transliterarse, no descartarse.
	if got := slugify("Vértigo Neón"); got != "vertigo-neon" {
		t.Errorf("slugify(%q) = %q, want %q", "Vértigo Neón", got, "vertigo-neon")
	}

	// Título totalmente no-latino: slug vacío -> respaldo "title".
	if got := slugify("日本語"); got != "title" {
		t.Errorf("slugify(%q) = %q, want %q (fallback)", "日本語", got, "title")
	}

	// El id resultante de un título no-latino NO debe empezar con guion.
	gotID := buildReleaseID("日本語", 42)
	if gotID != "title-tmdb-42" {
		t.Errorf("buildReleaseID(non-latin) = %q, want %q", gotID, "title-tmdb-42")
	}
	if strings.HasPrefix(gotID, "-") {
		t.Errorf("buildReleaseID(non-latin) = %q, must not start with a hyphen", gotID)
	}
}

// TestSeasonPremiereInMonth verifica la regla que decide si una serie ESTRENA TEMPORADA en un mes.
// En español: es la pieza que evita llenar el catálogo con series a media temporada (el capítulo 15
// de algo que empezó en marzo no es una novedad). Solo cuenta el arranque de una temporada real.
func TestSeasonPremiereInMonth(t *testing.T) {
	details := &TVDetails{
		Name:         "Serie de prueba",
		FirstAirDate: "2022-09-01",
		Seasons: []TVSeason{
			{Name: "Especiales", SeasonNumber: 0, AirDate: "2026-08-10"},
			{Name: "Temporada 1", SeasonNumber: 1, AirDate: "2022-09-01"},
			{Name: "Temporada 2", SeasonNumber: 2, AirDate: "2026-08-14"},
		},
	}

	// El mes con estreno de temporada devuelve SU fecha (no la del primer episodio histórico).
	if got := SeasonPremiereInMonth(details, 2026, 8); got != "2026-08-14" {
		t.Fatalf("want 2026-08-14 for the season 2 premiere, got %q", got)
	}

	// Un mes sin estreno de temporada devuelve vacío, aunque la serie siga al aire.
	if got := SeasonPremiereInMonth(details, 2026, 9); got != "" {
		t.Fatalf("want empty for a month without a season premiere, got %q", got)
	}

	// La temporada 0 ("Especiales") NO cuenta como estreno de temporada.
	specialsOnly := &TVDetails{
		Seasons: []TVSeason{{Name: "Especiales", SeasonNumber: 0, AirDate: "2026-08-10"}},
	}
	if got := SeasonPremiereInMonth(specialsOnly, 2026, 8); got != "" {
		t.Fatalf("want empty when only the specials season airs, got %q", got)
	}

	// Un detalle nulo no debe romper: devuelve vacío.
	if got := SeasonPremiereInMonth(nil, 2026, 8); got != "" {
		t.Fatalf("want empty for nil details, got %q", got)
	}
}

// TestResolveOverviewFallbackChain verifica el PLAN B DE IDIOMA de la sinopsis, escalón por escalón.
//
// En español: el catálogo se pide en español de México y TMDB, cuando no tiene esa traducción, devuelve
// la sinopsis vacía sin buscar en ningún otro idioma. Eso dejaba 112 de 422 estrenos sin una línea de
// texto, teniéndola escrita en otro sitio. Esta prueba fija los cuatro comportamientos de la cadena de
// respaldo: el texto principal manda; si falta se busca español (el de México antes que el de España);
// si no hay español se cae al inglés; y si no hay nada, no se inventa nada. Los tres casos con datos
// reproducen títulos medidos contra la API el 2026-07-29 (Avignon estaba en español de España, Shell y
// Primavera solo en inglés).
func TestResolveOverviewFallbackChain(t *testing.T) {
	t.Parallel()

	// El conjunto de traducciones se comparte entre los casos que lo necesitan. Incluye traducciones con
	// la sinopsis VACÍA a propósito: TMDB las devuelve constantemente y no deben elegirse nunca.
	translations := []Translation{
		{LanguageCode: "fr", CountryCode: "FR", Data: TranslationData{Overview: "Synopsis en français."}},
		{LanguageCode: "es", CountryCode: "AR", Data: TranslationData{Overview: ""}},
		{LanguageCode: "es", CountryCode: "ES", Data: TranslationData{Overview: "Sinopsis de España."}},
		{LanguageCode: "es", CountryCode: "MX", Data: TranslationData{Overview: "Sinopsis de México."}},
		{LanguageCode: "en", CountryCode: "GB", Data: TranslationData{Overview: "British synopsis."}},
		{LanguageCode: "en", CountryCode: "US", Data: TranslationData{Overview: "American synopsis."}},
	}

	testCases := []struct {
		name         string
		primary      string
		translations []Translation
		wantOverview string
		wantLanguage string
	}{
		{
			// Escalón 1: si el texto llegó en la petición principal, gana siempre. Es el que se escribió
			// para este público y no hace falta mirar más.
			name:         "the primary es-MX overview wins over every translation",
			primary:      "Sinopsis principal.",
			translations: translations,
			wantOverview: "Sinopsis principal.",
			wantLanguage: defaultLanguage,
		},
		{
			// Escalón 2: sin texto principal se busca español, y entre los españoles gana el de México.
			name:         "falls back to the Mexican Spanish translation",
			primary:      "",
			translations: translations,
			wantOverview: "Sinopsis de México.",
			wantLanguage: "es-MX",
		},
		{
			// Escalón 2 (variante): sin español de México vale el de España. Se lee perfectamente aquí y
			// no necesita ningún aviso: sigue siendo español. Es el caso real de la película Avignon.
			name:    "any other Spanish is preferred over English",
			primary: "",
			translations: []Translation{
				{LanguageCode: "en", CountryCode: "US", Data: TranslationData{Overview: "American synopsis."}},
				{LanguageCode: "es", CountryCode: "ES", Data: TranslationData{Overview: "Sinopsis de España."}},
			},
			wantOverview: "Sinopsis de España.",
			wantLanguage: "es-ES",
		},
		{
			// Escalón 3: sin nada en español se usa el inglés, prefiriendo el de Estados Unidos. Este es
			// el único caso que la interfaz debe avisar, y por eso la etiqueta devuelta lo delata.
			name:    "falls back to US English and reports it",
			primary: "",
			translations: []Translation{
				{LanguageCode: "en", CountryCode: "GB", Data: TranslationData{Overview: "British synopsis."}},
				{LanguageCode: "en", CountryCode: "US", Data: TranslationData{Overview: "American synopsis."}},
			},
			wantOverview: "American synopsis.",
			wantLanguage: "en-US",
		},
		{
			// Sin nada utilizable no se inventa un texto ni se marca un idioma falso: dos vacíos.
			name:    "returns nothing when no usable translation exists",
			primary: "",
			translations: []Translation{
				{LanguageCode: "ja", CountryCode: "JP", Data: TranslationData{Overview: "日本語のあらすじ。"}},
				{LanguageCode: "es", CountryCode: "MX", Data: TranslationData{Overview: "   "}},
			},
			wantOverview: "",
			wantLanguage: "",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			gotOverview, gotLanguage := resolveOverview(testCase.primary, defaultLanguage, testCase.translations)
			if gotOverview != testCase.wantOverview {
				t.Errorf("overview = %q, want %q", gotOverview, testCase.wantOverview)
			}
			if gotLanguage != testCase.wantLanguage {
				t.Errorf("language tag = %q, want %q", gotLanguage, testCase.wantLanguage)
			}
		})
	}
}

// TestMapMovieToReleaseFallsBackToEnglishOverview comprueba el plan B de idioma DE PUNTA A PUNTA.
// En español: la prueba anterior mira la función de decisión por dentro; esta comprueba que el resultado
// llega de verdad al Release, que es lo que acaba en el catálogo y en la pantalla. Reproduce el caso de
// la película *Shell*: sin sinopsis en español de México, pero con 197 caracteres en inglés.
func TestMapMovieToReleaseFallsBackToEnglishOverview(t *testing.T) {
	t.Parallel()

	details := &MovieDetails{
		ID:          787747,
		Title:       "Shell",
		ReleaseDate: "2026-07-10",
		// Overview vacío: es exactamente lo que devuelve TMDB cuando no existe la traducción a es-MX.
		Overview: "",
		Translations: Translations{Results: []Translation{
			{LanguageCode: "en", CountryCode: "US", Data: TranslationData{Overview: "A wellness company promises eternal youth."}},
		}},
	}

	client := NewClient("unused-token-for-mapping")
	release := MapMovieToRelease(details, client)

	if release.GetOverview() != "A wellness company promises eternal youth." {
		t.Errorf("Overview = %q, want the English fallback text", release.GetOverview())
	}
	// La etiqueta del idioma es lo que permite a la interfaz avisar de que el texto no está en español.
	// Sin ella, rellenar el hueco con inglés parecería un descuido de traducción.
	if release.GetOverviewLanguage() != "en-US" {
		t.Errorf("OverviewLanguage = %q, want %q", release.GetOverviewLanguage(), "en-US")
	}
}

// TestSanitizeResolutionRejectsImpossibleSizes es la prueba del desbordamiento silencioso.
//
// EL FALLO QUE VIGILA, en español: la resolución de un video llega de TMDB como un número normal y
// se guarda en un campo más pequeño. Cuando el número no cabe, no falla nada ni avisa nadie: se
// queda con los dígitos que caben y produce OTRO número, perfectamente creíble, sin ninguna relación
// con el original. Medido: un "size":99999999999 acababa guardado como 1215752191.
//
// Y ese número inventado decidía: la resolución desempata el orden de calidad de los videos, así que
// el dato corrupto se ponía el primero y podía expulsar del catálogo al tráiler que tocaba mostrar.
func TestSanitizeResolutionRejectsImpossibleSizes(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		size int
		want int32
	}{
		{name: "resolucion normal 1080p", size: 1080, want: 1080},
		{name: "resolucion 4K", size: 2160, want: 2160},
		{name: "el tope aceptado (8K)", size: maxKnownVideoResolution, want: maxKnownVideoResolution},
		{name: "sin dato", size: 0, want: unknownVideoResolution},
		{name: "negativo", size: -720, want: unknownVideoResolution},
		{name: "un pixel por encima del tope", size: maxKnownVideoResolution + 1, want: unknownVideoResolution},
		{name: "el numero que desbordaba", size: 99999999999, want: unknownVideoResolution},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			if got := sanitizeResolution(testCase.size); got != testCase.want {
				t.Errorf("sanitizeResolution(%d) = %d, want %d", testCase.size, got, testCase.want)
			}
		})
	}
}

// TestACorruptResolutionCannotOutrankAGoodVideo comprueba la consecuencia, no solo la causa.
//
// En español: dos videos iguales en todo salvo la resolución, uno con una resolución real de 1080 y
// otro con el número desbordado. El bueno tiene que quedar primero. Antes ganaba el corrupto, porque
// 1215752191 es mayor que 1080, y como de cada montón solo se conservan dos, era capaz de echar del
// catálogo al tráiler correcto.
func TestACorruptResolutionCannotOutrankAGoodVideo(t *testing.T) {
	t.Parallel()

	videos := MapVideos([]Video{
		{
			Key: "corrupto", Site: "YouTube", Type: "Trailer", Official: true,
			LanguageCode: "es", RegionCode: "MX", Name: "Tráiler con dato roto",
			Size: 99999999999, PublishedAt: "2026-05-01T00:00:00.000Z",
		},
		{
			Key: "bueno", Site: "YouTube", Type: "Trailer", Official: true,
			LanguageCode: "es", RegionCode: "MX", Name: "Tráiler oficial",
			Size: 1080, PublishedAt: "2026-05-01T00:00:00.000Z",
		},
	})

	if len(videos) != 2 {
		t.Fatalf("MapVideos returned %d videos, want 2", len(videos))
	}
	if videos[0].GetYoutubeKey() != "bueno" {
		t.Errorf("the first video is %q, want %q: a corrupt resolution must not win the tie-break",
			videos[0].GetYoutubeKey(), "bueno")
	}
	if videos[1].GetResolution() != unknownVideoResolution {
		t.Errorf("the corrupt video kept resolution %d, want %d",
			videos[1].GetResolution(), unknownVideoResolution)
	}
}
