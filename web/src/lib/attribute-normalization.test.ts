// Archivo: attribute-normalization.test.ts — Pruebas de que el mismo concepto acaba siendo UNO solo.
//
// Qué se defiende aquí, en español: que dos títulos que están en el mismo servicio de streaming
// queden conectados aunque el catálogo escriba ese servicio de dos formas distintas, y que dos series
// del mismo género queden conectadas aunque el catálogo traiga el género de una en español y el de la
// otra en inglés. Son los dos casos que se midieron en el catálogo real y que partían en dos los
// grupos del mapa personal.
//
// Y también se defiende lo contrario, que es igual de importante: que dos servicios que de verdad son
// distintos NO se fundan en uno solo por parecerse de nombre.

import { describe, expect, it } from "vitest";

import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";
import { withCanonicalAttributes } from "@/lib/attribute-normalization";

// makeRelease arma un estreno con lo mínimo que mira esta normalización.
function makeRelease(id: string, genres: string[], platforms: string[]): ReleaseSummary {
  return {
    id,
    title: id,
    genres,
    directorNames: [],
    leadCastNames: [],
    availability: { platforms, networks: [] },
  } as unknown as ReleaseSummary;
}

// generosDe / plataformasDe leen el resultado de un estreno concreto, para no repetir el índice.
function generosDe(catalog: readonly ReleaseSummary[], index: number): string[] {
  return [...catalog[index].genres];
}
function plataformasDe(catalog: readonly ReleaseSummary[], index: number): string[] {
  return [...(catalog[index].availability?.platforms ?? [])];
}

describe("withCanonicalAttributes — géneros", () => {
  it("une el género de serie en inglés con su equivalente en español", () => {
    // Es el caso REAL del catálogo: 42 títulos con "Action & Adventure" y 18 con "Acción" formaban
    // dos grupos separados que deberían ser uno.
    const resultado = withCanonicalAttributes([
      makeRelease("serie", ["Action & Adventure"], []),
      makeRelease("pelicula", ["Acción"], []),
    ]);

    expect(generosDe(resultado, 0)).toEqual(["Acción"]);
    expect(generosDe(resultado, 1)).toEqual(["Acción"]);
  });

  it("traduce también los géneros que solo existen en las series", () => {
    // "Reality" y "Soap" no tienen equivalente entre los géneros de película, así que no unen nada
    // con nadie; se traducen igualmente porque el producto está en español.
    const resultado = withCanonicalAttributes([makeRelease("x", ["Reality", "Soap"], [])]);

    expect(generosDe(resultado, 0)).toEqual(["Telerrealidad", "Telenovela"]);
  });

  it("deja tal cual el género que no está en la tabla", () => {
    // Inventar una traducción para un género nuevo sería peor que enseñar el nombre original.
    const resultado = withCanonicalAttributes([makeRelease("x", ["Drama", "Cyberpunk"], [])]);

    expect(generosDe(resultado, 0)).toEqual(["Drama", "Cyberpunk"]);
  });
});

describe("withCanonicalAttributes — plataformas", () => {
  it("une la variante con anuncios con el servicio de siempre", () => {
    const resultado = withCanonicalAttributes([
      makeRelease("a", [], ["Netflix"]),
      makeRelease("b", [], ["Netflix Standard with Ads"]),
    ]);

    expect(plataformasDe(resultado, 0)).toEqual(["Netflix"]);
    expect(plataformasDe(resultado, 1)).toEqual(["Netflix"]);
  });

  it("une la reventa a través de otra tienda con el servicio original", () => {
    const resultado = withCanonicalAttributes([
      makeRelease("a", [], ["Crunchyroll"]),
      makeRelease("b", [], ["Crunchyroll Amazon Channel"]),
      makeRelease("c", [], ["Paramount Plus Apple TV Channel "]),
      makeRelease("d", [], ["Paramount+"]),
    ]);

    expect(plataformasDe(resultado, 0)).toEqual(["Crunchyroll"]);
    expect(plataformasDe(resultado, 1)).toEqual(["Crunchyroll"]);
    expect(plataformasDe(resultado, 2)).toEqual(["Paramount Plus"]);
    expect(plataformasDe(resultado, 3)).toEqual(["Paramount Plus"]);
  });

  it("quita los DOS sufijos cuando vienen encadenados", () => {
    // "ViX Premium Amazon Channel" arrastra a la vez la variante de precio y la tienda que la revende.
    const resultado = withCanonicalAttributes([
      makeRelease("a", [], ["ViX Premium Amazon Channel"]),
      makeRelease("b", [], ["Vix Gratis Amazon Channel"]),
    ]);

    expect(plataformasDe(resultado, 0)).toEqual(plataformasDe(resultado, 1));
  });

  it("no deja el mismo servicio dos veces en un título que traía las dos variantes", () => {
    // Pasa en el catálogo real: casi todos los títulos de Netflix vienen listados también en su plan
    // con anuncios. Sin quitar el repetido, el mapa dibujaría dos veces el mismo hilo.
    const resultado = withCanonicalAttributes([
      makeRelease("a", [], ["Netflix", "Netflix Standard with Ads"]),
    ]);

    expect(plataformasDe(resultado, 0)).toEqual(["Netflix"]);
  });

  it("NO funde servicios que de verdad son distintos", () => {
    // La comprobación en negativo: unificar de más sería tan malo como no unificar.
    const resultado = withCanonicalAttributes([
      makeRelease("a", [], ["Apple TV", "Amazon Prime Video", "Disney Plus", "HBO Max"]),
    ]);

    expect(plataformasDe(resultado, 0)).toEqual([
      "Apple TV",
      "Amazon Prime Video",
      "Disney Plus",
      "HBO Max",
    ]);
  });

  it("elige siempre la misma grafía cuando el catálogo escribe el nombre de varias formas", () => {
    // La grafía ganadora es la más frecuente. Aquí "Netflix" aparece dos veces y "NETFLIX" una, así
    // que las tres apariciones tienen que acabar escritas igual, y de la forma mayoritaria.
    const resultado = withCanonicalAttributes([
      makeRelease("a", [], ["Netflix"]),
      makeRelease("b", [], ["Netflix"]),
      makeRelease("c", [], ["NETFLIX"]),
    ]);

    expect(plataformasDe(resultado, 2)).toEqual(["Netflix"]);
  });
});

describe("withCanonicalAttributes — no toca el original", () => {
  it("devuelve una copia y deja intacto el catálogo que recibió", () => {
    // El catálogo lo comparten otras partes de la pantalla: cambiárselo por debajo sería un efecto
    // oculto de los que hacen imposible razonar sobre nada.
    const original = [makeRelease("a", ["Action & Adventure"], ["Netflix Standard with Ads"])];

    withCanonicalAttributes(original);

    expect(original[0].genres).toEqual(["Action & Adventure"]);
    expect(original[0].availability?.platforms).toEqual(["Netflix Standard with Ads"]);
  });
});
