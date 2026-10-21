// Archivo: saga.ts — La saga como un sitio al que se puede ir, no como una tira dentro de una ficha.
//
// Qué problema resuelve, en español:
//
// Hasta ahora una saga solo existía como un carrusel de pósters dentro de la ficha de un título, y
// cada entrada abría una ventanita pequeña. No tenía dirección propia, no se podía compartir y no se
// podía llegar a ella desde ningún otro sitio. Era otro callejón sin salida. Aquí vive lo necesario
// para que tenga su propia página.
//
// LA DECISIÓN INCÓMODA QUE HAY QUE EXPLICAR: DE DÓNDE SALE LA DIRECCIÓN DE UNA SAGA.
//
// Una saga, en el contrato de datos, es solo un nombre y una lista de entradas: NO tiene número de
// identidad propio. Así que la dirección hay que derivarla del nombre. La forma obvia —pasar el
// nombre a minúsculas y unirlo con guiones— se probó contra el catálogo real y SE ROMPE: de los 253
// nombres de saga, once están escritos en japonés, hindi o tamil, y al quitarles todo lo que no sea
// una letra del alfabeto latino se quedan en NADA. Las once sagas habrían compartido la misma
// dirección vacía y diez de ellas serían inalcanzables, sin dar ningún error.
//
// Por eso la dirección lleva además una HUELLA del nombre: unos caracteres calculados a partir del
// texto completo, acentos y kanji incluidos. "Toy Story - Colección" queda como
// "toy-story-coleccion-<huella>" y una saga en japonés queda como "saga-<huella>". Sigue siendo
// legible cuando puede serlo, y deja de haber dos sagas distintas con la misma dirección.
//
// El día que la saga tenga número propio en el contrato, esta función se sustituye por él y todo
// esto desaparece de raíz.
//
// LA OTRA COSA QUE HAY QUE DECIR EN VOZ ALTA: aquí conviven dos cosas distintas metidas en el mismo
// campo. Para una película, la "saga" es una saga de verdad (las otras entregas). Para una serie, el
// catálogo mete ahí SUS TEMPORADAS, usando el título de la serie como nombre de saga. Son cosas
// diferentes y mientras sigan mezcladas la página lo DICE, en vez de llamar "saga" a la lista de
// temporadas de una sola serie.

import { TitleType, type CollectionItem, type Release } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// SagaEntry es UNA entrada de la saga y, si existe, el estreno del catálogo que le corresponde.
export type SagaEntry = {
  // item es la entrada tal y como viene en los datos (título, año, póster, sinopsis, nota).
  item: CollectionItem;
  // release es el estreno del catálogo que ES esa entrada, o null si no está aquí.
  //
  // En español: null NO es un error, es el caso mayoritario. La mayoría de las entradas de una saga
  // son películas antiguas o temporadas que este producto no cubre. Cuando es null, la entrada se
  // enseña con lo que se sabe de ella pero SIN enlace: un enlace que lleva a una página vacía es peor
  // que no tener enlace.
  release: Release | null;
};

// SagaProfile es la saga entera, lista para pintarse.
export type SagaProfile = {
  // name es el nombre de la saga tal y como se escribe.
  name: string;
  // slug es su dirección (ver la explicación de la cabecera).
  slug: string;
  // entries son sus entradas, en el orden en que vienen en los datos (que es el cronológico de TMDB).
  entries: SagaEntry[];
  // owners son los estrenos del catálogo que declaran pertenecer a esta saga. Casi siempre uno.
  owners: Release[];
  // isSeasons dice si lo que hay aquí son en realidad las TEMPORADAS de una serie (ver cabecera).
  isSeasons: boolean;
};

// SLUG_FALLBACK_PREFIX es lo que se pone delante cuando del nombre no queda nada legible en latino.
// En español: pasa con los nombres en japonés, hindi o tamil. La dirección queda como "saga-<huella>",
// que no dice nada pero es única, válida y estable — que es lo único que se le puede pedir.
const SLUG_FALLBACK_PREFIX = "saga";

// FINGERPRINT_HEX_LENGTH es cuántos caracteres tiene la huella del nombre.
//
// Ocho, y el número está elegido, no puesto a ojo: con ocho caracteres hay más de cuatro mil millones
// de huellas posibles, así que la probabilidad de que dos de los 253 nombres de saga del catálogo
// compartan una es de unas siete por cada millón. Con cuatro caracteres esa probabilidad subiría al
// 49 %, lo que en la práctica significa que alguna saga acabaría siendo inalcanzable.
const FINGERPRINT_HEX_LENGTH = 8;

// FNV_OFFSET_BASIS y FNV_PRIME son las dos constantes del algoritmo de huella FNV-1a de 32 bits.
//
// En español: es un método público y muy conocido para convertir un texto en un número que lo
// representa. No es criptografía y no pretende serlo: aquí solo hace falta que el mismo texto dé
// siempre el mismo número y que dos textos distintos den números distintos casi siempre.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// nameFingerprint convierte un nombre completo (con acentos, kanji, lo que sea) en su huella.
//
// En español: recorre el texto carácter a carácter mezclando cada uno con lo acumulado. El
// desplazamiento sin signo del final (>>> 0) fuerza a JavaScript a tratar el resultado como un número
// positivo de 32 bits; sin él, la multiplicación puede dejarlo negativo y la huella saldría con un
// signo menos delante, que no es válido dentro de una dirección.
function nameFingerprint(name: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(FINGERPRINT_HEX_LENGTH, "0");
}

