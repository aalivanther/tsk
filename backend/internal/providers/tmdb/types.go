// Archivo: types.go — Estructuras Go para deserializar las respuestas de la API TMDB v3.
// En español: este archivo define los "moldes" en los que se vacían las respuestas JSON de TMDB.
// Cada struct refleja SOLO los campos que el proyecto realmente usa (no copiamos toda la API,
// que es enorme), con sus etiquetas json para que el decodificador sepa qué clave del JSON va
// en qué campo de Go. Si TMDB devuelve campos extra, simplemente se ignoran. Estos tipos son la
// "frontera" entre el mundo externo (TMDB) y nuestro modelo propio (Release del contrato): el
// mapper.go los traduce después a nuestro modelo canónico.

package tmdb

// Configuration es la respuesta de GET /configuration de TMDB.
// En español: TMDB no garantiza que la URL base de las imágenes sea siempre la misma, por eso
// pide que se consulte al arranque y se cachee. De aquí sacamos la base segura (https) y la lista
// de tamaños válidos de póster y backdrop, para no hardcodear esos valores en el código.
type Configuration struct {
	// Images agrupa la configuración relativa a las imágenes (base y tamaños disponibles).
	Images ConfigurationImages `json:"images"`
}

// ConfigurationImages contiene la base de URL de imágenes y los tamaños disponibles.
// En español: la "secure_base_url" es el prefijo https de todas las imágenes; las listas de
// tamaños son los sufijos válidos (ej. "w500", "w1280", "original") que TMDB acepta.
type ConfigurationImages struct {
	// SecureBaseURL es el prefijo https para construir cualquier URL de imagen.
	SecureBaseURL string `json:"secure_base_url"`
	// PosterSizes son los tamaños válidos para pósters (ej. "w92".."w780", "original").
	PosterSizes []string `json:"poster_sizes"`
	// BackdropSizes son los tamaños válidos para imágenes de fondo (ej. "w300".."w1280", "original").
	BackdropSizes []string `json:"backdrop_sizes"`
}

// DiscoverMovieResult es una entrada mínima del descubrimiento: únicamente su identificador.
//
// En español: con este id se hace después la llamada al detalle de la película. La página que las
// contiene NO se describe aquí, sino en discoverPageEnvelope (client.go), y por un motivo concreto:
// esa página se lee en dos tiempos —primero la paginación y después cada entrada por separado— para
// que una entrada mal formada no invalide la página entera. El molde de una sola pieza que vivía
// aquí hacía justo lo contrario: un identificador entrecomillado en una película detenía la
// generación completa del catálogo.
type DiscoverMovieResult struct {
	// ID es el identificador numérico de la película en TMDB.
	ID int `json:"id"`
}

// SearchResponse es la respuesta de GET /search/{movie|tv}.
// En español: la usa la CURADURÍA para resolver el id de TMDB de un título dado por su nombre. Solo
// leemos los resultados (con su id y fecha) para elegir el match correcto (preferimos el de 2026).
type SearchResponse struct {
	// Results es la lista de coincidencias de la búsqueda.
	Results []SearchResult `json:"results"`
}

// SearchResult es una coincidencia de búsqueda: su id y su fecha (para preferir el estreno de 2026).
// En español: películas traen release_date; series traen first_air_date. Usamos la que exista.
type SearchResult struct {
	// ID es el identificador del título en TMDB.
	ID int `json:"id"`
	// ReleaseDate es la fecha de estreno de la PELÍCULA (ISO), si aplica.
	ReleaseDate string `json:"release_date"`
	// FirstAirDate es la fecha del primer episodio de la SERIE (ISO), si aplica.
	FirstAirDate string `json:"first_air_date"`
}

// Genre es un género de TMDB tal como viene en el detalle (id + nombre).
// En español: solo usamos el nombre para mostrarlo; el id no se necesita en esta fase.
type Genre struct {
	// Name es el nombre del género ya localizado (ej. "Drama", "Comedia").
	Name string `json:"name"`
}

// SpokenLanguage es un idioma hablado del título según TMDB.
// En español: tomamos el nombre en inglés ("english_name") porque es el más estable y legible
// entre idiomas; TMDB lo entrega siempre (ej. "Spanish", "English").
type SpokenLanguage struct {
	// EnglishName es el nombre del idioma en inglés (ej. "Spanish").
	EnglishName string `json:"english_name"`
}

