"use client";

// Archivo: browser-transport.ts — La conexión del NAVEGADOR con el backend.
//
// En español: aquí se decide a qué dirección llama la aplicación cuando corre en el navegador de una
// persona. La respuesta es corta y es la clave de todo el diseño de sesión: llama a SU PROPIA
// dirección, al camino "/rpc", no a la del backend.
//
// Por qué importa tanto ese detalle:
//
// La sesión de cada persona viaja en una cookie. Los navegadores tratan de forma muy distinta a las
// cookies según de dónde vengan: si la dirección que emite la cookie es la misma que la de la página,
// se guarda sin más; si es otra distinta, la cookie es "de terceros" y Safari —y cualquier navegador
// con protección de rastreo— la DESCARTA. En un iPhone eso significaba, sencillamente, que no se
// podía iniciar sesión. Al llamar a nuestra propia dirección y que sea el servidor de la web quien
// reenvíe la llamada al backend (ver web/app/rpc), la cookie es de primera parte y nadie la bloquea.
//
// De regalo: desaparece CORS del camino del navegador, y la dirección interna del backend deja de
// estar incrustada en el código que descarga el usuario.
//
// Este archivo existe para que esa decisión esté escrita UNA sola vez. Antes vivía duplicada en dos
// sitios, y una duplicación así se desincroniza en cuanto alguien cambia uno y no ve el otro.

import { createConnectTransport } from "@connectrpc/connect-web";
import type { Transport } from "@connectrpc/connect";

// RPC_PROXY_PATH es el camino, dentro de nuestra propia web, por el que salen todas las llamadas.
const RPC_PROXY_PATH = "/rpc";

// BROWSER_REQUEST_TIMEOUT_MS es el plazo máximo de espera de una llamada desde el navegador.
//
// En español: es más holgado que el del servidor porque aquí la red es la del usuario, que puede ser
// una conexión móvil lenta. Aun así está acotado: sin un tope, un servidor que no contesta dejaría un
// formulario bloqueado en "Un momento…" para siempre, sin error y sin forma de reintentar.
const BROWSER_REQUEST_TIMEOUT_MS = 15_000;

// resolveBrowserBaseUrl devuelve la dirección completa del puente en el origen actual.
//
// En español: se compone con la dirección real de la página (no una escrita a mano) para que funcione
// igual en local, en pruebas y en producción, sin ninguna variable que configurar ni que se pueda
// quedar desfasada. Durante el dibujado en el servidor no hay página todavía, y ahí se devuelve el
// camino a secas: ese código nunca llega a hacer la llamada, pero necesita un valor válido.
function resolveBrowserBaseUrl(): string {
  if (typeof window === "undefined") {
    return RPC_PROXY_PATH;
  }
  return `${window.location.origin}${RPC_PROXY_PATH}`;
}

// createBrowserTransport arma el "cable" que usan todos los componentes del navegador.
export function createBrowserTransport(): Transport {
  return createConnectTransport({
    baseUrl: resolveBrowserBaseUrl(),
    defaultTimeoutMs: BROWSER_REQUEST_TIMEOUT_MS,
    // "same-origin" hace que el navegador adjunte la cookie de sesión en cada llamada.
    //
    // En español: ese ya es el comportamiento por omisión para una llamada a la propia dirección,
    // pero se escribe de forma explícita porque de esto depende que la sesión funcione. Una pieza
    // así no debería descansar sobre un valor implícito que alguien pueda cambiar sin darse cuenta
    // de lo que rompe. Se declara envolviendo el `fetch` del navegador, que es la vía que ofrece
    // esta librería para ajustar las opciones de red.
    fetch: (input, init) => globalThis.fetch(input, { ...init, credentials: "same-origin" }),
  });
}
