// Archivo: graph-layout.ts — Dónde se coloca cada punto del mapa personal.
//
// Qué es esto, en español:
//
// El archivo personal-graph.ts decide QUIÉN se conecta con QUIÉN. Este decide DÓNDE se dibuja cada
// cosa. Son dos problemas muy distintos y cuestan cosas muy distintas: averiguar las conexiones son
// milisegundos; repartir los puntos por la pantalla sin que se amontonen es una simulación física y
// es lo caro.
//
// La simulación funciona como un móvil de cuna: cada punto empuja a los demás para apartarse, cada
// hilo tira de sus dos extremos para acercarlos, y una fuerza suave los atrae al centro para que no
// se escapen de la pantalla. Se deja "temblar" unos cientos de pasos y el conjunto se acomoda solo:
// lo que está muy conectado queda en el centro, lo que cuelga de una sola cosa queda en la orilla.
// Nadie decide esas posiciones a mano; emergen de las conexiones.
//
// POR QUÉ NO SE USA NINGUNA LIBRERÍA DE GRAFOS, y esto está medido, no opinado:
//
// Se revisaron las nueve opciones vigentes del mercado. Ocho de las nueve NO TIENEN NI UNA SOLA MARCA
// DE ACCESIBILIDAD en su código: ni foco por nodo, ni teclado, ni anuncio por voz. Es decir, con
// cualquiera de ellas ese trabajo —que en este proyecto no es negociable— habría que hacerlo a mano
// igualmente, pero peleando contra una librería que ya te quitó el control del HTML. La única que sí
// la tiene dibuja con elementos HTML normales y sus propios autores desaconsejan pasar de mil puntos,
// que es justo nuestro peor caso. Además dos de ellas descargan recursos de servidores ajenos o crean
// hilos desde direcciones "blob:", y las dos cosas las bloquea la política de seguridad del sitio.
//
// Así que solo se trae d3-force (5,5 KB, licencia ISC, tres dependencias) para COLOCAR los puntos, y
// el dibujo se hace en un lienzo propio. Es entre 7 y 26 veces más ligero que cualquier alternativa.

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

// LayoutNodeInput es lo mínimo que la colocación necesita saber de un punto.
//
// En español: no le pasamos el nodo entero del mapa porque este objeto viaja a un hilo aparte, y
// cuanto menos se copie, menos cuesta el viaje. Basta con quién es y cuánto pesa.
export type LayoutNodeInput = {
  // id identifica al punto (el mismo identificador que usa personal-graph).
  id: string;
  // degree es a cuántas cosas toca. Decide su tamaño y, con él, cuánto sitio reclama.
  degree: number;
};

// LayoutEdgeInput es un hilo entre dos puntos, nombrados por su identificador.
export type LayoutEdgeInput = {
  source: string;
  target: string;
};

// GraphLayoutRequest es todo lo que hace falta para calcular una colocación.
//
// En español: los puntos, los hilos y el tamaño del lienzo. Es un objeto plano a propósito: así se
// puede mandar tal cual a un hilo aparte, que solo sabe copiar datos simples.
export type GraphLayoutRequest = {
  nodes: LayoutNodeInput[];
  edges: LayoutEdgeInput[];
  width: number;
  height: number;
  // radiusScale encoge todos los puntos por igual cuando hay demasiados para el sitio que hay.
  // Vale 1 cuando caben holgados. Ver fitRadiusScale para el porqué y cómo se calcula.
  radiusScale: number;
};

// NodePosition es dónde acabó un punto.
export type NodePosition = {
  id: string;
  x: number;
  y: number;
};

// GraphLayoutResponse es el resultado de la colocación, más cuánto tardó.
//
// En español: el tiempo se devuelve porque es un dato que hay que poder mirar en producción. La
// investigación midió 840 ms en el peor caso y esa cifra es la que justifica todo el diseño de esta
// pantalla; si algún día cambia, conviene enterarse mirando, no suponiendo.
export type GraphLayoutResponse = {
  positions: NodePosition[];
  elapsedMs: number;
};

