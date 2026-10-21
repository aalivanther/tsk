// Archivo: graph-layout.worker.ts — El hilo aparte que coloca los puntos del mapa personal.
//
// Qué es un "hilo aparte", en español: una página web hace todo en una sola fila india —dibujar,
// responder al teclado, atender los clics—. Si una cuenta larga se mete en esa fila, todo lo demás
// espera y la página se queda congelada. Un hilo aparte (un Web Worker) es una segunda fila que
// corre a la vez: la cuenta se hace ahí y la página sigue respondiendo mientras tanto.
//
// POR QUÉ HACE FALTA AQUÍ, y solo aquí:
//
// A quien ha pedido en su sistema "reducir el movimiento" no se le puede enseñar el mapa
// acomodándose: hay que darle el resultado ya quieto. Eso obliga a gastar los trescientos pasos de la
// simulación seguidos, que en el peor caso medido son unos 840 milisegundos. Casi un segundo con la
// página congelada, justo a la persona que ha pedido menos movimiento. En cambio, para quien sí ve la
// animación cada paso cuesta 2,8 milisegundos de los 16,7 que dura un fotograma: eso va perfectamente
// en la fila principal y no necesita nada de esto.
//
// EL DETALLE QUE HACE QUE ESTO FUNCIONE, y que conviene dejar por escrito porque es de los que rompen
// una función meses después sin avisar:
//
// La política de seguridad del sitio es `default-src 'self'` y NO declara `worker-src`, así que los
// hilos aparte heredan esa regla: solo se permiten si su archivo se sirve desde nuestro propio
// dominio. Next.js 16.2 —la versión que usa el proyecto— genera exactamente eso. Las versiones 16.0 y
// 16.1 lo generaban como una dirección "blob:", que la política BLOQUEA. Es decir: esto funciona con
// la política tal y como está gracias a la versión de Next que tenemos. Si algún día se baja de
// versión, esta pantalla dejará de calcular en segundo plano sin dar ningún error visible.
//
// Por eso quien lo usa (GraphCanvas) nunca da por hecho que el hilo aparte va a existir: si no se
// puede crear o no contesta, cae al cálculo en la fila principal. Lento, pero funciona.

import {
  computeStaticLayout,
  type GraphLayoutRequest,
  type GraphLayoutResponse,
} from "@/lib/graph-layout";

// DedicatedWorkerScope describe lo poquito que este archivo necesita de su entorno.
//
// Por qué se declara a mano, en español: el proyecto compila con los tipos del NAVEGADOR, donde
// "self" es la ventana. Dentro de un hilo aparte no hay ventana: hay otro entorno, más pequeño, con
// su propio "postMessage". Añadir los tipos completos del hilo al proyecto entero haría chocar las
// dos definiciones en todos los demás archivos. Declarar aquí las dos funciones que se usan es más
// honesto y no contamina nada.
type DedicatedWorkerScope = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<GraphLayoutRequest>) => void,
  ): void;
  postMessage(message: GraphLayoutResponse): void;
};

// workerScope es este mismo hilo, visto con el tipo de arriba.
const workerScope = self as unknown as DedicatedWorkerScope;

// Al recibir un encargo se calcula la colocación entera y se devuelve el resultado.
//
// En español: el hilo aparte no sabe nada de pantallas ni de dibujo. Recibe una lista de puntos, una
// lista de hilos y el tamaño del lienzo; devuelve dónde va cada punto y cuánto tardó. Toda la lógica
// es la misma que usaría la fila principal (computeStaticLayout), para que las dos personas —la que
// ve la animación y la que no— vean exactamente el mismo mapa.
workerScope.addEventListener("message", (event) => {
  workerScope.postMessage(computeStaticLayout(event.data));
});
