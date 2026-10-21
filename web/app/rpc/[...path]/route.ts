// Archivo: route.ts — La puerta "/rpc" de la aplicación.
//
// En español: este archivo es solo el enganche que Next necesita para saber que existe esta dirección
// y qué métodos atiende. Todo lo que de verdad hace el puente —y, sobre todo, POR QUÉ existe— está
// explicado en src/lib/rpc-proxy.ts, que vive aparte para poder probarlo con pruebas automáticas sin
// tener que levantar el servidor entero.

import { type NextRequest } from "next/server";

import { forwardToBackend } from "@/lib/rpc-proxy";

// RouteContext es la forma en que Next entrega los trozos de la ruta capturada por [...path].
type RouteContext = {
  params: Promise<{ path: string[] }>;
};

// POST es el método que usan casi todas las llamadas (Connect envía los datos en el cuerpo).
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return forwardToBackend(request, path);
}

// GET lo usan las llamadas de solo lectura que Connect puede mandar por la barra de direcciones
// (útil para que las respuestas puedan cachearse por intermediarios).
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return forwardToBackend(request, path);
}

// Este puente se ejecuta SIEMPRE en el momento de la petición: nunca se guarda ni se pre-genera.
// Es obligatorio, no una preferencia: una respuesta de sesión guardada y servida a otra persona
// sería una fuga de cuenta.
export const dynamic = "force-dynamic";
