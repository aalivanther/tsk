"use client";

// Archivo: Timeline.tsx — La LÍNEA DE TIEMPO como ESPINA (rediseño E2: "la página ES la timeline").
//
// En español: esta es la pieza central y, desde E2, ES la página entera. El rediseño abandona el
// patrón "tarjeta destacada arriba + cinta de tiempo aislada abajo" y convierte la timeline en la
// PROTAGONISTA a pantalla casi completa. La metáfora es un MAPA DE METRO / GRAFO DE GIT:
//
//   - Una ESPINA horizontal (línea dorada con leve resplandor) cruza la pantalla a media altura y se
//     desplaza horizontalmente (scroll).
//   - Cada DÍA con estrenos es una ESTACIÓN: un nodo (punto) sobre la espina, con su número de día y
//     su día de la semana junto al eje.
//   - Los PAQUETES de categoría de ese día (Cine / Streaming / Cadenas) CUELGAN de la estación
//     ALTERNANDO arriba y abajo de la espina: el 1º arriba, el 2º abajo, el 3º arriba… cada uno unido
//     a la estación por un TALLO (línea vertical), como las ramas de un grafo de git.
//   - El marcador HOY es una AGUJA prominente sobre la espina, intercalada entre las estaciones según
//     su fecha. Las estaciones y paquetes de días YA PASADOS se atenúan (opacidad + escala de grises).
//   - Detrás de todo, la marca de agua gigante del mes ("JUNIO"/"JULIO"), más grande y centrada.
//
// El verdadero "héroe" visual ahora es el FONDO GLOBAL rotativo (componente GlobalBackground, que
// monta la página), por eso aquí YA NO se dibuja el viejo Hero. La timeline gana CONTRASTE: superficies
// de paquete más marcadas, espina con resplandor y texto legible AA sobre ese fondo.
//
// Lleva 'use client' porque es 100% interactivo: lee el filtro compartido (useFilter), reacciona al
// teclado (flechas para desplazar), registra la acción "Ir a hoy" y maneja el foco de los paquetes.
//
// Se CONSERVA todo lo que ya funcionaba: filtro por tipo, navegación por teclado, respeto a
// prefers-reduced-motion, estados vacío/filtro, cada nodo como <button> enfocable con aria-label y la
// llamada onOpenPackage(month, day, categoryKey). Lo que CAMBIA (rediseño con bocetos): el nodo deja de
// ser una tarjeta ancha con pila de pósters y pasa a ser una MARQUILLA/CHIP compacta (categoría + ★ +
// conteo), con BORDE/resplandor de RAREZA tipo videojuego (deriveRarity) y un pulso por densidad.
//
// FRONTERA DE ALCANCE (decisión registrada, NO un TODO escondido): el FLUJO de 3 niveles (abrir el
// paquete -> elegir un estreno -> ver su detalle en un modal) lo orquesta TimelineStage vía onOpenPackage.
// Aquí cada paquete YA es un botón enfocable que lo dispara. El carrusel (E3) y el detalle (E4) vienen
// después y no son responsabilidad de este archivo.
//
// FUENTE DE VERDAD: los tokens, el contenido del paquete y los efectos por cantidad salen del cascarón
// v3 y de cascaron-mdm7mo-v3.html; la geometría de espina/estaciones/tallos vive en globals.css (prefijo
// tlx-), con todo el movimiento anulado bajo prefers-reduced-motion.

