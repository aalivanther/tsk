// Archivo: (public)/(home)/loading.tsx — UI de CARGA de la PORTADA (esqueleto del shell).
//
// En español: Next.js (App Router) muestra automáticamente este componente mientras la página de
// arriba (page.tsx) le pide sus datos al backend. Como la portada es "force-dynamic", esa espera
// ocurre en cada visita; este "esqueleto" evita una pantalla en blanco: dibuja la SILUETA de lo que va
// a aparecer, en tono atenuado, para que la persona perciba que algo viene en camino y —muy
// importante— para que el contenido real no dé un salto al llegar (la silueta ya ocupa su sitio).
//
// POR QUÉ VIVE DENTRO DE UNA CARPETA "(home)" Y NO UN NIVEL MÁS ARRIBA, que es donde estaba:
//
// Un esqueleto de carga se aplica a TODAS las pantallas que cuelgan de su carpeta, y este dibuja la
// línea de tiempo: se estaba enseñando también al abrir la ficha de una persona, de una saga o de un
// título, prometiendo un calendario que en esas pantallas no aparece nunca. Y tenía una segunda
// consecuencia, invisible pero seria: un esqueleto obliga al servidor a empezar a mandar la página
// ANTES de saber qué va a haber dentro, y una vez empezada no se puede cambiar la respuesta. Por eso
// las pantallas de "no encontrado" respondían "todo correcto" (un 200) aunque dijeran lo contrario.
//
// Los paréntesis del nombre de la carpeta significan, en Next.js, que NO forma parte de la dirección:
// esta página sigue siendo "/". Lo único que cambia es hasta dónde llega el esqueleto.
//
// Esta versión reproduce el layout REAL de hoy. El esqueleto anterior dibujaba una portada gigante
// ("hero") y una sola cinta de días: esa pantalla ya no existe desde el rediseño, así que la silueta
// prometía una cosa y llegaba otra — que es peor que no poner esqueleto. Lo que se dibuja ahora:
//   - La barra superior: marca, dos filtros, "Ir a hoy", buscador, campana y avatar.
//   - En ESCRITORIO: los DOS carriles de espina (cine arriba, series y streaming abajo), cada uno con
//     su línea horizontal, sus nodos y sus paquetes.
//   - En MÓVIL: las filas de la agenda vertical (encabezado de mes + días con sus paquetes).
// El corte entre una y otra silueta es el MISMO ancho (768px) que usa la app para decidir qué monta
// de verdad (ver MOBILE_BREAKPOINT en use-is-mobile.ts), así que la silueta nunca miente.
//
// No lleva datos ni interacción: es puramente presentacional. El "latido" suave de los bloques usa la
// animación tl-skeleton-pulse de globals.css, que bajo prefers-reduced-motion queda ANULADA: en ese
// caso los bloques se ven fijos, sin movimiento, pero la silueta sigue comunicando "cargando".

import type { JSX } from "react";

import { ui } from "@/lib/i18n";

// SKELETON_STATION_COUNT es cuántas "estaciones" (días) fantasma dibuja cada carril de escritorio.
// En español: son suficientes para que la espina se vea poblada de lado a lado sin recargar la pantalla.
const SKELETON_STATION_COUNT = 8;

// SKELETON_AGENDA_DAY_COUNT es cuántas filas de día fantasma dibuja la agenda de móvil.
const SKELETON_AGENDA_DAY_COUNT = 5;

