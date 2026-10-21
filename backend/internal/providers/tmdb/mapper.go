// Archivo: mapper.go — Traducción de los datos crudos de TMDB al modelo canónico del proyecto.
// En español: este archivo es el "traductor". Toma el expediente que TMDB nos dio (MovieDetails o
// TVDetails, los moldes de types.go) y lo convierte en un Release, que es el modelo propio del
// proyecto definido en catalog.proto. Aquí se deciden las reglas de negocio del mapeo: cómo armar
// un id único, qué categoría asignar, cuál es el tráiler correcto, cuántos miembros del reparto
// conservar, etc. No toca la red: solo transforma datos que el client.go ya trajo.

package tmdb

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode"

	// norm da la normalización Unicode (NFD) para separar las letras de sus acentos, lo que nos
	// permite TRANSLITERAR acentos a ASCII (ej. "é" -> "e") en lugar de descartar la letra entera.
	"golang.org/x/text/unicode/norm"

	// catalogv1 contiene los mensajes generados a partir de catalog.proto (Release, Ratings...).
	// En español: son los "tipos de datos" del contrato a los que traducimos lo de TMDB.
	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// maxCastMembers limita cuántos actores/actrices conservamos del reparto principal.
// En español: TMDB puede traer decenas de personas; para las fichas basta el reparto destacado.
// Conservamos los primeros diez (TMDB ya los entrega ordenados por importancia).
const maxCastMembers = 10

// maxCrewMembers limita cuántos miembros del equipo técnico conservamos.
// En español: nos quedamos con los roles clave (dirección, guion...) sin volcar todo el staff.
const maxCrewMembers = 10

// fallbackSlug es el prefijo de id cuando el título no produce ningún carácter ASCII utilizable.
// En español: si un título es 100% no-latino (ej. "日本語"), tras transliterar y limpiar el slug
// queda vacío. En ese caso usamos "title" para que el id final sea "title-tmdb-N" (válido, legible)
// y NO empiece con un guion ("-tmdb-N" sería feo y frágil para URLs/anclas).
const fallbackSlug = "title"

// MapMovieToRelease traduce el detalle de una película de TMDB al modelo canónico Release.
// En español: arma la ficha completa de la película en el formato propio del proyecto. Necesita el
// Client para construir las URLs de imágenes (póster y backdrop) con la base oficial y para saber en qué
// idioma se pidió el contenido, que es lo que permite anotar el idioma real de la sinopsis.
func MapMovieToRelease(details *MovieDetails, client *Client) *catalogv1.Release {
	// Sinopsis con plan B de idioma: español de México -> cualquier español -> inglés. Devuelve también
	// la etiqueta del idioma en que quedó, para que la interfaz pueda avisar si acabó en inglés.
	overview, overviewLanguage := resolveOverview(details.Overview, client.Language(), details.Translations.Results)

	release := &catalogv1.Release{
		// id propio = slug del título + sufijo con el id de TMDB, para garantizar unicidad aunque
		// dos títulos compartan nombre. Ej. "toy-story-tmdb-862".
		Id:    buildReleaseID(details.Title, details.ID),
		Type:  catalogv1.TitleType_MOVIE,
		Title: details.Title,
		// Categoría: se decide con los TIPOS de estreno de MX (release_dates): si hubo estreno en salas
		// (theatrical) es CINE; si solo hubo digital/TV o hay proveedores de suscripción es STREAMING.
		// La regla completa y su fallback viven en categoryForMovie.
		Category:         categoryForMovie(details),
		Overview:         overview,
		OverviewLanguage: overviewLanguage,
		// Fecha de estreno: preferimos la fecha REAL de MX (de release_dates) para ubicar la película en
		// el día correcto de la línea de tiempo; si MX no tiene fecha, caemos a la primary global.
		ReleaseDate:      movieReleaseDate(details),
		PosterUrl:        client.BuildImageURL(details.PosterPath, defaultPosterSize),
		BackdropUrl:      client.BuildImageURL(details.BackdropPath, defaultBackdropSize),
		Genres:           genreNames(details.Genres),
		OriginalLanguage: details.OriginalLanguage,
		SpokenLanguages:  spokenLanguageNames(details.SpokenLanguages),
		// videos: TODOS los videos de YouTube del título, cada uno con sus etiquetas. Aquí NO se elige
		// ninguno: la elección depende del idioma de la persona, que este programa no conoce. La hace
		// la aplicación en el momento de mostrar la ficha. Ver MapVideos.
		Videos: MapVideos(details.Videos.Results),
		// images: la galería "verla en acción" es curaduría visual; el seed la completa aparte, así
		// que aquí la dejamos vacía (no inventamos imágenes que no correspondan a esa galería).
		Images:  nil,
		Ratings: &catalogv1.Ratings{Tmdb: details.VoteAverage},
		Cast:    mapCast(client, details.Credits.Cast),
		Crew:    mapCrew(client, details.Credits.Crew),
		// availability: para películas las plataformas salen de los proveedores de suscripción (flatrate)
		// de MX; las cadenas de TV (networks) no aplican a películas, así que quedan vacías.
		Availability: &catalogv1.Availability{
			Platforms: flatrateProviderNames(details.WatchProviders.Results.MX),
			Networks:  nil,
		},
	}

	// saga: si la película pertenece a una colección, registramos su nombre. Las ENTRADAS (items) de
	// la saga requieren una segunda llamada (/collection/{id}); el seedgen las completa después, por
	// eso aquí items queda vacío con esta nota: items se llenan en seedgen.
	if details.BelongsToCollection != nil {
		release.Saga = &catalogv1.Collection{
			Name:  details.BelongsToCollection.Name,
			Items: nil, // items se llenan en seedgen vía CollectionDetails.
		}
	}

	return release
}

// SeasonPremiereInMonth devuelve la fecha de estreno de la temporada que ARRANCA en el año y mes
// dados, o cadena vacía si esa serie no estrena ninguna temporada ese mes.
//
// En español: para una serie, "lo que se estrena" no es la fecha de su primer episodio histórico
// (que puede ser de hace años), sino el arranque de una TEMPORADA NUEVA. TMDB entrega en /tv/{id} la
// lista de temporadas con su fecha de aire; aquí buscamos la que cae dentro del mes consultado. Si
// una serie solo continúa emitiendo episodios sueltos ese mes (por ejemplo, el capítulo 15 de una
// temporada que empezó en marzo), NO es un estreno y esta función devuelve vacío para que el
// llamador la descarte: así el catálogo muestra novedades reales y no el goteo semanal de todo lo
// que está al aire. Se ignora la temporada 0 ("Especiales"), que no es un estreno de temporada.
func SeasonPremiereInMonth(details *TVDetails, year, month int) string {
	if details == nil {
		return ""
	}
	prefix := fmt.Sprintf("%04d-%02d", year, month)
	for _, season := range details.Seasons {
		if season.SeasonNumber == 0 {
			continue
		}
		if strings.HasPrefix(season.AirDate, prefix) {
			return trimISODate(season.AirDate)
		}
	}
	return ""
}