import {
  Fragment,
  memo,
  useCallback,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { useDragScroll } from "@/lib/use-drag-scroll";
import { useCopyPulses } from "@/lib/use-copy-pulses";
import { useFilter } from "@/lib/timeline-context";
import {
  CATEGORY_META,
  COVER_SIZES,
  LANE_META,
  MONTHS,
  buildCalendarMonths,
  cssImageSet,
  effectLevel,
  isDayInRange,
  matchesFilter,
  yearOfMonth,
  type CategoryKey,
  type CategoryPackage,
  type DateAnchor,
  type DateRange,
  type DayGroup,
  type MonthGroup,
  type TimelineLane,
  type TodayMarker,
} from "@/lib/timeline";
import { deriveRarity } from "@/lib/rarity";
import { tmdbImage } from "@/lib/images";
import { ui } from "@/lib/i18n";
import { useProfile } from "@/lib/profile-context";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// releaseMatchesPrefs indica si un estreno coincide con los GUSTOS del usuario: o bien tiene alguno de los
// géneros elegidos, o bien está en alguna de las plataformas que el usuario marcó como propias en su perfil.
// Los conjuntos llegan ya armados (Set) para que la comprobación por chip/día sea O(géneros+plataformas).
function releaseMatchesPrefs(
  release: ReleaseSummary,
  genreSet: Set<string>,
  platformSet: Set<string>,
): boolean {
  if (genreSet.size > 0 && release.genres.some((genre) => genreSet.has(genre))) {
    return true;
  }
  if (platformSet.size > 0) {
    const platforms = release.availability?.platforms ?? [];
    if (platforms.some((platform) => platformSet.has(platform))) {
      return true;
    }
  }
  return false;
}

// TimelineProps son las propiedades de la línea de tiempo. Se MANTIENEN tal cual (contrato estable).
// En español: recibe TODOS los estrenos del catálogo (los meses que haya cargado la página: mayo, junio
// y julio) ya combinados en una lista, y una función opcional para abrir un paquete (gancho del flujo de
// 3 niveles que orquesta TimelineStage). El agrupado por mes/día lo hace buildCalendarMonths, que es
// agnóstico al número de meses: por eso una sola lista basta para 1, 2 o N meses.
type TimelineProps = {
  // releases son los estrenos a dibujar en ESTE carril (ya repartidos por releasesForLane). Puede venir vacío.
  releases: ReleaseSummary[];
  // lane identifica el carril que dibuja esta instancia: "cine" (estrenos de sala) o "beyond" (series y
  // streaming). Define el título visible, la leyenda de categorías y el atributo data-lane para el CSS.
  lane: TimelineLane;
  // today es el marcador HOY de la demo: los componentes de fecha (para POSICIONAR la aguja entre las
  // estaciones) y su etiqueta ya armada (para MOSTRARLA). Se calcula en el SERVIDOR y se pasa como dato
  // fijo, para que el HTML del servidor y el del cliente coincidan (sin desajuste de hidratación).
  today: TodayMarker;
  // onOpenPackage es el "gancho" del flujo de 3 niveles. Recibe mes, día y categoría del paquete
  // pulsado. Es OPCIONAL y, si no se pasa, no se hace nada (frontera de alcance documentada arriba).
  onOpenPackage?: (month: number, day: number, categoryKey: CategoryPackage["categoryKey"]) => void;
};

// HORIZONTAL_SCROLL_STEP es cuántos píxeles se desplaza la espina con cada flecha del teclado.
// En español: al enfocar la cinta y pulsar Izquierda/Derecha, se mueve este tanto, para una
// navegación cómoda sin ratón (accesibilidad §12). Un valor amplio recorre rápido sin marear.
const HORIZONTAL_SCROLL_STEP = 320;

// reducedMotionScrollBehavior elige el tipo de desplazamiento según la preferencia del usuario.
// En español: cuando alguien pidió "menos movimiento" en su sistema, los desplazamientos
// programáticos (flechas del teclado, "Ir a hoy") deben ser INSTANTÁNEOS, no animados. Ojo: pasar
// el valor "smooth" de forma explícita a scrollBy/scrollTo/scrollIntoView IGNORA el `scroll-behavior`
// del CSS, así que hay que decidirlo aquí en JavaScript. En el servidor (sin window) devolvemos
// "smooth" por defecto, pero ahí no se hace scroll de todos modos.
function reducedMotionScrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "smooth";
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

// initialExpandedKey calcula qué estación (día) debe abrirse AL ENTRAR a la línea de tiempo: el día de
// HOY si tiene estrenos o, si está vacío, el PRÓXIMO día (>= hoy) con estrenos. Devuelve null si no hay
// ninguno. Es pura: se usa como inicializador perezoso del estado (corre UNA vez al montar), en vez de
// un efecto que fijaba el estado tras el primer pintado (parpadeo + regla set-state-in-effect).
function initialExpandedKey(
  releases: ReleaseSummary[],
  filter: Parameters<typeof matchesFilter>[1],
  today: TodayMarker,
): string | null {
  const filtered = releases.filter((release) => matchesFilter(release, filter));
  for (const monthGroup of buildCalendarMonths(filtered)) {
    for (const dayGroup of monthGroup.days) {
      const todayOrAfter =
        monthGroup.year > today.year ||
        (monthGroup.year === today.year && monthGroup.month > today.month) ||
        (monthGroup.year === today.year &&
          monthGroup.month === today.month &&
          dayGroup.day >= today.day);
      if (todayOrAfter && dayGroup.packages.length > 0) {
        return `${monthGroup.month}-${dayGroup.day}`;
      }
    }
  }
  return null;
}

// buildPackageAriaLabel arma la etiqueta accesible de un paquete con datos ya calculados.
// En español: junta categoría, día, mes, conteo y mejor calificación en una frase que el lector de
// pantalla anuncia al enfocar el paquete. Se apoya en i18n para el texto es-MX.
function buildPackageAriaLabel(
  categoryLabel: string,
  day: number,
  monthLabel: string,
  count: number,
  maxTmdb: string,
): string {
  return ui.timeline.packageAriaLabel(categoryLabel, day, monthLabel, count, maxTmdb);
}

// Timeline dibuja la espina completa: marcas de agua de mes, estaciones por día y la aguja HOY.
// En español: combina los estrenos de los dos meses, los filtra por el tipo elegido, los agrupa con
// los helpers puros y los pinta como un mapa de metro horizontal. También conecta el teclado y el
// botón "Ir a hoy" del Topbar. Ya NO dibuja el Hero (el protagonista es el fondo global rotativo).
export function Timeline({ releases, lane, today, onOpenPackage }: TimelineProps) {
  // Leemos del contexto el filtro activo y la función para registrar "Ir a hoy".
  const { filter, registerGoToToday, dateRange, dateAnchor, registerScrollToDate } = useFilter();

  // GUSTOS del usuario, calculados UNA vez para todo el carril. En español: antes CADA estación y CADA
  // chip llamaban useProfile() y armaban sus propios Sets — con ~550 estaciones montadas (3 copias ×
  // calendario completo × 2 carriles), CUALQUIER cambio del perfil (marcar watchlist, abrir la campana)
  // re-renderizaba todas. Ahora los Sets se arman aquí y bajan por props: si géneros/plataformas no
  // cambian, las referencias son estables y React.memo corta la cascada de re-renders.
  const { profile } = useProfile();
  const genreSet = useMemo(() => new Set(profile.settings.genres), [profile.settings.genres]);
  const platformSet = useMemo(
    () => new Set(profile.settings.platforms),
    [profile.settings.platforms],
  );

  // Referencia al contenedor scrolleable (la espina) para moverla con el teclado, "Ir a hoy" y el arrastre.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Referencia a la aguja HOY, para desplazarnos hasta ella con scrollIntoView (centrándola).
  const todayMarkerRef = useRef<HTMLDivElement | null>(null);
  // Referencias a CADA estación (de la copia PRINCIPAL), indexadas por "mes-día", para centrar la vista en
  // una fecha concreta (foco de "Esta semana"/"Este mes" y sus flechas). Solo la copia principal las puebla.
  const dayRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // expandedKey es la estación (día) ABIERTA ahora mismo, identificada por "mes-día" (ej. "6-15"), o null
  // si todas están colapsadas. En español (rediseño "mapa mental"): al pulsar una caja de día, se DIBUJAN
  // con animación sus ramas hacia las cards de cada categoría. Solo una estación abierta a la vez
  // (acordeón). ARRANCA auto-desplegada en el primer día con estrenos desde HOY (inicializador perezoso:
  // corre UNA sola vez al montar; si el usuario luego colapsa o filtra, no se reabre sola).
  const [expandedKey, setExpandedKey] = useState<string | null>(() =>
    initialExpandedKey(releases, filter, today),
  );

  // LAS COPIAS CLON SE MONTAN EN EL NAVEGADOR, NO EN EL SERVIDOR.
  //
  // En español: el bucle infinito necesita tres copias de la línea (clon · principal · clon), pero
  // las tres son idénticas. Escribirlas las tres en el HTML triplicaba la parte más pesada de la
  // portada (más de 11.000 elementos y 800 imágenes que el teléfono tenía que leer, maquetar e
  // hidratar antes de responder). Ahora el servidor escribe UNA copia y las otras dos se añaden en el
  // navegador después de hidratar.
  //
  // La copia que llega del servidor es la PRIMERA de las tres (la que siempre se veía al cargar,
  // con el desplazamiento en cero), y al montarse las otras dos pasa a ser el clon de la izquierda:
  // conserva sus mismos nodos (mismas claves), así que lo pintado no cambia ni un píxel y el
  // desplazamiento sigue en cero, igual que cuando las tres venían del servidor. Mientras está sola
  // hace de principal (enfocable y visible para los lectores de pantalla).
  //
  // Si la espina no se ve (en el teléfono, mientras se decide si toca la agenda), los clones no se
  // montan: esa espina va a desaparecer de todos modos.
  //
  // Se montan como transición (startTransition): React las construye a trozos, cediendo el hilo entre
  // uno y otro, en vez de en una sola tarea larga de cientos de milisegundos justo al hidratar. No se
  // ve ningún cambio mientras tanto: los clones nuevos quedan a la derecha, fuera de la vista.
  const [clonesMounted, setClonesMounted] = useState(false);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (clonesMounted || container === null || container.getClientRects().length === 0) {
      return;
    }
    startTransition(() => setClonesMounted(true));
  }, [clonesMounted]);

  // ARRASTRE de la espina: "agarrar y tirar" con inercia y bucle infinito. Toda la mecánica vive en
  // un hook compartido (useDragScroll), porque el carrusel de sagas del detalle usa exactamente el
  // mismo gesto: tenerlo escrito dos veces hacía que cualquier ajuste hubiera que repetirlo y que las
  // dos copias se fueran desajustando con el tiempo.
  const {
    handlers: dragHandlers,
    wrapScroll,
    shouldSuppressClick,
  } = useDragScroll(scrollContainerRef, {
    // El contenido está repetido en tres copias idénticas para el bucle infinito (una sola mientras
    // los clones no están montados: sin ellos no hay bucle que mantener).
    copies: clonesMounted ? 3 : 1,
  });

  // Los pulsos de HOY (aguja y caja del día) laten igual en las tres copias y solo se animan las que
  // están cerca de la vista (ver use-copy-pulses).
  useCopyPulses(scrollContainerRef, clonesMounted);

  // handleToggleDay abre/cierra la estación pulsada (acordeón). Si el "clic" viene del final de un
  // arrastre, se ignora: si no, cada vez que se recorre la espina se abriría un día por accidente.
  const handleToggleDay = useCallback(
    (key: string) => {
      if (shouldSuppressClick()) {
        return;
      }
      setExpandedKey((previous) => (previous === key ? null : key));
    },
    [shouldSuppressClick],
  );

  // Nota a11y: las copias CLON salen del orden de tabulación de forma DECLARATIVA — la prop isClone
  // baja hasta cada botón (caja de día y chips), que se renderiza con tabIndex=-1. Antes esto se hacía
  // con un barrido imperativo de querySelectorAll sobre TODO el contenedor DESPUÉS DE CADA RENDER
  // (efecto sin dependencias): cientos de nodos recorridos en cada cambio de estado. Ya no existe.

  // Mantenemos la banda central del infinito también ante desplazamientos que NO pasan por el arrastre
  // (teclado, rueda del ratón, "Ir a hoy"): un oyente de scroll llama a wrapScroll. wrapScroll se
  // AUTO-ESTABILIZA (solo reubica si saliste de la banda), por eso no entra en bucle infinito.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container === null) {
      return;
    }
    const onScroll = () => wrapScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [wrapScroll]);

  // La lista de estrenos ya viene combinada (todos los meses) desde la página; la usamos tal cual.
  const allReleases = releases;

  // Aplicamos el filtro por tipo ANTES de agrupar: así los conteos, el "★ máximo" y los efectos por
  // cantidad reflejan SOLO lo que el filtro deja ver (un paquete que se queda sin estrenos desaparece).
  // Memoizamos el resultado: solo se recalcula cuando cambian los datos o el filtro.
  const monthGroups = useMemo<MonthGroup[]>(() => {
    const filtered = allReleases.filter((release) => matchesFilter(release, filter));
    // Calendario COMPLETO: cada mes con TODOS sus días (los vacíos también), para una línea de tiempo
    // real y continua. Los meses sin NINGÚN estreno (tras el filtro) no aparecen (no hay nada que mostrar).
    return buildCalendarMonths(filtered);
  }, [allReleases, filter]);

  // ¿Quedó algún PAQUETE visible tras el filtro? Ahora los meses traen todos sus días (muchos vacíos),
  // así que el "vacío por filtro" se decide por si hay al menos un paquete con estrenos en algún día.
  const hasVisibleReleases = monthGroups.some((monthGroup) =>
    monthGroup.days.some((dayGroup) => dayGroup.packages.length > 0),
  );

  // Decidimos DÓNDE va la aguja HOY respecto a los meses con estrenos: antes de todos (si "hoy" es
  // anterior al primer mes), DENTRO de un mes (si "hoy" cae en un mes con estrenos) o después de todos.
  // En la demo "hoy" es mitad de junio, así que la aguja queda DENTRO de junio, entre las estaciones.
  const firstMonth = monthGroups[0];
  const lastMonth = monthGroups[monthGroups.length - 1];
  // El orden de los meses ya es cronológico (incluye el cruce de año). Comparar solo el número
  // de mes hacía que enero pareciera anterior a octubre.
  const monthRank = (year: number, month: number): number => year * 12 + month;
  const todayRank = monthRank(today.year, today.month);
  const markerBeforeAll =
    firstMonth === undefined || todayRank < monthRank(firstMonth.year, firstMonth.month);
  const markerAfterAll =
    lastMonth !== undefined && todayRank > monthRank(lastMonth.year, lastMonth.month);

  // scrollToToday lleva la espina hasta la aguja HOY de forma accesible.
  // En español: usa scrollIntoView para CENTRAR la aguja en la zona visible. Es la acción que el
  // Topbar dispara con "Ir a hoy". Si la aguja aún no está montada, no hace nada (sin romperse).
  const scrollToToday = useCallback(() => {
    const marker = todayMarkerRef.current;
    if (marker !== null) {
      marker.scrollIntoView({
        behavior: reducedMotionScrollBehavior(),
        inline: "center",
        block: "nearest",
      });
    }
  }, []);

  // Registramos "Ir a hoy" en el contexto al montar, y lo des-registramos al desmontar.
  // En español: así el botón "Ir a hoy" del Topbar (que vive en otro componente) puede pedir este
  // scroll sin conocer nuestros detalles internos. registerGoToToday nos devuelve la función de
  // limpieza, que React ejecuta al desmontar este componente.
  useEffect(() => {
    const unregister = registerGoToToday(scrollToToday);
    return unregister;
  }, [registerGoToToday, scrollToToday]);

  // scrollToDate centra la vista en la estación de la fecha pedida (foco de semana/mes y sus flechas).
  // En español: busca la estación EXACTA "mes-día"; si ese día no existe en esta línea (calendario solo
  // cubre meses con estrenos), cae a la estación más cercana del MISMO mes; si el mes tampoco está, no
  // hace nada (sin romperse). Se registra en el contexto igual que "Ir a hoy" para afectar a ambos carriles.
  const scrollToDate = useCallback((month: number, day: number) => {
    const refs = dayRefs.current;
    let target = refs.get(`${month}-${day}`);
    if (target === undefined) {
      // Día sin estación propia: buscamos la del mismo mes con el número de día más cercano.
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const [key, element] of refs) {
        const [keyMonth, keyDay] = key.split("-").map(Number);
        if (keyMonth !== month) {
          continue;
        }
        const distance = Math.abs(keyDay - day);
        if (distance < bestDistance) {
          bestDistance = distance;
          target = element;
        }
      }
    }
    if (target !== undefined) {
      target.scrollIntoView({
        behavior: reducedMotionScrollBehavior(),
        inline: "center",
        block: "nearest",
      });
    }
  }, []);
  useEffect(() => {
    const unregister = registerScrollToDate(scrollToDate);
    return unregister;
  }, [registerScrollToDate, scrollToDate]);

  // Al MONTAR, llevamos la vista al DÍA DE APERTURA, sin animación, para aterrizar centrados en vez de
  // en el extremo izquierdo. Solo corre una vez (por eso el arreglo de dependencias va vacío) y usa
  // referencias, no estado, para no reaccionar a cambios posteriores del ancla.
  //
  // Cuál es el "día de apertura", y por qué NO es siempre hoy:
  //
  // El ancla que llega del servidor ya viene resuelta al primer día CON estrenos a partir de hoy (ver
  // firstAnchorWithContent en lib/timeline.ts). Cuando el catálogo cubre el día de hoy, ese día ES hoy
  // y no se nota ninguna diferencia. Cuando no lo cubre —catálogo generado mirando a los meses
  // siguientes, o unos días sin refrescar—, aterrizar en hoy dejaba a la persona mirando una franja de
  // días vacíos, con el encabezado anunciando un mes sin nada dentro: la aplicación parecía rota
  // teniendo cientos de estrenos un poco más a la derecha.
  //
  // Si por lo que fuera la estación del ancla no existiera en este carril (por ejemplo, el carril de
  // cine cuando ese día solo hay series), se cae a la aguja de HOY, que siempre está montada.
  //
  // Corre cuando ya están los clones (como cuando el servidor los escribía): el destino es la estación
  // de la copia principal, que hasta entonces no existe.
  const openingAnchorRef = useRef(dateAnchor);
  const openedRef = useRef(false);
  useEffect(() => {
    if (!clonesMounted || openedRef.current) {
      return;
    }
    openedRef.current = true;
    // Se espera a que el navegador pinte UNA vez la línea completa en la posición de partida. Las
    // estaciones vacías usan content-visibility (globals.css): su ancho real solo se conoce y se
    // recuerda después de pintarse, y el centrado depende de esos anchos. Cuando las tres copias
    // venían del servidor, el navegador siempre había pintado ya ese tramo al llegar aquí; con este
    // fotograma de espera se centra exactamente igual, sea el equipo rápido o lento.
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        const anchor = openingAnchorRef.current;
        const station = dayRefs.current.get(`${anchor.month}-${anchor.day}`);
        const target = station ?? todayMarkerRef.current;
        if (target !== null && target !== undefined) {
          target.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
        }
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [clonesMounted]);

  // handleKeyDown permite desplazar la espina horizontalmente con las flechas del teclado.
  // En español: cuando la cinta tiene el foco, Izquierda/Derecha la mueven un paso. Inicio/Fin van a
  // los extremos. Es accesibilidad §12 (navegación 100% por teclado). Solo interceptamos esas teclas;
  // las demás siguen su curso normal para no robar el comportamiento del navegador.
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current;
    if (container === null) {
      return;
    }
    switch (event.key) {
      case "ArrowRight":
        // Evitamos el desplazamiento por defecto y movemos la espina hacia la derecha.
        event.preventDefault();
        container.scrollBy({
          left: HORIZONTAL_SCROLL_STEP,
          behavior: reducedMotionScrollBehavior(),
        });
        break;
      case "ArrowLeft":
        event.preventDefault();
        container.scrollBy({
          left: -HORIZONTAL_SCROLL_STEP,
          behavior: reducedMotionScrollBehavior(),
        });
        break;
      case "Home":
        // Inicio: al extremo izquierdo (las fechas más tempranas).
        event.preventDefault();
        container.scrollTo({ left: 0, behavior: reducedMotionScrollBehavior() });
        break;
      case "End":
        // Fin: al extremo derecho (los meses más lejanos).
        event.preventDefault();
        container.scrollTo({
          left: container.scrollWidth,
          behavior: reducedMotionScrollBehavior(),
        });
        break;
      default:
        // Cualquier otra tecla no nos concierne: la dejamos pasar.
        break;
    }
  }, []);

  // Metadatos del carril: su título visible y las categorías que pinta su leyenda.
  const laneMeta = LANE_META[lane];

  // ----- Estado VACÍO total: no hay estrenos en ningún mes (antes del filtro) -----
  // En español: si la lista del carril llega vacía, mostramos el estado vacío y NO dibujamos la espina
  // (no hay estaciones que mostrar). El error de red lo maneja la página, no este componente.
  if (allReleases.length === 0) {
    return <EmptyState lane={lane} />;
  }

  // renderCopy dibuja UNA copia del contenido (las agujas HOY + todos los meses). El carrusel INFINITO
  // pinta TRES copias idénticas (clon · principal · clon); al desplazarte de una a otra, el wrap reajusta
  // el scroll para mantenerte en la banda central, dando la ilusión de una línea sin principio ni fin.
  // Solo la copia PRINCIPAL (isMain) lleva la referencia de la aguja (para centrar/"Ir a hoy"); las copias
  // clon dibujan la aguja igual (continuidad visual) pero sin referencia, y van inertes (no interactivas).
  const renderCopy = (copyKey: string, isMain: boolean): JSX.Element => (
    <>
      {markerBeforeAll ? (
        <TodayNeedle label={today.label} markerRef={isMain ? todayMarkerRef : null} />
      ) : null}
      {monthGroups.map((monthGroup, index) => (
        <MonthSpine
          key={`${copyKey}-${monthGroup.year}-${monthGroup.month}`}
          monthGroup={monthGroup}
          onOpenPackage={onOpenPackage}
          expandedKey={expandedKey}
          onToggleDay={handleToggleDay}
          today={today}
          dateRange={dateRange}
          dateAnchor={dateAnchor}
          dayRefs={isMain ? dayRefs : null}
          hasTodayNeedle={
            !markerBeforeAll &&
            !markerAfterAll &&
            today.year === monthGroup.year &&
            today.month === monthGroup.month
          }
          needleRef={isMain ? todayMarkerRef : null}
          // isFirst evita dibujar el "borde de mes" antes del PRIMER mes (no hay mes previo del que
          // separarlo); del segundo en adelante, el borde marca el salto entre meses sobre la espina.
          isFirst={index === 0}
          // isClone marca las copias NO principales: sus botones salen del tab-order de forma
          // DECLARATIVA (tabIndex=-1 en el JSX), sin el barrido imperativo del DOM que había antes.
          isClone={!isMain}
          genreSet={genreSet}
          platformSet={platformSet}
        />
      ))}
      {markerAfterAll ? (
        <TodayNeedle label={today.label} markerRef={isMain ? todayMarkerRef : null} />
      ) : null}
    </>
  );

  return (
    // Envoltorio del CARRIL: cada línea de tiempo (cine / no-cine) ocupa su franja de la página (el
    // reparto vertical lo hace .tlx-lanes en globals.css vía data-lane). La espina y las estaciones se
    // centran verticalmente dentro de su franja.
    <section className="tlx-stage font-ui relative" data-lane={lane} aria-label={laneMeta.label}>
      {/*
        Leyenda flotante (esquina superior): título del carril + colores de SUS categorías. Va por encima
        de la espina, discreta, para no robar protagonismo al fondo ni a las estaciones. Es informativa.
      */}
      <div className="tlx-legend-bar">
        {/* Encabezado del carril ("Estrenos de cine" / "Series y streaming"): da a cada línea su título
            real para que lectores de pantalla naveguen por headings entre los dos carriles. */}
        <h2 className="font-hud text-[11px] tracking-[0.2em] uppercase text-gold-bright">
          {laneMeta.label}
        </h2>
        <ul className="hidden gap-4 text-xs text-text-muted sm:flex">
          {laneMeta.categories.map((categoryKey) => (
            <LegendItem
              key={categoryKey}
              colorVar={CATEGORY_META[categoryKey].accentVar}
              label={ui.timeline.legend[categoryKey]}
            />
          ))}
        </ul>
      </div>

      {/*
        Contenedor scrolleable horizontal (la espina). Es enfocable (tabIndex 0) y tiene rol de grupo
        con etiqueta para que los lectores de pantalla lo anuncien como una región desplazable; las
        flechas del teclado lo mueven (handleKeyDown). La línea dorada de la espina y su resplandor los
        aporta globals.css (tlx-spine), centrada verticalmente a media altura.
      */}
      <div
        ref={scrollContainerRef}
        onKeyDown={handleKeyDown}
        {...dragHandlers}
        role="group"
        aria-label={ui.timeline.laneScrollRegionLabel(laneMeta.label)}
        tabIndex={0}
        className="tlx-track relative overflow-x-auto overflow-y-hidden"
      >
        {/*
          tlx-track-inner: contenedor cuyo ancho es el del CONTENIDO (max-content). La espina se
          posiciona respecto a ÉL (no al viewport), así la línea dorada abarca TODA la línea de tiempo y
          se ve al arrastrar de un extremo a otro. Antes la espina medía solo el ancho VISIBLE y, anclada
          al inicio, se perdía al desplazarse (la línea "no atravesaba todo").
        */}
        <div className="tlx-track-inner relative flex items-stretch">
          {/* La ESPINA: línea horizontal dorada que cruza TODO el contenido (las 3 copias). Decorativa. */}
          <span aria-hidden="true" className="tlx-spine" />

          {/*
            TRES copias idénticas del contenido para el carrusel INFINITO: clon · PRINCIPAL · clon. Sirven
            para que, al desplazarte hacia un extremo, siempre haya "más línea" antes de que el wrap te
            reubique en la copia central. Así el carrusel no tiene principio ni fin: se redirige a sí mismo.
            CLAVE: las copias clon van `data-clone` + `aria-hidden` (ocultas a lectores de pantalla), pero
            NO `inert`. Antes usábamos `inert`, que también bloquea el PUNTERO: como el viewport cruza el
            borde de banda y a veces muestra una copia clon, al pulsar una caja de día visible "no pasaba
            nada" (el clon inert se comía el clic). Ahora los clones SÍ reciben clic: pulsar cualquier copia
            togglea por su stationKey (mes-día), que es idéntico en las tres, así el día se abre se vea la
            copia que se vea. El foco por teclado en los clones se neutraliza en un efecto (data-clone).
          */}
          <div
            className="tlx-copy"
            data-clone={clonesMounted ? true : undefined}
            aria-hidden={clonesMounted ? "true" : undefined}
          >
            {renderCopy("a", !clonesMounted)}
          </div>
          {clonesMounted ? (
            <>
              <div className="tlx-copy">{renderCopy("b", true)}</div>
              <div className="tlx-copy" data-clone aria-hidden="true">
                {renderCopy("c", false)}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/*
        Estado VACÍO del FILTRO: hay estrenos en el catálogo, pero el filtro de tipo los ocultó todos.
        Lo mostramos centrado sobre la espina (que queda con solo la aguja HOY), para que el usuario
        entienda que el filtro está activo y no que "no hay datos".
      */}
      {!hasVisibleReleases ? (
        <p className="tlx-filter-empty" role="status">
          {ui.timeline.emptyHint}
        </p>
      ) : null}
    </section>
  );
}

