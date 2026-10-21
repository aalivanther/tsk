// Archivo: site-url.test.ts — Pruebas de la dirección pública del sitio.
//
// Por qué merecen existir, en español: esta función parece trivial y su fallo era invisible. El
// archivo robots.txt y el mapa del sitio se preparaban POR ADELANTADO, al compilar, cuando la
// variable de entorno con la dirección real todavía no existía. Resultado: en un despliegue de
// verdad, ambos anunciaban a los buscadores "http://localhost:3000" — una dirección que no existe
// para nadie de fuera — y ciento cincuenta enlaces de fichas apuntando ahí. Todo verde, nada que
// mirara si el valor tenía sentido.

import { afterEach, describe, expect, it, vi } from "vitest";

import { siteUrl } from "@/lib/site-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteUrl", () => {
  it("usa la dirección configurada", () => {
    vi.stubEnv("SITE_URL", "https://thestorykeeper.mx");

    expect(siteUrl()).toBe("https://thestorykeeper.mx");
  });

  it("quita la barra final para que unir rutas no produzca dobles barras", () => {
    vi.stubEnv("SITE_URL", "https://thestorykeeper.mx/");

    expect(`${siteUrl()}/titulo/duna-3`).toBe("https://thestorykeeper.mx/titulo/duna-3");
  });

  it("aguanta espacios sobrantes al copiar y pegar la variable", () => {
    vi.stubEnv("SITE_URL", "  https://thestorykeeper.mx  ");

    expect(siteUrl()).toBe("https://thestorykeeper.mx");
  });

  it("sin configurar, cae a la dirección de desarrollo en vez de inventarse un dominio", () => {
    vi.stubEnv("SITE_URL", "");

    // Que el respaldo sea la dirección local es deliberado: inventar un dominio de producción que no
    // existe haría que los buscadores indexaran enlaces rotos sin que nadie se diera cuenta.
    expect(siteUrl()).toBe("http://localhost:3000");
  });
});
