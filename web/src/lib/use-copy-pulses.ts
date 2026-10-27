"use client";

// Archivo: use-copy-pulses.ts — Los pulsos de HOY de la línea de tiempo: en fase en las tres copias y
// quietos cuando quedan lejos de la vista.
//
// En español: la línea de tiempo se dibuja tres veces para el bucle infinito, y en cada copia laten la
// aguja de HOY y la caja del día de hoy (un resplandor que crece y mengua). Ese resplandor se anima
// con box-shadow, que obliga a repintar en cada fotograma, y lo hacían las tres copias aunque como
// mucho una se vea. Este hook hace dos cosas, sin cambiar cómo se ve nada:
//
//  1. EN FASE. Dos de las tres copias se montan en el navegador un instante después que la que llega
//     del servidor (ver Timeline), así que sus pulsos arrancarían más tarde. Cuando el bucle salta de
//     una copia a otra, el resplandor daría un brinco. Se les pone la hora de inicio de la copia que
//     llegó del servidor (la más antigua): laten exactamente igual que cuando las tres salían del
//     servidor a la vez.
//  2. QUIETOS LEJOS DE LA VISTA. Un pulso que queda a más de una pantalla de lo visible se pausa, y al
//     acercarse se reanuda con su hora de inicio original: retoma justo donde estaría si nunca se
//     hubiera parado, y lo hace antes de entrar en la vista.
//
// Si el navegador no expone las animaciones CSS por JavaScript (getAnimations), no se toca nada.

import { useEffect, type RefObject } from "react";

// Los elementos que laten con box-shadow (globals.css: tlx-needle-pulse y tlx-today-pulse).
const PULSE_SELECTOR = ".tlx-needle-knob, .tlx-daybox-today";

// Distancia (en anchos de la espina, a cada lado) a la que un pulso se reanuda antes de verse.
const RESUME_MARGIN = "0px 100%";

function pulsesOf(element: Element): CSSAnimation[] {
  return element
    .getAnimations()
    .filter((animation): animation is CSSAnimation => animation instanceof CSSAnimation);
}

export function useCopyPulses(containerRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const container = containerRef.current;
    if (
      !enabled ||
      container === null ||
      typeof container.getAnimations !== "function" ||
      typeof CSSAnimation === "undefined" ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const targets = [...container.querySelectorAll<HTMLElement>(PULSE_SELECTOR)];
    const allPulses = targets.flatMap(pulsesOf);
    if (allPulses.length === 0) {
      // Sin animación (movimiento reducido): nada que alinear ni pausar.
      return;
    }

    let cancelled = false;
    let observer: IntersectionObserver | null = null;
    // Hora de inicio de cada pulso, por nombre de animación: la del que arrancó primero.
    const startByName = new Map<string, number>();
    const align = (animation: CSSAnimation) => {
      const start = startByName.get(animation.animationName);
      if (start !== undefined) {
        animation.startTime = start;
      }
    };

    // Se espera a que todos hayan arrancado (tienen hora de inicio).
    void Promise.all(allPulses.map((animation) => animation.ready))
      .then(() => {
        if (cancelled) {
          return;
        }
        for (const animation of allPulses) {
          const start = Number(animation.startTime);
          const known = startByName.get(animation.animationName);
          if (animation.startTime !== null && (known === undefined || start < known)) {
            startByName.set(animation.animationName, start);
          }
        }
        for (const target of targets) {
          pulsesOf(target).forEach(align);
        }
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              for (const animation of pulsesOf(entry.target)) {
                if (entry.isIntersecting) {
                  align(animation);
                } else {
                  animation.pause();
                }
              }
            }
          },
          { root: container, rootMargin: RESUME_MARGIN },
        );
        for (const target of targets) {
          observer.observe(target);
        }
      })
      .catch(() => {
        // Una animación cancelada (p. ej. se activó "reducir movimiento"): no hay nada que hacer.
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      // Al desmontar, lo que quede en pantalla vuelve a latir en fase.
      for (const target of targets) {
        if (target.isConnected) {
          pulsesOf(target).forEach(align);
        }
      }
    };
  }, [containerRef, enabled]);
}
