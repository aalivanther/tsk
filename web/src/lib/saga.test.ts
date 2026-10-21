// Archivo: saga.test.ts — Pruebas de la página de una saga.
//
// Qué se defiende aquí, en español: que la dirección de una saga sea única y estable (o alguna saga
// se volvería inalcanzable en silencio), y que una entrada que NO está en el catálogo se quede sin
// enlace en vez de fingir uno que lleva a una página vacía.

import { describe, expect, it } from "vitest";

import { TitleType, type Release } from "@/gen/mdm7mo/catalog/v1/catalog_pb";
import { findSagaBySlug, pickSagaHighlight, resolveCollectionItem, sagaSlug } from "@/lib/saga";

// makeRelease arma un estreno con lo mínimo que miran estas funciones.
function makeRelease(
  id: string,
  options: {
    title?: string;
    releaseDate?: string;
    type?: TitleType;
    sagaName?: string;
    sagaItems?: { title: string; year?: string }[];
    tmdb?: number;
    hasVideo?: boolean;
  } = {},
): Release {
  return {
    id,
    title: options.title ?? id,
    releaseDate: options.releaseDate ?? "2026-06-01",
    type: options.type ?? TitleType.MOVIE,
    ratings: { tmdb: options.tmdb ?? 0, imdb: "", rottenTomatoes: "", metacritic: "" },
    videos: options.hasVideo === true ? [{ youtubeKey: `v-${id}` }] : [],
    saga:
      options.sagaName === undefined
        ? undefined
        : {
            name: options.sagaName,
            items: (options.sagaItems ?? []).map((item) => ({
              title: item.title,
              year: item.year ?? "",
              posterUrl: "",
              overview: "",
              backdropUrl: "",
              rating: 0,
              extra: "",
            })),
          },
  } as unknown as Release;
}

describe("sagaSlug", () => {
  it("convierte un nombre normal en una dirección legible", () => {
    expect(sagaSlug("Toy Story - Colección")).toMatch(/^toy-story-coleccion-[0-9a-f]{8}$/);
  });

  it("da SIEMPRE el mismo resultado para el mismo nombre", () => {
    // Es lo que permite que un enlace compartido hoy siga funcionando mañana.
    expect(sagaSlug("Réquiem")).toBe(sagaSlug("Réquiem"));
  });

  it("no deja sin dirección a los nombres que no usan el alfabeto latino", () => {
    // Este es el fallo que se destapó midiendo el catálogo real: once sagas escritas en japonés,
    // hindi o tamil se quedaban en una dirección VACÍA al quitarles todo lo que no fuera una letra
    // latina, así que compartían la misma y diez de ellas eran inalcanzables sin dar ningún error.
    const japones = sagaSlug("ゴールデンカムイ");
    const hindi = sagaSlug("अलायन्स");

    expect(japones).toMatch(/^saga-[0-9a-f]{8}$/);
    expect(hindi).toMatch(/^saga-[0-9a-f]{8}$/);
    expect(japones).not.toBe(hindi);
  });

  it("dos nombres distintos no comparten dirección aunque se escriban casi igual", () => {
    expect(sagaSlug("Réquiem")).not.toBe(sagaSlug("Requiem"));
  });
});

describe("resolveCollectionItem", () => {
  it("empareja una entrada con su estreno del catálogo", () => {
    const catalogo = [makeRelease("uno", { title: "Duna 3", releaseDate: "2026-07-10" })];

    expect(resolveCollectionItem({ title: "duna 3", year: "2026" } as never, catalogo)?.id).toBe(
      "uno",
    );
  });

  it("no empareja si el año no coincide", () => {
    // Dos películas distintas pueden llamarse igual; el año es lo único que las separa.
    const catalogo = [makeRelease("uno", { title: "Duna 3", releaseDate: "2026-07-10" })];

    expect(resolveCollectionItem({ title: "Duna 3", year: "1999" } as never, catalogo)).toBeNull();
  });

  it("devuelve null cuando la entrada no está en el catálogo", () => {
    expect(resolveCollectionItem({ title: "Algo viejo", year: "" } as never, [])).toBeNull();
  });
});

describe("findSagaBySlug", () => {
  it("reúne la saga y marca qué entradas están en el catálogo y cuáles no", () => {
    const dueño = makeRelease("uno", {
      title: "Duna 3",
      sagaName: "Duna - Colección",
      sagaItems: [
        { title: "Duna 3", year: "2026" },
        { title: "Duna", year: "2021" },
      ],
    });
    const catalogo = [dueño];

    const saga = findSagaBySlug(catalogo, sagaSlug("Duna - Colección"));

    expect(saga?.name).toBe("Duna - Colección");
    expect(saga?.entries).toHaveLength(2);
    // La primera SÍ está en el catálogo: enlaza. La segunda no: se enseña sin enlace.
    expect(saga?.entries[0].release?.id).toBe("uno");
    expect(saga?.entries[1].release).toBeNull();
  });

  it("distingue las TEMPORADAS de una serie de una saga de verdad", () => {
    // El catálogo mete las temporadas de una serie en el mismo campo que las sagas, usando el título
    // de la serie como nombre. Mientras sigan mezcladas, la página tiene que poder decirlo.
    const serie = makeRelease("s", {
      title: "Buscadores de casas",
      type: TitleType.SERIES,
      sagaName: "Buscadores de casas",
      sagaItems: [{ title: "Temporada 1" }],
    });

    expect(findSagaBySlug([serie], sagaSlug("Buscadores de casas"))?.isSeasons).toBe(true);
  });

  it("devuelve null si nadie en el catálogo pertenece a esa saga", () => {
    expect(findSagaBySlug([makeRelease("uno")], "saga-inventada")).toBeNull();
  });

  it("no repite una entrada que aparece en dos estrenos de la misma saga", () => {
    const primera = makeRelease("a", {
      title: "A",
      sagaName: "Trilogía",
      sagaItems: [
        { title: "A", year: "2026" },
        { title: "B", year: "2027" },
      ],
    });
    const segunda = makeRelease("b", {
      title: "B",
      releaseDate: "2027-01-01",
      sagaName: "Trilogía",
      sagaItems: [
        { title: "A", year: "2026" },
        { title: "B", year: "2027" },
      ],
    });

    const saga = findSagaBySlug([primera, segunda], sagaSlug("Trilogía"));

    expect(saga?.owners).toHaveLength(2);
    expect(saga?.entries).toHaveLength(2);
  });
});

describe("pickSagaHighlight", () => {
  it("elige el título mejor calificado que TENGA video", () => {
    const flojo = makeRelease("a", { title: "A", sagaName: "S", tmdb: 9, hasVideo: false });
    const bueno = makeRelease("b", { title: "B", sagaName: "S", tmdb: 6, hasVideo: true });

    const saga = findSagaBySlug([flojo, bueno], sagaSlug("S"));

    // El de nota 9 no cuenta porque no tiene ningún video: enseñar un reproductor vacío sería
    // exactamente el defecto que este producto ya corrigió una vez.
    expect(pickSagaHighlight(saga as never)?.id).toBe("b");
  });

  it("devuelve null si ninguna entrega tiene video", () => {
    const saga = findSagaBySlug([makeRelease("a", { sagaName: "S" })], sagaSlug("S"));

    expect(pickSagaHighlight(saga as never)).toBeNull();
  });
});