// sagaSlug convierte el nombre de una saga en su dirección: legible cuando se puede, única siempre.
//
// En español: primero se quitan acentos y signos y se unen las palabras con guiones ("Toy Story -
// Colección" pasa a "toy-story-coleccion"); después se le añade la huella del nombre COMPLETO. Lo
// primero es para que el enlace se pueda leer; lo segundo, para que dos sagas nunca compartan
// dirección. Estable significa que el mismo nombre da SIEMPRE el mismo resultado, que es lo que
// permite que un enlace compartido hoy siga funcionando mañana.
//
// El paso de "normalizar y quitar marcas" es lo que convierte la "ó" en "o": sin él, la dirección
// llevaría caracteres acentuados que unos navegadores escriben tal cual y otros codifican, y el mismo
// enlace acabaría teniendo dos formas distintas.
export function sagaSlug(name: string): string {
  const trimmed = name.trim();
  const readable = trimmed
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefix = readable === "" ? SLUG_FALLBACK_PREFIX : readable;
  return `${prefix}-${nameFingerprint(trimmed)}`;
}

// normalizeTitle prepara un título para compararlo (minúsculas, sin espacios sobrantes).
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

// isSeasonCollection dice si lo que un estreno guarda como "saga" son en realidad SUS TEMPORADAS.
//
// EL DATO QUE OBLIGA A QUE ESTA FUNCIÓN EXISTA, medido sobre el catálogo real: de las 193 sagas que
// hay, 179 —el 93 %— son de series, y en esas la lista no contiene otras obras sino "Temporada 1",
// "Temporada 2"… Una temporada NO es un estreno del catálogo y no va a serlo nunca, así que ninguna de
// esas entradas puede emparejarse con nada: de las 970 entradas que existen, solo 14 (el 1,4 %)
// encuentran su título. Ofrecer "ver la saga completa" para una serie llevaba, en 9 de cada 10 casos,
// a una página donde TODO decía "no está en este catálogo", incluida la serie de la que se venía.
//
// Cómo se reconoce: el dueño es una SERIE y el nombre de la "saga" es su propio título. Así es
// exactamente como el catálogo guarda hoy las temporadas, y mientras siga guardándolas así esta
// comprobación es la única forma de distinguir una cosa de la otra.
export function isSeasonCollection(release: {
  type: TitleType;
  title: string;
  saga?: { name: string } | undefined;
}): boolean {
  const sagaName = release.saga?.name?.trim() ?? "";
  return (
    release.type === TitleType.SERIES &&
    sagaName !== "" &&
    normalizeTitle(release.title) === normalizeTitle(sagaName)
  );
}

// resolveCollectionItem busca en el catálogo el estreno que corresponde a una entrada de saga.
//
// LA FRAGILIDAD QUE HAY QUE CONOCER, en español: las entradas de saga solo traen TÍTULO y AÑO; no
// traen el identificador del estreno. Así que la única forma de emparejarlas es comparar el texto del
// título. Si TMDB escribiera el mismo título de dos formas ligeramente distintas en dos sitios, la
// conexión se perdería EN SILENCIO: no daría ningún error, simplemente la entrada saldría sin enlace.
// Está documentado como riesgo abierto y se arregla el día que el contrato traiga el identificador.
//
// El año se comprueba solo si la entrada lo trae: dos películas distintas pueden llamarse igual y el
// año es lo único que las separa, pero exigirlo cuando no existe descartaría emparejamientos buenos.
// Por qué esta función es GENÉRICA y no pide un estreno completo, en español: emparejar una entrada
// de saga con un estreno solo necesita mirar su TÍTULO y su FECHA, y esos dos datos están tanto en la
// ficha completa como en el resumen que se usa en las listas. Escrita así, la usan las dos pantallas
// que la necesitan —la página de la saga, que trabaja con fichas completas, y la ruleta de la ficha
// de detalle, que trabaja con resúmenes— sin duplicar la regla ni obligar a nadie a cargar de más.
// Además devuelve el MISMO tipo que recibió, así que quien la llame conserva todo lo que ya tenía.
export function resolveCollectionItem<T extends { title: string; releaseDate: string }>(
  item: CollectionItem,
  catalog: readonly T[],
): T | null {
  const wantedTitle = normalizeTitle(item.title);
  if (wantedTitle === "") {
    return null;
  }
  for (const candidate of catalog) {
    if (normalizeTitle(candidate.title) !== wantedTitle) {
      continue;
    }
    if (item.year !== "" && !candidate.releaseDate.startsWith(item.year)) {
      continue;
    }
    return candidate;
  }
  return null;
}

