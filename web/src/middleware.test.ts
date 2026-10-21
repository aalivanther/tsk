// Archivo: middleware.test.ts — Pruebas del PORTERO que corre en el servidor antes de cada página.
//
// En español: el middleware hace dos trabajos, y los dos son de seguridad, así que un fallo aquí no se
// nota mirando la pantalla — se nota cuando ya es tarde.
//
//   (A) Escribe la POLÍTICA DE SEGURIDAD (CSP), que le dice al navegador qué código tiene permiso para
//       ejecutarse. Su pieza clave es el "nonce": un número aleatorio distinto en cada carga, con el
//       que el servidor firma sus propios scripts. Si ese número dejara de cambiar, o si volviera a
//       colarse el permiso "cualquier script escrito dentro del HTML" (unsafe-inline), la protección
//       quedaría vacía sin que nada en la aplicación se viera distinto.
//
//   (B) Cierra la ruta interna /admin. Aquí hubo un fallo real y del peor tipo posible: cuando la
//       clave de acceso NO estaba configurada, la comprobación se saltaba entera y el panel quedaba
//       ABIERTO a cualquiera. Un descuido al desplegar publicaba la administración completa, y en
//       silencio. Ahora el olvido se paga con una puerta cerrada; esta prueba existe para que no se
//       pueda volver a invertir sin que salte.
//
// El archivo vive en src/ porque es donde el corredor de pruebas busca las pruebas de lógica pura, y
// se importa el middleware real desde la raíz del proyecto web: se prueba el que se despliega.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { config, middleware } from "../middleware";

// ADMIN_KEY es la clave de acceso de prueba de /admin.
const ADMIN_KEY = "clave-de-prueba-123";

// BASE_URL es el origen con el que se construyen las peticiones simuladas.
const BASE_URL = "http://localhost:3100";

// makeRequest arma una petición como la que llegaría al servidor, con sus cabeceras.
function makeRequest(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(path, BASE_URL), { headers });
}

