"use client";

// Archivo: GraphCanvas.tsx — El DIBUJO del mapa personal, y su navegación con el teclado.
//
// Qué hay aquí, en español: un lienzo de dos dimensiones donde se pintan los puntos y los hilos, y
// todo lo necesario para poder recorrerlo sin ratón. No hay ninguna librería de grafos detrás: solo
// d3-force colocando los puntos (ver lib/graph-layout.ts) y este archivo dibujándolos.
//
// LO QUE MÁS TRABAJO TIENE AQUÍ NO ES DIBUJAR, ES QUE FUNCIONE SIN VER.
//
// Un lienzo es, para un lector de pantalla, un rectángulo mudo: no tiene partes, no tiene texto, no
// tiene nada que anunciar. Así que la navegación se construye entera a mano:
//
//   · El mapa es UN SOLO punto de entrada con el tabulador (como una rejilla), no ochocientos. Nadie
//     debería tener que pulsar Tab quinientas veces para pasar de largo.
//   · Dentro, las flechas izquierda y derecha recorren los puntos en un orden estable, y las de
//     arriba y abajo SALTAN A LO CONECTADO — es decir, los hilos del dibujo son también las rutas por
//     las que se navega, que es justo el planteamiento que propone la literatura seria sobre gráficos
//     accesibles.
//   · Cada punto enfocado se anuncia en voz alta con una frase completa: qué es, cómo se llama y con
//     cuántas cosas conecta.
//   · Enter abre lo que hay debajo; Escape sale del mapa.
//
// Y aun con todo eso, este dibujo NO es la única forma de acceder a la información: al lado vive la
// misma constelación escrita como lista (GraphTextView). No es un premio de consolación — para "¿en
// qué películas mías sale este actor?" la lista responde mejor y más rápido que el dibujo, para todo
// el mundo.
//
// SOBRE role="application", que es una decisión discutible y por eso se explica: con el papel normal
// de una imagen, un lector de pantalla se queda las flechas para recorrer el documento y nunca
// llegarían aquí; el mapa sería inservible con teclado y voz a la vez. Este papel es la vía estándar
// para decir "aquí las teclas las gestiono yo". Se asume su coste —dentro de este rectángulo, la
// navegación habitual del lector queda suspendida— porque la alternativa completa en texto está
// siempre a un clic y con semántica del todo corriente.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  buildSimulation,
  computeStaticLayout,
  fitRadiusScale,
  fitViewTransform,
  nodeRadius,
  type GraphLayoutRequest,
  type GraphLayoutResponse,
  type ViewTransform,
} from "@/lib/graph-layout";
import { ATTRIBUTE_KINDS, neighbourIdsOf } from "@/lib/graph-view-model";
import { type GraphNode, type GraphNodeKind, type PersonalGraph } from "@/lib/personal-graph";
import { ui } from "@/lib/i18n";

// LayoutOrigin dice DÓNDE se calculó la colocación.
//
// En español: no es curiosidad técnica. Que el cálculo pesado se pueda hacer en segundo plano depende
// de una peculiaridad de la versión de Next.js que usa el proyecto, y es exactamente el tipo de cosa
// que se rompe en silencio al cambiar de versión. Por eso el dato tiene que quedar registrado en
// algún sitio comprobable.
type LayoutOrigin = "worker" | "main";

// LayoutMeasurement es lo que se registra cada vez que el mapa se coloca.
//
// DÓNDE ACABA ESTE DATO, y por qué cambió: se escribía en pantalla, dentro de la misma frase que dice
// "295 títulos · 1086 vínculos", con el aspecto de "Colocado en 3518 ms en la página". Es telemetría
// de desarrollo, no texto de producto: a quien mira su constelación no le dice nada y, pegado al
// recuento, parece parte de la información. Ahora viaja en los atributos data-layout-* del mapa: las
// herramientas del navegador y las pruebas automáticas lo leen igual de bien, y la persona no lo ve.
type LayoutMeasurement = {
  // elapsedMs es cuánto tardó la colocación completa.
  elapsedMs: number;
  // origin es dónde se hizo la cuenta.
  origin: LayoutOrigin;
  // nodeCount y edgeCount son el tamaño de lo que se colocó (para poder leer el tiempo en contexto).
  nodeCount: number;
  edgeCount: number;
};

// GraphCanvasProps son las propiedades del lienzo.
type GraphCanvasProps = {
  // graph es el mapa YA FILTRADO que hay que dibujar (ver lib/graph-view-model).
  graph: PersonalGraph;
  // selectedId es el punto resaltado (al pulsarlo se ilumina lo suyo y se apaga el resto), o null.
  selectedId: string | null;
  // onSelect avisa de que la persona ha elegido un punto (o lo ha soltado, con null).
  onSelect: (nodeId: string | null) => void;
  // onOpenTitle abre la ficha de un título. Solo se llama con puntos de tipo título.
  onOpenTitle: (releaseId: string) => void;
  // paused es el estado del BOTÓN DE PAUSA visible de la página. Cuando está en true, la colocación
  // deja de moverse aunque no haya terminado de acomodarse.
  paused: boolean;
  // searchQuery es lo que la persona ha escrito en el buscador: lo que coincide se marca en el mapa.
  searchQuery: string;
};

// KIND_TOKENS asigna a cada tipo de punto su color, tomado de los tokens del proyecto.
//
// En español: no hay ni un color suelto escrito aquí. Todos salen de las variables de la hoja de
// estilos, que son las que la prueba automática de contraste vigila en los dos temas. Si mañana se
// retoca la paleta, este dibujo la sigue sin tocar una línea.
const KIND_TOKENS: Record<GraphNodeKind, string> = {
  title: "--color-gold-bright",
  cast: "--color-teal",
  director: "--color-violet",
  genre: "--color-indie",
  platform: "--color-text-muted",
};

// KIND_LABELS traduce el tipo de punto a la palabra que se lee en voz alta.
const KIND_LABELS: Record<GraphNodeKind, string> = {
  title: ui.graph.kindTitle,
  cast: ui.graph.kindCast,
  director: ui.graph.kindDirector,
  genre: ui.graph.kindGenre,
  platform: ui.graph.kindPlatform,
};

