"use client";

// Archivo: ReleaseDetail.tsx — El DETALLE RICO de un estreno (la "ficha" completa).
//
// En español: este es el componente CENTRAL del S7. Dibuja TODO lo que se sabe de una película o
// serie, en el mismo orden y look del cascarón v3 (su función buildDetail): el tráiler en grande
// enmarcado por rareza, el título con su fecha y géneros, las referencias a sitios de cine, la
// sinopsis, una galería "verla en acción", un video complementario, "dónde verlo" (cine/streaming/
// cadenas), la saga (si pertenece a una), el reparto y las voces de doblaje, la dirección y staff, y
// los idiomas. Cada sección DEGRADA con elegancia cuando viene vacía (en Fase 0 muchos campos —tráiler,
// imágenes, etc.— llegan vacíos): o se oculta, o muestra un mensaje claro en es-MX. NUNCA inventa datos.
//
// CONTRATO: este componente se exporta con nombre (`ReleaseDetail`), recibe una única prop
// `{ release: Release }` y renderiza el detalle completo. Lo usan la página /titulo/[id] y el modal
// de la línea de tiempo, sin cambiarle la firma.
//
// Rareza: el marco del tráiler héroe se deriva de la calificación de TMDB con deriveRarity (umbrales en
// @/lib/rarity), igual que las cards de la timeline. Gradientes placeholder: gradientStyleFor de
// @/lib/timeline rellena pósters/imágenes/avatares mientras (Fase 0) no hay imágenes reales.
//
// FUENTE DE VERDAD: el cascarón v3 (buildDetail ~líneas 402-437 y el CSS de .dr-hero/.refs/.gallery/
// .vcomp/.where-grid/.saga/.people/.person/.sect). El look se porta con los tokens del proyecto y las
// clases de efecto (marco de rareza, sheen) viven en globals.css (anuladas bajo prefers-reduced-motion).

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

import { AddToCalendarButton } from "@/components/AddToCalendarButton";
import { YouTubeEmbed } from "@/components/YouTubeEmbed";
import { ProfileActions } from "@/components/profile/ProfileActions";
import { RatingReview } from "@/components/profile/RatingReview";
import { SagaCarousel } from "@/components/SagaCarousel";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { useDialogEscape } from "@/lib/dialog-stack";
import { selectComplementaryVideo, selectTrailer } from "@/lib/trailer-selection";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useProfile } from "@/lib/profile-context";
import { isSeasonCollection, sagaSlug } from "@/lib/saga";
import { deriveRarity, type Tier } from "@/lib/rarity";
import {
  CATEGORY_META,
  COVER_SIZES,
  categoryKeyFromEnum,
  coverStyleFor,
  cssUrl,
  gradientStyleFor,
  seedFromId,
  type Connection,
  type ConnectionReason,
  type TodayMarker,
} from "@/lib/timeline";
import { jobLabel } from "@/lib/credit-labels";
import { ui } from "@/lib/i18n";
import {
  type Credit,
  type Image as CatalogImage,
  type Release,
  type ReleaseSummary,
} from "@/gen/mdm7mo/catalog/v1/catalog_pb";
import { TitleType } from "@/lib/catalog-enums";

// El MODAL de otra ficha se carga aparte, la primera vez que hace falta. Trae consigo el lector de
// fichas (y con él el motor de protobuf), que ninguna página necesita para pintarse: solo para abrir
// otro título encima. loadReleaseModal se adelanta cuando el navegador queda libre (ver abajo), así que
// al pulsar ya suele estar aquí.
const loadReleaseModal = () =>
  import("@/components/ReleaseModal").then((module) => module.ReleaseModal);
const ReleaseModal = dynamic(loadReleaseModal, { ssr: false });

// LANGUAGE_ALIASES mapea el CÓDIGO de idioma del perfil (es/en/…) a los NOMBRES con que puede aparecer en
// el catálogo (inglés y español, en minúsculas), para poder resaltar el idioma preferido del usuario.
const LANGUAGE_ALIASES: Record<string, string[]> = {
  es: ["spanish", "español", "castilian", "es"],
  en: ["english", "inglés", "ingles", "en"],
  fr: ["french", "francés", "frances", "fr"],
  pt: ["portuguese", "portugués", "portugues", "pt"],
  ja: ["japanese", "japonés", "japones", "ja"],
};

// SPANISH_LANGUAGE_PREFIX es cómo empieza cualquier etiqueta de idioma española ("es-MX", "es-ES", "es").
// En español: se nombra en vez de escribirlo suelto porque de esta comparación depende que aparezca o no
// el aviso de "esta sinopsis no está en español", y un error de dedo lo dejaría encendido para siempre.
const SPANISH_LANGUAGE_PREFIX = "es";

// isNonSpanishOverview indica si la sinopsis que llegó NO está en español y por tanto hay que avisarlo.
//
// En español: el catálogo anota en qué idioma quedó cada sinopsis ("es-MX" si está la mexicana, "es-ES"
// si hubo que usar la de España, "en-US" si solo existía en inglés). Cualquier variante del español se
// muestra sin aviso: se lee igual de bien y decir algo solo estorbaría. El inglés —o cualquier otro
// idioma— sí se avisa. Si el catálogo no anotó nada (un estreno generado antes de que existiera este
// dato), tampoco se avisa: no sabemos el idioma y suponerlo sería peor que callar.
function isNonSpanishOverview(overviewLanguage: string): boolean {
  if (!overviewLanguage) {
    return false;
  }
  return !overviewLanguage.toLowerCase().startsWith(SPANISH_LANGUAGE_PREFIX);
}

// matchesPreferredLanguage indica si un idioma (por nombre o código) coincide con la preferencia del usuario.
function matchesPreferredLanguage(language: string, preferredCode: string): boolean {
  const aliases = LANGUAGE_ALIASES[preferredCode];
  if (aliases === undefined) {
    return false;
  }
  return aliases.includes(language.trim().toLowerCase());
}

// ReleaseDetailProps son las propiedades del detalle rico.
// En español: la prop principal es { release }. Además acepta `related` (OPCIONAL): las conexiones reales
// del catálogo (misma saga / mismo director / por género) que calcula quien renderiza (tiene el catálogo
// cargado), porque la ficha por sí sola no conoce los demás títulos. Si no llega, la sección no aparece.
type ReleaseDetailProps = {
  // release es la ficha completa del estreno (modelo canónico Release del catálogo).
  release: Release;
  // related son los estrenos conectados (con su motivo). Opcional: si va vacío/ausente, no se muestra.
  related?: Connection[];
  // upcoming indica si el estreno es FUTURO (aún no estrenado): solo entonces, sin nota, mostramos
  // "Próximamente" en el badge; si ya pasó sin nota, no lo decimos. Lo calcula quien monta el detalle.
  upcoming?: boolean;
  // today es el marcador HOY (opcional): alimenta el calendario de emisión (resaltar "hoy" y decidir
  // qué entregas son próximas) y el "Próximamente" de las fichas encadenadas en el modal.
  today?: TodayMarker;
  // catalog es el catálogo cargado en su forma LIGERA (opcional): permite abrir el MODAL de detalle
  // completo al pulsar conexiones o entradas de saga que existen en el catálogo (y encadenar fichas
  // dentro del modal). Son RESÚMENES, no fichas: la ficha completa del título que se pulse la pide el
  // propio modal en ese instante, que es lo que hace que la lista no tenga que cargarlas todas.
  catalog?: ReleaseSummary[];
  // onOpenRelease (opcional) reemplaza el comportamiento de "abrir modal": cuando esta ficha YA vive
  // dentro del modal de detalle, el modal pasa este gancho para que pulsar un relacionado REEMPLACE la
  // ficha mostrada (una sola capa de diálogo) en vez de apilar otro modal encima.
  onOpenRelease?: (release: ReleaseSummary) => void;
  // isPageHeading dice que el título de esta ficha es el ENCABEZADO PRINCIPAL de la pantalla.
  //
  // Por qué hace falta decidirlo desde fuera, en español: esta misma ficha se enseña en dos sitios muy
  // distintos. Cuando ocupa su propia dirección (/titulo/…), su título ES el nombre de la pantalla y
  // tiene que ser el encabezado de nivel 1: sin él, quien navega escuchando aterriza en una página sin
  // nombre y no puede saltar al contenido. Cuando en cambio vive dentro de una ventana abierta sobre
  // la línea de tiempo, la pantalla ya tiene su propio encabezado principal y este debe quedar un
  // escalón por debajo, o el índice de encabezados de la página se rompe con dos "nivel 1".
  //
  // Por defecto va en falso, que es el caso conservador: un nivel 1 de más rompe la estructura; uno de
  // menos en un sitio que no lo necesita, no.
  isPageHeading?: boolean;
};

