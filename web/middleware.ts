// Archivo: middleware.ts — El portero que corre en el SERVIDOR antes de renderizar cada página.
//
// Tiene DOS responsabilidades:
//
// (A) LA POLÍTICA DE SEGURIDAD DE CONTENIDO (CSP) CON "NONCE", para todas las páginas.
//
// En español: la CSP le dice al navegador qué código tiene permiso para ejecutarse. Hasta ahora la
// nuestra incluía 'unsafe-inline', que significa literalmente "permite cualquier script escrito
// dentro del HTML". Eso vaciaba de contenido la protección: si un atacante lograra colar HTML en la
// página (un XSS), su script quedaría permitido igual que los nuestros.
//
// No se podía quitar sin más porque Next.js necesita scripts en línea para arrancar la página. La
// solución estándar es el "nonce": un número aleatorio distinto en CADA petición. El servidor lo
// anuncia en la política ("solo confío en los scripts que traigan este número") y se lo pone a sus
// propios scripts. Un atacante no puede adivinarlo —cambia en cada carga— así que su script inyectado
// queda bloqueado aunque consiga insertarlo. Next detecta el nonce en la cabecera y lo propaga solo.
//
// (B) LA PROTECCIÓN DE /admin (ver más abajo).
//
// En español: /admin es una pantalla interna de inspección (y en Fase 1 será la interfaz de ingesta).
// Este middleware la protege en dos capas:
//   1) SIEMPRE añade "X-Robots-Tag: noindex" — los buscadores no deben indexar rutas internas.
//   2) Si la variable de entorno ADMIN_ACCESS_KEY está definida, exige autenticación HTTP Basic
//      (usuario "admin" + esa clave). Si no está en el entorno, la página de admin decide: puede
//      haber una contraseña en el archivo local, y este portero no lee archivos. Sin ninguna de las
//      dos, la página no muestra el catálogo.
//
// ¿Por qué Basic y no el token de sesión del login? El token de sesión vive en localStorage y viaja
// como cabecera "Authorization: Bearer" SOLO en las llamadas RPC del navegador al backend; el
// middleware de Next ve la NAVEGACIÓN (el GET de la página), donde esa cabecera no existe. Proteger
// /admin con la sesión real exigiría mover la sesión a una cookie — cambio mayor registrado como
// pendiente de la fase de cuentas; mientras tanto, Basic con clave de entorno es protección honesta.

import { NextResponse, type NextRequest } from "next/server";

// adminBasicUser es el usuario fijo del Basic auth de /admin (la contraseña es ADMIN_ACCESS_KEY).
const adminBasicUser = "admin";

// isDevelopment activa las concesiones que SOLO necesita el modo desarrollo de Next (el empaquetador
// usa eval para recargar en caliente). En producción esas concesiones NO se emiten.
const isDevelopment = process.env.NODE_ENV === "development";

// buildContentSecurityPolicy arma la política de seguridad de esta petición, con su nonce.
//
// Directiva por directiva, en español:
//   - default-src 'self': por defecto, solo se cargan recursos de nuestro propio sitio.
//   - script-src: SOLO scripts nuestros y los que traigan el nonce de esta petición. Ya NO se
//     permite cualquier script en línea. 'strict-dynamic' deja que un script de confianza cargue a
//     otros (Next divide su código en trozos que se piden entre sí).
//   - style-src: los estilos en línea SÍ se permiten. Es una excepción consciente: Tailwind y Next
//     inyectan estilos en línea constantemente y un estilo no puede ejecutar código; el riesgo real
//     es órdenes de magnitud menor que el de un script.
//   - img-src: nuestras imágenes, las de TMDB y las incrustadas como datos.
//   - connect-src: a dónde puede hablar la página (nuestro backend).
//   - frame-src: únicamente el reproductor de YouTube en su modo de privacidad.
//   - object-src 'none', base-uri 'self', frame-ancestors 'self': cierres estándar que impiden
//     incrustar objetos antiguos, reescribir la base de las URLs o meter el sitio en un iframe ajeno.
function buildContentSecurityPolicy(nonce: string): string {
  // El navegador solo habla con NUESTRA propia dirección: desde que las llamadas al backend pasan
  // por el puente "/rpc" (ver app/rpc), no hay ningún otro destino legítimo. Cerrar esto a 'self' es
  // una mejora real de seguridad: si alguien lograra inyectar un script, no podría enviarse los datos
  // a un servidor suyo, porque el navegador se lo impediría.
  const connectSources = isDevelopment ? "'self' ws: wss:" : "'self'";

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://image.tmdb.org",
    `connect-src ${connectSources}`,
    "font-src 'self' data:",
    "frame-src https://www.youtube-nocookie.com",
    // worker-src: el polvo del fondo se pinta en un worker propio (components/particles), servido
    // desde este mismo sitio. Se declara explícito para no depender de cómo cada navegador aplica
    // 'strict-dynamic' a los workers; si aun así se bloqueara, el polvo vuelve al hilo principal.
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    // form-action limita a dónde puede ENVIARSE un formulario. Se declara aparte porque, a
    // diferencia de casi todas las demás, esta regla NO hereda de default-src: sin escribirla, un
    // script inyectado podría reescribir el destino del formulario de contraseña y mandarlo a otro
    // sitio, y la política no diría nada.
    "form-action 'self'",
  ].join("; ");
}

