// Archivo: images.test.ts — Pruebas del ajuste de tamaño de las imágenes de TMDB.
// En español: lo que se protege aquí es que pedir una imagen más pequeña NUNCA rompa la imagen. Si el
// ajuste fallara en silencio, el resultado no sería "una imagen algo más pesada" sino un hueco vacío
// en la interfaz, que es mucho peor.

import { describe, expect, it } from "vitest";

import { isTmdbImage, tmdbImage, tmdbImageAt } from "@/lib/images";

describe("tmdbImage", () => {
  it("cambia el tamaño conservando el resto de la URL", () => {
    const original = "https://image.tmdb.org/t/p/w1280/abc123.jpg";
    expect(tmdbImage(original, "thumb")).toBe("https://image.tmdb.org/t/p/w342/abc123.jpg");
    expect(tmdbImage(original, "card")).toBe("https://image.tmdb.org/t/p/w500/abc123.jpg");
    expect(tmdbImage(original, "wide")).toBe("https://image.tmdb.org/t/p/w780/abc123.jpg");
    expect(tmdbImage(original, "hero")).toBe("https://image.tmdb.org/t/p/w1280/abc123.jpg");
  });

  it("funciona con rutas que llevan subcarpetas o nombres largos", () => {
    const original = "https://image.tmdb.org/t/p/original/aB3-x_9/poster.final.jpg";
    expect(tmdbImage(original, "thumb")).toBe(
      "https://image.tmdb.org/t/p/w342/aB3-x_9/poster.final.jpg",
    );
  });

  it("devuelve la URL intacta si no es de TMDB", () => {
    const foreign = "https://example.com/imagen.jpg";
    expect(tmdbImage(foreign, "thumb")).toBe(foreign);
  });

  it("devuelve la cadena vacía tal cual (no hay imagen que ajustar)", () => {
    expect(tmdbImage("", "thumb")).toBe("");
  });

  it("no toca URLs de TMDB con una forma inesperada", () => {
    // Sin la parte del tamaño: no se puede reescribir sin riesgo, así que se deja igual.
    const odd = "https://image.tmdb.org/otra/ruta/abc.jpg";
    expect(tmdbImage(odd, "thumb")).toBe(odd);
  });

  it("no acepta http sin cifrar como imagen de TMDB", () => {
    // El catálogo siempre usa https; aceptar http abriría una descarga sin cifrar.
    expect(isTmdbImage("http://image.tmdb.org/t/p/w500/abc.jpg")).toBe(false);
  });

  it("isTmdbImage reconoce solo las URLs con la forma esperada", () => {
    expect(isTmdbImage("https://image.tmdb.org/t/p/w500/abc.jpg")).toBe(true);
    expect(isTmdbImage("https://example.com/abc.jpg")).toBe(false);
    expect(isTmdbImage("")).toBe(false);
  });

  it("pide el tamaño diminuto (w92) para las carátulas del anticipo diario", () => {
    // Estas carátulas se pintan a 34 píxeles de ancho. Pedirlas en tamaño de tarjeta significaba
    // descargar una imagen diez veces más ancha de lo que se ve, un centenar de veces al abrir la
    // página. Es la clase de derroche que no se nota en una conexión rápida y arruina la carga en un
    // teléfono con datos móviles.
    //
    // Se fija w92 (y no w154) porque a 34 px de ancho, incluso en una pantalla de DOBLE densidad,
    // hacen falta 68 píxeles reales: w92 los cubre con un 35% de margen y pesa un 56,6% menos.
    // Esta prueba deja el valor clavado: si alguien lo subiera "por si acaso", volverían los 620 KB.
    expect(tmdbImage("https://image.tmdb.org/t/p/w500/abc.jpg", "tiny")).toBe(
      "https://image.tmdb.org/t/p/w92/abc.jpg",
    );
  });

  it("tmdbImageAt cambia solo el ancho, y deja intactas las URLs que no son de TMDB", () => {
    expect(tmdbImageAt("https://image.tmdb.org/t/p/w1280/abc.jpg", "w300")).toBe(
      "https://image.tmdb.org/t/p/w300/abc.jpg",
    );
    expect(tmdbImageAt("https://example.com/abc.jpg", "w300")).toBe("https://example.com/abc.jpg");
    expect(tmdbImageAt("", "w300")).toBe("");
  });
});
