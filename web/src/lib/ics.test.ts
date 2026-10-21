// Archivo: ics.test.ts — Pruebas del generador de archivos de calendario (.ics).
//
// En español: comprueban lo que puede romper un calendario de verdad —y que a simple vista no se ve—:
//   1) Que los caracteres especiales de los títulos (comas, puntos y coma, barras, saltos de línea)
//      salgan ESCAPADOS; si no, el archivo se parte y el calendario lo rechaza.
//   2) Que las fechas se escriban como DÍA COMPLETO y que el fin del evento sea el día SIGUIENTE
//      (regla del estándar), incluso cruzando de mes y de año.
//   3) Que el identificador de cada evento (UID) sea ESTABLE: reexportar debe ACTUALIZAR el evento
//      del calendario, no duplicarlo.
// Son pruebas de lógica pura: no hay navegador ni descargas, solo texto que entra y texto que sale.

import { describe, expect, it } from "vitest";

import {
  buildIcsCalendar,
  escapeIcsText,
  formatIcsTimestamp,
  icsEventsFromReleases,
  icsUidForRelease,
  toIcsDate,
  type IcsEvent,
} from "@/lib/ics";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// GENERATED_AT es el instante FIJO de generación que usan las pruebas: con una fecha fija, la salida
// es siempre idéntica y se puede comparar carácter por carácter (si leyéramos el reloj, no podríamos).
const GENERATED_AT = new Date("2026-07-28T15:04:05Z");

// makeEvent arma un evento de prueba con valores por defecto sensatos, permitiendo cambiar solo lo
// que cada prueba necesita comprobar.
function makeEvent(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: "tmdb-1@thestorykeeper.local",
    date: "2026-06-15",
    summary: "Las Horas Doradas",
    description: "Estreno de Las Horas Doradas.",
    url: "https://ejemplo.test/titulo/tmdb-1",
    ...overrides,
  };
}

// makeRelease arma un estreno mínimo del catálogo (solo los campos que mira el generador).
function makeRelease(id: string, title: string, releaseDate: string): ReleaseSummary {
  return { id, title, releaseDate } as ReleaseSummary;
}

// linesOf parte el archivo generado en líneas, sin la línea vacía final que deja el cierre CRLF.
function linesOf(calendar: string): string[] {
  return calendar.split("\r\n").filter((line) => line !== "");
}

describe("escapeIcsText (escapado de caracteres con significado propio)", () => {
  it("escapa comas y puntos y coma, que en el formato separan valores", () => {
    expect(escapeIcsText("Rápidos, furiosos; y más")).toBe("Rápidos\\, furiosos\\; y más");
  });

  it("escapa la barra invertida ANTES que el resto (si no, se escaparía a sí misma)", () => {
    expect(escapeIcsText("AC\\DC, en vivo")).toBe("AC\\\\DC\\, en vivo");
  });

  it("convierte los saltos de línea (de cualquier sistema) en la secuencia \\n", () => {
    expect(escapeIcsText("Primera\nSegunda")).toBe("Primera\\nSegunda");
    expect(escapeIcsText("Primera\r\nSegunda")).toBe("Primera\\nSegunda");
    expect(escapeIcsText("Primera\rSegunda")).toBe("Primera\\nSegunda");
  });

  it("deja intacto un texto sin caracteres especiales", () => {
    expect(escapeIcsText("Las Horas Doradas")).toBe("Las Horas Doradas");
  });
});

describe("toIcsDate (fecha de día completo en formato compacto)", () => {
  it("convierte AAAA-MM-DD a AAAAMMDD", () => {
    expect(toIcsDate("2026-06-15")).toBe("20260615");
  });

  it("rechaza formatos que no son AAAA-MM-DD", () => {
    expect(toIcsDate("15/06/2026")).toBe("");
    expect(toIcsDate("2026-6-5")).toBe("");
    expect(toIcsDate("")).toBe("");
  });

  it("rechaza una fecha con el formato correcto pero que no existe", () => {
    expect(toIcsDate("2026-02-31")).toBe("");
  });
});

describe("formatIcsTimestamp (marca de generación en horario universal)", () => {
  it("escribe el instante como AAAAMMDDTHHMMSSZ", () => {
    expect(formatIcsTimestamp(GENERATED_AT)).toBe("20260728T150405Z");
  });
});