// TodayNeedleProps son las props de la aguja HOY (la "aguja del ahora" sobre la espina).
type TodayNeedleProps = {
  // label es el texto de la aguja, ej. "HOY · 15 JUN".
  label: string;
  // markerRef es la referencia a la aguja para centrar la espina en ella ("Ir a hoy" / al montar). Es
  // OPCIONAL: con el carrusel INFINITO la aguja se dibuja en las 3 copias (continuidad visual), pero solo
  // la copia PRINCIPAL lleva la referencia (las copias clon la reciben null y no se referencian).
  markerRef?: RefObject<HTMLDivElement | null> | null;
};

// TodayNeedle dibuja la aguja prominente del "ahora": una columna alta con la línea dorada y la perilla
// justo sobre la espina, y la etiqueta "HOY · 15 JUN" arriba.
// En español: es el marcador del cascarón v3 reinterpretado para la espina. Va INTERCALADO entre las
// estaciones (o al inicio/fin) según la fecha de hoy. Su altura cubre todo el track para que la línea
// cruce la espina de forma vistosa. Es la referencia que centramos al montar y con "Ir a hoy".
function TodayNeedle({ label, markerRef }: TodayNeedleProps): JSX.Element {
  return (
    <div ref={markerRef ?? undefined} className="tlx-needle">
      {/* Etiqueta "HOY · 15 JUN" en oro claro, sobre la perilla. */}
      <span className="tlx-needle-label font-mono">{label}</span>
      {/* Línea vertical dorada con resplandor (la "aguja"). Decorativa. */}
      <span aria-hidden="true" className="tlx-needle-line" />
      {/* Perilla redonda justo sobre la espina, anclada al centro del track. Decorativa. */}
      <span aria-hidden="true" className="tlx-needle-knob" />
    </div>
  );
}

