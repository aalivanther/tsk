// Archivo: color-contrast.test.ts — Comprobación AUTOMÁTICA del contraste AA de la paleta.
//
// Por qué esta prueba y no otra, en español:
//
// Las reglas del proyecto declaran el contraste AA como NO NEGOCIABLE, pero hasta ahora nada lo
// verificaba: se comprobaba a ojo, una vez, y cualquier retoque posterior de un color podía romperlo
// sin que nadie se enterara. Había dos formas de automatizarlo y se eligió esta a conciencia:
//
//   · Opción A — axe-core sobre el navegador (Playwright). Analiza la página REAL ya pintada. Suena
//     mejor, pero da una señal poco fiable para este producto en concreto: la interfaz vive sobre
//     fondos con degradados, grano y capas de cristal semitransparentes, y ante un fondo que no es
//     un color plano axe no dictamina — devuelve "no he podido determinarlo". Además solo revisa lo
//     que hay en pantalla en ese instante (un tema, una ruta, un estado), necesita el sitio
//     levantado y añade un navegador entero a las dependencias de las pruebas.
//
//   · Opción B — calcular el contraste de los TOKENS de color, que es lo que se hace aquí. Los
//     tokens son la fuente de la que sale TODO el color de la aplicación: si el token cumple, el
//     texto que lo usa cumple. Se leen del propio globals.css (no de una copia que podría quedar
//     desfasada), se cubren los DOS temas —claro y oscuro— y el resultado es siempre el mismo,
//     sin depender de que haya nada levantado. Corre dentro de `pnpm test`, que es donde tiene
//     que estar una regla que se declara innegociable.
//
// Se eligió la B como red de seguridad permanente. La A se usó como comprobación cruzada puntual en
// el navegador real durante esta revisión, que es su mejor papel: confirmar una vez, no vigilar.
//
// Qué se comprueba exactamente: cada color de TEXTO contra cada color de FONDO del sistema, en los
// dos temas. El umbral es 4.5:1, el mínimo AA para texto normal (el de 3:1 solo vale para textos
// grandes, y los rótulos pequeños en versalitas del producto no lo son).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// AA_MINIMUM_RATIO es el contraste mínimo que exige el nivel AA para texto de tamaño normal.
const AA_MINIMUM_RATIO = 4.5;

// GLOBALS_CSS_PATH apunta a la hoja de estilos real: la prueba lee la fuente de verdad, no una copia.
const GLOBALS_CSS_PATH = fileURLToPath(new URL("../../app/globals.css", import.meta.url));

// LIGHT_THEME_SELECTOR es el bloque donde el tema claro redefine sus tokens.
const LIGHT_THEME_SELECTOR = 'html[data-theme="light"]';

// TEXT_TOKENS son los tokens que se usan para pintar TEXTO en la interfaz.
// En español: los tres niveles de texto (principal, secundario y tenue) y los tres dorados de marca,
// que además de bordes pintan rótulos y enlaces de acento.
const TEXT_TOKENS = [
  "--color-text",
  "--color-text-muted",
  "--color-text-subtle",
  "--color-gold",
  "--color-gold-bright",
  "--color-gold-deep",
] as const;

// SURFACE_TOKENS son los tokens sobre los que ese texto se apoya: el fondo de la página y las dos
// superficies de "cristal" (tarjetas y capas internas de las tarjetas).
const SURFACE_TOKENS = ["--color-bg", "--color-surface", "--color-surface-2"] as const;

// ACCENT_TOKENS son los colores de categoría. Se comprueban aparte porque su papel principal es
// marcar (puntos, barras, bordes), pero también aparecen como texto en chips y etiquetas.
const ACCENT_TOKENS = ["--color-teal", "--color-violet", "--color-indie", "--color-live"] as const;

// Rgb es un color ya resuelto a sus tres componentes de 0 a 255.
type Rgb = { red: number; green: number; blue: number };

// parseColor entiende los dos formatos que usa la hoja: "#rrggbb" (o "#rgb") y "rgba(r, g, b, a)".
// Devuelve el color y su opacidad; los semitransparentes se resuelven después sobre su fondo.
function parseColor(value: string): { color: Rgb; alpha: number } {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) {
    const digits = trimmed.slice(1);
    const expanded =
      digits.length === 3
        ? digits
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : digits;
    return {
      color: {
        red: Number.parseInt(expanded.slice(0, 2), 16),
        green: Number.parseInt(expanded.slice(2, 4), 16),
        blue: Number.parseInt(expanded.slice(4, 6), 16),
      },
      alpha: 1,
    };
  }
  const match = /^rgba?\(([^)]+)\)$/.exec(trimmed);
  if (match === null) {
    throw new Error(`Color no reconocido en globals.css: "${value}"`);
  }
  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
  return {
    color: { red: parts[0], green: parts[1], blue: parts[2] },
    alpha: parts.length > 3 ? parts[3] : 1,
  };
}

// flattenOver resuelve un color semitransparente sobre el fondo que tiene detrás.
// En español: una tarjeta de "cristal" deja ver el fondo de la página, así que el color real que el
// ojo percibe es la mezcla de los dos. Sin esta mezcla, medir el contraste sobre el cristal no
// tendría ningún sentido: se estaría midiendo contra un color que nadie ve.
function flattenOver(color: Rgb, alpha: number, background: Rgb): Rgb {
  return {
    red: color.red * alpha + background.red * (1 - alpha),
    green: color.green * alpha + background.green * (1 - alpha),
    blue: color.blue * alpha + background.blue * (1 - alpha),
  };
}

