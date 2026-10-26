// Archivo: particle-field.ts — El MOTOR del polvo dorado: cuentas y dibujo, sin nada de React.
//
// En español: detrás del contenido flotan unas cuantas motas de polvo, como el que se ve en el haz de
// un proyector de cine. Este archivo contiene TODA la matemática de ese efecto: dónde nace cada mota,
// cómo sube, cómo se calcula el sitio y el tamaño con que se ve en pantalla, y cómo se pinta.
//
// POR QUÉ EXISTE ESTE ARCHIVO (decisión registrada). El efecto se dibujaba antes con three.js
// (una librería de gráficos en tres dimensiones). Medido: three.js + react-three-fiber pesaban
// 883.511 bytes sin comprimir (233.670 comprimidos) y se descargaban en TODA pantalla de escritorio.
// Lo único que se dibujaba con ellos eran motas de polvo: puntos con un degradado circular y mezcla
// "de luz que se suma". Las dos cosas existen en un lienzo de dos dimensiones, que todo navegador
// trae de fábrica y no cuesta ni un byte de descarga. Se reimplantó aquí conservando exactamente el
// mismo número de motas, los mismos colores, el mismo movimiento y el mismo tamaño en pantalla: las
// cuentas de abajo son, una por una, las que hacía la librería.
//
// Este archivo NO habla con el navegador por su cuenta: recibe el "pincel" (el contexto del lienzo) y
// dibuja. Así la parte que hace cuentas se puede leer y razonar sin mezclarla con el ciclo de vida de
// un componente.

// ParticleTone es la PALETA de las motas según el tema.
//   - "gold": polvo dorado con mezcla ADITIVA (brilla sobre el fondo OSCURO del tema cine).
//   - "blue": polvo AZUL METÁLICO con mezcla NORMAL (visible sobre el fondo CLARO; el aditivo sobre
//     blanco no se vería: sumar luz a un fondo ya casi blanco no cambia nada).
export type ParticleTone = "gold" | "blue";

// SpriteStop es una parada del degradado circular con el que se dibuja UNA mota: a qué distancia del
// centro está (0 = centro, 1 = borde), de qué color es y cuánta opacidad tiene ahí.
type SpriteStop = {
  readonly offset: number;
  readonly color: readonly [number, number, number];
  readonly alpha: number;
};

// TONE_SPRITE define el degradado de cada paleta: núcleo brillante que se desvanece hacia el halo.
// Son EXACTAMENTE los mismos valores que tenía la versión con three.js.
const TONE_SPRITE: Record<ParticleTone, readonly SpriteStop[]> = {
  gold: [
    { offset: 0, color: [255, 248, 224], alpha: 1 },
    { offset: 0.18, color: [255, 236, 184], alpha: 0.9 },
    { offset: 0.5, color: [236, 200, 140], alpha: 0.32 },
    { offset: 1, color: [236, 200, 140], alpha: 0 },
  ],
  // Azul METÁLICO BRILLANTE (azure): núcleo casi blanco + halo azure luminoso (lustre metálico, no apagado).
  blue: [
    { offset: 0, color: [236, 244, 255], alpha: 1 },
    { offset: 0.18, color: [140, 184, 240], alpha: 0.95 },
    { offset: 0.5, color: [70, 130, 220], alpha: 0.42 },
    { offset: 1, color: [70, 130, 220], alpha: 0 },
  ],
};

// ParticleMaterial son los ajustes de "material" que la versión anterior daba al dibujo de puntos:
// un color que TIÑE el degradado, una opacidad general, el tamaño de la mota en unidades de la escena
// y si la luz de la mota se SUMA a lo que hay detrás (aditiva) o simplemente lo tapa (normal).
type ParticleMaterial = {
  readonly tint: readonly [number, number, number];
  readonly opacity: number;
  readonly size: number;
  readonly additive: boolean;
};

// TONE_MATERIAL conserva, valor por valor, lo que declaraba el material de puntos de three.js.
const TONE_MATERIAL: Record<ParticleTone, ParticleMaterial> = {
  // #ecd098 con mezcla aditiva: el "glow" dorado lo da el degradado del sprite + la suma de luz.
  gold: { tint: [236, 208, 152], opacity: 0.6, size: 0.17, additive: true },
  // #6aa8f0 con mezcla normal: sobre un fondo claro, sumar luz no se vería.
  blue: { tint: [106, 168, 240], opacity: 0.72, size: 0.2, additive: false },
};

