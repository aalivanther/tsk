// Archivo: transport.ts — Conexión del backend para el lado SERVIDOR (RSC).
// En español: este archivo crea el "cable" por el que el servidor de Next.js le hace preguntas al
// backend de Go (el catálogo de estrenos). Lo importante: este cable se usa SOLO desde el servidor
// —dentro de los React Server Components que se ejecutan en Node, nunca en el navegador del
// usuario—. El navegador tiene su propio cable aparte (ver components/Providers.tsx). Separarlos es
// a propósito: el servidor habla con una dirección interna (en Docker, "http://api:8080") que el
// navegador del usuario no puede alcanzar.

import { createConnectTransport } from "@connectrpc/connect-web";
import type { Transport } from "@connectrpc/connect";

// DEFAULT_SERVER_API_BASE_URL es la dirección del backend que se usa cuando nadie configuró una.
// En español: en desarrollo local sin Docker, el backend de Go corre en este puerto de la misma
// máquina. En Docker Compose, en cambio, la variable de entorno API_BASE_URL se inyecta apuntando
// a "http://api:8080" (el nombre del servicio del backend dentro de la red interna de Compose), así
// que ahí esta dirección por defecto NO se usa. Tenerla como constante con nombre evita repetir el
// texto y deja claro de dónde sale el valor.
const DEFAULT_SERVER_API_BASE_URL = "http://localhost:8080";

// SERVER_REQUEST_TIMEOUT_MS es el plazo máximo que el servidor espera una respuesta del backend.
// En español: las consultas del catálogo son lecturas de datos que ya están en memoria del backend y
// responden en milisegundos; 5 segundos es un margen enorme para una red interna y, a la vez, un tope
// que garantiza que ninguna página quede colgada esperando a un backend que no contesta.
const SERVER_REQUEST_TIMEOUT_MS = 5000;

// createServerTransport arma el "cable" (transport) que el servidor usa para llamar al backend.
// En español: devuelve un transport de Connect ya configurado con la dirección del backend. La
// dirección sale de la variable de entorno API_BASE_URL si existe; si no, usa la dirección local
// por defecto. Esta función es para uso EXCLUSIVO del servidor (RSC / código que corre en Node):
// no debe llamarse desde componentes con 'use client', porque expondría la dirección interna del
// backend al navegador y, además, esa dirección no sería alcanzable desde ahí.
//
// Nota: cada llamada server-side crea su propio transport. Es barato (es solo configuración con
// fetch por debajo) y mantiene cada petición aislada, sin estado compartido entre requests.
export function createServerTransport(): Transport {
  // baseUrl es la dirección final a la que apuntará el cable.
  // En español: preferimos lo que diga el entorno (process.env.API_BASE_URL, inyectado por Docker
  // Compose); si esa variable no está definida, caemos a la dirección local por defecto.
  const baseUrl = process.env.API_BASE_URL ?? DEFAULT_SERVER_API_BASE_URL;

  // Creamos el transport de Connect-over-HTTP apuntando a esa dirección.
  // En español: este objeto sabe cómo empaquetar las preguntas, mandarlas por HTTP al backend y
  // desempaquetar las respuestas. Aquí solo lo configuramos; quien lo usa es el cliente de catálogo
  // (ver catalog.ts).
  return createConnectTransport({
    baseUrl,
    // Plazo máximo de respuesta. En español: sin este tope, si el backend se CUELGA (no se cae: acepta
    // la conexión y nunca responde), el render del servidor se queda esperando para siempre y la
    // página nunca llega al usuario — que ve una pestaña cargando indefinidamente, el peor de los
    // fallos posibles porque ni siquiera puede reintentar. Con el tope, la llamada falla, el helper
    // seguro devuelve su lista vacía con error y la pantalla muestra su estado de error, con reintento.
    defaultTimeoutMs: SERVER_REQUEST_TIMEOUT_MS,
  });
}