// STATIC_TICKS es cuántos pasos de simulación hacen falta para que el conjunto se quede quieto.
//
// En español: trescientos. Es el número que d3-force necesita con sus valores por defecto para que la
// "temperatura" del sistema baje hasta su umbral de reposo. Con menos, el dibujo sale a medio
// acomodar (puntos aún montados unos sobre otros); con más, se gasta tiempo sin que nada se mueva.
const STATIC_TICKS = 300;

// NODE_RADIUS_MIN es el radio, en píxeles, del punto más pequeño posible.
//
// En español: catorce píxeles. Por debajo de eso un punto deja de ser un objetivo pulsable cómodo con
// el dedo y se convierte en una mota que hay que perseguir.
export const NODE_RADIUS_MIN = 14;

// NODE_RADIUS_SCALE es cuánto crece el radio por cada conexión, en la escala de la raíz cuadrada.
//
// Por qué la raíz cuadrada y no una proporción directa: lo que el ojo compara en un círculo es su
// ÁREA, no su radio. Si el radio creciera proporcionalmente, un director con nueve títulos se vería
// nueve veces más "grande" al cuadrado —ochenta y una veces más de mancha— y aplastaría visualmente
// todo lo demás. Con la raíz cuadrada, el área sí crece proporcional al número de conexiones, que es
// lo que la persona lee sin darse cuenta.
export const NODE_RADIUS_SCALE = 5;

// NODE_RADIUS_MAX acota el punto más grande para que un atributo muy repetido no tape media pantalla.
export const NODE_RADIUS_MAX = 46;

// nodeRadius calcula el tamaño de un punto a partir de a cuántas cosas toca.
//
// En español: vive aquí, y no en el componente que dibuja, porque tres sitios distintos tienen que
// coincidir EXACTAMENTE en este número: la simulación (para que los puntos no se solapen), el lienzo
// (para pintarlos) y la detección del ratón (para saber sobre cuál se está). Si cada uno lo calculara
// por su cuenta, el punto se pintaría de un tamaño y respondería al clic con otro.
export function nodeRadius(degree: number, radiusScale = 1): number {
  const radius = NODE_RADIUS_MIN + Math.sqrt(Math.max(degree, 0)) * NODE_RADIUS_SCALE;
  return Math.min(radius, NODE_RADIUS_MAX) * radiusScale;
}

// NODE_AREA_BUDGET es qué parte del lienzo pueden ocupar los puntos, como mucho.
//
// Un cuarto, y el número sale de mirar el mapa dibujado: con los puntos a tamaño fijo y ciento
// cincuenta títulos vistos, ocupaban dos tercios del recuadro y el resultado era un panal de
// circulitos pegados donde no se distinguía ninguna estructura — exactamente la "mancha" que este
// diseño existía para evitar. Por debajo de un cuarto, en cambio, se ven los racimos y los huecos,
// que es lo que cuenta la historia.
const NODE_AREA_BUDGET = 0.25;

// MIN_RADIUS_SCALE es cuánto se pueden encoger los puntos como máximo.
//
// El límite existe por un motivo concreto: por debajo de esto, un punto deja de ser algo que se pueda
// señalar con el dedo. Con una biblioteca enorme se llega a este suelo y el mapa pasa a ser una vista
// de pájaro —para eso están el buscador, los filtros y, sobre todo, la lista, que a ese tamaño es
// mejor herramienta que el dibujo para todo el mundo.
const MIN_RADIUS_SCALE = 0.42;

