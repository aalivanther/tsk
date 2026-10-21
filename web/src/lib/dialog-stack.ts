"use client";

// Archivo: dialog-stack.ts — Pila COMPARTIDA de diálogos para que Escape cierre SOLO el de arriba.
//
// En español: la app puede tener varias capas de diálogo abiertas a la vez (el Stage de categoría,
// encima la ficha ReleaseModal, encima el modal de saga o el lightbox de la galería). Antes, cada capa
// escuchaba su PROPIO "keydown" de Escape en window: una sola pulsación disparaba TODOS los cierres a
// la vez (se cerraba el modal hijo Y se colapsaba el Stage de abajo). Esta pila lo arregla con una
// regla simple: los diálogos se registran al abrirse (orden de apertura) y Escape cierra ÚNICAMENTE el
// ÚLTIMO registrado (el de arriba). Una pulsación = una capa, como en cualquier interfaz nativa.
//
// Uso: cada diálogo llama useDialogEscape(estáAbierto, cerrar). Nada más — el hook registra/retira la
// entrada en la pila y el listener global (uno solo para toda la app) hace el resto.

import { useEffect, useRef } from "react";

// DialogEntry es una entrada de la pila: la función que cierra ESE diálogo.
type DialogEntry = {
  close: () => void;
};

// dialogStack es la pila viva de diálogos abiertos (el último elemento es el de más arriba).
// Vive a nivel de módulo: todas las capas de la app comparten la MISMA pila.
const dialogStack: DialogEntry[] = [];

// handleWindowKeydown es el ÚNICO listener global de Escape. En español: se registra cuando se abre el
// primer diálogo y se retira al cerrarse el último. Cierra solo el tope de la pila y detiene la
// propagación para que ningún otro listener de la página reaccione a la misma pulsación.
function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || dialogStack.length === 0) {
    return;
  }
  event.stopImmediatePropagation();
  event.preventDefault();
  const top = dialogStack[dialogStack.length - 1];
  top.close();
}

// useDialogEscape registra un diálogo en la pila mientras esté abierto (active=true).
// En español: al abrir, el diálogo entra al tope de la pila; al cerrar (o desmontar), sale. La función
// de cierre se guarda en un ref que se actualiza en cada render, así el cierre siempre usa el estado
// más reciente sin re-registrar la entrada (el orden de la pila se conserva).
export function useDialogEscape(active: boolean, close: () => void): void {
  const closeRef = useRef(close);

  // Mantenemos el ref al día en un efecto (no en el cuerpo del render, que debe ser puro).
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    if (!active) {
      return;
    }
    // La entrada delega en el ref: siempre cierra con la última versión de la función.
    const entry: DialogEntry = { close: () => closeRef.current() };
    dialogStack.push(entry);
    // El primer diálogo abierto instala el listener global (captura: gana a listeners de burbuja).
    if (dialogStack.length === 1) {
      window.addEventListener("keydown", handleWindowKeydown, true);
    }
    return () => {
      const index = dialogStack.indexOf(entry);
      if (index !== -1) {
        dialogStack.splice(index, 1);
      }
      // El último diálogo en cerrarse retira el listener global (no queda nada escuchando).
      if (dialogStack.length === 0) {
        window.removeEventListener("keydown", handleWindowKeydown, true);
      }
    };
  }, [active]);
}
