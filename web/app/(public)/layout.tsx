// Archivo: (public)/layout.tsx — Layout del grupo de rutas públicas.
//
// En español: este "marco" envuelve a TODAS las páginas del grupo público (la home y el detalle
// /titulo/[id]). Su razón de ser es legal: los Términos de Uso de TMDB exigen mostrar la atribución
// dondequiera que se usen sus datos, y el detalle también muestra datos de TMDB (título, sinopsis).
// Al poner el pie (Footer) aquí, ambas páginas lo heredan automáticamente: ni se repite en cada
// página ni se olvida en alguna. El grupo "(public)" no cambia la URL; solo agrupa rutas para darles
// este marco común.

import type { ReactNode } from "react";

import { Footer } from "@/components/Footer";

// PublicLayout coloca el contenido de cada página pública y, debajo, el pie con las atribuciones.
// En español: recibe la página en "children", la dibuja y añade el Footer al final para todas.
export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      {children}
      <Footer />
    </>
  );
}
