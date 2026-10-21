// Archivo: attribute-normalization.ts — Que el mismo concepto sea UNA sola cosa en el mapa personal.
//
// QUÉ PROBLEMA RESUELVE, en español, y con los números del catálogo real delante:
//
// El mapa personal une los títulos que has visto a través de lo que comparten: un género, una
// plataforma, una persona. Para que eso funcione, dos títulos que comparten "Netflix" tienen que
// llegar al MISMO punto del mapa. Y no llegaban, por dos motivos distintos:
//
//   1. GÉNEROS EN DOS IDIOMAS. El proveedor de datos traduce al español los géneros de las películas,
//      pero deja SIN TRADUCIR siete de los géneros que solo existen en las series. Resultado medido
//      sobre el catálogo: conviven "Acción" (18 títulos) con "Action & Adventure" (42), "Ciencia
//      ficción" (11) con "Sci-Fi & Fantasy" (54), "Bélica" (2) con "War & Politics" (4) y "Familia"
//      (22) con "Kids" (4). Son 25 nombres de género para 21 conceptos: cuatro puntos duplicados que
//      además parten en dos cada grupo que deberían formar.
//
//   2. UNA PLATAFORMA POR CADA FORMA DE PAGARLA. El proveedor lista como servicios distintos cada
//      variante comercial del mismo servicio: "Netflix" y "Netflix Standard with Ads" (la versión con
//      anuncios), "Paramount Plus" y "Paramount Plus Premium", y sobre todo la reventa a través de
//      otra tienda — "Crunchyroll" y "Crunchyroll Amazon Channel" son el mismo Crunchyroll. Medido:
//      27 nombres de plataforma para 15 servicios reales. Doce puntos duplicados.
//
// CUÁNTO AHORRA, medido sobre el catálogo real (295 títulos) y no estimado:
//
//   · Nombres distintos: los géneros bajan de 25 a 21 y las plataformas de 27 a 15. En total, 52
//     nombres para 36 conceptos.
//   · En el MAPA, con el catálogo entero marcado como visto (el peor caso posible): los puntos de
//     vínculo bajan de 131 a 118 —trece puntos menos, un 10 %— y los hilos de 1 250 a 1 062, un 15 %
//     menos de líneas que dibujar.
//
// Y lo importante no es el ahorro: es que los grupos dejan de partirse. Antes, dos series de acción
// podían aparecer sin ninguna conexión entre ellas si una traía el género en español y la otra en
// inglés, y dos títulos de Netflix quedaban separados porque uno estaba catalogado en el plan con
// anuncios. El mapa afirmaba que no se parecían en nada, y era falso.
//
// LO QUE ESTE ARCHIVO NO HACE, dicho para que nadie lo busque aquí: no toca lo que se ve en la ficha
// de un título ni en los filtros de la portada. Ahí los géneros se enseñan tal y como vienen, que es
// lo que el proveedor de datos afirma de ese título. Esta normalización existe para el MAPA, donde la
// pregunta no es "cómo se llama esto" sino "¿es esto lo mismo que aquello?".
//
// POR QUÉ EL NOMBRE VISIBLE SE ELIGE MIRANDO EL CATÁLOGO Y NO CON UNA LISTA ESCRITA A MANO: el mismo
// servicio aparece escrito de varias formas ("VIX", "ViX Premium…", "Vix Gratis…"). Una lista fija de
// "así se escribe cada uno" envejecería mal: el catálogo se regenera cada pocos meses y aparecerán
// servicios nuevos. En su lugar se agrupa por una forma comparable —sin mayúsculas ni acentos— y se
// adopta como nombre visible la grafía MÁS FRECUENTE del catálogo, que es la que el proveedor usa de
// verdad. Con el empate resuelto alfabéticamente, el resultado es el mismo en cada ejecución.

