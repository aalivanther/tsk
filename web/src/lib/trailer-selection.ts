// Archivo: trailer-selection.ts — Qué tráiler ve cada persona, según el idioma que eligió.
//
// En español: este archivo decide, de entre todos los videos que el catálogo trae de un estreno, cuál
// se le enseña a QUIEN ESTÁ MIRANDO. La decisión no se puede tomar al generar el catálogo, porque en
// ese momento nadie sabe si quien va a abrir la ficha prefiere español o inglés. Por eso vive aquí, en
// la aplicación, y se toma en el último momento.
//
// LA REGLA DE FONDO, en una frase: quien pide español prefiere OÍR español; si no hay, se le ofrece lo
// más cercano y SE LE DICE en pantalla qué está viendo. Nunca se le cuela un video en otro idioma en
// silencio.
//
// Este módulo es a propósito una FUNCIÓN PURA: recibe datos, devuelve datos, no toca la pantalla, no
// mira el navegador y no guarda nada. Eso es lo que permite probarlo de verdad —los mismos datos dan
// siempre el mismo resultado— en vez de tener que abrir un navegador para saber si acierta. Es la
// lógica que decide qué ve la persona: tiene que poder comprobarse sin depender de nada.

import {
  ChannelKind,
  DubbingKind,
  VideoKind,
  type Video,
} from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// TrailerNotice es el AVISO que hay que enseñar junto al video elegido.
//
// En español: cuando la cadena de respaldo acaba dando algo que no es lo que la persona pidió, la
// interfaz tiene que decirlo. Estos son los tres casos posibles. El identificador es en inglés (es
// código); el texto visible en es-MX vive en i18n.ts, que es donde vive todo el texto de la interfaz.
export type TrailerNotice =
  // "none": el video está en el idioma que la persona eligió. No hay nada que avisar.
  | "none"
  // "englishWithSubtitles": no había nada en su idioma y se cae al tráiler en inglés. Se le piden a
  // YouTube los subtítulos en su idioma, pero NO se puede comprobar que existan de verdad (el
  // servicio público que listaba subtítulos dejó de responder), así que se avisa sin prometer.
  | "englishWithSubtitles"
  // "originalLanguage": no había ni en su idioma ni en inglés; se enseña el tráiler en el idioma
  // original del título, sea el que sea.
  | "originalLanguage";

// TrailerChoice es el resultado de la elección: el video y el aviso que lo acompaña.
export type TrailerChoice = {
  // video es el video que se va a reproducir.
  video: Video;
  // notice es lo que hay que decirle a la persona sobre ese video (ver TrailerNotice).
  notice: TrailerNotice;
};

// SPANISH_LANGUAGE_CODE y los demás son los códigos de idioma que maneja el perfil.
// En español: son constantes con nombre para que las reglas se lean como frases y no como cadenas
// sueltas repartidas por el archivo.
const SPANISH_LANGUAGE_CODE = "es";
const ENGLISH_LANGUAGE_CODE = "en";

// MEXICO_REGION_CODE y SPAIN_REGION_CODE son los dos países que la cadena en español distingue.
// En español: el catálogo es para México, así que el doblaje mexicano gana al de España SIEMPRE que
// exista. Hasta ahora ni siquiera se pedía, y se servía el de España existiendo el mexicano.
const MEXICO_REGION_CODE = "MX";
const SPAIN_REGION_CODE = "ES";

// MAIN_REGION_BY_LANGUAGE dice cuál es el país principal de cada idioma que ofrece el perfil.
// En español: para portugués el país que importa es Brasil (no Portugal), porque el doblaje que llega
// a América Latina es el brasileño. Para francés, Francia; para japonés, Japón.
const MAIN_REGION_BY_LANGUAGE: Record<string, string> = {
  pt: "BR",
  fr: "FR",
  ja: "JP",
};

