import { BackToHomeLink } from "@/components/BackToHomeLink";
import { DetailAmbient } from "@/components/DetailAmbient";
import { TitleDetailClient } from "@/components/demo/TitleDetailClient";
import { releases, summarize } from "@/lib/connect/catalog";
import { ui } from "@/lib/i18n";
import { resolveCollectionItem } from "@/lib/saga";
import { findConnections, isUpcoming, resolveDemoToday } from "@/lib/timeline";

const today = resolveDemoToday("2026-10-12");
const summaries = releases.map(summarize);

// La ficha se resuelve aquí, al exportar, y no en el navegador. Antes esta pantalla era de cliente e
// importaba el catálogo entero (2,3 MB de JavaScript) para buscar un solo título. Ahora el navegador
// recibe el título ya resuelto y, del catálogo, solo los resúmenes a los que se puede saltar desde la
// propia página: sus conexiones y las entradas de su saga que existen aquí. El resto llega después,
// sin bloquear nada (ver TitleDetailClient).
export function TitleScreen({ id }: { id: string }) {
  const release = releases.find((item) => item.id === id) ?? null;

  if (release === null) {
    return (
      <main className="td-main font-ui mx-auto flex max-w-[680px] flex-col justify-center gap-5 px-6 py-16">
        <BackToHomeLink />
        <h1 className="font-display text-2xl font-medium text-text">{ui.detail.notFoundTitle}</h1>
        <p className="text-sm text-text-muted">{ui.detail.notFoundHint}</p>
      </main>
    );
  }

  const summary = summarize(release);
  const related = findConnections(summary, summaries);
  const reachable = new Set(related.map((connection) => connection.release.id));
  for (const item of release.saga?.items ?? []) {
    const match = resolveCollectionItem(item, summaries);
    if (match !== null) {
      reachable.add(match.id);
    }
  }
  // Mismo orden que el catálogo completo: resolveCollectionItem se queda con la primera coincidencia.
  const reachableSummaries = summaries.filter((item) => reachable.has(item.id));

  return (
    <>
      {release.backdropUrl !== "" ? <DetailAmbient backdropUrl={release.backdropUrl} /> : null}
      <main className="td-main font-ui relative z-[1] mx-auto flex max-w-[620px] flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16">
        <BackToHomeLink />
        <TitleDetailClient
          release={release}
          related={related}
          upcoming={isUpcoming(summary, today)}
          today={today}
          reachable={reachableSummaries}
        />
      </main>
    </>
  );
}
