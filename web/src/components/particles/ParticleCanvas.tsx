"use client";

// Archivo: ParticleCanvas.tsx — El LIENZO donde flota el polvo dorado del fondo.
//
// En español: pone un lienzo de dibujo a pantalla completa, transparente, y le pide al motor
// (particle-field.ts) que pinte las motas fotograma a fotograma. Es puramente decorativo: va detrás
// del contenido, no captura clics y el contenedor que lo envuelve ya está marcado como "invisible"
// para los lectores de pantalla.
//
// Antes esto era un lienzo 3D con three.js. Se cambió a un lienzo de dos dimensiones porque el efecto
// —motas con degradado circular y luz que se suma— no necesita una librería de gráficos 3D, y esa
// librería costaba 883.511 bytes de descarga en cada visita de escritorio. El resultado en pantalla
// es el mismo; lo que desaparece es el peso.
//
// Accesibilidad (regla §12): quien pidió "menos movimiento" NUNCA llega hasta aquí. Es SceneBackground
// quien decide no montar este componente en ese caso, igual que hacía con la versión 3D.

import { useEffect, useRef, useState } from "react";

import {
  advanceParticleField,
  createParticleField,
  createParticleSprite,
  drawParticleField,
  resizeParticleCanvas,
  type ParticleTone,
} from "./particle-field";
import type { ParticleWorkerMessage, ParticleWorkerReply } from "./particle-worker";

// ParticleCanvasProps: cuántas motas dibujar (lo decide el contenedor según el tamaño de pantalla) y
// su paleta (según el tema: oro en oscuro, azul metálico en claro).
type ParticleCanvasProps = {
  particleCount: number;
  tone: ParticleTone;
};

// MILLISECONDS_PER_SECOND convierte el reloj del navegador (que cuenta en milisegundos) a los segundos
// en los que están expresadas las velocidades del campo.
const MILLISECONDS_PER_SECOND = 1000;

// canPaintOffThread dice si este navegador puede pintar el polvo en un hilo aparte: hace falta poder
// ceder el lienzo a un worker (transferControlToOffscreen). Si además el worker no tiene fotogramas
// propios, él mismo lo avisa y se vuelve al camino de siempre.
function canPaintOffThread(): boolean {
  return (
    typeof Worker === "function" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function"
  );
}

export default function ParticleCanvas({ particleCount, tone }: ParticleCanvasProps) {
  // Referencia al elemento del lienzo: el dibujo se hace fuera de React, con el pincel del navegador.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // DÓNDE SE PINTA. En un hilo aparte (worker) si el navegador lo permite: el polvo deja de competir
  // con el hilo principal, que es el que mueve la línea de tiempo y responde a los clics. Si no, o si
  // el worker falla, en el hilo principal como siempre. El dibujo es el mismo en los dos casos.
  const [offThread, setOffThread] = useState(canPaintOffThread);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !offThread) {
      return;
    }
    let worker: Worker;
    let offscreen: OffscreenCanvas;
    try {
      worker = new Worker(new URL("./particle-worker.ts", import.meta.url), { type: "module" });
      offscreen = canvas.transferControlToOffscreen();
    } catch {
      // El navegador no deja crear el worker o ceder el lienzo: se vuelve al camino de siempre (en el
      // siguiente ciclo, con un lienzo nuevo; este ya no sirve si llegó a cederse).
      queueMicrotask(() => setOffThread(false));
      return;
    }
    const fallBack = () => {
      worker.terminate();
      setOffThread(false);
    };
    worker.onerror = fallBack;
    worker.onmessage = (event: MessageEvent<ParticleWorkerReply>) => {
      if (event.data.type === "unsupported") {
        fallBack();
      }
    };
    const start: ParticleWorkerMessage = {
      type: "start",
      canvas: offscreen,
      particleCount,
      tone,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
    worker.postMessage(start, [offscreen]);
    // Mismo vigilante de tamaño que el camino de siempre (ver más abajo); el worker no ve la página.
    const observer = new ResizeObserver(() => {
      const resize: ParticleWorkerMessage = {
        type: "resize",
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      };
      worker.postMessage(resize);
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      worker.terminate();
    };
  }, [offThread, particleCount, tone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || offThread) {
      return;
    }
    const context = canvas.getContext("2d");
    const sprite = createParticleSprite(tone);
    // Sin pincel de dos dimensiones no hay fondo decorativo. No es un error que haya que avisar: la
    // página entera funciona igual, simplemente sin polvo. Se sale sin montar la animación.
    if (context === null || sprite === null) {
      return;
    }

    const field = createParticleField(particleCount);
    let pixelRatio = resizeParticleCanvas(canvas);
    let rotationRadians = 0;
    let previousTimestamp: number | null = null;
    let frameHandle = 0;

    // El lienzo mide el 100% de su contenedor (regla de globals.css), así que su tamaño en píxeles
    // cambia cuando cambia la ventana. Se vigila con un observador en vez de con el evento "resize"
    // porque así también se cubren los cambios que no vienen de la ventana (barras que aparecen, etc.).
    const observer = new ResizeObserver(() => {
      pixelRatio = resizeParticleCanvas(canvas);
    });
    observer.observe(canvas);

    // Bucle de dibujo: el navegador avisa cuando va a pintar el siguiente fotograma y aprovechamos ese
    // momento. Cuando la pestaña está oculta el navegador deja de avisar, así que el polvo no gasta
    // batería de fondo.
    const renderFrame = (timestamp: number) => {
      frameHandle = window.requestAnimationFrame(renderFrame);
      const elapsedSeconds =
        previousTimestamp === null ? 0 : (timestamp - previousTimestamp) / MILLISECONDS_PER_SECOND;
      previousTimestamp = timestamp;
      rotationRadians += advanceParticleField(field, elapsedSeconds);
      drawParticleField(context, sprite, field, tone, rotationRadians, pixelRatio);
    };
    frameHandle = window.requestAnimationFrame(renderFrame);

    // Limpieza al desmontar o al cambiar de tema/densidad: se corta el bucle y se deja de observar.
    // Sin esto quedaría una animación viva dibujando sobre un lienzo que ya no está en la página.
    return () => {
      window.cancelAnimationFrame(frameHandle);
      observer.disconnect();
    };
  }, [offThread, particleCount, tone]);

  // aria-hidden en el PROPIO lienzo, no solo en el contenedor: un lienzo es, para un lector de
  // pantalla, un elemento gráfico sin nombre, y aquí no hay nada que anunciar porque no dibuja
  // información — son motas de polvo. Marcarlo aquí también lo deja fuera del recorrido aunque algún
  // día se use este componente sin el contenedor que hoy lo envuelve.
  //
  // La key cambia con todo lo que reinicia el dibujo: un lienzo cedido a un worker ya no se puede
  // volver a ceder ni pintar desde aquí, así que cada reinicio (o la vuelta al hilo principal) usa un
  // lienzo nuevo.
  return (
    <canvas
      key={`${offThread ? "worker" : "main"}-${particleCount}-${tone}`}
      ref={canvasRef}
      className="tlx-dust-canvas"
      aria-hidden="true"
    />
  );
}
