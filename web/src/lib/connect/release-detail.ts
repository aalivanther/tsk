"use client";

// Archivo: release-detail.ts — La ficha COMPLETA de un título, pedida desde el navegador al abrirla.
//
// POR QUÉ EXISTE ESTE ARCHIVO, en español:
//
// Antes, la página de inicio traía las fichas completas de los trescientos y pico estrenos de la
// ventana del catálogo: el reparto entero, la galería, el calendario de episodios, la saga y la
// lista de videos de cada uno. Todo eso viajaba para dibujar unas cajitas con el día y el título, y
// se quedaba en la memoria del navegador por si acaso alguien abría una ficha. Medido: 3,6 MB de
// datos dentro de una página de 4,3 MB.
//
// Ahora la lista trae solo lo que la lista dibuja, y la ficha completa se pide en el momento de
// abrirla. Ese cambio introduce algo que antes no existía —una espera— y este archivo es el
// encargado de que esa espera no se note:
//
//   1. RECUERDA lo que ya trajo. Volver a abrir el mismo título no vuelve a preguntar: es inmediato.
//   2. NO PREGUNTA DOS VECES LO MISMO A LA VEZ. Si dos partes de la pantalla piden la misma ficha en
//      el mismo instante (pasa: el panel de la previa y el detalle), comparten una única llamada.
//   3. SE ADELANTA. Cuando el puntero pasa por encima de una tarjeta, la ficha ya se va pidiendo, de
//      modo que al pulsar suele estar lista.
//
// Y sobre todo: quien lo usa recibe SIEMPRE los tres estados —cargando, listo y error con reintento—
// para que ninguna pantalla se quede en blanco ni enseñe un dato equivocado mientras espera.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";

import { createBrowserTransport } from "@/lib/connect/browser-transport";
import { CatalogService, type Release } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// DETAIL_ERROR_MESSAGE es lo que lee la persona cuando la ficha no se pudo traer.
const DETAIL_ERROR_MESSAGE = "No pudimos cargar la ficha. Intenta de nuevo.";

// DETAIL_NOT_FOUND_MESSAGE es lo que lee cuando el título ya no está en el catálogo.
// En español: se distingue del error de red a propósito. "No se pudo" invita a reintentar; "ya no
// está" explica que reintentar no va a servir de nada, que es la verdad en ese caso.
const DETAIL_NOT_FOUND_MESSAGE = "Este título ya no está en el catálogo.";

// resolvedDetails guarda las fichas ya traídas, por id, mientras la pestaña siga abierta.
//
// En español: vive a nivel de módulo (fuera de cualquier componente) a propósito, para que cerrar y
// volver a abrir una ficha no cueste otra llamada. No caduca: el catálogo cambia como mucho una vez
// al día y una visita dura minutos, así que un dato viejo aquí no existe en la práctica.
const resolvedDetails = new Map<string, Release>();

// pendingRequests guarda las llamadas EN CURSO por id, para no repetir la misma pregunta.
const pendingRequests = new Map<string, Promise<Release>>();

// getCatalogBrowserClient devuelve el cliente del catálogo para el navegador, creándolo una sola vez.
// En español: el cliente no guarda estado propio, así que rehacerlo en cada llamada sería trabajo
// tirado. Se crea la primera vez que hace falta (nunca durante el dibujado en el servidor).
let cachedClient: ReturnType<typeof createClient<typeof CatalogService>> | null = null;
function getCatalogBrowserClient() {
  if (cachedClient === null) {
    cachedClient = createClient(CatalogService, createBrowserTransport());
  }
  return cachedClient;
}

