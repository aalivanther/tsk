"use client";

// Archivo: timeline-context.tsx — Estado COMPARTIDO de la línea de tiempo (filtro + "Ir a hoy").
//
// En español: la barra superior (Topbar) y la línea de tiempo (Timeline) son dos componentes
// distintos, pero necesitan COORDINARSE: cuando el usuario pulsa "Películas" en el Topbar, la
// Timeline debe filtrar; cuando pulsa "Ir a hoy" en el Topbar, la Timeline debe desplazarse hasta
// el marcador HOY. Para que dos componentes separados compartan ese estado sin "pasarse props" por
// media app, usamos un Contexto de React: un "tablón de anuncios" común que ambos leen y escriben.
//
// Este archivo expone:
//   - FilterProvider: el envoltorio que crea y guarda el estado compartido (se coloca una vez,
//     alto en el árbol, rodeando tanto al Topbar como a la Timeline).
//   - useFilter(): el hook con el que cualquier componente cliente lee el filtro actual, lo cambia,
//     dispara "Ir a hoy" o registra CÓMO se hace ese "Ir a hoy".
//
// Por qué "registerGoToToday": el Provider no sabe desplazar la pantalla (no conoce el nodo del
// marcador HOY, que vive dentro de la Timeline). Así que la Timeline le ENTREGA al contexto una
// función ("haz scroll a HOY") y el Topbar solo dispara goToToday(), que llama a la función que la
// Timeline registró. Es la forma idiomática de invertir el control sin acoplar los componentes.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_FILTER,
  type DateAnchor,
  type DateRange,
  type TimelineFilter,
} from "@/lib/timeline";

// GoToTodayHandler es el tipo de la función que sabe llevar la vista al marcador HOY.
// En español: no recibe nada ni devuelve nada; su único trabajo es "desplázate hasta HOY". La
// Timeline la implementa (haciendo scrollIntoView a su marcador) y la registra en el contexto.
type GoToTodayHandler = () => void;

// ScrollToDateHandler lleva la vista a la ESTACIÓN de una fecha (mes/día). Cada línea la implementa
// (scrollIntoView a la estación de ese día, o la más cercana de ese mes) y la registra; la usan tanto
// los chips "Esta semana"/"Este mes" (centran su foco al activarse) como sus flechas de navegación.
type ScrollToDateHandler = (month: number, day: number) => void;

// ActiveBackdrop describe el FONDO GLOBAL que está pintado AHORA por una selección (categoría/título).
// En español: cuando el usuario abre una categoría o un título, el fondo de toda la página "muta" al
// backdrop de ese estreno. Guardamos su url (la imagen) y su seed (el degradado de respaldo en Fase 0 si
// la url viene vacía). Si vale null, no hay selección y el fondo vuelve a su rotación de los mejores.
export type ActiveBackdrop = {
  // url es la imagen de fondo (backdrop) del estreno elegido; puede venir vacía (entonces manda el seed).
  url: string;
  // seed es la semilla del degradado de respaldo (placeholder de Fase 0), estable por estreno.
  seed: number;
};

// FilterContextValue es la "forma" del tablón compartido: qué datos y funciones ofrece el contexto.
// En español: enumera todo lo que un componente puede leer/usar a través de useFilter().
type FilterContextValue = {
  // filter es el estado COMPLETO de filtros activo ahora mismo (categoría + género).
  filter: TimelineFilter;
  // setFilter ACTUALIZA una o varias dimensiones del filtro (los selects del Topbar pasan solo la
  // dimensión que cambió, ej. { category: "movie" } o { genre: "Drama" }); las demás se conservan.
  setFilter: (patch: Partial<TimelineFilter>) => void;
  // goToToday dispara el desplazamiento al marcador HOY (lo usa el botón "Ir a hoy" del Topbar).
  goToToday: () => void;
  // registerGoToToday deja que la Timeline ENTREGUE su forma concreta de ir a HOY. Devuelve una
  // función de "limpieza" para des-registrarla cuando la Timeline se desmonte (buena higiene).
  registerGoToToday: (handler: GoToTodayHandler) => () => void;
  // activeBackdrop es el fondo que pinta la SELECCIÓN actual (o null si no hay nada abierto). Lo LEE el
  // GlobalBackground para "mutar" el fondo de toda la página; lo ESCRIBE el flujo (TimelineStage).
  activeBackdrop: ActiveBackdrop | null;
  // setActiveBackdrop fija (o limpia con null) el fondo de la selección. Al abrir una categoría/título se
  // pone su backdrop; al cerrar el overlay se pone null y el fondo vuelve a la rotación de los mejores.
  setActiveBackdrop: (next: ActiveBackdrop | null) => void;
  // dateRange es el FILTRO POR FECHA activo (chips de rango de la espina). Lo comparten los dos carriles.
  dateRange: DateRange;
  // setDateRange cambia el rango de fecha activo (el control de rango lo dispara).
  setDateRange: (range: DateRange) => void;
  // dateAnchor es la fecha de referencia navegable para "week"/"month" (las flechas la mueven). Compartida.
  dateAnchor: DateAnchor;
  // setDateAnchor fija el ancla (al activar un chip o al pulsar una flecha).
  setDateAnchor: (anchor: DateAnchor) => void;
  // scrollToDate lleva AMBAS líneas a la estación de esa fecha (centra el foco de semana/mes).
  scrollToDate: (month: number, day: number) => void;
  // registerScrollToDate deja que cada línea APORTE su forma de hacer scroll a una fecha (devuelve la
  // función de limpieza para des-registrarla al desmontar). Igual idea que registerGoToToday.
  registerScrollToDate: (handler: ScrollToDateHandler) => () => void;
};

