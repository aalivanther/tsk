// Archivo: app/robots.ts — Las instrucciones para los BUSCADORES (el archivo /robots.txt).
//
// En español: robots.txt es la nota que cada buscador lee antes de recorrer un sitio. Aquí se le dice
// qué puede visitar y dónde está el mapa del sitio. Next.js (App Router) genera el archivo de texto a
// partir de esta función; no hace falta escribirlo a mano ni colocarlo en /public.
//
// Dos decisiones y su motivo:
//   - Se permite recorrer todo el contenido público (la línea de tiempo y las fichas de los títulos):
//     es justo lo que queremos que la gente encuentre desde un buscador.
//   - Se bloquean /admin (pantalla interna de inspección, que además ya responde con "noindex" desde
//     el middleware) y /perfil (es la pantalla personal de cada quien: no tiene sentido indexarla, y
//     su contenido real vive en el navegador de la persona, no en el servidor).

import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

// robots describe las reglas para los rastreadores y señala dónde está el mapa del sitio.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: {
      // "*" significa "cualquier buscador": las mismas reglas para todos.
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/perfil", "/login"],
    },
    // El mapa del sitio ayuda al buscador a descubrir todas las fichas sin tener que adivinarlas.
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}

// El archivo se genera en cada petición, no al compilar.
// En español: la dirección pública del sitio se lee de una variable de entorno que solo existe al
// ARRANCAR el contenedor. Si este archivo se preparara por adelantado, esa variable aún no existiría
// y el resultado anunciaría para siempre la dirección de desarrollo — que es exactamente lo que
// pasaba: el archivo decía "http://localhost:3000" incluso en un despliegue real.
export const dynamic = "force-dynamic";
