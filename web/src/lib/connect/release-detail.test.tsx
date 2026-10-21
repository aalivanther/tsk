// Archivo: release-detail.test.ts — Pruebas de la ficha que se pide al abrir un título.
//
// Qué se protege aquí, en español: al dejar de mandar las fichas completas dentro de la lista de
// estrenos, abrir un título pasó a implicar una llamada al servidor. Esa llamada es lo único que la
// persona podría llegar a notar de todo el cambio, así que las tres reglas que la hacen imperceptible
// tienen que estar escritas y comprobadas:
//
//   1. Se recuerda lo ya traído: volver a abrir el mismo título no vuelve a preguntar.
//   2. Dos partes de la pantalla que pidan la misma ficha a la vez comparten UNA sola llamada.
//   3. Un fallo NO se recuerda: el siguiente intento vuelve a preguntar de verdad, en vez de repetir
//      para siempre un error ya caducado. Es la misma lección que la memoria del catálogo del
//      servidor aprendió en su día (ver catalog-cache.ts).
//
// Se prueba el hook a través de un componente de mentira, porque es así como se usa de verdad.

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// getReleaseMock es el doble de la llamada al backend. Se declara ANTES del vi.mock porque esa
// instrucción se ejecuta antes que el resto del archivo, y una variable normal aún no existiría.
const { getReleaseMock } = vi.hoisted(() => ({ getReleaseMock: vi.fn() }));

// Sustituimos el creador de clientes de Connect por uno que devuelve nuestro doble. Así estas
// pruebas corren en un segundo, sin red y sin levantar ningún servidor.
vi.mock("@connectrpc/connect", async () => {
  const actual = await vi.importActual<typeof import("@connectrpc/connect")>("@connectrpc/connect");
  return { ...actual, createClient: () => ({ getRelease: getReleaseMock }) };
});

import { Code, ConnectError } from "@connectrpc/connect";

import {
  clearReleaseDetailCache,
  prefetchReleaseDetail,
  useReleaseDetail,
} from "@/lib/connect/release-detail";

// DetailProbe es un componente de mentira que solo escribe en pantalla lo que el hook devuelve.
// En español: no dibuja nada bonito; sirve para poder afirmar "esto está cargando", "llegó esta
// ficha" o "salió este error" leyendo el texto, que es como se comprueban las pantallas de verdad.
function DetailProbe({ id }: { id: string | null }) {
  const { release, loading, error } = useReleaseDetail(id);
  return (
    <div>
      <span data-testid="estado">{loading ? "cargando" : error !== null ? "error" : "listo"}</span>
      <span data-testid="titulo">{release?.title ?? ""}</span>
    </div>
  );
}

afterEach(() => {
  clearReleaseDetailCache();
  getReleaseMock.mockReset();
});

describe("useReleaseDetail", () => {
  it("pide la ficha, la enseña y NO vuelve a pedirla la segunda vez", async () => {
    getReleaseMock.mockResolvedValue({ release: { id: "a", title: "Réquiem" } });

    const first = render(<DetailProbe id="a" />);
    expect(screen.getByTestId("estado").textContent).toBe("cargando");
    await waitFor(() => expect(screen.getByTestId("titulo").textContent).toBe("Réquiem"));
    first.unmount();

    // Segunda apertura del MISMO título: aparece ya lista, sin pasar por "cargando".
    render(<DetailProbe id="a" />);
    expect(screen.getByTestId("estado").textContent).toBe("listo");
    expect(screen.getByTestId("titulo").textContent).toBe("Réquiem");
    expect(getReleaseMock).toHaveBeenCalledTimes(1);
  });

  it("no pregunta dos veces lo mismo cuando dos partes de la pantalla lo piden a la vez", async () => {
    getReleaseMock.mockResolvedValue({ release: { id: "a", title: "Réquiem" } });

    render(
      <>
        <DetailProbe id="a" />
        <DetailProbe id="a" />
      </>,
    );

    await waitFor(() => expect(getReleaseMock).toHaveBeenCalledTimes(1));
  });

  it("sin título abierto no pide nada", () => {
    render(<DetailProbe id={null} />);

    expect(screen.getByTestId("estado").textContent).toBe("listo");
    expect(getReleaseMock).not.toHaveBeenCalled();
  });

  it("avisa del fallo y NO lo recuerda: el siguiente intento vuelve a preguntar", async () => {
    getReleaseMock.mockRejectedValue(new Error("la red se cayó"));
    // El fallo se registra en la consola a propósito (diagnóstico); aquí se silencia para que la
    // salida de las pruebas no parezca rota cuando en realidad el caso es el esperado.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const first = render(<DetailProbe id="a" />);
    await waitFor(() => expect(screen.getByTestId("estado").textContent).toBe("error"));
    first.unmount();

    getReleaseMock.mockResolvedValue({ release: { id: "a", title: "Réquiem" } });
    render(<DetailProbe id="a" />);
    await waitFor(() => expect(screen.getByTestId("titulo").textContent).toBe("Réquiem"));
    expect(getReleaseMock).toHaveBeenCalledTimes(2);

    consoleSpy.mockRestore();
  });

  it("distingue 'ya no está en el catálogo' de 'no se pudo traer'", async () => {
    getReleaseMock.mockRejectedValue(new ConnectError("no existe", Code.NotFound));

    render(<DetailProbe id="fantasma" />);

    await waitFor(() => expect(screen.getByTestId("estado").textContent).toBe("error"));
    // Un título que ya no está no se arregla reintentando, y por eso ni siquiera se registra como
    // fallo del sistema: es un desenlace normal del producto.
    expect(screen.getByTestId("titulo").textContent).toBe("");
  });

  it("al cambiar de título enseña el nuevo, nunca el anterior", async () => {
    getReleaseMock.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve({ release: { id, title: id === "a" ? "Réquiem" : "Alborada" } }),
    );

    const view = render(<DetailProbe id="a" />);
    await waitFor(() => expect(screen.getByTestId("titulo").textContent).toBe("Réquiem"));

    view.rerender(<DetailProbe id="b" />);
    // En el instante del cambio NO se ve el título anterior: se ve el estado de carga del nuevo.
    expect(screen.getByTestId("titulo").textContent).toBe("");
    await waitFor(() => expect(screen.getByTestId("titulo").textContent).toBe("Alborada"));
  });
});

describe("prefetchReleaseDetail", () => {
  it("adelanta la petición, de modo que al abrir el título ya está listo", async () => {
    getReleaseMock.mockResolvedValue({ release: { id: "a", title: "Réquiem" } });

    prefetchReleaseDetail("a");
    await waitFor(() => expect(getReleaseMock).toHaveBeenCalledTimes(1));

    // Al abrirlo de verdad, aparece ya lista y sin una segunda llamada.
    render(<DetailProbe id="a" />);
    expect(screen.getByTestId("estado").textContent).toBe("listo");
    expect(getReleaseMock).toHaveBeenCalledTimes(1);
  });

  it("un adelanto que falla no molesta a nadie ni deja el fallo guardado", async () => {
    getReleaseMock.mockRejectedValue(new Error("la red se cayó"));

    // No lanza aunque la llamada falle: nadie está esperando este resultado todavía.
    prefetchReleaseDetail("a");
    await waitFor(() => expect(getReleaseMock).toHaveBeenCalledTimes(1));

    getReleaseMock.mockResolvedValue({ release: { id: "a", title: "Réquiem" } });
    render(<DetailProbe id="a" />);
    await waitFor(() => expect(screen.getByTestId("titulo").textContent).toBe("Réquiem"));
  });
});
