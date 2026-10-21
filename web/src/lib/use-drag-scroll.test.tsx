// Archivo: use-drag-scroll.test.tsx — Pruebas del GESTO de arrastrar una tira horizontal.
//
// En español: este hook es la única implementación del gesto "agarrar y tirar" que usan la línea de
// tiempo y el carrusel de sagas. Es la pieza con más estado oculto de toda la interfaz (sabe si estás
// arrastrando, cuánto te has movido, a qué velocidad y si el clic con el que terminas debe abrir algo
// o no), y ese estado vive en referencias que no se ven en pantalla. Si se queda mal, la tira deja de
// responder o se mueve sola, y no hay forma de darse cuenta leyendo el código.
//
// Lo que se comprueba aquí es exactamente lo que una persona nota con el dedo:
//   - Que tirar hacia un lado mueve el contenido hacia ese lado (y no al revés).
//   - Que un TOQUE quieto abre lo que se tocó, y un ARRASTRE no abre nada.
//   - Que si el navegador se queda el gesto a media (scroll vertical en táctil), la tira NO se queda
//     agarrada para siempre — que era el fallo real que motivó estas pruebas.
//   - Que el bucle infinito devuelve el scroll a la copia central.
//   - Que quien pidió menos movimiento no recibe inercia.
//
// El hook necesita un contenedor DESPLAZABLE de verdad y el navegador simulado no calcula tamaños, así
// que se le instalan a mano las medidas (scrollWidth) y un scrollLeft que recuerde su valor. Es la
// única forma de probar scroll en jsdom, y es fiel: el hook solo usa esas dos propiedades.

import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDragScroll } from "@/lib/use-drag-scroll";

// TRACK_SCROLL_WIDTH es el ancho total simulado de la tira: tres copias de 300 px cada una.
const TRACK_SCROLL_WIDTH = 900;
// COPY_WIDTH es lo que mide UNA copia (el ancho total dividido entre las tres copias).
const COPY_WIDTH = TRACK_SCROLL_WIDTH / 3;

// DragHarness es una tira mínima que usa el hook, con una tarjeta dentro para probar el clic.
// En español: reproduce la estructura real (riel con manejadores + tarjeta clicable) sin arrastrar
// consigo el resto de la aplicación, que aquí no aporta nada.
function DragHarness({ onCardClick }: { onCardClick: (suppressed: boolean) => void }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const { handlers, wrapScroll, shouldSuppressClick } = useDragScroll(trackRef, { copies: 3 });
  return (
    <div>
      <div data-testid="track" ref={trackRef} {...handlers}>
        <button type="button" onClick={() => onCardClick(shouldSuppressClick())}>
          tarjeta
        </button>
      </div>
      {/* Botón auxiliar para pedir el reajuste del bucle igual que hace el oyente de scroll real. */}
      <button type="button" onClick={() => wrapScroll()}>
        envolver
      </button>
    </div>
  );
}

// installScrollMetrics le da al elemento las medidas que el navegador simulado no calcula.
// Devuelve un lector del scrollLeft actual, que es lo que las pruebas observan.
//
// Arranca en la copia CENTRAL (scrollLeft = COPY_WIDTH), que es donde los dos carruseles reales se
// colocan al montarse. Es importante partir de ahí: el bucle infinito mantiene el scroll dentro de esa
// banda, así que medir desde el extremo izquierdo daría números desplazados por el propio reajuste.
function installScrollMetrics(element: HTMLElement): () => number {
  let scrollLeft = COPY_WIDTH;
  Object.defineProperty(element, "scrollWidth", {
    configurable: true,
    get: () => TRACK_SCROLL_WIDTH,
  });
  Object.defineProperty(element, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });
  return () => scrollLeft;
}

// installPointerCaptureSpies sustituye las funciones de CAPTURA del puntero por espías, para poder
// comprobar que se piden y se devuelven. El navegador simulado no las implementa de forma útil.
function installPointerCaptureSpies(element: HTMLElement) {
  const captured = new Set<number>();
  const setPointerCapture = vi.fn((pointerId: number) => {
    captured.add(pointerId);
  });
  const releasePointerCapture = vi.fn((pointerId: number) => {
    captured.delete(pointerId);
  });
  const hasPointerCapture = vi.fn((pointerId: number) => captured.has(pointerId));
  Object.defineProperty(element, "setPointerCapture", {
    configurable: true,
    value: setPointerCapture,
  });
  Object.defineProperty(element, "releasePointerCapture", {
    configurable: true,
    value: releasePointerCapture,
  });
  Object.defineProperty(element, "hasPointerCapture", {
    configurable: true,
    value: hasPointerCapture,
  });
  return { setPointerCapture, releasePointerCapture, captured };
}