// CHANNEL_KIND_RANK ordena los tipos de canal de mejor a peor para desempatar.
//
// En español: cuanto MENOR es el número, antes va. La distribuidora primero (es la fuente original),
// después las casas indie y festivales (que para el cine de autor son la única fuente), luego las
// plataformas (que suelen añadir su cabecera), después los canales que no reconocemos, y de últimas
// los recopiladores. Ese último puesto es deliberado: un recopilador recorta, pone locución encima o
// marca de agua, y a veces el audio ni siquiera es el que anuncia el título.
const CHANNEL_KIND_RANK: Record<ChannelKind, number> = {
  [ChannelKind.DISTRIBUTOR]: 0,
  [ChannelKind.INDIE]: 1,
  [ChannelKind.PLATFORM]: 2,
  [ChannelKind.UNSPECIFIED]: 3,
  [ChannelKind.AGGREGATOR]: 4,
};

// COMPLEMENTARY_KIND_RANK ordena las clases de video del SEGUNDO video de la ficha.
//
// En español: el video complementario es el "para profundizar" que aparece bajo la galería. Se
// prefiere una featurette (pieza promocional hecha para eso), luego el detrás de cámaras, luego un
// teaser y por último un clip suelto. Las clases que no están aquí no sirven como complementario.
const COMPLEMENTARY_KIND_RANK: Record<number, number> = {
  [VideoKind.FEATURETTE]: 0,
  [VideoKind.BEHIND_THE_SCENES]: 1,
  [VideoKind.TEASER]: 2,
  [VideoKind.CLIP]: 3,
};

// selectionStep es UN escalón de la cadena de respaldo: una condición y el aviso que trae consigo.
type selectionStep = {
  // matches dice si un video cumple la condición de este escalón.
  matches: (video: Video) => boolean;
  // notice es lo que habrá que avisar si el video elegido sale de este escalón.
  notice: TrailerNotice;
};

// isUsableVideo aplica los FILTROS DUROS: lo que no los pasa no puede elegirse jamás.
//
// En español: son tres condiciones y las tres son innegociables.
//  1. El video tiene que estar VERIFICADO como reproducible. El generador del catálogo pregunta a
//     YouTube uno por uno y solo escribe los que responden que sí; esta comprobación es el cinturón
//     de seguridad por si algún día llegara uno sin verificar. Un video no reproducible es
//     exactamente la caja negra que el dueño reportó.
//  2. Tiene que ser un tráiler o un teaser. Un clip suelto o un detrás de cámaras no es "el tráiler".
//  3. No puede venir de un canal recopilador SIN el respaldo de TMDB. Un recopilador que TMDB sí
//     marca como oficial se acepta, pero queda de últimas en el desempate.
function isUsableVideo(video: Video): boolean {
  if (!video.playable) {
    return false;
  }
  if (video.kind !== VideoKind.TRAILER && video.kind !== VideoKind.TEASER) {
    return false;
  }
  if (video.channelKind === ChannelKind.AGGREGATOR && !video.official) {
    return false;
  }
  return true;
}

// compareByQuality ordena dos videos de mejor a peor DENTRO de un mismo escalón.
//
// En español: cuando un escalón deja varios candidatos hay que elegir uno, y la elección tiene que
// ser siempre la misma. El orden es:
//  1. Los marcados oficiales por TMDB van delante.
//  2. Por tipo de canal (distribuidora > indie > plataforma > desconocido > recopilador).
//  3. El publicado más recientemente: el último tráiler suele ser el final, no el primer adelanto.
//  4. El de mayor resolución.
//  5. El código de YouTube en orden alfabético. Este último criterio es artificial a propósito: sin
//     él, dos videos idénticos en todo lo demás podrían intercambiarse entre una visita y otra y la
//     misma persona vería un tráiler distinto cada vez sin ninguna razón.
//
// Devuelve un número negativo si el primero va antes, positivo si va después (es lo que espera sort).
function compareByQuality(first: Video, second: Video): number {
  if (first.official !== second.official) {
    return first.official ? -1 : 1;
  }
  const firstChannelRank = CHANNEL_KIND_RANK[first.channelKind];
  const secondChannelRank = CHANNEL_KIND_RANK[second.channelKind];
  if (firstChannelRank !== secondChannelRank) {
    return firstChannelRank - secondChannelRank;
  }
  if (first.publishedYear !== second.publishedYear) {
    return second.publishedYear - first.publishedYear;
  }
  if (first.resolution !== second.resolution) {
    return second.resolution - first.resolution;
  }
  // Desempate final por el código del video, en orden alfabético: siempre da el mismo resultado.
  if (first.youtubeKey < second.youtubeKey) {
    return -1;
  }
  if (first.youtubeKey > second.youtubeKey) {
    return 1;
  }
  return 0;
}