// MapTVToRelease traduce el detalle de una serie de TMDB al modelo canónico Release.
// En español: análogo a MapMovieToRelease pero para series. Las series no tienen saga (TMDB no la
// expone para TV) y su categoría es STREAMING o TV según dónde se vea (regla en categoryForTV). El
// reparto sale de aggregate_credits si está disponible (acumula todas las temporadas) y, si no, de
// credits.
//
// releaseDateOverride permite fijar la fecha del estreno de TEMPORADA que corresponde al mes que se
// está generando (ver SeasonPremiereInMonth). Si viene vacía se usa la fecha del primer episodio
// histórico de la serie, que es el comportamiento correcto cuando no hay un mes de referencia.
func MapTVToRelease(details *TVDetails, client *Client, releaseDateOverride string) *catalogv1.Release {
	// Fecha que se mostrará en la línea de tiempo: la del estreno de temporada del mes consultado si
	// el llamador la resolvió; si no, la del primer episodio de la serie.
	releaseDate := releaseDateOverride
	if releaseDate == "" {
		releaseDate = details.FirstAirDate
	}

	// Elegimos la mejor fuente de reparto: los créditos acumulados de todas las temporadas si existen,
	// y si no, los créditos simples. Así una serie con varias temporadas muestra su reparto recurrente.
	castSource := details.AggregateCredits.Cast
	if len(castSource) == 0 {
		castSource = details.Credits.Cast
	}
	crewSource := details.AggregateCredits.Crew
	if len(crewSource) == 0 {
		crewSource = details.Credits.Crew
	}

	// Sinopsis con el mismo plan B de idioma que las películas (ver resolveOverview).
	overview, overviewLanguage := resolveOverview(details.Overview, client.Language(), details.Translations.Results)

	release := &catalogv1.Release{
		Id:    buildReleaseID(details.Name, details.ID),
		Type:  catalogv1.TitleType_SERIES,
		Title: details.Name,
		// Categoría de serie: STREAMING si hay proveedores de suscripción en MX; en caso contrario TV
		// (se asume emisión por cadena). Regla simple y suficiente para Fase 0.
		Category:         categoryForTV(details),
		Overview:         overview,
		OverviewLanguage: overviewLanguage,
		ReleaseDate:      releaseDate,
		PosterUrl:        client.BuildImageURL(details.PosterPath, defaultPosterSize),
		BackdropUrl:      client.BuildImageURL(details.BackdropPath, defaultBackdropSize),
		Genres:           genreNames(details.Genres),
		OriginalLanguage: details.OriginalLanguage,
		SpokenLanguages:  spokenLanguageNames(details.SpokenLanguages),
		// videos: la lista completa etiquetada, igual que en películas (ver MapVideos). Sin elegir.
		Videos:  MapVideos(details.Videos.Results),
		Images:  nil,
		Ratings: &catalogv1.Ratings{Tmdb: details.VoteAverage},
		Cast:    mapCast(client, castSource),
		Crew:    mapCrew(client, crewSource),
		Availability: &catalogv1.Availability{
			// Para series, los proveedores de suscripción de MX van como plataformas; las cadenas/redes
			// que la EMITEN (networks) van en networks (TMDB sí las da en /tv/{id}).
			Platforms: flatrateProviderNames(details.WatchProviders.Results.MX),
			Networks:  networkNames(details.Networks),
		},
		// saga de serie = sus TEMPORADAS (TMDB no expone belongs_to_collection para TV, pero las
		// temporadas son el equivalente natural). Si no hay temporadas reales, queda nil.
		Saga: mapTVSeasonsToSaga(details, client),
	}

	return release
}

// buildReleaseID arma el id propio del estreno como slug del título + "-tmdb-" + id de TMDB.
// En español: el slug hace el id legible y estable; el sufijo con el id de TMDB garantiza unicidad
// aunque dos títulos compartan el mismo nombre (ej. remakes). Ej.: "toy-story-tmdb-862".
func buildReleaseID(title string, tmdbID int) string {
	return slugify(title) + "-tmdb-" + strconv.Itoa(tmdbID)
}

// slugify convierte un título en un "slug" web: minúsculas, acentos TRANSLITERADOS a ASCII, guiones.
// En español: produce un identificador apto para URLs. El paso clave es TRANSLITERAR los acentos en
// vez de descartar la letra: "Vértigo Neón" se vuelve "vertigo-neon" (no "v-rtigo-ne-n"). Para ello:
//  1. Normalizamos a NFD, que separa cada letra acentuada en su letra base + una "marca combinante"
//     (ej. "é" -> "e" + acento agudo).
//  2. Descartamos esas marcas combinantes (unicode.Mn), quedándonos con la letra base ASCII.
//  3. Pasamos a minúsculas; las letras (a-z) y dígitos (0-9) pasan tal cual; cualquier otro carácter
//     (espacios, signos, letras no-latinas) se reemplaza por un único guion, sin guiones seguidos.
//
// Si tras todo esto el slug queda VACÍO (un título totalmente no-latino, ej. "日本語"), devolvemos el
// prefijo de respaldo "title" para que buildReleaseID forme "title-tmdb-N" y el id no empiece con "-".
func slugify(text string) string {
	// Normalizamos a NFD para poder separar las letras de sus acentos antes de limpiar.
	normalized := norm.NFD.String(strings.ToLower(text))

	var builder strings.Builder
	previousWasHyphen := false

	for _, character := range normalized {
		switch {
		case unicode.Is(unicode.Mn, character):
			// Marca combinante (el acento que NFD separó de la letra): se descarta, dejando la base.
			continue
		case character < unicode.MaxASCII && unicode.IsLetter(character):
			// Letras ASCII (a-z) ya en minúscula pasan tal cual.
			builder.WriteRune(character)
			previousWasHyphen = false
		case character < unicode.MaxASCII && unicode.IsDigit(character):
			// Dígitos (0-9) pasan tal cual.
			builder.WriteRune(character)
			previousWasHyphen = false
		default:
			// Cualquier otro carácter (espacios, signos, letras no-latinas) se convierte en un único
			// guion, evitando guiones consecutivos para no ensuciar el slug.
			if !previousWasHyphen {
				builder.WriteRune('-')
				previousWasHyphen = true
			}
		}
	}

	// Quitamos guiones sobrantes en los extremos.
	slug := strings.Trim(builder.String(), "-")

	// Título sin un solo carácter ASCII utilizable: usamos el prefijo de respaldo.
	if slug == "" {
		return fallbackSlug
	}
	return slug
}