// loadReleaseDetail trae la ficha completa de un título, reutilizando lo que ya se sepa de él.
//
// En español: si ya la tenemos, la devuelve al instante. Si hay una llamada en marcha por ese mismo
// id, se cuelga de ella. Si no, la pide. Lanza si falla, porque quien la use tiene que poder
// distinguir el fallo del éxito; los componentes lo traducen a su estado de error.
async function loadReleaseDetail(id: string): Promise<Release> {
  const alreadyResolved = resolvedDetails.get(id);
  if (alreadyResolved !== undefined) {
    return alreadyResolved;
  }

  const alreadyPending = pendingRequests.get(id);
  if (alreadyPending !== undefined) {
    return alreadyPending;
  }

  const request = (async (): Promise<Release> => {
    const response = await getCatalogBrowserClient().getRelease({ id });
    const release = response.release;
    if (release === undefined) {
      // El backend contestó bien pero sin ficha: para quien llama es lo mismo que "no existe".
      throw new ConnectError(`release ${id} came back empty`, Code.NotFound);
    }
    resolvedDetails.set(id, release);
    return release;
  })();

  pendingRequests.set(id, request);
  try {
    return await request;
  } finally {
    // Se olvida la llamada en curso pase lo que pase: si falló, el siguiente intento debe preguntar
    // de nuevo en vez de recibir para siempre el mismo error ya caducado.
    pendingRequests.delete(id);
  }
}

// prefetchReleaseDetail va pidiendo una ficha SIN que nadie esté esperándola todavía.
//
// En español: se llama al pasar el puntero o el foco por encima de una tarjeta. Si el título acaba
// abriéndose, la ficha ya está; si no, lo único que se perdió es una petición pequeña. Los fallos se
// tragan a propósito y en silencio: nadie está mirando este resultado, y avisar de un error de algo
// que la persona ni siquiera pidió sería ruido. Cuando de verdad lo abra, se reintenta y entonces sí
// se le enseña el problema.
export function prefetchReleaseDetail(id: string): void {
  if (id === "" || resolvedDetails.has(id) || pendingRequests.has(id)) {
    return;
  }
  void loadReleaseDetail(id).catch(() => {
    /* adelantarse es opcional: si no sale, se pedirá otra vez al abrir de verdad */
  });
}

// ReleaseDetailState es lo que devuelve el hook: la ficha, si está cargando, el error y el reintento.
export type ReleaseDetailState = {
  // release es la ficha completa cuando ya llegó; null mientras no esté.
  release: Release | null;
  // loading indica que hay una llamada en marcha ahora mismo.
  loading: boolean;
  // error es el texto en es-MX de lo que salió mal, o null si no ha salido nada mal.
  error: string | null;
  // retry vuelve a intentarlo. Existe siempre para que el estado de error nunca sea un callejón sin salida.
  retry: () => void;
};

// DetailAttempt es el estado interno del hook: para QUÉ título es, y en qué punto va.
//
// En español: los tres datos van juntos en un solo objeto a propósito. Si vivieran en tres variables
// separadas habría instantes —entre una y otra— en los que el hook diría a la vez "ya tengo la ficha
// de A" y "estoy cargando B", y la pantalla dibujaría una mezcla imposible. Guardándolos juntos, cada
// dibujado ve un estado coherente: la ficha que hay es siempre la del título que dice el "key".
type DetailAttempt = {
  // key identifica el intento: el id del título más el número de reintento.
  key: string;
  // release es la ficha si ya se conocía sin pedir nada, o null si hay que traerla o falló.
  release: Release | null;
  // loading indica que hay una llamada en marcha para este intento.
  loading: boolean;
  // error es el aviso en es-MX si este intento falló, o null.
  error: string | null;
};

// attemptKey compone el identificador de un intento a partir del título y el número de reintento.
// En español: cambiar de título O pulsar "reintentar" produce una llave distinta, y eso es lo que le
// dice al hook que tiene que empezar de nuevo.
function attemptKey(id: string | null, attempt: number): string {
  return `${id ?? ""}#${attempt}`;
}

// startingAttempt arma el punto de partida de un intento: si la ficha ya se conocía, ya está listo.
function startingAttempt(id: string | null, attempt: number): DetailAttempt {
  const key = attemptKey(id, attempt);
  if (id === null) {
    return { key, release: null, loading: false, error: null };
  }
  const known = resolvedDetails.get(id);
  if (known !== undefined) {
    return { key, release: known, loading: false, error: null };
  }
  return { key, release: null, loading: true, error: null };
}