// fitRadiusScale calcula cuánto hay que encoger los puntos para que quepan con holgura.
//
// En español: se suma el área que ocuparían todos a tamaño natural y se compara con el cuarto de
// lienzo que se les permite ocupar. Si caben, se quedan como están (factor 1). Si no, se encogen
// todos por igual, de modo que los tamaños relativos —que son los que cuentan cuánto pesa cada cosa—
// se conservan intactos.
export function fitRadiusScale(
  nodes: readonly LayoutNodeInput[],
  width: number,
  height: number,
): number {
  if (nodes.length === 0 || width <= 0 || height <= 0) {
    return 1;
  }
  let naturalArea = 0;
  for (const node of nodes) {
    const radius = nodeRadius(node.degree);
    naturalArea += Math.PI * radius * radius;
  }
  if (naturalArea === 0) {
    return 1;
  }
  const allowedArea = width * height * NODE_AREA_BUDGET;
  // La raíz cuadrada porque lo que se ajusta es el ÁREA y lo que se aplica es el RADIO.
  return Math.min(1, Math.max(MIN_RADIUS_SCALE, Math.sqrt(allowedArea / naturalArea)));
}

// LINK_DISTANCE es la longitud "en reposo" de cada hilo, en píxeles.
// En español: es la distancia a la que el hilo deja de tirar. Suficiente para que quepa un punto
// grande entre medias sin que el conjunto se estire hasta perderse de vista.
const LINK_DISTANCE = 62;

// LINK_STRENGTH_LIMIT acota cuánto puede tirar un hilo (de 0 a 1).
//
// En español: d3-force reparte la fuerza de cada hilo según lo conectados que estén sus extremos. En
// un mapa como este hay atributos con cuarenta títulos colgando, y sin tope sus hilos tiran tan poco
// que ese racimo se deshace y queda una nube sin forma. Con el tope, los racimos se leen como racimos.
const LINK_STRENGTH_LIMIT = 0.45;

// REPULSION_STRENGTH es cuánto se empujan los puntos entre sí (negativo = se apartan).
// En español: si es muy flojo, todo se apelmaza en el centro; si es muy fuerte, el mapa explota y
// hay que alejarse tanto que ya no se leen los nombres. Este valor deja los racimos separados y
// legibles con el mapa entero a la vista.
const REPULSION_STRENGTH = -170;

// REPULSION_MAX_DISTANCE corta el empuje a partir de cierta distancia, en píxeles.
//
// Es una decisión de rendimiento con efecto visible: sin corte, cada punto calcula su empujón contra
// todos los demás por lejos que estén, y ese empujón lejano no cambia nada de lo que se ve. Cortarlo
// a 420 píxeles quita la mayor parte del trabajo y el resultado es indistinguible a simple vista.
const REPULSION_MAX_DISTANCE = 420;

// COLLISION_PADDING es el aire que se deja alrededor de cada punto, en píxeles.
// En español: es lo que impide que dos círculos se toquen y sus nombres se pisen.
const COLLISION_PADDING = 6;

// CENTERING_STRENGTH es cuánto tira del conjunto hacia el centro del lienzo (de 0 a 1).
// En español: muy suave a propósito. Solo evita que los grupos sueltos se vayan derivando fuera de la
// pantalla; si fuera fuerte, aplastaría el mapa contra el centro y borraría su estructura.
const CENTERING_STRENGTH = 0.045;

// ALPHA_DECAY es lo deprisa que se "enfría" la simulación: cuánto tarda en pararse sola.
//
// Por qué no se deja el valor de fábrica, y esto está MEDIDO en el navegador: con el enfriamiento por
// defecto de d3, el mapa seguía moviéndose 4,5 segundos con cuatrocientos títulos vistos. Cuatro
// segundos y medio de puntos temblando no aportan nada —el sitio de cada cosa ya se ve al primer
// segundo— y además rozan el límite de cinco segundos a partir del cual la norma de accesibilidad
// exige poder detener el movimiento. Con este valor se para sola en torno a los dos segundos y medio.
//
// El número sale de una cuenta, no de probar a ojo: la simulación se detiene cuando su temperatura
// baja de 0,001, y con este ritmo eso ocurre a los ciento cincuenta pasos, que a sesenta imágenes por
// segundo son dos segundos y medio.
//
// Ojo: esto afecta por igual al mapa animado y al que se calcula de golpe, y es justo lo que se
// quiere. Los dos usan la misma simulación y tienen que dar el MISMO resultado, o quien pidió menos
// movimiento estaría viendo un mapa distinto del de todos los demás.
const ALPHA_DECAY = 0.045;

