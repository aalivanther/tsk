// Fondo orgánico de la app web "MDM 7mo".
//
// En español: este componente dibuja el "ambiente" que se ve detrás de todo el
// contenido: cuatro manchas de color difuminadas (blobs) que se mueven muy
// despacio, una capa de grano fino (ruido) que da textura de "película", y una
// viñeta que oscurece los bordes para enfocar la mirada al centro. Reproduce
// fielmente el fondo del cascarón v3 (la fuente de verdad visual).
//
// Es un COMPONENTE DE SERVIDOR (no lleva 'use client'): no tiene estado ni
// interacción; solo pinta capas decorativas. Por eso es muy barato de renderizar
// y no añade JavaScript al navegador.
//
// Accesibilidad:
//   - Todas las capas son puramente decorativas: van con aria-hidden y
//     pointer-events:none para que lectores de pantalla y el ratón las ignoren.
//   - Si la persona pidió "menos movimiento" (prefers-reduced-motion), la
//     animación de deriva se desactiva por completo; el fondo se queda quieto
//     pero idéntico en color.

import type { JSX } from "react";

// Imagen de grano (ruido) embebida como SVG en una "data URI".
// En español: en vez de pedir un archivo de imagen al servidor, generamos el
// ruido con un filtro SVG (feTurbulence) directamente dentro del CSS. Es la
// misma técnica del cascarón v3: textura fina, sin descargas extra y nítida en
// cualquier pantalla. Se define como constante con nombre para no repetir la
// cadena larga y dejar claro qué es.
const GRAIN_NOISE_SVG_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Background es el componente que arma todas las capas del fondo.
// En español: devuelve un fragmento con cuatro piezas apiladas detrás del
// contenido (z-index 0): el grupo de blobs, el grano y la viñeta. Junto a ellas
// inyecta una etiqueta <style> con las animaciones y la regla de "menos
// movimiento", porque son estilos propios de este fondo (no tokens globales).
export default function Background(): JSX.Element {
  return (
    <>
      {/*
        Estilos locales del fondo.
        En español: aquí viven la animación de deriva de los blobs y la capa de
        grano (que necesita una imagen de fondo larga, incómoda como clase
        Tailwind). Se aíslan con la clase contenedora "organic-background" para
        no afectar a nada más. La última regla apaga la animación cuando el
        usuario pide menos movimiento.
      */}
      <style>{`
        /* Contenedor fijo que cubre toda la ventana, detrás del contenido.
           overflow: hidden es OBLIGATORIO, no decorativo: el grupo de blobs de abajo se desborda a
           propósito (inset: -20%) para que las nubes de color no muestren sus bordes. Sin recortar
           aquí, ese desbordamiento AGRANDA el lienzo de la página en móvil y el navegador responde
           alejando el zoom de TODA la interfaz (se medía un viewport de 526px en un teléfono de
           393px: la app entera se veía a ~75% de su tamaño). Recortando, el efecto visual es idéntico
           y el lienzo vuelve a medir lo que mide la pantalla. */
        .organic-background {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
        }

        /* Grupo de blobs: se desborda a propósito (inset negativo) y se difumina
           fuerte para lograr nubes de color suaves. "screen" mezcla los colores
           sumando luz, como en el cascarón v3. */
        .organic-background .blob-field {
          position: absolute;
          inset: -20%;
          filter: blur(72px) saturate(1.15);
          opacity: 0.85;
        }

        /* Cada blob es un círculo de gradiente que se mueve en bucle, alternando
           ida y vuelta, con la curva de movimiento de marca. */
        .organic-background .blob {
          position: absolute;
          border-radius: 50%;
          mix-blend-mode: screen;
          animation: organic-drift 26s cubic-bezier(0.22, 0.61, 0.36, 1) infinite
            alternate;
        }

        /* Posiciones, tamaños y color de cada uno de los cuatro blobs.
           Los desfases (animation-delay negativos) hacen que no se muevan todos
           a la vez, dando una sensación más natural. */
        .organic-background .blob-1 {
          width: 60vw;
          height: 60vw;
          left: -10%;
          top: -15%;
          background: radial-gradient(circle, #1d3a5e, transparent 65%);
        }
        .organic-background .blob-2 {
          width: 55vw;
          height: 55vw;
          right: -15%;
          top: 5%;
          background: radial-gradient(circle, #3a2150, transparent 65%);
          animation-delay: -6s;
        }
        .organic-background .blob-3 {
          width: 50vw;
          height: 50vw;
          left: 15%;
          bottom: -25%;
          background: radial-gradient(circle, #0e4a44, transparent 65%);
          animation-delay: -12s;
        }
        .organic-background .blob-4 {
          width: 40vw;
          height: 40vw;
          right: 5%;
          bottom: -10%;
          background: radial-gradient(circle, #5a4420, transparent 70%);
          animation-delay: -18s;
        }

        /* Deriva: un desplazamiento y escalado mínimos para que los blobs
           "respiren" muy despacio sin distraer. */
        @keyframes organic-drift {
          0% {
            transform: translate(0, 0) scale(1);
          }
          100% {
            transform: translate(4%, -3%) scale(1.12);
          }
        }

        /* Capa de grano: el ruido SVG repetido, casi invisible (opacidad baja),
           que añade textura de "película" sobre los blobs. */
        .organic-background .grain {
          position: absolute;
          inset: 0;
          opacity: 0.04;
          background-image: ${GRAIN_NOISE_SVG_DATA_URI};
        }

        /* Viñeta: oscurece progresivamente de arriba hacia los bordes para
           enfocar la atención en el contenido. */
        .organic-background .vignette {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            120% 90% at 50% 0%,
            transparent 40%,
            rgba(7, 8, 9, 0.7) 100%
          );
        }

        /* Tapado por completo: en el tema oscuro el fondo rotativo de la portada es opaco y cubre
           la ventana entera, así que estas manchas no se ven. Mientras dure (lo marca
           GlobalBackground en <html>, y lo quita antes de cada desvanecido entre fondos, el único
           momento en que se traslucen) se pausan: cada fotograma de su deriva obliga a recalcular un
           desenfoque enorme para nada. Al reanudar siguen desde donde estaban. */
        html[data-theme="dark"][data-bg-covered] .organic-background .blob {
          animation-play-state: paused;
        }

        /* Accesibilidad: si la persona pidió menos movimiento, congelamos los
           blobs (sin animación). El fondo conserva su color y composición. */
        @media (prefers-reduced-motion: reduce) {
          .organic-background .blob {
            animation: none;
          }
        }
      `}</style>

      {/*
        Capas decorativas reales.
        En español: aria-hidden="true" indica a los lectores de pantalla que
        esto es solo decoración y no deben anunciarlo.
      */}
      <div className="organic-background" aria-hidden="true">
        {/* Las cuatro manchas de color difuminadas. */}
        <div className="blob-field">
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
          <div className="blob blob-4" />
        </div>
        {/* Textura de grano fino sobre los blobs. */}
        <div className="grain" />
        {/* Viñeta que oscurece los bordes. */}
        <div className="vignette" />
      </div>
    </>
  );
}
