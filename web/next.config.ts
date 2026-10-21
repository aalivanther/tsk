// Archivo de configuración de Next.js para la app web "The Story Keeper".
// En español: aquí se ajusta cómo Next.js construye y empaqueta el frontend.
// Los ajustes clave son "standalone" (build autocontenido para Docker) y las
// CABECERAS DE SEGURIDAD (CSP y compañía) que el servidor añade a cada respuesta.

import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

// nextConfig agrupa todos los ajustes de construcción del frontend.
// En español: es la "hoja de instrucciones" que Next.js lee al compilar.
const nextConfig: NextConfig = {
  // "standalone" hace que el build genere una carpeta .next/standalone con
  // su propio server.js y solo las dependencias que realmente se usan.
  // En español: en vez de necesitar todo node_modules en producción, Next.js
  // empaqueta lo mínimo indispensable para arrancar, lo que reduce mucho el
  // tamaño de la imagen Docker final (el Dockerfile copia esa carpeta).
  output: "standalone",
  // Ya no hay ningún paquete que haya que transpilar: la opción transpilePackages existía solo por
  // three.js y react-three-fiber, que se retiraron al reimplantar el fondo de motas con un lienzo de
  // dos dimensiones (883 KB de descarga menos en cada visita de escritorio). Sin dependencias que
  // publiquen módulos modernos sin compilar, la opción sobra y se quita.
  // headers añade cabeceras de SEGURIDAD a todas las respuestas del servidor Next.
  // En español: además de la CSP explicada arriba, se envían tres refuerzos estándar:
  //  - X-Content-Type-Options nosniff: el navegador no "adivina" tipos de archivo (evita trucos).
  //  - Referrer-Policy: al navegar a sitios externos solo se comparte el origen, no la URL entera.
  //  - Permissions-Policy: esta app no usa cámara, micrófono ni geolocalización; se apagan.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // La Content-Security-Policy NO se declara aquí: la emite el middleware en CADA petición,
          // porque lleva un "nonce" distinto cada vez y una cabecera estática no puede tenerlo.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

// El ANALIZADOR DE BUNDLE solo se activa con la variable ANALYZE=true (script "pnpm run analyze").
// En español: sirve para ver, de un vistazo, qué librerías ocupan cuánto en el paquete que descarga
// el navegador. Sin esta herramienta, el peso de la app crece sin que nadie se entere hasta que la
// carga se vuelve lenta en un teléfono. Fuera de ese comando no hace absolutamente nada: no afecta
// ni al build normal ni a producción.
export default withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })(nextConfig);