import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// UNTRANSLATED_TV_GENRES traduce los géneros de serie que el proveedor deja en inglés.
//
// Son exactamente SIETE y la lista es cerrada: se comprobó contra el catálogo completo y los únicos
// géneros que llegan sin traducir son estos. El resto —"Animación", "Comedia", "Crimen",
// "Documental", "Drama", "Misterio", "Western"— sí vienen en español y no necesitan nada.
//
// SOBRE LOS DOS CASOS QUE NO SON UNA TRADUCCIÓN LIMPIA, porque conviene ser honesto: "Action &
// Adventure" y "Sci-Fi & Fantasy" son géneros COMPUESTOS que en el catálogo de películas existen
// separados ("Acción" y "Aventura", "Ciencia ficción" y "Fantasía"). No hay forma de partirlos, así
// que cada uno se une al primero de sus dos componentes, que es el que le da nombre. Es una decisión,
// no una equivalencia exacta, y por eso está escrita: la alternativa —inventar un género nuevo
// llamado "Acción y aventura"— dejaría el duplicado exactamente donde estaba.
const UNTRANSLATED_TV_GENRES: Record<string, string> = {
  "action & adventure": "Acción",
  "sci-fi & fantasy": "Ciencia ficción",
  "war & politics": "Bélica",
  kids: "Familia",
  reality: "Telerrealidad",
  soap: "Telenovela",
  talk: "Programa de entrevistas",
};

// RESELLER_SUFFIX reconoce la reventa de un servicio a través de otra tienda.
//
// En español: "Crunchyroll Amazon Channel" no es una plataforma distinta de Crunchyroll; es el mismo
// Crunchyroll contratado desde Amazon. Para la pregunta que hace el mapa —"¿estas dos series están en
// el mismo sitio?"— la respuesta es sí, y por dónde se pague no cambia nada.
const RESELLER_SUFFIX = /\s+(?:amazon|apple\s+tv)\s+channels?$/i;

// TIER_SUFFIX reconoce las variantes comerciales del MISMO servicio: con anuncios, premium, gratis.
// En español: "Netflix Standard with Ads" es Netflix. Lo que cambia es el precio, no dónde está la
// serie. Que aparecieran como dos plataformas distintas partía en dos cada grupo de Netflix.
const TIER_SUFFIX = /\s+(?:(?:standard\s+)?with\s+ads|premium|gratis|basic)$/i;

// TRAILING_PLUS reconoce el "+" con el que algunos servicios terminan su nombre ("Paramount+").
// En español: el mismo servicio aparece unas veces con el signo y otras con la palabra ("Paramount
// Plus"). Se unifica en la palabra, que es como se lee en voz alta y como lo escribe la mayoría.
const TRAILING_PLUS = /\+$/;

// MAX_CLEANUP_ROUNDS es cuántas veces se repite la limpieza de sufijos sobre el mismo nombre.
//
// Dos, y hace falta: "ViX Premium Amazon Channel" arrastra los DOS sufijos a la vez. La primera
// vuelta le quita "Amazon Channel" y deja "ViX Premium"; la segunda le quita "Premium" y deja "ViX".
// Con una sola vuelta, ese servicio se habría quedado separado del resto de sus variantes.
const MAX_CLEANUP_ROUNDS = 2;

// collapseSpaces deja un nombre sin espacios de sobra (ni a los lados ni dobles por dentro).
// En español: el catálogo trae nombres con un espacio final ("VIX ", "Paramount Plus Apple TV Channel
// "), y un espacio invisible basta para que dos nombres iguales se traten como distintos.
function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

