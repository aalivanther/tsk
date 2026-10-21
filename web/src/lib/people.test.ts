// Archivo: people.test.ts — Pruebas de la página de una persona.
//
// Qué se defiende aquí, en español: que una persona se identifique por su NÚMERO y no por su nombre
// escrito (que es lo que fundía a dos homónimos en uno y partía en dos a quien viniera escrito de
// dos maneras), y que la lista de "coincide habitualmente con" solo salga cuando la coincidencia es
// real y no la casualidad de compartir un único reparto.

import { describe, expect, it } from "vitest";

import { type Release } from "@/gen/mdm7mo/catalog/v1/catalog_pb";
import {
  collaboratorsOf,
  findPersonInCatalog,
  pickHighlightRelease,
  tmdbPersonUrl,
} from "@/lib/people";

// PersonSpec describe a una persona dentro de un estreno de prueba.
type PersonSpec = {
  id: number;
  name: string;
  role?: string;
  department?: string;
  photoUrl?: string;
};

// makeRelease arma un estreno con el reparto y el equipo que se le indiquen.
function makeRelease(
  id: string,
  options: {
    title?: string;
    releaseDate?: string;
    cast?: PersonSpec[];
    crew?: PersonSpec[];
    tmdb?: number;
    hasVideo?: boolean;
  } = {},
): Release {
  const toCredit = (person: PersonSpec) => ({
    name: person.name,
    role: person.role ?? "",
    photoUrl: person.photoUrl ?? "",
    personTmdbId: person.id,
    department: person.department ?? "Acting",
    episodeCount: 0,
  });
  return {
    id,
    title: options.title ?? id,
    releaseDate: options.releaseDate ?? "2026-06-01",
    cast: (options.cast ?? []).map(toCredit),
    crew: (options.crew ?? []).map(toCredit),
    ratings: { tmdb: options.tmdb ?? 0, imdb: "", rottenTomatoes: "", metacritic: "" },
    videos: options.hasVideo === true ? [{ youtubeKey: `v-${id}` }] : [],
  } as unknown as Release;
}

describe("findPersonInCatalog", () => {
  it("reúne todos los títulos de una persona identificándola por su NÚMERO", () => {
    // Este es el motivo entero de que el número exista. Las dos personas se llaman igual y son
    // distintas; comparando nombres escritos, la ficha de una enseñaría las películas de la otra.
    const catalogo = [
      makeRelease("a", { title: "A", cast: [{ id: 1, name: "Ana Ruiz", role: "Sol" }] }),
      makeRelease("b", { title: "B", cast: [{ id: 2, name: "Ana Ruiz", role: "Luna" }] }),
      makeRelease("c", { title: "C", cast: [{ id: 1, name: "Ana Ruiz", role: "Mar" }] }),
    ];

    const persona = findPersonInCatalog(catalogo, 1);

    expect(persona?.credits.map((credit) => credit.release.id).sort()).toEqual(["a", "c"]);
  });

  it("reconoce a la misma persona aunque su nombre venga escrito de dos formas", () => {
    // El otro lado del mismo problema: comparando nombres, esta persona se partiría en dos fichas.
    const catalogo = [
      makeRelease("a", { cast: [{ id: 7, name: "José Ángel Ruiz" }] }),
      makeRelease("b", { cast: [{ id: 7, name: "Jose Angel Ruiz" }] }),
    ];

    expect(findPersonInCatalog(catalogo, 7)?.credits).toHaveLength(2);
  });

  it("ordena sus títulos del más reciente al más antiguo", () => {
    const catalogo = [
      makeRelease("viejo", { releaseDate: "2026-01-05", cast: [{ id: 1, name: "Ana" }] }),
      makeRelease("nuevo", { releaseDate: "2026-11-20", cast: [{ id: 1, name: "Ana" }] }),
    ];

    expect(findPersonInCatalog(catalogo, 1)?.credits[0].release.id).toBe("nuevo");
  });

  it("recoge la foto aunque solo esté en uno de sus títulos", () => {
    // TMDB no siempre trae la foto en todos los créditos. Enseñar unas iniciales teniendo la foto a
    // mano sería un descuido, así que se recorren todos antes de rendirse.
    const catalogo = [
      makeRelease("a", { cast: [{ id: 1, name: "Ana", photoUrl: "" }] }),
      makeRelease("b", { cast: [{ id: 1, name: "Ana", photoUrl: "https://foto" }] }),
    ];

    expect(findPersonInCatalog(catalogo, 1)?.photoUrl).toBe("https://foto");
  });

  it("ordena sus áreas de trabajo de la más frecuente a la menos, contando TÍTULOS", () => {
    // Se cuenta por título y no por crédito: quien firma seis oficios de sonido en una sola película
    // no debería parecer, por eso, seis veces más "de sonido" que quien lo hace en seis películas.
    const catalogo = [
      makeRelease("a", {
        crew: [
          { id: 1, name: "Ana", role: "Boom", department: "Sound" },
          { id: 1, name: "Ana", role: "Mixer", department: "Sound" },
          { id: 1, name: "Ana", role: "Director", department: "Directing" },
        ],
      }),
      makeRelease("b", { crew: [{ id: 1, name: "Ana", department: "Directing" }] }),
    ];

    expect(findPersonInCatalog(catalogo, 1)?.departments).toEqual(["Directing", "Sound"]);
  });

  it("junta en UNA entrada todo lo que hace en el mismo título", () => {
    // Este es un fallo que se vio en pantalla: en el catálogo hay quien firma ocho oficios distintos
    // de la misma película. Con una entrada por oficio, la página enseñaba ocho tarjetas de la MISMA
    // película y el encabezado decía "8 títulos en el catálogo" cuando era uno. La página estaba
    // afirmando algo falso, no solo repitiéndose.
    const catalogo = [
      makeRelease("a", {
        cast: [{ id: 1, name: "Ana", role: "Sol" }],
        crew: [
          { id: 1, name: "Ana", role: "Director", department: "Directing" },
          { id: 1, name: "Ana", role: "Screenplay", department: "Writing" },
        ],
      }),
    ];

    const persona = findPersonInCatalog(catalogo, 1);

    expect(persona?.credits).toHaveLength(1);
    expect(persona?.credits[0].roles).toEqual(["Sol", "Director", "Screenplay"]);
    // Y sigue constando que en ese título es a la vez reparto y equipo.
    expect(persona?.credits[0].inCast).toBe(true);
    expect(persona?.credits[0].departments).toEqual(["Acting", "Directing", "Writing"]);
  });

  it("devuelve null si esa persona no aparece en el catálogo", () => {
    // Es un desenlace NORMAL: el catálogo cubre unos meses y alguien puede llegar por un enlace viejo.
    expect(findPersonInCatalog([makeRelease("a")], 999)).toBeNull();
  });

  it("devuelve null si el número de identidad no es válido", () => {
    // Vale 0 cuando TMDB no lo dio. Buscar por cero uniría a todos los que no tienen identidad.
    expect(findPersonInCatalog([makeRelease("a", { cast: [{ id: 0, name: "X" }] })], 0)).toBeNull();
  });
});

