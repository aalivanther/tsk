// Archivo: (public)/grafo/page.tsx — La página de "tu constelación" (el mapa personal).
//
// En español: esta es la dirección donde vive el mapa de lo que has visto. Su trabajo de servidor es
// UNO solo: traer el catálogo de la ventana de meses vigente, porque lo que el perfil guarda son
// identificadores ("vi estos doscientos títulos") y sin el catálogo esos identificadores no son nada.
// Todo lo demás —leer el perfil de este navegador, construir el mapa, dibujarlo y recorrerlo— ocurre
// en el navegador, dentro de PersonalGraphView.
//
// POR QUÉ EL MAPA NO SE CALCULA EN EL SERVIDOR, que es la pregunta obvia: porque el servicio de
// perfil guarda el perfil como un texto que el servidor NO interpreta, y eso es una decisión de
// arquitectura tomada a propósito (está escrita en profile.proto). Que el backend lo abriera para
// calcular el mapa rompería esa separación. Lo único que sí tiene sentido pedirle al servidor es
// resolver los identificadores a fichas, que es exactamente lo que hace esta página.
//
// Es un Server Component: pide los datos por el cargador compartido loadCatalogWindowSummaries, que NUNCA lanza. Si
// el backend no responde, el catálogo llega vacío y la pantalla enseña su estado de "todavía no hay
// nada que mapear" en vez de romperse.

import type { Metadata } from "next";
import Link from "next/link";

import { PersonalGraphView } from "@/components/graph/PersonalGraphView";
import { loadCatalogWindowSummaries, type ReleaseSummary } from "@/lib/connect/catalog";
import { ui } from "@/lib/i18n";

// Render dinámico: la página pide el catálogo al backend en cada visita, igual que el perfil.
export const dynamic = "force-dynamic";

// metadata describe la página para el navegador y los buscadores.
//
// Sobre "noindex", en español: esta pantalla no tiene contenido público. Lo que se ve depende por
// completo de lo que esa persona haya marcado en SU navegador, así que para un buscador sería una
// página vacía. Pedirle que no la indexe es lo honesto.
export const metadata: Metadata = {
  title: `${ui.graph.title} · ${ui.brand.full}`,
  description: ui.graph.subtitle,
  robots: { index: false, follow: true },
};

export default async function GrafoPage() {
  // La MISMA ventana de meses que el resto de la aplicación (derivada de hoy, no escrita a mano),
  // para que los identificadores del perfil se resuelvan contra el mismo catálogo que se navega.
  //
  // Se piden RESÚMENES, no fichas completas. Esta pantalla llegó a pedir las fichas enteras con el
  // argumento de que necesitaba saber quién actúa y quién dirige en cada título — algo que en su
  // momento solo venía dentro de la ficha. Ya no: el resumen trae esos nombres ya resueltos por el
  // servidor. Pedir las fichas completas costaba 2,6 MB de página, más del doble que la portada, para
  // dibujar exactamente los mismos puntos.
  const catalog: ReleaseSummary[] = (await loadCatalogWindowSummaries()).items;

  return (
    <main className="pg-page font-ui">
      {/* Enlace de vuelta, primero en el orden de tabulación. */}
      <Link href="/" prefetch={false} data-intent-prefetch="/" className="pg-back font-mono">
        <span aria-hidden="true">‹</span> {ui.graph.back}
      </Link>

      <header className="pg-head">
        <h1 className="pg-title font-display">{ui.graph.title}</h1>
        <p className="pg-subtitle">{ui.graph.subtitle}</p>
      </header>

      <PersonalGraphView catalog={catalog} />
    </main>
  );
}
