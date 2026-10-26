// Archivo: timeline.ts — Helpers PUROS de la línea de tiempo (la feature héroe del S6).
//
// En español: aquí viven las funciones "de cálculo" que la línea de tiempo necesita,
// SIN nada de interfaz ni de navegador. Son puras: para la misma entrada siempre
// devuelven la misma salida, no tocan el DOM, no leen la hora del sistema ni la zona
// horaria del usuario, no guardan estado. Esto las hace fáciles de leer, de probar y
// de reutilizar tanto en el servidor como en el cliente.
//
// Su trabajo es transformar la lista cruda de estrenos (el modelo ReleaseSummary que viene del
// backend) en la ESTRUCTURA que el componente Timeline dibuja: por mes, por día y, dentro
// de cada día, "paquetes" agrupados por categoría (Cine / Streaming / Cadenas). También
// portan, tal cual, los gradientes de marcador (placeholder) del cascarón v3, porque en
// Fase 0 los pósters/backdrops vienen vacíos y se sustituyen por degradados deterministas.

import { type CSSProperties } from "react";

import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";
import { Category, TitleType } from "@/lib/catalog-enums";
import { isTmdbImage, tmdbImageAt, type TmdbDensityCandidate } from "@/lib/images";
import { personIdentityKeySet, sharesAnyPerson } from "@/lib/person-identity";
import { ui } from "@/lib/i18n";

// MEXICO_CITY_TIME_ZONE es la zona horaria del producto (es-MX), usada para fechas "de hoy".
// En español: el público es de México; calcular "hoy" en esta zona (no en UTC) evita que el día se
// "corra" por la tarde. Se usa para formatear el marcador HOY de la línea de tiempo.
const MEXICO_CITY_TIME_ZONE = "America/Mexico_City";

// formatTodayLabelMx arma el texto del marcador HOY (ej. "HOY · 30 MAY") en la zona horaria de México.
// En español: recibe una fecha (la actual, calculada EN EL SERVIDOR al renderizar la página) y
// devuelve el texto ya formateado. Hacerlo en el servidor y pasarlo como dato fijo a la línea de
// tiempo evita dos problemas: (1) que el día mostrado dependa del reloj del navegador (lo que causaría
// un desajuste de hidratación si cruza la medianoche), y (2) que el día se corra por usar UTC en vez
// de la hora local de México. La función es pura: para la misma fecha de entrada da la misma salida.
export function formatTodayLabelMx(today: Date): string {
  // Día con dos dígitos en la zona de México (ej. "30").
  const day = today.toLocaleDateString("es-MX", {
    timeZone: MEXICO_CITY_TIME_ZONE,
    day: "2-digit",
  });
  // Mes corto en es-MX (ej. "may"), sin punto y en mayúsculas (ej. "MAY").
  const month = today
    .toLocaleDateString("es-MX", { timeZone: MEXICO_CITY_TIME_ZONE, month: "short" })
    .replace(".", "")
    .toUpperCase();
  return `${ui.timeline.nowLabel} · ${day} ${month}`;
}

// TodayMarker describe el "hoy" que ubica el marcador HOY en la línea de tiempo.
// En español: junta los componentes de la fecha (año/mes/día) —para POSICIONAR el marcador entre los
// días— y la etiqueta ya armada ("HOY · 15 JUN") —para MOSTRARLA—.
export type TodayMarker = {
  year: number;
  month: number;
  day: number;
  label: string;
};

// MONTH_SHORT_ES_MX traduce el número de mes a su abreviatura es-MX en MAYÚSCULAS (para la etiqueta HOY).
const MONTH_SHORT_ES_MX = [
  "",
  "ENE",
  "FEB",
  "MAR",
  "ABR",
  "MAY",
  "JUN",
  "JUL",
  "AGO",
  "SEP",
  "OCT",
  "NOV",
  "DIC",
];

// resolveDemoToday calcula el marcador HOY a partir de la variable DEMO_TODAY (o el valor por defecto).
// En español: lee una fecha ISO "AAAA-MM-DD" (de DEMO_TODAY); si falta o está mal formada, usa la fecha
// de demo por defecto (mitad de junio 2026). Devuelve los componentes de la fecha y la etiqueta ya
// armada ("HOY · 15 JUN"). Calcular la etiqueta desde los componentes (sin Date ni zona horaria) la hace
// DETERMINISTA: el servidor y el navegador muestran exactamente lo mismo (sin desajuste de hidratación).
export function resolveDemoToday(envValue: string | undefined): TodayMarker {
  // Aceptamos solo el formato exacto AAAA-MM-DD. Si NO viene una fecha válida en DEMO_TODAY, ya no caemos a
  // una constante: capturamos el DÍA DE HOY REAL (zona horaria de México). Así, en producción (con catálogo
  // que cubra la fecha actual) basta con NO fijar DEMO_TODAY para que el "hoy" sea el real; en la DEMO se
  // fija DEMO_TODAY a un día poblado de la ventana may–jul 2026 para que la línea de tiempo aterrice ahí.
  const raw = (envValue ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return realTodayMarker();
  }

  const [yearText, monthText, dayText] = raw.split("-");
  return buildTodayMarker(Number(yearText), Number(monthText), Number(dayText));
}

// buildTodayMarker arma el TodayMarker (año/mes/día + etiqueta "HOY · 15 JUN") a partir de los números.
function buildTodayMarker(year: number, month: number, day: number): TodayMarker {
  const monthShort = MONTH_SHORT_ES_MX[month] ?? "";
  const label = `${ui.timeline.nowLabel} · ${String(day).padStart(2, "0")} ${monthShort}`;
  return { year, month, day, label };
}

// realTodayMarker captura el DÍA DE HOY REAL en la zona horaria de México (America/Mexico_City), para que
// el marcador HOY sea la fecha actual de verdad (no una constante). Usa Intl con locale en-CA, que entrega
// la fecha como "AAAA-MM-DD", fácil de partir en año/mes/día sin ambigüedad de formato.
export function realTodayMarker(): TodayMarker {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MEXICO_CITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [yearText, monthText, dayText] = parts.split("-");
  return buildTodayMarker(Number(yearText), Number(monthText), Number(dayText));
}

// CatalogMonth identifica un mes concreto del catálogo (año + mes), sin ambigüedad al cruzar de año.
export type CatalogMonth = {
  year: number;
  month: number;
};

// CATALOG_WINDOW_BEFORE / CATALOG_WINDOW_AFTER definen cuántos meses se piden ANTES y DESPUÉS del mes
// actual.
//
// En español: la línea de tiempo es un producto de "lo que VIENE", así que mira mucho más hacia
// adelante que hacia atrás. Un mes atrás basta para no perder de vista lo recién estrenado.
//
// ESTOS DOS NÚMEROS TIENEN QUE CUADRAR CON LO QUE GENERA EL CATÁLOGO (ver el objetivo "seed" del
// Makefile), y que no cuadraran fue un fallo real que se coló hasta las manos de quien lo probó: el
// generador creaba SEIS meses y esta ventana solo pedía CUATRO, así que los dos últimos existían en el
// servidor, ocupaban su sitio en el archivo… y no los pedía nadie. Desde la aplicación, sencillamente
// no se podía llegar a ellos: el calendario se acababa dos meses antes de tiempo sin ninguna
// explicación ni aviso. Nada fallaba, y por eso ninguna prueba lo vio.
//
// La cuenta que tiene que dar: BEFORE + 1 (el mes actual) + AFTER = los meses que genera el seed.
// Hoy son 1 + 1 + 4 = 6, y el generador hace 6.
const CATALOG_WINDOW_BEFORE = 1;
const CATALOG_WINDOW_AFTER = 4;

// catalogWindow calcula los meses que la app debe pedir al catálogo, DERIVADOS del marcador HOY.
// En español: antes cada pantalla tenía los meses escritos a mano (2026 y mayo/junio/julio). Eso
// significaba que, al llegar agosto, la app seguiría pidiendo meses viejos y se vería vacía aunque el
// catálogo tuviera datos nuevos. Ahora la ventana se calcula sola a partir de "hoy" y cruza de año
// correctamente (diciembre pide nov-dic-ene del año siguiente).
export function catalogWindow(today: TodayMarker): CatalogMonth[] {
  const months: CatalogMonth[] = [];
  for (let offset = -CATALOG_WINDOW_BEFORE; offset <= CATALOG_WINDOW_AFTER; offset += 1) {
    // Date normaliza solo el desbordamiento de mes: mes 0 => diciembre del año anterior, mes 12 =>
    // enero del siguiente. Usamos el día 1 porque solo nos interesan año y mes.
    const shifted = new Date(Date.UTC(today.year, today.month - 1 + offset, 1));
    months.push({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 });
  }
  return months;
}