// EDGE_ALPHA_STRONG y EDGE_ALPHA_WEAK son la opacidad de los hilos según su fuerza.
//
// En español: un hilo de "comparten actriz" se dibuja más presente que uno de "comparten género",
// porque uno dice algo y el otro casi nada. Es la misma jerarquía que ordena la lista, dicha con
// tinta en vez de con palabras.
const EDGE_ALPHA_STRONG = 0.42;
const EDGE_ALPHA_WEAK = 0.18;

// EDGE_ALPHA_DIMMED es la opacidad de todo lo que NO cuelga del punto resaltado.
// En español: al pulsar un punto, lo suyo se ilumina y el resto se apaga sin desaparecer, para que no
// se pierda el contexto de dónde estaba dentro del conjunto.
const EDGE_ALPHA_DIMMED = 0.05;

// NODE_ALPHA_DIMMED es lo mismo para los puntos que no tienen que ver con el resaltado.
const NODE_ALPHA_DIMMED = 0.16;

// LABEL_MIN_DEGREE es a partir de cuántas conexiones un VÍNCULO enseña su nombre siempre.
//
// Dos decisiones aquí, y las dos salen de mirar el mapa dibujado en pantalla, no de suponer:
//
// 1. LOS TÍTULOS NO ESCRIBEN SU NOMBRE POR SU CUENTA. Con sesenta títulos vistos, escribirlos todos
//    convertía el mapa en una mancha de texto encabalgado donde no se leía ninguno. Lo que estructura
//    el mapa y hay que poder leer de un vistazo son los VÍNCULOS —"Netflix", "Drama", el nombre de
//    una actriz—; los títulos se leen al pasar por encima, al enfocarlos o al buscarlos. Es la misma
//    idea de una libreta de notas enlazadas: se ven las etiquetas, y las notas se exploran.
//
// 2. EL UMBRAL SUBE CON EL TAMAÑO. Cuatro conexiones bastan para destacar en un mapa pequeño; en uno
//    de seiscientos puntos, con cuatro se vuelven a solapar los nombres. Ver LABEL_MIN_DEGREE_DENSE.
const LABEL_MIN_DEGREE = 4;

// LABEL_MIN_DEGREE_DENSE es ese mismo umbral cuando el mapa ya es grande.
const LABEL_MIN_DEGREE_DENSE = 8;

// DENSE_NODE_COUNT es a partir de cuántos puntos el mapa se considera grande para los nombres.
const DENSE_NODE_COUNT = 150;

// LABEL_FONT_PX y LABEL_OFFSET_PX son el tamaño del nombre y a qué distancia del punto se escribe.
const LABEL_FONT_PX = 11;
const LABEL_OFFSET_PX = 6;

// LABEL_MAX_CHARS acota el nombre escrito para que un título larguísimo no cruce medio mapa.
const LABEL_MAX_CHARS = 22;

// LABEL_PADDING_PX es el aire que se le reserva a cada nombre alrededor para decidir si se pisa con otro.
//
// En español: dos textos que se tocan justo por el canto son, en la práctica, ilegibles los dos. Con
// un par de píxeles de holgura a cada lado, o se leen separados o directamente no se dibuja el
// segundo. Es la diferencia entre "muchos nombres, ninguno legible" y "menos nombres, todos legibles".
const LABEL_PADDING_PX = 3;

// LabelPriority ordena qué nombres se escriben primero cuando no caben todos.
//
// Los que la persona ha PEDIDO ver —el que tiene el foco del teclado, el que está bajo el ratón, el
// resaltado y los que coinciden con la búsqueda— se escriben siempre, aunque tapen a otro: si alguien
// busca "Netflix" y su nombre no aparece, la búsqueda está rota. Los demás, los que estructuran el
// mapa, se escriben en orden de importancia mientras quede sitio libre.
const LABEL_PRIORITY_REQUESTED = 0;
const LABEL_PRIORITY_STRUCTURAL = 1;

// PendingLabel es un nombre a la espera de saber si cabe sin pisar a ninguno de los ya escritos.
type PendingLabel = {
  text: string;
  // x es el centro horizontal del texto y y su borde superior (se dibuja centrado bajo el punto).
  x: number;
  y: number;
  priority: number;
  // degree desempata entre nombres de la misma prioridad: primero el que une a más cosas.
  degree: number;
};

// LabelBox es el rectángulo que un nombre ya escrito ocupa en el lienzo.
type LabelBox = { left: number; top: number; right: number; bottom: number };

// overlaps dice si dos rectángulos de texto se solapan.
function overlaps(left: LabelBox, right: LabelBox): boolean {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

// FOCUS_RING_WIDTH_PX es el grosor del aro que marca el punto enfocado con el teclado.
// En español: el foco tiene que verse SIEMPRE, y en un lienzo no lo pinta el navegador: hay que
// dibujarlo a mano. Tres píxeles es lo que lo hace inconfundible sin taparlo todo.
const FOCUS_RING_WIDTH_PX = 3;

// FOCUS_RING_GAP_PX separa el aro del borde del punto, para que se lea como un aro y no como un borde.
const FOCUS_RING_GAP_PX = 4;

// ANIMATION_ALPHA_FLOOR es la "temperatura" por debajo de la cual la simulación se da por acabada.
// En español: el sistema arranca caliente (los puntos se mueven mucho) y se va enfriando solo. Este
// es el valor por defecto de d3-force y es donde el movimiento ya no se aprecia.
const ANIMATION_ALPHA_FLOOR = 0.001;

// TARGET_FRAME_MS es lo que dura una imagen en una pantalla normal: 60 por segundo.
const TARGET_FRAME_MS = 1000 / 60;

// MAX_TICKS_PER_FRAME acota cuántos pasos de simulación se pueden hacer en una sola imagen.
//
// Por qué existe esto, y es un defecto MEDIDO, no una precaución teórica: la colocación avanzaba un
// paso por imagen, así que su duración no dependía del reloj sino de lo deprisa que el navegador
// pintara. En un equipo o un entorno lento —se midió justo eso: 30 milisegundos por imagen en vez de
// 16,7— el mapa tardaba el DOBLE en acomodarse y llegaba a agotar el tope de tiempo con el dibujo a
// medio hacer. Avanzando según el tiempo real transcurrido, la colocación dura lo mismo para todo el
// mundo y siempre termina.
//
// El tope de tres pasos evita el efecto contrario: si el navegador se queda parado un segundo
// (cambio de pestaña, otra cosa acaparando la máquina), la vuelta no debe gastar sesenta pasos de
// golpe y provocar justo el tirón que se quería evitar.
const MAX_TICKS_PER_FRAME = 3;

// MAX_ANIMATION_MS es el tope de tiempo que la colocación puede estar moviéndose.
//
// Por qué existe un tope, en español: la norma de accesibilidad exige poder detener cualquier
// movimiento que pase de cinco segundos. El botón de pausa ya cumple esa exigencia, pero además el
// movimiento se para solo: un mapa que sigue temblando indefinidamente marea y no aporta nada una vez
// que las cosas encontraron su sitio.
const MAX_ANIMATION_MS = 4500;

// Palette son los colores ya resueltos de la hoja de estilos, listos para pintar en el lienzo.
//
// En español: el lienzo no entiende de variables CSS; hay que darle colores concretos. Se leen una
// vez y se vuelven a leer cuando cambia el tema, que es lo único que puede cambiarlos.
type Palette = {
  byKind: Record<GraphNodeKind, string>;
  text: string;
  border: string;
  background: string;
};

// readPalette resuelve los tokens de color del tema activo.
function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement);
  const value = (token: string) => styles.getPropertyValue(token).trim();
  const byKind = {} as Record<GraphNodeKind, string>;
  for (const [kind, token] of Object.entries(KIND_TOKENS)) {
    byKind[kind as GraphNodeKind] = value(token);
  }
  return {
    byKind,
    text: value("--color-text"),
    border: value("--color-border"),
    background: value("--color-bg"),
  };
}

