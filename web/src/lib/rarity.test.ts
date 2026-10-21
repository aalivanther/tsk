// Archivo: rarity.test.ts — Pruebas del espejo TypeScript de la rareza (umbrales 8.5 / 7.5 / 6.5).
// En español: la rareza se deriva en Go (fuente de verdad, con sus propios tests al 100%) y se espeja
// aquí para pintar la interfaz. Estas pruebas fijan los umbrales del espejo: si alguien los cambia de
// un solo lado, la prueba lo delata (los dos lados deben decir lo mismo del mismo número).

import { describe, expect, it } from "vitest";

import { deriveRarity } from "@/lib/rarity";

describe("deriveRarity (espejo del Go)", () => {
  it("clasifica cada umbral igual que el backend", () => {
    // Cada caso: [nota TMDB, rareza esperada]. Bordes exactos incluidos.
    const cases: [number, string][] = [
      [10, "legendary"],
      [8.5, "legendary"],
      [8.49, "epic"],
      [7.5, "epic"],
      [7.49, "rare"],
      [6.5, "rare"],
      [6.49, "common"],
      [0, "common"], // sin calificación
    ];
    for (const [score, expected] of cases) {
      expect(deriveRarity(score), `nota ${score}`).toBe(expected);
    }
  });
});
