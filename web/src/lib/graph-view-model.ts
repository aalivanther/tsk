// Archivo: graph-view-model.ts — Lo que se ENSEÑA del mapa personal (y lo que se deja fuera).
//
// Qué separa este archivo, en español:
//
// personal-graph.ts calcula el mapa COMPLETO: todo lo que has visto y todo lo que une unas cosas con
// otras. Ese mapa completo no siempre es el mapa que conviene enseñar. Con quince títulos vistos sí;
// con cuatrocientos, enseñarlo entero es enseñar una maraña. Aquí viven las decisiones de "qué parte
// del mapa se muestra ahora mismo", que son distintas de "qué relaciones existen".
//
// Son tres decisiones, y las tres tienen su porqué medido:
//
//   1. QUÉ TIPOS DE VÍNCULO se muestran. Compartir actor o director dice algo; compartir el género
//      "Drama" en un catálogo donde 189 títulos son drama no dice nada. La persona puede apagar los
//      vínculos flojos con un interruptor y quedarse con los que significan algo.
//
//   2. CUÁNTO TIENE QUE REPETIRSE algo para salir. Por defecto, dos títulos (lo que ya filtra
//      personal-graph). A partir de una biblioteca grande sube a tres: medido sobre el catálogo
//      entero visto, ese solo cambio baja el mapa de 602 puntos a 478 y quita sobre todo actores que
//      repetían una única vez, que es ruido con forma de información.
//
//   3. CUÁNDO NO HAY MAPA QUE ENSEÑAR. Con cero o con tres títulos vistos no hay casi nada
//      compartido, y dibujar un grafo de tres puntos sueltos es peor que decir la verdad: que hace
//      falta marcar unas cuantas cosas más para que empiecen a aparecer conexiones.
//
// Aquí también vive el texto que se le lee en voz alta a quien navega sin ver la pantalla. Está junto
// al resto porque es la MISMA información que el dibujo, no un resumen de consolación: si el dibujo
// cambia, este texto cambia con él y no hay forma de que se queden desincronizados.

import { type GraphNode, type GraphNodeKind, type PersonalGraph } from "@/lib/personal-graph";

// ATTRIBUTE_KINDS son los tipos de vínculo que pueden unir dos títulos, en orden de FUERZA.
//
// En español: el orden no es decorativo, es el que decide en qué orden se leen las secciones de la
// lista y qué se enseña primero. Sale de medir el catálogo real: compartir reparto conecta a más de
// la mitad de los títulos con muy poco ruido; compartir dirección conecta poquísimos pero cuando pasa
// es una señal fortísima; el género conecta a casi todos con casi ningún significado.
export const ATTRIBUTE_KINDS: readonly GraphNodeKind[] = [
  "cast",
  "director",
  "platform",
  "genre",
] as const;

// DEFAULT_MIN_SHARED_TITLES es cuántos títulos tiene que compartir un vínculo para verse, de normal.
// Dos: es el filtro que ya aplica personal-graph y el que hace legible el mapa.
export const DEFAULT_MIN_SHARED_TITLES = 2;

// DENSE_MIN_SHARED_TITLES es ese mismo número cuando la biblioteca ya es grande.
// Tres. Ver el punto 2 de la cabecera: es lo que quita el ruido sin quitar información.
export const DENSE_MIN_SHARED_TITLES = 3;

// LARGE_LIBRARY_TITLES es a partir de cuántos títulos vistos la biblioteca se considera grande.
// Doscientos, que es donde la investigación situó el punto en el que el mapa deja de caber cómodo.
export const LARGE_LIBRARY_TITLES = 200;

// MIN_TITLES_FOR_GRAPH es cuántos títulos vistos hacen falta para que un mapa tenga sentido.
//
// Cinco. Por debajo de eso casi no hay atributos compartidos —haría falta que las mismas personas o
// los mismos géneros se repitieran—, así que el mapa saldría casi sin hilos. Enseñar eso haría
// pensar que la función está rota; decir cuántos faltan es información útil.
export const MIN_TITLES_FOR_GRAPH = 5;

// GraphFilter es la vista que la persona ha elegido del mapa.
export type GraphFilter = {
  // kinds son los tipos de vínculo encendidos (los apagados no se dibujan ni se listan).
  kinds: readonly GraphNodeKind[];
  // minSharedTitles es cuántos títulos tiene que compartir un vínculo para entrar.
  minSharedTitles: number;
};

// defaultMinSharedTitles decide el umbral inicial según lo grande que sea la biblioteca.
// En español: quien tiene veinte títulos vistos quiere verlo todo; quien tiene cuatrocientos necesita
// que alguien le quite el ruido de encima antes de mirar. El interruptor sigue estando a la vista
// para deshacer esta decisión en cualquier momento.
export function defaultMinSharedTitles(watchedCount: number): number {
  return watchedCount >= LARGE_LIBRARY_TITLES ? DENSE_MIN_SHARED_TITLES : DEFAULT_MIN_SHARED_TITLES;
}