// spanishLanguageCode e englishLanguageCode son los códigos ISO 639-1 de los dos idiomas del plan B de
// la sinopsis. Se nombran en vez de escribirlos sueltos porque aparecen en varios sitios y un error de
// dedo en uno de ellos apagaría el respaldo entero sin que nada fallara.
const (
	spanishLanguageCode = "es"
	englishLanguageCode = "en"
)

// englishPreferredCountry es el país cuya versión en inglés se prefiere cuando hay varias.
// En español: TMDB guarda el inglés de Estados Unidos, el del Reino Unido, el de Australia… Elegimos el
// de Estados Unidos porque es el que las distribuidoras rellenan primero y casi siempre el más completo.
const englishPreferredCountry = "US"

// resolveOverview elige la MEJOR sinopsis disponible y dice en qué idioma quedó.
//
// El problema que resuelve, en español: el catálogo se pide en español de México y TMDB, cuando no tiene
// esa traducción, devuelve la sinopsis vacía —no busca por su cuenta en otro idioma—. Eso dejaba 112 de
// los 422 estrenos sin una línea de sinopsis, teniéndola escrita en otro sitio: *Avignon* estaba en
// español de España, *Shell* y *Primavera* en inglés (comprobado contra la API el 2026-07-29).
//
// El orden de preferencia, y por qué es ese:
//  1. La sinopsis que vino en la petición principal, que ya está en español de México. Es la que se
//     escribió pensando en este público, así que gana siempre que exista.
//  2. Cualquier otra traducción al español (España, Argentina…). Un texto en español de España se lee
//     perfectamente en México; es infinitamente mejor que un hueco, y sigue sin necesitar aviso.
//  3. El inglés, prefiriendo el de Estados Unidos. Este es el único caso en que la interfaz debe AVISAR,
//     y por eso se devuelve también la etiqueta del idioma: rellenar el hueco con inglés sin decirlo
//     haría parecer que el producto está a medio traducir por descuido.
//
// Si no hay nada en ninguno de los tres escalones se devuelven dos cadenas vacías: no se inventa un
// texto ni se marca un idioma que no existe.
func resolveOverview(primaryOverview, primaryLanguage string, translations []Translation) (overview, languageTag string) {
	// Escalón 1: lo que vino en la petición principal (el idioma configurado del cliente).
	if trimmed := strings.TrimSpace(primaryOverview); trimmed != "" {
		return trimmed, primaryLanguage
	}

	// Escalón 2: cualquier español, prefiriendo el del país del proyecto (México).
	if text, tag := bestTranslationForLanguage(translations, spanishLanguageCode, defaultRegion); text != "" {
		return text, tag
	}

	// Escalón 3: inglés, prefiriendo el de Estados Unidos. La interfaz avisará de que no es español.
	if text, tag := bestTranslationForLanguage(translations, englishLanguageCode, englishPreferredCountry); text != "" {
		return text, tag
	}

	// Sin sinopsis en ningún idioma conocido: se deja vacío, con honestidad.
	return "", ""
}

// bestTranslationForLanguage busca la mejor traducción de un idioma y devuelve su texto y su etiqueta.
//
// En español: TMDB guarda una traducción por país, no por idioma, así que puede haber varias del mismo
// idioma ("es" de México y "es" de España). Esta función se queda con la del país preferido si existe y,
// si no, con la del país que va PRIMERO EN ORDEN ALFABÉTICO. Ese desempate alfabético parece arbitrario y
// es a propósito: sin él, dos generaciones del catálogo con los mismos datos podrían elegir traducciones
// distintas según el orden en que TMDB las devolviera ese día, y el archivo cambiaría sin que nadie
// hubiera cambiado nada. Las traducciones con la sinopsis vacía se ignoran (existen y son frecuentes).
func bestTranslationForLanguage(translations []Translation, languageCode, preferredCountry string) (overview, languageTag string) {
	// Recogemos solo las candidatas del idioma pedido que traen texto de verdad.
	candidates := make([]Translation, 0, len(translations))
	for _, translation := range translations {
		if translation.LanguageCode != languageCode {
			continue
		}
		if strings.TrimSpace(translation.Data.Overview) == "" {
			continue
		}
		candidates = append(candidates, translation)
	}
	if len(candidates) == 0 {
		return "", ""
	}

	// Orden estable: primero la del país preferido; entre las demás, por código de país alfabético.
	sort.SliceStable(candidates, func(first, second int) bool {
		left, right := candidates[first], candidates[second]
		leftPreferred := left.CountryCode == preferredCountry
		rightPreferred := right.CountryCode == preferredCountry
		if leftPreferred != rightPreferred {
			return leftPreferred
		}
		return left.CountryCode < right.CountryCode
	})

	best := candidates[0]
	return strings.TrimSpace(best.Data.Overview), buildLanguageTag(best.LanguageCode, best.CountryCode)
}

// buildLanguageTag junta idioma y país en una etiqueta legible ("es" + "MX" -> "es-MX").
// En español: es la misma forma que usa TMDB para nombrar sus montones de traducción, así que quien lea
// el catálogo reconoce el valor sin necesidad de una tabla de equivalencias. Si no hay país, devuelve
// solo el idioma (no dejamos un guion suelto colgando al final).
func buildLanguageTag(languageCode, countryCode string) string {
	if countryCode == "" {
		return languageCode
	}
	return languageCode + "-" + countryCode
}

// releaseTypeTheatrical es el tipo de estreno "en salas de cine" de TMDB.
// En español: cuando MX trae este tipo, la película llegó realmente al cine -> categoría CINE.
const releaseTypeTheatrical = 3

// releaseTypeDigital es el tipo de estreno "digital" (plataforma/compra online) de TMDB.
const releaseTypeDigital = 4

// releaseTypeTV es el tipo de estreno "TV" (emisión por televisión) de TMDB.
const releaseTypeTV = 6