// findSagaBySlug arma la página de una saga a partir de su dirección.
//
// En español: recorre el catálogo buscando los estrenos cuya saga produce esa dirección. Si no hay
// ninguno, devuelve null y la página enseña su estado de "no encontrada" — que es un desenlace
// normal, porque el catálogo cubre unos meses y un enlace viejo puede apuntar a algo que ya salió de
// la ventana.
//
// Cuando varios estrenos comparten saga, sus entradas se juntan sin repetir: la saga es una sola
// aunque se llegue a ella desde dos películas distintas.
export function findSagaBySlug(catalog: readonly Release[], slug: string): SagaProfile | null {
  if (slug === "") {
    return null;
  }

  let name = "";
  const owners: Release[] = [];
  const items: CollectionItem[] = [];
  // seenItems evita repetir la misma entrada cuando dos estrenos de la saga traen la lista entera.
  const seenItems = new Set<string>();

  for (const release of catalog) {
    const sagaName = release.saga?.name?.trim() ?? "";
    if (sagaName === "" || sagaSlug(sagaName) !== slug) {
      continue;
    }
    if (name === "") {
      name = sagaName;
    }
    owners.push(release);
    for (const item of release.saga?.items ?? []) {
      const key = `${normalizeTitle(item.title)}|${item.year}`;
      if (seenItems.has(key)) {
        continue;
      }
      seenItems.add(key);
      items.push(item);
    }
  }

  if (owners.length === 0) {
    return null;
  }

  // ¿Son temporadas y no una saga? (Ver isSeasonCollection para el porqué y para el dato medido.)
  const isSeasons = owners.some((release) => isSeasonCollection(release));

  // Las entradas se emparejan buscando PRIMERO entre los dueños de la saga y solo después en el resto
  // del catálogo.
  //
  // Por qué ese orden y no al revés, en español: el emparejamiento se hace comparando el TÍTULO
  // escrito, porque las entradas de una saga no traen el número de identidad del estreno (una carencia
  // del contrato de datos que está declarada más arriba). Comparar textos falla cuando dos estrenos
  // distintos se llaman igual: la entrada acabaría enlazando a cualquiera de los dos, al azar. De los
  // dueños, en cambio, SÍ se conoce el número de identidad: son los estrenos que declaran pertenecer a
  // esta saga, se localizaron por identidad y no por texto. Mirándolos primero, la entrada que
  // corresponde al título del que se viene enlaza siempre a ÉL y no a un homónimo. Es todo lo lejos
  // que se puede llegar hasta que el contrato traiga el identificador dentro de cada entrada.
  const entries: SagaEntry[] = items.map((item) => ({
    item,
    release: resolveCollectionItem(item, owners) ?? resolveCollectionItem(item, catalog),
  }));

  return { name, slug, entries, owners, isSeasons };
}

// pickSagaHighlight elige de qué título de la saga se enseña el tráiler en su página.
//
// En español: una saga no tiene tráiler propio. Lo que sí existe es el tráiler de las entregas que
// están en el catálogo, así que se enseña el de la mejor calificada entre las que tienen video, y la
// página dice de cuál es. Si ninguna tiene video, devuelve null y la sección no se dibuja: un
// recuadro que anuncia algo inexistente se lee como algo roto.
export function pickSagaHighlight(saga: SagaProfile): Release | null {
  let best: Release | null = null;
  let bestScore = -1;
  const candidates: Release[] = [...saga.owners];
  for (const entry of saga.entries) {
    if (entry.release !== null) {
      candidates.push(entry.release);
    }
  }
  for (const candidate of candidates) {
    if (candidate.videos.length === 0) {
      continue;
    }
    const score = candidate.ratings?.tmdb ?? 0;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

// pickSagaOrigin elige a qué título de este catálogo lleva la SALIDA de la página de una saga.
//
// POR QUÉ ESTA PÁGINA NECESITA UNA SALIDA GARANTIZADA, en español: se llega aquí desde la ficha de un
// título, y hasta ahora la única forma de volver era el enlace genérico a la portada — que no devuelve
// a donde se estaba, sino al principio de todo. En la inmensa mayoría de los casos, además, ninguna de
// las entradas de la página estaba en el catálogo, así que no había ni un solo enlace que pulsar: se
// aterrizaba en un callejón sin salida. Con esto, la página SIEMPRE ofrece el camino de vuelta al
// título del que se vino, y si alguien llega por un enlace compartido —sin saber de dónde viene—, la
// vuelta lleva al título de este catálogo que declara pertenecer a esta saga, que es lo más cercano
// que existe a "de dónde salió esta página".
//
// originId es el identificador del título del que se venía, que la ficha añade al enlace. Puede llegar
// vacío o apuntar a algo que ya no está: en los dos casos se cae al primer dueño de la saga, que es un
// destino real y comprobado, nunca inventado.
export function pickSagaOrigin(saga: SagaProfile, originId: string): Release | null {
  const wanted = originId.trim();
  if (wanted !== "") {
    const fromLink = saga.owners.find((release) => release.id === wanted);
    if (fromLink !== undefined) {
      return fromLink;
    }
  }
  return saga.owners[0] ?? null;
}
