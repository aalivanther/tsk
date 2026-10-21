// Archivo: setup-tests.ts — Preparación del entorno para las pruebas de COMPONENTES.
//
// En español: las pruebas de interfaz montan componentes de verdad dentro de un navegador simulado
// (jsdom). Ese navegador simulado es minimalista y no trae todo lo que un navegador real ofrece, así
// que aquí se completan las piezas que los componentes del proyecto dan por hechas. Sin esto, las
// pruebas fallarían por motivos que no tienen NADA que ver con lo que se quiere comprobar.
//
// Lo que se prepara:
//   - Los "matchers" de jest-dom, que permiten afirmaciones legibles sobre el DOM
//     (por ejemplo "este elemento está visible" en vez de comprobar estilos a mano).
//   - Limpieza automática entre pruebas, para que una no herede el DOM de la anterior.
//   - matchMedia: jsdom no lo implementa, y varios componentes lo consultan para decidir si están en
//     móvil o si el usuario pidió menos movimiento.
//   - IntersectionObserver y scrollIntoView: tampoco existen en jsdom y los usa la navegación.

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vitest";

// Tras cada prueba se desmonta lo renderizado: cada caso empieza con una pantalla limpia.
afterEach(() => {
  cleanup();
});

beforeAll(() => {
  // localStorage: el perfil del usuario vive ahí, así que sin almacenamiento no se puede probar nada
  // del perfil. El navegador simulado no siempre lo expone (depende de su versión y del origen de la
  // página), así que se instala una implementación en memoria equivalente: mismas operaciones, mismos
  // resultados y sin depender del entorno. Es exactamente lo que hace un navegador real, en pequeño.
  if (typeof globalThis.localStorage === "undefined") {
    const memoryStore = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return memoryStore.size;
      },
      clear: () => memoryStore.clear(),
      getItem: (key: string) => (memoryStore.has(key) ? (memoryStore.get(key) as string) : null),
      key: (index: number) => [...memoryStore.keys()][index] ?? null,
      removeItem: (key: string) => {
        memoryStore.delete(key);
      },
      setItem: (key: string, value: string) => {
        memoryStore.set(key, String(value));
      },
    };
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  }

  // matchMedia: jsdom no lo trae. Se devuelve una implementación mínima que responde "no coincide"
  // a todo, que equivale a "pantalla de escritorio y sin preferencia de movimiento reducido". Las
  // pruebas que necesiten otro comportamiento lo sustituyen puntualmente.
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  // scrollIntoView: jsdom no implementa el desplazamiento, pero varios componentes lo llaman al
  // enfocar una fecha. Se sustituye por una función vacía para que no reviente la prueba.
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = vi.fn();
  }

  // IntersectionObserver: tampoco existe en jsdom. Se declara una versión inerte.
  if (typeof window.IntersectionObserver !== "function") {
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    } as unknown as typeof window.IntersectionObserver;
  }
});