// FIELD_* definen el volumen imaginario donde viven las motas (en unidades de la escena, no en píxeles).
const FIELD_WIDTH = 18; // ancho
const FIELD_HEIGHT = 12; // alto (las motas suben y reaparecen abajo al salir por arriba)
const FIELD_DEPTH = 4; // profundidad (plano a propósito: así las motas no quedan lejísimos y SE VEN)

// CAMERA_* describen desde dónde se mira el volumen. Son los mismos valores que tenía la cámara 3D:
// a 7 unidades de distancia, con un ángulo de visión de 60 grados.
const CAMERA_DISTANCE = 7;
const CAMERA_FIELD_OF_VIEW_DEGREES = 60;
// CAMERA_NEAR_PLANE es la distancia mínima a la que algo se puede ver. Lo que queda más cerca (o
// detrás) de la cámara no se dibuja. Hace falta porque el campo gira despacio y, al girar, algunas
// motas pasan por detrás del punto de vista; sin este corte se pintarían del revés y a un tamaño
// disparatado. Es el mismo valor por defecto que usaba la cámara de la librería.
const CAMERA_NEAR_PLANE = 0.1;

// FIELD_ROTATION_RADIANS_PER_SECOND es lo que gira TODO el campo sobre su eje vertical: muy despacio
// (una vuelta completa tarda unos siete minutos), lo justo para dar sensación de volumen.
const FIELD_ROTATION_RADIANS_PER_SECOND = 0.015;

// RISE_SPEED_* son la velocidad a la que sube cada mota (unidades de la escena por segundo). Cada una
// recibe un valor al azar dentro de esta banda, para que no suban todas en bloque.
const RISE_SPEED_MINIMUM = 0.06;
const RISE_SPEED_RANGE = 0.16;

// SPRITE_TEXTURE_PIXELS es el tamaño con el que se dibuja el "sello" de una mota, que luego se estampa
// reducido en cada posición. Se mantiene en 64 —el mismo que usaba la imagen de three.js— por dos
// razones: dibujar el degradado una sola vez y reutilizarlo 240 veces por fotograma es muchísimo más
// barato que recalcularlo, y al reducir de 64 píxeles a los 8-25 que ocupa una mota en pantalla el
// navegador promedia igual que hacía la tarjeta gráfica, así que el punto queda igual de difuso.
const SPRITE_TEXTURE_PIXELS = 64;

// SPRITE_ALPHA_SUBDIVISIONS es en cuántos trocitos se parte cada tramo del degradado al construirlo.
//
// POR QUÉ HAY QUE PARTIRLO. La luz que aporta cada punto de una mota NO es su color por su
// transparencia, sino su color por la transparencia AL CUADRADO. No es un capricho: es lo que hacía
// de verdad la versión anterior, y viene de cómo se encadenaban tres cosas en el lienzo 3D:
//   1. la mota se dibujaba multiplicando su color por su transparencia,
//   2. el lienzo guardaba esa transparencia aparte, sin aplicarla al color, y
//   3. al pegar el lienzo sobre la página, el navegador volvía a multiplicar por ella.
// Resultado: la transparencia entra dos veces. El brillo de la mota queda en un tercio del que
// tendría si entrara una sola vez, y el halo se apaga mucho más deprisa.
//
// No es una suposición: se levantó un banco de pruebas con la versión antigua, se sumó toda la luz
// de las 79 motas que salen aisladas y se comparó con las cuatro fórmulas candidatas. La que entra
// una sola vez predice 3,6 veces más luz de la que hay; la de la transparencia al cuadrado predice
// 1,8 veces de más; ESTA (color por transparencia, todo al cuadrado) acierta con un error del 5,5%.
// Además da el mismo resultado dibujado con una tarjeta gráfica real (Apple M5) que con el
// rasterizador por software del navegador sin pantalla, así que no es un espejismo del entorno.
//
// Como el navegador interpola el degradado en línea recta entre parada y parada, aplicar la cuenta
// solo a las cuatro paradas declaradas daría otra curva distinta en medio. Partiendo cada tramo en 8
// trocitos, la curva que dibuja el navegador se pega a la buena con un error inapreciable.
const SPRITE_ALPHA_SUBDIVISIONS = 8;

// MAX_PIXEL_RATIO limita la resolución a la que se dibuja en pantallas de alta densidad. Es el mismo
// tope que tenía el lienzo 3D: con 1,5 el polvo se ve nítido y no se paga el coste de dibujarlo a la
// resolución completa de una pantalla retina, que para un efecto difuso no aporta nada.
const MAX_PIXEL_RATIO = 1.5;