// channelLuminance convierte un componente de color al valor con el que se mide la luz percibida.
// En español: el ojo no percibe el doble de luz cuando el número se duplica; esta curva (la que
// define la norma WCAG) corrige esa diferencia para que el cálculo refleje lo que se ve.
function channelLuminance(component: number): number {
  const normalized = component / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

// relativeLuminance calcula cuánta luz emite un color, con el peso que el ojo da a cada color.
// El verde pesa mucho más que el azul porque el ojo humano es mucho más sensible a él.
function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * channelLuminance(color.red) +
    0.7152 * channelLuminance(color.green) +
    0.0722 * channelLuminance(color.blue)
  );
}

// contrastRatio devuelve la relación de contraste entre dos colores, según la fórmula de la WCAG.
// Va de 1 (idénticos, invisible) a 21 (negro puro sobre blanco puro).
function contrastRatio(foreground: Rgb, background: Rgb): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

// readTokens extrae los tokens de color de un bloque de la hoja de estilos.
// En español: se lee el archivo tal cual está en disco. Si alguien cambia un color, esta prueba ve
// el cambio en la siguiente ejecución — que es justo lo que se quiere de una red de seguridad.
function readTokens(css: string, blockStartMarker: string): Map<string, string> {
  const startIndex = css.indexOf(blockStartMarker);
  if (startIndex === -1) {
    throw new Error(`No se encontró el bloque "${blockStartMarker}" en globals.css`);
  }
  const braceIndex = css.indexOf("{", startIndex);
  // Se recorre el bloque contando llaves para quedarse EXACTAMENTE con su contenido y no arrastrar
  // las declaraciones del bloque siguiente (que en el tema claro redefine varios de estos tokens).
  let depth = 0;
  let endIndex = braceIndex;
  for (let index = braceIndex; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }
  const block = css.slice(braceIndex + 1, endIndex);
  const tokens = new Map<string, string>();
  const declarationPattern = /(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let declaration = declarationPattern.exec(block);
  while (declaration !== null) {
    tokens.set(declaration[1], declaration[2].trim());
    declaration = declarationPattern.exec(block);
  }
  return tokens;
}

// resolveSurface devuelve el color REAL de una superficie, ya mezclada con el fondo si es de cristal.
function resolveSurface(tokens: Map<string, string>, tokenName: string, pageBackground: Rgb): Rgb {
  const raw = tokens.get(tokenName);
  if (raw === undefined) {
    throw new Error(`Falta el token ${tokenName}`);
  }
  const { color, alpha } = parseColor(raw);
  return alpha === 1 ? color : flattenOver(color, alpha, pageBackground);
}

// resolveText devuelve el color de un token de texto (los de texto nunca son semitransparentes).
function resolveText(tokens: Map<string, string>, tokenName: string): Rgb {
  const raw = tokens.get(tokenName);
  if (raw === undefined) {
    throw new Error(`Falta el token ${tokenName}`);
  }
  return parseColor(raw).color;
}

// Los dos temas se preparan una sola vez: el oscuro vive en el bloque @theme y el claro lo redefine
// en su propio bloque, así que el claro parte del oscuro y le aplica sus cambios encima.
const css = readFileSync(GLOBALS_CSS_PATH, "utf8");
const darkTokens = readTokens(css, "@theme {");
const lightTokens = new Map(darkTokens);
for (const [name, value] of readTokens(css, LIGHT_THEME_SELECTOR)) {
  lightTokens.set(name, value);
}

// THEMES son los dos temas que la aplicación ofrece; los dos tienen que cumplir por igual.
const THEMES = [
  { name: "oscuro", tokens: darkTokens },
  { name: "claro", tokens: lightTokens },
] as const;

describe("Contraste AA de la paleta (regla no negociable del proyecto)", () => {
  for (const theme of THEMES) {
    describe(`tema ${theme.name}`, () => {
      const pageBackground = resolveText(theme.tokens, "--color-bg");

      for (const surfaceToken of SURFACE_TOKENS) {
        const surface = resolveSurface(theme.tokens, surfaceToken, pageBackground);

        for (const textToken of TEXT_TOKENS) {
          it(`${textToken} sobre ${surfaceToken} alcanza AA`, () => {
            const ratio = contrastRatio(resolveText(theme.tokens, textToken), surface);
            // El mensaje incluye el número medido: si algún día falla, se sabe de inmediato cuánto
            // falta y no hay que reproducir el cálculo a mano.
            expect(
              ratio,
              `${textToken} sobre ${surfaceToken} da ${ratio.toFixed(2)}:1 (mínimo ${AA_MINIMUM_RATIO}:1)`,
            ).toBeGreaterThanOrEqual(AA_MINIMUM_RATIO);
          });
        }
      }

      for (const accentToken of ACCENT_TOKENS) {
        it(`${accentToken} alcanza AA sobre el fondo de la página`, () => {
          const ratio = contrastRatio(resolveText(theme.tokens, accentToken), pageBackground);
          expect(
            ratio,
            `${accentToken} da ${ratio.toFixed(2)}:1 (mínimo ${AA_MINIMUM_RATIO}:1)`,
          ).toBeGreaterThanOrEqual(AA_MINIMUM_RATIO);
        });
      }
    });
  }

  it("los dos temas definen todos los tokens que se miden", () => {
    // Si alguien añadiera un tema nuevo o borrara un token, la prueba de arriba podría dejar de
    // medir algo sin fallar. Esta comprobación se asegura de que no hay huecos silenciosos.
    for (const theme of THEMES) {
      for (const token of [...TEXT_TOKENS, ...SURFACE_TOKENS, ...ACCENT_TOKENS]) {
        expect(theme.tokens.has(token), `${token} falta en el tema ${theme.name}`).toBe(true);
      }
    }
  });
});
