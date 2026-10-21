// Archivo: graph-layout.test.ts — Pruebas de la colocación de los puntos del mapa.
//
// Qué se defiende aquí, en español: que el tamaño de un punto crezca por ÁREA y no por radio (o los
// puntos muy conectados aplastarían visualmente a todo lo demás), que la colocación devuelva una
// posición real para cada punto (un valor perdido pintaría un punto en la esquina superior izquierda
// sin que nadie entendiera por qué) y que el mismo dato produzca siempre el mismo mapa: si no fuera
// así, la persona que ve la animación y la que pidió menos movimiento verían mapas distintos.

import { describe, expect, it } from "vitest";

import {
  NODE_RADIUS_MAX,
  NODE_RADIUS_MIN,
  computeStaticLayout,
  fitRadiusScale,
  fitViewTransform,
  nodeRadius,
  type GraphLayoutRequest,
} from "@/lib/graph-layout";

// CANVAS_WIDTH / CANVAS_HEIGHT son un lienzo de prueba con medidas de escritorio corrientes.
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 600;

// makeRequest arma un encargo de colocación en cadena: uno · dos · tres · cuatro.
function makeRequest(count: number): GraphLayoutRequest {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    degree: index === 0 ? count - 1 : 1,
  }));
  const edges = Array.from({ length: count - 1 }, (_, index) => ({
    source: `n${index}`,
    target: `n${index + 1}`,
  }));
  return {
    nodes,
    edges,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    radiusScale: fitRadiusScale(nodes, CANVAS_WIDTH, CANVAS_HEIGHT),
  };
}

describe("nodeRadius", () => {
  it("un punto sin conexiones sigue siendo pulsable", () => {
    // Por debajo del mínimo, un punto deja de ser un objetivo cómodo con el dedo y pasa a ser una
    // mota que hay que perseguir.
    expect(nodeRadius(0)).toBe(NODE_RADIUS_MIN);
  });

  it("crece por ÁREA y no por radio", () => {
    // Lo que el ojo compara en un círculo es la mancha que ocupa, no su radio. Con crecimiento
    // proporcional al radio, un vínculo con nueve títulos se vería ochenta y una veces más grande.
    // Con la raíz cuadrada, cuadruplicar las conexiones duplica el radio, que es lo correcto.
    const crecimientoDeUno = nodeRadius(1) - NODE_RADIUS_MIN;
    const crecimientoDeCuatro = nodeRadius(4) - NODE_RADIUS_MIN;

    expect(crecimientoDeCuatro).toBeCloseTo(crecimientoDeUno * 2, 5);
  });

  it("un vínculo repetidísimo no se come media pantalla", () => {
    expect(nodeRadius(10_000)).toBe(NODE_RADIUS_MAX);
  });

  it("el factor de tamaño encoge a TODOS por igual, sin alterar sus proporciones", () => {
    // Es la propiedad que importa: al encoger el mapa entero, un vínculo con nueve títulos tiene que
    // seguir viéndose el triple de grande que uno con uno. Si no, el dibujo mentiría sobre el dato.
    const proporcionNatural = nodeRadius(9) / nodeRadius(1);
    const proporcionEncogida = nodeRadius(9, 0.5) / nodeRadius(1, 0.5);

    expect(proporcionEncogida).toBeCloseTo(proporcionNatural, 10);
  });
});

describe("fitRadiusScale", () => {
  it("no encoge nada cuando los puntos caben de sobra", () => {
    const pocos = Array.from({ length: 5 }, (_, indice) => ({ id: `n${indice}`, degree: 1 }));

    expect(fitRadiusScale(pocos, CANVAS_WIDTH, CANVAS_HEIGHT)).toBe(1);
  });

  it("encoge los puntos cuando son demasiados para el sitio que hay", () => {
    // Este es el defecto que se vio en pantalla: con ciento cincuenta títulos vistos, los puntos a
    // tamaño fijo ocupaban dos tercios del recuadro y el mapa era un panal de circulitos pegados
    // donde no se distinguía ninguna estructura.
    const muchos = Array.from({ length: 400 }, (_, indice) => ({ id: `n${indice}`, degree: 2 }));

    const factor = fitRadiusScale(muchos, CANVAS_WIDTH, CANVAS_HEIGHT);

    expect(factor).toBeLessThan(1);
    expect(factor).toBeGreaterThan(0);
  });

  it("nunca los encoge hasta hacerlos imposibles de señalar", () => {
    // Por debajo de cierto tamaño un punto deja de ser algo que se pueda pulsar con el dedo. A partir
    // de ahí el mapa es una vista de pájaro y quien necesite precisión tiene el buscador y la lista.
    const muchisimos = Array.from({ length: 20_000 }, (_, indice) => ({
      id: `n${indice}`,
      degree: 1,
    }));

    expect(nodeRadius(1, fitRadiusScale(muchisimos, CANVAS_WIDTH, CANVAS_HEIGHT))).toBeGreaterThan(
      5,
    );
  });

  it("un mapa vacío no rompe el cálculo", () => {
    expect(fitRadiusScale([], CANVAS_WIDTH, CANVAS_HEIGHT)).toBe(1);
  });
});