// MonthSpineProps son las props de un tramo de mes dentro de la espina.
type MonthSpineProps = {
  // monthGroup es el mes ya agrupado en días con sus paquetes.
  monthGroup: MonthGroup;
  // onOpenPackage es el gancho del flujo de 3 niveles, opcional.
  onOpenPackage?: (month: number, day: number, categoryKey: CategoryPackage["categoryKey"]) => void;
  // expandedKey es la estación abierta ("mes-día") y onToggleDay la abre/cierra (acordeón colapsar/expandir).
  // Este componente SÍ necesita la llave completa: es quien sabe cuál de todas está abierta. Lo que baja
  // a cada estación es solo un sí/no (ver más abajo).
  expandedKey: string | null;
  onToggleDay: (key: string) => void;
  // today es el marcador HOY (para atenuar las estaciones ya pasadas de este mes).
  today: TodayMarker;
  // dateRange es el FILTRO POR FECHA activo: atenúa las estaciones cuyo día cae FUERA del rango.
  dateRange: DateRange;
  // dateAnchor es la fecha de referencia de "week"/"month" (las flechas la mueven): define el rango activo.
  dateAnchor: DateAnchor;
  // dayRefs es el mapa "mes-día"→elemento que usa el centrado de foco; solo lo pasa la copia PRINCIPAL
  // (en las clon llega null y sus estaciones no se registran, para no referenciar duplicados).
  dayRefs: RefObject<Map<string, HTMLDivElement>> | null;
  // hasTodayNeedle indica si ESTE mes contiene a "hoy": dibuja la aguja ENTRE sus estaciones. Se calcula
  // en el padre y se pasa a TODAS las copias del carrusel infinito (la aguja se ve en las tres).
  hasTodayNeedle: boolean;
  // needleRef es la referencia a la aguja, SOLO en la copia principal (para centrar/"Ir a hoy"). En las
  // copias clon llega null: la aguja se dibuja igual, pero no se referencia.
  needleRef?: RefObject<HTMLDivElement | null> | null;
  // isFirst indica si este es el PRIMER mes del recorrido: si lo es, NO dibujamos el "borde de mes"
  // (no hay mes anterior del que separarlo). En los siguientes, el borde marca el salto entre meses.
  isFirst?: boolean;
  // isClone marca las copias NO principales del carrusel infinito: sus botones llevan tabIndex=-1
  // (fuera del tab-order) de forma declarativa.
  isClone?: boolean;
  // genreSet/platformSet son los GUSTOS del usuario, precalculados UNA vez en Timeline (referencias
  // estables mientras no cambien géneros/plataformas — clave para que React.memo corte re-renders).
  genreSet: Set<string>;
  platformSet: Set<string>;
};

