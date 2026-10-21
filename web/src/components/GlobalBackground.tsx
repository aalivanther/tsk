"use client";

// Archivo: GlobalBackground.tsx — El FONDO GLOBAL de la página (rediseño E2 "la página es la timeline").
//
// En español: en el rediseño E2 el verdadero "protagonista" visual ya NO es una tarjeta destacada
// (el viejo Hero), sino TODA la pantalla. Este componente pinta, detrás de TODO el contenido, el
// BACKDROP (la imagen ancha) de los mejores estrenos del catálogo, oscurecido con una viñeta para
// que el texto encima se lea con contraste AA, y va ROTANDO de uno a otro con un suave desvanecido
// cruzado (crossfade) cada ~6 segundos. Es como una galería ambiental que "respira" detrás de la
// línea de tiempo.
//
// Lleva 'use client' porque tiene estado y un temporizador: necesita saber CUÁL backdrop se muestra
// ahora y cambiarlo cada cierto tiempo (useState + useEffect con un intervalo, que se limpia al
// desmontar para no dejar temporizadores colgando).
//
// Accesibilidad (regla §12, no negociable):
//   - Es puramente DECORATIVO: va con aria-hidden y pointer-events:none, para que ni los lectores de
//     pantalla ni el ratón lo "vean". La información real vive en la timeline, no aquí.
//   - Si la persona pidió "menos movimiento" (prefers-reduced-motion), NO rota: muestra fijo el
//     primer backdrop, sin transición. Así nadie con sensibilidad al movimiento sufre el crossfade.
//   - La viñeta garantiza contraste AA del texto encima sobre cualquier imagen (clara u oscura).
//
// FRONTERA DE ALCANCE (decisión registrada, NO un TODO escondido): se expone una prop opcional
// onActivate que, en una fase futura (E4), permitirá HACER CLIC en el fondo para abrir el estreno que
// se está mostrando. En E2 el fondo NO es interactivo todavía (sigue siendo decorativo), así que la
// prop se acepta pero no se cablea a ningún manejador de clic. Queda lista para E4 sin deuda oculta.
//
// FUENTE DE VERDAD: usa coverStyleFor (de @/lib/timeline) para resolver el backdrop real o, si la URL
// viene vacía (Fase 0 sin imágenes), el degradado determinista del cascarón v3. Los tokens de color y
// el crossfade viven en globals.css (clases con prefijo tlx-), anulados bajo prefers-reduced-motion.

import { useEffect, useState, type CSSProperties, type JSX } from "react";

import { coverStyleFor } from "@/lib/timeline";
import { preloadTintableImage, usePosterTint } from "@/lib/use-poster-tint";
import { useFilter } from "@/lib/timeline-context";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// ROTATION_INTERVAL_MS es cada cuánto (en milisegundos) el fondo cambia al siguiente backdrop.
// En español: ~6 segundos por estreno, un ritmo pausado que se nota pero no distrae de la timeline.
const ROTATION_INTERVAL_MS = 6000;

// GlobalBackgroundProps son las propiedades del fondo global.
// En español: recibe la lista de estrenos "estrella" (los mejores por calificación TMDB, ~5) que se
// van rotando como fondo, sus semillas de degradado (para el respaldo de color en Fase 0) y la prop
// opcional onActivate reservada para E4 (clic-en-fondo). Nada más: es un componente de pura ambientación.
type GlobalBackgroundProps = {
  // releases son los estrenos cuyos backdrops se rotan de fondo (ya vienen ordenados de mejor a peor
  // por quien llama). Si llega vacío, el componente no pinta nada (no hay fondo que mostrar).
  releases: ReleaseSummary[];
  // seeds son las semillas de degradado de cada estreno (su color de respaldo determinista en Fase 0,
  // cuando aún no hay backdrop real), ALINEADAS por posición con `releases` (seeds[i] es la de releases[i]).
  // Es un arreglo de números (DATO serializable), no una función: un Server Component NO puede pasar
  // funciones a un Client Component, así que quien llama precalcula las semillas y las manda ya resueltas.
  seeds: number[];
  // onActivate es el gancho RESERVADO para E4 (clic-en-fondo para abrir el estreno mostrado). En E2 no
  // se cablea a ningún clic: el fondo sigue siendo decorativo. Opcional para no exigirlo todavía.
  onActivate?: (release: ReleaseSummary) => void;
};