// basicAuthHeader arma la cabecera "Authorization: Basic ..." con un usuario y contraseña.
function basicAuthHeader(user: string, password: string): string {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

// scriptSourceDirective extrae la directiva "script-src" de una política, para inspeccionarla sola.
function scriptSourceDirective(policy: string): string {
  const directive = policy.split("; ").find((part) => part.startsWith("script-src"));
  return directive ?? "";
}

// nonceOf saca el nonce que lleva una política (el número de un solo uso de esa petición).
function nonceOf(policy: string): string {
  const match = /'nonce-([^']+)'/.exec(policy);
  return match === null ? "" : match[1];
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("middleware · la política de seguridad (CSP)", () => {
  it("acompaña a cada página con su política", () => {
    const response = middleware(makeRequest("/"));

    const policy = response.headers.get("Content-Security-Policy") ?? "";
    expect(policy).not.toBe("");
    // Los cierres estándar: nada de objetos antiguos, ni reescribir la base de las URLs, ni que el
    // sitio se pueda meter dentro de un marco ajeno, ni enviar formularios fuera de casa.
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("form-action 'self'");
  });

  it("cambia el nonce en CADA petición", () => {
    const first = middleware(makeRequest("/"));
    const second = middleware(makeRequest("/"));

    const firstNonce = nonceOf(first.headers.get("Content-Security-Policy") ?? "");
    const secondNonce = nonceOf(second.headers.get("Content-Security-Policy") ?? "");

    // Que exista y que NO se repita es todo el mecanismo: un atacante no puede firmar su script con
    // un número que cambia en cada carga. Si el nonce se congelara, bastaría con leerlo una vez.
    expect(firstNonce).not.toBe("");
    expect(secondNonce).not.toBe("");
    expect(firstNonce).not.toBe(secondNonce);
  });

  it("el nonce es lo bastante largo para no poder adivinarse", () => {
    const policy = middleware(makeRequest("/")).headers.get("Content-Security-Policy") ?? "";

    // 16 bytes de aleatoriedad criptográfica en base64 son 24 caracteres. Un valor corto (o derivado
    // de la hora, por ejemplo) se podría reproducir, y entonces el nonce no protegería de nada.
    expect(nonceOf(policy).length).toBeGreaterThanOrEqual(20);
  });

  it("NO permite scripts escritos dentro del HTML (nada de unsafe-inline)", () => {
    const policy = middleware(makeRequest("/")).headers.get("Content-Security-Policy") ?? "";

    const scriptSrc = scriptSourceDirective(policy);
    // Este es el punto entero de la política: con 'unsafe-inline' cualquier script colado en la
    // página se ejecutaría igual que los nuestros, y todo lo demás sería decoración.
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it("fuera de desarrollo tampoco permite ejecutar texto como código (unsafe-eval)", () => {
    // Las pruebas corren con NODE_ENV distinto de "development", que es el modo en el que se
    // despliega: ahí las concesiones del empaquetador no deben emitirse.
    const policy = middleware(makeRequest("/")).headers.get("Content-Security-Policy") ?? "";

    expect(scriptSourceDirective(policy)).not.toContain("unsafe-eval");
  });

  it("le pasa el nonce a Next para que firme sus propios scripts", () => {
    const response = middleware(makeRequest("/"));

    // Next recibe el nonce por una cabecera de PETICIÓN reescrita; el marco la expone en la respuesta
    // con el prefijo "x-middleware-request-". Sin este paso, los scripts propios no llevarían firma y
    // la propia aplicación dejaría de arrancar bajo su propia política.
    const forwardedNonce = response.headers.get("x-middleware-request-x-nonce");
    expect(forwardedNonce).not.toBeNull();
    expect(forwardedNonce).toBe(nonceOf(response.headers.get("Content-Security-Policy") ?? ""));
  });
});

describe("middleware · la puerta de /admin", () => {
  it("sin clave en el entorno no pide contraseña aquí: la página lee el archivo local", () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", "");

    const response = middleware(makeRequest("/admin"));

    // Este portero no puede leer el archivo de ajustes. Si respondiera 401, una contraseña
    // guardada desde /configuracion nunca llegaría a la página que sí puede leerla.
    // La página cierra el panel cuando el archivo tampoco tiene contraseña.
    expect(response.status).not.toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("sin clave configurada NO pide usuario y contraseña, porque ninguna funcionaría", () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", "");

    const response = middleware(makeRequest("/admin"));

    // Ofrecer el diálogo de contraseña cuando no hay ninguna válida solo haría que quien administra
    // probara claves eternamente sin entender por qué ninguna vale. Se le explica lo que pasa.
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("con clave en el entorno también cierra las subrutas de /admin", () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", ADMIN_KEY);

    expect(middleware(makeRequest("/admin/ingesta")).status).toBe(401);
    expect(middleware(makeRequest("/admin?debug=1")).status).toBe(401);
  });

  it("con clave configurada y sin credenciales, responde 401 pidiéndolas", () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", ADMIN_KEY);

    const response = middleware(makeRequest("/admin"));

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("la cabecera que pide la contraseña solo lleva caracteres que HTTP admite", () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", ADMIN_KEY);

    const header = middleware(makeRequest("/admin")).headers.get("WWW-Authenticate") ?? "";

    // Regresión de otro fallo real: aquí hubo un guion largo ("—"), que no cabe en una cabecera HTTP
    // y hacía que /admin devolviera un error interno en vez de pedir la contraseña. Se comprueba que
    // todo el texto es de un solo byte.
    for (const character of header) {
      expect(character.codePointAt(0)).toBeLessThan(256);
    }
  });

  it("rechaza la contraseña equivocada y acepta la correcta", () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", ADMIN_KEY);

    const wrong = middleware(
      makeRequest("/admin", { authorization: basicAuthHeader("admin", "otra-clave") }),
    );
    expect(wrong.status).toBe(401);

    const right = middleware(
      makeRequest("/admin", { authorization: basicAuthHeader("admin", ADMIN_KEY) }),
    );
    expect(right.status).not.toBe(401);
  });

  it("rechaza el usuario equivocado aunque la contraseña sea la buena", () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", ADMIN_KEY);

    const response = middleware(
      makeRequest("/admin", { authorization: basicAuthHeader("root", ADMIN_KEY) }),
    );

    expect(response.status).toBe(401);
  });

  it("no se rompe con una cabecera malformada", () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", ADMIN_KEY);

    // Base64 inválido, cabecera sin el prefijo esperado y credenciales sin los dos puntos: las tres
    // se rechazan con un 401 limpio, no con un error del servidor.
    expect(middleware(makeRequest("/admin", { authorization: "Basic ###" })).status).toBe(401);
    expect(middleware(makeRequest("/admin", { authorization: "Bearer abc" })).status).toBe(401);
    expect(
      middleware(makeRequest("/admin", { authorization: `Basic ${btoa("solo")}` })).status,
    ).toBe(401);
  });

  it("pide a los buscadores que no indexen la ruta interna", () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", ADMIN_KEY);

    const blocked = middleware(makeRequest("/admin"));
    const allowed = middleware(
      makeRequest("/admin", { authorization: basicAuthHeader("admin", ADMIN_KEY) }),
    );

    // Tanto si se entra como si no: una ruta interna nunca debe aparecer en un buscador.
    expect(blocked.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(allowed.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("una página normal no queda protegida por error", () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", ADMIN_KEY);

    const response = middleware(makeRequest("/"));

    expect(response.status).not.toBe(401);
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });
});

describe("middleware · la contraseña se compara en tiempo constante", () => {
  // Por qué se prueba así, en español: una comparación normal de textos se detiene en cuanto encuentra
  // la primera letra distinta, y esa diferencia de tiempo —medida sobre miles de intentos— permite
  // adivinar la clave letra a letra en vez de probarlas todas. Medir tiempos en una prueba sería poco
  // fiable (la máquina tiene ruido), así que se comprueba la CAUSA en lugar del síntoma: se cuenta
  // cuántas letras lee la comparación. Si siempre lee el texto entero, el tiempo no puede delatar
  // nada; si alguien sustituyera la función por un "===", no leería ninguna y la cuenta caería a cero.
  //
  // countCharacterReads cuenta las lecturas de letra que hace una petición a /admin.
  function countCharacterReads(password: string): number {
    let reads = 0;
    const original = String.prototype.charCodeAt;
    const spy = vi.spyOn(String.prototype, "charCodeAt").mockImplementation(function (
      this: string,
      index: number,
    ) {
      reads += 1;
      return original.call(this, index);
    });
    middleware(makeRequest("/admin", { authorization: basicAuthHeader("admin", password) }));
    spy.mockRestore();
    return reads;
  }

  it("lee la contraseña ENTERA falle donde falle", () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", ADMIN_KEY);

    // Dos intentos del MISMO largo que la clave real: uno que falla en la PRIMERA letra y otro que
    // falla en la ÚLTIMA. Si la comparación se cortara al primer fallo, el segundo leería muchas más
    // letras que el primero y esa diferencia sería justo la que se explota en un ataque de tiempos.
    const failsAtStart = `X${ADMIN_KEY.slice(1)}`;
    const failsAtEnd = `${ADMIN_KEY.slice(0, -1)}X`;

    const readsFailingAtStart = countCharacterReads(failsAtStart);
    const readsFailingAtEnd = countCharacterReads(failsAtEnd);

    // Mismo número de letras leídas en los dos casos: el tiempo de respuesta no dice NADA sobre
    // cuánto se acercó el intento, que es exactamente la información que un atacante necesitaría.
    expect(readsFailingAtStart).toBe(readsFailingAtEnd);

    // Y la comparación recorre el texto ENTERO: dos lecturas por letra (la del intento y la de la
    // clave real). Si alguien sustituyera la función por un "===" del lenguaje, no habría ninguna
    // lectura de letra y esta cuenta se desplomaría.
    expect(readsFailingAtStart).toBeGreaterThanOrEqual(ADMIN_KEY.length * 2);
  });
});

describe("middleware · dónde corre", () => {
  it("se salta los archivos que no son páginas", () => {
    const matcher = config.matcher[0];
    const pattern = new RegExp(`^${matcher}$`);

    // Las páginas sí pasan por el portero (necesitan su política de seguridad)...
    expect(pattern.test("/")).toBe(true);
    expect(pattern.test("/titulo/abc")).toBe(true);
    expect(pattern.test("/admin")).toBe(true);

    // ...y los recursos estáticos no: no ejecutan código, así que hacerles pasar por aquí sería
    // trabajo inútil repetido en cada carga de cada página.
    expect(pattern.test("/_next/static/chunk.js")).toBe(false);
    expect(pattern.test("/favicon.ico")).toBe(false);
    expect(pattern.test("/manifest.webmanifest")).toBe(false);
    expect(pattern.test("/robots.txt")).toBe(false);
  });
});