// categoryForMovie decide la categoría de una película (CINE vs STREAMING) con datos fiables de MX.
// En español: la fuente de verdad son los TIPOS de estreno de México (de release_dates), no solo si
// hay fecha. La regla es:
//   - Si MX tiene un estreno THEATRICAL (tipo 3) -> CINE: la película llegó a salas.
//   - Si MX NO tuvo cine pero sí salió en DIGITAL (4) o TV (6), o hay proveedores de suscripción
//     (flatrate) en MX -> STREAMING: es un estreno directo a plataforma/TV.
//   - FALLBACK (sin tipos de MX y sin flatrate): asumimos CINE, que es el caso más común del
//     catálogo de estrenos del proyecto y el comportamiento conservador previo.
func categoryForMovie(details *MovieDetails) catalogv1.Category {
	// INDIE gana por encima de CINE/STREAMING: una película de autor sigue siendo "cine indie" esté en
	// salas o en plataforma. Se decide con señales FIABLES de TMDB (proveedor arthouse o documental de
	// baja popularidad), no por suposición. Ver isIndieMovie.
	if isIndieMovie(details) {
		return catalogv1.Category_INDIE
	}

	// Tipos de estreno registrados para México (3=cine, 4=digital, 6=TV...).
	mexicoReleaseTypes := MovieReleaseTypesForCountry(details, defaultRegion)
	hasTheatrical := containsInt(mexicoReleaseTypes, releaseTypeTheatrical)
	hasDigital := containsInt(mexicoReleaseTypes, releaseTypeDigital)
	hasTVRelease := containsInt(mexicoReleaseTypes, releaseTypeTV)
	hasFlatrate := hasMexicoFlatrate(details.WatchProviders.Results.MX)

	// Estreno en salas confirmado: es CINE.
	if hasTheatrical {
		return catalogv1.Category_CINE
	}

	// Sin cine pero con señales de plataforma/TV: es STREAMING.
	if hasDigital || hasTVRelease || hasFlatrate {
		return catalogv1.Category_STREAMING
	}

	// FALLBACK: sin información fiable, asumimos CINE (estreno en salas, lo más común del catálogo).
	return catalogv1.Category_CINE
}

// movieReleaseDate elige la fecha de estreno de una película: la real de MX si existe, si no la primary.
// En español: ver MexicoReleaseDate. Mantener la fecha de MX evita que un estreno mexicano de mayo
// aparezca en otro mes solo porque su primary_release_date global es de otro país.
func movieReleaseDate(details *MovieDetails) string {
	if mexicoDate := MexicoReleaseDate(details); mexicoDate != "" {
		return mexicoDate
	}
	return details.ReleaseDate
}

// arthouseProviders son fragmentos (en minúsculas) de nombres de plataformas "de autor"/arthouse.
// En español: si una película está disponible en MX en alguna de estas, la tratamos como cine INDIE.
// Son plataformas especializadas en cine independiente, clásico o de festival (señal fiable de TMDB).
var arthouseProviders = []string{"mubi", "criterion", "filmin", "festival scope", "klic", "dekkoo", "metrograph", "fandor"}

// indiePopularityThreshold es el umbral de popularidad bajo el cual un DOCUMENTAL se considera indie.
// En español: los documentales de baja popularidad suelen ser de festival/independientes. Por encima
// de este umbral asumimos que es un documental masivo (que cae en CINE/STREAMING normal). Valor
// conservador para no marcar como indie un éxito comercial.
const indiePopularityThreshold = 6.0

// isIndieMovie decide si una película es cine INDIE con señales fiables de TMDB (no por suposición).
// En español: dos señales: (1) está en una plataforma arthouse en MX; o (2) es un documental de baja
// popularidad (típico de festival/indie). Cualquier otra cosa NO es indie aquí (degrada a CINE/STREAMING).
func isIndieMovie(details *MovieDetails) bool {
	if hasArthouseProvider(details.WatchProviders.Results.MX) {
		return true
	}
	if details.Popularity < indiePopularityThreshold && hasGenreNamed(details.Genres, "Documental", "Documentary") {
		return true
	}
	return false
}

// hasArthouseProvider indica si los proveedores de suscripción de MX incluyen una plataforma arthouse.
func hasArthouseProvider(mexico *WatchProvidersCountry) bool {
	if mexico == nil {
		return false
	}
	for _, provider := range mexico.Flatrate {
		name := strings.ToLower(provider.ProviderName)
		for _, arthouse := range arthouseProviders {
			if strings.Contains(name, arthouse) {
				return true
			}
		}
	}
	return false
}

// hasGenreNamed indica si la lista de géneros incluye alguno de los nombres dados (sin distinguir mayúsculas).
func hasGenreNamed(genres []Genre, names ...string) bool {
	for _, genre := range genres {
		for _, name := range names {
			if strings.EqualFold(genre.Name, name) {
				return true
			}
		}
	}
	return false
}

// containsInt indica si un entero está presente en una lista de enteros.
// En español: ayudante pequeño para preguntar "¿está este tipo de estreno entre los de MX?".
func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// categoryForTV decide la categoría de una serie: STREAMING si hay proveedores de suscripción en
// MX; en caso contrario, TV (emisión por cadena).
// En español: regla simple. La mayoría de series del catálogo viven en plataformas, así que si hay
// proveedores flatrate en MX la marcamos STREAMING; si no, asumimos cadena de TV.
func categoryForTV(details *TVDetails) catalogv1.Category {
	if hasMexicoFlatrate(details.WatchProviders.Results.MX) {
		return catalogv1.Category_STREAMING
	}
	return catalogv1.Category_TV
}

// hasMexicoFlatrate indica si hay proveedores de suscripción (flatrate) disponibles en MX.
// En español: "flatrate" = incluido en una suscripción (streaming todo incluido). Devuelve true solo
// si la estructura de MX existe y trae al menos un proveedor de ese tipo.
func hasMexicoFlatrate(mexico *WatchProvidersCountry) bool {
	return mexico != nil && len(mexico.Flatrate) > 0
}

// flatrateProviderNames extrae los nombres de los proveedores de suscripción (flatrate) de MX.
// En español: convierte la lista de proveedores de TMDB en una lista simple de nombres (ej.
// ["Netflix", "Max"]) para el campo platforms del modelo. Si no hay datos de MX, devuelve nil.
func flatrateProviderNames(mexico *WatchProvidersCountry) []string {
	if mexico == nil {
		return nil
	}
	names := make([]string, 0, len(mexico.Flatrate))
	for _, provider := range mexico.Flatrate {
		if provider.ProviderName != "" {
			names = append(names, provider.ProviderName)
		}
	}
	if len(names) == 0 {
		return nil
	}
	return names
}

// genreNames extrae los nombres de los géneros de TMDB a una lista simple de cadenas.
// En español: el modelo solo guarda los nombres de los géneros, no sus ids.
func genreNames(genres []Genre) []string {
	if len(genres) == 0 {
		return nil
	}
	names := make([]string, 0, len(genres))
	for _, genre := range genres {
		if genre.Name != "" {
			names = append(names, genre.Name)
		}
	}
	if len(names) == 0 {
		return nil
	}
	return names
}