// SimulationNode es un punto tal y como lo maneja d3-force por dentro (con su posición y velocidad).
type SimulationNode = SimulationNodeDatum & { id: string; degree: number };

// SimulationEdge es un hilo tal y como lo maneja d3-force (sus extremos pasan de texto a objeto).
type SimulationEdge = SimulationLinkDatum<SimulationNode>;

// buildSimulation arma la simulación física con todas sus fuerzas, sin ejecutarla.
//
// En español: se separa de quien la ejecuta porque hay dos formas de usarla y deben ser IDÉNTICAS en
// todo lo demás. Una: dejarla correr a la vista, un paso por fotograma, y que la persona vea el mapa
// acomodarse. Otra: gastarle los trescientos pasos de golpe y enseñar el resultado ya quieto, que es
// lo que recibe quien pidió menos movimiento. Si las fuerzas no fueran las mismas, las dos personas
// verían mapas distintos del mismo dato, que es exactamente lo que no puede pasar.
export function buildSimulation(
  request: GraphLayoutRequest,
): Simulation<SimulationNode, SimulationEdge> {
  // Los nodos se copian a objetos nuevos porque d3-force los MODIFICA: les añade posición y velocidad
  // en cada paso. Trabajar sobre los originales ensuciaría los datos del mapa con campos de dibujo.
  const nodes: SimulationNode[] = request.nodes.map((node) => ({
    id: node.id,
    degree: node.degree,
  }));
  const edges: SimulationEdge[] = request.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
  }));

  const centerX = request.width / 2;
  const centerY = request.height / 2;

  return (
    forceSimulation<SimulationNode, SimulationEdge>(nodes)
      .force(
        "link",
        forceLink<SimulationNode, SimulationEdge>(edges)
          .id((node) => node.id)
          // La longitud de los hilos se encoge con los puntos: si no, con el mapa apretado los hilos
          // seguirían midiendo lo mismo y la estructura se estiraría hasta salirse del recuadro.
          .distance(LINK_DISTANCE * request.radiusScale)
          // La fuerza de cada hilo se toma la que d3 calcularía, pero sin pasar del tope (ver arriba).
          .strength((edge, index, allEdges) => {
            const defaultStrength =
              1 / Math.min(countDegree(edge.source), countDegree(edge.target));
            // Los dos parámetros que no se usan existen porque d3 los pasa siempre; se nombran para que
            // quede claro que se ignoran a propósito y no por descuido.
            void index;
            void allEdges;
            return Math.min(defaultStrength, LINK_STRENGTH_LIMIT);
          }),
      )
      .force(
        "charge",
        forceManyBody<SimulationNode>()
          .strength(REPULSION_STRENGTH)
          .distanceMax(REPULSION_MAX_DISTANCE),
      )
      // El choque impide que dos puntos se monten: cada uno reserva su radio más un poco de aire.
      .force(
        "collide",
        forceCollide<SimulationNode>().radius(
          (node) => nodeRadius(node.degree, request.radiusScale) + COLLISION_PADDING,
        ),
      )
      // El centro y los dos tirones suaves mantienen el conjunto dentro del lienzo.
      .force("center", forceCenter<SimulationNode>(centerX, centerY))
      .force("x", forceX<SimulationNode>(centerX).strength(CENTERING_STRENGTH))
      .force("y", forceY<SimulationNode>(centerY).strength(CENTERING_STRENGTH))
      // El ritmo de enfriamiento (ver ALPHA_DECAY): decide cuándo la colocación se para sola.
      .alphaDecay(ALPHA_DECAY)
      // stop() la deja preparada pero PARADA: quien la use decide si la anima o la gasta de golpe. Sin
      // esto, d3 arrancaría un temporizador propio en cuanto se crea, y el hilo aparte no tiene reloj
      // de fotogramas al que engancharse.
      .stop()
  );
}

