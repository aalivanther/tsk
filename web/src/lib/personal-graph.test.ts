// Archivo: personal-graph.test.ts — Pruebas del mapa personal de la biblioteca.
//
// En español: lo que se defiende aquí es que el mapa sea LEGIBLE. Un grafo que conecta todo con todo
// es tan inútil como uno vacío, y la diferencia entre ambos son un par de reglas que estas pruebas
// fijan: que un atributo solo entre si de verdad une dos cosas, y que nunca se una un título con
// otro directamente.

import { describe, expect, it } from "vitest";

import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";
import { buildPersonalGraph, describeConnection } from "@/lib/personal-graph";

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

describe("buildPersonalGraph", () => {
  it("un atributo que solo toca UN título no entra en el mapa", () => {
    // Es la regla que hace legible el mapa entero. Un actor que sale en una sola película no une
    // nada: dibujarlo sería un punto colgando en el vacío, y multiplicado por cientos convierte el
    // mapa en una maraña sin significado.
    const grafo = buildPersonalGraph(
      ["a"],
      [makeRelease("a", { genres: ["Drama"], cast: ["Sol"] })],
    );

    expect(grafo.nodes.filter((n) => n.kind !== "title")).toHaveLength(0);
    expect(grafo.edges).toHaveLength(0);
  });

  it("un atributo compartido por dos títulos los une A TRAVÉS de él", () => {
    const grafo = buildPersonalGraph(
      ["a", "b"],
      [makeRelease("a", { genres: ["Terror"] }), makeRelease("b", { genres: ["Terror"] })],
    );

    const genero = grafo.nodes.find((n) => n.kind === "genre");
    expect(genero?.label).toBe("Terror");
    expect(genero?.degree).toBe(2);
    // Dos hilos: uno de cada título al género. NUNCA un hilo de título a título.
    expect(grafo.edges).toHaveLength(2);
    expect(grafo.edges.every((e) => e.target === genero?.id)).toBe(true);
  });

  it("nunca traza un hilo entre dos títulos", () => {
    // Es la estructura que mantiene el mapa explicable: para ir de una película a otra siempre se
    // pasa por la razón que las une, así que esa razón siempre está a la vista.
    const grafo = buildPersonalGraph(
      ["a", "b", "c"],
      [
        makeRelease("a", { genres: ["Drama"], cast: ["Sol"] }),
        makeRelease("b", { genres: ["Drama"], cast: ["Sol"] }),
        makeRelease("c", { genres: ["Drama"] }),
      ],
    );

    const titulos = new Set(grafo.nodes.filter((n) => n.kind === "title").map((n) => n.id));
    for (const hilo of grafo.edges) {
      expect(titulos.has(hilo.source)).toBe(true);
      expect(titulos.has(hilo.target)).toBe(false);
    }
  });

  it("reconoce a la misma persona aunque venga escrita distinta", () => {
    const grafo = buildPersonalGraph(
      ["a", "b"],
      [
        makeRelease("a", { cast: ["Lucía Arenas"] }),
        makeRelease("b", { cast: [" lucía arenas "] }),
      ],
    );

    const personas = grafo.nodes.filter((n) => n.kind === "cast");
    expect(personas).toHaveLength(1);
    expect(personas[0].degree).toBe(2);
  });

  it("un género y una persona que se llamen igual son puntos distintos", () => {
    // Parece rebuscado y es exactamente la clase de choque que aparece con datos reales.
    const grafo = buildPersonalGraph(
      ["a", "b"],
      [
        makeRelease("a", { genres: ["Drama"], cast: ["Drama"] }),
        makeRelease("b", { genres: ["Drama"], cast: ["Drama"] }),
      ],
    );

    expect(grafo.nodes.filter((n) => n.kind === "genre")).toHaveLength(1);
    expect(grafo.nodes.filter((n) => n.kind === "cast")).toHaveLength(1);
  });

  it("ignora lo visto que ya no está en el catálogo, sin romperse", () => {
    // El catálogo cubre una ventana de meses; alguien puede tener marcado algo de hace un año. Perder
    // un punto del mapa es infinitamente mejor que romper la pantalla entera.
    const grafo = buildPersonalGraph(["a", "fantasma"], [makeRelease("a", { genres: ["Drama"] })]);

    expect(grafo.nodes.filter((n) => n.kind === "title")).toHaveLength(1);
  });

  it("sin nada visto, el mapa está vacío pero es válido", () => {
    expect(buildPersonalGraph([], [makeRelease("a")])).toEqual({ nodes: [], edges: [] });
  });

  it("el peso de un atributo es a cuántos títulos toca", () => {
    // Es lo que decide su tamaño en pantalla: un director con tres películas tuyas pesa más.
    const grafo = buildPersonalGraph(
      ["a", "b", "c"],
      [
        makeRelease("a", { directors: ["Ana Ruiz"] }),
        makeRelease("b", { directors: ["Ana Ruiz"] }),
        makeRelease("c", { directors: ["Ana Ruiz"] }),
      ],
    );

    expect(grafo.nodes.find((n) => n.kind === "director")?.degree).toBe(3);
  });

  it("no duplica el hilo si una persona viene acreditada dos veces", () => {
    const grafo = buildPersonalGraph(
      ["a", "b"],
      [makeRelease("a", { cast: ["Sol", "Sol"] }), makeRelease("b", { cast: ["Sol"] })],
    );

    expect(grafo.edges).toHaveLength(2);
  });
});

describe("describeConnection", () => {
  it("explica en palabras por qué unas cosas están unidas", () => {
    // Un mapa de puntos y líneas no existe para quien navega con lector de pantalla. Esta función es
    // la que hace que la vista sea utilizable sin verla, y por eso tiene prueba propia.
    const grafo = buildPersonalGraph(
      ["a", "b"],
      [
        makeRelease("a", { title: "Duna 3", directors: ["Ana Ruiz"] }),
        makeRelease("b", { title: "Wicked 2", directors: ["Ana Ruiz"] }),
      ],
    );
    const director = grafo.nodes.find((n) => n.kind === "director");
    expect(director).toBeDefined();

    expect(describeConnection(grafo, director?.id ?? "")).toBe("Ana Ruiz: Duna 3, Wicked 2");
  });

  it("devuelve vacío si se le pregunta por un punto que no une nada", () => {
    const grafo = buildPersonalGraph(["a"], [makeRelease("a")]);

    expect(describeConnection(grafo, "no-existe")).toBe("");
  });
});