// foldForComparison reduce un nombre a la forma con la que se decide si dos nombres son EL MISMO.
// En español: sin mayúsculas y sin acentos, para que "VIX", "ViX" y "Vix" caigan en el mismo sitio.
// Esta forma NO se enseña nunca: solo sirve para agrupar.
function foldForComparison(value: string): string {
  return collapseSpaces(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// cleanPlatformName quita de un nombre de plataforma todo lo que describe la FORMA DE CONTRATARLA.
// Devuelve el nombre del servicio tal cual, con sus mayúsculas originales (la grafía definitiva se
// decide después, mirando cuál es la más frecuente del catálogo).
function cleanPlatformName(rawName: string): string {
  let name = collapseSpaces(rawName);
  for (let round = 0; round < MAX_CLEANUP_ROUNDS; round += 1) {
    name = collapseSpaces(name.replace(RESELLER_SUFFIX, "").replace(TIER_SUFFIX, ""));
  }
  if (TRAILING_PLUS.test(name)) {
    name = collapseSpaces(`${name.replace(TRAILING_PLUS, "")} Plus`);
  }
  return name;
}

// cleanGenreName traduce un género que venga sin traducir y deja el resto tal cual.
// En español: lo que no esté en la tabla se enseña como viene. Inventar una traducción para un género
// que apareciera mañana sería peor que enseñar el nombre original.
function cleanGenreName(rawName: string): string {
  const name = collapseSpaces(rawName);
  return UNTRANSLATED_TV_GENRES[foldForComparison(name)] ?? name;
}

// buildCanonicalNames decide, para una lista de nombres, cuál es la grafía definitiva de cada uno.
//
// En español: limpia cada nombre, los agrupa por su forma comparable y se queda con la grafía que más
// veces aparece en el catálogo. Devuelve un diccionario que va del nombre ORIGINAL al definitivo, de
// modo que reescribir un estreno es una consulta directa, sin volver a calcular nada.
//
// El empate se rompe por orden alfabético a propósito: sin esa regla, dos grafías igual de frecuentes
// podrían ganar alternativamente entre una carga y otra y el mapa cambiaría de nombres solo.
function buildCanonicalNames(
  rawNames: readonly string[],
  clean: (name: string) => string,
): Map<string, string> {
  // Por cada forma comparable, cuántas veces aparece cada grafía limpia.
  const spellingCounts = new Map<string, Map<string, number>>();
  for (const rawName of rawNames) {
    const cleaned = clean(rawName);
    if (cleaned === "") {
      continue;
    }
    const key = foldForComparison(cleaned);
    const counts = spellingCounts.get(key) ?? new Map<string, number>();
    counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
    spellingCounts.set(key, counts);
  }

  // La grafía ganadora de cada grupo: la más frecuente, y a igualdad, la primera alfabéticamente.
  const winnerByKey = new Map<string, string>();
  for (const [key, counts] of spellingCounts) {
    let winner = "";
    let winnerCount = -1;
    for (const [spelling, count] of counts) {
      const beatsCount = count > winnerCount;
      const tiesAndSortsFirst =
        count === winnerCount && spelling.localeCompare(winner, "es-MX") < 0;
      if (beatsCount || tiesAndSortsFirst) {
        winner = spelling;
        winnerCount = count;
      }
    }
    winnerByKey.set(key, winner);
  }

  // Y el diccionario final, del nombre tal y como viene al nombre definitivo.
  const canonicalByRawName = new Map<string, string>();
  for (const rawName of rawNames) {
    const cleaned = clean(rawName);
    if (cleaned === "") {
      continue;
    }
    canonicalByRawName.set(rawName, winnerByKey.get(foldForComparison(cleaned)) ?? cleaned);
  }
  return canonicalByRawName;
}

// dedupePreservingOrder quita repetidos conservando el orden en que aparecieron.
// En español: al unificar nombres, un mismo estreno puede acabar con "Netflix" dos veces (venía como
// "Netflix" y como "Netflix Standard with Ads"). Dejar el repetido dibujaría el mismo hilo dos veces.
function dedupePreservingOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (value !== "" && !seen.has(value)) {
      seen.add(value);
      unique.push(value);
    }
  }
  return unique;
}

// withCanonicalAttributes devuelve el catálogo con los géneros y las plataformas ya unificados.
//
// Se devuelve una COPIA y no se modifica el original a propósito: el catálogo que llega del servidor
// lo comparten otras partes de la pantalla (la lista de títulos vistos, por ejemplo), y cambiarles los
// datos por debajo sería el tipo de efecto oculto que hace imposible razonar sobre nada.
export function withCanonicalAttributes(
  catalog: readonly ReleaseSummary[],
): readonly ReleaseSummary[] {
  const allGenres: string[] = [];
  const allPlatforms: string[] = [];
  for (const release of catalog) {
    allGenres.push(...release.genres);
    allPlatforms.push(...(release.availability?.platforms ?? []));
  }

  const canonicalGenres = buildCanonicalNames(allGenres, cleanGenreName);
  const canonicalPlatforms = buildCanonicalNames(allPlatforms, cleanPlatformName);

  return catalog.map((release) => {
    const genres = dedupePreservingOrder(
      release.genres.map((genre) => canonicalGenres.get(genre) ?? genre),
    );
    const availability =
      release.availability === undefined
        ? undefined
        : {
            ...release.availability,
            platforms: dedupePreservingOrder(
              release.availability.platforms.map(
                (platform) => canonicalPlatforms.get(platform) ?? platform,
              ),
            ),
          };
    return { ...release, genres, availability };
  });
}
