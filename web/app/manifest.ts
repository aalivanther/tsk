// Archivo: app/manifest.ts — El "manifiesto" que hace INSTALABLE la app (PWA).
//
// En español: un manifiesto es la ficha que el navegador lee para poder instalar el sitio como una
// aplicación en el teléfono o el escritorio. Sin él, la web solo se puede "guardar como marcador" y
// siempre se abre dentro del navegador, con su barra de direcciones. Con él, The Story Keeper puede
// vivir en la pantalla de inicio con su propio icono y abrirse a pantalla completa, como una app.
//
// Next.js (App Router) genera el archivo /manifest.webmanifest a partir de esta función y lo enlaza
// solo en el <head>; por eso no hace falta escribir el JSON a mano ni añadir etiquetas.
//
// Notas de plataforma (verificadas para 2026):
//   - Android/Chrome: ofrece instalar automáticamente cuando el manifiesto es válido.
//   - iOS/Safari: la instalación es MANUAL ("Compartir → Añadir a inicio"); no existe un aviso
//     automático. Una vez instalada, la app sí puede recibir notificaciones push y mostrar el
//     contador en su icono (Badging API), que es justo lo que necesita la campana de avisos.

import type { MetadataRoute } from "next";

// manifest describe la identidad y el comportamiento de la app instalada.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Story Keeper",
    short_name: "Story Keeper",
    description:
      "Línea de tiempo de estrenos de cine, streaming y cadenas en México: lo que viene, cuándo llega y dónde verlo.",
    // start_url: la pantalla que abre la app instalada (la línea de tiempo).
    start_url: "/",
    // display "standalone": sin barra de direcciones del navegador — la señal visual más fuerte de
    // que se está usando una app y no una página web.
    display: "standalone",
    // Colores de la ventana del sistema: el fondo del arranque (splash) y el tinte de la barra de
    // estado. Coinciden con el tema oscuro por defecto del producto.
    background_color: "#070809",
    theme_color: "#070809",
    // orientation "portrait": el móvil es vertical por diseño (la agenda del catálogo se lee en columna).
    orientation: "portrait",
    lang: "es-MX",
    dir: "ltr",
    categories: ["entertainment", "lifestyle"],
    icons: [
      // El icono "any" es el que se usa tal cual; el "maskable" permite a Android recortarlo en la
      // forma del sistema (círculo, cuadrado redondeado) sin que se corte el dibujo.
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
