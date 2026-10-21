// Archivo: channels_test.go — Pruebas de la clasificación del canal de YouTube.
//
// En español: esta clasificación es una lista mantenida a mano, así que lo que se prueba aquí no es
// que "acierte siempre" (no puede: no existe ninguna fuente que diga a qué empresa pertenece un
// canal), sino que las reglas se aplican en el orden correcto y que lo desconocido cae en su sitio
// sin romper nada.

package main

import (
	"testing"

	catalogv1 "mdm7mo/gen/mdm7mo/catalog/v1"
)

// TestClassifyChannelRecognisesRealChannels usa nombres REALES observados en el catálogo.
// En español: todos estos nombres salieron de consultar oEmbed sobre tráilers del catálogo de verdad.
// No son ejemplos inventados: son los canales que el proyecto se encuentra de hecho.
func TestClassifyChannelRecognisesRealChannels(t *testing.T) {
	t.Parallel()

	cases := []struct {
		channelName string
		want        catalogv1.ChannelKind
	}{
		// Estudios y distribuidoras.
		{channelName: "Pixar", want: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
		{channelName: "Warner Bros. Pictures", want: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
		{channelName: "20th Century Studios", want: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
		{channelName: "Paramount Pictures", want: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
		// Con acento y en minúsculas: la normalización tiene que dar igual resultado.
		{channelName: "Cinépolis Distribución", want: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
		// Canales SIN espacios y con acento: así es como se llaman de verdad en el catálogo actual.
		// "DiamondFilmsLatam" es la distribuidora que publica la mayoría de los tráilers mexicanos.
		{channelName: "DiamondFilmsLatam", want: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
		{channelName: "SonyPicturesMéxico", want: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
		{channelName: "ParisFilmes", want: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
		{channelName: "Pathé Cinémas", want: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},
		{channelName: "Disney España", want: catalogv1.ChannelKind_CHANNEL_KIND_DISTRIBUTOR},

		// Plataformas de streaming.
		{channelName: "Netflix", want: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
		{channelName: "Prime Video", want: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
		{channelName: "Crunchyroll en Español", want: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
		{channelName: "Apple México", want: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
		{channelName: "STARZ", want: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},
		{channelName: "FX Networks", want: catalogv1.ChannelKind_CHANNEL_KIND_PLATFORM},

		// Cine indie, casas de arte y festivales.
		{channelName: "Curzon", want: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
		{channelName: "MUBI", want: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
		{channelName: "Independent Film Company", want: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
		{channelName: "Melbourne Queer Film Festival", want: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},
		{channelName: "Film at Lincoln Center", want: catalogv1.ChannelKind_CHANNEL_KIND_INDIE},

		// Recopiladores: el motivo de que la petición del dueño pidiera el tráiler "crudo".
		{channelName: "TV Promos", want: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
		{channelName: "KinoCheck International", want: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
		{channelName: "CineTrailer", want: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
		// "Trailer Ñ" se normaliza a "trailer n": la regla lleva un espacio final para no encajar
		// dentro de nombres que solo empiecen igual.
		{channelName: "Trailer Ñ", want: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},
		{channelName: "SóTrailers", want: catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR},

		// Canales que no están en la lista: se admite no saber. UNSPECIFIED baja la prioridad del
		// video sin excluirlo, que es exactamente el comportamiento honesto.
		{channelName: "Finn Animator 16", want: catalogv1.ChannelKind_CHANNEL_KIND_UNSPECIFIED},
		{channelName: "Nimble Division", want: catalogv1.ChannelKind_CHANNEL_KIND_UNSPECIFIED},
		{channelName: "", want: catalogv1.ChannelKind_CHANNEL_KIND_UNSPECIFIED},
	}

	for _, testCase := range cases {
		if got := classifyChannel(testCase.channelName); got != testCase.want {
			t.Errorf("classifyChannel(%q) = %v, want %v", testCase.channelName, got, testCase.want)
		}
	}
}

// TestClassifyChannelPrefersAggregatorOverBrandName verifica el ORDEN de las reglas.
// En español: un canal de aficionados puede llamarse "Sony Pictures Trailers HD" y contener el nombre
// de un estudio sin serlo. Como las reglas de recopilador van primero en la lista, gana la de
// recopilador. Si algún día alguien reordena la lista, esta prueba lo detiene.
func TestClassifyChannelPrefersAggregatorOverBrandName(t *testing.T) {
	t.Parallel()

	got := classifyChannel("Sony Pictures Movieclips Fan")
	if got != catalogv1.ChannelKind_CHANNEL_KIND_AGGREGATOR {
		t.Errorf("classifyChannel = %v, want AGGREGATOR: the aggregator rules must be checked first", got)
	}
}

// TestNormalizeChannelNameStripsAccentsAndCase verifica la normalización del nombre.
// En español: hace comparables "Cinépolis" y "cinepolis". Sin esto, una tilde bastaría para que un
// canal conocido quedara sin clasificar.
func TestNormalizeChannelNameStripsAccentsAndCase(t *testing.T) {
	t.Parallel()

	cases := []struct {
		channelName string
		want        string
	}{
		{channelName: "  Cinépolis Distribución  ", want: "cinepolis distribucion"},
		{channelName: "Crunchyroll en Español", want: "crunchyroll en espanol"},
		{channelName: "WARNER BROS.", want: "warner bros."},
		{channelName: "", want: ""},
	}
	for _, testCase := range cases {
		if got := normalizeChannelName(testCase.channelName); got != testCase.want {
			t.Errorf("normalizeChannelName(%q) = %q, want %q", testCase.channelName, got, testCase.want)
		}
	}
}
