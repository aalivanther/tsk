// Archivo: rpc-proxy.ts — El puente entre el navegador y el backend, bajo el MISMO dominio.
//
// Por qué existe, en español:
//
// Hasta ahora el navegador hablaba directamente con el backend, que vive en otra dirección. Eso
// obligaba a dos cosas incómodas y una peligrosa:
//
//   - Incómodo 1: hacía falta CORS, es decir, pedirle permiso al navegador en cada llamada.
//   - Incómodo 2: la dirección interna del backend tenía que ser pública y estar incrustada en el
//     código que descarga el usuario.
//   - PELIGROSO: la cookie de sesión que emite el backend sería, para el navegador, una cookie "de
//     terceros" (viene de un dominio distinto al de la página). Safari y los navegadores con
//     protección de rastreo BLOQUEAN esas cookies por defecto. Traducido: en un iPhone, la sesión
//     simplemente no se guardaría. Por eso la sesión seguía dependiendo de un token guardado en el
//     almacenamiento del navegador, que es legible por cualquier script — justo lo que una cookie
//     HttpOnly evita.
//
// Este archivo elimina las tres. El navegador llama a "/rpc/…", que es SU PROPIO dominio; este
// puente reenvía la llamada al backend y devuelve la respuesta tal cual. Desde fuera parece que la
// aplicación y su backend son una sola cosa, que es exactamente lo que son. La cookie pasa a ser de
// primera parte: ningún navegador la bloquea, y puede ser HttpOnly de verdad.
//
// Sobre por qué esto es un archivo de código y no una simple regla de reescritura de Next: las
// reglas de reescritura se resuelven al COMPILAR, y la dirección del backend solo se conoce al
// ARRANCAR el contenedor. Escrito así, la dirección se lee en cada petición y basta reiniciar para
// cambiarla, sin recompilar nada.
//
// Y sobre por qué vive aquí y no junto a la ruta: para poder probarlo. Este puente toca la parte más
// delicada de la aplicación —la cookie de sesión— y tuvo ya un fallo que rompía TODAS las llamadas
// (ver RESPONSE_ONLY_STRIPPED_HEADERS más abajo). Separado del enganche de Next, sus pruebas corren
// en un segundo sin levantar ningún servidor.

import { type NextRequest } from "next/server";

// DEFAULT_API_BASE_URL es la dirección del backend cuando nadie configuró otra (desarrollo sin Docker).
const DEFAULT_API_BASE_URL = "http://localhost:8080";

// PROXY_TIMEOUT_MS es lo máximo que este puente espera al backend antes de rendirse.
// En español: sin un tope, un backend que acepta la conexión y nunca responde dejaría peticiones
// colgadas consumiendo recursos del servidor web hasta agotarlos. Treinta segundos es holgado para
// cualquier operación real de esta aplicación y a la vez acota el daño.
const PROXY_TIMEOUT_MS = 30_000;

// HOP_BY_HOP_HEADERS son cabeceras que describen la conexión concreta entre dos máquinas, no el
// mensaje que viaja. Reenviarlas rompe la conexión siguiente, así que se descartan siempre.
// (Es lo que exige el estándar de HTTP para cualquier intermediario.)
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "host",
]);

// RESPONSE_ONLY_STRIPPED_HEADERS son cabeceras que hay que quitar de la RESPUESTA del backend.
//
// En español: esto arregla un fallo que rompía TODAS las llamadas y que es de los que cuesta ver.
// El backend puede responder comprimido, y lo anuncia con la cabecera "Content-Encoding: gzip". Pero
// la herramienta con la que este puente llama al backend descomprime el contenido ella sola, sin
// avisar. Si se reenviara esa cabecera junto al contenido ya descomprimido, el cliente leería
// "esto viene comprimido", intentaría descomprimir algo que ya no lo está y fallaría con un error
// incomprensible. Se quita la etiqueta porque ya no describe lo que va dentro.
const RESPONSE_ONLY_STRIPPED_HEADERS = new Set(["content-encoding"]);