// spokenLanguageNames extrae los nombres (en inglés) de los idiomas hablados.
// En español: usamos el "english_name" por ser estable; el modelo guarda solo la lista de nombres.
func spokenLanguageNames(languages []SpokenLanguage) []string {
	if len(languages) == 0 {
		return nil
	}
	names := make([]string, 0, len(languages))
	for _, language := range languages {
		if language.EnglishName != "" {
			names = append(names, language.EnglishName)
		}
	}
	if len(names) == 0 {
		return nil
	}
	return names
}

// videoKindByTMDBType traduce el texto de "type" de TMDB a nuestro enum VideoKind.
// En español: TMDB describe la clase de video con una palabra en inglés. La convertimos a un valor
// propio del contrato para que la aplicación no dependa de un texto externo que podría cambiar. Lo
// que no esté en esta tabla queda como UNSPECIFIED y la cadena de elección lo ignora.
var videoKindByTMDBType = map[string]catalogv1.VideoKind{
	"Trailer":           catalogv1.VideoKind_VIDEO_KIND_TRAILER,
	"Teaser":            catalogv1.VideoKind_VIDEO_KIND_TEASER,
	"Clip":              catalogv1.VideoKind_VIDEO_KIND_CLIP,
	"Featurette":        catalogv1.VideoKind_VIDEO_KIND_FEATURETTE,
	"Behind the Scenes": catalogv1.VideoKind_VIDEO_KIND_BEHIND_THE_SCENES,
	"Bloopers":          catalogv1.VideoKind_VIDEO_KIND_BLOOPERS,
	"Opening Credits":   catalogv1.VideoKind_VIDEO_KIND_OPENING_CREDITS,
	"Recap":             catalogv1.VideoKind_VIDEO_KIND_RECAP,
}

// dubbedTitleMarkers son las marcas que, en el título de un video, delatan que está DOBLADO.
// En español: las distribuidoras rotulan sus tráilers de forma bastante consistente ("Tráiler
// Oficial | Doblado", "Trailer Latino"). Buscamos esas marcas en minúsculas y sin acentos, para que
// "Doblado" y "doblado" cuenten igual. Es una heurística declarada, no un dato certificado.
var dubbedTitleMarkers = []string{"doblado", "doblada", "doblaje", "latino", "castellano", "dubbed", "dublado"}

// subtitledTitleMarkers son las marcas que delatan que un video está SUBTITULADO (audio original).
// En español: importa distinguirlo del doblaje porque TMDB etiqueta como "es-MX" tanto el doblaje
// latino como el tráiler en inglés con subtítulos en español latino. Quien pide español prefiere OÍR
// español, así que el doblado gana al subtitulado dentro del mismo montón.
var subtitledTitleMarkers = []string{"subtitulado", "subtitulada", "subtitulos", "sub espanol", "subbed", "eng sub", "legendado"}

// isoDateOnlyLength es cuántos caracteres ocupa la parte "AAAA-MM-DD" de una fecha ISO con hora.
const isoDateOnlyLength = 10

// isoYearLength es cuántos caracteres ocupa el año al principio de una fecha ISO.
const isoYearLength = 4

// usableVideoKinds son las clases de video que la aplicación llega a mostrar alguna vez.
// En español: el tráiler héroe usa TRAILER o TEASER; el video complementario usa FEATURETTE,
// BEHIND_THE_SCENES, TEASER o CLIP. Todo lo demás (tomas falsas, créditos de apertura, resúmenes) no
// se enseña en ninguna pantalla, así que ni se guarda ni se gasta una comprobación en él.
var usableVideoKinds = map[catalogv1.VideoKind]bool{
	catalogv1.VideoKind_VIDEO_KIND_TRAILER:           true,
	catalogv1.VideoKind_VIDEO_KIND_TEASER:            true,
	catalogv1.VideoKind_VIDEO_KIND_FEATURETTE:        true,
	catalogv1.VideoKind_VIDEO_KIND_BEHIND_THE_SCENES: true,
	catalogv1.VideoKind_VIDEO_KIND_CLIP:              true,
}

// maxVideosPerBucket es cuántos videos se conservan de cada combinación idioma+región+clase.
//
// Por qué hay un tope, en español: TMDB puede devolver una barbaridad de videos por título (147 en el
// caso medido de Spider-Man, casi todos clips y featurettes en inglés). Guardarlos todos hincharía el
// catálogo y, sobre todo, obligaría a comprobar decenas de miles de videos contra YouTube en cada
// regeneración, para que la aplicación acabe enseñando dos. Con dos por combinación, cada escalón de
// la cadena de elección sigue teniendo candidatos —hay un tráiler mexicano doblado, uno subtitulado,
// uno de España, uno en inglés…— y el trabajo se mantiene en un tamaño razonable.
const maxVideosPerBucket = 2

// MapVideos traduce TODOS los videos de YouTube de un título a la lista del contrato.
//
// En español: esta función sustituye a la vieja pareja "elige el tráiler / elige el complementario".
// Ya no se elige nada aquí, y eso es el cambio de fondo: el generador NO SABE qué idioma prefiere la
// persona que va a mirar la ficha, así que cualquier elección que tomara sería a ciegas. Lo que hace
// es mapear cada video con sus etiquetas (idioma, región, clase, oficialidad, doblaje, año,
// resolución) y dejar que la aplicación decida en el momento.
//
// Tres campos quedan a cero a propósito porque TMDB no los tiene: "channel", "channel_kind" y
// "playable"/"verified_at". Los rellena seedgen consultando oEmbed de YouTube, que es quien sabe qué
// canal subió el video y si sigue vivo. Un video que llegue de aquí todavía NO está verificado.
func MapVideos(videos []Video) []*catalogv1.Video {
	mapped := make([]*catalogv1.Video, 0, len(videos))
	// seenKeys evita que un mismo video entre dos veces: TMDB llega a repetir la misma key en dos
	// montones de idioma, y guardarla duplicada gastaría una comprobación de más y ensuciaría la lista.
	seenKeys := make(map[string]bool, len(videos))

	for _, video := range videos {
		// Solo nos interesan los videos de YouTube: es el único reproductor que la aplicación incrusta.
		if !isYouTube(video) {
			continue
		}
		// Un video sin código no se puede reproducir ni identificar: se descarta sin ruido.
		if video.Key == "" || seenKeys[video.Key] {
			continue
		}
		kind := videoKindByTMDBType[video.Type]
		// Las clases que la aplicación nunca muestra no se guardan (ver usableVideoKinds).
		if !usableVideoKinds[kind] {
			continue
		}
		seenKeys[video.Key] = true

		mapped = append(mapped, &catalogv1.Video{
			YoutubeKey:    video.Key,
			Language:      video.LanguageCode,
			Region:        video.RegionCode,
			Kind:          kind,
			Official:      video.Official,
			Title:         video.Name,
			Dubbing:       detectDubbing(video.Name),
			PublishedYear: publishedYear(video.PublishedAt),
			Resolution:    sanitizeResolution(video.Size),
			// channel, channelKind, playable y verifiedAt los completa seedgen con oEmbed. Se dejan en
			// su valor cero de forma consciente: "todavía sin verificar" y, por tanto, sin mostrar.
		})
	}

	// Ordenamos y recortamos: nos quedamos con los mejores de cada combinación idioma+región+clase.
	trimmed := trimVideosPerBucket(sortVideosByQuality(mapped))
	if len(trimmed) == 0 {
		return nil
	}
	return trimmed
}