// POINTER_ID es el identificador del dedo/cursor simulado (uno solo en todas las pruebas salvo donde
// se diga lo contrario).
const POINTER_ID = 7;

// renderHarness monta la tira y devuelve todo lo necesario para dirigir el gesto y observarlo.
function renderHarness() {
  const onCardClick = vi.fn();
  render(<DragHarness onCardClick={onCardClick} />);
  const track = screen.getByTestId("track");
  const readScrollLeft = installScrollMetrics(track);
  const captureSpies = installPointerCaptureSpies(track);
  return { track, readScrollLeft, onCardClick, ...captureSpies };
}

// pointerDown / pointerMove / pointerUp / pointerCancel disparan el gesto sobre el riel.
function pointerDown(track: HTMLElement, clientX: number, pointerId = POINTER_ID) {
  fireEvent.pointerDown(track, { clientX, button: 0, pointerId, isPrimary: true });
}
function pointerMove(track: HTMLElement, clientX: number, pointerId = POINTER_ID) {
  fireEvent.pointerMove(track, { clientX, pointerId, isPrimary: true });
}
function pointerUp(track: HTMLElement, pointerId = POINTER_ID) {
  fireEvent.pointerUp(track, { pointerId, isPrimary: true });
}
function pointerCancel(track: HTMLElement, pointerId = POINTER_ID) {
  fireEvent.pointerCancel(track, { pointerId, isPrimary: true });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDragScroll · el gesto de agarrar y tirar", () => {
  it("mueve el contenido en el sentido en que se tira", () => {
    const { track, readScrollLeft } = renderHarness();

    // Se agarra la tira y se arrastra 60 px hacia la IZQUIERDA: el contenido avanza esos 60 px.
    pointerDown(track, 200);
    pointerMove(track, 140);
    pointerUp(track);

    expect(readScrollLeft()).toBe(COPY_WIDTH + 60);
  });

  it("un toque quieto SÍ abre la tarjeta que se tocó", async () => {
    const { track, onCardClick } = renderHarness();

    pointerDown(track, 200);
    pointerUp(track);
    fireEvent.click(screen.getByRole("button", { name: "tarjeta" }));

    // El clic llega y NO se pide ignorarlo: un toque sin movimiento es una pulsación normal.
    expect(onCardClick).toHaveBeenCalledWith(false);
  });

  it("un arrastre NO abre la tarjeta, y solo se come UN clic", () => {
    const { track, onCardClick } = renderHarness();
    const card = screen.getByRole("button", { name: "tarjeta" });

    pointerDown(track, 200);
    pointerMove(track, 120);
    pointerUp(track);
    fireEvent.click(card);
    // El clic con el que termina el arrastre se ignora: tirar de la tira no debe abrir una ficha.
    expect(onCardClick).toHaveBeenNthCalledWith(1, true);

    // Pero solo ese: el siguiente clic, ya deliberado, tiene que funcionar.
    fireEvent.click(card);
    expect(onCardClick).toHaveBeenNthCalledWith(2, false);
  });

  it("pide la captura del puntero al confirmarse el arrastre, no antes", () => {
    const { track, setPointerCapture } = renderHarness();

    // Al apoyar el dedo todavía no se sabe si es un toque o un arrastre: no se captura nada, porque
    // capturar aquí desviaría el clic final y los toques dejarían de abrir la tarjeta que se tocó.
    pointerDown(track, 200);
    expect(setPointerCapture).not.toHaveBeenCalled();

    // En cuanto el dedo se mueve de verdad, sí: a partir de ahí el gesto es nuestro hasta el final.
    pointerMove(track, 150);
    expect(setPointerCapture).toHaveBeenCalledWith(POINTER_ID);
  });

  it("devuelve la captura al soltar (si no, la página entera dejaría de responder al puntero)", () => {
    const { track, releasePointerCapture, captured } = renderHarness();

    pointerDown(track, 200);
    pointerMove(track, 150);
    pointerUp(track);

    expect(releasePointerCapture).toHaveBeenCalledWith(POINTER_ID);
    expect(captured.size).toBe(0);
  });

  it("si el navegador CANCELA el gesto, la tira deja de estar agarrada", () => {
    const { track, readScrollLeft } = renderHarness();

    // Arrastre normal en marcha...
    pointerDown(track, 200);
    pointerMove(track, 150);
    expect(readScrollLeft()).toBe(COPY_WIDTH + 50);

    // ...y el navegador se queda el gesto (en táctil: ha decidido que es un scroll vertical).
    // No llegará ningún "soltar": si la cancelación no se atendiera, la tira quedaría agarrada.
    pointerCancel(track);

    // Mover el dedo después ya no debe mover nada: el gesto terminó.
    pointerMove(track, 40);
    expect(readScrollLeft()).toBe(COPY_WIDTH + 50);
  });

  it("tras una cancelación, el siguiente toque SÍ abre la tarjeta", () => {
    const { track, onCardClick } = renderHarness();

    // Arrastre que el navegador cancela a medias.
    pointerDown(track, 200);
    pointerMove(track, 120);
    pointerCancel(track);

    // Después de una cancelación no llega ningún clic, así que la marca de "ignora el próximo clic"
    // no debe quedarse puesta: si se quedara, se comería el siguiente toque de verdad y la persona
    // vería que su primer intento de abrir una ficha "no hace nada", sin explicación posible.
    fireEvent.click(screen.getByRole("button", { name: "tarjeta" }));
    expect(onCardClick).toHaveBeenCalledWith(false);
  });

  it("ignora a un SEGUNDO dedo mientras hay un arrastre en curso", () => {
    const { track, readScrollLeft } = renderHarness();

    pointerDown(track, 200);
    pointerMove(track, 150);
    expect(readScrollLeft()).toBe(COPY_WIDTH + 50);

    // Otro dedo se apoya y se mueve por la pantalla: sus movimientos no son parte de este gesto y la
    // tira no debe dar un salto hacia donde esté ese segundo dedo.
    pointerMove(track, 900, POINTER_ID + 1);
    expect(readScrollLeft()).toBe(COPY_WIDTH + 50);
  });

  it("el bucle infinito devuelve el scroll a la copia central", () => {
    const { track, readScrollLeft } = renderHarness();

    // Se tira 10 px hacia la derecha desde el inicio de la copia central: el scroll se saldría por
    // abajo de la banda (290) y entraría en la copia de la izquierda, que es un clon.
    pointerDown(track, 200);
    pointerMove(track, 210);

    // En vez de eso, el bucle lo reubica en el punto EQUIVALENTE de la banda central: como las tres
    // copias son idénticas, lo que se ve en pantalla es exactamente lo mismo y el salto es invisible.
    expect(readScrollLeft()).toBe(COPY_WIDTH * 2 - 10);
    pointerUp(track);
  });

  it("no lanza inercia si la persona pidió reducir el movimiento", () => {
    // Se declara la preferencia del sistema ANTES de soltar: la inercia es una animación y quien
    // pidió menos movimiento no debe recibirla (regla de accesibilidad del proyecto).
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");
    const { track } = renderHarness();

    // Gesto rápido (mucho recorrido de golpe): en condiciones normales dispararía la inercia.
    pointerDown(track, 400);
    pointerMove(track, 300);
    pointerUp(track);

    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("sí lanza inercia tras un gesto rápido cuando no hay preferencia de menos movimiento", () => {
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const { track } = renderHarness();

    pointerDown(track, 400);
    pointerMove(track, 300);
    pointerUp(track);

    // La tira sigue avanzando sola un momento: es lo que hace que el gesto se sienta físico.
    expect(requestFrame).toHaveBeenCalled();
  });

  it("el botón derecho del ratón no arrastra", () => {
    const { track, readScrollLeft } = renderHarness();

    fireEvent.pointerDown(track, { clientX: 200, button: 2, pointerId: POINTER_ID });
    pointerMove(track, 100);

    // La tira sigue exactamente donde estaba: un clic derecho abre el menú del sistema, no arrastra.
    expect(readScrollLeft()).toBe(COPY_WIDTH);
  });
});