// TIER_LABELS traduce cada nivel de rareza a su etiqueta visible en es-MX (desde i18n).
// En español: el código interno usa palabras en inglés (legendary/epic/...); aquí las pasamos al
// texto que ve el usuario, sin escribir literales sueltos. Reutiliza el mismo origen que el Hero.
const TIER_LABELS: Record<Tier, string> = {
  legendary: ui.tiers.legendary,
  epic: ui.tiers.epic,
  rare: ui.tiers.rare,
  common: ui.tiers.common,
};

// TIER_TOKENS asigna a cada rareza su variable CSS de color de acento (igual criterio que el Hero).
// En español: cada nivel se pinta con su color (oro claro legendario, violeta épico, teal raro, gris
// tenue común), usando los tokens del proyecto para no escribir colores sueltos.
const TIER_TOKENS: Record<Tier, string> = {
  legendary: "var(--color-gold-bright)",
  epic: "var(--color-violet)",
  rare: "var(--color-teal)",
  common: "var(--color-text-subtle)",
};

// TYPE_LABELS traduce el tipo de título (película/serie) a su etiqueta es-MX.
// En español: el modelo trae el tipo como enum (MOVIE/SERIES); aquí lo pasamos al texto del badge.
// Los textos salen del catálogo i18n (ui.types), la fuente única de etiquetas de tipo.
const TYPE_LABELS: Record<TitleType, string> = {
  [TitleType.TITLE_TYPE_UNSPECIFIED]: ui.types.release,
  [TitleType.MOVIE]: ui.types.movie,
  [TitleType.SERIES]: ui.types.series,
};

// TYPE_TOKENS asigna al tipo su color en el badge (oro claro para película, teal para serie).
// En español: espeja el cascarón (isMv ? gold-bright : teal). Es solo color del rótulo del tipo.
const TYPE_TOKENS: Record<TitleType, string> = {
  [TitleType.TITLE_TYPE_UNSPECIFIED]: "var(--color-text-muted)",
  [TitleType.MOVIE]: "var(--color-gold-bright)",
  [TitleType.SERIES]: "var(--color-teal)",
};

// SEED_OFFSETS son los "saltos" de semilla del cascarón para variar los degradados dentro de una ficha.
// En español: el cascarón usa el índice del estreno + un número distinto para cada zona (galería,
// video complementario, saga, avatares) para que NO se repita el mismo degradado por toda la ficha. Sin
// un índice de lista aquí (recibimos solo el estreno), derivamos una semilla base estable del id (ver
// seedFromId) y le sumamos estos offsets, conservando el espíritu del cascarón (variedad determinista).
const SEED_OFFSET_HERO = 0;
const SEED_OFFSET_SAGA = 1;
const SEED_OFFSET_GALLERY = 3;
const SEED_OFFSET_COMPLEMENTARY = 7;
const SEED_OFFSET_CAST = 11;
const SEED_OFFSET_CREW = 23;

// seedFromId vive ahora en @/lib/timeline (compartido con el perfil); se importa arriba.

// formatReleaseDate convierte una fecha ISO (AAAA-MM-DD) a texto legible es-MX, en UTC.
// En español: el backend manda "2026-06-15"; aquí lo mostramos como "15 jun 2026". Leemos en UTC para
// que la fecha no se "corra un día" según la zona horaria. Si la fecha viniera vacía o mal formada,
// devolvemos cadena vacía (la sub-cabecera la oculta) para no mostrar un dato roto.
function formatReleaseDate(isoDate: string): string {
  if (!isoDate) {
    return "";
  }
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString("es-MX", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// initials saca hasta dos iniciales de un nombre, para el avatar de respaldo (sin foto real).
// En español: espeja la función cap() del cascarón. Toma la primera letra de las dos primeras
// palabras del nombre (ej. "Helena Vidal" -> "HV"). Si el nombre viene vacío, devuelve cadena vacía.
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0])
    .slice(0, 2)
    .join("");
}

// SearchSource describe una fuente de referencia externa (TMDB/IMDb/…): su rótulo, valor y buscador.
// En español: en Fase 0 no tenemos el id externo de cada sitio, así que en lugar de un enlace directo
// armamos un enlace de BÚSQUEDA por título (abre el sitio buscando el nombre del estreno). Este tipo
// junta todo lo que cada tarjeta de referencia necesita para dibujarse y enlazar.
type SearchSource = {
  // sourceLabel es el nombre visible de la fuente (TMDB, IMDb, Rotten Tomatoes, Metacritic).
  sourceLabel: string;
  // value es el dato a mostrar (ej. "8.6", "93%"); ya viene listo para pintar.
  value: string;
  // unit es el sufijo pequeño opcional (ej. "/10" para las notas sobre diez). Vacío si no aplica.
  unit: string;
  // searchUrl es el enlace de búsqueda por título en ese sitio (se abre en otra pestaña).
  searchUrl: string;
};

// SEARCH_BASE_TMDB/IMDB/RT/METACRITIC son las bases de búsqueda por título de cada sitio externo.
// En español: a cada una se le añade el título del estreno (codificado) para abrir la página del sitio
// con ese término buscado. Son las URLs públicas de búsqueda de cada servicio (no exponen ninguna key).
const SEARCH_BASE_TMDB = "https://www.themoviedb.org/search?query=";
const SEARCH_BASE_IMDB = "https://www.imdb.com/find?q=";
const SEARCH_BASE_ROTTEN_TOMATOES = "https://www.rottentomatoes.com/search?search=";
const SEARCH_BASE_METACRITIC = "https://www.metacritic.com/search/";

