// Archivo: catalog.ts — Cliente del catálogo para el lado SERVIDOR, con degradado elegante.
// En español: aquí construimos el "cliente" que el servidor usa para preguntarle al backend de Go
// por los estrenos (listar los de un mes, traer el detalle de uno). Además envolvemos esas llamadas
// en helpers "Safe" (seguros) que NUNCA lanzan un error: si el backend no responde —por ejemplo,
// durante `next build`, que se ejecuta sin el backend levantado— devuelven datos vacíos más un texto
// de error, en vez de romper la página. Gracias a esto la web compila y se renderiza siempre, y en
// ejecución real (con el backend arriba) simplemente muestra los datos verdaderos.
//
// LAS TRES FORMAS DE PEDIR EL CATÁLOGO, que es lo que hay que tener claro antes de usar este archivo:
//
//   - listReleasesSafe devuelve RESÚMENES (ReleaseSummary): lo que se dibuja en una lista. Es lo que
//     usan la portada, la agenda del teléfono, el buscador y los avisos. Pesa una fracción de lo
//     otro y es lo que debe pedirse por defecto.
//   - listReleaseDetailsSafe devuelve FICHAS COMPLETAS (Release) de un mes entero. Solo tiene
//     sentido para las pantallas que RECORREN el catálogo mirando DENTRO de cada ficha (la
//     constelación personal, la página de una persona, la de una saga y la tabla de administración).
//     Es cara a propósito y se llama así, con todas las letras, para que se note al leerla.
//   - getReleaseSafe devuelve UNA ficha completa (más su resumen), que es como se abre un título.

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { cacheSuccessfulResult } from "@/lib/connect/catalog-cache";
import { createServerTransport } from "@/lib/connect/transport";
import { catalogWindow, resolveDemoToday, type CatalogMonth } from "@/lib/timeline";
import {
  CatalogService,
  type Release,
  type ReleaseSummary,
} from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// Re-exportamos los tipos del catálogo más usados por la interfaz, para que otros archivos los
// importen desde aquí ("@/lib/connect/catalog") sin tener que conocer la ruta del código generado.
// En español: es un atajo de comodidad; el contrato real sigue viviendo en catalog_pb.ts.
export type { Release, ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";
export { TitleType, Category } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// CatalogClient es el tipo del cliente ya tipado contra el servicio de catálogo.
// En español: le pone nombre al objeto que sabe llamar a las operaciones del backend
// (listReleases, getRelease, getServiceInfo), con autocompletado y verificación de tipos.
type CatalogClient = Client<typeof CatalogService>;

// getCatalogClient crea un cliente del catálogo listo para usar desde el servidor.
// En español: une el "contrato" del servicio (CatalogService) con el "cable" server-side
// (createServerTransport) y devuelve un objeto con un método por cada operación del backend. Es de
// uso server-side: vive donde vive el transport del servidor.
export function getCatalogClient(): CatalogClient {
  return createClient(CatalogService, createServerTransport());
}

// ListReleasesResult es lo que devuelve listReleasesSafe: los RESÚMENES de los estrenos y, si algo
// falló, un texto de error legible (o null si todo salió bien).
// En español: empaquetamos juntos "los datos" y "el posible error" para que quien llame decida qué
// mostrar (la lista, el estado vacío o el estado de error) sin tener que usar try/catch él mismo.
export type ListReleasesResult = {
  // summaries son los estrenos hallados, en su forma ligera; arreglo vacío si no hubo o si hubo error.
  summaries: ReleaseSummary[];
  // error es null cuando la llamada fue bien; si falló, trae un texto explicativo (en es-MX).
  error: string | null;
};

// ListReleaseDetailsResult es lo que devuelve listReleaseDetailsSafe: las fichas COMPLETAS del mes.
export type ListReleaseDetailsResult = {
  // releases son las fichas completas; arreglo vacío si no hubo o si hubo error.
  releases: Release[];
  // error es null cuando la llamada fue bien; si falló, trae un texto explicativo (en es-MX).
  error: string | null;
};

// GetReleaseResult es lo que devuelve getReleaseSafe: un estreno (o null si no se encontró/falló),
// su resumen y el posible error.
// En español: igual que arriba, pero para el detalle de UN estreno por su id. El resumen viaja al
// lado porque lleva los datos deducidos (nombre de la saga, dirección y reparto principal) con los
// que se calculan las "Conexiones"; sin él habría que volver a deducirlos aquí, duplicando la regla.
export type GetReleaseResult = {
  // release es el estreno pedido, o null si no existe o si la llamada falló.
  release: Release | null;
  // summary es ese mismo estreno en su forma ligera, o null en los mismos casos.
  summary: ReleaseSummary | null;
  // error es null cuando la llamada fue bien; si falló, trae un texto explicativo (en es-MX).
  error: string | null;
};

// LIST_ERROR_MESSAGE es el aviso en es-MX cuando no se pudo traer la lista de estrenos.
const LIST_ERROR_MESSAGE = "No pudimos cargar los estrenos. Intenta de nuevo en un momento.";

// DETAIL_ERROR_MESSAGE es el aviso en es-MX cuando no se pudo traer la ficha de un título.
const DETAIL_ERROR_MESSAGE = "No pudimos cargar este título. Intenta de nuevo en un momento.";

// describeError convierte cualquier error capturado en un texto técnico corto y seguro para log.
// En español: los bloques catch reciben un valor de tipo desconocido (puede ser un Error, un string,
// lo que sea). Esta función lo normaliza a un mensaje legible para registrar en el servidor sin
// arriesgarnos a que el propio manejo de error lance otro error.
function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

// listReleasesSafe pide los RESÚMENES de los estrenos de un mes/año y NUNCA lanza: degrada elegante.
// En español: intenta preguntarle al backend "dame los estrenos de tal año y mes". Si el backend
// responde, devuelve la lista y error null. Si el backend no está (típico en `next build`) o falla
// la red, atrapa el problema, lo registra en el log del servidor (para diagnóstico técnico) y
// devuelve una lista vacía con un mensaje de error en es-MX para que la página muestre su estado de
// error en lugar de romperse.
export async function listReleasesSafe(year: number, month: number): Promise<ListReleasesResult> {
  // La respuesta se reutiliza unos minutos si el backend ya la dio, pero SOLO cuando fue correcta:
  // guardar un fallo haría que la pantalla de error sobreviviera a la recuperación del servicio.
  // Ver el archivo catalog-cache.ts, donde está explicado el caso real que motivó esta decisión.
  //
  // La llave dice "summaries" para no chocar con la del volcado de fichas completas del MISMO mes:
  // son dos respuestas distintas del mismo periodo, y compartir llave devolvería una por la otra.
  return cacheSuccessfulResult(
    `summaries:${year}-${month}`,
    (result) => result.error === null,
    () => fetchReleaseSummaries(year, month),
  );
}

// fetchReleaseSummaries hace la consulta de verdad al backend. NUNCA lanza: traduce cualquier fallo
// a un resultado vacío con su mensaje en es-MX.
async function fetchReleaseSummaries(year: number, month: number): Promise<ListReleasesResult> {
  try {
    // Creamos el cliente y hacemos la llamada real al backend.
    // En español: "listReleases" es la consulta principal de la línea de tiempo; le pasamos el año y
    // el mes. Los filtros por tipo/categoría se dejan vacíos a propósito (vacío = todos).
    const client = getCatalogClient();
    const response = await client.listReleases({ year, month });

    // Éxito: devolvemos los resúmenes tal cual y sin error.
    return {
      summaries: response.summaries,
      error: null,
    };
  } catch (cause) {
    // Fallo controlado: registramos el detalle técnico (inglés, para devs/operación) y devolvemos un
    // resultado vacío con un mensaje en es-MX. No re-lanzamos: ese es justo el punto de "Safe".
    console.error(`listReleasesSafe failed for ${year}-${month}: ${describeError(cause)}`);
    return {
      summaries: [],
      error: LIST_ERROR_MESSAGE,
    };
  }
}

// listReleaseDetailsSafe pide las FICHAS COMPLETAS de un mes/año y NUNCA lanza.
//
// CUÁNDO USAR ESTO Y CUÁNDO NO, en español: solo cuando la pantalla necesite mirar DENTRO de cada
// ficha del catálogo entero —quién actúa, quién dirige, a qué saga pertenece—, que es el caso de la
// constelación personal, la página de una persona, la de una saga y la tabla de administración.
// Para dibujar una lista de estrenos NO se usa esto: se usa listReleasesSafe, que pesa un sexto.
export async function listReleaseDetailsSafe(
  year: number,
  month: number,
): Promise<ListReleaseDetailsResult> {
  return cacheSuccessfulResult(
    `details:${year}-${month}`,
    (result) => result.error === null,
    () => fetchReleaseDetails(year, month),
  );
}

// fetchReleaseDetails hace la consulta de verdad al backend. NUNCA lanza.
async function fetchReleaseDetails(year: number, month: number): Promise<ListReleaseDetailsResult> {
  try {
    const client = getCatalogClient();
    const response = await client.listReleaseDetails({ year, month });

    return {
      releases: response.releases,
      error: null,
    };
  } catch (cause) {
    console.error(`listReleaseDetailsSafe failed for ${year}-${month}: ${describeError(cause)}`);
    return {
      releases: [],
      error: LIST_ERROR_MESSAGE,
    };
  }
}

// getReleaseSafe pide el detalle de un estreno por su id y NUNCA lanza.
// En español: intenta traer la ficha completa de un estreno. Si existe, la devuelve con error null.
// Si el backend no responde, atrapa el fallo, lo registra y devuelve release null con un mensaje de
// error en es-MX. Importante: aquí "no encontrado" (release ausente en la respuesta) NO es un error
// de red; lo señalamos con release null y error null, para que la pantalla de detalle muestre su
// estado "no encontrado" en lugar del estado de error.
export async function getReleaseSafe(id: string): Promise<GetReleaseResult> {
  try {
    // Creamos el cliente y pedimos el detalle por id.
    const client = getCatalogClient();
    const response = await client.getRelease({ id });

    // El campo "release" puede venir indefinido si el backend no halló ese id: lo normalizamos a
    // null para tener un único valor "ausente" claro, sin error de red asociado.
    return {
      release: response.release ?? null,
      summary: response.summary ?? null,
      error: null,
    };
  } catch (cause) {
    // Caso de negocio ESPERADO: el backend responde con el código NotFound cuando ese id no existe en
    // el catálogo. Eso NO es un fallo del sistema, así que lo señalamos como "no encontrado" (release
    // null, error null) SIN registrar un error engañoso. La pantalla mostrará su estado "no encontrado".
    if (cause instanceof ConnectError && cause.code === Code.NotFound) {
      return { release: null, summary: null, error: null };
    }
    // Fallo REAL de red/backend (no respondió, timeout, etc.): registramos el detalle técnico (inglés)
    // y devolvemos null con un mensaje de error en es-MX para que la pantalla muestre el estado de error.
    console.error(`getReleaseSafe failed for id="${id}": ${describeError(cause)}`);
    return {
      release: null,
      summary: null,
      error: DETAIL_ERROR_MESSAGE,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// EL CATÁLOGO DE LA VENTANA DE MESES VIGENTE, en un solo sitio.
//
// Por qué existe esto, en español: cuatro páginas distintas —la de una persona, la de una saga, la
// constelación personal y la tabla de administración— hacían EXACTAMENTE lo mismo para arrancar:
// calcular qué meses cubre el producto ahora mismo, pedirlos todos a la vez y juntar el resultado en
// una sola lista. Estaba escrito cuatro veces, palabra por palabra. Cuatro copias de una regla que
// decide QUÉ CATÁLOGO VE EL PRODUCTO no son una molestia de estilo: el día que la ventana de meses
// cambie de tamaño, o el día que haya que tratar de otro modo un mes que no responde, tres de las
// cuatro pantallas se quedarán atrás y nadie se enterará, porque ninguna fallará — sencillamente
// enseñarán un catálogo distinto del de las demás.
// ---------------------------------------------------------------------------------------------

// CatalogWindowResult es el catálogo de la ventana entera, con la salud de la consulta al lado.
//
// Por qué los recuentos viajan con los datos, en español: un mes que no responde no rompe nada —su
// lista llega vacía y el resto se enseña igual—, pero eso significa que una pantalla puede estar
// enseñando un catálogo INCOMPLETO sin saberlo. Con estos dos números, quien lo necesite puede
// distinguir "no hay nada que enseñar" de "no pudimos preguntar", que son cosas muy distintas.
export type CatalogWindowResult<T> = {
  // items son los estrenos de todos los meses que sí respondieron, en una sola lista.
  items: T[];
  // monthCount es cuántos meses cubre la ventana ahora mismo.
  monthCount: number;
  // failedMonthCount es cuántos de esos meses no respondieron. Cero es lo normal.
  failedMonthCount: number;
};

// currentCatalogMonths calcula los meses que el producto cubre ahora mismo.
//
// La fecha de "hoy" puede fijarse por configuración (DEMO_TODAY) para poder enseñar el producto con
// un calendario controlado; si no está puesta, se usa el día real. Se lee aquí, y no en cada página,
// para que todas miren el mismo reloj.
function currentCatalogMonths(): CatalogMonth[] {
  return catalogWindow(resolveDemoToday(process.env.DEMO_TODAY));
}

// loadCatalogWindowSummaries trae los RESÚMENES de todos los meses de la ventana, en una sola lista.
//
// En español: es la forma BARATA de tener el catálogo entero delante. Sirve para todo lo que necesita
// saber qué títulos hay, cómo se llaman, de qué género son, quién los dirige y quién sale en ellos —
// que es la inmensa mayoría de las pantallas—. Cada mes va por el helper que nunca lanza, así que un
// mes caído deja fuera sus títulos pero no rompe la página.
export async function loadCatalogWindowSummaries(): Promise<CatalogWindowResult<ReleaseSummary>> {
  const months = currentCatalogMonths();
  const results = await Promise.all(
    months.map((month) => listReleasesSafe(month.year, month.month)),
  );
  return {
    items: results.flatMap((result) => result.summaries),
    monthCount: months.length,
    failedMonthCount: results.filter((result) => result.error !== null).length,
  };
}

// loadCatalogWindowDetails trae las FICHAS COMPLETAS de todos los meses de la ventana.
//
// Es la forma CARA, y por eso se nombra con todas las letras: solo tiene sentido para las pantallas
// que necesitan mirar DENTRO de cada ficha —el reparto y el equipo con su número de identidad, o las
// entradas de una saga—, porque esos datos no viajan en el resumen. Quien no los necesite debe usar
// loadCatalogWindowSummaries: pedir esto de más multiplica por cinco el peso de la página.
export async function loadCatalogWindowDetails(): Promise<CatalogWindowResult<Release>> {
  const months = currentCatalogMonths();
  const results = await Promise.all(
    months.map((month) => listReleaseDetailsSafe(month.year, month.month)),
  );
  return {
    items: results.flatMap((result) => result.releases),
    monthCount: months.length,
    failedMonthCount: results.filter((result) => result.error !== null).length,
  };
}