// Loading dibuja el esqueleto completo del shell durante la carga de la ruta.
export default function Loading(): JSX.Element {
  return (
    // aria-busy + role="status" anuncian a los lectores de pantalla que el contenido se está cargando.
    <div aria-busy="true" role="status" className="font-ui">
      {/* Texto solo para lectores de pantalla: comunica el estado de carga sin ocupar espacio visible. */}
      <span className="sr-only">{ui.home.loading}</span>

      {/*
        Silueta de la BARRA SUPERIOR. Reproduce el orden real de la barra: marca a la izquierda, los
        dos filtros a su lado, y a la derecha "Ir a hoy", el buscador, la campana y el avatar. Usa el
        mismo alto que la barra de verdad (la variable --tlx-topbar-h), para que al llegar el contenido
        nada se desplace hacia arriba o hacia abajo.
      */}
      <div
        className="flex items-center gap-3 px-4 sm:gap-5 sm:px-7"
        style={{
          height: "var(--tlx-topbar-h, 54px)",
          borderBottom: "1px solid var(--color-border-soft)",
        }}
      >
        {/* Marca. */}
        <SkeletonBlock className="h-5 w-[128px] rounded-sm" />
        {/* Los dos filtros (Categoría y Género). */}
        <SkeletonBlock className="h-7 w-[92px] rounded-[5px]" />
        <SkeletonBlock className="hidden h-7 w-[92px] rounded-[5px] sm:block" />
        {/* Separador flexible: empuja a la derecha lo que va a la derecha. */}
        <span className="flex-1" aria-hidden="true" />
        {/* "Ir a hoy". */}
        <SkeletonBlock className="h-7 w-[84px] rounded-[5px]" />
        {/* Buscador, campana y avatar (los tres controles circulares de la derecha). */}
        <SkeletonBlock className="h-[34px] w-[34px] rounded-full" />
        <SkeletonBlock className="hidden h-[34px] w-[34px] rounded-full sm:block" />
        <SkeletonBlock className="hidden h-[34px] w-[34px] rounded-full sm:block" />
      </div>

      {/*
        ESCRITORIO: los dos carriles de espina, uno encima del otro. Cada carril ocupa la mitad del
        alto disponible bajo la barra, igual que los de verdad.
      */}
      <div className="sk-lanes">
        <SkeletonLane />
        <SkeletonLane />
      </div>

      {/*
        MÓVIL: la agenda vertical. Un encabezado de mes y varias filas de día, cada una con su nodo
        sobre la espina, su fecha a la izquierda y sus paquetes a la derecha.
      */}
      <div className="sk-agenda">
        {/* Encabezado de mes (el que se queda pegado arriba al desplazarse). */}
        <div className="flex items-center justify-between px-4 py-3">
          <SkeletonBlock className="h-4 w-[110px] rounded-sm" />
          <SkeletonBlock className="h-4 w-[28px] rounded-sm" />
        </div>
        {Array.from({ length: SKELETON_AGENDA_DAY_COUNT }).map((_, index) => (
          // El índice como key es válido aquí: la lista es fija y nunca se reordena ni cambia.
          <div key={index} className="flex items-start gap-3 px-4 py-3">
            {/* Columna de la fecha: nodo, número de día y día de la semana. */}
            <div className="flex w-[46px] shrink-0 flex-col items-center gap-2 pt-1">
              <SkeletonBlock className="h-[9px] w-[9px] rounded-full" />
              <SkeletonBlock className="h-4 w-[24px] rounded-sm" />
              <SkeletonBlock className="h-3 w-[28px] rounded-sm" />
            </div>
            {/* Columna de los paquetes del día (uno o dos, alternando para no verse mecánico). */}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <SkeletonBlock className="h-[58px] w-full rounded-[10px]" />
              {index % 2 === 0 ? (
                <SkeletonBlock className="h-[58px] w-full rounded-[10px]" />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// SkeletonLane dibuja la silueta de UN carril de la espina de escritorio.
// En español: un título de carril arriba, la línea horizontal de la espina en el centro y, colgando de
// ella, las estaciones (cada una con su paquete, su nodo y su fecha), tal como se ven de verdad.
function SkeletonLane(): JSX.Element {
  return (
    <section className="sk-lane">
      {/* Título del carril ("Estrenos de cine" / "Series y streaming"). */}
      <SkeletonBlock className="mb-4 ml-6 h-3 w-[150px] rounded-sm sm:ml-10" />

      {/* Fila de estaciones. overflow-hidden imita el recorte de la cinta (que en la app se arrastra). */}
      <div className="relative flex items-center gap-6 overflow-hidden px-6 sm:gap-8 sm:px-10">
        {/* La línea de la espina, detrás de las estaciones. Decorativa. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 left-0 h-px"
          style={{ top: "50%", background: "var(--color-border-soft)" }}
        />
        {Array.from({ length: SKELETON_STATION_COUNT }).map((_, index) => (
          <div key={index} className="relative flex shrink-0 flex-col items-center gap-[10px]">
            {/* Paquete del día (el chip con el mini-banner del título más destacado). */}
            <SkeletonBlock className="h-[64px] w-[132px] rounded-[10px]" />
            {/* Nodo sobre la espina. */}
            <SkeletonBlock className="h-[9px] w-[9px] rounded-full" />
            {/* Caja de día: número + día de la semana. */}
            <SkeletonBlock className="h-4 w-[52px] rounded-sm" />
          </div>
        ))}
      </div>
    </section>
  );
}

// SkeletonBlockProps son las props de un bloque-silueta reutilizable.
type SkeletonBlockProps = {
  // className aporta el tamaño y el redondeo concretos de cada silueta (alto, ancho, rounded-*).
  className: string;
};

// SkeletonBlock es el ladrillo base de los esqueletos: una caja tenue con un latido suave.
// En español: pinta un rectángulo del tamaño que le indiquen (por className) con un fondo de cristal
// y la animación de "latido" (tl-skeleton-pulse de globals.css), que se anula bajo prefers-reduced-motion.
// aria-hidden lo oculta a los lectores de pantalla: el estado de carga ya se anuncia una sola vez arriba.
function SkeletonBlock({ className }: SkeletonBlockProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`tl-skeleton block ${className}`}
      style={{ background: "var(--color-surface)" }}
    />
  );
}
