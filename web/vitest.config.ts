// Archivo: vitest.config.ts — Configuración de las pruebas del frontend (Vitest).
//
// En español: hay dos clases de prueba en este proyecto y necesitan entornos distintos:
//
//   1. LÓGICA PURA (src/lib/*.test.ts): funciones de fechas, avisos, rareza, saneo de URLs...
//      No tocan el navegador, así que corren en "node", que es más rápido y no carga nada de más.
//
//   2. COMPONENTES (src/**/*.test.tsx): piezas de interfaz que se montan de verdad y se prueban
//      como las usaría una persona (escribir en un campo, pulsar un botón, leer lo que aparece).
//      Estas necesitan un navegador simulado, que aporta jsdom.
//
// Se declaran como dos "proyectos" para que cada archivo corra en el entorno que le corresponde sin
// tener que anotarlo uno por uno.

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// srcAlias replica el alias "@" del tsconfig para que los imports resuelvan igual que en la app.
const srcAlias = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": srcAlias,
    },
  },
  test: {
    projects: [
      {
        resolve: { alias: { "@": srcAlias } },
        test: {
          name: "logica",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias: { "@": srcAlias } },
        test: {
          name: "componentes",
          include: ["src/**/*.test.tsx"],
          environment: "jsdom",
          // El navegador simulado necesita una DIRECCIÓN para comportarse como un sitio real.
          // En español: sin URL, jsdom arranca en un "origen opaco" (about:blank) y, por seguridad,
          // los navegadores deshabilitan el almacenamiento local en ese contexto. El resultado es que
          // localStorage no existe y cualquier componente que guarde el perfil falla por un motivo
          // que no tiene nada que ver con lo que se está probando. Dándole una dirección normal, el
          // entorno se comporta como el navegador de verdad.
          environmentOptions: {
            jsdom: {
              url: "http://localhost:3100",
            },
          },
          // setup-tests prepara el entorno del navegador simulado antes de cada archivo.
          setupFiles: ["./src/test/setup-tests.ts"],
        },
      },
    ],
  },
});
