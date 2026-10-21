// Archivo: personal-graph.ts — Construye el mapa de tu biblioteca: qué has visto y qué lo une.
//
// Qué es esto, en español:
//
// La idea es la de una libreta de notas enlazadas: cada cosa que has visto es un punto, y de él salen
// hilos hacia lo que tiene en común con lo demás — un actor, un director, un género. Al mirar el
// conjunto, aparecen solos los grupos: "todo esto lo dirige la misma persona", "esta esquina es todo
// terror". Nadie te lo dice; se ve.
//
// LA DECISIÓN QUE MÁS CONDICIONA EL RESULTADO, y por qué es esta:
//
// Había dos formas de montarlo. La primera, unir los títulos directamente entre sí cuando comparten
// algo. La segunda, que es la que está implementada: que los ATRIBUTOS también sean puntos, de modo
// que dos títulos queden unidos *a través* de lo que comparten.
//
// Se midieron las dos sobre el catálogo real, y la primera se descarta con números. Con cincuenta
// títulos vistos ya salían 690 líneas: más de la mitad de todas las parejas posibles unidas. Eso no
// es un mapa, es una mancha, y no se arregla dibujándolo mejor. Con la segunda forma, el catálogo
// ENTERO visto (422 títulos, un extremo que nadie va a alcanzar pronto) da 821 puntos y 2 632 líneas.
//
// Pero lo importante no es que sean menos líneas: es que se pueden EXPLICAR. Ves el punto de un
// director con tres películas colgando y entiendes de un vistazo por qué están juntas. En la otra
// forma verías tres líneas sin etiqueta y tendrías que adivinar.
//
// EL FILTRO QUE HACE QUE FUNCIONE: un atributo solo entra en el mapa si lo comparten DOS O MÁS
// títulos. Un actor que sale en una sola película no une nada — solo añadiría un punto colgando de
// otro punto, ruido puro. Ese filtro es la diferencia entre las 2 632 líneas y un enredo ilegible.

import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// GraphNodeKind es de qué tipo es cada punto del mapa.
//
// En español: o es algo que viste, o es la razón por la que dos cosas que viste se parecen. Se
// distinguen porque en pantalla se dibujan distinto y porque al pulsarlos pasan cosas distintas: un
// título abre su ficha; un atributo enseña todo lo que cuelga de él.
export type GraphNodeKind = "title" | "genre" | "director" | "cast" | "platform";

// GraphNode es un punto del mapa.
export type GraphNode = {
  // id identifica al punto de forma única dentro del mapa (lleva el tipo dentro para que un género
  // llamado igual que una persona no se confundan).
  id: string;
  // kind dice de qué tipo es (ver GraphNodeKind).
  kind: GraphNodeKind;
  // label es el texto que se ve: el título de la película o el nombre del atributo.
  label: string;
  // degree es a cuántos títulos toca este punto. En los atributos es lo que decide su tamaño en
  // pantalla: un director con seis películas tuyas pesa más que uno con dos.
  degree: number;
  // releaseId es el identificador del estreno, SOLO en los puntos de tipo título. Es lo que permite
  // abrir su ficha al pulsarlo.
  releaseId?: string;
};

// GraphEdge es un hilo entre un título y uno de sus atributos.
//
// En español: nunca une dos títulos ni dos atributos. Esa es toda la estructura del mapa y es lo que
// lo mantiene legible: para ir de una película a otra siempre se pasa por la razón que las une.
export type GraphEdge = {
  // source es el punto del título.
  source: string;
  // target es el punto del atributo.
  target: string;
};

// PersonalGraph es el mapa completo, listo para dibujar.
export type PersonalGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

// CAST_DEPTH_FOR_GRAPH es cuántas personas del reparto de cada título entran en el mapa.
//
// En español: las cinco primeras. El reparto viene ordenado por importancia, así que son los
// protagonistas — la gente por la que alguien dice "esa es la de tal actriz". Incluir el reparto
// entero llenaría el mapa de secundarios de una sola escena, que no explican ningún parecido y
// multiplicarían los puntos por diez sin añadir una sola idea.
//
// El resumen que manda el servidor trae diez nombres; aquí se toman los cinco primeros, que es lo
// mismo que se hacía cuando este archivo leía la ficha completa. Se conserva el número para que el
// mapa no cambie de forma por un detalle de dónde vienen los datos.
const CAST_DEPTH_FOR_GRAPH = 5;

// MIN_SHARED_TITLES es cuántos títulos tiene que tocar un atributo para entrar en el mapa.
//
// Dos. Es el filtro explicado en la cabecera: un atributo que solo toca un título no une nada, y
// dibujarlo solo añadiría un punto colgando en el vacío. Es la diferencia entre un mapa legible y
// una maraña.
const MIN_SHARED_TITLES = 2;

// normalizeName deja un nombre en una forma comparable (sin espacios sobrantes, en minúsculas).
// En español: es lo que hace que "Lucía Arenas" y "lucía arenas " se reconozcan como la misma
// persona en vez de aparecer como dos puntos distintos en el mapa.
function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

// attributeId compone el identificador de un punto de atributo, con su tipo dentro.
// En español: sin el tipo, un género llamado "Drama" y una persona llamada "Drama" serían el mismo
// punto. Parece rebuscado, pero es exactamente la clase de choque que aparece con datos reales.
function attributeId(kind: GraphNodeKind, name: string): string {
  return `${kind}:${normalizeName(name)}`;
}

