// Archivo: use-focus-trap.test.tsx — Pruebas de la TRAMPA DE FOCO de los diálogos.
//
// En español: cuando la aplicación abre un diálogo y lo declara "modal", le está haciendo a quien
// navega sin ratón una promesa muy concreta: mientras esto esté abierto, el resto de la página no
// existe. Esa promesa se cumple con tres comportamientos, y los tres son invisibles en pantalla para
// quien usa el ratón, así que solo una prueba los vigila:
//
//   1. Al abrirse, el foco entra en el diálogo (no se queda detrás, donde ya no se ve nada).
//   2. Mientras está abierto, el tabulador da la vuelta DENTRO del diálogo y no se escapa al fondo.
//   3. Al cerrarse, el foco vuelve a quien lo abrió (y no al principio de la página).
//
// Sin trampa, un lector de pantalla sigue leyendo botones y enlaces del fondo que están tapados por
// el velo: la persona opera a ciegas una pantalla que cree cerrada. Por eso esto no es un detalle.

import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { useFocusTrap } from "@/lib/use-focus-trap";

// TrapHarness reproduce la situación real: una página con un botón que abre un diálogo con trampa,
// y contenido enfocable de fondo que NO debe alcanzarse mientras el diálogo esté abierto.
function TrapHarness({ withContent = true }: { withContent?: boolean }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        abrir
      </button>
      <a href="/fondo">enlace del fondo</a>
      {open ? (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="diálogo" tabIndex={-1}>
          {withContent ? (
            <>
              <button type="button">primero</button>
              <button type="button">segundo</button>
              <button type="button" onClick={() => setOpen(false)}>
                cerrar
              </button>
            </>
          ) : (
            <p>sin nada que pulsar</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

describe("useFocusTrap · la trampa de foco de los diálogos", () => {
  it("mete el foco dentro del diálogo al abrirlo", async () => {
    const user = userEvent.setup();
    render(<TrapHarness />);

    await user.click(screen.getByRole("button", { name: "abrir" }));

    // El primer elemento operable del diálogo recibe el foco: la persona ya está "dentro".
    expect(screen.getByRole("button", { name: "primero" })).toHaveFocus();
  });

  it("enfoca el diálogo mismo cuando no hay nada operable dentro", async () => {
    const user = userEvent.setup();
    render(<TrapHarness withContent={false} />);

    await user.click(screen.getByRole("button", { name: "abrir" }));

    // Un diálogo puramente informativo (una lista vacía, un aviso) no tiene botones. Aun así el foco
    // tiene que entrar en él: si se quedara fuera, el lector de pantalla seguiría leyendo el fondo.
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("el tabulador da la vuelta dentro del diálogo y no se escapa al fondo", async () => {
    const user = userEvent.setup();
    render(<TrapHarness />);
    await user.click(screen.getByRole("button", { name: "abrir" }));

    // Desde el primero, dos tabulaciones llevan al último elemento del diálogo.
    await user.tab();
    expect(screen.getByRole("button", { name: "segundo" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "cerrar" })).toHaveFocus();

    // Y una más vuelve al principio del diálogo, NO al enlace del fondo (que sigue en la página).
    await user.tab();
    expect(screen.getByRole("button", { name: "primero" })).toHaveFocus();
  });

  it("con Mayúsculas+Tab la vuelta se da en el otro sentido", async () => {
    const user = userEvent.setup();
    render(<TrapHarness />);
    await user.click(screen.getByRole("button", { name: "abrir" }));

    // Desde el primer elemento, retroceder lleva al último del diálogo (no al botón que lo abrió).
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "cerrar" })).toHaveFocus();
  });

  it("devuelve el foco a quien abrió el diálogo al cerrarse", async () => {
    const user = userEvent.setup();
    render(<TrapHarness />);
    const openButton = screen.getByRole("button", { name: "abrir" });

    await user.click(openButton);
    await user.click(screen.getByRole("button", { name: "cerrar" }));

    // El foco no puede quedarse "en el aire" cuando desaparece lo que lo contenía: vuelve al origen,
    // que es donde la persona espera continuar.
    expect(openButton).toHaveFocus();
  });

  it("recupera el foco si algo del fondo se lo lleva", async () => {
    const user = userEvent.setup();
    render(<TrapHarness />);
    await user.click(screen.getByRole("button", { name: "abrir" }));

    // Simulamos que otra pieza de la página roba el foco (un autofocus tardío, por ejemplo).
    screen.getByRole("link", { name: "enlace del fondo" }).focus();
    // La siguiente tabulación debe devolver el foco al diálogo, no seguir recorriendo el fondo.
    await user.tab();

    expect(screen.getByRole("button", { name: "primero" })).toHaveFocus();
  });
});
