// Configuración de ESLint (formato "flat config") para la app web "MDM 7mo".
//
// En español: ESLint es el revisor automático de calidad del código TypeScript y React.
// Avisa de errores comunes, malas prácticas y problemas de estilo. Usamos el preset oficial
// de Next.js (eslint-config-next), que ya trae las reglas recomendadas de React, de los
// hooks y las propias del framework (por ejemplo, el uso correcto de los componentes de
// imágenes y navegación).
//
// A partir de Next 16, eslint-config-next exporta directamente configuraciones en formato
// "flat" (un arreglo de reglas). Por eso las importamos y las encadenamos tal cual, SIN el
// puente FlatCompat (@eslint/eslintrc): ese puente provoca un error de validación con los
// plugins modernos de React ("Converting circular structure to JSON"). Importar el flat
// nativo es el camino soportado y libre de ese problema.

// Preset de rendimiento y buenas prácticas del framework (Core Web Vitals).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
// Preset de reglas específicas para TypeScript.
import nextTypeScript from "eslint-config-next/typescript";

// eslintConfig es la lista final de reglas que ESLint aplicará al revisar.
// En español: primero indicamos qué carpetas ignorar y luego encadenamos los presets de
// Next.js (cada uno es ya un arreglo de configuraciones flat, por eso usamos el spread ...).
const eslintConfig = [
  // Ignorar carpetas que no escribe una persona o que no deben revisarse.
  // En español: node_modules son dependencias externas; .next es el resultado del build;
  // y src/gen es código generado automáticamente desde los .proto, así que no tiene sentido
  // exigirle nuestro estilo a mano.
  {
    ignores: ["node_modules/**", ".next/**", "src/gen/**", "next-env.d.ts"],
  },
  // Reglas oficiales de Next.js: rendimiento/buenas prácticas (core-web-vitals) y TypeScript.
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default eslintConfig;
