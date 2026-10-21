"use client";

// Archivo: use-drag-scroll.ts — Arrastrar con el dedo o el ratón para recorrer una tira horizontal.
//
// En español: la línea de tiempo de escritorio y el carrusel de sagas comparten un mismo gesto —
// "agarrar y tirar" para moverse de lado, con inercia al soltar y con la ilusión de que la tira no
// tiene principio ni fin. Ese comportamiento estaba escrito DOS VECES, casi idéntico, en dos
// componentes distintos. Duplicar una mecánica así es caro de dos maneras: cualquier arreglo hay que
// hacerlo dos veces (y es fácil olvidar la segunda), y con el tiempo las dos copias se desajustan
// entre sí, de modo que el mismo gesto se siente distinto en cada sitio sin motivo aparente.
//
// Este hook es la ÚNICA implementación del gesto. Resuelve cinco cosas:
//
//  1. ARRASTRE INCREMENTAL: cada evento mueve la tira por su diferencia respecto al anterior, no por
//     una posición absoluta. Es lo que permite que el "bucle infinito" reubique el scroll a mitad del
//     gesto sin que el arrastre dé un salto.
//
//  2. BUCLE INFINITO: la tira contiene tres copias idénticas del contenido. Mientras te mueves, el
//     scroll se reubica siempre a la copia central. Como las tres son iguales, el salto es invisible
//     y la tira parece no acabarse nunca.
//
//  3. INERCIA: al soltar tras un gesto rápido, la tira sigue avanzando y frena poco a poco. La
//     desaceleración se escala por el tiempo real entre fotogramas, así que se siente igual en una
//     pantalla de 60 Hz que en una de 120 Hz (si no, en las rápidas frenaría al doble de velocidad).
//
//  4. NO ABRIR NADA AL SOLTAR: si el gesto movió la tira, el clic con el que termina NO debe abrir lo
//     que hubiera debajo del dedo. Sin esto, cada arrastre acabaría abriendo una ficha por error.
//
//  5. GESTOS QUE SE INTERRUMPEN: en una pantalla táctil el navegador puede quedarse el gesto a mitad
//     (decide que el dedo está desplazando la página, entra una llamada, el dedo sale del cristal).
//     Cuando eso pasa NO llega ningún "soltar", solo un aviso de cancelación. El hook lo atiende y
//     deja la tira en reposo; además, en cuanto confirma que hay arrastre le pide al navegador la
//     "captura" del dedo, que garantiza que el final del gesto nos llegue siempre.
//
// Accesibilidad: quien pidió menos movimiento no recibe inercia. El arrastre en sí se conserva porque
// es una acción directa del usuario, no una animación que ocurre sola.

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

// MOVEMENT_THRESHOLD_PX es cuánto hay que mover el dedo para considerar que fue un ARRASTRE y no un
// toque. Por debajo de este umbral, un temblor de la mano no debe impedir que se abra lo que se tocó.
const MOVEMENT_THRESHOLD_PX = 2;

// MOMENTUM_MIN_VELOCITY es la velocidad mínima al soltar para que haya inercia. Soltar despacio debe
// dejar la tira quieta donde está, no lanzarla.
const MOMENTUM_MIN_VELOCITY = 2;

// MOMENTUM_STOP_VELOCITY es la velocidad por debajo de la cual la inercia se considera terminada.
const MOMENTUM_STOP_VELOCITY = 0.6;

// MOMENTUM_DECAY_PER_FRAME es cuánta velocidad conserva la tira en cada fotograma de 60 Hz (0.82 =
// pierde un 18%). Con este valor la tira sigue un poco al soltar y se detiene en torno a un cuarto de
// segundo: lo suficiente para sentirse física, sin que siga derivando cuando ya quieres pulsar algo.
const MOMENTUM_DECAY_PER_FRAME = 0.82;

// FRAME_MS es la duración de un fotograma a 60 Hz, la referencia para escalar el decaimiento.
const FRAME_MS = 1000 / 60;

