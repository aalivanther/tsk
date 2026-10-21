"use client";

// Archivo: use-view-transition.ts — Navegar con la transición animada del navegador.
//
// En español: la API de View Transitions permite que, al cambiar de pantalla, el navegador anime la
// diferencia entre el antes y el después en lugar de sustituir una vista por otra de golpe. Es el
// mismo efecto que hace que una app nativa se sienta continua: tocas un póster y ese póster crece
// hasta ocupar la ficha, en vez de aparecer una pantalla nueva sin relación con lo que tocaste.
//
// Cómo funciona el reparto de trabajo:
//   - El CSS (globals.css) declara qué elemento es "el mismo" en las dos vistas, dándole un nombre
//     de transición. Eso es lo único que el navegador necesita para calcular el recorrido.
//   - Este hook se limita a envolver la navegación para avisar al navegador de que el cambio que
//     viene debe animarse.
//
// Es una MEJORA PROGRESIVA estricta: si el navegador no soporta la API (o el usuario pidió menos
// movimiento), se navega igual, sin animación y sin ningún error. Nunca se bloquea una navegación
// por culpa de un efecto visual.

import { useRouter } from "next/navigation";
import { useCallback } from "react";

// DocumentWithViewTransition describe la parte de document que usamos, sin recurrir a "any".
// En español: startViewTransition todavía no está en los tipos estándar de TypeScript, así que se
// declara aquí de forma acotada y honesta en lugar de silenciar el tipado.
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

// prefersReducedMotion indica si el usuario pidió reducir el movimiento en su sistema.
// En español: quien lo pide suele hacerlo por mareos o sensibilidad vestibular; una transición que
// desplaza y escala elementos es justo lo que le molesta, así que se omite por completo.
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// useViewTransitionRouter devuelve una función para navegar con transición animada cuando se puede.
export function useViewTransitionRouter(): (href: string) => void {
  const router = useRouter();

  return useCallback(
    (href: string) => {
      const documentWithTransition = document as DocumentWithViewTransition;

      // Sin soporte del navegador o con "menos movimiento": navegación normal, sin animación.
      if (
        typeof documentWithTransition.startViewTransition !== "function" ||
        prefersReducedMotion()
      ) {
        router.push(href);
        return;
      }

      // Con soporte: se le entrega al navegador el cambio a realizar y él anima la diferencia.
      documentWithTransition.startViewTransition(() => {
        router.push(href);
      });
    },
    [router],
  );
}