// newNonce genera el número aleatorio de un solo uso de esta petición.
// En español: 16 bytes de aleatoriedad criptográfica en base64. Debe ser IMPREDECIBLE: si se pudiera
// adivinar, un atacante lo incluiría en su script inyectado y la protección no serviría de nada.
function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

// middleware corre para cada petición que encaje con el config del final del archivo.
export function middleware(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);

  // --- (B) Protección de la ruta interna /admin ---
  //
  // Si ADMIN_ACCESS_KEY está en el entorno, aquí se exige HTTP Basic. Si no está, este portero
  // deja pasar la petición: la contraseña puede vivir en el archivo local, y esta capa no lee
  // archivos. La página de admin cierra el panel cuando tampoco hay contraseña en el archivo.
  const isAdminRoute = request.nextUrl.pathname.startsWith("/admin");
  if (isAdminRoute) {
    const adminAccessKey = process.env.ADMIN_ACCESS_KEY ?? "";
    if (adminAccessKey !== "") {
      const authorizationHeader = request.headers.get("authorization") ?? "";
      const isAuthorized = isValidBasicAuth(authorizationHeader, adminBasicUser, adminAccessKey);
      if (!isAuthorized) {
        return new NextResponse("Autenticación requerida", {
          status: 401,
          headers: {
            "X-Robots-Tag": "noindex, nofollow",
            "Content-Security-Policy": contentSecurityPolicy,
            // Solo caracteres de un byte: un guion largo aquí convertía el 401 en un error interno.
            "WWW-Authenticate": 'Basic realm="The Story Keeper admin"',
          },
        }) as NextResponse;
      }
    }
  }

  // --- (A) CSP con nonce para el render ---
  // El nonce se le pasa a Next por una cabecera de PETICIÓN: así el framework puede marcar con él
  // sus propios scripts, y el código de la página puede leerlo si necesita añadir alguno propio.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  // Las rutas internas nunca deben aparecer en un buscador.
  if (isAdminRoute) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

// constantTimeEquals compara dos textos tardando SIEMPRE lo mismo, acierte o no.
//
// Por qué hace falta, en español: la comparación normal de textos se detiene en cuanto encuentra la
// primera letra distinta. Eso significa que comparar la clave correcta con "aaaa" tarda un pelín
// menos que compararla con "Xaaa" si empieza por X. Midiendo miles de intentos, esa diferencia
// permite adivinar la clave letra a letra en vez de tener que probarlas todas — pasar de un número
// astronómico de intentos a unos pocos miles. Recorriendo siempre el texto entero y acumulando las
// diferencias, el tiempo deja de contar nada.
function constantTimeEquals(actual: string, expected: string): boolean {
  // La longitud sí se compara directamente: no es un secreto que merezca protegerse, y comparar
  // textos de distinta longitud carácter a carácter no tendría sentido.
  if (actual.length !== expected.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

// isValidBasicAuth valida una cabecera "Authorization: Basic base64(usuario:contraseña)".
// En español: decodifica la cabecera y compara usuario y contraseña sin que el tiempo de respuesta
// delate cuánto se acercó el intento (ver constantTimeEquals).
function isValidBasicAuth(header: string, expectedUser: string, expectedPassword: string): boolean {
  const basicPrefix = "Basic ";
  if (!header.startsWith(basicPrefix)) {
    return false;
  }
  let decoded = "";
  try {
    decoded = atob(header.slice(basicPrefix.length));
  } catch {
    // Base64 inválido: cabecera malformada, se rechaza sin romper.
    return false;
  }
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    return false;
  }
  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  const userMatches = constantTimeEquals(user, expectedUser);
  const passwordMatches = constantTimeEquals(password, expectedPassword);
  return userMatches && passwordMatches;
}

// config decide en qué rutas corre el middleware.
// En español: ahora corre en TODAS las páginas, porque la política de seguridad con nonce debe
// acompañar a cada documento HTML que se sirve. Se excluyen a propósito los archivos que no son
// páginas —los recursos internos de Next, las imágenes y el manifiesto—: no ejecutan código, así que
// no necesitan política, y hacerles pasar por aquí sería trabajo inútil en cada carga.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-|apple-icon|manifest.webmanifest|robots.txt|sitemap.xml).*)",
  ],
};