// countDegree averigua a cuántas cosas toca el extremo de un hilo.
//
// En español: d3-force sustituye los identificadores de texto por los objetos de cada punto ANTES de
// preguntar por la fuerza, así que en la práctica siempre llega el objeto. El otro caso se contempla
// igualmente —devolviendo 1, que acaba dando la fuerza máxima permitida— porque el tipo lo permite y
// dejarlo sin cubrir sería confiar en un detalle interno de una librería ajena.
function countDegree(endpoint: string | number | SimulationNode): number {
  if (typeof endpoint === "object") {
    return Math.max(endpoint.degree, 1);
  }
  return 1;
}

// CANVAS_MARGIN_PX es cuánto se deja de aire entre el borde del lienzo y lo más externo del mapa.
// En español: sin ese margen, un punto pegado al borde queda con la mitad cortada y su nombre, que se
// escribe debajo, fuera de la vista.
const CANVAS_MARGIN_PX = 16;

// LABEL_SPACE_BELOW_PX es el sitio que hay que reservar DEBAJO de cada punto para su nombre.
// En español: el nombre no se dibuja dentro del círculo sino colgando de él, así que si el encuadre
// solo tuviera en cuenta los círculos, la fila de nombres de abajo se saldría del lienzo.
const LABEL_SPACE_BELOW_PX = 18;

// MAX_FIT_SCALE es lo máximo que el encuadre puede AGRANDAR el mapa.
//
// Uno: el encuadre solo encoge, nunca amplía. Con tres puntos vistos, ampliar hasta llenar la
// pantalla los convertiría en tres globos gigantes separados por medio lienzo vacío — un mapa que
// parece roto. Los tamaños de los puntos ya están calculados para verse bien a tamaño natural
// (ver fitRadiusScale); el encuadre solo tiene que evitar que se salga lo que no cabe.
const MAX_FIT_SCALE = 1;

// MIN_FIT_SCALE es lo máximo que el encuadre puede ENCOGER el mapa.
//
// Un quinto. Por debajo de eso los puntos dejarían de poder señalarse con el dedo y el mapa sería una
// nube ilegible; llegado ese extremo es preferible que asome algo por fuera —el teclado y el buscador
// siguen alcanzándolo, y la lista de al lado lo enseña entero— antes que dejarlo en polvo.
const MIN_FIT_SCALE = 0.2;

// ViewTransform es cómo se traslada el mapa calculado a los píxeles del lienzo.
//
// En español: la simulación coloca los puntos en un espacio propio, sin saber qué tamaño tiene la
// pantalla. Esto es la lente con la que se mira ese espacio: cuánto se encoge todo (scale) y cuánto
// se desplaza para quedar centrado (offsetX/offsetY). Un punto que la simulación puso en (x, y) se
// dibuja en (offsetX + x·scale, offsetY + y·scale), y su radio se multiplica por scale.
export type ViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

// IDENTITY_TRANSFORM es la lente que no cambia nada: se usa cuando no hay nada que encuadrar.
const IDENTITY_TRANSFORM: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

