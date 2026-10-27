import Link from "next/link";

import { SagaDetail } from "@/components/SagaDetail";
import { releases } from "@/lib/connect/catalog";
import { pickFields } from "@/components/demo/pick-fields";
import { ui } from "@/lib/i18n";
import { findSagaBySlug, pickSagaHighlight, pickSagaOrigin, type SagaProfile } from "@/lib/saga";

// Se resuelve al exportar: el navegador ya no carga el catálogo entero para armar una saga.
// De cada título viaja solo lo que la página de la saga pinta (ver SagaDetail).
function slimSaga(saga: SagaProfile): SagaProfile {
  return {
    ...saga,
    owners: [],
    entries: saga.entries.map((entry) => ({
      ...entry,
      release:
        entry.release === null ? null : pickFields(entry.release, ["id", "posterUrl", "overview"]),
    })),
  };
}

export function SagaScreen({ id }: { id: string }) {
  const saga = findSagaBySlug(releases, id);

  if (saga === null) {
    return (
      <main className="sg-main font-ui">
        <Link href="/" prefetch={false} data-intent-prefetch="/" className="sg-back font-mono">
          <span aria-hidden="true">‹</span> {ui.saga.back}
        </Link>
        <h1 className="font-display text-2xl font-medium text-text">{ui.saga.notFoundTitle}</h1>
        <p className="text-sm text-text-muted">{ui.saga.notFoundHint}</p>
      </main>
    );
  }

  const highlight = pickSagaHighlight(saga);
  const origin = pickSagaOrigin(saga, "");
  return (
    <main className="sg-main font-ui">
      <Link href="/" prefetch={false} data-intent-prefetch="/" className="sg-back font-mono">
        <span aria-hidden="true">‹</span> {ui.saga.back}
      </Link>
      <SagaDetail
        saga={slimSaga(saga)}
        highlight={
          highlight === null
            ? null
            : pickFields(highlight, ["id", "title", "backdropUrl", "videos"])
        }
        origin={origin === null ? null : pickFields(origin, ["id", "title"])}
      />
    </main>
  );
}