// yearOfMonth devuelve el año con el que la ventana vigente identifica un número de mes.
// En español: de octubre a febrero el mes 1 es enero del año siguiente, no de este. Sin esta
// búsqueda, la etiqueta del navegador decía "ENERO 2026" estando ya en octubre de 2026.
export function yearOfMonth(today: TodayMarker, month: number): number {
  const match = catalogWindow(today).find((entry) => entry.month === month);
  return match !== undefined ? match.year : today.year;
}

// DateAnchorLike es la forma mínima de "un día concreto del calendario" que usa el navegador de fecha.
export type DateAnchorLike = { month: number; day: number };

// firstAnchorWithContent decide EN QUÉ DÍA debe abrirse la línea de tiempo.
//
// El problema que resuelve, en español:
//
// La línea de tiempo abría siempre centrada en HOY. Suena razonable y es exactamente lo que produjo la
// peor primera impresión posible del producto: si el catálogo todavía no cubre el día de hoy —porque
// se generó con la vista puesta en los meses siguientes, o porque lleva unos días sin refrescarse—,
// quien entra aterriza en una franja de días vacíos, con el encabezado anunciando un mes en el que no
// hay absolutamente nada. La aplicación parece rota o desactualizada aunque tenga cientos de estrenos
// esperando un poco más a la derecha. Ocurrió tal cual: el catálogo empezaba el 1 de agosto, alguien
// entró el 29 de julio y lo único que vio fue "JULIO 2026" y un calendario en blanco.
//
// La regla es simple y es la que espera cualquiera que abra un calendario de estrenos:
//
//   1. Si HOY tiene estrenos, se abre en HOY. Es lo más informativo.
//   2. Si no, se abre en el PRÓXIMO día que tenga estrenos. Es lo que la persona venía a ver.
//   3. Si ya no queda nada por delante (catálogo agotado), se abre en el ÚLTIMO día con estrenos, que
//      al menos enseña algo real en vez de una franja vacía.
//   4. Si no hay ni un solo estreno, se queda en HOY: no hay nada mejor que ofrecer, y en ese caso la
//      pantalla ya muestra su propio aviso de catálogo vacío.
//
// Importante: esto NO desplaza el marcador de HOY ni cambia qué es "hoy" en ningún otro sitio. Solo
// decide dónde apunta la cámara al abrir. El botón "Ir a hoy" sigue llevando a hoy.
export function firstAnchorWithContent(
  today: TodayMarker,
  releases: ReleaseSummary[],
): DateAnchorLike {
  const fallback: DateAnchorLike = { month: today.month, day: today.day };
  if (releases.length === 0) {
    return fallback;
  }

  // Las fechas se comparan como texto "AAAA-MM-DD", que ordena igual que el calendario. Es más simple
  // y más seguro que construir fechas: no hay husos horarios de por medio ni desfases de un día.
  const todayKey = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;

  let nextKey: string | null = null;
  let lastKey: string | null = null;
  for (const release of releases) {
    const key = release.releaseDate;
    if (key === undefined || key === "") {
      continue;
    }
    if (lastKey === null || key > lastKey) {
      lastKey = key;
    }
    if (key >= todayKey && (nextKey === null || key < nextKey)) {
      nextKey = key;
    }
  }

  const chosen = nextKey ?? lastKey;
  if (chosen === null) {
    return fallback;
  }
  const [, month, day] = chosen.split("-").map(Number);
  if (Number.isNaN(month) || Number.isNaN(day)) {
    return fallback;
  }
  return { month, day };
}

// MONTHS traduce el número de mes a su nombre en MAYÚSCULAS para la marca de agua gigante.
// En español: el cascarón v3 muestra "JUNIO"/"JULIO" como texto gigante de fondo (.month-wm).
// Cubrimos los DOCE meses (única fuente de los nombres de mes de la timeline): el catálogo de Fase 0
// usa may–jul, pero el calendario de emisión de las series puede extenderse a meses posteriores.
export const MONTHS: Record<number, string> = {
  1: "ENERO",
  2: "FEBRERO",
  3: "MARZO",
  4: "ABRIL",
  5: "MAYO",
  6: "JUNIO",
  7: "JULIO",
  8: "AGOSTO",
  9: "SEPTIEMBRE",
  10: "OCTUBRE",
  11: "NOVIEMBRE",
  12: "DICIEMBRE",
};

// CategoryKey es la "llave" interna en inglés de cada categoría visual de la timeline.
// En español: usamos estas tres llaves estables ("cine"/"streaming"/"tv") para indexar los
// metadatos y para las clases CSS de acento. Son el espejo de las tres categorías reales del
// modelo (CINE / STREAMING / TV); el valor UNSPECIFIED del proto no se muestra en la timeline.
export type CategoryKey = "cine" | "streaming" | "tv" | "indie";

// CategoryMeta describe TODO lo que la interfaz necesita saber de una categoría para pintarla.
// En español: junta su etiqueta visible (es-MX), la variable CSS de su color de acento y el
// valor del enum Category al que corresponde, para no repetir esos datos por toda la app.
export type CategoryMeta = {
  // key es la llave interna estable en inglés ("cine"/"streaming"/"tv").
  key: CategoryKey;
  // label es el texto que ve el usuario en es-MX (Cine / Streaming / Cadenas).
  label: string;
  // accentVar es la VARIABLE CSS del color de acento de la categoría (oro/teal/violeta).
  accentVar: string;
  // category es el valor del enum del modelo (CINE / STREAMING / TV) que representa esta llave.
  category: Category;
};

// CATEGORY_META es la tabla maestra de las tres categorías visibles en la línea de tiempo.
// En español: para cada categoría real del modelo guardamos su etiqueta es-MX y su color. El
// orden de las claves es el orden en que se apilan los paquetes dentro de un día (Cine arriba,
// luego Streaming, luego Cadenas), igual que el cascarón v3 (['cine','streaming','tv']).
export const CATEGORY_META: Record<CategoryKey, CategoryMeta> = {
  cine: {
    key: "cine",
    label: "Cine",
    accentVar: "var(--color-gold)",
    category: Category.CINE,
  },
  streaming: {
    key: "streaming",
    label: "Streaming",
    accentVar: "var(--color-teal)",
    category: Category.STREAMING,
  },
  tv: {
    key: "tv",
    label: "Cadenas",
    accentVar: "var(--color-violet)",
    category: Category.TV,
  },
  indie: {
    key: "indie",
    label: "Indie",
    accentVar: "var(--color-indie)",
    category: Category.INDIE,
  },
};

// CATEGORY_ORDER fija el orden de apilamiento de los paquetes dentro de un día.
// En español: es el mismo orden del cascarón v3; se separa como arreglo para poder recorrer
// las categorías de forma estable (no dependemos del orden de inserción de un objeto).
export const CATEGORY_ORDER: readonly CategoryKey[] = ["cine", "streaming", "tv", "indie"] as const;

// TimelineLane identifica cada una de las DOS líneas de tiempo del producto (rediseño del sprint de
// cierre): "cine" para los estrenos de SALA (Cine + Indie, lo que se estrena en pantalla grande) y
// "beyond" para todo lo que NO es cine (Streaming + Cadenas: series, lanzamientos directos, especiales).
export type TimelineLane = "cine" | "beyond";

// LaneMeta describe todo lo que la interfaz necesita para pintar UNA línea de tiempo (carril).
export type LaneMeta = {
  // key es la llave estable del carril ("cine"/"beyond").
  key: TimelineLane;
  // label es el título visible del carril en es-MX.
  label: string;
  // categories son las categorías del modelo que alimentan este carril.
  categories: readonly CategoryKey[];
};

// LANE_META es la tabla maestra de los dos carriles: qué categorías entran en cada uno y su título.
// En español: la regla de reparto es por CANAL de estreno. Sala de cine (Cine + Indie) arriba; todo lo
// demás (Streaming + Cadenas) abajo. Un estreno pertenece SIEMPRE a exactamente un carril.
export const LANE_META: Record<TimelineLane, LaneMeta> = {
  cine: {
    key: "cine",
    label: "Estrenos de cine",
    categories: ["cine", "indie"],
  },
  beyond: {
    key: "beyond",
    label: "Series y streaming",
    categories: ["streaming", "tv"],
  },
};

// LANE_ORDER fija el orden vertical de los carriles en la página (cine arriba, el resto abajo).
export const LANE_ORDER: readonly TimelineLane[] = ["cine", "beyond"] as const;

// releasesForLane filtra los estrenos que pertenecen a UN carril (por la categoría del modelo).
// En español: es pura y centraliza la regla de reparto para que la página, el flujo (TimelineStage) y
// cualquier otra pieza repartan EXACTAMENTE igual. Un estreno con categoría UNSPECIFIED no entra en
// ningún carril (igual que hoy no entra en la timeline).
export function releasesForLane(releases: ReleaseSummary[], lane: TimelineLane): ReleaseSummary[] {
  const laneCategories = new Set<CategoryKey>(LANE_META[lane].categories);
  return releases.filter((release) => {
    const categoryKey = categoryKeyFromEnum(release.category);
    return categoryKey !== null && laneCategories.has(categoryKey);
  });
}