// FilterContext es el canal de React por el que viaja el valor compartido.
// En español: arranca en "null" para poder DETECTAR si alguien usa useFilter() fuera del Provider
// (un error de programación que conviene gritar pronto, en vez de fallar de forma silenciosa).
const FilterContext = createContext<FilterContextValue | null>(null);

// FilterProviderProps son las props del Provider: los hijos y el ancla de fecha inicial.
type FilterProviderProps = {
  // children es todo el contenido (Topbar + Timeline) que vivirá dentro del estado compartido.
  children: ReactNode;
  // initialAnchor fija el periodo enfocado al cargar (normalmente HOY, calculado en el servidor). Así la
  // espina abre ya enfocada en el mes actual SIN parpadeo. Si no llega, cae a un valor neutro.
  initialAnchor?: DateAnchor;
};

// FilterProvider crea y comparte el estado de filtro y la coordinación de "Ir a hoy".
// En español: se coloca UNA vez, rodeando al Topbar y a la Timeline. Guarda el filtro activo y la
// función de "ir a HOY" que la Timeline registre, y los ofrece a todos sus hijos vía useFilter().
export function FilterProvider({ children, initialAnchor }: FilterProviderProps) {
  // Estado del filtro activo. Arranca en DEFAULT_FILTER (todas las categorías, todos los géneros).
  const [filter, setFilterState] = useState<TimelineFilter>(DEFAULT_FILTER);

  // Estado del fondo de la SELECCIÓN. Arranca en null (sin selección): el fondo rota los mejores. Al
  // abrir una categoría/título, el flujo (TimelineStage) pone aquí su backdrop y el fondo global "muta".
  const [activeBackdrop, setActiveBackdropState] = useState<ActiveBackdrop | null>(null);

  // Granularidad del navegador de fecha. Arranca en "month": la espina abre enfocada en el mes actual.
  const [dateRange, setDateRangeState] = useState<DateRange>("month");
  // Ancla de fecha (periodo enfocado). Arranca en initialAnchor (HOY, del servidor) para enfocar el mes
  // actual sin parpadeo; si no llega, un valor neutro. Las flechas y "Hoy" lo mueven después.
  const [dateAnchor, setDateAnchorState] = useState<DateAnchor>(
    initialAnchor ?? { month: 1, day: 1 },
  );

  // Guardamos las funciones "ir a HOY" en un ref (no en estado) porque NO afectan a lo que se dibuja:
  // cambiarlas no debe provocar re-render. Es un CONJUNTO (no una sola) porque desde el sprint de cierre
  // hay DOS líneas de tiempo (cine / no-cine) y el botón "Ir a hoy" debe centrar AMBAS a la vez.
  const goToTodayHandlersRef = useRef<Set<GoToTodayHandler>>(new Set());
  // Conjunto de funciones "scroll a una fecha" (una por línea de tiempo montada), por el mismo motivo.
  const scrollToDateHandlersRef = useRef<Set<ScrollToDateHandler>>(new Set());

  // setFilter es una versión estable (memoizada) que ACTUALIZA solo las dimensiones recibidas.
  // En español: useCallback evita crear una función nueva en cada render. Recibe un "parche" parcial
  // (ej. { category: "movie" }) y lo fusiona sobre el filtro previo, conservando las demás dimensiones.
  const setFilter = useCallback((patch: Partial<TimelineFilter>) => {
    setFilterState((previous) => ({ ...previous, ...patch }));
  }, []);

  // registerGoToToday AÑADE la función que cada Timeline aporta y devuelve cómo des-registrarla.
  // En español: cada línea de tiempo (cine / no-cine) llama a esto en un efecto al montarse, pasando su
  // "scroll a HOY". Le devolvemos una función de limpieza que, al ejecutarse (cuando esa línea se
  // desmonte), quita SOLO su registro del conjunto, sin tocar el de la otra línea.
  const registerGoToToday = useCallback((handler: GoToTodayHandler) => {
    goToTodayHandlersRef.current.add(handler);
    return () => {
      goToTodayHandlersRef.current.delete(handler);
    };
  }, []);

  // goToToday dispara TODAS las acciones registradas (ambas líneas de tiempo se centran en HOY).
  // En español: el Topbar llama a esto. Si ninguna línea registró su scroll todavía (o no están en
  // pantalla), simplemente no hace nada, sin lanzar errores: el botón nunca "se rompe".
  const goToToday = useCallback(() => {
    for (const handler of goToTodayHandlersRef.current) {
      handler();
    }
  }, []);

  // setActiveBackdrop es la versión estable de fijar/limpiar el fondo de la selección. Es un setter
  // directo (no fusiona): se pasa el backdrop completo, o null para volver a la rotación de los mejores.
  const setActiveBackdrop = useCallback((next: ActiveBackdrop | null) => {
    setActiveBackdropState(next);
  }, []);

  // setDateRange es la versión estable de cambiar el rango de fecha (setter directo).
  const setDateRange = useCallback((range: DateRange) => {
    setDateRangeState(range);
  }, []);

  // setDateAnchor es la versión estable de fijar el ancla de fecha (setter directo).
  const setDateAnchor = useCallback((anchor: DateAnchor) => {
    setDateAnchorState(anchor);
  }, []);

  // registerScrollToDate AÑADE la función de una línea y devuelve cómo quitarla (misma higiene que
  // registerGoToToday). Cada carril aporta la suya al montar; al desmontar se quita solo la suya.
  const registerScrollToDate = useCallback((handler: ScrollToDateHandler) => {
    scrollToDateHandlersRef.current.add(handler);
    return () => {
      scrollToDateHandlersRef.current.delete(handler);
    };
  }, []);

  // scrollToDate dispara el scroll a esa fecha en TODAS las líneas registradas (ambos carriles a la vez).
  const scrollToDate = useCallback((month: number, day: number) => {
    for (const handler of scrollToDateHandlersRef.current) {
      handler(month, day);
    }
  }, []);

  // Memoizamos el objeto de valor para no entregar una referencia nueva en cada render (lo que
  // forzaría a re-renderizar a todos los consumidores). Solo cambia cuando cambia el filtro, el fondo
  // de selección o alguna de las funciones estables (que, por useCallback, no cambian tras el 1er render).
  const value = useMemo<FilterContextValue>(
    () => ({
      filter,
      setFilter,
      goToToday,
      registerGoToToday,
      activeBackdrop,
      setActiveBackdrop,
      dateRange,
      setDateRange,
      dateAnchor,
      setDateAnchor,
      scrollToDate,
      registerScrollToDate,
    }),
    [
      filter,
      setFilter,
      goToToday,
      registerGoToToday,
      activeBackdrop,
      setActiveBackdrop,
      dateRange,
      setDateRange,
      dateAnchor,
      setDateAnchor,
      scrollToDate,
      registerScrollToDate,
    ],
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

// useFilter es el hook con el que cualquier componente cliente accede al estado compartido.
// En español: devuelve el filtro actual y las funciones para cambiarlo o coordinar "Ir a hoy". Si
// se usa por error FUERA de un FilterProvider, lanza un error claro en inglés (mensaje técnico para
// el desarrollador), en vez de devolver datos vacíos que harían fallar la app de forma confusa.
export function useFilter(): FilterContextValue {
  const value = useContext(FilterContext);
  if (value === null) {
    throw new Error("useFilter must be used inside a FilterProvider.");
  }
  return value;
}
