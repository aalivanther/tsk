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

import { useEffect, useRef } from "react";

import {
  advanceParticleField,
  createParticleField,
  createParticleSprite,
  drawParticleField,
  resizeParticleCanvas,
  type ParticleTone,
} from "./particle-field";

// ParticleCanvasProps: cuántas motas dibujar (lo decide el contenedor según el tamaño de pantalla) y
// su paleta (según el tema: oro en oscuro, azul metálico en claro).
type ParticleCanvasProps = {
  particleCount: number;
  tone: ParticleTone;
};

// MILLISECONDS_PER_SECOND convierte el reloj del navegador (que cuenta en milisegundos) a los segundos
// en los que están expresadas las velocidades del campo.
const MILLISECONDS_PER_SECOND = 1000;

export default function ParticleCanvas({ particleCount, tone }: ParticleCanvasProps) {
  // Referencia al elemento del lienzo: el dibujo se hace fuera de React, con el pincel del navegador.
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
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
  }, [particleCount, tone]);

  // aria-hidden en el PROPIO lienzo, no solo en el contenedor: un lienzo es, para un lector de
  // pantalla, un elemento gráfico sin nombre, y aquí no hay nada que anunciar porque no dibuja
  // información — son motas de polvo. Marcarlo aquí también lo deja fuera del recorrido aunque algún
  // día se use este componente sin el contenedor que hoy lo envuelve.
  return <canvas ref={canvasRef} className="tlx-dust-canvas" aria-hidden="true" />;
}