// CLIENT_FORGEABLE_ADDRESS_HEADERS son cabeceras que dicen "de qué dirección viene esta petición" y
// que CUALQUIERA puede escribir a mano.
//
// Por qué importan tanto, en español: el servidor limita cuántas contraseñas se pueden probar por
// minuto, y para saber a quién limitar mira de qué dirección llega cada intento. Estas cabeceras son
// la forma normal de que un intermediario le diga al servidor la dirección real de la persona. El
// problema es que no las escribe solo un intermediario: las puede escribir el propio atacante. Si se
// dejaran pasar a ciegas, bastaría con cambiarlas en cada intento para que el servidor creyera que
// cada prueba viene de alguien distinto y el límite no valdría nada.
//
// La regla aquí es la conservadora: se BORRAN al reenviar, salvo que quien despliega afirme
// explícitamente que hay delante una plataforma de confianza que las reescribe (ver
// TRUST_PLATFORM_FORWARDED_HEADERS). Equivocarse borrándolas es un inconveniente —el servidor ve a
// todo el mundo como una sola dirección y el límite es más estricto de la cuenta—; equivocarse
// dejándolas pasar es dejar sin protección la puerta de las contraseñas.
const CLIENT_FORGEABLE_ADDRESS_HEADERS = ["x-forwarded-for", "x-real-ip", "forwarded"];

// trustsPlatformForwardedHeaders dice si la plataforma de delante reescribe esas cabeceras.
//
// En español: plataformas como Vercel o un proxy propio bien configurado SUSTITUYEN el valor que
// mandó el cliente por la dirección real, así que ahí sí son fiables y hay que dejarlas pasar (si no,
// el servidor vería todas las peticiones viniendo del mismo sitio). Corriendo sin nada delante, en
// cambio, ese valor viene tal cual del cliente y no vale nada. No se puede adivinar desde aquí, así
// que lo declara quien despliega. Por defecto: NO confiar.
function trustsPlatformForwardedHeaders(): boolean {
  return (process.env.TRUST_PLATFORM_FORWARDED_HEADERS ?? "").toLowerCase() === "true";
}

// BROWSER_ALLOWED_PROCEDURES es la lista EXACTA de operaciones que el navegador puede pedir por aquí.
//
// Por qué existe una lista y no se deja pasar todo, en español:
//
// Este puente reenviaba al backend cualquier dirección que le llegara. Eso significa que estaba
// publicando, sin quererlo, TODAS las operaciones del servidor — incluidas las que solo usa el propio
// servidor por dentro y las que son deliberadamente caras.
//
// El caso concreto que lo destapó: la operación que vuelca las fichas completas de un mes. No la
// llama el navegador en ningún sitio (solo la usan las pantallas que se arman en el servidor), pero
// cualquiera podía pedirla desde fuera con treinta bytes y recibir novecientos mil de vuelta —
// treinta mil veces más de lo que envía. Cuatro peticiones bastan para llevarse el catálogo entero, y
// unas cuantas más para agotar la cuota del servicio y dejar a los demás fuera.
//
// La lista está escrita a mano A PROPÓSITO. Un puente que reenvía "lo que sea" no tiene forma de
// distinguir lo que la aplicación necesita de lo que simplemente existe, y esa distinción es
// justamente lo que hay que decidir con la cabeza. Cuando el navegador necesite una operación nueva,
// añadirla aquí es una línea — y obliga a preguntarse si de verdad debe ser pública.
const BROWSER_ALLOWED_PROCEDURES = new Set([
  // Catálogo: solo la ficha de UN título. El listado y el volcado de fichas completas los pide el
  // servidor al construir las páginas, nunca el navegador.
  "mdm7mo.catalog.v1.CatalogService/GetRelease",
  // Cuentas: el ciclo de vida completo, que por definición ocurre en el navegador.
  "mdm7mo.auth.v1.AuthService/Register",
  "mdm7mo.auth.v1.AuthService/Login",
  "mdm7mo.auth.v1.AuthService/Me",
  "mdm7mo.auth.v1.AuthService/Logout",
  "mdm7mo.auth.v1.AuthService/ChangePassword",
  "mdm7mo.auth.v1.AuthService/DeleteAccount",
  "mdm7mo.auth.v1.AuthService/RequestPasswordReset",
  "mdm7mo.auth.v1.AuthService/ResetPassword",
  // Perfil: leerlo y guardarlo es lo que sincroniza la biblioteca entre dispositivos.
  "mdm7mo.profile.v1.ProfileService/GetProfile",
  "mdm7mo.profile.v1.ProfileService/PutProfile",
]);

// isAllowedProcedure dice si la operación pedida está en la lista de arriba.
//
// La ruta de una llamada tiene siempre dos trozos: el servicio y el método. Cualquier otra forma se
// rechaza sin mirar nada más: si no encaja con lo que el protocolo produce, no viene de la aplicación.
function isAllowedProcedure(pathSegments: string[]): boolean {
  if (pathSegments.length !== 2) {
    return false;
  }
  return BROWSER_ALLOWED_PROCEDURES.has(`${pathSegments[0]}/${pathSegments[1]}`);
}