// filterGraph devuelve el trozo del mapa que corresponde a la vista elegida.
//
// En español: los títulos SIEMPRE se quedan —son tu biblioteca, no un resultado de búsqueda—; lo que
// se filtra son los vínculos. Un título que se quede sin ningún hilo sigue en el mapa, flotando: eso
// también es información ("esto que viste no se parece a nada más de lo tuyo"), y esconderlo sería
// hacer desaparecer algo que la persona sí marcó.
//
// El peso de cada título se recalcula al final, porque "a cuántas cosas toca" depende de qué vínculos
// estén encendidos: con el género apagado, una película puede pasar de tocar seis cosas a tocar una.
export function filterGraph(graph: PersonalGraph, filter: GraphFilter): PersonalGraph {
  const allowedKinds = new Set(filter.kinds);

  // Primero se decide qué ATRIBUTOS sobreviven: los del tipo encendido que además se repiten lo
  // suficiente.
  const survivingAttributes = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (node.kind === "title") {
      continue;
    }
    if (allowedKinds.has(node.kind) && node.degree >= filter.minSharedTitles) {
      survivingAttributes.set(node.id, node);
    }
  }

  // Después los hilos: solo los que van a parar a un atributo que sobrevivió.
  const edges = graph.edges.filter((edge) => survivingAttributes.has(edge.target));

  // Y con los hilos ya decididos, cuánto pesa ahora cada título.
  const degreeByTitle = new Map<string, number>();
  for (const edge of edges) {
    degreeByTitle.set(edge.source, (degreeByTitle.get(edge.source) ?? 0) + 1);
  }

  const nodes: GraphNode[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "title") {
      nodes.push({ ...node, degree: degreeByTitle.get(node.id) ?? 0 });
      continue;
    }
    const survivor = survivingAttributes.get(node.id);
    if (survivor !== undefined) {
      nodes.push(survivor);
    }
  }

  return { nodes, edges };
}

// AttributeGroup es una sección de la lista: un tipo de vínculo y todo lo que hay de ese tipo.
export type AttributeGroup = {
  kind: GraphNodeKind;
  // nodes son los vínculos de ese tipo, del que más títulos une al que menos.
  nodes: GraphNode[];
};

// groupAttributesByKind arma las secciones de la ALTERNATIVA EN TEXTO del mapa.
//
// Por qué existe esta vista y por qué no es un premio de consolación, en español: un mapa de puntos
// sencillamente NO EXISTE para quien navega con lector de pantalla, así que la misma información
// tiene que estar disponible como texto recorrible o la pantalla está a medio hacer. Pero además, y
// esto es lo que la convierte en una vista de pleno derecho: para la pregunta "¿en qué tres películas
// mías sale este actor?" la lista responde mejor y más rápido que el dibujo, para todo el mundo.
//
// Las secciones salen en el orden de ATTRIBUTE_KINDS (de vínculo fuerte a flojo) y dentro de cada una
// se ordena por cuántos títulos une, porque eso es lo que hace interesante a un vínculo. A igualdad,
// alfabético en español, para que el orden sea estable entre recargas y no baile.
export function groupAttributesByKind(graph: PersonalGraph): AttributeGroup[] {
  const groups: AttributeGroup[] = [];
  for (const kind of ATTRIBUTE_KINDS) {
    const nodes = graph.nodes
      .filter((node) => node.kind === kind)
      .sort((left, right) =>
        right.degree !== left.degree
          ? right.degree - left.degree
          : left.label.localeCompare(right.label, "es-MX"),
      );
    if (nodes.length > 0) {
      groups.push({ kind, nodes });
    }
  }
  return groups;
}

// titlesOfAttribute devuelve los títulos que cuelgan de un vínculo, ordenados alfabéticamente.
// En español: es lo que se despliega al abrir "Ana Ruiz" en la lista, y también lo que se resalta en
// el dibujo al pulsar su punto. Una sola función para los dos sitios: si se separaran, un día
// enseñarían cosas distintas.
export function titlesOfAttribute(graph: PersonalGraph, attributeId: string): GraphNode[] {
  const titleIds = new Set(
    graph.edges.filter((edge) => edge.target === attributeId).map((edge) => edge.source),
  );
  return graph.nodes
    .filter((node) => node.kind === "title" && titleIds.has(node.id))
    .sort((left, right) => left.label.localeCompare(right.label, "es-MX"));
}

// attributesOfTitle devuelve los vínculos que salen de un título, del que más une al que menos.
// En español: es lo que se resalta al posar el foco en una película del mapa ("esto está aquí por
// estas cuatro razones") y lo que se lee en su ficha dentro de la lista.
export function attributesOfTitle(graph: PersonalGraph, titleNodeId: string): GraphNode[] {
  const attributeIds = new Set(
    graph.edges.filter((edge) => edge.source === titleNodeId).map((edge) => edge.target),
  );
  return graph.nodes
    .filter((node) => node.kind !== "title" && attributeIds.has(node.id))
    .sort((left, right) =>
      right.degree !== left.degree
        ? right.degree - left.degree
        : left.label.localeCompare(right.label, "es-MX"),
    );
}

// neighbourIdsOf devuelve los identificadores de todo lo que cuelga directamente de un punto.
//
// En español: sirve para dos cosas a la vez. Para RESALTAR en el dibujo (al pulsar un punto, lo suyo
// se ilumina y el resto se apaga) y para SALTAR con el teclado (desde un punto, las flechas arriba y
// abajo recorren sus vecinos). Es la misma idea que "las líneas son también rutas por las que se
// navega", que es como resuelve esto la literatura seria sobre gráficos accesibles.
export function neighbourIdsOf(graph: PersonalGraph, nodeId: string): Set<string> {
  const neighbours = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === nodeId) {
      neighbours.add(edge.target);
    } else if (edge.target === nodeId) {
      neighbours.add(edge.source);
    }
  }
  return neighbours;
}

// matchesSearch dice si un punto encaja con lo que la persona escribió en el buscador.
// En español: comparación tolerante (sin mayúsculas ni espacios sobrantes) y por trozo, para que
// escribir "aren" encuentre a "Lucía Arenas". Con el buscador vacío, todo encaja.
export function matchesSearch(node: GraphNode, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  return node.label.toLowerCase().includes(needle);
}
