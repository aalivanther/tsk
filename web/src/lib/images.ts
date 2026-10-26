// Archivo: images.ts — Pedir a TMDB imágenes del TAMAÑO que de verdad se van a mostrar.
//
// En español: TMDB sirve cada imagen en varios tamaños, y la URL dice cuál se pide:
//
//   https://image.tmdb.org/t/p/w1280/abc.jpg
//                            ^^^^^ el tamaño
//
// El catálogo guarda los pósters a w500 y los fondos a w1280, que son buenos tamaños para una
// pantalla grande. El problema aparece en el teléfono: la fila de la agenda mide unos 310 píxeles de
// ancho, y aun así estaba descargando una imagen de 1280. Eso es más de cuatro veces el peso
// necesario, multiplicado por cada fila visible — justo en el dispositivo donde la conexión suele ser
// peor y los datos se pagan.
//
// Este archivo resuelve eso reescribiendo el tamaño de la URL antes de pedirla. No inventa imágenes
// ni cambia de proveedor: solo pide la variante adecuada de la MISMA imagen. Si la URL no es de TMDB
// (o tiene una forma inesperada), se devuelve intacta: nunca se rompe una imagen por optimizarla.

// TmdbImageSize son los tamaños de TMDB que usa este producto, nombrados por su propósito.
// En español: se limita a un puñado en vez de exponer el catálogo completo de TMDB, para que en el
// código se elija por INTENCIÓN ("miniatura", "tarjeta") y no por un número suelto.
export type TmdbImageSize =
  | "tiny" // Carátulas diminutas: el anticipo de cada día en la línea de tiempo.
  | "thumb" // Miniaturas y banners de fila en móvil.
  | "card" // Pósters de tarjeta y carruseles.
  | "wide" // Fondos anchos de tarjeta y modales.
  | "hero"; // Fondo a pantalla completa.

// TMDB_SIZE_SEGMENT traduce cada propósito al segmento real de la URL de TMDB.
// Los valores son tamaños que TMDB ofrece de verdad; pedir uno inexistente devolvería un 404.
const TMDB_SIZE_SEGMENT: Record<TmdbImageSize, string> = {
  // "tiny" existe por una razón medible: el anticipo de la línea de tiempo pinta carátulas de 34
  // píxeles de ancho, y pedirlas en el tamaño de miniatura (342) significaba descargar una imagen
  // diez veces más ancha de lo que se ve. Multiplicado por el centenar de carátulas que hay a la
  // vista al abrir, era tráfico y memoria regalados.
  //
  // La cuenta de por qué w92 y no w154: la carátula se pinta a 34 px de ancho; en una pantalla de
  // DOBLE densidad (la de un teléfono o un portátil moderno) eso son 68 píxeles reales. w92 entrega
  // 92, así que todavía sobra un 35% de nitidez. w154 entregaba un 126% de sobra, y esa sobra no se
  // ve: se paga. Medido sobre 20 carátulas reales del catálogo, w92 pesa un 56,6% menos que w154
  // (6.202 bytes de media frente a 14.280), lo que en la portada —donde se descargan unas 115—
  // significa cerca de 620 KB que dejan de viajar por la red.
  tiny: "w92",
  thumb: "w342",
  card: "w500",
  wide: "w780",
  hero: "w1280",
};

// TMDB_PATH_PATTERN reconoce la parte de la URL que indica el tamaño.
// En español: busca "/t/p/" seguido del tamaño y captura lo que va antes y después para poder
// recomponer la URL cambiando solo esa pieza.
const TMDB_PATH_PATTERN = /^(https:\/\/image\.tmdb\.org\/t\/p\/)([^/]+)(\/.+)$/;

// tmdbImage devuelve la misma imagen en el tamaño pedido.
// Si la URL viene vacía, no es de TMDB o no tiene la forma esperada, se devuelve tal cual: es
// preferible una imagen algo más pesada que una imagen rota.
export function tmdbImage(url: string, size: TmdbImageSize): string {
  if (!url) {
    return url;
  }
  const match = TMDB_PATH_PATTERN.exec(url);
  if (match === null) {
    return url;
  }
  const [, prefix, , path] = match;
  return `${prefix}${TMDB_SIZE_SEGMENT[size]}${path}`;
}

// isTmdbImage indica si una URL apunta al servidor de imágenes de TMDB.
// En español: lo usan las piezas que deciden si merece la pena intentar ajustar el tamaño.
export function isTmdbImage(url: string): boolean {
  return TMDB_PATH_PATTERN.test(url);
}

// TmdbWidth son los anchos exactos que TMDB sirve (pósters: w92…w780; fondos: w300, w780, w1280).
// En español: los tamaños por propósito de arriba bastan para elegir UNA variante; para dar al
// navegador varias según la densidad de la pantalla hace falta nombrar el ancho exacto.
export type TmdbWidth = "w92" | "w154" | "w185" | "w300" | "w342" | "w500" | "w780" | "w1280";

// TmdbDensityCandidate es una variante para una densidad: "en pantallas de hasta N× usa este ancho".
export type TmdbDensityCandidate = readonly [width: TmdbWidth, density: 1 | 2 | 3];

// tmdbImageAt devuelve la misma imagen en un ancho exacto de TMDB (misma regla de seguridad que
// tmdbImage: si la URL no es de TMDB, se devuelve tal cual).
export function tmdbImageAt(url: string, width: TmdbWidth): string {
  if (!url) {
    return url;
  }
  const match = TMDB_PATH_PATTERN.exec(url);
  if (match === null) {
    return url;
  }
  const [, prefix, , path] = match;
  return `${prefix}${width}${path}`;
}
