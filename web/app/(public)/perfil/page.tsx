// Archivo: (public)/perfil/page.tsx — La página de PERFIL del usuario (sin login).
//
// En español: es la pantalla "mi cuenta" local. Su trabajo de servidor es traer el catálogo (may–jul 2026)
// para poder RESOLVER los ids guardados en el perfil (watchlist/vistas/reseñas) a sus estrenos completos, y
// los géneros/plataformas reales del catálogo para los selectores de gustos. Todo lo interactivo (leer el
// perfil de localStorage, gestionar listas, reseñar, ajustes) vive en el componente cliente ProfileView.
//
// Es un Server Component: pide los datos por el cargador compartido loadCatalogWindowSummaries (nunca lanza). Si el backend
// no responde, el catálogo viene vacío y el perfil sigue funcionando (solo no podrá mapear ids a estrenos).

import { ProfileView } from "@/components/profile/ProfileView";
import { loadCatalogWindowSummaries, type ReleaseSummary } from "@/lib/connect/catalog";
import { collectGenres } from "@/lib/timeline";

// Render dinámico (no en build): la página pide datos al backend en cada visita.
export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  // Pedimos la MISMA ventana de meses que la home (derivada de HOY, no meses escritos a mano), para que
  // los ids guardados en el perfil se resuelvan contra el mismo catálogo que ve el usuario al navegar.
  const catalog: ReleaseSummary[] = (await loadCatalogWindowSummaries()).items;

  // Plataformas únicas del catálogo (de availability.platforms), para el selector "plataformas que tengo".
  const platformSet = new Set<string>();
  for (const release of catalog) {
    for (const platform of release.availability?.platforms ?? []) {
      if (platform) {
        platformSet.add(platform);
      }
    }
  }
  const platforms = [...platformSet].sort((a, b) => a.localeCompare(b, "es"));

  // Géneros únicos del catálogo (datos reales) para el selector "mis gustos".
  const genres = collectGenres(catalog);

  return <ProfileView catalog={catalog} genres={genres} platforms={platforms} />;
}