// BelongsToCollection describe la saga/colección a la que pertenece una película.
// En español: TMDB solo expone esto en PELÍCULAS (las series no tienen equivalente). Puede venir
// como null si la película no pertenece a ninguna saga; en ese caso el puntero queda en nil.
type BelongsToCollection struct {
	// ID es el identificador de la colección, necesario para pedir su detalle con /collection/{id}.
	ID int `json:"id"`
	// Name es el nombre de la saga (ej. "Colección Toy Story").
	Name string `json:"name"`
	// PosterPath es la ruta del póster de la saga (relativa; se completa con BuildImageURL).
	PosterPath string `json:"poster_path"`
	// BackdropPath es la ruta de la imagen de fondo de la saga (relativa).
	BackdropPath string `json:"backdrop_path"`
}

// Video es un video asociado al título (tráiler, teaser, featurette...).
//
// En español: de aquí sale el "key" de YouTube de cada tráiler. Este molde recoge AHORA los diez
// campos que TMDB entrega, no cuatro. Antes se guardaban solo key/site/type/official y se tiraban el
// idioma, la región, el nombre, la resolución y la fecha — justo los datos que hacen falta para
// distinguir un tráiler mexicano de uno español. Se descartaban una línea antes de necesitarlos, así
// que ninguna corrección posterior podía funcionar: el dato ya no estaba.
type Video struct {
	// Key es el identificador del video en su plataforma (para YouTube, el id que va en la URL).
	Key string `json:"key"`
	// Site es la plataforma donde vive el video (nos interesa "YouTube").
	Site string `json:"site"`
	// Type es la clase de video ("Trailer", "Teaser", "Featurette"...).
	Type string `json:"type"`
	// Official indica si el video es oficial (publicado por el estudio/distribuidor).
	Official bool `json:"official"`
	// LanguageCode es el idioma del AUDIO en ISO 639-1 ("es", "en", "ja"...). Puede venir vacío.
	LanguageCode string `json:"iso_639_1"`
	// RegionCode es el país para el que se publicó el video, en ISO 3166-1 ("MX", "ES", "US"...).
	// En español: ESTE es el campo decisivo. TMDB guarda los videos en montones separados por
	// idioma+país; sin la región no hay forma de saber si un video en español es el doblaje mexicano
	// o el de España.
	RegionCode string `json:"iso_3166_1"`
	// Name es el título que le puso quien subió el video (ej. "Tráiler Oficial | Doblado").
	// En español: es la única pista disponible para saber si un video está doblado o subtitulado.
	Name string `json:"name"`
	// Size es la altura del video en píxeles (360, 480, 720, 1080, 2160): su resolución.
	Size int `json:"size"`
	// PublishedAt es la fecha de publicación en ISO con hora ("2026-07-21T16:00:24.000Z").
	// En español: sirve para preferir el tráiler más reciente entre dos igual de buenos (el último
	// suele ser el tráiler final, no el adelanto inicial).
	PublishedAt string `json:"published_at"`
}

// Videos envuelve la lista de videos que llega embebida vía append_to_response=videos.
// En español: TMDB anida los videos bajo una clave "videos" con su propio "results".
type Videos struct {
	// Results es la lista de videos del título.
	Results []Video `json:"results"`
}

// AggregateRole es UN personaje que interpreta un actor dentro de "aggregate_credits" de una serie.
//
// Por qué existe este molde, en español: TMDB entrega los créditos de una serie de forma DISTINTA a los
// de una película. En una película, cada actor trae su personaje en un campo suelto ("character"). En
// una serie, la misma persona puede haber hecho varios papeles a lo largo de las temporadas, así que
// TMDB agrupa a la persona una sola vez y le cuelga una LISTA de papeles, cada uno con el número de
// episodios en que salió con ese papel. Como el molde de datos solo conocía la forma de las películas,
// el personaje de cada actor de serie se descartaba al leer: 2.122 actores sin su personaje, el 100 % de
// las series del catálogo. Este molde es la mitad que faltaba.
type AggregateRole struct {
	// Character es el nombre del personaje (ej. "Tyrion 'The Halfman' Lannister").
	Character string `json:"character"`
	// EpisodeCount es en cuántos episodios apareció la persona con ESE papel concreto.
	EpisodeCount int `json:"episode_count"`
}

