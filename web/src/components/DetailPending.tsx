// Archivo: DetailPending.tsx — Lo que se enseña MIENTRAS la ficha de un título viene en camino, y lo
// que se enseña si no llega.
//
// POR QUÉ ESTE ARCHIVO EXISTE, que es una corrección y no una organización bonita:
//
// Estas dos piezas —la silueta de espera y el aviso de "no llegó, reintenta"— estaban escritas DOS
// VECES: una en la previa de la línea de tiempo y otra en la ventana que se abre desde una conexión o
// desde una saga. Y las dos copias ya habían empezado a divergir: la de la ventana se había quedado
// sin la fila de retratos, así que la silueta tenía una forma distinta según por dónde se abriera el
// mismo título. Nada fallaba, nada daba error; sencillamente la pantalla no era la misma. Eso es
// exactamente lo que pasa siempre con el mismo dibujo copiado en dos sitios.
//
// Con una sola copia, las dos entradas enseñan lo mismo por construcción y no por disciplina.
//
// Las clases visuales conservan sus nombres (st-detail-*) porque son las que ya viven en la hoja de
// estilos global y describen bien lo que son; lo que cambia es que ahora hay un único sitio donde se
// decide qué llevan dentro.

import { ui } from "@/lib/i18n";

// DetailSkeletonProps son las props de la silueta que ocupa el sitio de la ficha mientras llega.
type DetailSkeletonProps = {
  // title es el título del estreno, que SÍ se conoce desde el resumen y por eso se enseña de verdad.
  title: string;
  // extraClassName son clases adicionales del contenedor, para que cada sitio pueda ajustar su
  // encaje (márgenes dentro de la ventana, por ejemplo) sin duplicar el contenido.
  extraClassName?: string;
};

// DetailSkeleton dibuja la silueta de la ficha mientras la ficha viene en camino.
//
// Por qué una silueta y no una rueda girando, en español: una silueta con la forma aproximada de lo
// que va a aparecer hace dos cosas que una rueda no hace. Primero, reserva el espacio, así que cuando
// el contenido llega no da un salto ni empuja a los botones que rodean la ficha. Y segundo, comunica
// QUÉ está llegando: se reconoce la portada, el bloque de texto y la rejilla de personas antes de que
// existan. El título va escrito de verdad, no como una barra gris, porque ese dato sí se conoce:
// enseñarlo borroso cuando se sabe sería fingir una espera que no existe.
export function DetailSkeleton({ title, extraClassName = "" }: DetailSkeletonProps) {
  return (
    <div
      className={`st-detail-skeleton${extraClassName === "" ? "" : ` ${extraClassName}`}`}
      role="status"
      aria-busy="true"
    >
      {/* El título real y el aviso de que falta lo demás. Es lo que lee un lector de pantalla. */}
      <p className="st-detail-skeleton-title font-display">{title}</p>
      <p className="st-detail-skeleton-hint font-mono">{ui.stage.detailLoading}</p>
      {/*
        Las piezas grises: el hueco de la portada, tres renglones de texto y una fila de retratos.
        Son decorativas por completo (aria-hidden): el estado ya está dicho con palabras arriba, y
        repetirlo en forma de cajas vacías solo sería ruido para quien navega escuchando.
      */}
      <div aria-hidden="true" className="st-detail-skeleton-hero tl-skeleton" />
      <div aria-hidden="true" className="st-detail-skeleton-lines">
        <span className="tl-skeleton" />
        <span className="tl-skeleton" />
        <span className="tl-skeleton" />
      </div>
      <div aria-hidden="true" className="st-detail-skeleton-people">
        <span className="tl-skeleton" />
        <span className="tl-skeleton" />
        <span className="tl-skeleton" />
        <span className="tl-skeleton" />
      </div>
    </div>
  );
}

// DetailErrorNoticeProps son las props del aviso de "la ficha no llegó".
type DetailErrorNoticeProps = {
  // message es la explicación en es-MX de lo que pasó.
  message: string;
  // onRetry vuelve a pedirla.
  onRetry: () => void;
  // extraClassName son clases adicionales del contenedor (ver DetailSkeletonProps).
  extraClassName?: string;
};

// DetailErrorNotice dibuja el aviso de que la ficha no se pudo traer, con su botón de reintentar.
//
// En español: role="alert" hace que un lector de pantalla lo anuncie en cuanto aparece, porque es
// información que la persona estaba esperando y no llegó. El botón de reintentar es lo que impide
// que este estado sea un callejón sin salida: sin él, la única salida sería recargar la página.
export function DetailErrorNotice({
  message,
  onRetry,
  extraClassName = "",
}: DetailErrorNoticeProps) {
  return (
    <div
      className={`st-detail-error${extraClassName === "" ? "" : ` ${extraClassName}`}`}
      role="alert"
    >
      <p className="st-detail-error-text">{message}</p>
      <button type="button" onClick={onRetry} className="st-detail-error-retry font-mono">
        {ui.stage.detailErrorRetry}
      </button>
    </div>
  );
}