describe("collaboratorsOf", () => {
  it("solo cuenta a quien coincide en MÁS DE UN título", () => {
    // Coincidir una vez no dice nada: es el reparto de una película, evidentemente coinciden. Lo que
    // cuenta algo es coincidir dos veces, porque eso ya no es la casualidad de un solo rodaje.
    const catalogo = [
      makeRelease("a", {
        cast: [
          { id: 1, name: "Ana" },
          { id: 2, name: "Beto" },
          { id: 3, name: "Cruz" },
        ],
      }),
      makeRelease("b", {
        cast: [
          { id: 1, name: "Ana" },
          { id: 2, name: "Beto" },
        ],
      }),
    ];
    const ana = findPersonInCatalog(catalogo, 1);

    const colegas = collaboratorsOf(catalogo, ana as never);

    expect(colegas.map((colega) => colega.name)).toEqual(["Beto"]);
    expect(colegas[0].sharedTitles).toBe(2);
  });

  it("nunca se incluye a la propia persona", () => {
    const catalogo = [
      makeRelease("a", { cast: [{ id: 1, name: "Ana" }] }),
      makeRelease("b", { cast: [{ id: 1, name: "Ana" }] }),
    ];
    const ana = findPersonInCatalog(catalogo, 1);

    expect(collaboratorsOf(catalogo, ana as never)).toHaveLength(0);
  });

  it("ignora a quien no tiene número de identidad", () => {
    // Sin número no se puede afirmar que sea la misma persona en los dos títulos, y afirmarlo sería
    // exactamente el error que el número vino a corregir.
    const catalogo = [
      makeRelease("a", {
        cast: [
          { id: 1, name: "Ana" },
          { id: 0, name: "Anónimo" },
        ],
      }),
      makeRelease("b", {
        cast: [
          { id: 1, name: "Ana" },
          { id: 0, name: "Anónimo" },
        ],
      }),
    ];
    const ana = findPersonInCatalog(catalogo, 1);

    expect(collaboratorsOf(catalogo, ana as never)).toHaveLength(0);
  });
});

describe("pickHighlightRelease", () => {
  it("elige el título mejor calificado que TENGA video", () => {
    const catalogo = [
      makeRelease("sin-video", { cast: [{ id: 1, name: "Ana" }], tmdb: 9, hasVideo: false }),
      makeRelease("con-video", { cast: [{ id: 1, name: "Ana" }], tmdb: 6, hasVideo: true }),
    ];
    const ana = findPersonInCatalog(catalogo, 1);

    expect(pickHighlightRelease(ana as never)?.id).toBe("con-video");
  });

  it("devuelve null si ninguno de sus títulos tiene video", () => {
    // Entonces la sección del tráiler no se dibuja, en vez de dejar un recuadro anunciando algo que
    // no existe.
    const catalogo = [makeRelease("a", { cast: [{ id: 1, name: "Ana" }] })];
    const ana = findPersonInCatalog(catalogo, 1);

    expect(pickHighlightRelease(ana as never)).toBeNull();
  });
});

describe("tmdbPersonUrl", () => {
  it("arma el enlace público a la ficha de TMDB, sin ninguna credencial dentro", () => {
    expect(tmdbPersonUrl(136532)).toBe("https://www.themoviedb.org/person/136532");
  });
});
