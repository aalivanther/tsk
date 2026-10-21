// Archivo: channels.go — Clasificación del CANAL de YouTube que publicó cada video.
//
// En español: cuando alguien elige "inglés" en su perfil, lo que pidió el dueño del proyecto es el
// tráiler "crudo" de la distribuidora, no el mismo tráiler recortado y republicado por un canal
// recopilador. Para poder cumplirlo hay que saber QUIÉN subió cada video. TMDB no lo dice; oEmbed de
// YouTube sí (devuelve el nombre del canal). Este archivo convierte ese nombre en una de cuatro
// categorías: distribuidora, plataforma de streaming, casa indie/festival o recopilador.
//
// AVISO DE HONESTIDAD, escrito aquí para que nadie lo descubra por sorpresa: NO EXISTE ninguna API
// pública y gratuita que diga a qué empresa pertenece un canal de YouTube. Esta clasificación es, y
// va a seguir siendo, una LISTA MANTENIDA A MANO. Un canal nuevo o pequeño no estará en ella y caerá
// en "sin clasificar", que en la cadena de elección va por debajo de los conocidos pero por encima de
// los recopiladores. Es decir: no saber quién es un canal degrada su prioridad, nunca rompe nada.

package main

import (
	"strings"
	"unicode"

	// norm da la normalización Unicode (NFD), con la que separamos cada letra de su acento para poder
	// comparar "Cinépolis" y "cinepolis" como el mismo texto.
	"golang.org/x/text/unicode/norm"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// channelRule empareja un TROZO de nombre de canal con la categoría que le corresponde.
//
// En español: se compara por "contiene", no por igualdad exacta, porque los canales usan mil
// variantes del mismo nombre ("Crunchyroll", "Crunchyroll en Español", "Crunchyroll Collection"). Un
// trozo bien elegido las cubre todas de una vez.
type channelRule struct {
	// token es el trozo de nombre a buscar, ya en minúsculas y sin acentos.
	token string
	// kind es la categoría que se asigna cuando el nombre del canal contiene ese trozo.
	kind catalogv1.ChannelKind
}

// channelRules es la lista mantenida a mano, EN ORDEN DE PRIORIDAD.
//
// El orden importa de verdad: se recorre de arriba abajo y gana la primera regla que encaje. Por eso
// los recopiladores van PRIMERO — un canal llamado "Sony Pictures Trailers Fan" contiene "sony", pero
// también contiene la marca de recopilador, y queremos que pese más lo segundo. Después van las casas
// indie y los festivales (que son más específicos), luego las plataformas y al final los estudios.
var channelRules = []channelRule{
	// --- Recopiladores, canales de aficionados y agregadores de tráilers -----------------------
	// En español: republican material de otros. Suelen recortar, poner locución encima o marca de
	// agua, y a menudo el video ni siquiera está en el idioma que anuncia el título. Son el último
	// recurso de la cadena, y solo si TMDB los marcó como oficiales.
	{token: "tv promos", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "movieclips", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "kinocheck", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "filmselect", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "filmisnow", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "joblo", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "rapid trailer", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "zero media", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "one media", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "trailer city", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "trailers en espanol", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "movie trailers source", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "new trailer buzz", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "coming soon trailers", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "screen rant", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "rotten tomatoes", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: " ign ", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "fandango", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "flixmedia", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	// Recopiladores vistos en el catálogo real de este proyecto (aparecen decenas de veces).
	{token: "cinetrailer", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "sotrailers", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	{token: "filmsactu", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
	// "Trailer Ñ" queda como "trailer n" al quitarle la tilde; el espacio final evita que este trozo
	// encaje dentro de palabras que empiecen igual.
	{token: "trailer n ", kind: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},

	// --- Festivales y muestras de cine -----------------------------------------------------------
	// En español: publican los tráilers de las películas que programan. Son fuente legítima para el
	// cine de autor, que muchas veces no tiene otro canal donde vivir.
	{token: "film festival", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "festival de cine", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "filmfest", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "sundance", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "berlinale", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "festival de cannes", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "locarno", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "venice film", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "sxsw", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "film at lincoln center", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},

	// --- Distribuidoras independientes y casas de arte --------------------------------------------
	{token: " a24", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "mubi", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: " neon", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "curzon", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "janus films", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "criterion", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "ifc films", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "magnolia pictures", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "kino lorber", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "bleecker street", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "oscilloscope", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "strand releasing", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "film movement", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "grasshopper film", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: " sideshow", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: " utopia", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "vinegar syndrome", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "arrow video", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: " bfi ", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "independent film company", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "cine canibal", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "interior xiii", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "la ola cine", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "piano distribucion", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "avalon distribucion", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "elastica films", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "wanda vision", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
	{token: "golem", kind: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},

	// --- Plataformas de streaming ------------------------------------------------------------------
	// En español: publican sus propios estrenos. Son fuente oficial y de calidad, pero por debajo del
	// estudio cuando ambos tienen el mismo tráiler, porque la plataforma suele añadir su cabecera.
	{token: "netflix", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "prime video", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "amazon prime", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "disney+", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "disney plus", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "hbo max", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: " max ", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "hbo", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "apple tv", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "hulu", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "peacock", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "paramount+", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "paramount plus", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "crunchyroll", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "shudder", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: " vix", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "star+", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "movistar plus", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "skyshowtime", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "claro video", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "filmin", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "atresplayer", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "rtve", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	// Canales regionales de Apple (Apple México, Apple Brasil, Apple España, Apple France): son la
	// misma plataforma con una cuenta por país. El espacio final evita encajar dentro de otra palabra.
	{token: "apple ", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	// Cadenas de televisión con canal propio, que publican los tráilers de sus series.
	{token: " amc", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "starz", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "adult swim", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "fx networks", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: " cbs ", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: " abc ", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: " nbc ", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "showtime", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "tv asahi", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
	{token: "globoplay", kind: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},

	// --- Estudios y distribuidoras grandes ---------------------------------------------------------
	{token: "warner bros", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "warnerbros", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "universal pictures", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "sony pictures", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "columbia pictures", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "paramount pictures", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "20th century", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "searchlight", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "walt disney", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "pixar", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "marvel", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "lucasfilm", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "dreamworks", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "illumination", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "lionsgate", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "focus features", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "blumhouse", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "legendary", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "new line cinema", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "metro goldwyn", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "amblin", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "studiocanal", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "entertainment one", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: " stx", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: " toho", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "aniplex", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: " toei", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "gkids", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "diamond films", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "videocine", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "corazon films", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "cinepolis", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "sun distribution", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "bf distribution", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: " eone", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "vertigo films", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "tripictures", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "dear studios", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "a contracorriente", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	// Variantes SIN ESPACIOS, que es como muchas distribuidoras nombran su canal de YouTube
	// ("DiamondFilmsLatam", "SonyPicturesMéxico"). Sin estas líneas, la distribuidora más importante
	// del catálogo mexicano caía en "sin clasificar" por no llevar un espacio.
	{token: "diamondfilms", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "sonypictures", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "warnerbrospictures", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	// Distribuidoras observadas en el catálogo real (México, Brasil, Francia, Reino Unido, Japón).
	{token: "disney", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "parisfilmes", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "pathe", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "black bear", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "madman films", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "metropolitan films", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "entertainment film distributors", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: " laika", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "vvs films", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "gaumont", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "le pacte", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "ad vitam", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "arp selection", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
	{token: "sony pictures", kind: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
}

// classifyChannel decide a qué categoría pertenece un canal de YouTube por su NOMBRE.
//
// En español: normaliza el nombre (minúsculas, sin acentos) y busca, en orden, el primer trozo
// conocido que contenga. Si no reconoce ninguno, devuelve "sin clasificar" — que no es un error, es
// la respuesta honesta: no sabemos quién es ese canal. Un nombre vacío (porque oEmbed no lo dio)
// también cae ahí.
func classifyChannel(channelName string) catalogv1.ChannelKind {
	normalized := normalizeChannelName(channelName)
	if normalized == "" {
		return catalogv1.ChannelKind_CHANNEL_KIND_UNSPECIFIED
	}
	// Rodeamos el nombre de espacios para que las reglas puedan exigir PALABRA COMPLETA cuando hace
	// falta. Una sigla de tres letras como "ign" o "abc" encajaría dentro de un montón de palabras
	// inocentes ("Foreign Films" contiene "ign"), y clasificar mal un canal cambia qué tráiler ve la
	// gente. Esas reglas se escriben con sus espacios (" ign ") y solo encajan si son la palabra entera.
	padded := " " + normalized + " "
	for _, rule := range channelRules {
		if strings.Contains(padded, rule.token) {
			return rule.kind
		}
	}
	return catalogv1.ChannelKind_CHANNEL_KIND_UNSPECIFIED
}

// normalizeChannelName deja el nombre de un canal en minúsculas, sin acentos y sin espacios de sobra.
// En español: hace comparables "Cinépolis Distribución" y "cinepolis distribucion". Separa cada letra
// de su acento con la normalización NFD y descarta las marcas de acento, quedándose con la letra base.
func normalizeChannelName(channelName string) string {
	decomposed := norm.NFD.String(strings.ToLower(strings.TrimSpace(channelName)))
	var builder strings.Builder
	for _, character := range decomposed {
		// Marca combinante (el acento que NFD separó de su letra): se descarta.
		if unicode.Is(unicode.Mn, character) {
			continue
		}
		builder.WriteRune(character)
	}
	return builder.String()
}
