// Archivo: timeline.test.ts — Pruebas de la lógica PURA de fechas y estilos de la línea de tiempo.
// En español: cubren justo lo que se corrigió en la auditoría — el manejo del AÑO en las comparaciones
// de fecha (antes se asumía 2026 y el cálculo se rompería al cruzar de año), el saneo de URLs para CSS
// (cssUrl, anti-inyección) y la semilla estable por id (seedFromId).

import { describe, expect, it } from "vitest";

import {
  buildCalendarMonths,
  catalogWindow,
  COVER_SIZES,
  coverStyleFor,
  cssImageSet,
  cssUrl,
  findConnections,
  firstAnchorWithContent,
  groupByMonth,
  isUpcoming,
  seedFromId,
  weekInsideCatalog,
  yearOfMonth,
  type TodayMarker,
} from "@/lib/timeline";
import { Category, type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// makeToday arma un marcador HOY de prueba (la etiqueta no participa en los cálculos).
function makeToday(year: number, month: number, day: number): TodayMarker {
  return { year, month, day, label: "HOY" };
}

// makeRelease arma un estreno mínimo con solo la fecha (lo único que isUpcoming consulta).
function makeRelease(releaseDate: string): ReleaseSummary {
  return { releaseDate } as ReleaseSummary;
}

describe("isUpcoming (comparación de fecha completa, año incluido)", () => {
  const today = makeToday(2026, 7, 19);

  it("un estreno de mañana es próximo", () => {
    expect(isUpcoming(makeRelease("2026-07-20"), today)).toBe(true);
  });

  it("un estreno de hoy NO es próximo (ya estrena)", () => {
    expect(isUpcoming(makeRelease("2026-07-19"), today)).toBe(false);
  });

  it("un estreno de ayer NO es próximo", () => {
    expect(isUpcoming(makeRelease("2026-07-18"), today)).toBe(false);
  });

  it("CRUCE DE AÑO: enero de 2027 es próximo aunque su mes (1) sea menor que julio (7)", () => {
    // Este es el caso que la versión anterior (sin año) calculaba MAL: comparaba solo mes/día.
    expect(isUpcoming(makeRelease("2027-01-05"), today)).toBe(true);
  });

  it("CRUCE DE AÑO: diciembre de 2025 ya pasó aunque su mes (12) sea mayor que julio (7)", () => {
    expect(isUpcoming(makeRelease("2025-12-31"), today)).toBe(false);
  });

  it("una fecha inválida o vacía nunca es próxima", () => {
    expect(isUpcoming(makeRelease(""), today)).toBe(false);
    expect(isUpcoming(makeRelease("no-es-fecha"), today)).toBe(false);
  });
});

// MESES_QUE_GENERA_EL_SEED es cuántos meses crea el generador del catálogo (objetivo "seed" del
// Makefile). Se escribe aquí para poder comprobar que la ventana que pide la aplicación mide lo mismo:
// que no midieran lo mismo dejó dos meses del catálogo inalcanzables desde la interfaz.
const MESES_QUE_GENERA_EL_SEED = 6;

describe("catalogWindow (ventana de meses derivada de HOY)", () => {
  it("pide el mes anterior, el actual y los CUATRO siguientes", () => {
    // Seis meses en total. El número no es arbitrario: es exactamente lo que genera el catálogo (ver
    // el objetivo "seed" del Makefile). Cuando estos dos números no cuadraban, los últimos meses
    // existían en el servidor y la aplicación no los pedía nunca: el calendario se acababa antes de
    // tiempo, sin ningún aviso, y no había forma de llegar a ellos.
    expect(catalogWindow(makeToday(2026, 8, 15))).toEqual([
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
    ]);
  });

  it("la ventana mide lo mismo que el catálogo que se genera", () => {
    // Esta prueba existe para que los dos números no vuelvan a separarse en silencio. Si alguien
    // amplía el generador y se olvida de la ventana (o al revés), aquí se entera.
    expect(catalogWindow(makeToday(2026, 8, 15))).toHaveLength(MESES_QUE_GENERA_EL_SEED);
  });

  it("CRUCE DE AÑO hacia adelante: en noviembre pide meses del año siguiente", () => {
    expect(catalogWindow(makeToday(2026, 11, 3))).toEqual([
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
      { year: 2027, month: 3 },
    ]);
  });

  it("CRUCE DE AÑO hacia atrás: en enero pide diciembre del año anterior", () => {
    expect(catalogWindow(makeToday(2027, 1, 20))).toEqual([
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
      { year: 2027, month: 3 },
      { year: 2027, month: 4 },
      { year: 2027, month: 5 },
    ]);
  });

  it("nunca devuelve un mes fuera del rango 1-12", () => {
    for (let month = 1; month <= 12; month += 1) {
      for (const entry of catalogWindow(makeToday(2026, month, 1))) {
        expect(entry.month).toBeGreaterThanOrEqual(1);
        expect(entry.month).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe("octubre a enero conserva el orden del año", () => {
  const estreno = (releaseDate: string): ReleaseSummary =>
    ({ releaseDate, category: Category.CINE }) as ReleaseSummary;

  it("enero de 2027 queda después de diciembre de 2026", () => {
    const groups = groupByMonth([
      estreno("2027-01-09"),
      estreno("2026-10-16"),
      estreno("2026-12-18"),
    ]);
    expect(groups.map((group) => `${group.year}-${group.month}`)).toEqual([
      "2026-10",
      "2026-12",
      "2027-1",
    ]);
  });

  it("el 1 de enero de 2027 es viernes", () => {
    const [january] = buildCalendarMonths([estreno("2027-01-15")]);
    expect(january.year).toBe(2027);
    expect(january.days[0]?.weekdayFull).toBe("Viernes");
  });

  it("en octubre el mes 1 de la ventana es 2027", () => {
    const today = makeToday(2026, 10, 9);
    expect(yearOfMonth(today, 1)).toBe(2027);
    expect(yearOfMonth(today, 10)).toBe(2026);
    expect(weekInsideCatalog(2027, 1, 4, today)).toBe(true);
    expect(weekInsideCatalog(2026, 7, 1, today)).toBe(false);
  });
});

describe("cssUrl (saneo anti-inyección de CSS)", () => {
  it("envuelve una URL https normal entre comillas", () => {
    expect(cssUrl("https://image.tmdb.org/t/p/w500/abc.jpg")).toBe(
      'url("https://image.tmdb.org/t/p/w500/abc.jpg")',
    );
  });

  it("escapa las comillas dobles del valor", () => {
    expect(cssUrl('https://x.test/a"b.jpg')).toBe('url("https://x.test/a\\"b.jpg")');
  });

  it("rechaza esquemas no http(s) — javascript:, data:, etc.", () => {
    expect(cssUrl("javascript:alert(1)")).toBe("none");
    expect(cssUrl("data:image/png;base64,AAAA")).toBe("none");
  });

  it("una cadena vacía produce none (sin imagen)", () => {
    expect(cssUrl("")).toBe("none");
  });
});

describe("seedFromId (semilla estable por id)", () => {
  it("el mismo id produce siempre la misma semilla", () => {
    expect(seedFromId("tmdb-12345")).toBe(seedFromId("tmdb-12345"));
  });

  it("ids distintos producen (normalmente) semillas distintas", () => {
    expect(seedFromId("tmdb-1")).not.toBe(seedFromId("tmdb-2"));
  });
});

describe("firstAnchorWithContent", () => {
  // makeRelease arma lo mínimo que necesita la función: un estreno con su fecha.
  const makeRelease = (releaseDate: string) => ({ releaseDate }) as unknown as ReleaseSummary;
  const hoy = (month: number, day: number): TodayMarker => ({
    year: 2026,
    month,
    day,
    label: `${day}`,
  });

  it("abre en HOY cuando hoy tiene estrenos", () => {
    const anchor = firstAnchorWithContent(hoy(7, 29), [
      makeRelease("2026-07-29"),
      makeRelease("2026-08-05"),
    ]);

    expect(anchor).toEqual({ month: 7, day: 29 });
  });

  it("abre en el PRÓXIMO día con estrenos cuando hoy no tiene nada", () => {
    // Este es el caso que dio la peor primera impresión posible del producto: el catálogo empezaba el
    // 1 de agosto, alguien entró el 29 de julio y lo único que vio fue un mes anunciado sin nada
    // dentro y una franja de días vacíos. La aplicación parecía rota teniendo cientos de estrenos un
    // poco más a la derecha.
    const anchor = firstAnchorWithContent(hoy(7, 29), [
      makeRelease("2026-08-01"),
      makeRelease("2026-09-14"),
    ]);

    expect(anchor).toEqual({ month: 8, day: 1 });
  });

  it("no salta hacia atrás: prefiere el futuro aunque haya estrenos pasados más cerca", () => {
    const anchor = firstAnchorWithContent(hoy(7, 29), [
      makeRelease("2026-07-28"),
      makeRelease("2026-08-15"),
    ]);

    expect(anchor).toEqual({ month: 8, day: 15 });
  });

  it("si ya no queda nada por delante, abre en el ÚLTIMO día con estrenos", () => {
    // Catálogo agotado: enseñar lo último que hubo es más útil que una franja vacía.
    const anchor = firstAnchorWithContent(hoy(12, 20), [
      makeRelease("2026-11-02"),
      makeRelease("2026-11-28"),
    ]);

    expect(anchor).toEqual({ month: 11, day: 28 });
  });

  it("sin ningún estreno se queda en hoy", () => {
    expect(firstAnchorWithContent(hoy(7, 29), [])).toEqual({ month: 7, day: 29 });
  });

  it("ignora los estrenos sin fecha en vez de romperse", () => {
    const anchor = firstAnchorWithContent(hoy(7, 29), [makeRelease(""), makeRelease("2026-08-03")]);

    expect(anchor).toEqual({ month: 8, day: 3 });
  });
});

describe("findConnections (conexiones reales entre estrenos)", () => {
  // makeConnRelease arma un RESUMEN de estreno con lo mínimo que mira findConnections.
  //
  // Ojo al cambio, en español: estos estrenos ya NO traen el equipo técnico ni el reparto completos,
  // sino las listas de nombres YA DEDUCIDAS que el servidor manda dentro de cada resumen. La regla de
  // "qué puesto cuenta como dirección" y la de "cuántos nombres del reparto se miran" se mudaron al
  // backend, donde viven en un solo sitio, y allí tienen sus propias pruebas
  // (backend/internal/catalog/summary_test.go). Aquí se prueba lo que sigue siendo de aquí: cómo se
  // comparan esos nombres y en qué orden de prioridad se arman las conexiones.
  const makeConnRelease = (
    id: string,
    options: {
      genres?: string[];
      directorNames?: string[];
      leadCastNames?: string[];
      sagaName?: string;
    } = {},
  ) =>
    ({
      id,
      title: id,
      genres: options.genres ?? [],
      directorNames: options.directorNames ?? [],
      leadCastNames: options.leadCastNames ?? [],
      sagaName: options.sagaName ?? "",
    }) as unknown as ReleaseSummary;

  it("conecta dos estrenos que comparten dirección", () => {
    const base = makeConnRelease("base", { directorNames: ["Ana Ruiz"] });
    const otra = makeConnRelease("otra", { directorNames: ["Ana Ruiz"] });

    const conexiones = findConnections(base, [base, otra]);

    expect(conexiones).toHaveLength(1);
    expect(conexiones[0].release.id).toBe("otra");
    expect(conexiones[0].reason).toBe("director");
  });

  it("compara los nombres sin distinguir mayúsculas ni espacios de sobra", () => {
    // Un mismo nombre escrito de dos maneras tiene que reconocerse como la misma persona; si no, la
    // conexión se perdería en silencio y parecería que sencillamente no existe.
    const base = makeConnRelease("base", { directorNames: ["Ana Ruiz"] });
    const otra = makeConnRelease("otra", { directorNames: ["  ana ruiz "] });

    expect(findConnections(base, [base, otra])[0]?.reason).toBe("director");
  });

  it("descarta los nombres vacíos en vez de emparejar por ellos", () => {
    // Dos estrenos sin dirección conocida NO comparten director: si el vacío contara como un nombre,
    // se conectarían entre sí todos los títulos a los que les falta el dato.
    const base = makeConnRelease("base", { directorNames: ["", "  "] });
    const otra = makeConnRelease("otra", { directorNames: [""] });

    expect(findConnections(base, [base, otra])).toHaveLength(0);
  });

  it("conecta por saga, que es la relación más fuerte de todas", () => {
    const base = makeConnRelease("base", { sagaName: "Réquiem", genres: ["Drama"] });
    const otra = makeConnRelease("otra", { sagaName: "Réquiem", genres: ["Drama"] });

    const conexiones = findConnections(base, [base, otra]);

    expect(conexiones).toHaveLength(1);
    expect(conexiones[0].reason).toBe("saga");
  });

  it("conecta por reparto compartido, que es la relación más frecuente de verdad", () => {
    // Medido sobre el catálogo real: 240 personas aparecen en más de un título y eso conecta 223 de
    // los 422. Compartir director solo enlaza tres, y compartir saga ninguno en la ventana actual.
    const base = makeConnRelease("base", { leadCastNames: ["Luis Pérez"] });
    const otra = makeConnRelease("otra", { leadCastNames: ["Luis Pérez", "Otra"] });

    const conexiones = findConnections(base, [base, otra]);

    expect(conexiones[0].release.id).toBe("otra");
    expect(conexiones[0].reason).toBe("cast");
  });

  it("un mismo estreno aparece UNA vez, con su motivo más fuerte", () => {
    // Comparten director Y reparto Y género: debe salir una sola vez, etiquetado como director, que
    // es la señal más fuerte de las tres.
    const base = makeConnRelease("base", {
      genres: ["Drama"],
      directorNames: ["Ana Ruiz"],
      leadCastNames: ["Luis Pérez"],
    });
    const otra = makeConnRelease("otra", {
      genres: ["Drama"],
      directorNames: ["Ana Ruiz"],
      leadCastNames: ["Luis Pérez"],
    });

    const conexiones = findConnections(base, [base, otra]);

    expect(conexiones).toHaveLength(1);
    expect(conexiones[0].reason).toBe("director");
  });

  it("nunca se conecta consigo mismo", () => {
    const base = makeConnRelease("base", { genres: ["Drama"], leadCastNames: ["Luis Pérez"] });

    expect(findConnections(base, [base])).toHaveLength(0);
  });

  it("el género es el último recurso, no el primero", () => {
    const base = makeConnRelease("base", {
      genres: ["Drama"],
      leadCastNames: ["Luis Pérez"],
    });
    const porGenero = makeConnRelease("por-genero", { genres: ["Drama"] });
    const porReparto = makeConnRelease("por-reparto", {
      genres: ["Drama"],
      leadCastNames: ["Luis Pérez"],
    });

    const conexiones = findConnections(base, [base, porGenero, porReparto]);

    expect(conexiones[0].release.id).toBe("por-reparto");
    expect(conexiones[0].reason).toBe("cast");
    expect(conexiones[1].reason).toBe("genre");
  });
});

describe("cssImageSet (variantes por densidad de pantalla)", () => {
  const poster = "https://image.tmdb.org/t/p/w500/abc.jpg";

  it("da una variante por densidad, cada una con su ancho de TMDB", () => {
    expect(cssImageSet(poster, COVER_SIZES.sagaPoster)).toBe(
      '-webkit-image-set(url("https://image.tmdb.org/t/p/w342/abc.jpg") 1x, url("https://image.tmdb.org/t/p/w500/abc.jpg") 2x)',
    );
  });

  it("deja tal cual las URLs que no son de TMDB y rechaza las inseguras", () => {
    expect(cssImageSet("https://example.com/a.jpg", COVER_SIZES.sagaPoster)).toBe(
      'url("https://example.com/a.jpg")',
    );
    expect(cssImageSet("javascript:alert(1)", COVER_SIZES.sagaPoster)).toBe("none");
    expect(cssImageSet("", COVER_SIZES.sagaPoster)).toBe("none");
  });

  it("coverStyleFor sin variantes se comporta como siempre", () => {
    expect(coverStyleFor(poster, 1).backgroundImage).toBe(cssUrl(poster));
    expect(coverStyleFor(poster, 1, 1, COVER_SIZES.creditPoster).backgroundImage).toContain(
      "-webkit-image-set(",
    );
  });

  it("ninguna variante es más grande que la imagen que guarda el catálogo", () => {
    const width = (segment: string) => Number(segment.slice(1));
    for (const sizes of Object.values(COVER_SIZES)) {
      for (const [segment] of sizes) {
        expect(width(segment)).toBeLessThanOrEqual(1280);
      }
    }
    for (const sizes of [
      COVER_SIZES.sagaPoster,
      COVER_SIZES.creditPoster,
      COVER_SIZES.sagaEntryPoster,
    ]) {
      for (const [segment] of sizes) {
        expect(width(segment)).toBeLessThanOrEqual(500);
      }
    }
  });
});