// prefersReducedMotion consulta si el usuario pidió "menos movimiento" en su sistema operativo.
// En español: lee la media query de accesibilidad. En el servidor (sin window) devolvemos false: ahí
// no hay animación de todos modos, y el primer render del cliente vuelve a consultarlo en el efecto.
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// GlobalBackground dibuja todas las capas del fondo y orquesta la rotación entre backdrops.
// En español: apila una capa por estreno (todas en el mismo sitio, una encima de otra) y deja visible
// solo la del estreno "activo" mediante opacidad; al cambiar el activo, el crossfade del CSS las funde.
// Encima de todas va una viñeta que oscurece para legibilidad. Todo detrás del contenido (z bajo).
export function GlobalBackground({ releases, seeds }: GlobalBackgroundProps): JSX.Element | null {
  // Leemos del contexto el fondo de la SELECCIÓN actual (o null si no hay nada abierto). Cuando el
  // usuario abre una categoría/título, el flujo lo fija aquí y pintamos ESE backdrop por encima de la
  // rotación: el fondo de toda la página "muta" a lo elegido. Al cerrar vuelve a null y manda la rotación.
  const { activeBackdrop } = useFilter();
  // Nota sobre onActivate: forma parte del CONTRATO (queda declarada en GlobalBackgroundProps para que
  // la página ya pueda pasarla), pero en E2 NO se desestructura ni se usa, porque el fondo todavía no
  // es interactivo. Se cableará en E4 (clic-en-fondo). Así evitamos un parámetro "sin usar" que el
  // linter marcaría, sin perder la prop del contrato. No es deuda oculta: es una frontera registrada.
  // activeIndex es la posición del backdrop que se muestra AHORA (el que está "encendido").
  // Arranca en 0 (el mejor estreno) para que el servidor y el primer render del cliente coincidan.
  const [activeIndex, setActiveIndex] = useState(0);

  // Efecto de ROTACIÓN: cada ROTATION_INTERVAL_MS avanzamos al siguiente backdrop, en bucle.
  // En español: solo rota si (1) hay más de un estreno que mostrar y (2) el usuario NO pidió menos
  // movimiento. El intervalo se LIMPIA al desmontar o al cambiar las dependencias (clearInterval), para
  // no dejar temporizadores vivos que cambien el estado de un componente ya desmontado.
  useEffect(() => {
    // Con cero o un solo estreno no hay nada que rotar; tampoco rotamos bajo reduced-motion.
    if (releases.length <= 1 || prefersReducedMotion()) {
      return;
    }
    const intervalId = window.setInterval(() => {
      // Pestaña oculta: no avanzamos. En español: rotar un fondo que nadie ve desperdicia CPU (cada
      // cambio dispara además la extracción de color con node-vibrant). Al volver a la pestaña, la
      // rotación continúa desde donde quedó.
      if (document.hidden) {
        return;
      }
      // Avanzamos circularmente: tras el último, volvemos al primero (módulo de la longitud).
      setActiveIndex((previousIndex) => (previousIndex + 1) % releases.length);
    }, ROTATION_INTERVAL_MS);
    // Limpieza: al desmontar (o si cambia la lista) detenemos el temporizador.
    return () => {
      window.clearInterval(intervalId);
    };
  }, [releases.length]);

  // TINTE DEL PÓSTER (node-vibrant): color dominante del backdrop ACTIVO -> variable CSS --poster-tint. La
  // atmósfera del fondo se tiñe con ESE color, así el ambiente DERIVA del póster visible (premium, coherente).
  // La selección abierta manda; si no, la de la rotación.
  const activeUrl = activeBackdrop?.url ?? releases[activeIndex]?.backdropUrl ?? "";
  const posterTint = usePosterTint(activeUrl);

  // Si nos quedamos sin estrenos (catálogo vacío o error), no pintamos fondo: que se vea el fondo
  // orgánico de la app (blobs) sin una capa negra encima. Devolver null es "no renderizar nada".
  if (releases.length === 0) {
    return null;
  }

  // VENTANA DE CARGA de backdrops: solo la capa ACTIVA, la ANTERIOR (que se está desvaneciendo) y la
  // SIGUIENTE (que entrará pronto) llevan su imagen. En español: antes las 5 capas montaban su fondo a
  // la vez y el navegador descargaba los 5 backdrops a tamaño completo al abrir la portada; los fondos
  // de CSS no se difieren solos. Con la ventana de 3 el crossfade sigue intacto y las demás imágenes se
  // descargan solo cuando les toca.
  const previousIndex = (activeIndex - 1 + releases.length) % releases.length;
  const nextIndex = (activeIndex + 1) % releases.length;
  const loadingWindow = [previousIndex, activeIndex, nextIndex];

  // RESERVA DE LAS IMÁGENES CON PERMISO: se piden por adelantado y con permiso de origen cruzado las
  // MISMAS imágenes que va a pintar el CSS, para que esa única descarga sirva también para sacarles el
  // color. Sin esto el navegador se traía cada fondo dos veces (271 KB de más en la portada). Se
  // reservan las tres de la ventana, no solo la activa, porque las otras dos serán la activa dentro de
  // unos segundos y para entonces su copia ya tiene que venir con permiso. Ver preloadTintableImage.
  for (const index of loadingWindow) {
    preloadTintableImage(releases[index]?.backdropUrl ?? "");
  }
  if (activeBackdrop !== null) {
    preloadTintableImage(activeBackdrop.url);
  }

  // Exponemos el tinte como variable CSS en la raíz del fondo; el CSS lo usa para la atmósfera tintada.
  const rootStyle =
    posterTint !== null ? ({ "--poster-tint": posterTint } as CSSProperties) : undefined;

  return (
    // Capa raíz fija que cubre toda la ventana, DETRÁS del contenido (z bajo) y sin capturar eventos.
    // Es decorativa: aria-hidden para que los lectores de pantalla la ignoren por completo.
    <div className="tlx-global-bg" aria-hidden="true" style={rootStyle}>
      {/*
        Una capa por estreno, TODAS superpuestas en el mismo lugar. Solo la del estreno activo queda
        a opacidad 1 (clase tlx-global-layer-on); las demás a 0. La transición de opacidad del CSS hace
        el crossfade. Bajo reduced-motion el CSS anula la transición (cambio instantáneo, sin fundido).
      */}
      {releases.map((release, index) => {
        const isActive = index === activeIndex;
        // Solo las capas de la ventana de carga (anterior, activa y siguiente) montan su imagen.
        const shouldLoadImage = loadingWindow.includes(index);
        // El backdrop real si hay URL; si no (Fase 0), el degradado determinista por semilla.
        // La semilla viene precalculada y alineada por posición (seeds[index]); si por algún motivo
        // faltara (longitudes distintas), caemos al propio índice como respaldo seguro.
        // CLAVE: quitamos `opacity` del estilo inline. coverStyleFor la mete (=1) inline y eso PISABA el
        // crossfade CSS (.tlx-global-layer opacity 0 / .tlx-global-layer-on opacity 1) -> TODAS las capas
        // quedaban visibles y el fondo NO rotaba. Dejando que el CSS controle la opacidad, el crossfade
        // entre backdrops vuelve a funcionar (cada 6s se enciende la capa activa con fundido).
        const coverStyle = shouldLoadImage
          ? { ...coverStyleFor(release.backdropUrl, seeds[index] ?? index) }
          : undefined;
        if (coverStyle !== undefined) {
          delete coverStyle.opacity;
        }
        return (
          <div
            key={release.id}
            className={`tlx-global-layer${isActive ? " tlx-global-layer-on" : ""}`}
            style={coverStyle}
          />
        );
      })}

      {/*
        Capa de SELECCIÓN ("fondo muta"): cuando hay algo abierto (categoría/título), pintamos su backdrop
        POR ENCIMA de la rotación, cubriéndola. Se monta solo cuando activeBackdrop !== null (entra con un
        suave desvanecido); al cerrar se desmonta y reaparece la rotación. Entre selecciones (categoría ->
        título) la capa sigue montada y solo cambia su imagen, sin parpadeo. Decorativa, bajo la viñeta.
      */}
      {activeBackdrop !== null ? (
        <div
          className="tlx-global-override"
          style={coverStyleFor(activeBackdrop.url, activeBackdrop.seed)}
        />
      ) : null}

      {/*
        Viñeta de legibilidad encima de los backdrops: oscurece de forma radial (más en los bordes y
        la base) para que el texto y los paquetes de la timeline mantengan contraste AA sobre CUALQUIER
        imagen, sea clara u oscura. Es la pieza que hace "legible" el fondo, no solo bonito.
      */}
      <div className="tlx-global-vignette" />
    </div>
  );
}