// useReleaseDetail entrega la ficha completa de un título con sus tres estados.
//
// En español: se le pasa el id del título que hay que traer (o null cuando no hay ninguno abierto) y
// devuelve la ficha, si está cargando, el posible error y una función para reintentar. Al cambiar de
// título, si el nuevo YA se conoce, la ficha aparece de inmediato y sin pasar por "cargando": eso es
// lo que evita el parpadeo al moverse por el carrusel de un paquete.
//
// SOBRE CÓMO SE REINICIA AL CAMBIAR DE TÍTULO, que es la parte delicada: el reinicio se hace DURANTE
// el dibujado (comparando el intento actual con el guardado), no dentro de un efecto posterior. Es el
// patrón que la propia documentación de React recomienda para el estado que depende de una entrada, y
// la razón es visible: hacerlo en un efecto significaría dibujar primero un fotograma con la ficha del
// título ANTERIOR y corregirlo justo después. Eso es exactamente el parpadeo que hay que evitar.
export function useReleaseDetail(id: string | null): ReleaseDetailState {
  // attempt sube en cada reintento: es lo que hace que se vuelva a empezar sin cambiar de título.
  const [attempt, setAttempt] = useState(0);
  const [current, setCurrent] = useState<DetailAttempt>(() => startingAttempt(id, 0));

  // Si el título (o el número de intento) cambió, se reinicia aquí mismo, antes de pintar nada.
  const wantedKey = attemptKey(id, attempt);
  if (current.key !== wantedKey) {
    setCurrent(startingAttempt(id, attempt));
  }

  useEffect(() => {
    // Sin título abierto, o con la ficha ya conocida, no hay nada que pedir: el estado de arriba ya
    // dejó puesto lo que corresponde.
    if (id === null || resolvedDetails.has(id)) {
      return;
    }

    const key = attemptKey(id, attempt);

    // "cancelled" descarta las respuestas que llegan TARDE.
    //
    // En español: pasa de verdad. Alguien abre el título A, la petición sale, y antes de que vuelva ya
    // se movió al título B. Cuando la respuesta de A llegue, lo que se está mirando es B, y escribirla
    // pondría la ficha de A bajo el nombre de B. React ejecuta esta limpieza justo al cambiar de
    // título (o al cerrar la pantalla), así que basta con mirar esta bandera antes de escribir nada.
    let cancelled = false;

    loadReleaseDetail(id)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setCurrent({ key, release: loaded, loading: false, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }
        // Se distingue "ya no está en el catálogo" de "no se pudo traer": la primera no se arregla
        // reintentando y la segunda sí, y decirlo mal haría que la persona insistiera para nada.
        const isMissing = cause instanceof ConnectError && cause.code === Code.NotFound;
        if (!isMissing) {
          // El detalle técnico va al registro en inglés (para quien opera); la persona lee el aviso.
          console.error(
            `useReleaseDetail failed for id="${id}": ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
        setCurrent({
          key,
          release: null,
          loading: false,
          error: isMissing ? DETAIL_NOT_FOUND_MESSAGE : DETAIL_ERROR_MESSAGE,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const retry = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  // Mientras el reinicio de arriba no se haya aplicado (React vuelve a dibujar de inmediato), se
  // entrega el punto de partida del intento pedido y no el del anterior: así ningún dibujado enseña
  // la ficha de un título distinto del que se está mirando.
  const shown = current.key === wantedKey ? current : startingAttempt(id, attempt);

  return { release: shown.release, loading: shown.loading, error: shown.error, retry };
}

// clearReleaseDetailCache olvida todo lo recordado. Existe para las pruebas, que necesitan partir de
// cero en cada caso sin que una prueba anterior les deje datos servidos.
export function clearReleaseDetailCache(): void {
  resolvedDetails.clear();
  pendingRequests.clear();
  cachedClient = null;
}
