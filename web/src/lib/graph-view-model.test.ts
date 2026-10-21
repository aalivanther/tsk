// Archivo: graph-view-model.test.ts — Pruebas de QUÉ parte del mapa personal se enseña.
//
// Qué se defiende aquí, en español: que apagar un tipo de vínculo no haga desaparecer ningún título
// de tu biblioteca (los títulos son tuyos, no un resultado de búsqueda), que el peso de cada título
// se recalcule con los filtros puestos, y que la alternativa en texto ordene la información por lo
// que de verdad importa: cuánto se repite cada cosa.

import { describe, expect, it } from "vitest";

import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";
import { buildPersonalGraph } from "@/lib/personal-graph";
import {
  ATTRIBUTE_KINDS,
  DEFAULT_MIN_SHARED_TITLES,
  DENSE_MIN_SHARED_TITLES,
  LARGE_LIBRARY_TITLES,
  attributesOfTitle,
  defaultMinSharedTitles,
  filterGraph,
  groupAttributesByKind,
  matchesSearch,
  neighbourIdsOf,
  titlesOfAttribute,
} from "@/lib/graph-view-model";

// makeRelease arma un estreno con lo mínimo que mira el mapa.
function makeRelease(
  id: string,
  options: {
    title?: string;
    genres?: string[];
    directors?: string[];
    cast?: string[];
    platforms?: string[];
  } = {},
): ReleaseSummary {
  // El molde imita el RESUMEN que manda el servidor: los nombres de dirección y de reparto ya vienen
  // resueltos, que es justo lo que evita tener la regla de "qué es un director" escrita dos veces.
  return {
    id,
    title: options.title ?? id,
    genres: options.genres ?? [],
    directorNames: options.directors ?? [],
    leadCastNames: options.cast ?? [],
    availability: { platforms: options.platforms ?? [], networks: [] },
  } as unknown as ReleaseSummary;
}

// grafoDePrueba: tres títulos que comparten género, dos que comparten actriz y dos que comparten
// director. Sirve para casi todas las pruebas de abajo.
function grafoDePrueba() {
  return buildPersonalGraph(
    ["a", "b", "c"],
    [
      makeRelease("a", { title: "Alfa", genres: ["Drama"], cast: ["Ana"], directors: ["Ruiz"] }),
      makeRelease("b", { title: "Beta", genres: ["Drama"], cast: ["Ana"], directors: ["Ruiz"] }),
      makeRelease("c", { title: "Ceta", genres: ["Drama"] }),
    ],
  );
}

describe("filterGraph", () => {
  it("apagar un tipo de vínculo NO borra ningún título de la biblioteca", () => {
    // Los títulos son tuyos: los marcaste. Un título que se queda sin ningún hilo sigue en el mapa,
    // flotando, porque eso también es información ("esto no se parece a nada más de lo tuyo").
    const grafo = grafoDePrueba();

    const soloReparto = filterGraph(grafo, { kinds: ["cast"], minSharedTitles: 2 });

    expect(soloReparto.nodes.filter((nodo) => nodo.kind === "title")).toHaveLength(3);
    expect(soloReparto.nodes.filter((nodo) => nodo.kind === "genre")).toHaveLength(0);
  });

  it("recalcula el peso de cada título según los vínculos que queden encendidos", () => {
    // Con todo encendido, "Alfa" toca tres cosas. Con solo el género, toca una. Si el peso no se
    // recalculara, se dibujaría gordo enseñando un solo hilo: el dibujo mentiría sobre el dato.
    const grafo = grafoDePrueba();

    const todo = filterGraph(grafo, { kinds: ATTRIBUTE_KINDS, minSharedTitles: 2 });
    const soloGenero = filterGraph(grafo, { kinds: ["genre"], minSharedTitles: 2 });

    expect(todo.nodes.find((nodo) => nodo.label === "Alfa")?.degree).toBe(3);
    expect(soloGenero.nodes.find((nodo) => nodo.label === "Alfa")?.degree).toBe(1);
  });

  it("subir el umbral quita lo que se repite poco", () => {
    // Es el control que hace legible una biblioteca grande: medido sobre el catálogo entero visto,
    // pasar de dos a tres quita sobre todo actores que repetían una única vez.
    const grafo = grafoDePrueba();

    const conDos = filterGraph(grafo, { kinds: ATTRIBUTE_KINDS, minSharedTitles: 2 });
    const conTres = filterGraph(grafo, { kinds: ATTRIBUTE_KINDS, minSharedTitles: 3 });

    // El género lo comparten los tres títulos; la actriz y el director, solo dos.
    expect(conDos.nodes.filter((nodo) => nodo.kind !== "title")).toHaveLength(3);
    expect(conTres.nodes.filter((nodo) => nodo.kind !== "title")).toHaveLength(1);
  });

  it("no deja hilos huérfanos apuntando a un vínculo que ya no está", () => {
    const grafo = grafoDePrueba();

    const filtrado = filterGraph(grafo, { kinds: ["cast"], minSharedTitles: 2 });
    const idsQueQuedan = new Set(filtrado.nodes.map((nodo) => nodo.id));

    for (const hilo of filtrado.edges) {
      expect(idsQueQuedan.has(hilo.source)).toBe(true);
      expect(idsQueQuedan.has(hilo.target)).toBe(true);
    }
  });
});