// MonthSpine dibuja un tramo de mes: su marca de agua gigante centrada detrás y su hilera de estaciones.
// En español: la marca de agua ("JUNIO"/"JULIO") es texto decorativo enorme detrás, centrado vertical y
// horizontalmente en el tramo; las estaciones van por encima, alineadas con la espina. Si el mes no
// tuviera estaciones visibles, no se dibuja (lo decide el padre con el filtro).
// Va MEMOIZADO (React.memo): con props estables, un cambio del perfil que no toque gustos ni filtro
// no vuelve a renderizar el tramo completo (~30 estaciones × 3 copias).
const MonthSpine = memo(function MonthSpine({
  monthGroup,
  onOpenPackage,
  expandedKey,
  onToggleDay,
  today,
  dateRange,
  dateAnchor,
  dayRefs,
  hasTodayNeedle,
  needleRef,
  isFirst,
  isClone = false,
  genreSet,
  platformSet,
}: MonthSpineProps) {
  // Si tras el filtro el mes quedó sin estaciones, no ocupamos espacio con un tramo vacío.
  if (monthGroup.days.length === 0) {
    return null;
  }

  // Nombre del mes (para la marca de agua y el borde de mes), de la fuente única MONTHS.
  const monthName = monthGroup.label || MONTHS[monthGroup.month] || "";

  // ¿Este mes entero ya pasó respecto a "hoy"? (un mes anterior al de hoy se atenúa por completo).
  const monthIsPast =
    monthGroup.year < today.year ||
    (monthGroup.year === today.year && monthGroup.month < today.month);
  // Si este mes CONTIENE a "hoy" (hasTodayNeedle), calculamos ANTES de qué estación va la aguja: la
  // primera cuyo número de día sea >= al día de hoy. Si "hoy" es posterior a todas las estaciones del
  // mes, findIndex devuelve -1 y la aguja irá al final de la hilera.
  const markerIndex = hasTodayNeedle
    ? monthGroup.days.findIndex((dayGroup) => dayGroup.day >= today.day)
    : -1;

  return (
    <div className="tlx-month relative flex items-stretch">
      {/*
        Marca de agua del mes: texto gigante con solo contorno tenue, detrás de todo (z-0), centrada en
        el tramo y sin capturar eventos. Es decorativa (aria-hidden): el mes ya se comunica por los días.
      */}
      <span aria-hidden="true" className="tlx-month-wm font-display">
        {monthName}
      </span>

      {/*
        Borde de mes: un separador SUTIL pero identificable en el salto entre meses. Es una columna fina
        que cruza la espina con una línea vertical tenue (degradada en los extremos) y, sobre la espina, una
        etiqueta con el nombre del mes (mono, vertical). Solo del SEGUNDO mes en adelante (el primero no
        tiene mes previo del que separarse). Decorativo (aria-hidden): el dato del mes ya está en los días.
      */}
      {!isFirst ? (
        <div aria-hidden="true" className="tlx-month-edge">
          <span className="tlx-month-edge-line" />
          <span className="tlx-month-edge-label font-mono">{monthName}</span>
        </div>
      ) : null}

      {/* Hilera de estaciones por encima de la marca de agua, alineadas con la espina. */}
      <div className="relative z-[1] flex items-stretch">
        {monthGroup.days.map((dayGroup, index) => {
          // Una estación es "pasada" si su mes ya pasó, o si es del mes de hoy y su número < hoy.
          const dayIsPast =
            monthIsPast ||
            (monthGroup.year === today.year &&
              monthGroup.month === today.month &&
              dayGroup.day < today.day);
          // ¿Es HOY exactamente? (mismo año, mes y día que el marcador). Lo resaltamos en su caja.
          const dayIsToday =
            monthGroup.year === today.year &&
            monthGroup.month === today.month &&
            dayGroup.day === today.day;
          // ¿Cae este día FUERA del rango de fecha activo? Si es así, lo atenuamos (no lo ocultamos):
          // el contexto de toda la línea se conserva y solo el rango elegido queda en intensidad plena.
          const dayOutOfRange = !isDayInRange(
            monthGroup.month,
            dayGroup.day,
            today,
            dateRange,
            dateAnchor,
            monthGroup.year,
            yearOfMonth(today, dateAnchor.month),
          );
          return (
            <Fragment key={dayGroup.day}>
              {/* Aguja HOY intercalada: justo ANTES de la primera estación >= hoy (si es el mes de hoy). */}
              {hasTodayNeedle && index === markerIndex ? (
                <TodayNeedle label={today.label} markerRef={needleRef} />
              ) : null}
              <DayStation
                month={monthGroup.month}
                dayGroup={dayGroup}
                onOpenPackage={onOpenPackage}
                // SE PASA UN BOOLEANO, NO LA LLAVE DE LA ESTACIÓN ABIERTA. La diferencia parece una
                // minucia y es la causa medida de que abrir un día tardara 158 milisegundos:
                //
                // Antes bajaba aquí `expandedKey`, el identificador de la estación abierta. Ese valor
                // CAMBIA cada vez que se abre o se cierra un día, así que las mil noventa y ocho
                // estaciones veían una propiedad distinta a la vez, ninguna podía reutilizar su
                // dibujado anterior y React las reevaluaba todas — para que, al final, solo dos
                // cambiaran de aspecto: la que se cerró y la que se abrió.
                //
                // Con un booleano por estación, mil noventa y seis siguen recibiendo exactamente el
                // mismo `false` de antes, reconocen que nada suyo cambió y se saltan el trabajo. Solo
                // se rehacen las dos que de verdad cambiaron.
                //
                // Detalle que costó descubrir: quitar nodos del DOM NO arreglaba esto. Se probó a
                // arrancar las copias clon (de once mil setecientos nodos a cuatro mil) y el clic
                // tardó un poco MÁS. El coste no estaba en el navegador dibujando: estaba aquí.
                isExpanded={expandedKey === `${monthGroup.month}-${dayGroup.day}`}
                onToggleDay={onToggleDay}
                isPast={dayIsPast}
                isToday={dayIsToday}
                outOfRange={dayOutOfRange}
                stationRef={dayRefs}
                isClone={isClone}
                genreSet={genreSet}
                platformSet={platformSet}
              />
            </Fragment>
          );
        })}
        {/* Si "hoy" es posterior a todas las estaciones de este mes (markerIndex === -1), va al final. */}
        {hasTodayNeedle && markerIndex === -1 ? (
          <TodayNeedle label={today.label} markerRef={needleRef} />
        ) : null}
      </div>
    </div>
  );
});

// DayStationProps son las props de una ESTACIÓN (un día) sobre la espina.
type DayStationProps = {
  // month es el número de mes al que pertenece esta estación (para onOpenPackage y la a11y).
  month: number;
  // dayGroup es el día ya agrupado: su número, su día de la semana y sus paquetes por categoría.
  dayGroup: DayGroup;
  // onOpenPackage es el gancho del flujo de 3 niveles, opcional.
  onOpenPackage?: (month: number, day: number, categoryKey: CategoryPackage["categoryKey"]) => void;
  // isExpanded dice si es ESTA estación la que está abierta; onToggleDay la abre/cierra. Cuando lo está,
  // dibujamos (con animación) sus ramas hacia las tarjetas de categoría; si no, solo su caja de día.
  //
  // Es un BOOLEANO a propósito, no el identificador de la estación abierta. Ver la explicación larga en
  // el punto donde se pasa: de eso dependía que abrir un día costara 158 milisegundos.
  isExpanded: boolean;
  onToggleDay: (key: string) => void;
  // isPast indica si esta estación ya pasó respecto a "hoy": si es true, la atenuamos (gris/translúcida)
  // para que se lea "ya ocurrió", dejando ver claramente lo que viene a partir de la aguja HOY.
  isPast?: boolean;
  // isToday marca la estación que ES hoy (mismo mes y día que el marcador), para resaltar su caja.
  isToday?: boolean;
  // outOfRange indica que el día cae FUERA del filtro de fecha activo: lo atenuamos (sin ocultarlo),
  // como el día pasado pero por otra razón. Si "all" está activo, nunca llega true.
  outOfRange?: boolean;
  // stationRef es el mapa "mes-día"→elemento donde esta estación se registra (para el centrado de foco).
  // Solo lo pasa la copia PRINCIPAL; en las clon llega null y la estación no se registra.
  stationRef?: RefObject<Map<string, HTMLDivElement>> | null;
  // isClone saca los botones de esta estación del tab-order (copias clon del carrusel infinito).
  isClone?: boolean;
  // genreSet/platformSet son los gustos del usuario precalculados en Timeline (referencias estables).
  genreSet: Set<string>;
  platformSet: Set<string>;
};

// DENSE_DAY_THRESHOLD es el mínimo de estrenos en un día para encender su nodo de estación.
// En español: si un día junta muchos estrenos (4 o más), su nodo sobre la espina se enciende en oro,
// señalando "día denso". Es el mismo umbral del cascarón (dItems.length>=4).
const DENSE_DAY_THRESHOLD = 4;

// WEEKEND_SHORT_DAYS son las abreviaturas de los días que forman el fin de semana en es-MX.
// En español: se declara como conjunto con nombre en vez de comparar textos sueltos dentro del
// componente, para que la regla ("qué cuenta como fin de semana") se lea de un vistazo y esté en un
// solo sitio.
const WEEKEND_SHORT_DAYS = new Set(["Sáb", "Dom"]);

// DAY_POSTER_PEEK_LIMIT es cuántas carátulas se asoman como mucho en un día sin abrir.
// En español: tres. Con una no se intuye que hay varias cosas; con más, la fila se amontona y se
// multiplican las imágenes en pantalla sin que nadie las mire. El número exacto de estrenos ya lo
// dice la cifra de la caja, así que estas carátulas son un ANTICIPO, no un inventario.
const DAY_POSTER_PEEK_LIMIT = 3;