// buildSpanishChain arma los DIEZ escalones de la cadena para quien eligió español.
//
// En español: se recorren en orden y se para en el primero que tenga al menos un candidato. Los dos
// primeros escalones están separados a propósito: TMDB etiqueta como "es-MX" tanto el doblaje latino
// como el tráiler en inglés con subtítulos en español latino, y el nombre del video es lo único que
// los distingue. Quien pide español prefiere oír español, así que el doblado va primero.
function buildSpanishChain(): selectionStep[] {
  const isSpanish = (video: Video): boolean => video.language === SPANISH_LANGUAGE_CODE;
  const isTrailer = (video: Video): boolean => video.kind === VideoKind.TRAILER;
  const isTeaser = (video: Video): boolean => video.kind === VideoKind.TEASER;
  const isEnglish = (video: Video): boolean => video.language === ENGLISH_LANGUAGE_CODE;

  return [
    // 1. El tráiler mexicano DOBLADO: lo mejor posible para este catálogo.
    {
      matches: (video) =>
        isSpanish(video) &&
        video.region === MEXICO_REGION_CODE &&
        isTrailer(video) &&
        video.dubbing === DubbingKind.DUBBED,
      notice: "none",
    },
    // 2. Cualquier tráiler mexicano (incluido el subtitulado, si no hubo doblado).
    {
      matches: (video) =>
        isSpanish(video) && video.region === MEXICO_REGION_CODE && isTrailer(video),
      notice: "none",
    },
    // 3. Un teaser mexicano: es corto, pero está en su idioma y su país.
    {
      matches: (video) =>
        isSpanish(video) && video.region === MEXICO_REGION_CODE && isTeaser(video),
      notice: "none",
    },
    // 4. El tráiler de España: sigue siendo español, aunque el doblaje no sea el de aquí.
    {
      matches: (video) =>
        isSpanish(video) && video.region === SPAIN_REGION_CODE && isTrailer(video),
      notice: "none",
    },
    // 5. El teaser de España.
    {
      matches: (video) => isSpanish(video) && video.region === SPAIN_REGION_CODE && isTeaser(video),
      notice: "none",
    },
    // 6. Un tráiler en español de cualquier otra región (Argentina, Colombia…).
    { matches: (video) => isSpanish(video) && isTrailer(video), notice: "none" },
    // 7. Cualquier video en español que quede (tráiler o teaser, de donde sea).
    { matches: (video) => isSpanish(video), notice: "none" },
    // 8. Ya no hay nada en español: el tráiler en inglés, CON AVISO y pidiendo subtítulos.
    { matches: (video) => isEnglish(video) && isTrailer(video), notice: "englishWithSubtitles" },
    // 9. El teaser en inglés, con el mismo aviso.
    { matches: (video) => isEnglish(video) && isTeaser(video), notice: "englishWithSubtitles" },
    // 10. Cualquier tráiler que quede, en el idioma que sea, diciéndolo claramente.
    { matches: (video) => isTrailer(video), notice: "originalLanguage" },
  ];
}

