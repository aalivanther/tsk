// Archivo: rarity.ts — ESPEJO en TypeScript del paquete Go internal/rarity (rareza de un estreno).
// En español: a cada película o serie le ponemos una "rareza" tipo videojuego —legendary, epic,
// rare o common— según su calificación de TMDB (un número de 0 a 10). Esa rareza NO se guarda en
// ningún lado: se CALCULA siempre a partir de la calificación, y aquí, en el frontend, se usa de
// forma VISUAL (el marco dorado de las cards legendarias, etc.).
//
// FUENTE CANÓNICA: el paquete Go `backend/internal/rarity` (rarity.go) es la ÚNICA fuente de verdad
// de los umbrales 8.5 / 7.5 / 6.5 y de la regla de comparación ">=". Este archivo es un ESPEJO EXACTO
// de aquel: si allá cambian los umbrales, AQUÍ deben cambiarse igual para no divergir. No inventes
// cortes nuevos en este lado; sincroniza siempre contra el Go.

// Tier es la categoría de rareza de un estreno (su "nivel" tipo videojuego).
// En español: es una etiqueta de texto con uno de cuatro valores fijos. Usar una unión de literales
// (no un string suelto) hace que el compilador ayude a no escribir un valor inválido por error. Los
// textos ("legendary", "epic"...) coinciden EXACTAMENTE con los del paquete Go, porque son los que
// viajan entre backend y frontend y deben quedar estables.
export type Tier = "legendary" | "epic" | "rare" | "common";

// Estos umbrales son los CORTES de calificación TMDB que separan una rareza de la siguiente.
// En español: son el espejo de los umbrales del paquete Go. Se comparan con la calificación de TMDB
// (0 a 10) usando "mayor o igual que". Son AJUSTABLES, pero el lugar donde se ajustan de verdad es
// el Go (fuente canónica); aquí solo se replica el mismo valor.

// THRESHOLD_LEGENDARY: a partir de 8.5 (inclusive) un estreno es "legendary". Espeja al Go.
const THRESHOLD_LEGENDARY = 8.5;
// THRESHOLD_EPIC: a partir de 7.5 (inclusive) y por debajo de 8.5 es "epic". Espeja al Go.
const THRESHOLD_EPIC = 7.5;
// THRESHOLD_RARE: a partir de 6.5 (inclusive) y por debajo de 7.5 es "rare". Espeja al Go.
const THRESHOLD_RARE = 6.5;

// deriveRarity calcula la rareza de un estreno a partir de su calificación de TMDB.
// En español: recibe el número de TMDB (ratings.tmdb, de 0 a 10) y devuelve el nivel que le toca. La
// comparación es por "mayor o igual": justo en el umbral, sube de nivel. Es el espejo exacto de la
// función Derive del paquete Go:
//   - 8.5 o más     -> "legendary"
//   - de 7.5 a 8.49 -> "epic"
//   - de 6.5 a 7.49 -> "rare"
//   - menos de 6.5  -> "common" (incluye 0, que es el caso "sin calificación")
export function deriveRarity(tmdb: number): Tier {
  if (tmdb >= THRESHOLD_LEGENDARY) {
    return "legendary";
  }
  if (tmdb >= THRESHOLD_EPIC) {
    return "epic";
  }
  if (tmdb >= THRESHOLD_RARE) {
    return "rare";
  }
  return "common";
}