// AggregateJob es UN oficio que desempeña alguien del equipo técnico dentro de "aggregate_credits".
// En español: es el equivalente de AggregateRole para el equipo. Misma historia: en películas el oficio
// viene en un campo suelto ("job") y en series viene en una lista, porque una persona puede haber
// dirigido tres capítulos y escrito otros dos. Sin este molde se perdía la función de 1.869 técnicos.
type AggregateJob struct {
	// Job es el nombre del oficio (ej. "Director", "Production Design").
	Job string `json:"job"`
	// EpisodeCount es en cuántos episodios desempeñó ESE oficio concreto.
	EpisodeCount int `json:"episode_count"`
}

// CastMember es una persona del reparto (actores/actrices).
//
// En español: este molde sirve para las DOS formas en que TMDB entrega el reparto —la de las películas
// (con "character" suelto) y la de las series (con la lista "roles")— porque el mismo tipo se usa para
// deserializar ambas. El traductor (mapper.go) se queda con la que venga rellena; ver ResolveCastRole.
type CastMember struct {
	// ID es el número de identidad de la persona en TMDB. Es lo que permite reconocerla sin depender de
	// cómo esté escrito su nombre (ver el campo person_tmdb_id del contrato).
	ID int `json:"id"`
	// Name es el nombre de la persona.
	Name string `json:"name"`
	// Character es el personaje que interpreta (ej. "Margarita"). Lo rellena TMDB en PELÍCULAS.
	Character string `json:"character"`
	// Roles son los personajes que interpretó, con sus episodios. Lo rellena TMDB en SERIES
	// (aggregate_credits), donde "Character" viene vacío.
	Roles []AggregateRole `json:"roles"`
	// TotalEpisodeCount es el total de episodios en que aparece la persona (solo series). 0 en películas.
	TotalEpisodeCount int `json:"total_episode_count"`
	// KnownForDepartment es el área principal de la persona según TMDB (para el reparto suele ser
	// "Acting"). Se guarda como "department" del crédito para poder distinguir áreas sin leer textos.
	KnownForDepartment string `json:"known_for_department"`
	// ProfilePath es la ruta de la foto de la persona (relativa).
	ProfilePath string `json:"profile_path"`
	// Order es la posición en el reparto (0 = principal); sirve para priorizar el reparto destacado.
	Order int `json:"order"`
}

// CrewMember es una persona del equipo técnico (dirección, guion, fotografía…).
//
// En español: igual que CastMember, cubre las dos formas de TMDB. En películas el oficio llega en "Job";
// en series llega dentro de la lista "Jobs". Y —esto es lo que faltaba desde el principio— declara la
// ruta de su FOTO: el molde anterior no la tenía, así que el decodificador la tiraba a la basura al leer
// y las 3.429 personas del equipo del catálogo se quedaban sin cara. El comentario que había en el
// traductor decía que TMDB "no trae profile_path fiable en crew embebido"; se comprobó contra la API y
// es falso (en la película Alpha, 22 de 81 técnicos traen foto). Ese comentario se ha borrado.
type CrewMember struct {
	// ID es el número de identidad de la persona en TMDB (ver el campo person_tmdb_id del contrato).
	ID int `json:"id"`
	// Name es el nombre de la persona.
	Name string `json:"name"`
	// Job es la función concreta dentro de la producción (ej. "Director"). TMDB lo rellena en PELÍCULAS.
	Job string `json:"job"`
	// Jobs son los oficios que desempeñó, con sus episodios. TMDB lo rellena en SERIES
	// (aggregate_credits), donde "Job" viene vacío.
	Jobs []AggregateJob `json:"jobs"`
	// TotalEpisodeCount es el total de episodios en que trabajó la persona (solo series). 0 en películas.
	TotalEpisodeCount int `json:"total_episode_count"`
	// Department es el área a la que pertenece (ej. "Directing", "Writing"). TMDB la da en ambas formas.
	Department string `json:"department"`
	// ProfilePath es la ruta de la foto de la persona (relativa). TMDB SÍ la entrega, en ambas formas.
	ProfilePath string `json:"profile_path"`
}