// categoryKeyFromEnum convierte el valor del enum Category a nuestra llave interna en inglés.
// En español: el modelo trae la categoría como número (CINE=1, STREAMING=2, TV=3); aquí la
// pasamos a "cine"/"streaming"/"tv". Si llegara un valor sin clasificar (UNSPECIFIED), devolvemos
// null para que quien llame lo descarte de la timeline (no se inventa una categoría).
export function categoryKeyFromEnum(category: Category): CategoryKey | null {
  switch (category) {
    case Category.CINE:
      return "cine";
    case Category.STREAMING:
      return "streaming";
    case Category.TV:
      return "tv";
    case Category.INDIE:
      return "indie";
    default:
      // CATEGORY_UNSPECIFIED u otro valor inesperado: no se muestra en la timeline.
      return null;
  }
}

// FilterCategory es UNA opción del filtro de categoría (multi-selección). En español: "movie"/"series"
// filtran por TIPO de título; "streaming"/"indie" filtran por CATEGORÍA de canal. Ya NO existe "all": la
// ausencia de selección (lista vacía) equivale a "todas". Se pueden activar VARIAS a la vez (se combinan
// con "O": el estreno pasa si cumple AL MENOS UNA de las seleccionadas).
export type FilterCategory = "movie" | "series" | "streaming" | "indie";

// FILTER_CATEGORIES es el orden canónico de las opciones de categoría (para pintarlas en la barra).
export const FILTER_CATEGORIES: FilterCategory[] = ["movie", "series", "streaming", "indie"];

// TimelineFilter es el ESTADO COMPLETO de los filtros de la barra: dos dimensiones que se combinan con
// "Y" (AND). En español: un estreno se muestra solo si pasa la(s) categoría(s) Y el género elegidos.
export type TimelineFilter = {
  // categories son las categorías activas (multi-selección). VACÍO = todas. Varias = "O" entre ellas.
  categories: FilterCategory[];
  // genres son los géneros activos (multi-selección). VACÍO = todos. Varios = "O" entre ellos (un estreno
  // pasa si incluye AL MENOS UNO). Cada valor coincide con un valor de release.genres.
  genres: string[];
};

// DEFAULT_FILTER es el estado inicial: sin filtrar nada (todas las categorías y todos los géneros).
export const DEFAULT_FILTER: TimelineFilter = { categories: [], genres: [] };

// DateRange es la GRANULARIDAD del navegador de fecha de la espina (stepper tipo calendario):
//   - "month": enfoca el MES del ancla (atenúa el resto); las flechas saltan ±1 mes.
//   - "week": enfoca la SEMANA calendario (lun–dom) del ancla; las flechas saltan ±1 semana.
// El filtro NO oculta: ATENÚA lo que cae fuera del periodo (ver isDayInRange + el atributo data-outrange
// de la estación), conservando el contexto temporal de toda la línea. Mes y semana comparten el ANCLA,
// así navegar a otro mes y cambiar a semana deja el foco en una semana de ese mes (quedan conectados).
export type DateRange = "month" | "week";

// DATE_RANGES es el orden canónico del toggle de granularidad (mes primero: la vista más amplia).
export const DATE_RANGES: readonly DateRange[] = ["month", "week"] as const;