// maxKnownVideoResolution es la altura en píxeles más alta que se considera un dato creíble.
//
// En español: la resolución de un video de YouTube es su altura en píxeles, y los valores reales son
// 360, 480, 720, 1080 y 2160 (que es 4K). Se admite hasta 8640, que es 8K —el formato más alto que
// YouTube reproduce hoy—, para no rechazar un dato legítimo si algún día aparece. Cualquier cosa por
// encima no es una resolución: es un dato corrupto.
const maxKnownVideoResolution = 8640

// unknownVideoResolution es lo que se guarda cuando la resolución que llega no es creíble.
// En español: cero significa "no se sabe". Es el mismo valor que tiene un video del que TMDB no
// informa la resolución, y el orden de calidad ya sabe tratarlo (queda por detrás de cualquier
// resolución conocida, que es exactamente lo que merece un dato del que no nos fiamos).
const unknownVideoResolution = 0

// sanitizeResolution convierte la resolución que llega de TMDB en un número de confianza.
//
// EL FALLO QUE ARREGLA, en español: la conversión anterior tomaba el número tal cual y lo metía en
// un campo más pequeño. Cuando el número no cabe, no falla nada ni avisa nadie: se queda con los
// dígitos que caben y produce OTRO número, perfectamente plausible, sin ninguna relación con el
// original. Medido: un "size":99999999999 en la respuesta se guardaba en el catálogo como 1215752191.
//
// Y ese número inventado no se quedaba quieto: la resolución es uno de los criterios con los que se
// ordenan los videos de un título (ver sortVideosByQuality), así que un video con un dato corrupto
// se colocaba EL PRIMERO por delante de los buenos, y como de cada montón solo se conservan dos, era
// capaz de expulsar del catálogo al tráiler que de verdad tocaba mostrar. Un dato basura no solo se
// guardaba: decidía.
//
// Ahora, lo que no es una resolución creíble se guarda como "no se sabe" y pierde el desempate en
// vez de ganarlo.
func sanitizeResolution(sizeInPixels int) int32 {
	if sizeInPixels <= 0 || sizeInPixels > maxKnownVideoResolution {
		return unknownVideoResolution
	}
	return int32(sizeInPixels)
}

// sortVideosByQuality ordena los videos de mejor a peor con un criterio ESTABLE y reproducible.
//
// En español: el orden es el mismo que usa la aplicación para desempatar dentro de un escalón, y por
// una buena razón: si el generador recorta la lista con un criterio y la aplicación elige con otro,
// el generador podría tirar justo el que la aplicación habría preferido. Los criterios, en orden:
//  1. Los marcados como oficiales por TMDB van delante.
//  2. El publicado más recientemente (suele ser el tráiler final, no el adelanto inicial).
//  3. El de mayor resolución.
//  4. El código de YouTube en orden alfabético. Este último es artificial y a propósito: garantiza que
//     dos generaciones con los mismos datos produzcan EXACTAMENTE el mismo catálogo. Sin él, dos
//     videos idénticos en todo lo demás podrían intercambiarse entre corridas y el archivo cambiaría
//     sin que nadie hubiera cambiado nada.
//
// El canal todavía no se conoce en este punto (lo trae oEmbed más tarde), así que no participa aquí.
func sortVideosByQuality(videos []*catalogv1.Video) []*catalogv1.Video {
	sort.SliceStable(videos, func(first, second int) bool {
		left, right := videos[first], videos[second]
		if left.GetOfficial() != right.GetOfficial() {
			return left.GetOfficial()
		}
		if left.GetPublishedYear() != right.GetPublishedYear() {
			return left.GetPublishedYear() > right.GetPublishedYear()
		}
		if left.GetResolution() != right.GetResolution() {
			return left.GetResolution() > right.GetResolution()
		}
		return left.GetYoutubeKey() < right.GetYoutubeKey()
	})
	return videos
}

// trimVideosPerBucket conserva como mucho maxVideosPerBucket videos de cada idioma+región+clase.
// En español: recorre la lista YA ORDENADA de mejor a peor y va llevando la cuenta de cuántos lleva
// de cada combinación; en cuanto una llega a su tope, los siguientes de esa misma combinación se
// dejan fuera. Así se conserva la variedad (el mexicano, el español, el inglés) y se tira la
// repetición (el decimoquinto clip en inglés).
func trimVideosPerBucket(videos []*catalogv1.Video) []*catalogv1.Video {
	countByBucket := make(map[string]int, len(videos))
	kept := make([]*catalogv1.Video, 0, len(videos))
	for _, video := range videos {
		bucket := fmt.Sprintf("%s|%s|%d", video.GetLanguage(), video.GetRegion(), video.GetKind())
		if countByBucket[bucket] >= maxVideosPerBucket {
			continue
		}
		countByBucket[bucket]++
		kept = append(kept, video)
	}
	return kept
}

// detectDubbing deduce, del TÍTULO del video, si está doblado, subtitulado o en su audio original.
//
// En español: es la única señal disponible; no existe ningún campo que lo diga. Se normaliza el
// título (minúsculas y sin acentos, reusando la misma transliteración del slug) y se buscan marcas
// conocidas. Se comprueba PRIMERO el doblaje porque un título como "Tráiler doblado y subtitulado"
// describe una versión doblada. Si no aparece ninguna marca devolvemos ORIGINAL, no UNSPECIFIED: un
// título sin rótulos es, en la práctica, la versión original — y la cadena de elección lo trata como
// un candidato válido, solo que por detrás del doblaje explícito.
func detectDubbing(videoTitle string) catalogv1.DubbingKind {
	if strings.TrimSpace(videoTitle) == "" {
		return catalogv1.DubbingKind_DUBBING_KIND_UNSPECIFIED
	}
	normalized := stripAccentsLower(videoTitle)
	for _, marker := range dubbedTitleMarkers {
		if strings.Contains(normalized, marker) {
			return catalogv1.DubbingKind_DUBBING_KIND_DUBBED
		}
	}
	for _, marker := range subtitledTitleMarkers {
		if strings.Contains(normalized, marker) {
			return catalogv1.DubbingKind_DUBBING_KIND_SUBTITLED
		}
	}
	return catalogv1.DubbingKind_DUBBING_KIND_ORIGINAL
}