// Credits envuelve reparto y equipo que llegan embebidos vía append_to_response=credits.
// En español: TMDB anida el reparto bajo "cast" y el equipo bajo "crew".
type Credits struct {
	// Cast es la lista del reparto (actores/actrices).
	Cast []CastMember `json:"cast"`
	// Crew es la lista del equipo técnico (dirección, guion...).
	Crew []CrewMember `json:"crew"`
}

// TranslationData es el contenido traducido de una ficha en UN idioma concreto.
// En español: de todo lo que TMDB traduce (título, eslogan, página web, sinopsis) aquí solo nos
// interesa la sinopsis, que es la que faltaba en uno de cada cuatro estrenos.
type TranslationData struct {
	// Overview es la sinopsis en ese idioma; puede venir vacía aunque la traducción exista.
	Overview string `json:"overview"`
}

// Translation es UNA traducción de la ficha: en qué idioma y para qué país está escrita.
// En español: TMDB no guarda "el español" como un solo bloque, sino separado por país (el español de
// México y el de España son dos traducciones distintas, escritas por gente distinta). Por eso hacen
// falta los dos códigos para elegir bien: primero el de México, luego cualquier otro español.
type Translation struct {
	// LanguageCode es el idioma en ISO 639-1 ("es", "en", "fr"…).
	LanguageCode string `json:"iso_639_1"`
	// CountryCode es el país en ISO 3166-1 ("MX", "ES", "US"…).
	CountryCode string `json:"iso_3166_1"`
	// Data es el contenido traducido (de aquí sacamos la sinopsis).
	Data TranslationData `json:"data"`
}

// Translations envuelve la lista de traducciones que llega embebida vía append_to_response=translations.
//
// Por qué se pide, en español: el catálogo se genera en español de México, y cuando TMDB no tiene esa
// traducción devuelve la sinopsis VACÍA — no cae al inglés por su cuenta. Eso dejaba 112 de 422 estrenos
// sin sinopsis, teniéndola. Pedir las traducciones EN LA MISMA LLAMADA que el detalle (en vez de hacer
// una segunda petición solo para los que faltan) sale gratis en número de peticiones y hace que el
// resultado no dependa de en qué orden se descubran los títulos.
type Translations struct {
	// Results es la lista de traducciones disponibles de la ficha. TMDB la anida bajo esta clave.
	Results []Translation `json:"translations"`
}

// ExternalIDs son los identificadores del título en OTROS servicios, tal como los da TMDB.
// En español: para las SERIES, el identificador de IMDb no viene en el detalle (a diferencia de las
// películas, que sí traen "imdb_id" suelto); hay que pedirlo aparte con append_to_response=external_ids.
// Sin él no se puede consultar OMDb, que es quien tiene las notas de IMDb, Rotten Tomatoes y Metacritic.
type ExternalIDs struct {
	// ImdbID es el identificador en IMDb (ej. "tt0944947"); vacío si TMDB no lo conoce.
	ImdbID string `json:"imdb_id"`
}

// WatchProvider es un proveedor donde se puede ver el título (Netflix, Max...).
// En español: solo necesitamos el nombre del proveedor para mostrarlo; TMDB lo entrega vía
// JustWatch (a quien también hay que atribuir según las reglas del proyecto).
type WatchProvider struct {
	// ProviderName es el nombre del proveedor (ej. "Netflix").
	ProviderName string `json:"provider_name"`
}

// WatchProvidersCountry son los proveedores de un país concreto (en este proyecto, MX).
// En español: TMDB separa los proveedores por tipo de oferta: "flatrate" (incluido en suscripción),
// "rent" (renta) y "buy" (compra). Para "dónde verlo" nos interesa sobre todo flatrate.
type WatchProvidersCountry struct {
	// Link es la URL de JustWatch con todas las opciones para ese país.
	Link string `json:"link"`
	// Flatrate son los proveedores incluidos en una suscripción (streaming "todo incluido").
	Flatrate []WatchProvider `json:"flatrate"`
	// Rent son los proveedores donde se renta el título.
	Rent []WatchProvider `json:"rent"`
	// Buy son los proveedores donde se compra el título.
	Buy []WatchProvider `json:"buy"`
}