// buildSearchSources arma la lista de referencias QUE TIENEN VALOR para un estreno.
// En español: recorre las cuatro fuentes; incluye una solo si su dato existe (TMDB existe si la nota es
// mayor que 0; las demás existen si su texto no está vacío). Así nunca pintamos una referencia hueca.
// El enlace de cada una busca el TÍTULO del estreno en el sitio correspondiente (abre en otra pestaña).
function buildSearchSources(release: Release): SearchSource[] {
  // Codificamos el título una sola vez para reutilizarlo en las cuatro URLs de búsqueda.
  const encodedTitle = encodeURIComponent(release.title);
  const sources: SearchSource[] = [];

  // TMDB: la nota es numérica (0-10). La consideramos presente solo si es mayor que 0 (0 = sin nota).
  const tmdbScore = release.ratings?.tmdb ?? 0;
  if (tmdbScore > 0) {
    sources.push({
      sourceLabel: ui.detail.sourceTmdb,
      value: tmdbScore.toFixed(1),
      unit: "/10",
      searchUrl: `${SEARCH_BASE_TMDB}${encodedTitle}`,
    });
  }

  // IMDb: texto opcional (de OMDb). Presente si no está vacío. Se muestra sobre diez.
  const imdb = release.ratings?.imdb ?? "";
  if (imdb) {
    sources.push({
      sourceLabel: ui.detail.sourceImdb,
      value: imdb,
      unit: "/10",
      searchUrl: `${SEARCH_BASE_IMDB}${encodedTitle}`,
    });
  }

  // Rotten Tomatoes: porcentaje en texto (ej. "93%"). Presente si no está vacío; sin sufijo.
  const rottenTomatoes = release.ratings?.rottenTomatoes ?? "";
  if (rottenTomatoes) {
    sources.push({
      sourceLabel: ui.detail.sourceRottenTomatoes,
      value: rottenTomatoes,
      unit: "",
      searchUrl: `${SEARCH_BASE_ROTTEN_TOMATOES}${encodedTitle}`,
    });
  }

  // Metacritic: puntaje en texto (ej. "78"). Presente si no está vacío; sin sufijo.
  const metacritic = release.ratings?.metacritic ?? "";
  if (metacritic) {
    sources.push({
      sourceLabel: ui.detail.sourceMetacritic,
      value: metacritic,
      unit: "",
      searchUrl: `${SEARCH_BASE_METACRITIC}${encodedTitle}`,
    });
  }

  return sources;
}

// WhereRow describe una fila de "Dónde verlo": su etiqueta, su color de viñeta y sus chips.
// En español: cada canal (Cine / Streaming / Cadenas) es una fila con un puntito de color y una lista
// de "chips" (las plataformas o cadenas). Este tipo junta lo necesario para pintar cada fila.
type WhereRow = {
  // rowKey identifica la fila para la "key" de React y para el color del puntito.
  rowKey: "cine" | "streaming" | "tv";
  // label es el texto de la fila (Cine / Streaming / Cadenas).
  label: string;
  // dotColor es la variable CSS del color del puntito de la fila (oro / teal / violeta).
  dotColor: string;
  // chips son los nombres a mostrar como píldoras (plataformas, cadenas o "En salas").
  chips: string[];
  // chipColor es la variable CSS del color del texto de los chips (acento de la fila), o texto tenue.
  chipColor: string;
};

// buildWhereRows arma las filas de "Dónde verlo" según la disponibilidad del estreno.
// En español: espeja la lógica del cascarón. Si NO hay plataformas ni cadenas, el estreno es de CINE y
// mostramos el chip "En salas". Si hay plataformas, mostramos la fila de Streaming con cada una. Si hay
// cadenas, mostramos la fila de Cadenas con cada una. Pueden coexistir (ej. una serie en HBO y Max).
function buildWhereRows(release: Release): WhereRow[] {
  const platforms = release.availability?.platforms ?? [];
  const networks = release.availability?.networks ?? [];
  const rows: WhereRow[] = [];

  // Sin plataformas NI cadenas: es un estreno de cine (en salas). Es el caso por defecto del cascarón.
  if (platforms.length === 0 && networks.length === 0) {
    rows.push({
      rowKey: "cine",
      label: ui.detail.whereCine,
      dotColor: "var(--color-gold)",
      chips: [ui.detail.inTheaters],
      chipColor: "var(--color-gold-bright)",
    });
  }

  // Plataformas de streaming (Netflix, Max, …): una fila con un chip por plataforma.
  if (platforms.length > 0) {
    rows.push({
      rowKey: "streaming",
      label: ui.detail.whereStreaming,
      dotColor: "var(--color-teal)",
      chips: platforms,
      chipColor: "var(--color-text-muted)",
    });
  }

  // Cadenas de TV (HBO, Sony, …): una fila con un chip por cadena.
  if (networks.length > 0) {
    rows.push({
      rowKey: "tv",
      label: ui.detail.whereTv,
      dotColor: "var(--color-violet)",
      chips: networks,
      chipColor: "var(--color-violet)",
    });
  }

  return rows;
}

// REASON_LABELS traduce el motivo de una conexión a su etiqueta visible en es-MX (para la tarjeta).
const REASON_LABELS: Record<ConnectionReason, string> = {
  saga: ui.detail.reasonSaga,
  director: ui.detail.reasonDirector,
  cast: ui.detail.reasonCast,
  genre: ui.detail.reasonGenre,
};

// watchSearchUrl arma un enlace de BÚSQUEDA del título en una plataforma (Google "título plataforma").
// En español: en Fase 0 no tenemos el enlace directo del estreno en cada plataforma, así que abrimos una
// búsqueda en otra pestaña con el título + la plataforma. Es real (lleva a algo útil) y no inventa una URL.
function watchSearchUrl(platform: string, title: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${title} ${platform}`)}`;
}