describe("defaultMinSharedTitles", () => {
  it("con una biblioteca pequeña se enseña todo", () => {
    expect(defaultMinSharedTitles(20)).toBe(DEFAULT_MIN_SHARED_TITLES);
  });

  it("con una biblioteca grande arranca filtrando el ruido", () => {
    expect(defaultMinSharedTitles(LARGE_LIBRARY_TITLES)).toBe(DENSE_MIN_SHARED_TITLES);
  });
});

describe("groupAttributesByKind", () => {
  it("ordena las secciones del vínculo más fuerte al más flojo", () => {
    // El orden no es decorativo: sale de medir el catálogo real. Compartir reparto conecta a más de
    // la mitad de los títulos con poco ruido; compartir "Drama" con otras cien películas, nada.
    const grafo = grafoDePrueba();

    const secciones = groupAttributesByKind(grafo);

    expect(secciones.map((seccion) => seccion.kind)).toEqual(["cast", "director", "genre"]);
  });

  it("dentro de cada sección, primero lo que une a más títulos", () => {
    const grafo = buildPersonalGraph(
      ["a", "b", "c"],
      [
        makeRelease("a", { cast: ["Muchos", "Pocos"] }),
        makeRelease("b", { cast: ["Muchos", "Pocos"] }),
        makeRelease("c", { cast: ["Muchos"] }),
      ],
    );

    const reparto = groupAttributesByKind(grafo)[0];

    expect(reparto.nodes.map((nodo) => nodo.label)).toEqual(["Muchos", "Pocos"]);
  });
});

describe("titlesOfAttribute y attributesOfTitle", () => {
  it("dice qué títulos tuyos cuelgan de un vínculo", () => {
    // Es la pregunta para la que la lista responde mejor que el dibujo, para todo el mundo: "¿en qué
    // películas mías sale esta persona?".
    const grafo = grafoDePrueba();
    const ana = grafo.nodes.find((nodo) => nodo.label === "Ana");

    expect(titlesOfAttribute(grafo, ana?.id ?? "").map((nodo) => nodo.label)).toEqual([
      "Alfa",
      "Beta",
    ]);
  });

  it("dice por qué razones está un título donde está", () => {
    const grafo = grafoDePrueba();
    const alfa = grafo.nodes.find((nodo) => nodo.label === "Alfa");

    expect(
      attributesOfTitle(grafo, alfa?.id ?? "")
        .map((nodo) => nodo.label)
        .sort(),
    ).toEqual(["Ana", "Drama", "Ruiz"]);
  });
});

describe("neighbourIdsOf", () => {
  it("encuentra los vecinos tanto desde un título como desde un vínculo", () => {
    // Es lo que permite saltar con las flechas del teclado de un punto a lo que cuelga de él: las
    // líneas del dibujo son, además, las rutas por las que se navega sin ver la pantalla.
    const grafo = grafoDePrueba();
    const alfa = grafo.nodes.find((nodo) => nodo.label === "Alfa");
    const ana = grafo.nodes.find((nodo) => nodo.label === "Ana");

    expect(neighbourIdsOf(grafo, alfa?.id ?? "").has(ana?.id ?? "")).toBe(true);
    expect(neighbourIdsOf(grafo, ana?.id ?? "").has(alfa?.id ?? "")).toBe(true);
  });
});

describe("matchesSearch", () => {
  const nodo = { id: "x", kind: "cast" as const, label: "Lucía Arenas", degree: 2 };

  it("encuentra por un trozo del nombre y sin distinguir mayúsculas", () => {
    expect(matchesSearch(nodo, "aren")).toBe(true);
    expect(matchesSearch(nodo, "LUCÍA")).toBe(true);
  });

  it("con el buscador vacío, todo encaja", () => {
    expect(matchesSearch(nodo, "   ")).toBe(true);
  });

  it("no inventa coincidencias", () => {
    expect(matchesSearch(nodo, "terror")).toBe(false);
  });
});