// WatchProvidersResults agrupa los proveedores por país; aquí solo leemos México (MX).
// En español: TMDB indexa por código de país; el proyecto es es-MX, así que tomamos "MX".
type WatchProvidersResults struct {
	// MX son los proveedores disponibles en México (puede venir ausente si no hay datos).
	MX *WatchProvidersCountry `json:"MX"`
}

// WatchProviders envuelve los proveedores que llegan embebidos vía append_to_response.
// En español: la clave JSON real es "watch/providers" (con barra), por eso la etiqueta lo
// indica explícitamente; dentro viene "results" indexado por país.
type WatchProviders struct {
	// Results contiene los proveedores por país (solo usamos MX).
	Results WatchProvidersResults `json:"results"`
}

// ReleaseDateEntry es un evento concreto de estreno de una película en un país.
// En español: TMDB describe los estrenos por "tipo" (un número): 1=Premiere, 2=Limitado,
// 3=Theatrical (estreno en salas), 4=Digital, 5=Physical (físico), 6=TV. Con estos tipos sabemos
// si una película llegó realmente al cine (tipo 3) o si solo salió en digital/TV (tipos 4/6).
type ReleaseDateEntry struct {
	// Type es el tipo de estreno (3=cine, 4=digital, 6=TV...); ver lista arriba.
	Type int `json:"type"`
	// ReleaseDate es la fecha de ESE evento de estreno en ISO con hora (ej. "2026-05-14T00:00:00.000Z").
	// En español: es la fecha REAL de estreno en el país (MX). La usamos para ubicar la película en el
	// día correcto de la línea de tiempo, en vez de la "primary_release_date" global (que puede ser de
	// otro país/mes). Tomamos solo los primeros 10 caracteres (AAAA-MM-DD) al usarla.
	ReleaseDate string `json:"release_date"`
}

// CountryReleaseDates agrupa todos los eventos de estreno de una película en UN país.
// En español: TMDB separa los estrenos por país (código ISO, ej. "MX"); dentro de cada país hay
// una lista de eventos (sus tipos). Filtramos por "MX" para saber cómo se estrenó en México.
type CountryReleaseDates struct {
	// CountryCode es el código ISO 3166-1 del país (ej. "MX", "US").
	CountryCode string `json:"iso_3166_1"`
	// Dates son los eventos de estreno de ese país (cada uno con su tipo).
	Dates []ReleaseDateEntry `json:"release_dates"`
}

// ReleaseDatesAppend envuelve las fechas de estreno que llegan embebidas vía
// append_to_response=release_dates.
// En español: TMDB anida las fechas de estreno bajo una clave "release_dates" con su propio
// "results", una lista de países; el mapper usa esto para decidir la categoría (CINE vs STREAMING).
type ReleaseDatesAppend struct {
	// Results es la lista de estrenos por país (solo nos interesa el de MX).
	Results []CountryReleaseDates `json:"results"`
}

// MovieReleaseTypesForCountry devuelve los tipos de estreno de una película en un país dado.
// En español: recorre las fechas de estreno embebidas y, para el país pedido (ej. "MX"), junta
// todos los tipos de evento (3=cine, 4=digital, 6=TV...). Si el país no aparece, devuelve una lista
// vacía. El mapper usa esto para decidir si una película es de CINE o de STREAMING con datos fiables.
func MovieReleaseTypesForCountry(details *MovieDetails, countryCode string) []int {
	if details == nil {
		return nil
	}
	types := make([]int, 0)
	for _, country := range details.ReleaseDates.Results {
		if country.CountryCode != countryCode {
			continue
		}
		for _, entry := range country.Dates {
			types = append(types, entry.Type)
		}
	}
	return types
}