// shortenLabel recorta un nombre largo para escribirlo en el mapa sin que cruce media pantalla.
function shortenLabel(label: string): string {
  return label.length <= LABEL_MAX_CHARS ? label : `${label.slice(0, LABEL_MAX_CHARS - 1)}…`;
}

// GraphCanvas dibuja el mapa y lo hace recorrible con el teclado.
export function GraphCanvas({
  graph,
  selectedId,
  onSelect,
  onOpenTitle,
  paused,
  searchQuery,
}: GraphCanvasProps) {
  // Referencias al lienzo y a su contenedor (el contenedor es quien recibe el foco y las teclas).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // positionsRef guarda dónde está cada punto. Es una REFERENCIA y no un estado a propósito: cambia
  // sesenta veces por segundo mientras el mapa se acomoda, y convertir eso en estado de React
  // provocaría sesenta re-dibujados del árbol de componentes por segundo para pintar en un lienzo que
  // no necesita ninguno.
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // size es el tamaño real del lienzo en pantalla, medido (no supuesto).
  const [size, setSize] = useState({ width: 0, height: 0 });

  // viewRef guarda el ENCUADRE con el que se pintó el último fotograma: cuánto se encogió el mapa
  // para que cupiera entero y cuánto se desplazó para quedar centrado (ver fitViewTransform).
  //
  // Por qué se guarda y no se recalcula donde haga falta, en español: el dibujo y la detección del
  // ratón TIENEN que usar exactamente el mismo encuadre. Si cada uno lo calculara por su cuenta, un
  // punto se pintaría en un sitio y respondería al clic en otro — el defecto más desconcertante que
  // puede tener un mapa, porque parece que el ratón está mal calibrado.
  const viewRef = useRef<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 });

  // palette son los colores del tema activo, ya resueltos.
  const [palette, setPalette] = useState<Palette | null>(null);

  // reducedMotion es la preferencia del sistema, escuchada en vivo (se puede cambiar sin recargar).
  const [reducedMotion, setReducedMotion] = useState(false);

  // cursorId es el punto que tiene el foco del teclado dentro del mapa, o null si ninguno.
  const [cursorId, setCursorId] = useState<string | null>(null);

  // hoveredId es el punto que está bajo el ratón, o null.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // settledRequest guarda QUÉ encargo de colocación terminó de acomodarse.
  //
  // Por qué se guarda el encargo y no un simple "sí/no", en español: con un sí/no habría que
  // apagarlo a mano cada vez que cambia el mapa, y apagar un estado en el momento exacto en que otro
  // cambia es de las cosas que peor envejecen (se olvida un caso y el rótulo se queda diciendo
  // "quieto" mientras los puntos se mueven). Guardando el encargo, la comparación de abajo deja de
  // coincidir sola en cuanto cambia cualquier cosa, sin que haya que acordarse de nada.
  const [settledRequest, setSettledRequest] = useState<GraphLayoutRequest | null>(null);

  // orderedNodes es el orden ESTABLE en el que las flechas izquierda y derecha recorren el mapa.
  //
  // En español: primero los títulos (que es tu biblioteca y lo que se busca casi siempre) y después
  // los vínculos por tipo, de fuerte a flojo, y dentro de cada grupo del que más une al que menos. Es
  // un orden que se puede predecir, y eso importa mucho más de lo que parece: recorrer un mapa a
  // ciegas con un orden impredecible es exactamente igual de inútil que no poder recorrerlo.
  const orderedNodes = useMemo(() => {
    const rank = (node: GraphNode) =>
      node.kind === "title" ? 0 : ATTRIBUTE_KINDS.indexOf(node.kind) + 1;
    return [...graph.nodes].sort((left, right) => {
      const rankDifference = rank(left) - rank(right);
      if (rankDifference !== 0) {
        return rankDifference;
      }
      if (left.degree !== right.degree) {
        return right.degree - left.degree;
      }
      return left.label.localeCompare(right.label, "es-MX");
    });
  }, [graph.nodes]);

  // nodeById permite encontrar un punto por su identificador sin recorrer la lista entera.
  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );

  // highlightedIds son los puntos que quedan iluminados: el resaltado y todo lo que cuelga de él.
  // Sin resaltado, null significa "todo encendido por igual".
  const highlightedIds = useMemo(() => {
    if (selectedId === null) {
      return null;
    }
    const ids = neighbourIdsOf(graph, selectedId);
    ids.add(selectedId);
    return ids;
  }, [graph, selectedId]);

  // radiusScale es cuánto hay que encoger los puntos para que quepan con holgura en este lienzo.
  //
  // Se calcula ARRIBA, antes que nada, porque tres cosas tienen que usar exactamente el mismo número:
  // la simulación (para dejar el sitio justo entre puntos), el dibujo (para pintarlos) y la detección
  // del ratón (para saber sobre cuál se está). Si cada una lo calculara por su cuenta, un punto se
  // pintaría de un tamaño y respondería al clic con otro. Ver fitRadiusScale.
  const radiusScale = useMemo(
    () => fitRadiusScale(graph.nodes, size.width, size.height),
    [graph.nodes, size.width, size.height],
  );

  // matchedIds son los puntos que coinciden con lo que se ha escrito en el buscador.
  const matchedIds = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (needle === "") {
      return null;
    }
    return new Set(
      graph.nodes
        .filter((node) => node.label.toLowerCase().includes(needle))
        .map((node) => node.id),
    );
  }, [graph.nodes, searchQuery]);

  // ----- Medir el lienzo y leer la paleta -------------------------------------------------------

  // El tamaño se MIDE con un observador en vez de suponerse: el mapa vive dentro de una página que
  // cambia de ancho al girar el teléfono, al abrir la barra lateral o al cambiar de zoom.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect === undefined) {
        return;
      }
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // La paleta se lee al montar y cada vez que cambia el tema. El tema se detecta vigilando el
  // atributo data-theme del documento, que es donde el perfil lo escribe.
  useEffect(() => {
    const refresh = () => setPalette(readPalette());
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // La preferencia de movimiento se escucha en vivo: se puede cambiar sin recargar la página.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // ----- Dibujar ---------------------------------------------------------------------------------

  // draw pinta el mapa completo con lo que haya en este momento en las referencias y el estado.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null || palette === null || size.width === 0 || size.height === 0) {
      return;
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      return;
    }

    // La pantalla de un teléfono tiene dos o tres puntos físicos por cada punto de dibujo. Sin este
    // ajuste, todo saldría borroso: el lienzo se pinta a la resolución real y luego se encoge.
    //
    // EL TAMAÑO SOLO SE TOCA CUANDO CAMBIA DE VERDAD, y esto no es una optimización cosmética: fue un
    // defecto medido. Asignar el ancho o el alto de un lienzo —aunque sea el mismo número que ya
    // tenía— obliga al navegador a tirar su memoria y reservarla otra vez desde cero. Haciéndolo en
    // cada imagen, cada fotograma costaba unos 30 milisegundos en vez de los 16,7 que dura uno, y la
    // colocación tardaba 4,5 segundos en pararse en lugar de 2,5 — con un mapa pequeño IGUAL que con
    // uno grande, que fue la pista de que el coste no venía de dibujar sino de reservar.
    const ratio = window.devicePixelRatio || 1;
    const wantedWidth = Math.round(size.width * ratio);
    const wantedHeight = Math.round(size.height * ratio);
    if (canvas.width !== wantedWidth || canvas.height !== wantedHeight) {
      canvas.width = wantedWidth;
      canvas.height = wantedHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    const positions = positionsRef.current;

    // (0) EL ENCUADRE: se mide todo el mapa y se calcula desde qué distancia hay que mirarlo para que
    // quepa entero. Se recalcula en cada fotograma, que es lo que hace que durante el segundo y medio
    // en que los puntos se están buscando el sitio el conjunto se mantenga siempre dentro del marco
    // en vez de irse por los bordes. Cuesta un recorrido de la lista de puntos: nada.
    const laidOutPoints: { x: number; y: number; radius: number }[] = [];
    for (const node of graph.nodes) {
      const position = positions.get(node.id);
      if (position !== undefined) {
        laidOutPoints.push({
          x: position.x,
          y: position.y,
          radius: nodeRadius(node.degree, radiusScale),
        });
      }
    }
    const view = fitViewTransform(laidOutPoints, size.width, size.height);
    viewRef.current = view;

    // screenX/screenY llevan un punto del espacio de la colocación a su píxel del lienzo.
    const screenX = (x: number) => view.offsetX + x * view.scale;
    const screenY = (y: number) => view.offsetY + y * view.scale;

    // El umbral de los nombres se ajusta al tamaño del mapa (ver LABEL_MIN_DEGREE).
    const labelMinDegree =
      graph.nodes.length > DENSE_NODE_COUNT ? LABEL_MIN_DEGREE_DENSE : LABEL_MIN_DEGREE;

    // (1) Los hilos, primero, para que los puntos queden por encima.
    for (const edge of graph.edges) {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      if (from === undefined || to === undefined) {
        continue;
      }
      const attribute = nodeById.get(edge.target);
      const strong = attribute?.kind === "cast" || attribute?.kind === "director";
      const dimmed =
        highlightedIds !== null &&
        !(highlightedIds.has(edge.source) && highlightedIds.has(edge.target));
      context.globalAlpha = dimmed
        ? EDGE_ALPHA_DIMMED
        : strong
          ? EDGE_ALPHA_STRONG
          : EDGE_ALPHA_WEAK;
      context.strokeStyle = attribute ? palette.byKind[attribute.kind] : palette.border;
      context.lineWidth = strong ? 1.4 : 1;
      context.beginPath();
      context.moveTo(screenX(from.x), screenY(from.y));
      context.lineTo(screenX(to.x), screenY(to.y));
      context.stroke();
    }

    // pendingLabels recoge los nombres CANDIDATOS a escribirse. No se escriben aquí mismo, dentro del
    // mismo recorrido que dibuja los puntos, y ese cambio es justo la corrección: escribiéndolos sobre
    // la marcha, el orden lo decidía el azar de la lista y unos nombres se pintaban encima de otros
    // hasta dejar zonas del mapa convertidas en una mancha de texto. Ahora se recogen todos, se
    // ordenan por importancia y se escriben en un segundo paso, saltándose los que ya no caben.
    const pendingLabels: PendingLabel[] = [];

    // (2) Los puntos, cada uno con la forma de su tipo.
    for (const node of graph.nodes) {
      const position = positions.get(node.id);
      if (position === undefined) {
        continue;
      }
      // El radio se encoge con el encuadre, igual que las distancias: si no, al alejarse la vista los
      // círculos se comerían el mapa y volverían a solaparse.
      const radius = nodeRadius(node.degree, radiusScale) * view.scale;
      const x = screenX(position.x);
      const y = screenY(position.y);
      const dimmed = highlightedIds !== null && !highlightedIds.has(node.id);
      const matched = matchedIds !== null && matchedIds.has(node.id);
      const color = palette.byKind[node.kind];

      context.globalAlpha = dimmed ? NODE_ALPHA_DIMMED : 1;
      context.fillStyle = color;
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      drawNodeShape(context, node.kind, x, y, radius);
      // Los títulos van rellenos y los vínculos huecos: es lo que distingue de un vistazo "lo que
      // viste" de "la razón por la que se parecen", incluso sin poder leer el nombre.
      if (node.kind === "title") {
        context.globalAlpha = dimmed ? NODE_ALPHA_DIMMED : 0.32;
        context.fill();
        context.globalAlpha = dimmed ? NODE_ALPHA_DIMMED : 1;
      }
      context.stroke();

      // Lo que coincide con la búsqueda lleva un aro extra: es la forma de "centrar el mapa en algo"
      // sin tener que esconder el resto.
      if (matched) {
        context.globalAlpha = 1;
        context.strokeStyle = palette.text;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x, y, radius + FOCUS_RING_GAP_PX, 0, Math.PI * 2);
        context.stroke();
      }

      // El nombre: en los VÍNCULOS que estructuran el mapa, y en cualquier punto —título incluido—
      // que esté enfocado, señalado con el ratón, resaltado o coincidiendo con la búsqueda. Nunca en
      // todo a la vez (ver LABEL_MIN_DEGREE para el porqué).
      const requested =
        node.id === cursorId || node.id === hoveredId || node.id === selectedId || matched;
      const structural = node.kind !== "title" && node.degree >= labelMinDegree;
      if ((requested || structural) && !dimmed) {
        pendingLabels.push({
          text: shortenLabel(node.label),
          x,
          y: y + radius + LABEL_OFFSET_PX,
          priority: requested ? LABEL_PRIORITY_REQUESTED : LABEL_PRIORITY_STRUCTURAL,
          degree: node.degree,
        });
      }
    }

    // (3) Los nombres, ya sin pisarse.
    //
    // Cómo se decide cuáles caben, en español: primero los que la persona ha pedido ver (el enfocado,
    // el señalado, el resaltado y los que encajan con su búsqueda), que se escriben SIEMPRE porque no
    // verlos sería un fallo de la función que los pidió. Después, los vínculos que estructuran el
    // mapa, del que une a más cosas al que une a menos. Cada nombre se mide de verdad con la
    // tipografía que se va a usar y se compara con el sitio que ya ocupan los anteriores: si choca, no
    // se escribe. El resultado es menos nombres, pero todos legibles — que es la diferencia entre un
    // mapa que se puede leer y una mancha de texto encabalgado.
    context.font = `${LABEL_FONT_PX}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.globalAlpha = 1;
    context.fillStyle = palette.text;
    pendingLabels.sort((left, right) =>
      left.priority !== right.priority
        ? left.priority - right.priority
        : right.degree - left.degree,
    );
    const drawnLabelBoxes: LabelBox[] = [];
    for (const label of pendingLabels) {
      const halfWidth = context.measureText(label.text).width / 2 + LABEL_PADDING_PX;
      const box: LabelBox = {
        left: label.x - halfWidth,
        right: label.x + halfWidth,
        top: label.y - LABEL_PADDING_PX,
        bottom: label.y + LABEL_FONT_PX + LABEL_PADDING_PX,
      };
      // Los pedidos se escriben pase lo que pase; los estructurales, solo si el hueco está libre.
      if (label.priority !== LABEL_PRIORITY_REQUESTED) {
        // Fuera del lienzo no se escribe: un nombre cortado por el borde no se lee y además tapa.
        if (box.left < 0 || box.right > size.width || box.bottom > size.height) {
          continue;
        }
        if (drawnLabelBoxes.some((drawn) => overlaps(drawn, box))) {
          continue;
        }
      }
      drawnLabelBoxes.push(box);
      context.fillText(label.text, label.x, label.y);
    }

    // (4) El aro del foco del teclado, encima de todo para que nunca quede tapado.
    if (cursorId !== null) {
      const node = nodeById.get(cursorId);
      const position = positions.get(cursorId);
      if (node !== undefined && position !== undefined) {
        context.globalAlpha = 1;
        context.strokeStyle = palette.byKind.title;
        context.lineWidth = FOCUS_RING_WIDTH_PX;
        context.beginPath();
        context.arc(
          screenX(position.x),
          screenY(position.y),
          nodeRadius(node.degree, radiusScale) * view.scale +
            FOCUS_RING_GAP_PX +
            FOCUS_RING_WIDTH_PX,
          0,
          Math.PI * 2,
        );
        context.stroke();
      }
    }

    context.globalAlpha = 1;
  }, [
    graph,
    nodeById,
    palette,
    size,
    highlightedIds,
    matchedIds,
    cursorId,
    hoveredId,
    selectedId,
    radiusScale,
  ]);

  // drawRef mantiene siempre la última versión de draw, para que el bucle de animación —que se crea
  // una sola vez— no acabe pintando con datos viejos. Se actualiza en un efecto y no durante el
  // dibujado del componente: tocar una referencia mientras React está construyendo la pantalla es un
  // efecto secundario escondido, y React avisa de ello con razón.
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Cualquier cambio de resaltado, foco o paleta vuelve a pintar. No hay que recalcular posiciones.
  useEffect(() => {
    draw();
  }, [draw]);

  // ----- Colocar los puntos ----------------------------------------------------------------------

  // layoutRequest es el encargo que se manda a la simulación (o al hilo aparte).
  const layoutRequest = useMemo<GraphLayoutRequest>(() => {
    const nodes = graph.nodes.map((node) => ({ id: node.id, degree: node.degree }));
    return {
      nodes,
      edges: graph.edges.map((edge) => ({ source: edge.source, target: edge.target })),
      width: size.width,
      height: size.height,
      // El factor de tamaño calculado arriba: viaja DENTRO del encargo para que el hilo aparte, que
      // no ve nada del componente, coloque los puntos con el mismo tamaño que se van a dibujar.
      radiusScale,
    };
  }, [graph, size, radiusScale]);

  // settled es cierto cuando el encargo que se está viendo ES el que ya terminó de acomodarse.
  // En cuanto cambia el mapa, el lienzo o los filtros, el encargo es otro y esto pasa a falso solo.
  const settled = settledRequest === layoutRequest;

  // simulationRef guarda la simulación EN CURSO junto con el encargo al que corresponde.
  //
  // Por qué se guarda, en español: el botón de pausa detiene el bucle y volver a pulsarlo lo
  // reanuda. Sin esta referencia, cada pausa tiraría la simulación a la basura y al reanudar los
  // puntos volverían a salir despedidos desde el principio, como si se hubiera recargado la página.
  // Guardándola, reanudar continúa exactamente donde se dejó, que es lo que significa "pausar".
  const simulationRef = useRef<{
    request: GraphLayoutRequest;
    simulation: ReturnType<typeof buildSimulation>;
  } | null>(null);

  // recordMeasurement anota cuánto tardó la colocación y dónde se hizo, en los atributos del mapa.
  //
  // Se escribe directamente en el elemento, sin pasar por el estado de React, porque este dato NO
  // forma parte de lo que la pantalla enseña: es una anotación para poder observar el comportamiento
  // desde fuera (las herramientas del navegador y las pruebas automáticas la leen igual de bien).
  // Pasarlo por el estado obligaría a re-dibujar la pantalla entera para cambiar un atributo que
  // nadie ve. Antes esto se escribía como texto visible junto al recuento del mapa; ver
  // LayoutMeasurement para por qué se sacó de la vista.
  const recordMeasurement = useCallback((measurement: LayoutMeasurement) => {
    const element = containerRef.current;
    if (element === null) {
      return;
    }
    element.dataset.layoutMs = String(measurement.elapsedMs);
    element.dataset.layoutOrigin = measurement.origin;
    element.dataset.layoutNodes = String(measurement.nodeCount);
    element.dataset.layoutEdges = String(measurement.edgeCount);
  }, []);

  useEffect(() => {
    // Sin puntos o sin lienzo medido todavía no hay nada que colocar. Las medidas se leen del propio
    // encargo (que ya las lleva dentro) y no del estado: así esta comprobación y el cálculo miran
    // exactamente los mismos números, sin que puedan desincronizarse.
    if (
      layoutRequest.nodes.length === 0 ||
      layoutRequest.width === 0 ||
      layoutRequest.height === 0
    ) {
      return;
    }

    // --- CAMINO A: quien pidió MENOS MOVIMIENTO. Nada de animación: el resultado, ya quieto. ---
    //
    // El cálculo entero de golpe son unos 840 milisegundos en el peor caso medido, y hacerlo en la
    // fila principal dejaría la página congelada todo ese rato. Así que se manda a un hilo aparte.
    // Si el hilo no se puede crear —navegador antiguo, política de seguridad más estricta de lo que
    // esperábamos—, se hace aquí mismo: lento, pero funciona. Nunca se queda sin mapa.
    if (reducedMotion) {
      let cancelled = false;
      let worker: Worker | null = null;
      // fallbackTimer es el aplazamiento del plan B (ver más abajo). Vale 0 cuando no hay ninguno.
      let fallbackTimer = 0;

      // computeHere es el plan B: la misma cuenta, en la fila principal.
      const computeHere = () => {
        const result = computeStaticLayout(layoutRequest);
        applyPositions(result);
        recordMeasurement({
          elapsedMs: result.elapsedMs,
          origin: "main",
          nodeCount: layoutRequest.nodes.length,
          edgeCount: layoutRequest.edges.length,
        });
      };

      // applyPositions guarda el resultado y pinta una sola vez.
      const applyPositions = (result: GraphLayoutResponse) => {
        const positions = new Map<string, { x: number; y: number }>();
        for (const position of result.positions) {
          positions.set(position.id, { x: position.x, y: position.y });
        }
        positionsRef.current = positions;
        setSettledRequest(layoutRequest);
        drawRef.current();
      };

      try {
        // La dirección del archivo se escribe así, con new URL e import.meta.url, porque es la forma
        // que el empaquetador reconoce para generar el hilo como un archivo propio de NUESTRO
        // dominio. Escribirlo como un texto suelto no funcionaría, y generarlo como "blob:" lo
        // bloquearía la política de seguridad del sitio.
        worker = new Worker(new URL("../../lib/graph-layout.worker.ts", import.meta.url), {
          type: "module",
        });
        worker.addEventListener("message", (event: MessageEvent<GraphLayoutResponse>) => {
          if (cancelled) {
            return;
          }
          applyPositions(event.data);
          recordMeasurement({
            elapsedMs: event.data.elapsedMs,
            origin: "worker",
            nodeCount: layoutRequest.nodes.length,
            edgeCount: layoutRequest.edges.length,
          });
        });
        worker.addEventListener("error", () => {
          if (cancelled) {
            return;
          }
          // El hilo existía pero falló al ejecutarse. Se registra —es un fallo real que hay que poder
          // ver— y se recalcula aquí para que la persona no se quede sin mapa.
          console.error("El hilo aparte del mapa falló; se calcula en la página.");
          computeHere();
        });
        worker.postMessage(layoutRequest);
      } catch (cause) {
        console.error(`No se pudo crear el hilo aparte del mapa: ${String(cause)}`);
        // El plan B se aplaza al siguiente instante libre A PROPÓSITO, no por capricho: calcularlo
        // aquí mismo congelaría la página casi un segundo ANTES de que el navegador haya llegado a
        // pintar el aviso de "calculando", así que la persona vería la pantalla trabada sin ninguna
        // explicación. Aplazándolo, primero se pinta el aviso y luego se hace la cuenta.
        fallbackTimer = window.setTimeout(computeHere, 0);
      }

      return () => {
        cancelled = true;
        worker?.terminate();
        if (fallbackTimer !== 0) {
          window.clearTimeout(fallbackTimer);
        }
      };
    }

    // --- CAMINO B: quien SÍ ve la animación. La simulación corre a la vista, un paso por fotograma. ---
    //
    // Cada paso cuesta 2,8 milisegundos de los 16,7 que dura un fotograma, así que va de sobra en la
    // fila principal y la persona ve el mapa buscarse el sitio durante un segundo. Se para sola al
    // enfriarse, y el botón de pausa la detiene antes en cualquier momento.
    // Si ya había una simulación en marcha para ESTE mismo encargo (es decir, venimos de una pausa),
    // se retoma tal cual. Si el encargo es otro, se crea una nueva.
    const existing = simulationRef.current;
    const simulation =
      existing !== null && existing.request === layoutRequest
        ? existing.simulation
        : buildSimulation(layoutRequest);
    simulationRef.current = { request: layoutRequest, simulation };
    const startedAt = Date.now();
    let frame = 0;
    let stopped = false;

    // readPositions vuelca dónde está cada punto ahora mismo en la referencia que usa el dibujo.
    const readPositions = () => {
      const positions = new Map<string, { x: number; y: number }>();
      for (const node of simulation.nodes()) {
        positions.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
      }
      positionsRef.current = positions;
    };

    // lastFrameAt es cuándo se pintó la imagen anterior, para saber cuánto tiempo real ha pasado.
    let lastFrameAt = Date.now();

    const step = () => {
      if (stopped) {
        return;
      }
      // Cuántos pasos toca dar: los que correspondan al tiempo transcurrido (ver MAX_TICKS_PER_FRAME).
      const now = Date.now();
      const ticks = Math.min(
        Math.max(Math.round((now - lastFrameAt) / TARGET_FRAME_MS), 1),
        MAX_TICKS_PER_FRAME,
      );
      lastFrameAt = now;
      // Los puntos se dejan extender libremente: quien se encarga de que quepa todo es el ENCUADRE
      // del dibujo (ver fitViewTransform), no un empujón contra los bordes. Antes se empujaba, y con
      // una biblioteca grande el resultado era un marco de puntos aplastados contra los cuatro lados.
      simulation.tick(ticks);
      readPositions();
      drawRef.current();
      const elapsed = Date.now() - startedAt;
      if (simulation.alpha() < ANIMATION_ALPHA_FLOOR || elapsed > MAX_ANIMATION_MS) {
        stopped = true;
        setSettledRequest(layoutRequest);
        recordMeasurement({
          elapsedMs: elapsed,
          origin: "main",
          nodeCount: layoutRequest.nodes.length,
          edgeCount: layoutRequest.edges.length,
        });
        return;
      }
      frame = window.requestAnimationFrame(step);
    };

    // El botón de pausa: si está pulsado, no se arranca el bucle. Los puntos se quedan donde están.
    if (paused) {
      readPositions();
      drawRef.current();
    } else {
      frame = window.requestAnimationFrame(step);
    }

    return () => {
      // Solo se detiene el bucle de fotogramas. La simulación NO se destruye: puede que esto sea una
      // pausa y haya que continuar desde donde estaba. La construye ya parada (ver buildSimulation),
      // así que no queda nada corriendo por su cuenta.
      stopped = true;
      window.cancelAnimationFrame(frame);
    };
  }, [layoutRequest, reducedMotion, paused, recordMeasurement]);

  // settledLabel es lo que la página enseña sobre el estado de la colocación.
  const stateLabel = reducedMotion
    ? settled
      ? ui.graph.still
      : ui.graph.computing
    : paused
      ? ui.graph.paused
      : settled
        ? ui.graph.still
        : ui.graph.settling;

  // ----- Encontrar el punto que hay bajo un lugar del lienzo ------------------------------------

  // nodeAt averigua qué punto ocupa una posición del lienzo, o null si es hueco.
  //
  // Sobre el método, en español: recorre todos los puntos y se queda con el primero cuyo círculo
  // contiene ese lugar. Suena rudimentario y a esta escala lo es a propósito: nuestro peor caso son
  // unos seiscientos puntos, y recorrer seiscientos números es tan barato que montar una estructura
  // espacial para acelerarlo sería añadir una pieza que puede desincronizarse a cambio de nada
  // medible. Si algún día el mapa creciera un orden de magnitud, ahí sí tocaría.
  const nodeAt = useCallback(
    (x: number, y: number): GraphNode | null => {
      const positions = positionsRef.current;
      // El MISMO encuadre con el que se pintó el último fotograma. Es imprescindible que sea el mismo
      // objeto y no un cálculo paralelo: si el dibujo mirara el mapa desde una distancia y el ratón
      // desde otra, cada punto respondería al clic en un sitio distinto de donde se ve.
      const view = viewRef.current;
      for (const node of graph.nodes) {
        const position = positions.get(node.id);
        if (position === undefined) {
          continue;
        }
        const radius = nodeRadius(node.degree, radiusScale) * view.scale;
        const dx = view.offsetX + position.x * view.scale - x;
        const dy = view.offsetY + position.y * view.scale - y;
        if (dx * dx + dy * dy <= radius * radius) {
          return node;
        }
      }
      return null;
    },
    [graph.nodes, radiusScale],
  );

  // activate es lo que pasa al "abrir" un punto, venga del ratón o de la tecla Enter.
  // Un título abre su ficha; un vínculo resalta todo lo que cuelga de él (y si ya estaba resaltado,
  // lo suelta, que es lo que cualquiera espera al volver a pulsarlo).
  const activate = useCallback(
    (node: GraphNode) => {
      if (node.kind === "title" && node.releaseId !== undefined) {
        onOpenTitle(node.releaseId);
        return;
      }
      onSelect(node.id === selectedId ? null : node.id);
    },
    [onOpenTitle, onSelect, selectedId],
  );

  // ----- Ratón ----------------------------------------------------------------------------------

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas === null) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const node = nodeAt(event.clientX - rect.left, event.clientY - rect.top);
      setHoveredId(node?.id ?? null);
    },
    [nodeAt],
  );

  const handlePointerLeave = useCallback(() => setHoveredId(null), []);

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas === null) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const node = nodeAt(event.clientX - rect.left, event.clientY - rect.top);
      if (node === null) {
        // Pulsar en el vacío suelta el resaltado: es la salida más natural y nadie la busca en un menú.
        onSelect(null);
        return;
      }
      setCursorId(node.id);
      activate(node);
    },
    [activate, nodeAt, onSelect],
  );

  // ----- Teclado --------------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (orderedNodes.length === 0) {
        return;
      }
      const currentIndex =
        cursorId === null ? -1 : orderedNodes.findIndex((n) => n.id === cursorId);

      // Izquierda y derecha: recorrer los puntos en el orden estable, dando la vuelta al llegar al
      // final (nadie debería quedarse encallado en el último punto sin saber que era el último).
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex =
          currentIndex === -1
            ? 0
            : (currentIndex + step + orderedNodes.length) % orderedNodes.length;
        setCursorId(orderedNodes[nextIndex].id);
        return;
      }

      // Arriba y abajo: saltar a lo que está CONECTADO con el punto actual. Es lo que convierte el
      // mapa en algo recorrible de verdad sin verlo: los hilos dejan de ser decoración y pasan a ser
      // los caminos.
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (cursorId === null) {
          setCursorId(orderedNodes[0].id);
          return;
        }
        // Los vecinos se calculan UNA vez y luego se filtra: hacerlo dentro del filtro recorrería
        // todos los hilos del mapa por cada punto, que con seiscientos puntos se nota al teclear.
        const neighbourIds = neighbourIdsOf(graph, cursorId);
        const neighbours = orderedNodes.filter((node) => neighbourIds.has(node.id));
        if (neighbours.length === 0) {
          return;
        }
        const step = event.key === "ArrowDown" ? 1 : -1;
        const inNeighbours = neighbours.findIndex((node) => node.id === cursorId);
        const nextIndex =
          inNeighbours === -1
            ? event.key === "ArrowDown"
              ? 0
              : neighbours.length - 1
            : (inNeighbours + step + neighbours.length) % neighbours.length;
        setCursorId(neighbours[nextIndex].id);
        return;
      }

      // Inicio y Fin: al primero y al último. Con seiscientos puntos, llegar al final a base de
      // flechas no es una opción razonable.
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        setCursorId(orderedNodes[event.key === "Home" ? 0 : orderedNodes.length - 1].id);
        return;
      }

      // Enter y espacio: abrir lo que hay debajo del foco.
      if (event.key === "Enter" || event.key === " ") {
        if (cursorId === null) {
          return;
        }
        const node = nodeById.get(cursorId);
        if (node === undefined) {
          return;
        }
        event.preventDefault();
        activate(node);
        return;
      }

      // Escape: soltar el resaltado y salir del mapa, que es lo que todo el mundo intenta primero
      // cuando quiere irse de un sitio.
      if (event.key === "Escape") {
        event.preventDefault();
        onSelect(null);
        setCursorId(null);
        containerRef.current?.blur();
      }
    },
    [activate, cursorId, graph, nodeById, onSelect, orderedNodes],
  );

  // Al entrar en el mapa con el tabulador, el foco se posa en el primer punto en vez de en la nada:
  // llegar a un sitio y que no se anuncie nada es indistinguible de que esté roto.
  const handleFocus = useCallback(() => {
    if (cursorId === null && orderedNodes.length > 0) {
      setCursorId(orderedNodes[0].id);
    }
  }, [cursorId, orderedNodes]);

  // announcement es la frase que se lee en voz alta al moverse por el mapa.
  const announcement = useMemo(() => {
    if (orderedNodes.length === 0) {
      return ui.graph.canvasEmptyForScreenReader;
    }
    if (cursorId === null) {
      return "";
    }
    const node = nodeById.get(cursorId);
    if (node === undefined) {
      return "";
    }
    return node.kind === "title"
      ? ui.graph.announceTitle(node.label, node.degree)
      : ui.graph.announceAttribute(KIND_LABELS[node.kind], node.label, node.degree);
  }, [cursorId, nodeById, orderedNodes.length]);

  return (
    <div className="pg-canvas-wrap">
      {/*
        El contenedor es UN SOLO punto de entrada con el tabulador y es quien recibe las teclas.
        aria-describedby lo enlaza con las instrucciones, que están escritas a la vista de todos y no
        escondidas solo para lectores de pantalla: quien navega con teclado y ve la pantalla las
        necesita exactamente igual.
      */}
      <div
        ref={containerRef}
        className="pg-canvas-focus"
        role="application"
        tabIndex={0}
        aria-label={ui.graph.canvasLabel}
        aria-describedby="pg-keyboard-hint"
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        data-settled={settled ? "true" : "false"}
      >
        <canvas
          ref={canvasRef}
          className="pg-canvas"
          style={{ width: "100%", height: "100%" }}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onClick={handleClick}
          // El lienzo en sí no aporta nada a quien no lo ve: todo lo que dibuja está anunciado por el
          // contenedor y escrito en la lista de al lado.
          aria-hidden="true"
        />
      </div>

      {/*
        La región que habla. Va aparte del contenedor a propósito: un texto que cambia dentro del
        propio elemento enfocado no siempre se vuelve a anunciar, mientras que una región "en vivo"
        se lee cada vez que su contenido cambia. Es lo que hace que moverse por el mapa suene a algo.
      */}
      <p className="pg-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {/* El estado de la colocación, visible: acomodando, en pausa o quieto. */}
      <p className="pg-canvas-state font-mono" data-state={settled ? "still" : "moving"}>
        {stateLabel}
      </p>
    </div>
  );
}

// drawNodeShape dibuja la silueta de un punto según su tipo, sin rellenarla ni trazarla todavía.
//
// En español: cada tipo tiene una forma distinta para que se distingan aunque no se lea el nombre y
// aunque alguien no perciba bien los colores — que es exactamente el motivo por el que la forma no
// puede ser la misma para todos con un color diferente. Los títulos y las personas son círculos (lo
// vivo), los géneros rombos y las plataformas cuadrados (lo administrativo).
function drawNodeShape(
  context: CanvasRenderingContext2D,
  kind: GraphNodeKind,
  x: number,
  y: number,
  radius: number,
): void {
  context.beginPath();
  if (kind === "genre") {
    context.moveTo(x, y - radius);
    context.lineTo(x + radius, y);
    context.lineTo(x, y + radius);
    context.lineTo(x - radius, y);
    context.closePath();
    return;
  }
  if (kind === "platform") {
    const side = radius * 1.6;
    context.rect(x - side / 2, y - side / 2, side, side);
    return;
  }
  context.arc(x, y, radius, 0, Math.PI * 2);
}