// stripAccentsLower pasa un texto a minúsculas y le quita los acentos, dejándolo comparable.
// En español: "Tráiler Oficial (Doblado)" se convierte en "trailer oficial (doblado)". Hace falta
// porque quien sube el video escribe el rótulo como quiere ("Doblado", "DOBLADO", "doblado") y una
// comparación literal fallaría por una tilde o una mayúscula. Usa la misma técnica que slugify:
// normalizar a NFD para separar cada letra de su acento y descartar las marcas combinantes. A
// diferencia de slugify, aquí SÍ se conservan los espacios y los signos, porque buscamos palabras
// dentro de una frase, no un identificador de URL.
func stripAccentsLower(text string) string {
	normalized := norm.NFD.String(strings.ToLower(text))
	var builder strings.Builder
	for _, character := range normalized {
		// Marca combinante (el acento que NFD separó de su letra): se descarta y queda la letra base.
		if unicode.Is(unicode.Mn, character) {
			continue
		}
		builder.WriteRune(character)
	}
	return builder.String()
}

// publishedYear extrae el AÑO de una fecha ISO de publicación ("2026-07-21T16:00:24.000Z" -> 2026).
// En español: entre dos tráilers igual de buenos preferimos el más reciente, porque el último suele
// ser el tráiler final y el primero un adelanto. Si la fecha falta o viene mal formada devolvemos 0,
// que en el desempate significa "no sé cuándo" y queda por detrás de cualquier año conocido.
func publishedYear(publishedAt string) int32 {
	if len(publishedAt) < isoDateOnlyLength {
		return 0
	}
	year, err := strconv.Atoi(publishedAt[:isoYearLength])
	if err != nil {
		return 0
	}
	return int32(year)
}

// isYouTube indica si un video está alojado en YouTube.
// En español: comparamos el campo "site" exactamente con "YouTube" (así lo entrega TMDB).
func isYouTube(video Video) bool {
	return video.Site == "YouTube"
}

// resolveCastRole averigua QUÉ PERSONAJE interpreta un actor, venga en la forma de película o de serie.
//
// En español: aquí está el arreglo del defecto que dejaba sin personaje al 100 % del reparto de las
// series. TMDB entrega el dato en dos sitios distintos según el tipo de obra:
//   - En una PELÍCULA, el personaje viene en un campo suelto llamado "character".
//   - En una SERIE (aggregate_credits), la persona aparece UNA vez con una LISTA de papeles, porque
//     puede haber hecho varios a lo largo de las temporadas; cada uno con sus episodios.
//
// El código anterior solo miraba el campo suelto, así que en las series leía un hueco. Ahora se miran
// los dos, y cuando hay lista se elige el papel de MÁS EPISODIOS: si alguien fue el protagonista en 73
// capítulos y su propio fantasma en 1, lo que define a esa persona en la ficha es el protagonista.
// Devuelve además el total de episodios de ese papel, que es lo que se guarda como episode_count.
func resolveCastRole(member CastMember) (role string, episodeCount int) {
	// Forma de PELÍCULA: el personaje viene directo. Es también lo que usan los créditos simples de una
	// serie (el bloque "credits"), que se usan cuando no hay créditos acumulados.
	if member.Character != "" {
		return member.Character, member.TotalEpisodeCount
	}

	// Forma de SERIE: nos quedamos con el papel de más episodios. Ante empate gana el primero que TMDB
	// devolvió, que es el orden en que ya los tiene ordenados por relevancia.
	bestRole := ""
	bestEpisodes := -1
	for _, entry := range member.Roles {
		if entry.Character == "" {
			continue
		}
		if entry.EpisodeCount > bestEpisodes {
			bestRole = entry.Character
			bestEpisodes = entry.EpisodeCount
		}
	}
	if bestRole == "" {
		// Ni campo suelto ni lista utilizable: no hay personaje que mostrar. No se inventa nada.
		return "", member.TotalEpisodeCount
	}
	return bestRole, member.TotalEpisodeCount
}

// resolveCrewJob averigua QUÉ OFICIO desempeña alguien del equipo, en las dos formas de TMDB.
// En español: es el gemelo de resolveCastRole para el equipo técnico. En películas el oficio viene en el
// campo "job"; en series viene dentro de una lista "jobs", porque la misma persona puede haber dirigido
// unos capítulos y escrito otros. Se elige el oficio de más episodios, por la misma razón: es el que
// describe de verdad lo que esa persona hizo en la serie.
func resolveCrewJob(member CrewMember) (job string, episodeCount int) {
	if member.Job != "" {
		return member.Job, member.TotalEpisodeCount
	}

	bestJob := ""
	bestEpisodes := -1
	for _, entry := range member.Jobs {
		if entry.Job == "" {
			continue
		}
		if entry.EpisodeCount > bestEpisodes {
			bestJob = entry.Job
			bestEpisodes = entry.EpisodeCount
		}
	}
	if bestJob == "" {
		return "", member.TotalEpisodeCount
	}
	return bestJob, member.TotalEpisodeCount
}

// mapCast traduce el reparto de TMDB a la lista de Credit del modelo, limitada al reparto principal.
// En español: por cada actor/actriz tomamos su número de identidad, su nombre, el personaje que
// interpreta (resuelto en las dos formas de TMDB, ver resolveCastRole), su foto, su área de trabajo y en
// cuántos episodios sale. Nos quedamos con los primeros maxCastMembers (TMDB ya los ordena por
// importancia). El número de identidad es el que permitirá saber que dos títulos comparten actor sin
// tener que comparar nombres escritos, que es frágil.
func mapCast(client *Client, cast []CastMember) []*catalogv1.Credit {
	if len(cast) == 0 {
		return nil
	}
	limit := len(cast)
	if limit > maxCastMembers {
		limit = maxCastMembers
	}

	credits := make([]*catalogv1.Credit, 0, limit)
	for _, member := range cast[:limit] {
		role, episodeCount := resolveCastRole(member)
		credits = append(credits, &catalogv1.Credit{
			Name:         member.Name,
			Role:         role,
			PhotoUrl:     buildProfileURL(client, member.ProfilePath),
			PersonTmdbId: int32(member.ID),
			Department:   member.KnownForDepartment,
			EpisodeCount: int32(episodeCount),
		})
	}
	return credits
}