// buildEnglishChain arma los SIETE escalones de la cadena para quien eligió inglés.
//
// En español: la petición fue "el tráiler crudo de las distribuidoras, o de canales indie / de
// difusión de cine". Eso no se traduce a una región, se traduce a QUIÉN LO PUBLICÓ. Por eso esta
// cadena ordena por tipo de canal en vez de por país.
//
// Sobre la palabra "crudo": no existe en ningún sitio un dato que diga "este tráiler no tiene
// recortes ni locución añadida". Lo más cercano que se puede ofrecer con datos reales es "de la
// distribuidora oficial, en la mayor resolución disponible, el más reciente", y eso es lo que hace
// esta cadena. Prometer más sería inventar.
function buildEnglishChain(): selectionStep[] {
  const isEnglish = (video: Video): boolean => video.language === ENGLISH_LANGUAGE_CODE;
  const isTrailer = (video: Video): boolean => video.kind === VideoKind.TRAILER;
  const isTeaser = (video: Video): boolean => video.kind === VideoKind.TEASER;

  return [
    // 1. Tráiler del estudio o la distribuidora, respaldado por TMDB.
    {
      matches: (video) =>
        isEnglish(video) &&
        isTrailer(video) &&
        video.channelKind === ChannelKind.DISTRIBUTOR &&
        video.official,
      notice: "none",
    },
    // 2. Tráiler de una distribuidora indie o de un festival: la fuente natural del cine de autor.
    {
      matches: (video) =>
        isEnglish(video) &&
        isTrailer(video) &&
        video.channelKind === ChannelKind.INDIE &&
        video.official,
      notice: "none",
    },
    // 3. Tráiler publicado por la plataforma de streaming.
    {
      matches: (video) =>
        isEnglish(video) &&
        isTrailer(video) &&
        video.channelKind === ChannelKind.PLATFORM &&
        video.official,
      notice: "none",
    },
    // 4. Cualquier tráiler oficial en inglés, aunque no reconozcamos el canal.
    { matches: (video) => isEnglish(video) && isTrailer(video) && video.official, notice: "none" },
    // 5. Tráiler en inglés que TMDB no marcó como oficial.
    { matches: (video) => isEnglish(video) && isTrailer(video), notice: "none" },
    // 6. Teaser en inglés. El orden por canal lo aplica solo el desempate (compareByQuality).
    { matches: (video) => isEnglish(video) && isTeaser(video), notice: "none" },
    // 7. No hay nada en inglés: el tráiler en el idioma original del título, diciéndolo.
    { matches: (video) => isTrailer(video), notice: "originalLanguage" },
  ];
}

// buildOtherLanguageChain arma la cadena para francés, portugués y japonés.
//
// En español: misma forma que las anteriores pero más corta, porque el catálogo casi nunca tiene
// tráilers localizados en estos idiomas. El detalle que importa es la región principal de cada uno
// (portugués → Brasil, francés → Francia, japonés → Japón).
function buildOtherLanguageChain(preferredLanguage: string): selectionStep[] {
  const mainRegion = MAIN_REGION_BY_LANGUAGE[preferredLanguage] ?? "";
  const isPreferred = (video: Video): boolean => video.language === preferredLanguage;
  const isTrailer = (video: Video): boolean => video.kind === VideoKind.TRAILER;
  const isTeaser = (video: Video): boolean => video.kind === VideoKind.TEASER;
  const isEnglish = (video: Video): boolean => video.language === ENGLISH_LANGUAGE_CODE;

  return [
    // 1. Tráiler en su idioma y en su país principal.
    {
      matches: (video) => isPreferred(video) && video.region === mainRegion && isTrailer(video),
      notice: "none",
    },
    // 2. Tráiler en su idioma, de cualquier país.
    { matches: (video) => isPreferred(video) && isTrailer(video), notice: "none" },
    // 3. Teaser en su idioma.
    { matches: (video) => isPreferred(video) && isTeaser(video), notice: "none" },
    // 4. Tráiler en inglés, con subtítulos pedidos en su idioma y con aviso.
    { matches: (video) => isEnglish(video) && isTrailer(video), notice: "englishWithSubtitles" },
    // 5. Cualquier tráiler que quede, con aviso de que está en su idioma original.
    { matches: (video) => isTrailer(video), notice: "originalLanguage" },
  ];
}