// dayTimeUTC convierte (año, mes 1-12, día) a milisegundos UTC, para comparar fechas sin zona horaria.
function dayTimeUTC(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

// DateAnchor es la fecha de REFERENCIA navegable para los rangos "week" y "month" (mes/día). Las flechas
// ‹ › la mueven: ±1 semana en modo "week", ±1 mes en modo "month". El año lo aporta el marcador HOY (todo
// el catálogo es del año de la demo). "Esta semana"/"Este mes" arrancan con el ancla en HOY.
export type DateAnchor = {
  month: number;
  day: number;
};

// weekBoundsUTC devuelve [inicio, fin] en ms UTC de la semana CALENDARIO (lunes a domingo) que contiene
// la fecha dada. Pura: misma entrada, misma salida; base lunes igual que el resto de la timeline.
function weekBoundsUTC(year: number, month: number, day: number): { start: number; end: number } {
  const dayMs = 86_400_000;
  const time = dayTimeUTC(year, month, day);
  const sundayBasedDow = new Date(time).getUTCDay(); // 0=domingo..6=sábado
  const mondayOffsetDays = (sundayBasedDow + 6) % 7; // días desde el lunes de esa semana
  const start = time - mondayOffsetDays * dayMs;
  return { start, end: start + 6 * dayMs };
}

// shiftDate suma (o resta) días a una fecha (mes/día de un año) y devuelve el mes/día resultante,
// cruzando bien los límites de mes. Lo usan las flechas de SEMANA (delta ±7). Pura y determinista (UTC).
export function shiftDate(year: number, month: number, day: number, deltaDays: number): DateAnchor {
  const shifted = shiftCalendar(year, month, day, deltaDays);
  return { month: shifted.month, day: shifted.day };
}

// shiftCalendar suma días y conserva el año. Lo usan las flechas de semana cuando diciembre
// pasa a enero: shiftDate se queda solo con mes y día, y el año se perdía.
export function shiftCalendar(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(dayTimeUTC(year, month, day) + deltaDays * 86_400_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// weekInsideCatalog dice si la semana que contiene ese día toca la ventana de meses vigente.
// En español: la ventana puede empezar en septiembre y terminar en febrero del año siguiente.
// Comparar solo números de mes (9…2) invertía el intervalo y bloqueaba enero.
export function weekInsideCatalog(
  year: number,
  month: number,
  day: number,
  today: TodayMarker,
): boolean {
  const window = catalogWindow(today);
  const first = window[0];
  const last = window[window.length - 1];
  if (first === undefined || last === undefined) {
    return false;
  }
  const bounds = weekBoundsUTC(year, month, day);
  const catalogStart = dayTimeUTC(first.year, first.month, 1);
  // Día 0 del mes siguiente (índice 0-based = last.month) es el último día del mes pedido.
  const catalogEnd = Date.UTC(last.year, last.month, 0);
  return bounds.start <= catalogEnd && bounds.end >= catalogStart;
}

// isDayInRange decide si un día (mes/día del catálogo) cae DENTRO del rango activo, respecto a un ANCLA.
// En español: es pura y centraliza la regla del filtro de fecha para que la apliquen igual los dos
// carriles. "all" siempre true. "upcoming" es de HOY en adelante (usa el marcador HOY). "month" compara
// contra el mes del ANCLA. "week" usa la semana calendario lunes–domingo que contiene el ANCLA. El ancla
// arranca en HOY pero las flechas lo mueven, así "Esta semana/Este mes" pueden navegar a otras semanas/meses.
export function isDayInRange(
  month: number,
  day: number,
  today: TodayMarker,
  range: DateRange,
  anchor: DateAnchor,
  dayYear: number = today.year,
  anchorYear: number = today.year,
): boolean {
  if (range === "month") {
    return dayYear === anchorYear && month === anchor.month;
  }
  // "week": ¿cae el día dentro de la semana calendario (lun–dom) que contiene el ancla?
  // El año del día y el del ancla van aparte: una semana de diciembre puede incluir el 1 de enero
  // del año siguiente, y usar solo el año de HOY los dejaba en el enero anterior.
  const dayTime = dayTimeUTC(dayYear, month, day);
  const bounds = weekBoundsUTC(anchorYear, anchor.month, anchor.day);
  return dayTime >= bounds.start && dayTime <= bounds.end;
}

// formatPeriodLabel arma la ETIQUETA del periodo enfocado para el centro del stepper. En mes: el nombre
// del mes + año ("JUNIO 2026"). En semana: el rango lun–dom ("09 – 15 jun", o "29 jun – 05 jul" si cruza
// el mes). Pura: misma entrada, misma salida. Da el feedback de "dónde estás" clave para la intuición.
export function formatPeriodLabel(range: DateRange, anchor: DateAnchor, year: number): string {
  if (range === "month") {
    return `${MONTHS[anchor.month] ?? ""} ${year}`;
  }
  const bounds = weekBoundsUTC(year, anchor.month, anchor.day);
  const start = new Date(bounds.start);
  const end = new Date(bounds.end);
  const startDay = String(start.getUTCDate()).padStart(2, "0");
  const endDay = String(end.getUTCDate()).padStart(2, "0");
  const startMon = (MONTH_SHORT_ES_MX[start.getUTCMonth() + 1] ?? "").toLowerCase();
  const endMon = (MONTH_SHORT_ES_MX[end.getUTCMonth() + 1] ?? "").toLowerCase();
  // Si la semana NO cruza de mes, mostramos el mes una sola vez al final ("09 – 15 jun").
  return startMon === endMon
    ? `${startDay} – ${endDay} ${endMon}`
    : `${startDay} ${startMon} – ${endDay} ${endMon}`;
}

// isAnchorAtToday indica si el periodo enfocado YA contiene HOY (para atenuar el botón "Hoy": no tiene
// sentido "volver a hoy" si ya estás ahí). En mes: mismo mes; en semana: hoy dentro de la semana del ancla.
export function isAnchorAtToday(range: DateRange, anchor: DateAnchor, today: TodayMarker): boolean {
  if (range === "month") {
    return anchor.month === today.month;
  }
  const todayTime = dayTimeUTC(today.year, today.month, today.day);
  const bounds = weekBoundsUTC(yearOfMonth(today, anchor.month), anchor.month, anchor.day);
  return todayTime >= bounds.start && todayTime <= bounds.end;
}

// weekOverlapsMonths indica si la semana del ancla TOCA el rango de meses del catálogo [firstMonth,
// lastMonth] de un año. En español: acota las flechas de SEMANA para no navegar a semanas completamente
// fuera del catálogo (donde no habría ninguna estación). Compara el solape de intervalos de fechas.
export function weekOverlapsMonths(
  anchor: DateAnchor,
  year: number,
  firstMonth: number,
  lastMonth: number,
): boolean {
  const bounds = weekBoundsUTC(year, anchor.month, anchor.day);
  const catalogStart = dayTimeUTC(year, firstMonth, 1);
  const catalogEnd = new Date(Date.UTC(year, lastMonth, 0)).getTime(); // último día del último mes
  return bounds.start <= catalogEnd && bounds.end >= catalogStart;
}

// releaseMatchesCategory decide si un estreno cumple UNA opción de categoría (tipo o canal).
function releaseMatchesCategory(release: ReleaseSummary, category: FilterCategory): boolean {
  switch (category) {
    case "movie":
      return release.type === TitleType.MOVIE;
    case "series":
      return release.type === TitleType.SERIES;
    case "streaming":
      return release.category === Category.STREAMING;
    case "indie":
      return release.category === Category.INDIE;
    default:
      return false;
  }
}

// matchesFilter decide si un estreno pasa TODAS las dimensiones del filtro activas.
// En español: es pura (no toca nada externo) y centraliza la regla para no repetirla en la interfaz.
//   - CATEGORÍA (multi): si hay alguna seleccionada, el estreno debe cumplir AL MENOS UNA ("O"). Si no
//     hay ninguna seleccionada, esta dimensión no filtra (pasa cualquier categoría).
//   - GÉNERO: si se eligió uno, el estreno debe incluirlo en su lista.
export function matchesFilter(release: ReleaseSummary, filter: TimelineFilter): boolean {
  if (
    filter.categories.length > 0 &&
    !filter.categories.some((category) => releaseMatchesCategory(release, category))
  ) {
    return false;
  }
  if (filter.genres.length > 0 && !filter.genres.some((genre) => release.genres.includes(genre))) {
    return false;
  }
  return true;
}

// ConnectionReason explica POR QUÉ dos estrenos están conectados (para la etiqueta de la conexión).
export type ConnectionReason = "saga" | "director" | "cast" | "genre";

// Connection es un estreno RELACIONADO con otro y el motivo de la relación.
// En español: la ficha de detalle muestra "conexiones reales" (no inventadas): otros estrenos del
// catálogo que comparten saga, director o género con el que estás viendo. Cada conexión lleva el estreno
// relacionado y el motivo, para que la interfaz lo etiquete ("Misma saga" / "Mismo director" / "Relacionado").
export type Connection = {
  release: ReleaseSummary;
  reason: ConnectionReason;
};

// DE DÓNDE SALEN AHORA LOS NOMBRES DE DIRECCIÓN Y REPARTO, y por qué cambió.
//
// En español: hasta la versión 0.1.63 estas dos listas se deducían aquí, recorriendo el equipo
// técnico y el reparto COMPLETOS de cada estreno del catálogo. Eso obligaba a que la portada
// descargara los créditos de los trescientos y pico títulos de la ventana —cientos de personas por
// ficha, con su foto, su personaje y su número de episodios— para acabar usando un puñado de
// nombres. Era, con diferencia, la mitad del peso de la página.
//
// Ahora el servidor manda ya deducidos esos nombres dentro del resumen de cada estreno
// (director_names y lead_cast_names; ver backend/internal/catalog/summary.go). Las reglas de
// deducción son exactamente las mismas que había aquí —qué puestos cuentan como dirección y cuántos
// nombres del reparto se miran— y viven ahora en un solo sitio, del lado del servidor, en vez de
// estar escritas dos veces en dos lenguajes distintos.
//
// QUIÉN DECIDE QUE DOS CRÉDITOS SON LA MISMA PERSONA: lib/person-identity, y solo él.
//
// Esa regla estaba escrita aquí a mano (minúsculas y sin espacios sobrantes) y OTRA VEZ, con otro
// criterio distinto, en la página de una persona, que compara por número de identidad. Dos criterios
// para la misma pregunta significan que dos personas homónimas se comportan de forma distinta según
// por dónde entres al producto. Ahora la regla vive en un solo archivo y las dos pantallas la usan.
//
// Lo que aquí se puede aplicar es su segundo escalón —comparar el nombre escrito— y NO por descuido:
// el resumen de un estreno, que es la forma ligera con la que esta función trabaja, trae los NOMBRES
// de dirección y reparto pero no sus números de identidad. Está explicado, con lo que haría falta para
// cerrarlo del todo, en la cabecera de lib/person-identity.

// directorsOf saca a quienes dirigen un estreno, listos para comparar.
function directorsOf(release: ReleaseSummary): Set<string> {
  return personIdentityKeySet(release.directorNames.map((name) => ({ name })));
}

// leadCastOf saca el reparto principal de un estreno, listo para comparar.
function leadCastOf(release: ReleaseSummary): Set<string> {
  return personIdentityKeySet(release.leadCastNames.map((name) => ({ name })));
}

// findConnections deriva las CONEXIONES REALES de un estreno dentro de un catálogo, en orden de prioridad.
// En español: recorre el catálogo y arma una lista de estrenos relacionados, SIN repetir y SIN incluirse
// a sí mismo, priorizando: (1) MISMA SAGA (la conexión más fuerte), (2) MISMO DIRECTOR, (3) por GÉNERO
// compartido (los de mayor solape primero). Es pura (no hace fetch): la interfaz le pasa el catálogo que
// ya tiene cargado. Limita el total para no saturar la ficha. Nada inventado: todo sale del catálogo real.
export function findConnections(
  release: ReleaseSummary,
  catalog: ReleaseSummary[],
  limit = 8,
): Connection[] {
  const selfId = release.id;
  const seen = new Set<string>([selfId]);
  const out: Connection[] = [];

  const sagaName = release.sagaName.trim();
  const myDirectors = directorsOf(release);
  const myGenres = new Set(release.genres);

  // (1) Misma saga: otros estrenos cuya saga tiene el mismo nombre.
  if (sagaName !== "") {
    for (const candidate of catalog) {
      if (seen.has(candidate.id)) {
        continue;
      }
      if (candidate.sagaName.trim() === sagaName) {
        out.push({ release: candidate, reason: "saga" });
        seen.add(candidate.id);
      }
    }
  }

  // (2) Mismo director: comparten al menos una persona con rol Dirección. La comparación es la MISMA
  // que usa el resto del producto (ver lib/person-identity), no una escrita aquí a mano.
  if (myDirectors.size > 0) {
    for (const candidate of catalog) {
      if (seen.has(candidate.id)) {
        continue;
      }
      if (sharesAnyPerson(myDirectors, directorsOf(candidate))) {
        out.push({ release: candidate, reason: "director" });
        seen.add(candidate.id);
      }
    }
  }

  // (3) Reparto compartido: sale al menos una misma cara conocida.
  //
  // En español: es, con diferencia, la conexión más frecuente de verdad en este catálogo. Medido sobre
  // los 422 estrenos: 240 personas aparecen en más de un título y eso conecta 223 de ellos, más de la
  // mitad. Compárese con "mismo director", que solo enlaza tres, y con "misma saga", que en esta
  // ventana no enlaza ninguno. Va DESPUÉS de saga y dirección porque compartir director es una señal
  // más fuerte de "te va a gustar", pero antes que el género, que es la más débil de las cuatro.
  const myCast = leadCastOf(release);
  if (myCast.size > 0) {
    for (const candidate of catalog) {
      if (seen.has(candidate.id)) {
        continue;
      }
      if (sharesAnyPerson(myCast, leadCastOf(candidate))) {
        out.push({ release: candidate, reason: "cast" });
        seen.add(candidate.id);
      }
    }
  }

  // (4) Género compartido: los de MAYOR solape de géneros primero (más afines).
  const genreCandidates = catalog
    .filter((candidate) => !seen.has(candidate.id))
    .map((candidate) => ({
      candidate,
      overlap: candidate.genres.filter((genre) => myGenres.has(genre)).length,
    }))
    .filter((entry) => entry.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap);
  for (const entry of genreCandidates) {
    if (out.length >= limit) {
      break;
    }
    out.push({ release: entry.candidate, reason: "genre" });
    seen.add(entry.candidate.id);
  }

  return out.slice(0, limit);
}

// collectGenres reúne los géneros ÚNICOS presentes en una lista de estrenos, ordenados alfabéticamente.
// En español: alimenta las opciones del select "Género" de la barra con los géneros REALES del catálogo
// (nada inventado): recorre cada estreno, junta sus géneros sin repetir y los ordena en es-MX. Ignora
// cadenas vacías para no ofrecer una opción en blanco.
export function collectGenres(releases: ReleaseSummary[]): string[] {
  const unique = new Set<string>();
  for (const release of releases) {
    for (const genre of release.genres) {
      const trimmed = genre.trim();
      if (trimmed.length > 0) {
        unique.add(trimmed);
      }
    }
  }
  return Array.from(unique).sort((left, right) => left.localeCompare(right, "es-MX"));
}

// WEEKDAYS_SHORT_ES_MX son las abreviaturas de los días de la semana en es-MX (Lun..Dom).
// En español: las usamos para etiquetar cada día de la timeline. El índice 0 corresponde a LUNES
// porque calculamos el día desde la fecha usando una base que empieza en lunes (ver weekdayShortEsMX).
const WEEKDAYS_SHORT_ES_MX: readonly string[] = [
  "Lun",
  "Mar",
  "Mié",
  "Jue",
  "Vie",
  "Sáb",
  "Dom",
] as const;

// WEEKDAYS_FULL_ES_MX son los nombres COMPLETOS de los días (Lunes..Domingo), base lunes igual que
// las abreviaturas. En español: la caja de día del rediseño muestra "VIERNES 11" (día completo +
// número), más visual que la abreviatura sola.
const WEEKDAYS_FULL_ES_MX: readonly string[] = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;

// weekdayShortEsMX calcula la abreviatura del día de la semana de una fecha ISO, de forma DETERMINISTA.
// En español: recibe la fecha como "AAAA-MM-DD" y devuelve "Lun".."Dom". Es CLAVE que el resultado
// NO dependa de la zona horaria de quien mira (servidor o navegador): por eso interpretamos la fecha
// SIEMPRE en UTC (añadiendo "T00:00:00Z") y leemos el día con getUTCDay(). Así el mismo estreno cae
// en el mismo día de la semana para todos. getUTCDay() devuelve 0=domingo..6=sábado; lo reacomodamos
// para que nuestro arreglo empiece en lunes. Si la fecha viniera vacía o mal formada, devolvemos
// cadena vacía (degradación elegante, sin lanzar errores ni inventar un día).
export function weekdayShortEsMX(releaseDate: string): string {
  // Sin fecha utilizable: no hay día de semana que mostrar.
  if (!releaseDate) {
    return "";
  }
  // Interpretamos la fecha como medianoche UTC para que no se "corra un día" por la zona horaria.
  const parsed = new Date(`${releaseDate}T00:00:00Z`);
  // Fecha imposible de entender: devolvemos vacío en vez de un día equivocado.
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  // getUTCDay(): 0=domingo, 1=lunes, ..., 6=sábado. Convertimos a base lunes (0=lunes..6=domingo):
  // restamos 1 y, con módulo 7 sumando 7, hacemos que el domingo (0 -> -1) caiga al final (índice 6).
  const sundayBasedDay = parsed.getUTCDay();
  const mondayBasedIndex = (sundayBasedDay + 6) % 7;
  return WEEKDAYS_SHORT_ES_MX[mondayBasedIndex];
}

// weekdayFullEsMX calcula el nombre COMPLETO del día de la semana de una fecha ISO ("Viernes"…).
// En español: misma mecánica determinista (UTC, base lunes) que weekdayShortEsMX; alimenta la caja de
// día del rediseño ("VIERNES 11"). Cadena vacía si la fecha no sirve (degradación elegante).
export function weekdayFullEsMX(releaseDate: string): string {
  if (!releaseDate) {
    return "";
  }
  const parsed = new Date(`${releaseDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const sundayBasedDay = parsed.getUTCDay();
  const mondayBasedIndex = (sundayBasedDay + 6) % 7;
  return WEEKDAYS_FULL_ES_MX[mondayBasedIndex];
}

// monthDayFromIso extrae año, mes (1-12) y día (1-31) de una fecha ISO, en UTC.
// En español: agrupamos los estrenos por mes y día, así que necesitamos esos dos números de forma
// estable. Igual que arriba, leemos en UTC para no depender de la zona horaria. Devuelve null si la
// fecha no es válida, para que el estreno se descarte de la timeline sin romper el agrupado.
function monthDayFromIso(releaseDate: string): { year: number; month: number; day: number } | null {
  if (!releaseDate) {
    return null;
  }
  const parsed = new Date(`${releaseDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  // getUTCMonth() es 0-11; sumamos 1 para tener el mes "humano" (1=enero..12=diciembre). El AÑO
  // también se devuelve: los cálculos de "¿ya pasó?" y "¿a cuántos días está?" lo necesitan para no
  // romperse cuando el catálogo cruce de año (antes se asumía 2026 y era una bomba de tiempo).
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

// isUpcoming indica si un estreno es POSTERIOR a "hoy" (aún no se estrena) según el marcador de demo.
// En español: lo usamos para mostrar "Próximamente" SOLO en lo que está por venir; un estreno ya pasado
// (aunque le falte la calificación) NUNCA es "Próximamente". Compara la fecha COMPLETA (año incluido)
// contra TodayMarker. Devuelve false si la fecha no es válida (sin fecha no se trata como futuro).
export function isUpcoming(release: ReleaseSummary, today: TodayMarker): boolean {
  const monthDay = monthDayFromIso(release.releaseDate);
  if (monthDay === null) {
    return false;
  }
  // Comparación por componentes, del más significativo al menos: año, luego mes, luego día.
  if (monthDay.year !== today.year) {
    return monthDay.year > today.year;
  }
  if (monthDay.month !== today.month) {
    return monthDay.month > today.month;
  }
  return monthDay.day > today.day;
}

// readTmdb obtiene la calificación TMDB de un estreno de forma segura (0 si falta).
// En español: la calificación vive en ratings.tmdb, pero "ratings" puede venir indefinido (proto3).
// Devolvemos 0 cuando falte, que es el caso "sin calificación" (se clasifica como común aguas abajo).
function readTmdb(release: ReleaseSummary): number {
  return release.ratings?.tmdb ?? 0;
}

// dayDistanceFromToday devuelve la distancia EN DÍAS (con signo) entre la fecha de un estreno y "hoy".
// En español: negativa si ya pasó, positiva si está por venir. Usa el AÑO REAL de cada fecha (antes se
// fijaba 2026 y el cálculo se rompería al cruzar de año). Devuelve Infinity si la fecha no es válida
// (ese estreno no entra en la ventana).
function dayDistanceFromToday(releaseDate: string, today: TodayMarker): number {
  const monthDay = monthDayFromIso(releaseDate);
  if (monthDay === null) {
    return Number.POSITIVE_INFINITY;
  }
  const releaseTime = Date.UTC(monthDay.year, monthDay.month - 1, monthDay.day);
  const todayTime = Date.UTC(today.year, today.month - 1, today.day);
  return Math.round((releaseTime - todayTime) / 86_400_000);
}

// pickWeekBackdrops elige los estrenos de la SEMANA actual (±3 días de hoy) que tienen backdrop, para el
// fondo global rotativo. Así el fondo muestra lo que SE ESTRENA ESTA SEMANA, no los títulos viejos mejor
// calificados (que era lo que pasaba al elegir "los mejores por nota"). Si la semana no tiene ninguno con
// imagen, cae a los más cercanos a hoy. Ordena por cercanía a hoy y, a igualdad, por mejor calificación.
export function pickWeekBackdrops(
  releases: ReleaseSummary[],
  today: TodayMarker,
  limit: number,
): ReleaseSummary[] {
  if (limit <= 0) {
    return [];
  }
  // Solo sirven los que tienen imagen de fondo REAL (sin backdrop no hay "banner" que rotar).
  const withBackdrop = releases.filter((release) => release.backdropUrl !== "");
  if (withBackdrop.length === 0) {
    return [];
  }
  const weekRadiusDays = 3;
  const inWeek = withBackdrop.filter(
    (release) => Math.abs(dayDistanceFromToday(release.releaseDate, today)) <= weekRadiusDays,
  );
  // Si esta semana no tiene estrenos con imagen, usamos todos los que tengan (los ordenaremos por cercanía).
  const pool = inWeek.length > 0 ? inWeek : withBackdrop;
  const sorted = [...pool].sort((left, right) => {
    const leftDistance = Math.abs(dayDistanceFromToday(left.releaseDate, today));
    const rightDistance = Math.abs(dayDistanceFromToday(right.releaseDate, today));
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    return readTmdb(right) - readTmdb(left);
  });
  return sorted.slice(0, limit);
}

// CategoryPackage es un "paquete" de estrenos de UNA categoría en UN día concreto.
// En español: junta todos los estrenos de, por ejemplo, "Cine" del 15 de junio. Lleva ya calculados
// el conteo y la mejor calificación TMDB del grupo, que la interfaz usa para el número y el "★ x.x".
export type CategoryPackage = {
  // categoryKey identifica la categoría del paquete ("cine"/"streaming"/"tv").
  categoryKey: CategoryKey;
  // items son los estrenos de esa categoría ese día, ORDENADOS de mejor a peor calificación TMDB.
  items: ReleaseSummary[];
  // count es cuántos estrenos hay en el paquete (= items.length). Se guarda explícito por comodidad.
  count: number;
  // maxTmdb es la mejor calificación TMDB del paquete, ya formateada a un decimal (ej. "8.6").
  maxTmdb: string;
  // bannerUrl es el backdrop del estreno MÁS IMPORTANTE del paquete (el mejor calificado que tenga
  // imagen real), para el mini-banner cinematográfico del chip. Cadena vacía si ninguno trae imagen.
  bannerUrl: string;
};

// DayGroup son todos los estrenos de UN día, ya repartidos en paquetes por categoría.
// En español: representa una columna de la timeline (un día), con su número de día, su día de la
// semana y la lista de paquetes que contiene (Cine/Streaming/Cadenas, en ese orden).
export type DayGroup = {
  // day es el número de día del mes (1-31).
  day: number;
  // weekdayShort es la abreviatura del día de la semana en es-MX ("Lun".."Dom").
  weekdayShort: string;
  // weekdayFull es el nombre completo del día en es-MX ("Lunes".."Domingo"), para la caja de día
  // del rediseño ("VIERNES 11").
  weekdayFull: string;
  // packages son los paquetes por categoría de ese día (solo las categorías con al menos un estreno).
  packages: CategoryPackage[];
};

// MonthGroup son todos los estrenos de UN mes, ya repartidos en días ordenados.
// En español: representa un bloque de la timeline (un mes), con su número de mes, su nombre en
// mayúsculas (para la marca de agua) y la lista de días con contenido, de menor a mayor.
export type MonthGroup = {
  // year es el año de este bloque. Hace falta al cruzar de diciembre a enero: el número de mes
  // solo no distingue 2026 de 2027.
  year: number;
  // month es el número de mes (1-12).
  month: number;
  // label es el nombre del mes en mayúsculas para la marca de agua ("OCTUBRE"/"ENERO"); cadena vacía
  // si el mes no está en MONTHS.
  label: string;
  // days son los días con al menos un estreno, ordenados ascendentemente.
  days: DayGroup[];
};

// sortByTmdbDesc compara dos estrenos para ordenarlos de MEJOR a PEOR calificación TMDB.
// En español: la usamos para que, dentro de cada paquete, el mejor calificado quede primero (y sea
// el que define el "★ máximo" y, en S7, encabece el modal). Es estable y pura.
function sortByTmdbDesc(left: ReleaseSummary, right: ReleaseSummary): number {
  return readTmdb(right) - readTmdb(left);
}

// buildCategoryPackage arma el paquete de UNA categoría a partir de sus estrenos de un día.
// En español: ordena los estrenos del grupo de mejor a peor calificación, cuenta cuántos hay y
// calcula la mejor calificación TMDB (formateada a un decimal, como en el cascarón). Es un paso
// pequeño y con nombre para que groupByMonth se lea claro.
function buildCategoryPackage(categoryKey: CategoryKey, items: ReleaseSummary[]): CategoryPackage {
  // Copiamos antes de ordenar para no mutar el arreglo que nos pasaron (pureza: sin efectos sobre la entrada).
  const sortedItems = [...items].sort(sortByTmdbDesc);
  // La mejor calificación es la del primer elemento ya ordenado; la formateamos a un decimal ("8.6").
  const bestTmdb = sortedItems.length > 0 ? readTmdb(sortedItems[0]) : 0;
  // El banner del paquete: como los items ya están de MEJOR a peor, el primero CON backdrop real es el
  // "más importante con imagen". Sin imagen real no hay banner (cadena vacía; el chip queda sólido).
  const bannerUrl = sortedItems.find((item) => item.backdropUrl !== "")?.backdropUrl ?? "";
  return {
    categoryKey,
    items: sortedItems,
    count: sortedItems.length,
    maxTmdb: bestTmdb.toFixed(1),
    bannerUrl,
  };
}

// groupByMonth transforma la lista cruda de estrenos en la estructura por mes -> día -> paquetes.
// En español: es la función central de este archivo. Recibe TODOS los estrenos (de cualquier mes) y
// los reparte en bloques de mes, dentro de cada mes en columnas de día (ordenadas), y dentro de cada
// día en paquetes por categoría (Cine/Streaming/Cadenas, en ese orden), descartando los paquetes
// vacíos. Descarta también, sin romperse, los estrenos con fecha inválida o categoría sin clasificar.
// El resultado sale ORDENADO por año y mes (octubre, noviembre, diciembre, enero), no por el
// número de mes suelto: ese orden ponía enero a la izquierda de octubre al cruzar de año.
export function groupByMonth(releases: ReleaseSummary[]): MonthGroup[] {
  // Mapa intermedio: clave año-mes -> (día -> (categoría -> estrenos)). La clave es
  // año*12 + (mes-1), así diciembre de 2026 queda justo antes de enero de 2027.
  const monthMap = new Map<number, Map<number, Map<CategoryKey, ReleaseSummary[]>>>();

  // Recorremos cada estreno y lo colocamos en su casilla (mes/día/categoría).
  for (const release of releases) {
    // Extraemos mes y día de la fecha ISO en UTC; si la fecha no sirve, saltamos este estreno.
    const monthDay = monthDayFromIso(release.releaseDate);
    if (monthDay === null) {
      continue;
    }
    // Traducimos la categoría del enum a nuestra llave; si es UNSPECIFIED, lo saltamos (no se muestra).
    const categoryKey = categoryKeyFromEnum(release.category);
    if (categoryKey === null) {
      continue;
    }

    const key = monthDay.year * 12 + (monthDay.month - 1);
    // Aseguramos que exista el "cajón" del mes.
    let dayMap = monthMap.get(key);
    if (dayMap === undefined) {
      dayMap = new Map<number, Map<CategoryKey, ReleaseSummary[]>>();
      monthMap.set(key, dayMap);
    }
    // Aseguramos que exista el "cajón" del día dentro del mes.
    let categoryMap = dayMap.get(monthDay.day);
    if (categoryMap === undefined) {
      categoryMap = new Map<CategoryKey, ReleaseSummary[]>();
      dayMap.set(monthDay.day, categoryMap);
    }
    // Aseguramos que exista la lista de la categoría dentro del día y agregamos el estreno.
    let categoryItems = categoryMap.get(categoryKey);
    if (categoryItems === undefined) {
      categoryItems = [];
      categoryMap.set(categoryKey, categoryItems);
    }
    categoryItems.push(release);
  }

  // Ahora aplanamos el mapa a la estructura final, ordenando meses y días de menor a mayor.
  const sortedMonths = [...monthMap.keys()].sort((leftMonth, rightMonth) => leftMonth - rightMonth);

  return sortedMonths.map((key): MonthGroup => {
    const year = Math.floor(key / 12);
    const month = (key % 12) + 1;
    const dayMap = monthMap.get(key) as Map<number, Map<CategoryKey, ReleaseSummary[]>>;
    const sortedDays = [...dayMap.keys()].sort((leftDay, rightDay) => leftDay - rightDay);

    const days = sortedDays.map((day): DayGroup => {
      const categoryMap = dayMap.get(day) as Map<CategoryKey, ReleaseSummary[]>;

      // Recorremos las categorías en su ORDEN fijo (Cine, Streaming, Cadenas) y armamos solo las que
      // tienen al menos un estreno ese día. Así los paquetes salen siempre en el mismo orden visual.
      const packages: CategoryPackage[] = [];
      for (const categoryKey of CATEGORY_ORDER) {
        const items = categoryMap.get(categoryKey);
        if (items !== undefined && items.length > 0) {
          packages.push(buildCategoryPackage(categoryKey, items));
        }
      }

      // El día de la semana lo tomamos del PRIMER estreno disponible del día: todos comparten fecha,
      // así que cualquiera sirve. Buscamos el primero para no asumir que "cine" siempre existe.
      const firstItem = packages.length > 0 ? packages[0].items[0] : undefined;
      const weekdayShort = firstItem !== undefined ? weekdayShortEsMX(firstItem.releaseDate) : "";
      const weekdayFull = firstItem !== undefined ? weekdayFullEsMX(firstItem.releaseDate) : "";

      return {
        day,
        weekdayShort,
        weekdayFull,
        packages,
      };
    });

    return {
      year,
      month,
      // Nombre en mayúsculas para la marca de agua; cadena vacía si el mes no está mapeado.
      label: MONTHS[month] ?? "",
      days,
    };
  });
}

// daysInMonth devuelve cuántos días tiene un mes (1-12) de un año dado, en UTC.
// En español: el truco es pedir el "día 0" del mes SIGUIENTE: en JavaScript eso devuelve el último día
// del mes actual (28/29/30/31), respetando años bisiestos. month es 1-based (junio = 6).
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// weekdayShortFromYMD calcula la abreviatura del día de la semana (es-MX, base lunes) de un año/mes/día.
// En español: misma convención que weekdayShortEsMX (lunes primero), pero a partir de números en vez de
// una fecha ISO. Lo usamos para los días VACÍOS del calendario (sin estreno, sin fecha de un release).
function weekdayShortFromYMD(year: number, month: number, day: number): string {
  const sundayBasedDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayBasedIndex = (sundayBasedDay + 6) % 7;
  return WEEKDAYS_SHORT_ES_MX[mondayBasedIndex];
}

// weekdayFullFromYMD calcula el nombre COMPLETO del día (es-MX, base lunes) de un año/mes/día.
// En español: hermano de weekdayShortFromYMD para los días VACÍOS del calendario completo.
function weekdayFullFromYMD(year: number, month: number, day: number): string {
  const sundayBasedDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayBasedIndex = (sundayBasedDay + 6) % 7;
  return WEEKDAYS_FULL_ES_MX[mondayBasedIndex];
}

// buildCalendarMonths transforma los estrenos en un calendario COMPLETO: cada mes con TODOS sus días.
// En español: groupByMonth solo trae los días CON estrenos (timeline "con huecos"). Aquí, para tener una
// línea de tiempo REAL y continua (como pidió el rediseño), rellenamos cada mes con TODOS sus días (1..N):
// los días con estrenos conservan sus paquetes; los días sin estrenos quedan con la lista de paquetes
// vacía (se dibujarán como una caja de día tenue, no expandible). Cada mes usa su propio año: enero
// de 2027 no hereda el año del primer estreno de la lista. Si lo heredara, el día de la semana de
// los días vacíos saldría corrido.
export function buildCalendarMonths(releases: ReleaseSummary[]): MonthGroup[] {
  return groupByMonth(releases).map((monthGroup): MonthGroup => {
    // Indexamos los días CON estrenos por su número, para reusarlos al recorrer el calendario completo.
    const dayByNumber = new Map<number, DayGroup>();
    for (const dayGroup of monthGroup.days) {
      dayByNumber.set(dayGroup.day, dayGroup);
    }

    // Recorremos TODOS los días del mes (1..último) y, para cada uno, usamos su día con estrenos si existe
    // o creamos un día VACÍO (sin paquetes) con su día de la semana calculado.
    const totalDays = daysInMonth(monthGroup.year, monthGroup.month);
    const fullDays: DayGroup[] = [];
    for (let day = 1; day <= totalDays; day += 1) {
      const existing = dayByNumber.get(day);
      if (existing !== undefined) {
        fullDays.push(existing);
      } else {
        fullDays.push({
          day,
          weekdayShort: weekdayShortFromYMD(monthGroup.year, monthGroup.month, day),
          weekdayFull: weekdayFullFromYMD(monthGroup.year, monthGroup.month, day),
          packages: [],
        });
      }
    }

    return {
      year: monthGroup.year,
      month: monthGroup.month,
      label: monthGroup.label,
      days: fullDays,
    };
  });
}

// EffectLevel es el "nivel de efecto" visual de un paquete según cuántos estrenos tiene.
// En español: a más estrenos, más vistoso el paquete. "single" = 1 (simple), "few" = 2 o 3 (brillo
// tenue), "many" = 4 o más (brillo + pulso + máximo de slivers). Espeja la lógica de densidad del
// cascarón v3 (d2 a partir de 2, d3 a partir de 4) pero con nombres legibles.
export type EffectLevel = "single" | "few" | "many";

// EFFECT_FEW_THRESHOLD es el mínimo de estrenos para subir de "single" a "few" (2).
const EFFECT_FEW_THRESHOLD = 2;
// EFFECT_MANY_THRESHOLD es el mínimo de estrenos para subir de "few" a "many" (4).
const EFFECT_MANY_THRESHOLD = 4;

// effectLevel decide el nivel de efecto de un paquete a partir de su cantidad de estrenos.
// En español: 1 -> "single"; 2 o 3 -> "few"; 4 o más -> "many". La comparación es por "mayor o
// igual", igual que los umbrales del cascarón. Pura: solo depende del número que recibe.
export function effectLevel(count: number): EffectLevel {
  if (count >= EFFECT_MANY_THRESHOLD) {
    return "many";
  }
  if (count >= EFFECT_FEW_THRESHOLD) {
    return "few";
  }
  return "single";
}

// MAX_SLIVERS es el número máximo de "slivers" (mini-pósters apilados) que muestra un paquete.
// En español: el cascarón apila como mucho 3 lomos de póster; aquí lo nombramos para reutilizarlo.
export const MAX_SLIVERS = 3;

// pickTopByTmdb elige los N estrenos MEJOR calificados (TMDB), de mejor a peor, sin mutar la entrada.
// En español: el rediseño E2 usa los mejores estrenos como FONDO GLOBAL rotativo de la página (sus
// backdrops se van mostrando uno tras otro). Esta función entrega esa lista corta: copia los estrenos,
// los ordena de mayor a menor calificación TMDB y se queda con los primeros "limit". Es pura (no toca
// nada externo y no modifica el arreglo recibido) y determinista: ante empate de calificación, conserva
// el orden de entrada (sort estable), igual de estable que pickFeatured. Si "limit" es 0 o negativo, o
// la lista llega vacía, devuelve un arreglo vacío (no hay fondo que mostrar, y el componente lo maneja).
export function pickTopByTmdb(releases: ReleaseSummary[], limit: number): ReleaseSummary[] {
  if (limit <= 0 || releases.length === 0) {
    return [];
  }
  // Copiamos antes de ordenar para no alterar el arreglo original (pureza).
  const sorted = [...releases].sort(sortByTmdbDesc);
  return sorted.slice(0, limit);
}

// ===== Gradientes de marcador (placeholder) portados del cascarón v3 =====
//
// En español: en Fase 0 los pósters y backdrops vienen vacíos (no hay imágenes reales todavía). En
// lugar de inventar imágenes, el cascarón v3 dibuja degradados deterministas: a cada estreno le toca
// SIEMPRE el mismo degradado según su índice, así el look es estable y reproducible. Portamos aquí el
// array de tríos de color "G" y la función "grad()" tal cual del cascarón (líneas 277-278), pero con
// nombres legibles y como helpers tipados.

// GRADIENT_TRIPLES es el array de tríos de color del cascarón v3 (su constante "G").
// En español: cada entrada son tres colores que arman un degradado diagonal (inicio, centro, fin).
// El orden y los valores son EXACTOS a los del cascarón para que el resultado visual sea idéntico.
const GRADIENT_TRIPLES: readonly (readonly [string, string, string])[] = [
  ["#1d3a5e", "#0d1524", "#3a2150"],
  ["#1f3a18", "#101a0e", "#3a2c0c"],
  ["#3a1320", "#140a16", "#0e2a3e"],
  ["#103a32", "#0a1418", "#2a3410"],
  ["#3a1820", "#120c18", "#0c2c3e"],
  ["#1e2a48", "#0c0f1c", "#3a2812"],
  ["#0e3036", "#0a1216", "#2c1c40"],
  ["#3a2c1a", "#120e0a", "#0a2a2e"],
  ["#241452", "#0c0a18", "#3a1420"],
  ["#103048", "#0a141e", "#28340f"],
  ["#3a2a0e", "#120c08", "#0a2c30"],
  ["#202a52", "#0e1020", "#3a1430"],
  ["#0e2a26", "#0a1414", "#341a3a"],
  ["#2a1838", "#140c1c", "#0c2a2c"],
  ["#341a14", "#160c0a", "#0c1c34"],
  ["#16203a", "#0a0e1a", "#341a2a"],
  ["#1a3420", "#0c160e", "#2a2410"],
] as const;

// gradientFor devuelve el valor de la propiedad CSS "background" (un degradado lineal) para un seed.
// En español: es el espejo de la función "grad(i,a)" del cascarón. Recibe un "seed" (normalmente el
// índice del estreno en la lista) y, opcionalmente, una opacidad (0 a 1, por defecto 1). Devuelve una
// cadena lista para poner en el atributo style, ej. "background:linear-gradient(...);opacity:1". El
// módulo (% longitud) hace que el seed "dé la vuelta" si supera el tamaño del array, igual que el
// cascarón, garantizando que SIEMPRE haya un degradado válido y determinista para cualquier número.
export function gradientFor(seed: number, opacity = 1): string {
  // Normalizamos el seed a un índice válido del array, replicando "i % G.length" del cascarón.
  // El doble módulo (sumando length) evita índices negativos si llegara un seed negativo por accidente.
  const length = GRADIENT_TRIPLES.length;
  const index = ((Math.trunc(seed) % length) + length) % length;
  const [start, middle, end] = GRADIENT_TRIPLES[index];
  // Mismo degradado diagonal a 140° con el centro al 50%, igual que el cascarón v3.
  return `background:linear-gradient(140deg,${start},${middle} 50%,${end});opacity:${opacity}`;
}

// GradientStyle es el degradado ya expresado como OBJETO de estilo (lo que React espera en "style").
// En español: el atributo "style" de React es un objeto, no una cadena de texto; este tipo nombra las
// dos propiedades que produce el degradado (el fondo y la opacidad).
export type GradientStyle = {
  // background es el valor del degradado lineal (la propiedad CSS "background").
  background: string;
  // opacity es la transparencia del degradado (0 a 1), como número (formato que pide React).
  opacity: number;
};

// gradientStyleFor devuelve el degradado determinista como OBJETO de estilo listo para React.
// En español: es el hermano de gradientFor pensado para componentes React. Mientras gradientFor
// devuelve TEXTO (como el cascarón, que lo inyecta en un atributo style de HTML), esta función
// devuelve el mismo degradado como objeto { background, opacity }, que es lo que el atributo "style"
// de React necesita. Así evitamos parsear cadenas en la interfaz y usamos un único origen del color.
export function gradientStyleFor(seed: number, opacity = 1): GradientStyle {
  const length = GRADIENT_TRIPLES.length;
  const index = ((Math.trunc(seed) % length) + length) % length;
  const [start, middle, end] = GRADIENT_TRIPLES[index];
  return {
    background: `linear-gradient(140deg,${start},${middle} 50%,${end})`,
    opacity,
  };
}

// seedFromId convierte el id (texto) de un estreno en un número ESTABLE para sembrar sus degradados.
// En español: derivar la semilla de la POSICIÓN en una lista hace que el color de un título cambie
// cuando la lista cambia (p. ej. al quitar otro elemento de la watchlist). Derivarla del id (sumando
// los códigos de sus caracteres) da siempre el mismo color al mismo título, en cualquier pantalla.
export function seedFromId(id: string): number {
  let sum = 0;
  for (let index = 0; index < id.length; index += 1) {
    sum += id.charCodeAt(index);
  }
  return sum;
}

// cssUrl construye un valor CSS url("...") SEGURO a partir de una URL de imagen.
// En español: interpolar una URL cruda dentro de url(...) es una puerta a inyección de CSS — una URL
// con comillas o paréntesis rompería la declaración y podría colar directivas propias. Este helper
// (1) solo acepta esquemas seguros (https/http; nada de javascript: ni data: arbitrarios) y
// (2) escapa comillas y barras invertidas. Si la URL no es aceptable, devuelve "none" (sin imagen).
// TODOS los backgroundImage dinámicos del proyecto deben pasar por aquí.
export function cssUrl(url: string): string {
  if (!url) {
    return "none";
  }
  if (!/^https?:\/\//i.test(url)) {
    return "none";
  }
  const escaped = url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `url("${escaped}")`;
}

// coverStyleFor devuelve el estilo de una "portada": la imagen real si hay URL, o el degradado si no.
// En español: muchos elementos (el backdrop del héroe, la portada difuminada del modal, las cards)
// muestran una cubierta. Si el estreno trae una URL de imagen (de TMDB con token, o las de DEMO del
// seed), la usamos como fondo "cover" y SE VEN las portadas; si la URL viene vacía (Fase 0 sin datos
// reales), caemos al degradado determinista del cascarón. Así nunca queda un hueco: o imagen, o color.
export function coverStyleFor(
  url: string,
  seed: number,
  opacity = 1,
  sizes?: readonly TmdbDensityCandidate[],
): CSSProperties {
  if (!url) {
    return gradientStyleFor(seed, opacity);
  }
  return {
    backgroundImage: sizes === undefined ? cssUrl(url) : cssImageSet(url, sizes),
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    // Color de respaldo por si la imagen tarda o falla: un gris muy oscuro, no un hueco transparente.
    backgroundColor: "#0b0d12",
    opacity,
  };
}

// cssImageSet construye el fondo de una imagen de TMDB con una variante por densidad de pantalla.
//
// En español: muchas portadas se pintan pequeñas (una tarjeta de 132 píxeles, un chip de 250) pero se
// pedían en el tamaño que guarda el catálogo (pósters de 500, fondos de 1280): el teléfono bajaba
// varias veces los píxeles que iba a enseñar. Con image-set el navegador elige la variante de su
// densidad, y cada variante de la lista (ver COVER_SIZES) tiene holgura de sobra sobre lo que se
// pinta en una pantalla de esa densidad: nunca se ve una imagen más blanda que antes.
//
// Se escribe con el prefijo -webkit- a propósito: es la forma que entienden TODOS los navegadores
// actuales (Safari anterior a la 17 no entiende la versión sin prefijo y se quedaría sin imagen).
// Si la URL no es de TMDB no hay variantes que pedir y se usa tal cual.
export function cssImageSet(url: string, sizes: readonly TmdbDensityCandidate[]): string {
  if (cssUrl(url) === "none") {
    return "none";
  }
  if (!isTmdbImage(url) || sizes.length === 0) {
    return cssUrl(url);
  }
  const candidates = sizes.map(
    ([width, density]) => `${cssUrl(tmdbImageAt(url, width))} ${density}x`,
  );
  return `-webkit-image-set(${candidates.join(", ")})`;
}

// COVER_SIZES son las variantes de cada portada pequeña, calculadas con su tamaño REAL en pantalla.
//
// Cómo se leen: con background-size: cover la imagen se escala hasta cubrir la caja, así que su ancho
// pintado es max(ancho, alto × proporción) — 16:9 en los fondos, 2:3 en los pósters. Ese ancho, por la
// densidad de la pantalla (1×, 2×, 3×), da los píxeles que se pintan. Cada variante tiene como mínimo
// 2,5 veces esos píxeles, y nunca más que la imagen que guarda el catálogo (póster w500, fondo w1280).
// Por qué tanta holgura: las variantes pequeñas de TMDB ya vienen algo blandas de origen, y una que
// apenas alcanza el tamaño final se nota (se comprobó a simple vista: un póster de 154 pintado a 132,
// o uno de 92 pintado a 46, perdían detalle y contraste). Con 2,5 veces o más, la imagen reducida no
// se distingue de la que se reducía desde el original. El navegador toma la menor densidad que alcance
// la de su pantalla (o la mayor si ninguna llega), así que una variante "2x" también cubre las de 1×.
// Medido de 320 a 2560 píxeles de ventana (las cajas tienen tamaño fijo en CSS).
export const COVER_SIZES = {
  // Conexión de la ficha: caja de 132×82,5 → fondo pintado a 147 de ancho (368 / 735 / 1102).
  connection: [
    ["w780", 2],
    ["w1280", 3],
  ],
  // Póster de la tira de la saga: 132 de ancho (330 / 660 / 990).
  sagaPoster: [
    ["w342", 1],
    ["w500", 2],
  ],
  // Póster de un crédito en la página de una persona: 46 de ancho (115 / 230 / 345).
  creditPoster: [
    ["w154", 1],
    ["w342", 2],
    ["w500", 3],
  ],
  // El mismo hueco cuando el título no tiene póster y se usa su fondo: 46×69 → 123 de ancho
  // (308 / 615 / 922).
  creditBackdrop: [
    ["w780", 2],
    ["w1280", 3],
  ],
  // Póster de una entrada en la página de una saga: hasta 72 de ancho (180 / 360 / 540).
  sagaEntryPoster: [
    ["w185", 1],
    ["w500", 2],
  ],
  // Banner del chip de categoría en la espina: hasta 257 de ancho (643 / 1285).
  chipBanner: [
    ["w780", 1],
    ["w1280", 2],
  ],
} as const satisfies Record<string, readonly TmdbDensityCandidate[]>;
