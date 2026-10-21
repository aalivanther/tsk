// Archivo: app/sitemap.ts — El MAPA DEL SITIO (/sitemap.xml) para los buscadores.
//
// En español: un mapa del sitio es la lista de direcciones que el sitio quiere que los buscadores
// conozcan. Sin él, un buscador solo encuentra lo que esté enlazado desde la portada y puede tardar
// mucho en descubrir las fichas de cada título; con él, las conoce todas de golpe.
//
// El mapa se arma con datos REALES del catálogo: se piden los estrenos de la ventana de meses vigente
// (la misma que muestra la línea de tiempo) y se lista la ficha de cada uno. Las llamadas van por el
// helper seguro listReleasesSafe, que NUNCA lanza: si el backend no responde (por ejemplo durante la
// compilación), devuelve una lista vacía y el mapa sale solo con las páginas fijas, en vez de romper
// la generación del sitio. Nunca se inventan direcciones de títulos que no existen.

import type { MetadataRoute } from "next";

import { listReleasesSafe } from "@/lib/connect/catalog";
import { catalogWindow, resolveDemoToday } from "@/lib/timeline";
import { siteUrl } from "@/lib/site-url";

// dynamic = "force-dynamic": el mapa se arma EN CADA PETICIÓN, no al compilar. Así `next build` no
// necesita el backend levantado y, en ejecución, el mapa refleja el catálogo vigente de ese momento.
export const dynamic = "force-dynamic";

// sitemap devuelve la lista de direcciones del sitio con su fecha de última modificación.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  // lastModified marca "cuándo cambió esto por última vez". Como el catálogo se refresca de continuo,
  // usamos el momento de generación: es la información honesta de que el contenido es de ahora mismo.
  const generatedAt = new Date();

  // Páginas FIJAS del sitio, con la prioridad relativa que tienen entre sí (la portada es la más
  // importante; el aviso de privacidad existe pero no compite por atención).
  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      lastModified: generatedAt,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${base}/privacidad`,
      lastModified: generatedAt,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  // Fichas de los títulos del catálogo. Se piden los meses de la ventana vigente en paralelo (son
  // consultas independientes) y se combinan los resultados que hayan llegado.
  const today = resolveDemoToday(process.env.DEMO_TODAY);
  const monthResults = await Promise.all(
    catalogWindow(today).map((month) => listReleasesSafe(month.year, month.month)),
  );
  const releases = monthResults.flatMap((result) => result.summaries);

  // Un mismo título puede aparecer en varios meses de la ventana (por ejemplo, una serie con
  // entregas repartidas). El conjunto de ids evita listar dos veces la misma dirección.
  const seenIds = new Set<string>();
  const releaseEntries: MetadataRoute.Sitemap = [];
  for (const release of releases) {
    if (release.id === "" || seenIds.has(release.id)) {
      continue;
    }
    seenIds.add(release.id);
    releaseEntries.push({
      url: `${base}/titulo/${release.id}`,
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  return [...staticEntries, ...releaseEntries];
}