// buildChainFor devuelve la cadena de respaldo que corresponde al idioma elegido.
// En español: español e inglés tienen su cadena propia porque son las dos que el dueño detalló; los
// demás idiomas comparten una cadena general con su región principal.
function buildChainFor(preferredLanguage: string): selectionStep[] {
  if (preferredLanguage === SPANISH_LANGUAGE_CODE) {
    return buildSpanishChain();
  }
  if (preferredLanguage === ENGLISH_LANGUAGE_CODE) {
    return buildEnglishChain();
  }
  return buildOtherLanguageChain(preferredLanguage);
}

// selectTrailer elige el tráiler que se le va a enseñar a esta persona, o nada si no hay ninguno.
//
// En español: es la función principal de este archivo. Aplica los filtros duros, recorre la cadena de
// respaldo del idioma elegido y se para en el primer escalón con candidatos, quedándose con el mejor
// de ese escalón. Si ningún escalón encuentra nada, devuelve undefined — y eso NO es un error: casi
// 4 de cada 10 títulos del catálogo simplemente no tienen tráiler en ningún sitio. Quien llama debe
// dibujar el estado "sin tráiler", nunca un reproductor vacío.
export function selectTrailer(
  videos: Video[],
  preferredLanguage: string,
): TrailerChoice | undefined {
  const candidates = videos.filter(isUsableVideo);
  if (candidates.length === 0) {
    return undefined;
  }

  for (const step of buildChainFor(preferredLanguage)) {
    const matching = candidates.filter(step.matches);
    if (matching.length === 0) {
      continue;
    }
    // Copiamos antes de ordenar: sort modifica el arreglo en sitio y no queremos tocar lo que nos
    // pasaron (los datos del catálogo se comparten entre componentes).
    const best = [...matching].sort(compareByQuality)[0];
    return { video: best, notice: step.notice };
  }

  return undefined;
}

// selectComplementaryVideo elige el SEGUNDO video de la ficha: el "para profundizar".
//
// En español: una vez elegido el tráiler, el complementario es el mejor video de la misma lista que
// no sea ese. Se prefieren, en este orden, la featurette, el detrás de cámaras, el teaser y el clip;
// dentro de la misma clase gana el que esté en el idioma de la persona; y a igualdad de todo, manda
// el mismo desempate que el tráiler. Si no hay ninguno, devuelve undefined y la ficha NO dibuja la
// sección: un hueco vacío es peor que no tener sección.
export function selectComplementaryVideo(
  videos: Video[],
  preferredLanguage: string,
  chosenTrailerKey: string | undefined,
): Video | undefined {
  const candidates = videos.filter((video) => {
    if (!video.playable) {
      return false;
    }
    // No repetimos el video que ya se está enseñando arriba como tráiler.
    if (chosenTrailerKey !== undefined && video.youtubeKey === chosenTrailerKey) {
      return false;
    }
    if (video.channelKind === ChannelKind.AGGREGATOR && !video.official) {
      return false;
    }
    return video.kind in COMPLEMENTARY_KIND_RANK;
  });

  if (candidates.length === 0) {
    return undefined;
  }

  const ordered = [...candidates].sort((first, second) => {
    const firstKindRank = COMPLEMENTARY_KIND_RANK[first.kind];
    const secondKindRank = COMPLEMENTARY_KIND_RANK[second.kind];
    if (firstKindRank !== secondKindRank) {
      return firstKindRank - secondKindRank;
    }
    // Dentro de la misma clase, el que esté en el idioma de la persona va delante.
    const firstIsPreferred = first.language === preferredLanguage;
    const secondIsPreferred = second.language === preferredLanguage;
    if (firstIsPreferred !== secondIsPreferred) {
      return firstIsPreferred ? -1 : 1;
    }
    return compareByQuality(first, second);
  });

  return ordered[0];
}