// mapCrew traduce el equipo técnico de TMDB a la lista de Credit del modelo, limitada a los roles clave.
// En español: por cada persona tomamos su número de identidad, su nombre, su oficio (resuelto en las dos
// formas de TMDB, ver resolveCrewJob), su FOTO, su área y sus episodios. Nos quedamos con los primeros
// maxCrewMembers. La foto se construye igual que la del reparto: TMDB la entrega también para el equipo,
// al contrario de lo que decía el comentario que había aquí antes (comprobado contra la API real).
func mapCrew(client *Client, crew []CrewMember) []*catalogv1.Credit {
	if len(crew) == 0 {
		return nil
	}
	limit := len(crew)
	if limit > maxCrewMembers {
		limit = maxCrewMembers
	}

	credits := make([]*catalogv1.Credit, 0, limit)
	for _, member := range crew[:limit] {
		job, episodeCount := resolveCrewJob(member)
		credits = append(credits, &catalogv1.Credit{
			Name:         member.Name,
			Role:         job,
			PhotoUrl:     buildProfileURL(client, member.ProfilePath),
			PersonTmdbId: int32(member.ID),
			Department:   member.Department,
			EpisodeCount: int32(episodeCount),
		})
	}
	return credits
}

// buildProfileURL arma la URL de la foto de una persona con el tamaño de póster por defecto.
// En español: las fotos de perfil usan la misma base de imágenes que pósters y backdrops, así que
// las construimos con client.BuildImageURL para respetar la base OFICIAL cacheada desde /configuration
// (no una constante fija). Si no hay foto (ruta vacía), BuildImageURL devuelve cadena vacía.
func buildProfileURL(client *Client, profilePath string) string {
	return client.BuildImageURL(profilePath, defaultPosterSize)
}

// MapCollectionToItems traduce el detalle de una saga a la lista de CollectionItem del modelo.
// En español: el seedgen llama a CollectionDetails y luego usa esta función para llenar los "items"
// de la saga de un Release (las otras películas de la colección), que MapMovieToRelease dejó vacíos.
func MapCollectionToItems(collection *Collection, client *Client) []*catalogv1.CollectionItem {
	if collection == nil || len(collection.Parts) == 0 {
		return nil
	}
	items := make([]*catalogv1.CollectionItem, 0, len(collection.Parts))
	for _, part := range collection.Parts {
		items = append(items, &catalogv1.CollectionItem{
			Title:       part.Title,
			Year:        yearFromISODate(part.ReleaseDate),
			PosterUrl:   client.BuildImageURL(part.PosterPath, defaultPosterSize),
			Overview:    part.Overview,
			BackdropUrl: client.BuildImageURL(part.BackdropPath, defaultBackdropSize),
			Rating:      part.VoteAverage,
			// Las películas de saga no tienen un "extra" de conteo de episodios (eso es de temporadas).
			Extra: "",
		})
	}
	return items
}

// maxGalleryImages limita cuántas escenas (backdrops) conservamos para la galería de la ficha.
const maxGalleryImages = 5

// MapImagesToGallery traduce la galería de imágenes de TMDB a la lista de Image del modelo.
// En español: el seedgen llama a Images (GET /{kind}/{id}/images) y luego usa esta función para
// poblar la galería "verla en acción" de la ficha con escenas reales. Tomamos las primeras
// maxGalleryImages backdrops y les ponemos una etiqueta legible ("Escena 01"...).
func MapImagesToGallery(images *ImageList, client *Client) []*catalogv1.Image {
	if images == nil || len(images.Backdrops) == 0 {
		return nil
	}
	gallery := make([]*catalogv1.Image, 0, maxGalleryImages)
	for index, backdrop := range images.Backdrops {
		if index >= maxGalleryImages {
			break
		}
		if backdrop.FilePath == "" {
			continue
		}
		gallery = append(gallery, &catalogv1.Image{
			Url:   client.BuildImageURL(backdrop.FilePath, defaultBackdropSize),
			Label: fmt.Sprintf("Escena %02d", index+1),
		})
	}
	if len(gallery) == 0 {
		return nil
	}
	return gallery
}

// mapTVSeasonsToSaga arma la "saga" de una serie a partir de sus TEMPORADAS (entradas del carrusel).
// En español: cada temporada real (número >= 1; descartamos la 0 = especiales) se vuelve una entrada
// con su nombre, año y póster. Si la serie no tiene temporadas reales, devuelve nil (sin saga).
func mapTVSeasonsToSaga(details *TVDetails, client *Client) *catalogv1.Collection {
	items := make([]*catalogv1.CollectionItem, 0, len(details.Seasons))
	for _, season := range details.Seasons {
		if season.SeasonNumber < 1 {
			continue
		}
		// "extra" = conteo de episodios de la temporada, si lo hay (ej. "8 episodios").
		extra := ""
		if season.EpisodeCount > 0 {
			extra = fmt.Sprintf("%d episodios", season.EpisodeCount)
		}
		items = append(items, &catalogv1.CollectionItem{
			Title:     season.Name,
			Year:      yearFromISODate(season.AirDate),
			PosterUrl: client.BuildImageURL(season.PosterPath, defaultPosterSize),
			Overview:  season.Overview,
			// Las temporadas no traen backdrop propio en TMDB: lo dejamos vacío (el modal cae al póster).
			BackdropUrl: "",
			Rating:      season.VoteAverage,
			Extra:       extra,
		})
	}
	if len(items) == 0 {
		return nil
	}
	return &catalogv1.Collection{Name: details.Name, Items: items}
}

// networkNames extrae los nombres de las cadenas/redes que emiten una serie a una lista simple.
// En español: el modelo guarda solo los nombres (ej. ["HBO", "AMC"]) para "dónde verla".
func networkNames(networks []Network) []string {
	if len(networks) == 0 {
		return nil
	}
	names := make([]string, 0, len(networks))
	for _, network := range networks {
		if network.Name != "" {
			names = append(names, network.Name)
		}
	}
	if len(names) == 0 {
		return nil
	}
	return names
}

// yearFromISODate extrae el año (texto) de una fecha ISO "AAAA-MM-DD"; cadena vacía si no aplica.
// En español: el modelo guarda el año como texto; tomamos los primeros cuatro caracteres de la fecha
// si tienen la longitud esperada, sin convertir a número (es solo para mostrar).
func yearFromISODate(isoDate string) string {
	const yearLength = 4
	if len(isoDate) < yearLength {
		return ""
	}
	return isoDate[:yearLength]
}