// MexicoReleaseDate devuelve la fecha de estreno REAL en México (AAAA-MM-DD) de una película.
// En español: la primary_release_date global de TMDB suele ser la de otro país y puede caer en un mes
// distinto al del estreno en MX, descuadrando la línea de tiempo. Aquí buscamos, dentro de los estrenos
// de MX, la fecha del evento más representativo según prioridad: CINE (3) > DIGITAL (4) > PREMIERE (1) >
// cualquier otro. Devuelve "" si MX no tiene fechas (el llamador cae a primary_release_date). Recorta a
// los primeros 10 caracteres (AAAA-MM-DD), descartando la parte de hora que trae TMDB.
func MexicoReleaseDate(details *MovieDetails) string {
	if details == nil {
		return ""
	}
	// Recolectamos las fechas de MX indexadas por tipo de estreno.
	datesByType := make(map[int]string)
	for _, country := range details.ReleaseDates.Results {
		if country.CountryCode != defaultRegion {
			continue
		}
		for _, entry := range country.Dates {
			if entry.ReleaseDate == "" {
				continue
			}
			// Conservamos la primera fecha vista de cada tipo (suele venir una por tipo).
			if _, exists := datesByType[entry.Type]; !exists {
				datesByType[entry.Type] = entry.ReleaseDate
			}
		}
	}
	if len(datesByType) == 0 {
		return ""
	}
	// Prioridad: cine (3) > digital (4) > premiere (1); si no, la del tipo MÁS BAJO disponible.
	for _, preferredType := range []int{3, 4, 1} {
		if date, ok := datesByType[preferredType]; ok {
			return trimISODate(date)
		}
	}
	// Último recurso: elegimos por número de tipo ascendente. En español: antes se iteraba el mapa
	// directamente, y el orden de iteración de un mapa en Go es ALEATORIO — dos corridas del seedgen
	// con los mismos datos podían dar fechas distintas (seed no reproducible). Ordenar por llave hace
	// la elección determinista.
	fallbackType := -1
	for releaseType := range datesByType {
		if fallbackType == -1 || releaseType < fallbackType {
			fallbackType = releaseType
		}
	}
	if fallbackType != -1 {
		return trimISODate(datesByType[fallbackType])
	}
	return ""
}

// trimISODate recorta una fecha ISO con hora ("2026-05-14T00:00:00.000Z") a solo "AAAA-MM-DD".
func trimISODate(isoDate string) string {
	const dateLength = 10
	if len(isoDate) < dateLength {
		return isoDate
	}
	return isoDate[:dateLength]
}

// MovieDetails es la respuesta de GET /movie/{id} con append_to_response.
// En español: este es el "expediente completo" de una película: sus datos básicos más los bloques
// embebidos (videos, créditos y proveedores) que pedimos en una sola llamada para no hacer varias.
type MovieDetails struct {
	// ID es el identificador de la película en TMDB.
	ID int `json:"id"`
	// ImdbID es el identificador de la película en IMDb (ej. "tt0114709"), que TMDB devuelve en
	// /movie/{id}. En español: es el "puente" hacia OMDb, que se consulta por IMDb ID para traer las
	// calificaciones extra (IMDb, Rotten Tomatoes, Metacritic). Puede venir vacío si TMDB no lo tiene.
	ImdbID string `json:"imdb_id"`
	// Title es el título localizado (es-MX) de la película.
	Title string `json:"title"`
	// Overview es la sinopsis localizada.
	Overview string `json:"overview"`
	// ReleaseDate es la fecha de estreno en formato ISO (AAAA-MM-DD).
	ReleaseDate string `json:"release_date"`
	// PosterPath es la ruta del póster (relativa; se completa con BuildImageURL).
	PosterPath string `json:"poster_path"`
	// BackdropPath es la ruta de la imagen de fondo (relativa).
	BackdropPath string `json:"backdrop_path"`
	// OriginalLanguage es el código del idioma original (ej. "en", "es").
	OriginalLanguage string `json:"original_language"`
	// VoteAverage es la calificación promedio de TMDB (0-10); base de la rareza derivada en cliente.
	VoteAverage float64 `json:"vote_average"`
	// Popularity es el índice de popularidad de TMDB (cuanto mayor, más vista/buscada). En español:
	// la usamos como señal para la heurística de cine INDIE: una película de baja popularidad con
	// géneros de autor (drama/documental) o en plataformas arthouse se clasifica como INDIE.
	Popularity float64 `json:"popularity"`
	// Genres son los géneros de la película (solo usamos su nombre).
	Genres []Genre `json:"genres"`
	// BelongsToCollection es la saga a la que pertenece, o nil si no pertenece a ninguna.
	BelongsToCollection *BelongsToCollection `json:"belongs_to_collection"`
	// SpokenLanguages son los idiomas hablados del título.
	SpokenLanguages []SpokenLanguage `json:"spoken_languages"`
	// Videos llega embebido vía append_to_response=videos (tráileres y demás).
	Videos Videos `json:"videos"`
	// Credits llega embebido vía append_to_response=credits (reparto y equipo).
	Credits Credits `json:"credits"`
	// WatchProviders llega embebido vía append_to_response=watch/providers (dónde verlo).
	WatchProviders WatchProviders `json:"watch/providers"`
	// ReleaseDates llega embebido vía append_to_response=release_dates: cómo se estrenó por país.
	// En español: de aquí sacamos los tipos de estreno de MX (cine/digital/TV) para la categoría.
	ReleaseDates ReleaseDatesAppend `json:"release_dates"`
	// Translations llega embebido vía append_to_response=translations: la sinopsis en todos los idiomas
	// en que existe. Es el plan B cuando la de español de México viene vacía (ver ResolveOverview).
	Translations Translations `json:"translations"`
}