// DragScrollHandlers son los manejadores que el componente debe colocar en su contenedor.
export type DragScrollHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  // onPointerCancel atiende el caso en que el NAVEGADOR se queda el gesto y deja de mandárnoslo.
  // En español: en una pantalla táctil, si el sistema decide a mitad del gesto que lo que la persona
  // está haciendo es desplazar la página hacia abajo (o aparece una llamada, o el dedo sale del
  // cristal), el navegador CANCELA el gesto: no habrá "pointerup" nunca. Sin atender esta cancelación
  // el arrastre se quedaba marcado como activo para siempre, y a partir de ahí cualquier movimiento
  // del dedo por encima de la tira la movía sin haberla agarrado, y el siguiente toque no abría nada
  // (se interpretaba como el final de aquel arrastre eterno). Solo se recuperaba recargando.
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
};

// UseDragScrollResult es lo que el hook entrega al componente.
export type UseDragScrollResult = {
  // handlers se reparten sobre el contenedor desplazable.
  handlers: DragScrollHandlers;
  // wrapScroll reubica el scroll en la copia central. El componente lo llama también desde su propio
  // oyente de scroll, para que el bucle funcione con la rueda del ratón y con el teclado.
  wrapScroll: () => void;
  // shouldSuppressClick indica si el clic que acaba de ocurrir viene de un arrastre y debe ignorarse.
  // Consume la marca al leerla: solo se ignora UN clic por gesto.
  shouldSuppressClick: () => boolean;
};

// UseDragScrollOptions permite ajustar el comportamiento sin tocar el hook.
export type UseDragScrollOptions = {
  // copies es en cuántas copias idénticas está repetido el contenido (3 en los dos carruseles).
  // Si vale 1, no hay bucle: el contenido es único y el scroll se comporta de forma normal.
  copies?: number;
};

// prefersReducedMotion consulta si la persona pidió reducir el movimiento en su sistema operativo.
//
// En español: esta comprobación vive DENTRO del hook a propósito. Antes cada carrusel decidía por su
// cuenta si aplicaba inercia, y el resultado fue el previsible: la línea de tiempo la respetaba y el
// carrusel de sagas no, así que la misma preferencia se cumplía en una parte de la app y se ignoraba
// en otra. Al decidirlo aquí, el gesto se comporta igual en todas partes por construcción.
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// capturePointer pide al navegador que TODOS los eventos de este dedo/cursor lleguen al elemento
// agarrado hasta que se suelte, aunque se salga de él.
//
// En español: sin esto, arrastrar rápido y sacar el cursor fuera de la tira (o del navegador) hacía
// que el "soltar" se perdiera: el elemento no recibía el evento y el arrastre quedaba a medias. Con
// la captura, el navegador nos garantiza el final del gesto —sea "pointerup" o "pointercancel"—
// siempre en el mismo sitio. Es también lo que hace que la cancelación táctil llegue de verdad.
//
// La operación puede fallar legítimamente (el dedo ya se levantó entre el evento y esta llamada, o
// el entorno no implementa la captura, como el navegador simulado de las pruebas). No es un error
// que deba interrumpir nada: sin captura el gesto sigue funcionando como antes, solo pierde la
// garantía. Por eso se comprueba y se atrapa, y se devuelve si se logró o no.
function capturePointer(element: HTMLElement, pointerId: number): boolean {
  if (typeof element.setPointerCapture !== "function") {
    return false;
  }
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch {
    // El puntero ya no está activo: no hay nada que capturar y el gesto terminará por su cuenta.
    return false;
  }
}

// releasePointer devuelve la captura al terminar el gesto. Si no se soltara, el elemento seguiría
// recibiendo eventos de ese dedo/cursor y el resto de la página dejaría de responder al puntero.
function releasePointer(element: HTMLElement, pointerId: number): void {
  if (typeof element.releasePointerCapture !== "function") {
    return;
  }
  if (typeof element.hasPointerCapture === "function" && !element.hasPointerCapture(pointerId)) {
    // Ya no la teníamos (el navegador la soltó solo al cancelar): no hay nada que hacer.
    return;
  }
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    // El puntero ya no existe (el gesto terminó antes): la captura murió con él, nada que liberar.
  }
}