// buildBackendUrl compone la dirección final en el backend a partir del trozo de ruta recibido.
//
// En español: el navegador llama a "/rpc/mdm7mo.auth.v1.AuthService/Login" y el backend espera
// "/mdm7mo.auth.v1.AuthService/Login". Aquí se quita el prefijo "/rpc" y se conserva el resto tal
// cual, incluidos los parámetros de consulta (Connect los usa en las llamadas de solo lectura).
function buildBackendUrl(request: NextRequest, pathSegments: string[]): string {
  const baseUrl = (process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  // Cada trozo se vuelve a codificar: así una ruta con caracteres raros no puede "escaparse" hacia
  // otra dirección distinta de la que el usuario pidió.
  const path = pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
  const query = request.nextUrl.search;
  return `${baseUrl}/${path}${query}`;
}

// buildForwardHeaders copia las cabeceras del navegador quitando las que no deben viajar.
function buildForwardHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  const trustsForwarded = trustsPlatformForwardedHeaders();

  request.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(name)) {
      return;
    }
    if (!trustsForwarded && CLIENT_FORGEABLE_ADDRESS_HEADERS.includes(name)) {
      // Ver CLIENT_FORGEABLE_ADDRESS_HEADERS: sin una plataforma de confianza delante, este valor lo
      // pudo escribir quien está atacando, y hacerle caso desarmaría el límite de intentos.
      return;
    }
    headers.set(key, value);
  });
  return headers;
}

// forwardToBackend hace el reenvío y devuelve la respuesta del backend al navegador.
//
// Detalle que importa y es fácil pasar por alto: la respuesta se devuelve con su cuerpo, su código y
// sus cabeceras —incluida `Set-Cookie`—. Si esa cabecera se perdiera aquí, iniciar sesión "funcionaría"
// pero el navegador nunca guardaría la sesión, y el usuario volvería a ver la pantalla de entrada al
// recargar sin ningún mensaje de error que explicara por qué.
export async function forwardToBackend(
  request: NextRequest,
  pathSegments: string[],
): Promise<Response> {
  // Puerta de entrada: si la operación no está en la lista, no se reenvía nada. Se responde con el
  // mismo error que daría el backend ante un método que no existe, sin pistas sobre qué SÍ existe.
  if (!isAllowedProcedure(pathSegments)) {
    return new Response(JSON.stringify({ code: "unimplemented", message: "unknown procedure" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const url = buildBackendUrl(request, pathSegments);
  const headers = buildForwardHeaders(request);

  // El cuerpo solo existe en las llamadas que envían datos. Se lee entero antes de reenviar porque
  // las peticiones de esta aplicación son pequeñas (formularios y perfiles, no subidas de archivos)
  // y así se evita la complicación de transmitir en streaming a través del puente.
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), PROXY_TIMEOUT_MS);

  try {
    const backendResponse = await fetch(url, {
      method: request.method,
      headers,
      body,
      signal: abortController.signal,
      // No se guarda nada: cada llamada es una pregunta viva al backend. Las respuestas de sesión y
      // de perfil NUNCA deben reutilizarse entre personas distintas.
      cache: "no-store",
      // El puente no sigue redirecciones por su cuenta: si el backend redirige, que lo vea el cliente.
      redirect: "manual",
    });

    const responseHeaders = new Headers();
    backendResponse.headers.forEach((value, key) => {
      const name = key.toLowerCase();
      if (!HOP_BY_HOP_HEADERS.has(name) && !RESPONSE_ONLY_STRIPPED_HEADERS.has(name)) {
        responseHeaders.set(key, value);
      }
    });
    // `Set-Cookie` necesita trato aparte: puede venir repetida (varias cookies en una respuesta) y
    // `Headers.set` se quedaría solo con la última. `getSetCookie` devuelve todas.
    const setCookieValues = backendResponse.headers.getSetCookie();
    if (setCookieValues.length > 0) {
      responseHeaders.delete("set-cookie");
      for (const cookieValue of setCookieValues) {
        responseHeaders.append("set-cookie", cookieValue);
      }
    }

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    // Que el backend no conteste no debe tumbar la página: se responde con un error claro y del tipo
    // que el cliente de Connect ya sabe interpretar como "servicio no disponible, puedes reintentar".
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const message = isTimeout
      ? "El servidor tardó demasiado en responder."
      : "No se pudo contactar con el servidor.";
    return new Response(JSON.stringify({ code: "unavailable", message }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