// MAX_FRAME_SECONDS acota cuánto tiempo puede "avanzar" el campo de una vez. Si la pestaña estuvo
// oculta un minuto, el navegador deja de dibujar y al volver entregaría un salto de 60 segundos: las
// motas darían un brinco. Limitando el paso, al volver la animación continúa con naturalidad.
const MAX_FRAME_SECONDS = 0.1;

// ParticleField guarda el estado del campo: la posición de cada mota (tres números por mota: izquierda
// -derecha, abajo-arriba, cerca-lejos) y a qué velocidad sube cada una.
export type ParticleField = {
  readonly positions: Float32Array;
  readonly riseSpeeds: Float32Array;
  readonly count: number;
};

// createSeededRandom es un generador de números "al azar" DETERMINISTA (algoritmo mulberry32): con la
// misma semilla produce siempre la misma secuencia. En español: el polvo se ve idéntico cada vez que
// se abre la página, en vez de repartirse distinto en cada visita. Sustituye a Math.random(), que
// daría un campo diferente en cada montaje.
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// createParticleField reparte las motas por el volumen y les da su velocidad de subida.
// La semilla depende del número de motas, exactamente igual que antes, para que el reparto sea el
// mismo que producía la versión con three.js.
export function createParticleField(count: number): ParticleField {
  const random = createSeededRandom(count * 2654435761 + 97);
  const positions = new Float32Array(count * 3);
  const riseSpeeds = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * FIELD_WIDTH;
    positions[index * 3 + 1] = (random() - 0.5) * FIELD_HEIGHT;
    positions[index * 3 + 2] = (random() - 0.5) * FIELD_DEPTH;
    riseSpeeds[index] = RISE_SPEED_MINIMUM + random() * RISE_SPEED_RANGE;
  }
  return { positions, riseSpeeds, count };
}

// advanceParticleField sube cada mota lo que le toque en el tiempo transcurrido y, cuando una sale
// por arriba, la devuelve abajo para que el polvo no se agote nunca (es un bucle sin fin).
// Devuelve cuánto giró el campo en ese mismo tiempo, para que quien llama lo acumule.
export function advanceParticleField(field: ParticleField, elapsedSeconds: number): number {
  const step = Math.min(Math.max(elapsedSeconds, 0), MAX_FRAME_SECONDS);
  const topEdge = FIELD_HEIGHT / 2;
  for (let index = 0; index < field.count; index += 1) {
    const verticalSlot = index * 3 + 1;
    field.positions[verticalSlot] += field.riseSpeeds[index] * step;
    if (field.positions[verticalSlot] > topEdge) {
      field.positions[verticalSlot] = -topEdge;
    }
  }
  return step * FIELD_ROTATION_RADIANS_PER_SECOND;
}