// useDragScroll conecta el gesto de arrastre a un contenedor desplazable.
export function useDragScroll(
  containerRef: RefObject<HTMLElement | null>,
  options: UseDragScrollOptions,
): UseDragScrollResult {
  const { copies = 3 } = options;

  // El estado del gesto vive en una referencia, no en el estado de React: cambia decenas de veces por
  // segundo y volver a dibujar en cada movimiento haría el arrastre lento y a trompicones.
  // pointerId identifica QUÉ dedo/cursor está arrastrando (en una pantalla táctil puede haber varios
  // a la vez) y captureTarget es el elemento que se quedó con su captura, para poder devolverla.
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    lastX: number;
    velocity: number;
    pointerId: number | null;
    captureTarget: HTMLElement | null;
  }>({ active: false, moved: false, lastX: 0, velocity: 0, pointerId: null, captureTarget: null });
  // Identificador de la animación de inercia en curso, para poder cancelarla.
  const momentumRef = useRef<number | null>(null);
  // Marca de "ignora el próximo clic" (ver punto 4 de la explicación de arriba).
  const suppressClickRef = useRef(false);

  // wrapScroll mantiene el scroll dentro de la copia CENTRAL del contenido repetido.
  const wrapScroll = useCallback(() => {
    const container = containerRef.current;
    if (container === null || copies < 2) {
      return;
    }
    const copyWidth = container.scrollWidth / copies;
    if (copyWidth <= 0) {
      return;
    }
    // Si entras en la copia de la izquierda, se suma el ancho de una copia; si entras en la de la
    // derecha, se resta. Como las copias son idénticas, el contenido visible no cambia.
    if (container.scrollLeft < copyWidth) {
      container.scrollLeft += copyWidth;
    } else if (container.scrollLeft >= copyWidth * (copies - 1)) {
      container.scrollLeft -= copyWidth;
    }
  }, [containerRef, copies]);

  // stopMomentum corta la inercia en curso (al volver a tocar la tira, o al desmontar).
  const stopMomentum = useCallback(() => {
    if (momentumRef.current !== null) {
      cancelAnimationFrame(momentumRef.current);
      momentumRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // Solo el botón principal (o un toque/lápiz): un clic derecho no debe arrastrar.
      if (event.button !== 0) {
        return;
      }
      if (containerRef.current === null) {
        return;
      }
      // Volver a tocar corta la inercia: la tira queda "agarrada" al instante, como un objeto real.
      stopMomentum();
      // La marca de ignorar clic se limpia al EMPEZAR cada gesto. Si no, la que dejó un arrastre
      // anterior se comería el primer clic del gesto siguiente (arrastrar y luego pulsar algo).
      suppressClickRef.current = false;
      // Aquí se anota QUÉ dedo/cursor manda en el gesto, pero todavía NO se pide su captura: eso
      // ocurre en cuanto se confirme que la persona está arrastrando (ver onPointerMove). Pedirla ya
      // en el primer contacto tendría un efecto indeseado: mientras un elemento tiene capturado el
      // puntero, el navegador le dirige a ÉL el clic final, así que un simple toque sobre un póster
      // dejaría de abrir su ficha. Esperando al primer movimiento real, los toques siguen llegando a
      // la tarjeta que se tocó y solo los arrastres —cuyo clic final queremos ignorar de todos
      // modos— pasan por la captura.
      dragRef.current = {
        active: true,
        moved: false,
        lastX: event.clientX,
        velocity: 0,
        pointerId: event.pointerId,
        captureTarget: null,
      };
    },
    [containerRef, stopMomentum],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const container = containerRef.current;
      if (!drag.active || container === null) {
        return;
      }
      // Solo hace caso al dedo/cursor que inició el gesto: con un segundo dedo en la pantalla, sus
      // movimientos entrarían por aquí y la tira daría saltos entre dos posiciones distintas.
      if (drag.pointerId !== null && event.pointerId !== drag.pointerId) {
        return;
      }
      const deltaX = event.clientX - drag.lastX;
      drag.lastX = event.clientX;
      drag.velocity = deltaX;
      if (Math.abs(deltaX) > MOVEMENT_THRESHOLD_PX) {
        drag.moved = true;
        // Confirmado que esto es un ARRASTRE y no un toque: ahora sí nos quedamos con el puntero.
        // A partir de aquí el navegador nos entrega todos sus eventos —incluido el final, sea
        // "soltar" o "cancelar"— aunque el dedo se salga de la tira o de la propia ventana. Es lo
        // que evita que un gesto se quede a medias y la tira siga creyéndose agarrada.
        if (drag.captureTarget === null) {
          const target = event.currentTarget;
          if (capturePointer(target, event.pointerId)) {
            drag.captureTarget = target;
          }
        }
      }
      // Al mover el cursor a la derecha, el contenido lo sigue: es el gesto de "agarrar y tirar".
      container.scrollLeft -= deltaX;
      wrapScroll();
    },
    [containerRef, wrapScroll],
  );

  // releaseCurrentPointer devuelve la captura del gesto en curso y olvida a quién pertenecía.
  // Se llama tanto al soltar como al cancelar: en los dos casos el gesto terminó.
  const releaseCurrentPointer = useCallback(() => {
    const drag = dragRef.current;
    if (drag.captureTarget !== null && drag.pointerId !== null) {
      releasePointer(drag.captureTarget, drag.pointerId);
    }
    drag.captureTarget = null;
    drag.pointerId = null;
  }, []);

  // cancelDrag corta el gesto EN SECO: el navegador se lo ha quedado (por ejemplo, ha decidido que
  // el dedo está desplazando la página en vertical) y ya no habrá "soltar".
  //
  // Se diferencia de terminar normalmente en dos cosas, y las dos importan:
  //   - NO hay inercia: la persona no ha soltado la tira, se la han quitado de la mano; lanzarla
  //     sola después sería un movimiento que nadie pidió.
  //   - NO se marca "ignora el próximo clic": tras una cancelación no llega ningún clic, así que esa
  //     marca se quedaría esperando y se comería el SIGUIENTE toque de verdad (el primer intento de
  //     abrir una ficha después de haber hecho scroll no haría nada, sin explicación posible).
  const cancelDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag.active) {
        return;
      }
      if (drag.pointerId !== null && event.pointerId !== drag.pointerId) {
        return;
      }
      releaseCurrentPointer();
      drag.active = false;
      drag.moved = false;
      drag.velocity = 0;
      suppressClickRef.current = false;
      stopMomentum();
    },
    [releaseCurrentPointer, stopMomentum],
  );

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag.active) {
      return;
    }
    releaseCurrentPointer();
    drag.active = false;
    if (drag.moved) {
      suppressClickRef.current = true;
    }

    // La inercia solo se lanza si hubo un gesto con velocidad Y la persona no pidió menos movimiento.
    const wantsMomentum =
      drag.moved && Math.abs(drag.velocity) > MOMENTUM_MIN_VELOCITY && !prefersReducedMotion();
    if (!wantsMomentum) {
      return;
    }

    let velocity = drag.velocity;
    let lastTimestamp: number | null = null;
    const step = (timestamp: number) => {
      const container = containerRef.current;
      if (container === null) {
        momentumRef.current = null;
        return;
      }
      // Cuántos "fotogramas de 60 Hz" han pasado de verdad. Escalar por esto hace que la inercia se
      // sienta igual en cualquier pantalla, en vez de morir al doble de rápido en las de 120 Hz.
      const frames = lastTimestamp === null ? 1 : (timestamp - lastTimestamp) / FRAME_MS;
      lastTimestamp = timestamp;

      container.scrollLeft -= velocity * frames;
      wrapScroll();

      velocity *= Math.pow(MOMENTUM_DECAY_PER_FRAME, frames);
      momentumRef.current =
        Math.abs(velocity) > MOMENTUM_STOP_VELOCITY ? requestAnimationFrame(step) : null;
    };
    momentumRef.current = requestAnimationFrame(step);
  }, [containerRef, releaseCurrentPointer, wrapScroll]);

  // Al desmontar se cancela cualquier inercia pendiente: una animación que sigue viva tras
  // desaparecer su componente es una fuga silenciosa de trabajo.
  useEffect(() => stopMomentum, [stopMomentum]);

  // shouldSuppressClick consume la marca: se ignora UN solo clic por gesto de arrastre.
  const shouldSuppressClick = useCallback(() => {
    if (!suppressClickRef.current) {
      return false;
    }
    suppressClickRef.current = false;
    return true;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      // "Salir del elemento" ya casi nunca ocurre durante el arrastre porque tenemos la captura del
      // puntero, pero se mantiene como red de seguridad para los entornos que no la implementan.
      onPointerLeave: endDrag,
      onPointerCancel: cancelDrag,
    },
    wrapScroll,
    shouldSuppressClick,
  };
}
