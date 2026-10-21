// Archivo: catalog-cache.test.ts — Pruebas de la memoria de corta duración del catálogo.
//
// En español: lo que se protege aquí es la lección aprendida en una prueba real. Al guardar la página
// ya construida, un backend caído durante unos segundos dejaba una pantalla de error guardada y la
// gente seguía viéndola durante minutos, con el servicio ya recuperado. La regla que lo evita es
// simple y es la que estas pruebas fijan: SOLO se guarda lo que salió bien.

import { afterEach, describe, expect, it, vi } from "vitest";

import { cacheSuccessfulResult, clearCatalogCache } from "@/lib/connect/catalog-cache";

// Resultado de ejemplo con la misma forma que usa el catálogo (datos + error).
type Result = { data: string; error: string | null };

// isSuccess es la regla de "esto merece guardarse": no hubo error.
const isSuccess = (result: Result) => result.error === null;

afterEach(() => {
  clearCatalogCache();
  vi.useRealTimers();
});

describe("cacheSuccessfulResult", () => {
  it("consulta una sola vez y reutiliza el resultado correcto", async () => {
    const load = vi.fn(async (): Promise<Result> => ({ data: "catálogo", error: null }));

    const first = await cacheSuccessfulResult("clave", isSuccess, load);
    const second = await cacheSuccessfulResult("clave", isSuccess, load);

    expect(first).toEqual({ data: "catálogo", error: null });
    expect(second).toEqual(first);
    // La segunda vez no se volvió a preguntar: ese es todo el ahorro.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("NO guarda los fallos: el siguiente intento vuelve a preguntar", async () => {
    const load = vi.fn(
      async (): Promise<Result> => ({ data: "", error: "el backend no respondió" }),
    );

    await cacheSuccessfulResult("clave", isSuccess, load);
    await cacheSuccessfulResult("clave", isSuccess, load);
    await cacheSuccessfulResult("clave", isSuccess, load);

    // Tres intentos, tres consultas: un error nunca se queda guardado.
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("en cuanto el backend se recupera, la respuesta buena se ve de inmediato", async () => {
    // Este es EXACTAMENTE el caso que se rompía antes: fallo, recuperación, y la pantalla de error
    // sobreviviendo a la recuperación. Aquí se comprueba que ya no ocurre.
    let backendIsDown = true;
    const load = vi.fn(
      async (): Promise<Result> =>
        backendIsDown ? { data: "", error: "caído" } : { data: "catálogo", error: null },
    );

    const whileDown = await cacheSuccessfulResult("clave", isSuccess, load);
    expect(whileDown.error).not.toBeNull();

    backendIsDown = false;
    const afterRecovery = await cacheSuccessfulResult("clave", isSuccess, load);

    expect(afterRecovery).toEqual({ data: "catálogo", error: null });
  });

  it("separa las respuestas por llave (cada mes es independiente)", async () => {
    const load = vi.fn(async (): Promise<Result> => ({ data: "agosto", error: null }));
    const otherLoad = vi.fn(async (): Promise<Result> => ({ data: "septiembre", error: null }));

    const august = await cacheSuccessfulResult("releases:2026-8", isSuccess, load);
    const september = await cacheSuccessfulResult("releases:2026-9", isSuccess, otherLoad);

    expect(august.data).toBe("agosto");
    expect(september.data).toBe("septiembre");
  });

  it("un resumen y un detalle del MISMO mes no se pisan entre sí", async () => {
    // Esta es la prueba que una auditoría echó en falta, y con razón. La aplicación guarda dos cosas
    // distintas del mismo mes: la versión ligera que dibuja la lista y la versión completa que
    // necesitan la ficha, el mapa y las páginas de persona. Lo único que las mantiene separadas es
    // que sus llaves empiezan distinto ("summaries:" y "details:"), y eso era una costumbre que nada
    // vigilaba.
    //
    // Por qué importa tanto: al leer lo guardado no se comprueba de qué tipo es. Si un día alguien
    // escribiera las dos bajo la misma llave, la lista recibiría fichas completas —lento pero
    // visible— o, mucho peor, la ficha recibiría un resumen y aparecería sin reparto, sin galería y
    // sin calendario, como si el título no tuviera nada. Sin error, sin aviso: simplemente vacía.
    const ligero = { data: "resumen", error: null };
    const completo = { data: "ficha entera", error: null };

    const guardadoLigero = await cacheSuccessfulResult(
      "summaries:2026-8",
      isSuccess,
      async () => ligero,
    );
    const guardadoCompleto = await cacheSuccessfulResult(
      "details:2026-8",
      isSuccess,
      async () => completo,
    );

    expect(guardadoLigero.data).toBe("resumen");
    expect(guardadoCompleto.data).toBe("ficha entera");

    // Y al volver a pedirlos, cada uno sigue devolviendo lo suyo.
    const noDeberiaPedirse = async () => {
      throw new Error("no debería volver a consultarse: estaba guardado");
    };
    expect(
      (await cacheSuccessfulResult("summaries:2026-8", isSuccess, noDeberiaPedirse)).data,
    ).toBe("resumen");
    expect((await cacheSuccessfulResult("details:2026-8", isSuccess, noDeberiaPedirse)).data).toBe(
      "ficha entera",
    );
  });

  it("olvida la respuesta cuando caduca y la vuelve a pedir", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async (): Promise<Result> => ({ data: "catálogo", error: null }));

    await cacheSuccessfulResult("clave", isSuccess, load);
    expect(load).toHaveBeenCalledTimes(1);

    // Justo antes de caducar sigue sirviendo lo guardado…
    vi.advanceTimersByTime(4 * 60 * 1000);
    await cacheSuccessfulResult("clave", isSuccess, load);
    expect(load).toHaveBeenCalledTimes(1);

    // …y pasado el plazo, se vuelve a preguntar.
    vi.advanceTimersByTime(2 * 60 * 1000);
    await cacheSuccessfulResult("clave", isSuccess, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("no crece sin límite: al llenarse olvida lo más antiguo", async () => {
    // Se guardan más entradas que el tope para comprobar que las viejas se descartan.
    for (let index = 0; index < 100; index += 1) {
      await cacheSuccessfulResult(`clave-${index}`, isSuccess, async () => ({
        data: `valor-${index}`,
        error: null,
      }));
    }

    // La primera ya debería haberse olvidado: al volver a pedirla, se consulta de nuevo.
    const load = vi.fn(async (): Promise<Result> => ({ data: "recargado", error: null }));
    await cacheSuccessfulResult("clave-0", isSuccess, load);
    expect(load).toHaveBeenCalledTimes(1);

    // Y la última sigue guardada: no se olvidan entradas recientes.
    const recentLoad = vi.fn(
      async (): Promise<Result> => ({ data: "no-deberia-pedirse", error: null }),
    );
    const recent = await cacheSuccessfulResult("clave-99", isSuccess, recentLoad);
    expect(recentLoad).not.toHaveBeenCalled();
    expect(recent.data).toBe("valor-99");
  });
});
