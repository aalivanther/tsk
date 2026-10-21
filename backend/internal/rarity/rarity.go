// Package rarity es la FUENTE ÚNICA DE VERDAD de la "rareza" de un estreno en el proyecto.
// En español: a cada película o serie le asignamos una "rareza" tipo videojuego —legendary, epic,
// rare o common— según lo buena que sea. Esa rareza NO se guarda en ningún lado (el contrato
// catalog.proto deja claro que la rareza no se persiste): se CALCULA siempre a partir de la
// calificación de TMDB (ratings.tmdb, un número de 0 a 10). Este paquete concentra los umbrales y
// la regla de cálculo en un solo lugar, para que backend y cualquier otra pieza usen exactamente
// los mismos cortes y nunca diverjan. Si mañana se quieren ajustar los umbrales, se cambian aquí
// (y solo aquí).
//
// NOTA de integración (frontera registrada, no código muerto): en Fase 0 la rareza se aplica
// VISUALMENTE en el frontend (marcos de las cards y del video héroe), por eso el cálculo "en vivo"
// vive del lado del cliente (TypeScript), tal como dice catalog.proto. Este paquete Go es la fuente
// canónica de los umbrales 8.5 / 7.5 / 6.5: cuando el frontend implemente su propio `deriveRarity`
// (Sprint 5+), DEBE espejar exactamente estos cortes con comparación ">=" para no divergir. Por eso
// hoy el paquete aún no tiene un consumidor en Go: es deliberado, su rol es ser la referencia única.
package rarity

// Tier es la categoría de rareza de un estreno (su "nivel" tipo videojuego).
// En español: es una etiqueta de texto con uno de cuatro valores fijos. Usamos un tipo propio (no
// un string suelto) para que el compilador ayude a no confundir esta etiqueta con cualquier texto.
type Tier string

// Estas constantes son los CUATRO valores válidos de rareza, de mayor a menor calidad.
// En español: cada estreno cae en exactamente uno de estos niveles. Los valores de texto
// ("legendary", "epic"...) son los que viajan al frontend, así que deben quedar estables.
const (
	// TierLegendary es la rareza máxima: estrenos excelentes (calificación TMDB altísima).
	TierLegendary Tier = "legendary"
	// TierEpic es la segunda rareza: estrenos muy buenos.
	TierEpic Tier = "epic"
	// TierRare es la tercera rareza: estrenos buenos/notables.
	TierRare Tier = "rare"
	// TierCommon es la rareza base: todo lo demás (incluye lo sin calificación o con calificación baja).
	TierCommon Tier = "common"
)

// Estos umbrales son los CORTES de calificación TMDB que separan una rareza de la siguiente.
// En español: son la FUENTE ÚNICA DE VERDAD de los umbrales de rareza del proyecto. Se comparan
// con la calificación de TMDB (0 a 10) usando "mayor o igual que". Son AJUSTABLES: si se quiere
// hacer más exigente o más laxa la rareza, se modifican estos números aquí (y solo aquí), porque
// es el único lugar del que depende todo el cálculo.
const (
	// ThresholdLegendary: a partir de 8.5 (inclusive) un estreno es "legendary". Ajustable.
	ThresholdLegendary float64 = 8.5
	// ThresholdEpic: a partir de 7.5 (inclusive) y por debajo de 8.5 es "epic". Ajustable.
	ThresholdEpic float64 = 7.5
	// ThresholdRare: a partir de 6.5 (inclusive) y por debajo de 7.5 es "rare". Ajustable.
	ThresholdRare float64 = 6.5
)

// Derive calcula la rareza de un estreno a partir de su calificación de TMDB.
// En español: recibe el número de TMDB (ratings.tmdb, de 0 a 10) y devuelve el nivel de rareza que
// le corresponde. La comparación es por "mayor o igual": justo en el umbral, sube de nivel. Así:
//   - 8.5 o más     -> legendary
//   - de 7.5 a 8.49 -> epic
//   - de 6.5 a 7.49 -> rare
//   - menos de 6.5  -> common (incluye 0, que es el caso "sin calificación")
//
// Esta es la única regla de rareza del proyecto: la rareza se DERIVA siempre de ratings.tmdb y no
// se guarda en ninguna parte (coherente con catalog.proto, que no persiste la rareza).
func Derive(tmdb float64) Tier {
	switch {
	case tmdb >= ThresholdLegendary:
		return TierLegendary
	case tmdb >= ThresholdEpic:
		return TierEpic
	case tmdb >= ThresholdRare:
		return TierRare
	default:
		return TierCommon
	}
}