describe("buildIcsCalendar (archivo completo)", () => {
  it("abre y cierra el sobre VCALENDAR con las cabeceras obligatorias", () => {
    const lines = linesOf(buildIcsCalendar([makeEvent()], GENERATED_AT));
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("CALSCALE:GREGORIAN");
    expect(lines).toContain("METHOD:PUBLISH");
    expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
  });

  it("escribe cada estreno como un evento de DÍA COMPLETO que termina al día siguiente", () => {
    const lines = linesOf(buildIcsCalendar([makeEvent()], GENERATED_AT));
    expect(lines).toContain("DTSTART;VALUE=DATE:20260615");
    expect(lines).toContain("DTEND;VALUE=DATE:20260616");
  });

  it("CRUCE DE MES: el 30 de junio termina el 1 de julio", () => {
    const lines = linesOf(buildIcsCalendar([makeEvent({ date: "2026-06-30" })], GENERATED_AT));
    expect(lines).toContain("DTSTART;VALUE=DATE:20260630");
    expect(lines).toContain("DTEND;VALUE=DATE:20260701");
  });

  it("CRUCE DE AÑO: el 31 de diciembre termina el 1 de enero del año siguiente", () => {
    const lines = linesOf(buildIcsCalendar([makeEvent({ date: "2026-12-31" })], GENERATED_AT));
    expect(lines).toContain("DTSTART;VALUE=DATE:20261231");
    expect(lines).toContain("DTEND;VALUE=DATE:20270101");
  });

  it("AÑO BISIESTO: el 28 de febrero de 2028 termina el 29 (no el 1 de marzo)", () => {
    const lines = linesOf(buildIcsCalendar([makeEvent({ date: "2028-02-28" })], GENERATED_AT));
    expect(lines).toContain("DTEND;VALUE=DATE:20280229");
  });

  it("escapa el título del evento dentro de la línea SUMMARY", () => {
    const calendar = buildIcsCalendar(
      [makeEvent({ summary: "Duna, parte 3; el final", description: "", url: "" })],
      GENERATED_AT,
    );
    expect(calendar).toContain("SUMMARY:Duna\\, parte 3\\; el final");
  });

  it("omite descripción y enlace cuando vienen vacíos (sin líneas huecas)", () => {
    const lines = linesOf(
      buildIcsCalendar([makeEvent({ description: "", url: "" })], GENERATED_AT),
    );
    expect(lines.some((line) => line.startsWith("DESCRIPTION"))).toBe(false);
    expect(lines.some((line) => line.startsWith("URL"))).toBe(false);
  });

  it("DESCARTA los eventos con fecha inválida en vez de inventar una", () => {
    const calendar = buildIcsCalendar(
      [makeEvent({ date: "sin-fecha" }), makeEvent({ uid: "ok@x", date: "2026-06-15" })],
      GENERATED_AT,
    );
    const eventCount = linesOf(calendar).filter((line) => line === "BEGIN:VEVENT").length;
    expect(eventCount).toBe(1);
  });

  it("un calendario sin eventos válidos sigue siendo un archivo válido (solo el sobre)", () => {
    const lines = linesOf(buildIcsCalendar([], GENERATED_AT));
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
    expect(lines.some((line) => line === "BEGIN:VEVENT")).toBe(false);
  });

  it("termina las líneas con CRLF, como exige el estándar", () => {
    const calendar = buildIcsCalendar([makeEvent()], GENERATED_AT);
    expect(calendar.endsWith("\r\n")).toBe(true);
    // No debe quedar ningún salto de línea "suelto" sin su retorno de carro delante.
    expect(/[^\r]\n/.test(calendar)).toBe(false);
  });

  it("pliega las líneas que superan los 75 bytes y las continúa con un espacio", () => {
    const longTitle = "Crónica interminable de una expedición al confín del sistema solar conocido";
    const calendar = buildIcsCalendar(
      [makeEvent({ summary: longTitle, description: "", url: "" })],
      GENERATED_AT,
    );
    const lines = linesOf(calendar);
    // Ninguna línea del archivo puede pasar del límite de octetos del estándar.
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // La continuación se reconoce porque empieza con un espacio.
    expect(lines.some((line) => line.startsWith(" "))).toBe(true);
    // Al "desplegar" (quitar los cortes) debe reaparecer el título completo.
    const unfolded = calendar.replace(/\r\n /g, "");
    expect(unfolded).toContain(`SUMMARY:${longTitle}`);
  });
});

describe("icsUidForRelease (identificador estable por título)", () => {
  it("el mismo id de título produce SIEMPRE el mismo identificador", () => {
    expect(icsUidForRelease("tmdb-12345")).toBe(icsUidForRelease("tmdb-12345"));
  });

  it("títulos distintos producen identificadores distintos", () => {
    expect(icsUidForRelease("tmdb-1")).not.toBe(icsUidForRelease("tmdb-2"));
  });

  it("el identificador no cambia entre dos generaciones del archivo (no se duplica el evento)", () => {
    const first = buildIcsCalendar(
      [makeEvent({ uid: icsUidForRelease("tmdb-7") })],
      new Date("2026-07-01T00:00:00Z"),
    );
    const second = buildIcsCalendar(
      [makeEvent({ uid: icsUidForRelease("tmdb-7") })],
      new Date("2026-08-09T10:11:12Z"),
    );
    const uidOf = (calendar: string) => linesOf(calendar).find((line) => line.startsWith("UID:"));
    expect(uidOf(first)).toBe(uidOf(second));
  });
});

describe("icsEventsFromReleases (traducción del catálogo a eventos)", () => {
  const describeEvent = (title: string) => `Estreno de ${title}.`;

  it("convierte cada estreno con fecha válida en un evento con su enlace", () => {
    const events = icsEventsFromReleases(
      [makeRelease("tmdb-1", "Las Horas Doradas", "2026-06-15")],
      "https://ejemplo.test",
      describeEvent,
    );
    expect(events).toEqual([
      {
        uid: icsUidForRelease("tmdb-1"),
        date: "2026-06-15",
        summary: "Las Horas Doradas",
        description: "Estreno de Las Horas Doradas.",
        url: "https://ejemplo.test/titulo/tmdb-1",
      },
    ]);
  });

  it("descarta los estrenos sin fecha utilizable", () => {
    const events = icsEventsFromReleases(
      [
        makeRelease("sin-fecha", "Título pendiente", ""),
        makeRelease("ok", "Con fecha", "2026-07-01"),
      ],
      "https://ejemplo.test",
      describeEvent,
    );
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Con fecha");
  });

  it("sin dirección base conocida, los eventos salen SIN enlace (nunca con uno falso)", () => {
    const events = icsEventsFromReleases(
      [makeRelease("tmdb-1", "Las Horas Doradas", "2026-06-15")],
      "",
      describeEvent,
    );
    expect(events[0].url).toBe("");
  });
});
