"use client";

// Archivo: use-focus-trap.ts — Trampa de FOCO reutilizable para diálogos montados por portal.
//
// En español: un diálogo accesible debe (1) recibir el foco al abrirse, (2) mantener el Tab DENTRO de
// sí mismo mientras está abierto (el fondo no es operable) y (3) devolver el foco a donde estaba al
// cerrarse. El Stage ya hacía esto con su propia lógica, pero los diálogos por PORTAL (la ficha
// ReleaseModal, el modal de saga, el lightbox) se montan en document.body — fuera del contenedor del
// Stage — y quedaban SIN trampa: el Tab se escapaba al fondo y el foco no se restauraba al cerrar.
// Este hook les da a todos la misma trampa, con el mismo comportamiento.
//
// Uso: const dialogRef = useFocusTrap<HTMLDivElement>(estáAbierto); y poner ref={dialogRef} en el
// contenedor del diálogo. El contenedor debe tener tabIndex={-1} como respaldo de foco inicial.

import { useEffect, useRef, type RefObject } from "react";

// FOCUSABLE_SELECTOR reúne los elementos operables por teclado dentro de un diálogo.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// useFocusTrap devuelve el ref del contenedor del diálogo y gestiona foco inicial, trampa y retorno.
export function useFocusTrap<T extends HTMLElement>(active: boolean): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    // (3) Recordamos quién tenía el foco para devolvérselo al cerrar.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // (1) Foco inicial: el primer elemento operable del diálogo; si no hay, el contenedor mismo.
    const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    if (firstFocusable !== null) {
      firstFocusable.focus();
    } else {
      container.focus();
    }

    // (2) Trampa: en cada Tab, si el foco va a SALIR del contenedor, lo envolvemos al otro extremo.
    // Escuchamos en document (captura) porque el diálogo vive en un portal: sus eventos no burbujean
    // por el DOM hasta ningún ancestro útil.
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;
      // Si el foco está FUERA del diálogo (p. ej. lo robó otra pieza), lo traemos de vuelta.
      if (current === null || !container.contains(current)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeydown, true);

    return () => {
      document.removeEventListener("keydown", handleKeydown, true);
      // (3) Retorno del foco: solo si quien lo tenía sigue en el documento (puede haberse desmontado).
      if (previouslyFocused !== null && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return containerRef;
}