// DayStation dibuja UNA estación: sus paquetes colgando ALTERNADOS arriba/abajo de la espina, el nodo
// sobre el eje y la etiqueta de día (número + día de semana) junto al eje.
// En español: es la columna vertical de un día. Tiene TRES zonas apiladas: (1) la zona ARRIBA, donde
// cuelgan los paquetes de índice par (0, 2, …) creciendo hacia arriba desde la espina; (2) el EJE, con
// el nodo de la estación y la etiqueta del día centrados sobre la espina; (3) la zona ABAJO, donde
// cuelgan los paquetes de índice impar (1, 3, …) creciendo hacia abajo. Cada paquete lleva un TALLO
// (línea vertical) que lo une al nodo, como una rama de grafo de git.
// Va MEMOIZADO (React.memo): es el componente que más instancias monta (~550 entre copias y carriles);
// con props estables, los cambios de perfil que no tocan gustos ya no lo re-renderizan en masa.
const DayStation = memo(function DayStation({
  month,
  dayGroup,
  onOpenPackage,
  isExpanded,
  onToggleDay,
  isPast = false,
  isToday = false,
  outOfRange = false,
  stationRef = null,
  isClone = false,
  genreSet,
  platformSet,
}: DayStationProps) {
  // Total de estrenos del día (para "denso" y el conteo del indicador) y la llave de esta estación.
  const totalCount = dayGroup.packages.reduce(
    (sum, categoryPackage) => sum + categoryPackage.count,
    0,
  );
  const isDense = totalCount >= DENSE_DAY_THRESHOLD;
  // Día VACÍO (sin estrenos): en el calendario completo la mayoría de días no tienen estreno. Se dibujan
  // como una caja tenue, NO interactiva (no hay ramas que abrir): solo marcan la continuidad del tiempo.
  const isEmpty = dayGroup.packages.length === 0;
  // isWeekend detecta sábado y domingo a partir de la abreviatura del día que ya viene calculada,
  // sin volver a mirar la fecha: ese dato ya está resuelto y en la zona horaria correcta.
  const isWeekend = WEEKEND_SHORT_DAYS.has(dayGroup.weekdayShort);

  // ASOMO DE PÓSTERS: las carátulas de lo que estrena ese día, en pequeño, sobre la caja.
  //
  // Por qué existe, en español: hasta ahora, un día sin abrir era una etiqueta con una fecha y un
  // número. Eso convertía la línea de tiempo —en una aplicación que va de PELÍCULAS— en algo que se
  // leía como una hoja de cálculo: para saber qué había un día, no quedaba más remedio que abrirlo,
  // uno por uno. Y el espacio de encima estaba vacío, así que la pantalla se veía desierta aunque el
  // mes tuviera cientos de estrenos.
  //
  // Con las carátulas a la vista, recorrer el mes es RECONOCER: se pasa el ojo y se ve qué viene, sin
  // pulsar nada. Es también lo que le da al calendario el aire del producto que es.
  //
  // Tres decisiones para que esto no salga caro:
  //   · Como mucho TRES carátulas por día. Más no aportan y multiplicarían las imágenes en pantalla.
  //   · Se piden en el tamaño más pequeño que existe (ver tmdbImage): pedir la imagen de tarjeta para
  //     pintar 34 píxeles sería descargar diez veces lo necesario, cien veces seguidas.
  //   · Carga diferida: el navegador solo baja las de los días que de verdad se están viendo. La
  //     línea de tiempo monta cientos de estaciones, así que sin esto se dispararían cientos de
  //     descargas de golpe al abrir.
  const dayPosters = useMemo(() => {
    if (isEmpty) {
      return [];
    }
    const posters: { id: string; url: string; title: string }[] = [];
    for (const categoryPackage of dayGroup.packages) {
      for (const item of categoryPackage.items) {
        if (item.posterUrl === "") {
          continue;
        }
        posters.push({
          id: item.id,
          url: tmdbImage(item.posterUrl, "tiny"),
          title: item.title,
        });
        if (posters.length >= DAY_POSTER_PEEK_LIMIT) {
          return posters;
        }
      }
    }
    return posters;
  }, [isEmpty, dayGroup.packages]);

  // GUSTOS del usuario: si la caja del día (incluso COLAPSADA) contiene algún estreno que encaje con sus
  // géneros/plataformas, la marcamos con un punto oro, para que al recorrer la línea de tiempo localice
  // de un vistazo "los días que traen lo mío" sin tener que abrir cada estación. Los Sets llegan por
  // props (precalculados una vez en Timeline), no de useProfile: así el memo de arriba funciona.
  const dayMatches =
    (genreSet.size > 0 || platformSet.size > 0) &&
    dayGroup.packages.some((categoryPackage) =>
      categoryPackage.items.some((item) => releaseMatchesPrefs(item, genreSet, platformSet)),
    );
  const stationKey = `${month}-${dayGroup.day}`;

  // Repartimos los paquetes en dos columnas: índice PAR arriba, IMPAR abajo (alternancia estable
  // Cine -> Streaming -> Cadenas, igual que groupByMonth: Cine arriba, Streaming abajo, Cadenas arriba).
  const packagesAbove = dayGroup.packages.filter((_, index) => index % 2 === 0);
  const packagesBelow = dayGroup.packages.filter((_, index) => index % 2 === 1);

  // handleToggle abre/cierra la estación (el padre maneja el acordeón y el "ignora clic tras arrastrar").
  const handleToggle = () => {
    onToggleDay(stationKey);
  };

  // Etiqueta accesible de la caja de día (es un botón que expande/colapsa el día). Usa el nombre
  // COMPLETO del día ("Viernes") — lo mismo que se ve — con la abreviatura como respaldo.
  const dayboxAria = ui.timeline.dayboxAriaLabel(
    dayGroup.day,
    dayGroup.weekdayFull || dayGroup.weekdayShort,
    totalCount,
    isExpanded,
  );

  // Clases de la caja: base + vacía/densa/abierta/hoy. Mismo número y día de semana en ambos casos.
  const dayboxClass = [
    "tlx-daybox",
    isEmpty ? "tlx-daybox-empty" : "",
    isDense ? "tlx-daybox-on" : "",
    isExpanded ? "tlx-daybox-open" : "",
    isToday ? "tlx-daybox-today" : "",
    dayMatches ? "tlx-daybox-match" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const dayNumText = String(dayGroup.day).padStart(2, "0");

  return (
    <div
      // Registramos esta estación en el mapa "mes-día"→elemento (solo copia principal) para que el
      // centrado de foco (semana/mes y sus flechas) pueda llevar la vista aquí.
      ref={(element) => {
        if (stationRef === null) {
          return;
        }
        if (element !== null) {
          stationRef.current.set(stationKey, element);
        } else {
          stationRef.current.delete(stationKey);
        }
      }}
      className="tlx-station"
      // data-past atenúa días pasados; data-expanded activa el dibujado de ramas; data-empty los días sin
      // estrenos (caja tenue); data-today resalta el día de hoy; data-outrange atenúa los días fuera del
      // filtro de fecha activo (lo aplica el CSS igual que el pasado, pero por otra razón).
      data-past={isPast ? "true" : undefined}
      data-expanded={isExpanded ? "true" : undefined}
      data-empty={isEmpty ? "true" : undefined}
      data-today={isToday ? "true" : undefined}
      data-outrange={outOfRange ? "true" : undefined}
    >
      {/*
        Zona ARRIBA de la espina: ramas "pares". Solo se MONTAN (y animan su "dibujado" tipo serpiente)
        cuando la estación está EXPANDIDA; colapsada/vacía, el brazo queda vacío (solo cajas de día).
      */}
      <div className="tlx-arm tlx-arm-above">
        {/*
          Con el día CERRADO se asoman las carátulas; al abrirlo dejan sitio a las ramas, que ya
          enseñan la información completa. Así el espacio nunca está ni vacío ni duplicado.
        */}
        {!isEmpty && !isExpanded && dayPosters.length > 0 ? (
          <span className="tlx-daypeek" aria-hidden="true">
            {dayPosters.map((poster) => (
              // Se usa la etiqueta de imagen normal, no el componente optimizador del framework, y es
              // una decisión, no un descuido. Ese componente sirve para redimensionar imágenes en
              // nuestro propio servidor; estas ya vienen del proveedor en el tamaño exacto que se
              // pinta (ver tmdbImage), así que pasarlas por él añadiría un salto de servidor y un
              // coste de proceso para producir el mismo píxel. Además, la carga diferida —que aquí es
              // imprescindible, porque la línea de tiempo monta cientos de estaciones— la da el
              // atributo estándar sin necesidad de nada más.
              // eslint-disable-next-line @next/next/no-img-element -- imagen ya dimensionada en origen
              <img
                key={poster.id}
                className="tlx-daypeek-img"
                src={poster.url}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            ))}
          </span>
        ) : null}
        {!isEmpty && isExpanded
          ? packagesAbove.map((categoryPackage, branchIndex) => (
              <CategoryStem
                key={categoryPackage.categoryKey}
                side="above"
                branchIndex={branchIndex}
                month={month}
                day={dayGroup.day}
                categoryPackage={categoryPackage}
                onOpenPackage={onOpenPackage}
                upcoming={!isPast}
                isClone={isClone}
                genreSet={genreSet}
                platformSet={platformSet}
              />
            ))
          : null}
      </div>

      {/*
        EJE: la CAJA DE DÍA. Si el día tiene estrenos es un BOTÓN que EXPANDE/COLAPSA (dibuja las ramas);
        si está VACÍO, es una marca no interactiva (solo número + día de semana). El día de HOY se resalta.
      */}
      <div className="tlx-axis">
        {/* Fecha legible: los días CON estrenos llevan el nombre COMPLETO ("VIERNES 11", protagonista);
            los VACÍOS llevan la abreviatura ("VIE 11", marcador compacto) para que la espina respire y
            la jerarquía visual diga de un vistazo dónde hay contenido. */}
        {isEmpty ? (
          // data-weekend marca sábados y domingos para darle RITMO de semana a la línea. Sin esa
          // marca, treinta y un días iguales seguidos son una fila indiferenciada en la que cuesta
          // situarse; con ella el ojo encuentra los bloques de fin de semana, que es como la gente
          // piensa el calendario ("el finde que viene", no "el día 23").
          <span className={dayboxClass} data-weekend={isWeekend ? "true" : undefined}>
            <span className="tlx-daybox-dow font-mono">{dayGroup.weekdayShort.toUpperCase()}</span>
            <span className="tlx-daybox-num font-mono">{dayNumText}</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={handleToggle}
            aria-expanded={isExpanded}
            aria-label={dayboxAria}
            className={dayboxClass}
            tabIndex={isClone ? -1 : 0}
          >
            <span className="tlx-daybox-dow font-mono">
              {(dayGroup.weekdayFull || dayGroup.weekdayShort).toUpperCase()}
            </span>
            <span className="tlx-daybox-num font-mono">{dayNumText}</span>
            {/*
              PIE DE LA CAJA: qué trae este día, de un vistazo y sin abrirlo.

              Antes aquí ponía "+1" en casi todos los días, y ese "1" no era el número de estrenos:
              era el número de CATEGORÍAS. Como la inmensa mayoría de los días traen una sola
              categoría, el indicador decía "+1" una y otra vez a lo largo de toda la línea de tiempo
              — ocupaba sitio, no distinguía un día con un estreno de uno con siete, y no había forma
              de adivinar qué significaba. Ahora hay dos señales, y las dos dicen algo:

                · Los PUNTOS de color: uno por categoría presente, con el color de esa categoría (el
                  mismo de la leyenda de la esquina). Se ve "esto es cine" o "esto es streaming"
                  sin leer nada.
                · El NÚMERO: cuántos estrenos hay ese día, de verdad. Es lo que permite recorrer el
                  mes y ver dónde está lo gordo.
            */}
            <span aria-hidden="true" className="tlx-daybox-foot">
              <span className="tlx-daybox-dots">
                {dayGroup.packages.map((categoryPackage) => (
                  <span
                    key={categoryPackage.categoryKey}
                    className={`tlx-daybox-dot tlx-dot-${categoryPackage.categoryKey}`}
                  />
                ))}
              </span>
              {/*
                EL NÚMERO SE ESCRIBE SIEMPRE, TAMBIÉN CON EL DÍA ABIERTO.

                Antes, al abrir un día, este hueco cambiaba el número por un guion. La intención era
                señalar "púlsame otra vez para cerrar", pero el efecto era otro: la caja abierta
                dejaba de decir cuántos estrenos trae justo cuando la persona está mirándola, y la
                pantalla se contradecía consigo misma — el mismo elemento se anunciaba en voz alta
                como "3 estrenos" mientras en pantalla ponía un guion. Quien ve y quien escucha
                recibían cosas distintas del mismo sitio.

                Que el día está abierto ya se dice de dos formas que no le quitan información a
                nadie: la caja se pinta en oro sólido y el botón declara su estado de expansión
                (aria-expanded), que es lo que un lector de pantalla anuncia.
              */}
              <span className="tlx-daybox-count font-mono">{totalCount}</span>
            </span>
          </button>
        )}
      </div>

      {/*
        Zona ABAJO de la espina: ramas "impares". Igual que arriba, solo cuando la estación está EXPANDIDA.
      */}
      <div className="tlx-arm tlx-arm-below">
        {!isEmpty && isExpanded
          ? packagesBelow.map((categoryPackage, branchIndex) => (
              <CategoryStem
                key={categoryPackage.categoryKey}
                side="below"
                branchIndex={branchIndex}
                month={month}
                day={dayGroup.day}
                categoryPackage={categoryPackage}
                onOpenPackage={onOpenPackage}
                upcoming={!isPast}
                isClone={isClone}
                genreSet={genreSet}
                platformSet={platformSet}
              />
            ))
          : null}
      </div>
    </div>
  );
});

// CategoryStemProps son las props de un paquete colgante con su tallo.
type CategoryStemProps = {
  // side indica de qué lado de la espina cuelga este paquete: "above" (arriba) o "below" (abajo). Cambia
  // el orden visual del tallo y la caja (el tallo siempre toca la espina; la caja queda en el extremo).
  side: "above" | "below";
  // branchIndex es la posición de esta rama DENTRO de su lado (0 = la más cercana a la espina). Sirve
  // para el ESCALONADO ORGÁNICO: ramas más lejanas se desplazan un poco de lado y alargan su tallo, para
  // que cuando un día trae varias categorías no queden en una columna rígida, sino "ramificadas".
  branchIndex: number;
  // month y day ubican el paquete en el tiempo (para el gancho onOpenPackage y la etiqueta a11y).
  month: number;
  day: number;
  // categoryPackage es el paquete ya armado: categoría, estrenos, conteo y mejor calificación.
  categoryPackage: CategoryPackage;
  // onOpenPackage es el gancho del flujo de 3 niveles, opcional.
  onOpenPackage?: (month: number, day: number, categoryKey: CategoryPackage["categoryKey"]) => void;
  // upcoming indica si el día es HOY o FUTURO (aún no estrenado): solo entonces el chip muestra
  // "Próximamente" cuando falta la nota. Para días PASADOS (ya estrenados) nunca decimos "Próximamente".
  upcoming?: boolean;
  // isClone saca el botón del chip del tab-order (copias clon del carrusel infinito).
  isClone?: boolean;
  // genreSet/platformSet son los gustos del usuario precalculados en Timeline (referencias estables).
  genreSet: Set<string>;
  platformSet: Set<string>;
};

// CategoryStem dibuja un TALLO (línea vertical hacia la espina) y, en su extremo, el paquete (CategoryBox).
// En español: el tallo es la "rama" que une el paquete con el nodo de la estación, como en un grafo de
// git. Según el lado, ordenamos tallo y caja para que el tallo SIEMPRE arranque desde la espina: arriba
// el tallo va abajo de la caja (la caja queda más lejos, arriba); abajo el tallo va arriba de la caja.
function CategoryStem({
  side,
  branchIndex,
  month,
  day,
  categoryPackage,
  onOpenPackage,
  upcoming,
  isClone = false,
  genreSet,
  platformSet,
}: CategoryStemProps) {
  // El tallo se pinta con el color de acento de la categoría para reforzar la lectura (Cine oro, etc.).
  const meta = CATEGORY_META[categoryPackage.categoryKey];
  const stem = (
    <span
      aria-hidden="true"
      className="tlx-stem"
      style={{ background: `linear-gradient(${meta.accentVar}, transparent)` }}
    />
  );
  const box = (
    <CategoryBox
      month={month}
      day={day}
      categoryPackage={categoryPackage}
      onOpenPackage={onOpenPackage}
      upcoming={upcoming}
      isClone={isClone}
      genreSet={genreSet}
      platformSet={platformSet}
    />
  );

  // Pasamos branchIndex como variable CSS (--branch-i) para que globals.css aplique el escalonado
  // orgánico (desplazamiento lateral + tallo más largo según qué tan lejos esté la rama de la espina).
  const branchStyle = { "--branch-i": branchIndex } as CSSProperties;

  // Arriba: la caja arriba y el tallo abajo (el tallo toca la espina por debajo de la caja).
  // Abajo: el tallo arriba (toca la espina) y la caja debajo.
  return (
    <div className={`tlx-branch tlx-branch-${side}`} style={branchStyle}>
      {side === "above" ? (
        <>
          {box}
          {stem}
        </>
      ) : (
        <>
          {stem}
          {box}
        </>
      )}
    </div>
  );
}

// CategoryBoxProps son las props de un paquete por categoría.
type CategoryBoxProps = {
  // month y day ubican el paquete en el tiempo (para el gancho onOpenPackage y la etiqueta a11y).
  month: number;
  day: number;
  // categoryPackage es el paquete ya armado: categoría, estrenos, conteo y mejor calificación.
  categoryPackage: CategoryPackage;
  // onOpenPackage es el gancho del flujo de 3 niveles, opcional.
  onOpenPackage?: (month: number, day: number, categoryKey: CategoryPackage["categoryKey"]) => void;
  // upcoming: si el día es HOY o futuro, un paquete sin nota muestra "Próximamente"; si ya pasó, no.
  upcoming?: boolean;
  // isClone saca el botón del chip del tab-order (copias clon del carrusel infinito).
  isClone?: boolean;
  // genreSet/platformSet son los gustos del usuario precalculados en Timeline (referencias estables).
  genreSet: Set<string>;
  platformSet: Set<string>;
};

// CategoryBox dibuja UN nodo de categoría como CHIP/ETIQUETA (rediseño con bocetos).
// En español: en vez de una tarjeta ancha con pila de pósters, ahora es una MARQUILLA/ETIQUETA compacta
// (como pidieron los bocetos): barra de acento de la categoría + nombre + mejor calificación + conteo.
// El BORDE y el resplandor codifican la RAREZA tipo videojuego (legendary/epic/rare/common, derivada de
// la mejor calificación TMDB con deriveRarity); la densidad (cuántos estrenos) añade un pulso por
// data-density. Sigue siendo un <button> real (teclado, foco visible, aria-label). Al pulsarlo dispara
// onOpenPackage (abrir la categoría); si no se pasó, no hace nada (frontera documentada arriba).
// CategoryIcon dibuja el GLIFO geométrico de cada categoría (identidad por tipo). Hereda el color del
// acento de su categoría por CSS (currentColor). Son íconos simples y reconocibles: claqueta (Cine),
// play (Streaming), monitor (Cadenas) y destello (Indie). Decorativos (aria-hidden): el nombre va al lado.
function CategoryIcon({ categoryKey }: { categoryKey: CategoryKey }): JSX.Element {
  if (categoryKey === "streaming") {
    // Play (triángulo de reproducción): el lenguaje universal del streaming.
    return (
      <svg className="tlx-chip-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5.5 3.5l7 4.5-7 4.5z" fill="currentColor" />
      </svg>
    );
  }
  if (categoryKey === "tv") {
    // Monitor con base: una pantalla de cadena/televisión.
    return (
      <svg className="tlx-chip-icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect
          x="2"
          y="3.5"
          width="12"
          height="8"
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path d="M6 13.6h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  if (categoryKey === "indie") {
    // Destello de 4 puntas: lo "artesanal/festival" del cine independiente.
    return (
      <svg className="tlx-chip-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.6l1.8 4.6L14 8l-4.2 1.8L8 14.4 6.2 9.8 2 8l4.2-1.8z" fill="currentColor" />
      </svg>
    );
  }
  // cine (por defecto): claqueta de cine (rectángulo + franja superior con rayas diagonales).
  return (
    <svg className="tlx-chip-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="2"
        y="3.5"
        width="12"
        height="9"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M2 6.4h12" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 3.6L4 6.2M8.5 3.6L7.5 6.2M12 3.6L11 6.2" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CategoryBox({
  month,
  day,
  categoryPackage,
  onOpenPackage,
  upcoming,
  isClone = false,
  genreSet,
  platformSet,
}: CategoryBoxProps) {
  // Metadatos de la categoría (etiqueta es-MX y color de acento) desde la tabla maestra.
  const meta = CATEGORY_META[categoryPackage.categoryKey];

  // GUSTOS del usuario (perfil local): si el usuario eligió géneros y/o plataformas, RESALTAMOS los chips
  // que contengan al menos un estreno que le encaje (borde + resplandor oro + marca ♥). Si no eligió nada,
  // no resaltamos nada (la línea de tiempo se ve igual que antes). Los Sets llegan por props
  // (precalculados una vez en Timeline).
  const matchesTaste =
    (genreSet.size > 0 || platformSet.size > 0) &&
    categoryPackage.items.some((item) => releaseMatchesPrefs(item, genreSet, platformSet));
  // Nivel de efecto según la cantidad de estrenos del paquete (single/few/many). Va tal cual al atributo
  // data-density para que globals.css decida el pulso (más estrenos = nodo más "vivo").
  const level = effectLevel(categoryPackage.count);
  // Rareza tipo videojuego del nodo: la deriva la MEJOR calificación del paquete (umbrales 8.5/7.5/6.5,
  // el mismo espejo del Go). Define el color de borde y el resplandor del chip (legendary/epic/rare/common).
  const tier = deriveRarity(Number.parseFloat(categoryPackage.maxTmdb));

  // Nombre del mes en es-MX (minúsculas) para la etiqueta accesible ("15 de junio").
  // Lo derivamos del nombre en mayúsculas de MONTHS para no depender de otra fuente.
  const monthLabelLower = (MONTHS[month] ?? "").toLowerCase();

  // Etiqueta accesible completa del paquete (categoría, día, conteo, mejor calificación).
  const ariaLabel = buildPackageAriaLabel(
    meta.label,
    day,
    monthLabelLower,
    categoryPackage.count,
    categoryPackage.maxTmdb,
  );

  // handleClick dispara el gancho del flujo si existe; si no, no hace nada.
  const handleClick = useCallback(() => {
    if (onOpenPackage !== undefined) {
      onOpenPackage(month, day, categoryPackage.categoryKey);
    }
  }, [onOpenPackage, month, day, categoryPackage.categoryKey]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      tabIndex={isClone ? -1 : 0}
      // data-density (single/few/many) controla el pulso por cantidad; las clases tlx-chip-<categoría> y
      // tlx-tier-<rareza> ponen el acento de la categoría y el borde/resplandor de rareza (en globals.css).
      data-density={level}
      // data-match marca el chip que encaja con los gustos/plataformas del usuario (resalte oro + ♥).
      data-match={matchesTaste ? "true" : undefined}
      // data-banner indica que el chip lleva mini-banner (el CSS ajusta el texto encima del fondo).
      data-banner={categoryPackage.bannerUrl !== "" ? "true" : undefined}
      className={`tlx-chip tlx-chip-${categoryPackage.categoryKey} tlx-tier-${tier} ${matchesTaste ? "is-match" : ""} font-ui`}
    >
      {/* MINI-BANNER cinematográfico: el backdrop del estreno MÁS IMPORTANTE del paquete (mejor nota
          con imagen real), atenuado y con velo para que la marquilla siga leyendo AA encima. Solo se
          dibuja si hay imagen real (sin imagen, el chip queda sólido como antes). Decorativo. */}
      {categoryPackage.bannerUrl !== "" ? (
        <span
          aria-hidden="true"
          className="tlx-chip-banner"
          style={{
            backgroundImage: cssImageSet(categoryPackage.bannerUrl, COVER_SIZES.chipBanner),
          }}
        />
      ) : null}
      {/* Marca de GUSTO: un corazón oro en la esquina del chip cuando contiene algo que le encaja al
          usuario (su género o su plataforma). Solo aparece si hay coincidencia. Decorativo (aria-hidden). */}
      {matchesTaste ? (
        <span aria-hidden="true" className="tlx-chip-match">
          ♥
        </span>
      ) : null}
      {/* ÍCONO de la categoría (identidad por tipo): claqueta Cine, play Streaming, monitor Cadenas,
          destello Indie. Hereda el color del acento de su categoría (CSS). Decorativo. */}
      <CategoryIcon categoryKey={categoryPackage.categoryKey} />
      {/* Nombre de la categoría: la "marquilla" en sí (mayúsculas, mono, como etiqueta). */}
      <span className="tlx-chip-label font-mono">{meta.label}</span>
      {/* Mejor calificación del paquete. Si tiene nota, "★ X.X". Si no: "Próx." SOLO para días por venir
          (upcoming); para días YA PASADOS (sin nota) mostramos un guion neutro, nunca "Próximamente". */}
      <span className="tlx-chip-rating font-mono">
        {Number.parseFloat(categoryPackage.maxTmdb) > 0 ? (
          <>
            <span aria-hidden="true">★</span>
            {categoryPackage.maxTmdb}
          </>
        ) : upcoming ? (
          ui.status.upcomingShort
        ) : (
          ui.status.dash
        )}
      </span>
      {/* Conteo de estrenos del paquete (cuántos hay ese día en esta categoría). */}
      <span className="tlx-chip-count font-mono">{categoryPackage.count}</span>
      {/* Flecha de "abrible": se desplaza al pasar el cursor. Decorativa (la acción va en el aria-label). */}
      <span aria-hidden="true" className="tlx-chip-arrow">
        ›
      </span>
    </button>
  );
}

// LegendItemProps son las props de un elemento de la leyenda de categorías.
type LegendItemProps = {
  // colorVar es la variable CSS del color del cuadrito (oro/teal/violeta).
  colorVar: string;
  // label es el texto de la categoría (Cine/Streaming/Cadenas).
  label: string;
};

// LegendItem dibuja un par "cuadrito de color + etiqueta" de la leyenda.
// En español: el cuadrito es decorativo (aria-hidden); el texto comunica la categoría.
function LegendItem({ colorVar, label }: LegendItemProps) {
  return (
    <li className="flex items-center gap-[7px]">
      <span
        aria-hidden="true"
        className="h-[9px] w-[9px] rounded-[3px]"
        style={{ background: colorVar }}
      />
      {label}
    </li>
  );
}

// EmptyState dibuja el estado "sin estrenos en ningún mes" de UN carril de la línea de tiempo.
// En español: cuando la lista del carril llega vacía, mostramos un mensaje claro en es-MX en una
// tarjeta de cristal, centrada sobre la zona de la espina, sin intentar pintar estaciones. El estado de
// ERROR de red lo maneja la página (no este componente), por eso aquí solo cubrimos el vacío.
function EmptyState({ lane }: { lane: TimelineLane }) {
  const laneMeta = LANE_META[lane];
  return (
    <section
      className="tlx-stage flex items-center justify-center"
      data-lane={lane}
      aria-label={laneMeta.label}
    >
      <div
        className="mx-4 max-w-[520px] rounded-base border p-6 text-center"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <p className="font-display text-lg text-text">
          {ui.timeline.laneEmptyTitle(laneMeta.label)}
        </p>
        <p className="mt-2 text-sm text-text-muted">{ui.timeline.emptyHint}</p>
      </div>
    </section>
  );
}