// TVDetails es la respuesta de GET /tv/{id} con append_to_response (análogo a MovieDetails).
// En español: las series usan claves distintas a las películas: "name" en vez de "title" y
// "first_air_date" en vez de "release_date". Además NO tienen belongs_to_collection (las sagas
// solo existen en películas en TMDB). El reparto puede venir en "credits" o, para series, en
// "aggregate_credits" (créditos acumulados de todas las temporadas); leemos ambos y el mapper usa
// el que tenga datos.
type TVDetails struct {
	// ID es el identificador de la serie en TMDB.
	ID int `json:"id"`
	// Name es el nombre localizado de la serie (equivale a "title" en películas).
	Name string `json:"name"`
	// Overview es la sinopsis localizada.
	Overview string `json:"overview"`
	// FirstAirDate es la fecha de estreno del primer episodio (equivale a "release_date").
	FirstAirDate string `json:"first_air_date"`
	// PosterPath es la ruta del póster (relativa).
	PosterPath string `json:"poster_path"`
	// BackdropPath es la ruta de la imagen de fondo (relativa).
	BackdropPath string `json:"backdrop_path"`
	// OriginalLanguage es el código del idioma original (ej. "en").
	OriginalLanguage string `json:"original_language"`
	// VoteAverage es la calificación promedio de TMDB (0-10).
	VoteAverage float64 `json:"vote_average"`
	// Genres son los géneros de la serie (solo usamos su nombre).
	Genres []Genre `json:"genres"`
	// SpokenLanguages son los idiomas hablados de la serie.
	SpokenLanguages []SpokenLanguage `json:"spoken_languages"`
	// Videos llega embebido vía append_to_response=videos.
	Videos Videos `json:"videos"`
	// Credits llega embebido vía append_to_response=credits (reparto por episodio/principal).
	Credits Credits `json:"credits"`
	// AggregateCredits son los créditos acumulados de todas las temporadas (alternativa a Credits).
	AggregateCredits Credits `json:"aggregate_credits"`
	// WatchProviders llega embebido vía append_to_response=watch/providers (dónde verla).
	WatchProviders WatchProviders `json:"watch/providers"`
	// Networks son las cadenas/redes que EMITEN la serie (ej. "HBO", "Netflix", "AMC"). En español:
	// nos sirven para distinguir una serie de CADENA (emisión lineal) de una de STREAMING, y para
	// listar la cadena en "dónde verla" cuando no hay proveedor de suscripción en MX.
	Networks []Network `json:"networks"`
	// Seasons son las temporadas de la serie. En español: son el equivalente a la "saga" en series
	// (cada temporada es una entrada), para poblar el carrusel de saga con datos reales.
	Seasons []TVSeason `json:"seasons"`
	// Translations llega embebido vía append_to_response=translations (mismo plan B que en películas).
	Translations Translations `json:"translations"`
	// ExternalIDs llega embebido vía append_to_response=external_ids: aquí está el identificador de IMDb
	// de la serie, que el detalle de TV no trae suelto. Es el puente hacia OMDb.
	ExternalIDs ExternalIDs `json:"external_ids"`
}

// Network es una cadena/red que emite una serie (ej. "HBO", "Netflix", "AMC").
// En español: TMDB la entrega en /tv/{id}; usamos su nombre para clasificar CADENA vs STREAMING y
// para mostrarla como "dónde verla".
type Network struct {
	// Name es el nombre de la cadena/red.
	Name string `json:"name"`
}