describe("computeStaticLayout", () => {
  it("devuelve una posición real para cada punto", () => {
    // Un valor perdido se pintaría en la esquina superior izquierda del lienzo, y nadie entendería
    // por qué hay puntos amontonados justo ahí.
    const resultado = computeStaticLayout(makeRequest(12));

    expect(resultado.positions).toHaveLength(12);
    for (const posicion of resultado.positions) {
      expect(Number.isFinite(posicion.x)).toBe(true);
      expect(Number.isFinite(posicion.y)).toBe(true);
    }
  });

  it("separa los puntos en vez de amontonarlos en el mismo sitio", () => {
    const resultado = computeStaticLayout(makeRequest(8));
    const sitiosDistintos = new Set(
      resultado.positions.map((posicion) => `${Math.round(posicion.x)}x${Math.round(posicion.y)}`),
    );

    expect(sitiosDistintos.size).toBe(resultado.positions.length);
  });

  it("el mismo dato produce SIEMPRE el mismo mapa", () => {
    // Es la garantía de que quien ve la animación y quien pidió menos movimiento están viendo lo
    // mismo. Si la colocación tuviera azar, serían dos mapas distintos del mismo dato.
    const primera = computeStaticLayout(makeRequest(10));
    const segunda = computeStaticLayout(makeRequest(10));

    expect(segunda.positions).toEqual(primera.positions);
  });

  it("un mapa sin ningún punto no rompe nada", () => {
    // Pasa de verdad: alguien con la biblioteca vacía, o con todos los vínculos apagados.
    const resultado = computeStaticLayout({
      nodes: [],
      edges: [],
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      radiusScale: 1,
    });

    expect(resultado.positions).toEqual([]);
  });

  it("informa de cuánto tardó, para poder vigilarlo", () => {
    // Este número es el que justifica todo el diseño de la pantalla (el hilo aparte existe porque en
    // el peor caso son casi 840 milisegundos). Si algún día cambia, hay que enterarse mirando.
    const resultado = computeStaticLayout(makeRequest(30));

    expect(resultado.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe("fitViewTransform", () => {
  // proyectar aplica el encuadre a un punto, igual que hace el dibujo.
  function proyectar(
    punto: { x: number; y: number; radius: number },
    lente: ReturnType<typeof fitViewTransform>,
  ) {
    return {
      izquierda: lente.offsetX + (punto.x - punto.radius) * lente.scale,
      derecha: lente.offsetX + (punto.x + punto.radius) * lente.scale,
      arriba: lente.offsetY + (punto.y - punto.radius) * lente.scale,
      abajo: lente.offsetY + (punto.y + punto.radius) * lente.scale,
    };
  }

  it("no agranda un mapa pequeño: solo lo centra", () => {
    // Con tres puntos vistos, ampliar hasta llenar la pantalla los convertiría en tres globos
    // gigantes separados por medio lienzo vacío: un mapa que parece roto.
    const lente = fitViewTransform(
      [
        { x: 400, y: 300, radius: 20 },
        { x: 500, y: 300, radius: 20 },
      ],
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
    );

    expect(lente.scale).toBe(1);
  });

  it("encoge lo justo para que QUEPA lo que se sale del lienzo", () => {
    // Este es el defecto que corrige: con una biblioteca grande, parte del mapa acababa fuera del
    // recuadro y lo que se hacía antes era empujar esos puntos contra el borde, apelmazándolos.
    const puntos = [
      { x: -400, y: -300, radius: 20 },
      { x: 1400, y: 900, radius: 20 },
    ];
    const lente = fitViewTransform(puntos, CANVAS_WIDTH, CANVAS_HEIGHT);

    expect(lente.scale).toBeLessThan(1);
    for (const punto of puntos) {
      const caja = proyectar(punto, lente);
      expect(caja.izquierda).toBeGreaterThanOrEqual(0);
      expect(caja.derecha).toBeLessThanOrEqual(CANVAS_WIDTH);
      expect(caja.arriba).toBeGreaterThanOrEqual(0);
      expect(caja.abajo).toBeLessThanOrEqual(CANVAS_HEIGHT);
    }
  });

  it("encoge por igual los dos ejes, para no deformar el mapa", () => {
    // Un solo número para ancho y alto: encoger más de ancho que de alto convertiría los círculos en
    // óvalos y las distancias dejarían de significar lo mismo en cada dirección.
    const lente = fitViewTransform(
      [
        { x: 0, y: 0, radius: 10 },
        { x: 4000, y: 100, radius: 10 },
      ],
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
    );

    expect(lente.scale).toBeGreaterThan(0);
    expect(lente.scale).toBeLessThan(1);
  });

  it("un mapa sin puntos no rompe el encuadre", () => {
    expect(fitViewTransform([], CANVAS_WIDTH, CANVAS_HEIGHT)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("un lienzo aún sin medir no rompe el encuadre", () => {
    // Pasa en el primer dibujado, antes de que el observador de tamaño haya informado.
    expect(fitViewTransform([{ x: 1, y: 1, radius: 5 }], 0, 0)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });
});