// collectAttributes saca de un estreno todos los atributos que pueden unirlo con otros.
//
// Devuelve el tipo y el nombre TAL COMO SE ESCRIBE (con sus mayúsculas y acentos), porque es lo que
// se va a leer en pantalla; la comparación se hace aparte, en forma normalizada.
function collectAttributes(release: ReleaseSummary): { kind: GraphNodeKind; label: string }[] {
  const attributes: { kind: GraphNodeKind; label: string }[] = [];

  for (const genre of release.genres) {
    if (genre.trim() !== "") {
      attributes.push({ kind: "genre", label: genre.trim() });
    }
  }

  // QUIÉN DECIDE QUÉ ES UN DIRECTOR: el servidor, y en un solo sitio.
  //
  // En español: la regla de qué puesto cuenta como dirección vivía aquí escrita a mano, y también en
  // el servidor. Dos copias de una misma regla acaban siempre diciendo cosas distintas: bastaría con
  // que alguien añadiera un puesto nuevo en un lado para que el mapa y las conexiones de la ficha
  // dejaran de coincidir sin que nada fallara. Y esa regla ya tuvo un fallo de este tipo — comparaba
  // el puesto en español cuando los datos llegan en inglés, y dejó una funcionalidad entera muda
  // durante meses. Ahora el servidor manda los nombres ya resueltos y aquí solo se leen.
  for (const name of release.directorNames) {
    if (name.trim() !== "") {
      attributes.push({ kind: "director", label: name.trim() });
    }
  }

  for (const name of release.leadCastNames.slice(0, CAST_DEPTH_FOR_GRAPH)) {
    if (name.trim() !== "") {
      attributes.push({ kind: "cast", label: name.trim() });
    }
  }

  for (const platform of release.availability?.platforms ?? []) {
    if (platform.trim() !== "") {
      attributes.push({ kind: "platform", label: platform.trim() });
    }
  }

  return attributes;
}

// buildPersonalGraph arma el mapa a partir de lo que la persona ha visto.
//
// Recibe los identificadores de lo visto y el catálogo del que sacar sus datos. Lo que no esté en el
// catálogo se ignora en silencio: es lo correcto, porque el catálogo cubre una ventana de meses y
// alguien puede tener marcado algo de hace un año que ya no se sirve. Perder un punto del mapa es
// mucho mejor que romper la pantalla entera por un identificador viejo.
export function buildPersonalGraph(
  watchedIds: readonly string[],
  catalog: readonly ReleaseSummary[],
): PersonalGraph {
  const byId = new Map(catalog.map((release) => [release.id, release]));

  // Primera pasada: contar a cuántos títulos toca cada atributo. Hay que recorrerlo todo ANTES de
  // decidir qué entra, porque un atributo solo se gana su sitio si lo comparten dos o más.
  const attributeTitles = new Map<
    string,
    { kind: GraphNodeKind; label: string; titles: Set<string> }
  >();
  const includedTitles: ReleaseSummary[] = [];

  for (const watchedId of watchedIds) {
    const release = byId.get(watchedId);
    if (release === undefined) {
      continue;
    }
    includedTitles.push(release);
    for (const attribute of collectAttributes(release)) {
      const key = attributeId(attribute.kind, attribute.label);
      const entry = attributeTitles.get(key);
      if (entry === undefined) {
        attributeTitles.set(key, {
          kind: attribute.kind,
          label: attribute.label,
          titles: new Set([release.id]),
        });
      } else {
        entry.titles.add(release.id);
      }
    }
  }

  // Segunda pasada: se quedan solo los atributos que de verdad unen algo.
  const sharedAttributes = new Map<
    string,
    { kind: GraphNodeKind; label: string; titles: Set<string> }
  >();
  for (const [key, entry] of attributeTitles) {
    if (entry.titles.size >= MIN_SHARED_TITLES) {
      sharedAttributes.set(key, entry);
    }
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Los puntos de atributo, con su peso (a cuántos títulos tocan).
  for (const [key, entry] of sharedAttributes) {
    nodes.push({ id: key, kind: entry.kind, label: entry.label, degree: entry.titles.size });
  }

  // Los puntos de título, y sus hilos hacia los atributos que sí entraron.
  for (const release of includedTitles) {
    const titleNodeId = `title:${release.id}`;
    let degree = 0;
    // Un mismo atributo podría salir dos veces del mismo título (una persona acreditada dos veces);
    // se cuenta una sola vez para no dibujar hilos duplicados encima del mismo trazo.
    const linked = new Set<string>();
    for (const attribute of collectAttributes(release)) {
      const key = attributeId(attribute.kind, attribute.label);
      if (!sharedAttributes.has(key) || linked.has(key)) {
        continue;
      }
      linked.add(key);
      edges.push({ source: titleNodeId, target: key });
      degree += 1;
    }
    nodes.push({
      id: titleNodeId,
      kind: "title",
      label: release.title,
      degree,
      releaseId: release.id,
    });
  }

  return { nodes, edges };
}

// describeConnection explica, en palabras, por qué dos títulos están unidos.
//
// Existe porque un mapa de puntos y líneas es inútil para quien no lo ve: quien navega con lector de
// pantalla necesita la misma información en texto. La accesibilidad de esta vista no es un añadido
// opcional; sin esto, la pantalla sencillamente no existe para esa persona.
export function describeConnection(graph: PersonalGraph, attributeNodeId: string): string {
  const attribute = graph.nodes.find((node) => node.id === attributeNodeId);
  if (attribute === undefined || attribute.kind === "title") {
    return "";
  }
  const titleIds = new Set(
    graph.edges.filter((edge) => edge.target === attributeNodeId).map((edge) => edge.source),
  );
  const titles = graph.nodes
    .filter((node) => node.kind === "title" && titleIds.has(node.id))
    .map((node) => node.label);
  return `${attribute.label}: ${titles.join(", ")}`;
}
