// Archivo: particle-worker.ts — El polvo dorado del fondo, pintado en un hilo aparte.
//
// En español: las 150–240 motas se estampan en cada fotograma. En el hilo principal eso compite con
// todo lo demás (arrastrar la línea de tiempo, abrir una ficha), y en un equipo modesto se nota. Aquí
// se hace lo mismo —el mismo motor (particle-field.ts), las mismas cuentas, el mismo dibujo— sobre un
// OffscreenCanvas que el navegador compone en la página sin pasar por el hilo principal. ParticleCanvas
// decide si se usa este camino o el de siempre (si el navegador no lo permite, nada cambia).

import {
  advanceParticleField,
  applyParticleCanvasSize,
  createParticleField,
  createParticleSprite,
  drawParticleField,
  type ParticleTone,
} from "./particle-field";

export type ParticleWorkerMessage =
  | {
      type: "start";
      canvas: OffscreenCanvas;
      particleCount: number;
      tone: ParticleTone;
      cssWidth: number;
      cssHeight: number;
      devicePixelRatio: number;
    }
  | { type: "resize"; cssWidth: number; cssHeight: number; devicePixelRatio: number };

// "unsupported" avisa a la página de que este navegador no puede pintar aquí (sin fotogramas en
// hilos aparte o sin lienzo 2D): la página vuelve al camino de siempre.
export type ParticleWorkerReply = { type: "unsupported" };

const MILLISECONDS_PER_SECOND = 1000;

// Lo que se usa del ámbito del worker (el proyecto compila con los tipos del navegador, no del worker).
type WorkerScope = {
  onmessage: ((event: MessageEvent<ParticleWorkerMessage>) => void) | null;
  postMessage: (message: ParticleWorkerReply) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
};

const scope = self as unknown as WorkerScope;
let canvas: OffscreenCanvas | null = null;
let pixelRatio = 1;

scope.onmessage = (event: MessageEvent<ParticleWorkerMessage>) => {
  const message = event.data;
  if (message.type === "resize") {
    if (canvas !== null) {
      pixelRatio = applyParticleCanvasSize(
        canvas,
        message.cssWidth,
        message.cssHeight,
        message.devicePixelRatio,
      );
    }
    return;
  }

  const context = message.canvas.getContext("2d");
  const sprite = createParticleSprite(message.tone, () => new OffscreenCanvas(1, 1));
  if (context === null || sprite === null || typeof scope.requestAnimationFrame !== "function") {
    scope.postMessage({ type: "unsupported" } satisfies ParticleWorkerReply);
    return;
  }
  canvas = message.canvas;
  const drawingContext = context;
  const tone = message.tone;
  const field = createParticleField(message.particleCount);
  pixelRatio = applyParticleCanvasSize(
    canvas,
    message.cssWidth,
    message.cssHeight,
    message.devicePixelRatio,
  );
  let rotationRadians = 0;
  let previousTimestamp: number | null = null;
  const requestFrame = scope.requestAnimationFrame.bind(scope);
  const renderFrame = (timestamp: number) => {
    requestFrame(renderFrame);
    const elapsedSeconds =
      previousTimestamp === null ? 0 : (timestamp - previousTimestamp) / MILLISECONDS_PER_SECOND;
    previousTimestamp = timestamp;
    rotationRadians += advanceParticleField(field, elapsedSeconds);
    drawParticleField(drawingContext, sprite, field, tone, rotationRadians, pixelRatio);
  };
  requestFrame(renderFrame);
};
