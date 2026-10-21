// Archivo: notifications.test.ts — Pruebas de la derivación PURA de avisos in-app (los "2 tiempos").
// En español: cubren la ventana de relevancia del aviso de ESTRENO (30 días antes / 7 después), el
// aviso de PLATAFORMAS (solo con disponibilidad real y fecha ya pasada), el orden por cercanía a HOY
// y — clave tras la auditoría — que el AÑO de la fecha se respeta (un título de otro año no genera
// avisos absurdos "dentro del año de hoy").

import { describe, expect, it } from "vitest";

import { buildNotifications } from "@/lib/notifications";
import { type TodayMarker } from "@/lib/timeline";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// today de referencia para todas las pruebas: 19 de julio de 2026.
const today: TodayMarker = { year: 2026, month: 7, day: 19, label: "HOY" };

// makeRelease arma un estreno mínimo con id, título, fecha y disponibilidad opcional.
function makeRelease(
  id: string,
  releaseDate: string,
  platforms: string[] = [],
  networks: string[] = [],
): ReleaseSummary {
  return {
    id,
    title: `Título ${id}`,
    releaseDate,
    availability: { platforms, networks },
  } as unknown as ReleaseSummary;
}

describe("buildNotifications", () => {
  it("genera aviso de estreno para un título que sale dentro de la ventana (mañana)", () => {
    const catalog = [makeRelease("a", "2026-07-20")];
    const notifications = buildNotifications(["a"], catalog, today);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ kind: "release", releaseId: "a", daysFromToday: 1 });
  });

  it("NO genera aviso de estreno fuera de la ventana (más de 30 días)", () => {
    const catalog = [makeRelease("lejos", "2026-09-30")];
    expect(buildNotifications(["lejos"], catalog, today)).toHaveLength(0);
  });

  it("genera el segundo tiempo (plataformas) solo si ya estrenó Y hay disponibilidad", () => {
    const catalog = [
      makeRelease("con-plataforma", "2026-07-10", ["Netflix"]),
      makeRelease("sin-plataforma", "2026-07-10"),
      makeRelease("futuro-con-plataforma", "2026-07-25", ["Max"]),
    ];
    const notifications = buildNotifications(
      ["con-plataforma", "sin-plataforma", "futuro-con-plataforma"],
      catalog,
      today,
    );
    const kinds = notifications.map((n) => `${n.kind}:${n.releaseId}`);
    expect(kinds).toContain("platform:con-plataforma");
    expect(kinds).not.toContain("platform:sin-plataforma");
    expect(kinds).not.toContain("platform:futuro-con-plataforma");
  });

  it("RESPETA EL AÑO: un título del año pasado con la misma fecha mes/día no entra en la ventana", () => {
    // Con el bug anterior (año ignorado), "2025-07-20" se trataba como "2026-07-20" (mañana) y
    // generaba un aviso de estreno falso. Con el año real, está a ~-364 días: fuera de ventana.
    const catalog = [makeRelease("viejo", "2025-07-20")];
    const notifications = buildNotifications(["viejo"], catalog, today);
    expect(notifications.filter((n) => n.kind === "release")).toHaveLength(0);
  });

  it("ordena por cercanía a HOY (lo más inminente primero)", () => {
    const catalog = [
      makeRelease("en-5-dias", "2026-07-24"),
      makeRelease("manana", "2026-07-20"),
      makeRelease("en-10-dias", "2026-07-29"),
    ];
    const notifications = buildNotifications(["en-5-dias", "manana", "en-10-dias"], catalog, today);
    expect(notifications.map((n) => n.releaseId)).toEqual(["manana", "en-5-dias", "en-10-dias"]);
  });

  it("ignora ids que no existen en el catálogo (sin romperse)", () => {
    expect(buildNotifications(["fantasma"], [], today)).toHaveLength(0);
  });
});