// TVSeason es una temporada de una serie (entrada de su "saga").
// En español: de cada temporada usamos su nombre, su fecha de aire (para el año), su póster y su
// número (para descartar la temporada 0 = especiales).
type TVSeason struct {
	// Name es el nombre de la temporada (ej. "Temporada 1").
	Name string `json:"name"`
	// AirDate es la fecha de estreno de la temporada en ISO (AAAA-MM-DD); de aquí sale el año.
	AirDate string `json:"air_date"`
	// PosterPath es la ruta del póster de la temporada (relativa).
	PosterPath string `json:"poster_path"`
	// SeasonNumber es el número de temporada (0 = especiales; las reales empiezan en 1).
	SeasonNumber int `json:"season_number"`
	// Overview es la sinopsis de la temporada (para su modal propio).
	Overview string `json:"overview"`
	// EpisodeCount es cuántos episodios tiene la temporada (para mostrar "N episodios").
	EpisodeCount int `json:"episode_count"`
	// VoteAverage es la calificación TMDB (0-10) de la temporada.
	VoteAverage float64 `json:"vote_average"`
}

// ImageList es la respuesta de GET /movie/{id}/images o /tv/{id}/images.
// En español: la galería de imágenes del título. Solo usamos los "backdrops" (escenas/fondos
// horizontales) para la galería de la ficha; cada uno trae su ruta relativa (file_path).
type ImageList struct {
	// Backdrops son las imágenes de fondo (escenas) del título.
	Backdrops []ImageFile `json:"backdrops"`
}

// ImageFile es una imagen individual de la galería (solo su ruta relativa).
type ImageFile struct {
	// FilePath es la ruta relativa de la imagen (se completa con BuildImageURL).
	FilePath string `json:"file_path"`
}

// Collection es la respuesta de GET /collection/{id}: el detalle completo de una saga.
// En español: con el id que viene en belongs_to_collection se pide esta llamada para conocer todas
// las entradas (películas) de la saga y mapearlas a los CollectionItem del modelo.
type Collection struct {
	// ID es el identificador de la colección en TMDB.
	ID int `json:"id"`
	// Name es el nombre de la saga.
	Name string `json:"name"`
	// Parts son las entradas (películas) que componen la saga.
	Parts []CollectionPart `json:"parts"`
}

// CollectionPart es una entrada (película) dentro de una saga.
// En español: de cada entrada usamos su título, su fecha (de la que sacamos el año) y su póster.
type CollectionPart struct {
	// Title es el título de la película de la saga.
	Title string `json:"title"`
	// ReleaseDate es la fecha de estreno en ISO (AAAA-MM-DD); de aquí sale el año mostrado.
	ReleaseDate string `json:"release_date"`
	// PosterPath es la ruta del póster de la entrada (relativa).
	PosterPath string `json:"poster_path"`
	// Overview es la sinopsis de la película de la saga (para su modal propio).
	Overview string `json:"overview"`
	// BackdropPath es la ruta de la imagen de fondo de la entrada (relativa; para su modal).
	BackdropPath string `json:"backdrop_path"`
	// VoteAverage es la calificación TMDB (0-10) de la entrada.
	VoteAverage float64 `json:"vote_average"`
}

// SeasonDetails es la respuesta de GET /tv/{id}/season/{n}: la temporada con sus episodios.
// En español: es la fuente de las FECHAS REALES de emisión de cada episodio, con las que la
// herramienta schedulegen arma el calendario (Schedule) de cada serie del seed.
type SeasonDetails struct {
	// SeasonNumber es el número de la temporada consultada (0 = especiales).
	SeasonNumber int `json:"season_number"`
	// Episodes son los episodios de la temporada, cada uno con su fecha de emisión.
	Episodes []TVEpisode `json:"episodes"`
}

// TVEpisode es UN episodio de una temporada, con su fecha real de emisión.
type TVEpisode struct {
	// Name es el nombre del episodio (puede venir vacío en títulos poco documentados).
	Name string `json:"name"`
	// AirDate es la fecha de emisión en ISO (AAAA-MM-DD); vacía si TMDB aún no la conoce.
	AirDate string `json:"air_date"`
	// SeasonNumber es el número de temporada al que pertenece.
	SeasonNumber int `json:"season_number"`
	// EpisodeNumber es el número del episodio dentro de la temporada (1+).
	EpisodeNumber int `json:"episode_number"`
}
