"use client";

// Archivo: use-is-mobile.ts — Detecta si estamos en una pantalla de MÓVIL para elegir la navegación.
//
// En español: The Story Keeper tiene DOS formas de presentar el catálogo, no una encogida:
//   - En escritorio, la ESPINA horizontal arrastrable (la firma visual del producto).
//   - En móvil, una AGENDA vertical (la espina rotada 90°), porque una cinta horizontal obliga a
//     arrastrar de lado para descubrir contenido y en pantallas estrechas eso esconde casi todo.
// Este hook decide cuál montar. Solo se monta UNA de las dos: renderizar ambas y ocultar una con CSS
// duplicaría cientos de nodos del DOM (la línea de tiempo es la parte más pesada de la app).
//
// SSR: en el servidor no existe window, así que arrancamos en "no móvil" (el valor que ya usaba la
// app) y corregimos en el primer efecto del navegador. Se expone `resolved` para que quien lo use
// pueda evitar pintar una vista equivocada durante ese primer instante.

import { useEffect, useState } from "react";

// MOBILE_BREAKPOINT es el ancho por debajo del cual mandamos la navegación móvil dedicada.
// En español: 768px es el corte habitual entre teléfono y tableta; coincide con el punto en el que
// la espina horizontal deja de tener sitio para mostrar más de un par de estaciones a la vez.
export const MOBILE_BREAKPOINT = 768;

// UseIsMobileResult indica si la pantalla es de móvil y si esa respuesta ya se pudo medir de verdad.
export type UseIsMobileResult = {
  // isMobile es true cuando el ancho de la ventana está por debajo del punto de corte.
  isMobile: boolean;
  // resolved es false durante el render del servidor y el primer render del navegador (aún no se ha
  // medido nada); pasa a true en cuanto se consulta la media query real.
  resolved: boolean;
};

// useIsMobile observa el ancho de la ventana y avisa cuando cruza el punto de corte.
export function useIsMobile(): UseIsMobileResult {
  const [state, setState] = useState<UseIsMobileResult>({ isMobile: false, resolved: false });

  useEffect(() => {
    // matchMedia notifica SOLO cuando se cruza el umbral, no en cada píxel de redimensionado: es
    // mucho más barato que escuchar el evento resize.
    const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);

    const apply = (matches: boolean) => {
      // Solo actualizamos si algo cambió de verdad, para no provocar renders inútiles.
      setState((previous) =>
        previous.isMobile === matches && previous.resolved
          ? previous
          : { isMobile: matches, resolved: true },
      );
    };

    apply(query.matches);
    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  return state;
}