// ReleaseDetail dibuja la ficha completa del estreno recibido (el detalle rico del S7).
// En español: arma cada sección en el ORDEN del cascarón y degrada con elegancia las que no aplican.
// Es la "vista" pura del estreno: no hace fetch ni navega; solo recibe el estreno y lo presenta. La
// única interacción propia es la del tráiler/video (carga perezosa), que vive en YouTubeEmbed.
export function ReleaseDetail({
  release,
  related = [],
  upcoming = false,
  today,
  catalog = [],
  onOpenRelease,
  isPageHeading = false,
}: ReleaseDetailProps) {
  // TitleHeading es la etiqueta con la que se escribe el título del estreno: el encabezado principal
  // de la pantalla cuando esta ficha ocupa su propia dirección, y uno de segundo nivel cuando vive
  // dentro de una ventana. Se resuelve aquí, una sola vez, para que el título se escriba en un único
  // sitio del archivo (si hubiera dos bloques, uno por nivel, acabarían enseñando cosas distintas).
  const TitleHeading = isPageHeading ? "h1" : "h2";
  // lightbox guarda la imagen de la galería AMPLIADA (o null si no hay ninguna abierta).
  const [lightbox, setLightbox] = useState<CatalogImage | null>(null);

  // Escape cierra el lightbox vía la pila compartida de diálogos (antes el lightbox NI SIQUIERA
  // escuchaba Escape: solo se cerraba con clic — hueco de a11y de teclado).
  useDialogEscape(lightbox !== null, () => setLightbox(null));

  // Trampa de foco del lightbox: foco al botón de cerrar al abrir, Tab contenido, retorno al cerrar.
  const lightboxTrapRef = useFocusTrap<HTMLDivElement>(lightbox !== null);

  // modalRelease es el RESUMEN del título del catálogo cuyo MODAL de detalle está abierto (o null).
  // Solo se usa cuando esta ficha NO vive ya dentro del modal (onOpenRelease ausente): dentro del
  // modal, pulsar un relacionado REEMPLAZA la ficha mostrada en vez de apilar otro diálogo.
  // Es el RESUMEN y no la ficha porque aquí solo se sabe eso: el modal pide la ficha al montarse.
  const [modalRelease, setModalRelease] = useState<ReleaseSummary | null>(null);

  // handleOpenRelease abre la ficha completa de un título del catálogo: dentro del modal la reemplaza
  // (onOpenRelease); fuera, monta el modal de detalle completo con ese título.
  const handleOpenRelease = useCallback(
    (target: ReleaseSummary) => {
      if (onOpenRelease !== undefined) {
        onOpenRelease(target);
        return;
      }
      setModalRelease(target);
    },
    [onOpenRelease],
  );

  // Semilla base estable de los degradados de esta ficha (derivada del id; ver seedFromId).
  const baseSeed = seedFromId(release.id);

  // Idioma preferido del usuario (perfil local): para subtítulos del tráiler y resaltar "Idiomas".
  const { profile } = useProfile();
  const preferredLanguage = profile.settings.language;

  // ELECCIÓN DEL TRÁILER según el idioma que la persona eligió en su perfil.
  //
  // En español: el catálogo entrega TODOS los videos del estreno, cada uno etiquetado con su idioma,
  // su país, quién lo publicó y si se comprobó que reproduce. Aquí se decide cuál de ellos ve ESTA
  // persona: primero el doblaje mexicano, luego el de España, luego el inglés con aviso… La cadena
  // completa vive en lib/trailer-selection, aparte y probada por su cuenta, porque es la lógica que
  // decide qué ve alguien y no debería hacer falta abrir un navegador para saber si acierta.
  //
  // Si devuelve undefined es que este título no tiene tráiler en ninguna parte. No es un error: pasa
  // en casi 4 de cada 10 títulos. El reproductor pinta entonces su estado "sin tráiler".
  const trailerChoice = selectTrailer(release.videos, preferredLanguage);
  const complementaryVideo = selectComplementaryVideo(
    release.videos,
    preferredLanguage,
    trailerChoice?.video.youtubeKey,
  );

  // Rareza del estreno a partir de su nota de TMDB (0 si falta) -> marco del tráiler héroe y badge.
  const tmdbScore = release.ratings?.tmdb ?? 0;
  const tier = deriveRarity(tmdbScore);

  // Textos del tipo (Película/Serie) y su color para el badge superior.
  const typeLabel = TYPE_LABELS[release.type];
  const typeColor = TYPE_TOKENS[release.type];

  // Color de acento de la CATEGORÍA (Cine/Streaming/Cadenas/Indie) para la barra del hero: identidad por
  // categoría + relieve. Si la categoría no mapea (no debería), caemos al oro de marca.
  const categoryKey = categoryKeyFromEnum(release.category);
  const accentVar = categoryKey ? CATEGORY_META[categoryKey].accentVar : "var(--color-gold)";

  // Fecha formateada en es-MX (vacía si no hay fecha válida: la sub-cabecera la omite).
  const formattedDate = formatReleaseDate(release.releaseDate);

  // Referencias con valor, filas de "dónde verlo" y datos de saga/personas, calculados una vez.
  const searchSources = buildSearchSources(release);
  const whereRows = buildWhereRows(release);

  // Saga: solo se muestra si el estreno pertenece a una colección con al menos una entrada.
  const sagaItems = release.saga?.items ?? [];
  const hasSaga = release.saga !== undefined && sagaItems.length > 0;

  // ¿Se ofrece el enlace a la PÁGINA de la saga? Solo cuando esto es una saga de verdad.
  //
  // LA DECISIÓN, y por qué es esta, en español: cuando el título es una serie, lo que el catálogo
  // guarda como "saga" son SUS PROPIAS TEMPORADAS. Y una temporada no es un estreno del catálogo: no
  // tiene ficha, no tiene dirección y no va a tenerlas. Se midió, y el resultado es demoledor: 179 de
  // las 193 sagas del catálogo (el 93 %) son de este tipo, y en ellas la página de la saga enseñaba
  // TODAS sus entradas marcadas como "no está en este catálogo" —incluida la serie de la que se
  // acababa de salir—, sin un solo enlace que pulsar. Nueve de cada diez veces, ese botón llevaba a un
  // callejón sin salida.
  //
  // Se descartó la otra salida posible —emparejar las entradas por el número de identidad del estreno
  // en vez de por su título— porque no arregla ESTE caso: por bien que se empareje, una temporada
  // sigue sin ser un estreno y sigue sin haber ficha a la que ir. Sí se aplicó donde sí cambia algo
  // (ver el emparejamiento por dueños en lib/saga).
  //
  // La tira de temporadas de aquí arriba NO se toca: enseña las temporadas con su carátula y su
  // número de episodios, que es justo lo que alguien quiere ver de una serie. Lo único que desaparece
  // es la invitación a ir a una página que no tiene nada que ofrecer. Y quien llegue a esa página por
  // un enlace ya compartido la sigue encontrando: no se ha roto ninguna dirección.
  const offersSagaPage = hasSaga && !isSeasonCollection(release);

  // Si desde esta ficha se puede abrir otra (conexiones o saga), el código del modal se pide en cuanto
  // el navegador queda libre: así no pesa al cargar la página y ya está a mano al pulsar.
  const canOpenModal = onOpenRelease === undefined && (related.length > 0 || hasSaga);
  useEffect(() => {
    if (!canOpenModal) {
      return;
    }
    const preload = () => {
      void loadReleaseModal().catch(() => {});
    };
    if (typeof window.requestIdleCallback !== "function") {
      const timer = window.setTimeout(preload, 1);
      return () => window.clearTimeout(timer);
    }
    const handle = window.requestIdleCallback(preload, { timeout: 3000 });
    return () => window.cancelIdleCallback(handle);
  }, [canOpenModal]);

  return (
    // Contenedor del detalle: ancho cómodo de lectura y espaciado generoso. El padre (página o modal)
    // decide el marco exterior (scroll, fondo); aquí solo va el CONTENIDO de la ficha.
    <article className="font-ui flex flex-col">
      {/*
        ===== Video héroe (tráiler) + badge tipo/tier =====
        Tráiler en grande, enmarcado por la rareza del estreno (deriveRarity). Carga perezosa: hasta
        pulsar "reproducir" no se inserta el iframe. Si no hay key (Fase 0), muestra "Tráiler no
        disponible" con el mismo marco. El badge (tipo + rareza) va justo debajo, como en el cascarón.
      */}
      {/*
        HERO cinematográfico: el tráiler usa el BACKDROP real como póster y lleva el badge + título +
        sub-cabecera SUPERPUESTOS en su base (overlay). El clic en cualquier parte reproduce el tráiler;
        al reproducir, el overlay desaparece (solo video). Así el detalle abre como una portada de cine,
        no como una caja plana. El overlay no captura el puntero (el clic llega al botón de reproducir).
      */}
      <YouTubeEmbed
        video={trailerChoice?.video}
        notice={trailerChoice?.notice}
        title={release.title}
        framed={tier}
        caption={ui.detail.trailerCaption}
        seed={baseSeed + SEED_OFFSET_HERO}
        posterUrl={release.backdropUrl}
        captionLang={preferredLanguage}
        overlay={
          <div className="rf-hero-meta" style={{ "--accent": accentVar } as CSSProperties}>
            {/* Barra de acento de la categoría: relieve + identidad por categoría a la izquierda del bloque. */}
            <span className="rf-hero-accent" aria-hidden="true" />
            <div className="min-w-0">
              {/* Badge: tipo + rareza (o "Próximamente" si es futuro sin nota). */}
              <div className="font-mono mb-[7px] flex items-center gap-[9px] text-[11px] tracking-[0.12em] uppercase">
                <span style={{ color: typeColor }}>{typeLabel}</span>
                {tmdbScore > 0 ? (
                  <span style={{ color: TIER_TOKENS[tier] }}>
                    <span aria-hidden="true">◆ </span>
                    {TIER_LABELS[tier]}
                  </span>
                ) : upcoming ? (
                  <span style={{ color: "var(--color-gold-bright)" }}>Próximamente</span>
                ) : null}
              </div>
              {/* Título del estreno (encabezado de la ficha), superpuesto sobre el backdrop. El NIVEL
                  del encabezado lo decide quien monta la ficha: ver isPageHeading. */}
              <TitleHeading className="font-display text-xl leading-[1.06] font-medium tracking-[-0.01em] text-text sm:text-[28px]">
                {release.title}
              </TitleHeading>
              {/* Sub-cabecera: fecha · géneros (si los hay). */}
              {formattedDate || release.genres.length > 0 ? (
                <div className="mt-[8px] flex flex-wrap items-center gap-[11px] text-[13px] text-text-muted">
                  {formattedDate ? <span>{formattedDate}</span> : null}
                  {formattedDate && release.genres.length > 0 ? <Separator /> : null}
                  {release.genres.length > 0 ? <span>{release.genres.join(", ")}</span> : null}
                </div>
              ) : null}
            </div>
          </div>
        }
      />

      {/* Cuerpo de la ficha: todas las secciones, con padding propio. El badge/título/meta ahora viven
          SUPERPUESTOS en el hero de arriba (no se repiten aquí). */}
      <div className="flex flex-col px-1 pt-5 sm:px-2">
        {/* Acciones de perfil: añadir a "Quiero ver" / marcar "Vista" (gestión personal del estreno). */}
        <div className="mb-4">
          <ProfileActions releaseId={release.id} />
        </div>
        {/* Exportar al calendario: descarga este estreno como evento .ics para Google Calendar,
            Apple Calendario u Outlook. Va junto a las acciones de perfil porque es lo mismo:
            "quiero acordarme de esto". Si el título no tiene fecha, el botón se explica en su lugar. */}
        <div className="mb-4">
          <AddToCalendarButton release={release} />
        </div>
        {/* Reseña personal: barra de calificación 1–10 (con decimales). Guarda en el perfil al cambiar. */}
        <div className="mb-6">
          <RatingReview releaseId={release.id} />
        </div>
        {/*
          ===== Referencias (TMDB/IMDb/Rotten Tomatoes/Metacritic) =====
          Solo se muestran las fuentes con valor. Cada una es un enlace de BÚSQUEDA por título que abre
          el sitio en otra pestaña (rel="noopener noreferrer" por seguridad). Si NINGUNA tiene valor, la
          sección entera se oculta (en Fase 0, donde los ratings llegan vacíos, esto degrada limpio).
        */}
        {searchSources.length > 0 ? (
          <Section label={ui.detail.referencesLabel}>
            <div className="flex flex-wrap gap-[9px]">
              {searchSources.map((source) => (
                <a
                  key={source.sourceLabel}
                  href={source.searchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={ui.detail.searchOnAria(release.title, source.sourceLabel)}
                  className="rf-ref min-w-[92px] flex-1 rounded-sm border px-3 py-[11px] text-center no-underline"
                  style={REF_CARD_STYLE}
                >
                  {/* Rótulo de la fuente (monoespaciado y tenue). */}
                  <span className="font-mono block text-[9px] tracking-[0.1em] uppercase text-text-subtle">
                    {source.sourceLabel}
                  </span>
                  {/* Valor de la nota (en oro claro display) con su sufijo pequeño (ej. "/10"). */}
                  <span className="font-display mt-[5px] block text-[19px] text-gold-bright">
                    {source.value}
                    {source.unit ? (
                      <small className="text-[11px] text-text-subtle">{source.unit}</small>
                    ) : null}
                  </span>
                </a>
              ))}
            </div>
          </Section>
        ) : null}

        {/*
          ===== Sinopsis =====
          Si el estreno trae sinopsis, la mostramos; si no, un texto de respaldo en es-MX para no dejar
          el bloque vacío (la sección de sinopsis siempre aparece, porque es información esencial).

          EL AVISO DE IDIOMA. El catálogo pide las sinopsis en español de México, pero TMDB no lo tiene
          todo traducido: uno de cada cuatro estrenos venía sin una línea de texto. Ahora, cuando falta,
          se busca en cualquier otro español y, si tampoco existe, en inglés. Ese último caso SE AVISA:
          poner un párrafo en inglés sin decir nada haría parecer que la aplicación está a medio
          traducir por descuido, cuando lo que pasa es que nadie ha escrito todavía esa sinopsis en
          español. El aviso solo aparece cuando el texto no está en español; el respaldo entre españoles
          (el de España, por ejemplo) no necesita explicación porque se lee igual de bien.
        */}
        <Section label={ui.detail.synopsisLabel}>
          {release.overview ? (
            <>
              {isNonSpanishOverview(release.overviewLanguage) ? (
                <p className="font-mono mb-[9px] text-[10px] tracking-[0.1em] uppercase text-text-subtle">
                  {ui.detail.synopsisForeignNotice}
                </p>
              ) : null}
              {/* lang le dice al navegador y al lector de pantalla en qué idioma está este párrafo, para
                  que lo pronuncie correctamente en vez de leer inglés con fonética española. */}
              <p
                lang={release.overviewLanguage || undefined}
                className="text-sm leading-[1.65] text-text-muted"
              >
                {release.overview}
              </p>
            </>
          ) : (
            <p className="text-sm leading-[1.65] text-text-muted">{ui.detail.noSynopsis}</p>
          )}
        </Section>

        {/*
          ===== Verla en acción (galería) =====
          Galería horizontal de imágenes. En Fase 0 vienen vacías o sin URL: cada celda usa un degradado
          determinista (gradientStyleFor) y su etiqueta. Si NO hay ninguna imagen, mostramos un mensaje
          claro en es-MX en lugar de una galería vacía.
        */}
        <Section label={ui.detail.galleryLabel}>
          {release.images.length > 0 ? (
            <div className="rf-gallery flex gap-[9px] overflow-x-auto pb-[6px]">
              {release.images.map((image, index) => (
                <GalleryItem
                  key={`${image.label}-${index}`}
                  image={image}
                  seed={baseSeed + SEED_OFFSET_GALLERY + index}
                  onOpen={() => setLightbox(image)}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">{ui.detail.noGallery}</p>
          )}
        </Section>

        {/*
          ===== Video complementario =====
          Otro YouTubeEmbed (featurette, detrás de cámaras, …) con su propia carga perezosa. Sin marco
          de rareza (no es el héroe), por eso no se le pasa "framed": el contenido secundario no compite
          visualmente con el tráiler principal.

          LA SECCIÓN ENTERA DESAPARECE cuando no hay un segundo video, en vez de dibujar un recuadro que
          dice "no disponible". Antes se enseñaba siempre, así que más de la mitad de las fichas tenían
          un hueco anunciando algo que no existía. Una sección menos se lee como una ficha más corta; un
          recuadro vacío se lee como algo que se rompió.
        */}
        {complementaryVideo !== undefined ? (
          <Section label={ui.detail.complementaryLabel}>
            <YouTubeEmbed
              video={complementaryVideo}
              title={release.title}
              caption={ui.detail.complementaryLabel}
              unavailableLabel={ui.detail.complementaryUnavailable}
              seed={baseSeed + SEED_OFFSET_COMPLEMENTARY}
              captionLang={preferredLanguage}
            />
          </Section>
        ) : null}

        {/*
          ===== Dónde verlo =====
          Filas seccionadas: Cine (chip "En salas" cuando no hay plataformas ni cadenas), Streaming
          (plataformas) y Cadenas (networks). Siempre hay al menos una fila (el cine por defecto), así
          que la sección siempre tiene contenido.
        */}
        <Section label={ui.detail.whereToWatchLabel}>
          <div className="flex flex-col gap-[13px]">
            {whereRows.map((row) => (
              <div key={row.rowKey} className="flex items-center gap-[13px]">
                {/* Etiqueta de la fila con su puntito de color (oro/teal/violeta). */}
                <span className="font-mono flex min-w-[78px] items-center gap-[7px] text-[10px] tracking-[0.1em] uppercase text-text-subtle">
                  <span
                    aria-hidden="true"
                    className="h-[6px] w-[6px] rounded-full"
                    style={{ background: row.dotColor }}
                  />
                  {row.label}
                </span>
                {/* Chips de la fila. Las plataformas/cadenas (streaming/tv) son CLICABLES: abren una
                    búsqueda del título en esa plataforma (en otra pestaña). "En salas" (cine) no enlaza. */}
                <span className="flex flex-wrap gap-[7px]">
                  {row.chips.map((chip) =>
                    row.rowKey === "cine" ? (
                      <Chip key={chip} color={row.chipColor}>
                        {chip}
                      </Chip>
                    ) : (
                      <ChipLink
                        key={chip}
                        color={row.chipColor}
                        href={watchSearchUrl(chip, release.title)}
                        ariaLabel={ui.detail.watchOnAria(release.title, chip)}
                      >
                        {chip}
                      </ChipLink>
                    ),
                  )}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/*
          ===== Calendario de emisión (CONDICIONAL: series/periódicos con fechas reales) =====
          Solo aparece si el título trae su calendario (Schedule, generado desde TMDB): la lista de
          próximas entregas y los mini-calendarios por mes con los días de emisión marcados. Las
          películas no lo traen (su única fecha es release_date) y la sección no se dibuja.
        */}
        {release.schedule !== undefined && release.schedule.episodes.length > 0 ? (
          <Section label={ui.detail.scheduleLabel}>
            <ScheduleCalendar schedule={release.schedule} today={today} />
          </Section>
        ) : null}

        {/*
          ===== Saga / Temporadas — RULETA vertical de pósters (CONDICIONAL) =====
          Solo aparece si el estreno pertenece a una colección con entradas (otras películas de la saga o
          temporadas de la serie). En vez de una fila, es una RULETA vertical: el póster central destacado
          y los vecinos arriba/abajo difuminados, con controles ▲▼ que giran en bucle (infinito). El póster
          central es CLICABLE (búsqueda del título). Es lo que pedía el boceto ("ruleta" de portadas).
        */}
        {hasSaga ? (
          <Section
            label={`${offersSagaPage ? ui.detail.sagaLabel : ui.detail.seasonsLabel} · ${release.saga?.name ?? ""}`}
          >
            <SagaCarousel
              items={sagaItems}
              baseSeed={baseSeed + SEED_OFFSET_SAGA}
              catalog={catalog}
              onOpenCatalogRelease={handleOpenRelease}
            />
            {/*
              ENLACE A LA PÁGINA DE LA SAGA. Hasta ahora la saga se acababa aquí: una tira de pósters
              y ventanitas sueltas, sin dirección propia ni forma de compartirla. Ahora tiene su
              página, con las entradas completas y su sinopsis, y este es el camino hacia ella.

              Solo se ofrece cuando hay algo al otro lado (ver offersSagaPage), y lleva escrito de
              dónde se viene ("desde"), para que la página de la saga sepa a qué título devolver a la
              persona en vez de dejarla con un genérico "volver al inicio".
            */}
            {offersSagaPage ? (
              <Link
                href={`/saga/${sagaSlug(release.saga?.name ?? "")}?desde=${encodeURIComponent(release.id)}`}
                className="rf-saga-page-link font-mono"
                aria-label={ui.detail.sagaPageLinkAria(release.saga?.name ?? "")}
              >
                {ui.detail.sagaPageLink}
                <span aria-hidden="true"> →</span>
              </Link>
            ) : null}
          </Section>
        ) : null}

        {/*
          ===== Conexiones (CONDICIONAL): otros estrenos REALES del catálogo relacionados con este =====
          Misma saga / mismo director / por género (lo calcula quien renderiza, con findConnections). Cada
          tarjeta es un BOTÓN que abre el MODAL de detalle completo de ese título SIN perder el contexto
          (dentro del modal, la ficha se REEMPLAZA); la página completa queda a un clic ("Ver página
          completa" dentro del modal). Si no llegaron conexiones, la sección no aparece (degradado elegante).
        */}
        {related.length > 0 ? (
          <Section label={ui.detail.connectionsLabel}>
            <div className="rf-conn flex gap-[11px] overflow-x-auto pb-[6px]">
              {related.map((conn) => (
                <button
                  key={conn.release.id}
                  type="button"
                  onClick={() => handleOpenRelease(conn.release)}
                  aria-label={ui.detail.connectionAria(conn.release.title)}
                  className="rf-conn-item block w-[132px] shrink-0 border-0 bg-transparent p-0 text-left"
                >
                  {/* Portada (backdrop real si existe; si no, degradado) con el MOTIVO de la conexión. */}
                  <div
                    className="relative aspect-[16/10] overflow-hidden rounded-lg border"
                    style={{
                      ...coverStyleFor(
                        conn.release.backdropUrl,
                        seedFromId(conn.release.id),
                        1,
                        COVER_SIZES.connection,
                      ),
                      borderColor: "var(--color-border)",
                    }}
                  >
                    <span className="rf-conn-reason font-mono">{REASON_LABELS[conn.reason]}</span>
                  </div>
                  {/* Título del estreno relacionado. */}
                  <p className="mt-[7px] text-[12px] leading-[1.25] text-text">
                    {conn.release.title}
                  </p>
                </button>
              ))}
            </div>
          </Section>
        ) : null}

        {/*
          ===== Reparto =====
          Rejilla de personas: foto real de TMDB cuando existe, y un círculo con sus iniciales cuando no.
          Cada persona va con el personaje que interpreta. Si NO hay reparto, la sección se oculta.

          Aquí vivía además un sub-bloque de "Voces · Doblaje". Se ha retirado junto con el campo del
          contrato que lo alimentaba: en toda la vida de ese bloque no llegó ni una sola voz de doblaje
          (0 de 422 estrenos), porque no existe ninguna fuente que las dé. Un apartado que no puede
          aparecer nunca no es una función pendiente, es una promesa que el producto no cumple.
        */}
        {release.cast.length > 0 ? (
          <Section label={ui.detail.castLabel}>
            <PeopleGrid credits={release.cast} seedBase={baseSeed + SEED_OFFSET_CAST} />
          </Section>
        ) : null}

        {/*
          ===== Dirección y staff (crew) =====
          Otra rejilla de personas con su función (Dirección, Guion, …). Se oculta si no hay staff.
        */}
        {release.crew.length > 0 ? (
          <Section label={ui.detail.crewLabel}>
            <PeopleGrid
              credits={release.crew}
              seedBase={baseSeed + SEED_OFFSET_CREW}
              rolesAreJobs
            />
          </Section>
        ) : null}

        {/*
          ===== Idiomas =====
          Chip del idioma original (ej. "Original: Inglés") seguido de los idiomas hablados/disponibles.
          Se oculta por completo si no hay ni idioma original ni idiomas hablados (degradado elegante).
        */}
        {release.originalLanguage || release.spokenLanguages.length > 0 ? (
          <Section label={ui.detail.languagesLabel} last>
            <div className="flex flex-wrap gap-[7px]">
              {release.originalLanguage ? (
                <Chip
                  color={
                    matchesPreferredLanguage(release.originalLanguage, preferredLanguage)
                      ? "var(--color-gold-bright)"
                      : "var(--color-text-muted)"
                  }
                >
                  {ui.detail.languageOriginal(release.originalLanguage)}
                </Chip>
              ) : null}
              {release.spokenLanguages.map((language) => {
                // Resaltamos en oro el idioma que coincide con la preferencia del usuario (con una estrella).
                const preferred = matchesPreferredLanguage(language, preferredLanguage);
                return (
                  <Chip
                    key={language}
                    color={preferred ? "var(--color-gold-bright)" : "var(--color-text-muted)"}
                  >
                    {preferred ? "★ " : ""}
                    {language}
                  </Chip>
                );
              })}
            </div>
          </Section>
        ) : null}
      </div>

      {/*
        LIGHTBOX de la galería: cuando se pulsa una imagen, se abre AMPLIADA superpuesta. Clic en el
        velo o en la ✕ la cierra. role="dialog" + aria-label para accesibilidad. Solo se monta si hay una
        imagen seleccionada. La imagen va como <img> aquí (no de fondo) porque ES el contenido principal.
      */}
      {lightbox !== null ? (
        <div
          ref={lightboxTrapRef}
          className="rf-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.label || ui.detail.galleryLabel}
          tabIndex={-1}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="rf-lightbox-close"
            aria-label={ui.detail.lightboxClose}
            onClick={() => setLightbox(null)}
          >
            <span aria-hidden="true">✕</span>
          </button>
          {lightbox.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="rf-lightbox-img"
              src={lightbox.url}
              alt={lightbox.label || release.title}
            />
          ) : (
            <div
              className="rf-lightbox-img"
              style={gradientStyleFor(baseSeed + SEED_OFFSET_GALLERY)}
            />
          )}
          {lightbox.label ? (
            <span className="rf-lightbox-cap font-mono">{lightbox.label}</span>
          ) : null}
        </div>
      ) : null}

      {/*
        MODAL de detalle COMPLETO (conexiones/saga): solo se monta cuando esta ficha NO vive ya dentro
        del modal (onOpenRelease ausente) y hay un título seleccionado. El modal deriva las conexiones
        del título mostrado con el catálogo recibido y permite encadenar fichas sin apilar diálogos.
      */}
      {modalRelease !== null && onOpenRelease === undefined ? (
        <ReleaseModal
          summary={modalRelease}
          catalog={catalog}
          today={today}
          onClose={() => setModalRelease(null)}
        />
      ) : null}
    </article>
  );
}

// REF_CARD_STYLE es el estilo base (no animado) de cada tarjeta de Referencias.
// En español: fondo de cristal y borde estándar; el hover (borde dorado) lo aporta la clase rf-ref en
// globals.css, porque depende de un estado que el atributo "style" de React no expresa.
const REF_CARD_STYLE: CSSProperties = {
  background: "var(--color-glass)",
  borderColor: "var(--color-border)",
};

// SectionProps son las props de una sección del detalle (rótulo + contenido).
type SectionProps = {
  // label es el rótulo de la sección (ej. "Sinopsis", "Reparto").
  label: string;
  // children es el contenido de la sección.
  children: ReactNode;
  // last marca la última sección para quitarle el margen inferior (cierre limpio de la ficha).
  last?: boolean;
};

// Section envuelve cada bloque del detalle con su rótulo en el estilo "etiqueta" del cascarón.
// En español: estandariza el rótulo (monoespaciado, tenue, con una línea fina a su derecha) y el
// espaciado entre secciones, para no repetir esas clases en cada bloque. Espeja .sect/.sect .lab.
function Section({ label, children, last = false }: SectionProps) {
  return (
    <section className={`rf-sect-reveal ${last ? "" : "mb-6"}`}>
      {/* Rótulo de la sección: la línea a la derecha (::after) la aporta la clase rf-sect-label. */}
      <h3 className="rf-sect-label font-hud mb-3 flex items-center gap-[9px] text-[10.5px] font-semibold tracking-[0.2em] uppercase text-gold-bright">
        {label}
      </h3>
      {children}
    </section>
  );
}

// GalleryItemProps son las props de una celda de la galería "verla en acción".
type GalleryItemProps = {
  // image es la imagen del catálogo (url y etiqueta). En Fase 0 la url suele venir vacía.
  image: CatalogImage;
  // seed es la semilla del degradado de respaldo de esta celda (placeholder de Fase 0).
  seed: number;
  // onOpen abre la imagen AMPLIADA (lightbox) al pulsar la celda.
  onOpen: () => void;
};

// galleryFillStyle calcula el estilo del relleno de una celda: la foto real, o el degradado de respaldo.
// En español: si la imagen trae url, la ponemos como FONDO de la celda (background-image), recortada
// para llenar el espacio. Si no (Fase 0), usamos el degradado determinista. La pintamos como fondo —no
// con una etiqueta <img>— porque la imagen aquí es DECORATIVA (su contenido ya se nombra con el badge de
// etiqueta visible), y así no dependemos de configurar dominios remotos de next/image para casos que hoy
// no ocurren; cuando lleguen imágenes reales (TMDB) seguirá funcionando con cualquier url.
function galleryFillStyle(image: CatalogImage, seed: number): CSSProperties {
  if (image.url) {
    return {
      backgroundImage: cssUrl(image.url),
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return gradientStyleFor(seed);
}

// GalleryItem dibuja una celda de la galería: la imagen real si existe, o un degradado con su etiqueta.
// En español: el relleno (foto o degradado) lo decide galleryFillStyle; sobre él va el badge con la
// etiqueta (ej. "Escena 01"). Nunca inventamos una imagen: el degradado es claramente un placeholder.
function GalleryItem({ image, seed, onOpen }: GalleryItemProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ui.detail.galleryOpenAria(image.label || ui.detail.galleryLabel)}
      className="rf-gallery-item relative aspect-[16/10] w-[122px] shrink-0 overflow-hidden rounded-[9px] border"
      style={{ borderColor: "var(--color-border)" }}
    >
      {/* Relleno de la celda (foto real como fondo, o degradado de Fase 0). Decorativo. */}
      <div className="absolute inset-0" style={galleryFillStyle(image, seed)} aria-hidden="true" />
      {/* Lupa de "ampliar" que aparece al pasar el cursor (señal de que es clicable). Decorativa. */}
      <span aria-hidden="true" className="rf-gallery-zoom">
        ⤢
      </span>
      {/* Etiqueta de la imagen como "badge" en una esquina (ej. "Escena 01"). */}
      {image.label ? (
        <span
          className="font-mono absolute bottom-[6px] left-[6px] rounded-[4px] px-[6px] py-[2px] text-[9px] tracking-[0.1em] uppercase text-white"
          style={{ background: "rgba(7,8,9,.5)" }}
        >
          {image.label}
        </span>
      ) : null}
    </button>
  );
}

// PeopleGridProps son las props de una rejilla de personas (reparto, doblaje o staff).
type PeopleGridProps = {
  // credits es la lista de personas a mostrar (nombre, función, foto opcional).
  credits: Credit[];
  // seedBase es la semilla base de los avatares de respaldo de esta rejilla (placeholder de Fase 0).
  seedBase: number;
  // rolesAreJobs declara que lo que trae cada persona en su "función" es un PUESTO DEL EQUIPO y no un
  // nombre de personaje.
  //
  // Por qué hay que declararlo y no se puede adivinar, en español: el catálogo guarda las dos cosas en
  // el mismo campo. En el equipo guarda el puesto ("Director of Photography"); en el reparto guarda el
  // nombre del personaje ("Elle Woods"). Los puestos vienen en inglés y hay que traducirlos, porque
  // este producto está en español; los nombres de personaje no se traducen jamás. Quien monta la
  // rejilla es el único que sabe cuál de las dos listas está enseñando, así que lo dice aquí.
  rolesAreJobs?: boolean;
};

// avatarStyle calcula el estilo del avatar: la foto real como fondo, o el degradado de respaldo.
// En español: si la persona trae foto (url), la ponemos como FONDO del círculo (recortada para llenar);
// si no (Fase 0), usamos el degradado determinista sobre el que se muestran sus iniciales. La pintamos
// como fondo —no con una etiqueta <img>— porque el nombre de la persona ya aparece como texto a su lado
// (la identidad no se pierde para lectores de pantalla), y así evitamos configurar dominios remotos de
// next/image para fotos que hoy casi nunca llegan; cuando lleguen (TMDB) seguirá funcionando igual.
function avatarStyle(photoUrl: string, seed: number): CSSProperties {
  if (photoUrl) {
    return {
      backgroundImage: cssUrl(photoUrl),
      backgroundSize: "cover",
      backgroundPosition: "center",
      borderColor: "var(--color-border)",
    };
  }
  return {
    ...gradientStyleFor(seed),
    borderColor: "var(--color-border)",
  };
}

// PeopleGrid dibuja una rejilla de dos columnas con las personas y su función.
//
// En español: cada persona es un avatar (foto real de fondo si existe; si no, un círculo con sus
// iniciales sobre un degradado) más su nombre y su papel. Espeja .people/.person del cascarón. Si la
// lista llegara vacía, no dibuja nada (quien la usa ya decide mostrarla solo cuando hay personas).
//
// AQUÍ ESTABA UNO DE LOS CALLEJONES SIN SALIDA DEL PRODUCTO: cada persona se dibujaba como un trozo
// de texto muerto. Se veía el nombre de un actor, se intentaba pulsar y no pasaba nada; el recorrido
// se acababa ahí. Ahora cada persona enlaza a su página, donde está todo lo suyo dentro del catálogo.
//
// PERO SOLO CUANDO SE SABE QUIÉN ES. El enlace se dibuja únicamente si el catálogo trae su número de
// identidad. Sin ese número no se puede construir una página fiable —dos personas homónimas se
// fundirían en una— así que en ese caso se enseña el nombre como texto, igual que antes. Un enlace
// que lleva a una página vacía o equivocada es peor que no tener enlace.
function PeopleGrid({ credits, seedBase, rolesAreJobs = false }: PeopleGridProps) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-[14px]">
      {credits.map((credit, index) => {
        // El contenido es EXACTAMENTE el mismo lleve enlace o no: si fueran dos bloques distintos,
        // con el tiempo acabarían enseñando cosas distintas sin ningún motivo.
        const content = (
          <>
            {/*
              Avatar circular: foto real de fondo, o degradado con iniciales. Es decorativo
              (aria-hidden) porque el nombre de la persona va como texto a su lado; sin foto,
              mostramos sus iniciales como "marcador" visual amable, no como dato esencial.
            */}
            <span
              aria-hidden="true"
              className="font-display flex h-[42px] w-[42px] shrink-0 items-center justify-center overflow-hidden rounded-full border text-[15px] text-gold-bright"
              style={avatarStyle(credit.photoUrl, seedBase + index)}
            >
              {credit.photoUrl ? "" : initials(credit.name)}
            </span>
            {/* Nombre y función de la persona. */}
            <span className="min-w-0">
              <span className="block text-[13px] leading-[1.2] font-medium text-text">
                {credit.name}
              </span>
              {credit.role ? (
                <span className="mt-[2px] block text-[11.5px] leading-[1.3] text-text-subtle">
                  {/* Puesto del equipo: traducido. Nombre de personaje: tal cual (ver rolesAreJobs). */}
                  {rolesAreJobs ? jobLabel(credit.role) : credit.role}
                </span>
              ) : null}
            </span>
          </>
        );

        if (credit.personTmdbId > 0) {
          return (
            <Link
              key={`${credit.personTmdbId}-${index}`}
              href={`/persona/${credit.personTmdbId}`}
              className="rf-person-link flex items-center gap-[11px] no-underline"
              aria-label={ui.detail.personLinkAria(credit.name)}
            >
              {content}
            </Link>
          );
        }

        return (
          <div key={`${credit.name}-${index}`} className="flex items-center gap-[11px]">
            {content}
          </div>
        );
      })}
    </div>
  );
}

// ChipProps son las props de un "chip" (píldora) de texto.
type ChipProps = {
  // children es el texto del chip (una plataforma, una cadena, un idioma…).
  children: ReactNode;
  // color es la variable CSS del color del texto del chip (acento de su fila o texto tenue).
  color: string;
};

// Chip dibuja una píldora de cristal con borde, para plataformas/cadenas/idiomas.
// En español: estandariza el look de las pequeñas etiquetas redondeadas del detalle. Espeja .chip del
// cascarón. El color del texto lo decide quien lo usa (acento de la categoría o texto tenue por defecto).
function Chip({ children, color }: ChipProps) {
  return (
    <span
      className="rounded-full border px-[11px] py-[5px] text-xs"
      style={{
        color,
        background: "var(--color-glass)",
        borderColor: "var(--color-border)",
      }}
    >
      {children}
    </span>
  );
}

// ChipLinkProps son las props de un chip CLICABLE (enlace): igual que Chip, pero abre una URL.
type ChipLinkProps = {
  children: ReactNode;
  color: string;
  // href es el enlace que abre (búsqueda del título en la plataforma). Se abre en otra pestaña.
  href: string;
  // ariaLabel describe la acción para lectores de pantalla (ej. "Buscar X en Netflix").
  ariaLabel: string;
};

// ChipLink es un Chip que ENLAZA: convierte una plataforma/cadena en algo pulsable que abre su búsqueda.
// En español: misma píldora de cristal que Chip, pero como <a> con hover dorado (clase rf-watch-chip) y
// apertura segura en otra pestaña (rel noopener). Así "dónde verlo" deja de ser solo texto y es navegable.
function ChipLink({ children, color, href, ariaLabel }: ChipLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className="rf-watch-chip rounded-full border px-[11px] py-[5px] text-xs no-underline"
      style={{
        color,
        background: "var(--color-glass)",
        borderColor: "var(--color-border)",
      }}
    >
      {children}
    </a>
  );
}

// Separator es el puntito decorativo que separa datos en la sub-cabecera (fecha · géneros).
// En español: un círculo pequeño y tenue, puramente visual (aria-hidden), para no leerlo en voz alta.
function Separator() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-[3px] w-[3px] rounded-full"
      style={{ background: "var(--color-text-subtle)" }}
    />
  );
}