// fitViewTransform calcula el ENCUADRE: la lente que hace que QUEPA TODO el mapa dentro del lienzo.
//
// QUÉ PROBLEMA RESUELVE, y por qué reemplaza a lo que había, en español:
//
// Antes, cada punto que se salía del lienzo se EMPUJABA de vuelta contra el borde. Funcionaba en el
// sentido literal —ningún punto quedaba fuera— pero el resultado con una biblioteca grande era el
// que se vio en pantalla: decenas de puntos aplastados formando un marco contra los cuatro bordes,
// con sus nombres pisándose unos a otros, mientras el centro quedaba comparativamente vacío. Y no era
// un problema de dibujo: al empujarlos, se destruía la información que el mapa existe para contar
// —quién está cerca de quién—, porque dos puntos sin ninguna relación acababan pegados solo por haber
// llegado al mismo borde.
//
// El encuadre hace lo contrario: deja que la colocación se extienda como quiera y después MIRA todo
// el conjunto desde más lejos, encogiéndolo lo justo para que entre. Las distancias relativas se
// conservan intactas, que es lo único que el mapa afirma.
//
// El recuadro que se calcula incluye el RADIO de cada punto y el sitio de su nombre, porque lo que
// tiene que caber no es el centro del punto: es el círculo entero con su etiqueta colgando debajo.
export function fitViewTransform(
  points: readonly { x: number; y: number; radius: number }[],
  width: number,
  height: number,
): ViewTransform {
  if (points.length === 0 || width <= 0 || height <= 0) {
    return IDENTITY_TRANSFORM;
  }

  // El recuadro que ocupa todo el mapa, contando el círculo de cada punto y el hueco de su nombre.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x - point.radius);
    maxX = Math.max(maxX, point.x + point.radius);
    minY = Math.min(minY, point.y - point.radius);
    maxY = Math.max(maxY, point.y + point.radius + LABEL_SPACE_BELOW_PX);
  }

  // El sitio disponible, ya descontado el aire de los bordes. Nunca menor que un píxel: si el lienzo
  // fuera más pequeño que sus propios márgenes, la división de abajo daría un número sin sentido.
  const availableWidth = Math.max(1, width - CANVAS_MARGIN_PX * 2);
  const availableHeight = Math.max(1, height - CANVAS_MARGIN_PX * 2);
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);

  // Se encoge por el lado que peor va, para que quepa por los dos. Un solo número para los dos ejes:
  // encoger más de ancho que de alto deformaría el mapa y convertiría los círculos en óvalos.
  const scale = Math.min(
    MAX_FIT_SCALE,
    Math.max(
      MIN_FIT_SCALE,
      Math.min(availableWidth / contentWidth, availableHeight / contentHeight),
    ),
  );

  // Y se desplaza para que el conjunto quede CENTRADO en el lienzo, no pegado a una esquina.
  const offsetX = (width - contentWidth * scale) / 2 - minX * scale;
  const offsetY = (height - contentHeight * scale) / 2 - minY * scale;

  return { scale, offsetX, offsetY };
}

// computeStaticLayout calcula la colocación ENTERA de una vez y devuelve el resultado ya quieto.
//
// Para quién es, en español: para quien ha pedido en su sistema operativo que se reduzca el
// movimiento. A esa persona no se le puede enseñar un mapa acomodándose durante un segundo; hay que
// darle el resultado final directamente. Eso obliga a gastar los trescientos pasos seguidos, que en
// el peor caso medido son unos 840 milisegundos.
//
// Y ahí está el problema que resuelve el hilo aparte: 840 milisegundos de cálculo seguido dejan la
// página CONGELADA —no responde a un clic, ni al teclado, ni se puede desplazar—. Congelar la
// interfaz es justo lo último que se le debe hacer a alguien que ha pedido menos movimiento. Por eso
// esta función está escrita para poder ejecutarse tal cual dentro de un hilo aparte (ver el archivo
// graph-layout.worker.ts): no toca la pantalla, no usa nada del navegador, solo recibe datos y
// devuelve datos.
export function computeStaticLayout(request: GraphLayoutRequest): GraphLayoutResponse {
  const startedAt = Date.now();
  const simulation = buildSimulation(request);
  // Los pasos se dan todos seguidos. Antes se daban de uno en uno para empujar de vuelta, tras cada
  // paso, a los puntos que se salían del lienzo; eso ya no se hace (ver fitViewTransform: el mapa se
  // deja extender y después se mira desde más lejos), así que no hay nada que intercalar.
  simulation.tick(STATIC_TICKS);
  const positions: NodePosition[] = simulation.nodes().map((node) => ({
    id: node.id,
    x: node.x ?? 0,
    y: node.y ?? 0,
  }));
  simulation.stop();
  return { positions, elapsedMs: Date.now() - startedAt };
}
