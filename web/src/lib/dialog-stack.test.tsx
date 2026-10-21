// Archivo: dialog-stack.test.tsx — Pruebas de la PILA de diálogos (qué cierra la tecla Escape).
//
// En español: la aplicación puede tener varias capas abiertas a la vez — el panel de una categoría,
// encima la ficha de un título, encima el modal de una película de su saga. Antes cada capa escuchaba
// su propia tecla Escape y una sola pulsación las cerraba TODAS de golpe: la persona quería volver un
// paso atrás y se encontraba en la pantalla inicial, habiendo perdido dónde estaba.
//
// La pila arregla eso con una regla de una línea: Escape cierra ÚNICAMENTE la capa de más arriba. Es
// una regla fácil de romper sin darse cuenta (basta con que alguien añada un listener propio en una
// capa nueva), y su efecto es imposible de ver leyendo un archivo suelto. De ahí estas pruebas.

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDialogEscape } from "@/lib/dialog-stack";

// EscapeLayer es una capa de diálogo cualquiera: se registra en la pila mientras está abierta.
function EscapeLayer({
  name,
  open,
  onClose,
}: {
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  useDialogEscape(open, onClose);
  return open ? <p>capa {name} abierta</p> : null;
}

// pressEscape simula la pulsación de la tecla Escape en la ventana, que es donde escucha la pila.
function pressEscape() {
  fireEvent.keyDown(window, { key: "Escape" });
}

describe("dialog-stack · qué cierra la tecla Escape", () => {
  it("cierra la capa abierta", () => {
    const onClose = vi.fn();
    render(<EscapeLayer name="única" open onClose={onClose} />);

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("con dos capas abiertas cierra SOLO la de arriba", () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(
      <>
        <EscapeLayer name="fondo" open onClose={closeBottom} />
        <EscapeLayer name="encima" open onClose={closeTop} />
      </>,
    );

    pressEscape();

    // Una pulsación = una capa. La de abajo sigue exactamente donde estaba.
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
  });

  it("al cerrarse la de arriba, la siguiente pulsación cierra la de abajo", () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();

    // Escalera de dos capas donde la de arriba se puede cerrar de verdad (no solo avisar).
    function Stack() {
      const [topOpen, setTopOpen] = useState(true);
      return (
        <>
          <EscapeLayer name="fondo" open onClose={closeBottom} />
          <EscapeLayer
            name="encima"
            open={topOpen}
            onClose={() => {
              closeTop();
              setTopOpen(false);
            }}
          />
        </>
      );
    }
    render(<Stack />);

    pressEscape();
    expect(screen.queryByText("capa encima abierta")).toBeNull();
    expect(closeBottom).not.toHaveBeenCalled();

    // Ahora que arriba no queda nada, Escape retrocede un paso más: es la navegación hacia atrás
    // que espera cualquiera, capa a capa.
    pressEscape();
    expect(closeBottom).toHaveBeenCalledTimes(1);
  });

  it("una capa cerrada no reacciona a Escape", () => {
    const onClose = vi.fn();
    render(<EscapeLayer name="cerrada" open={false} onClose={onClose} />);

    pressEscape();

    expect(onClose).not.toHaveBeenCalled();
  });

  it("no deja oyentes sueltos cuando se cierra la última capa", () => {
    const onClose = vi.fn();
    const { unmount } = render(<EscapeLayer name="única" open onClose={onClose} />);

    unmount();
    pressEscape();

    // Tras desmontarse no debe quedar nada escuchando la tecla: un oyente huérfano seguiría
    // llamando al cierre de una capa que ya no existe (y en React eso es un aviso de fuga).
    expect(onClose).not.toHaveBeenCalled();
  });

  it("otras teclas no cierran nada", () => {
    const onClose = vi.fn();
    render(<EscapeLayer name="única" open onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "a" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("impide que la MISMA pulsación llegue a otros oyentes de la página", () => {
    const onClose = vi.fn();
    const pageListener = vi.fn();
    window.addEventListener("keydown", pageListener);
    render(<EscapeLayer name="única" open onClose={onClose} />);

    pressEscape();

    // La pila detiene la propagación: si no lo hiciera, la misma tecla dispararía a la vez el cierre
    // del diálogo y cualquier atajo global de la página (que es justo el fallo que vino a arreglar).
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pageListener).not.toHaveBeenCalled();
    window.removeEventListener("keydown", pageListener);
  });
});