// srgbChannelToLight pasa un canal de color de la escala que ve el ojo (0-255, la de siempre) a la
// escala FÍSICA de la luz, donde el doble de valor es el doble de luz de verdad.
function srgbChannelToLight(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

// lightChannelToSrgb hace el viaje de vuelta: de la escala física de la luz a la escala del ojo.
function lightChannelToSrgb(light: number): number {
  const encoded = light <= 0.0031308 ? light * 12.92 : 1.055 * light ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

// tintColor calcula el color final de una parada del degradado: mezcla el color del degradado con el
// color del material y lo atenúa por la transparencia que le toca.
//
// POR QUÉ LOS COLORES NO SE MULTIPLICAN Y YA: three.js mezclaba los dos colores en la escala FÍSICA de
// la luz (es lo correcto: mezclar luces no es lo mismo que mezclar números de pantalla). Un lienzo de
// dos dimensiones trabaja siempre en la escala del ojo. Para que el tono salga IDÉNTICO al de antes se
// hace aquí el mismo viaje: se pasan los dos colores a la escala de la luz, se multiplican, y el
// resultado vuelve a la escala del ojo. Sin este paso el polvo saldría de otro color.
//
// POR QUÉ ADEMÁS SE MULTIPLICA POR LA TRANSPARENCIA: es la primera de las dos veces que la
// transparencia entra en la cuenta (ver SPRITE_ALPHA_SUBDIVISIONS). La segunda la pone el propio
// lienzo al pegarse sobre la página. Ese "dos veces" es lo que reproduce el brillo de antes.
function tintColor(
  spriteColor: readonly [number, number, number],
  materialTint: readonly [number, number, number],
  attenuation: number,
): string {
  const red = lightChannelToSrgb(
    srgbChannelToLight(spriteColor[0]) * srgbChannelToLight(materialTint[0]),
  );
  const green = lightChannelToSrgb(
    srgbChannelToLight(spriteColor[1]) * srgbChannelToLight(materialTint[1]),
  );
  const blue = lightChannelToSrgb(
    srgbChannelToLight(spriteColor[2]) * srgbChannelToLight(materialTint[2]),
  );
  return `${Math.round(red * attenuation)}, ${Math.round(green * attenuation)}, ${Math.round(blue * attenuation)}`;
}

// buildSpriteSamples parte el degradado en trocitos: entre cada dos paradas declaradas mete varias
// paradas intermedias, calculando su color y su transparencia como los calcularía el navegador (en
// línea recta de una a otra). Sirve para poder curvar la transparencia sin deformar el color.
function buildSpriteSamples(stops: readonly SpriteStop[]): SpriteStop[] {
  const samples: SpriteStop[] = [];
  for (let index = 0; index + 1 < stops.length; index += 1) {
    const from = stops[index];
    const to = stops[index + 1];
    for (let step = 0; step < SPRITE_ALPHA_SUBDIVISIONS; step += 1) {
      const progress = step / SPRITE_ALPHA_SUBDIVISIONS;
      samples.push({
        offset: from.offset + (to.offset - from.offset) * progress,
        color: [
          from.color[0] + (to.color[0] - from.color[0]) * progress,
          from.color[1] + (to.color[1] - from.color[1]) * progress,
          from.color[2] + (to.color[2] - from.color[2]) * progress,
        ],
        alpha: from.alpha + (to.alpha - from.alpha) * progress,
      });
    }
  }
  // La última parada declarada cierra el degradado (siempre es el borde, ya transparente del todo).
  samples.push(stops[stops.length - 1]);
  return samples;
}

// createParticleSprite dibuja UNA VEZ el "sello" de una mota: un círculo difuso con el degradado de la
// paleta, ya teñido con el color del material. Después, cada fotograma solo estampa este sello en las
// posiciones que toquen, que es muchísimo más barato que redibujar el degradado 240 veces por fotograma.
// Devuelve null si el navegador no da un lienzo de dos dimensiones (entonces no hay fondo decorativo,
// y la página funciona exactamente igual: esto es adorno).
//
// createCanvas decide en qué lienzo se dibuja el sello: un <canvas> de la página o, cuando el polvo se
// pinta en un hilo aparte (ver particle-worker.ts), un OffscreenCanvas. El dibujo es el mismo.
export type ParticleSprite = HTMLCanvasElement | OffscreenCanvas;
type ParticleContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createDocumentCanvas(): HTMLCanvasElement {
  return document.createElement("canvas");
}

export function createParticleSprite(
  tone: ParticleTone,
  createCanvas: () => ParticleSprite = createDocumentCanvas,
): ParticleSprite | null {
  const canvas = createCanvas();
  canvas.width = SPRITE_TEXTURE_PIXELS;
  canvas.height = SPRITE_TEXTURE_PIXELS;
  const context = canvas.getContext("2d") as ParticleContext | null;
  if (context === null) {
    return null;
  }
  const center = SPRITE_TEXTURE_PIXELS / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  const material = TONE_MATERIAL[tone];
  // El degradado se recorre en trocitos porque tanto el color como la transparencia de cada punto
  // dependen de la transparencia declarada (ver SPRITE_ALPHA_SUBDIVISIONS): el color se atenúa por
  // ella y la transparencia del sello es ella misma. Al pegarse el lienzo sobre la página se aplica
  // por segunda vez, que es lo que reproduce el brillo exacto de la versión anterior.
  for (const sample of buildSpriteSamples(TONE_SPRITE[tone])) {
    const stopAlpha = material.opacity * sample.alpha;
    gradient.addColorStop(
      sample.offset,
      `rgba(${tintColor(sample.color, material.tint, stopAlpha)}, ${stopAlpha})`,
    );
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, SPRITE_TEXTURE_PIXELS, SPRITE_TEXTURE_PIXELS);
  return canvas;
}

// resizeParticleCanvas ajusta el lienzo al tamaño real que ocupa en la página y a la densidad de la
// pantalla. Devuelve la densidad aplicada, que hace falta para dibujar después en píxeles "de CSS".
export function resizeParticleCanvas(canvas: HTMLCanvasElement): number {
  return applyParticleCanvasSize(
    canvas,
    canvas.clientWidth,
    canvas.clientHeight,
    window.devicePixelRatio || 1,
  );
}

// applyParticleCanvasSize es la cuenta de resizeParticleCanvas sin leer la página: recibe el tamaño
// en CSS y la densidad, para que el hilo aparte (que no ve la página) haga exactamente lo mismo.
export function applyParticleCanvasSize(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): number {
  const pixelRatio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO);
  const targetWidth = Math.max(1, Math.floor(cssWidth * pixelRatio));
  const targetHeight = Math.max(1, Math.floor(cssHeight * pixelRatio));
  // Solo se reasigna si cambió: escribir width/height BORRA el lienzo, y hacerlo en cada fotograma
  // provocaría un parpadeo además de trabajo inútil.
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  return pixelRatio;
}

// drawParticleField pinta un fotograma completo: borra lo anterior y estampa cada mota donde le toca.
//
// La cuenta de perspectiva, en cristiano: cuanto más lejos está una mota, más pegada al centro de la
// pantalla se ve y más pequeña. "focalLength" es el factor que convierte una distancia de la escena en
// píxeles de pantalla; sale del ángulo de visión de la cámara y de la altura de la ventana. Son las
// mismas fórmulas que aplicaba la tarjeta gráfica con three.js, escritas a mano.
export function drawParticleField(
  context: ParticleContext,
  sprite: ParticleSprite,
  field: ParticleField,
  tone: ParticleTone,
  rotationRadians: number,
  pixelRatio: number,
): void {
  const cssWidth = context.canvas.width / pixelRatio;
  const cssHeight = context.canvas.height / pixelRatio;
  const material = TONE_MATERIAL[tone];

  // Se trabaja en píxeles "de CSS" y se deja que el lienzo multiplique por la densidad de pantalla.
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.clearRect(0, 0, cssWidth, cssHeight);

  // "lighter" es la mezcla ADITIVA: la luz de cada mota se SUMA a lo que ya había, que es lo que hace
  // que el polvo dorado brille sobre el fondo oscuro. En el tema claro se usa la mezcla normal.
  context.globalCompositeOperation = material.additive ? "lighter" : "source-over";
  // La opacidad del material ya viene incorporada al sello (ver createParticleSprite), así que aquí
  // no se vuelve a aplicar: hacerlo la contaría una vez de más y el polvo saldría apagado.
  context.globalAlpha = 1;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const focalLength = cssHeight / 2 / Math.tan((CAMERA_FIELD_OF_VIEW_DEGREES * Math.PI) / 360);
  const rotationCosine = Math.cos(rotationRadians);
  const rotationSine = Math.sin(rotationRadians);
  const centerX = cssWidth / 2;
  const centerY = cssHeight / 2;

  for (let index = 0; index < field.count; index += 1) {
    const x = field.positions[index * 3];
    const y = field.positions[index * 3 + 1];
    const z = field.positions[index * 3 + 2];

    // Giro lento de todo el campo alrededor del eje vertical.
    const rotatedX = x * rotationCosine + z * rotationSine;
    const rotatedZ = -x * rotationSine + z * rotationCosine;

    // Distancia de la mota a la cámara. Si queda detrás (o pegada a ella), no se dibuja.
    const depth = CAMERA_DISTANCE - rotatedZ;
    if (depth <= CAMERA_NEAR_PLANE) {
      continue;
    }

    // Tamaño en pantalla: el mismo que daba three.js con su "atenuación por distancia", que es
    // el tamaño del material multiplicado por media altura de la ventana y dividido por la distancia.
    const diameter = (material.size * (cssHeight / 2)) / depth;
    const radius = diameter / 2;
    const screenX = centerX + (focalLength * rotatedX) / depth;
    const screenY = centerY - (focalLength * y) / depth;

    // Motas que caen fuera de la ventana: se saltan (dibujarlas sería trabajo tirado).
    if (
      screenX + radius < 0 ||
      screenY + radius < 0 ||
      screenX - radius > cssWidth ||
      screenY - radius > cssHeight
    ) {
      continue;
    }

    context.drawImage(sprite, screenX - radius, screenY - radius, diameter, diameter);
  }

  // Se deja el pincel como estaba para no sorprender a nadie que lo use después.
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
}
