"use client";

import { useEffect, useRef, useState } from "react";

import { ReleaseDetail } from "@/components/ReleaseDetail";
import type { Release, ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";
import type { Connection, TodayMarker } from "@/lib/timeline";

type TitleDetailClientProps = {
  release: Release;
  related: Connection[];
  upcoming: boolean;
  today: TodayMarker;
  // reachable son los resúmenes a los que se puede saltar desde esta ficha sin el catálogo completo.
  reachable: ReleaseSummary[];
};

const SUMMARIES_URL = `${process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? ""}/demo/summaries.json`;
// Las tarjetas que abren el modal de otro título. El modal calcula SUS conexiones con el catálogo, así
// que no se abre hasta tenerlo completo: abrirlo antes enseñaría unas conexiones a medias.
const OPENS_MODAL = ".rf-conn-item, .rf-saga-card";

let summariesRequest: Promise<ReleaseSummary[]> | null = null;
function loadSummaries(): Promise<ReleaseSummary[]> {
  if (summariesRequest === null) {
    summariesRequest = fetch(SUMMARIES_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`summaries ${response.status}`);
        }
        return response.json() as Promise<ReleaseSummary[]>;
      })
      .catch((error: unknown) => {
        summariesRequest = null;
        throw error;
      });
  }
  return summariesRequest;
}

// La ficha de un título en la demo. El catálogo completo solo hace falta al abrir el modal de otro
// título, así que se pide cuando el navegador queda libre (o en cuanto la persona toca la pantalla)
// en vez de viajar dentro del JavaScript de la página. Si alguien pulsa una tarjeta antes de que
// llegue, el clic espera al catálogo y se repite entonces: el modal se abre igual que siempre.
export function TitleDetailClient({ reachable, ...props }: TitleDetailClientProps) {
  const [catalog, setCatalog] = useState<ReleaseSummary[] | null>(null);
  // pendingClick es la tarjeta pulsada antes de que llegara el catálogo.
  const pendingClick = useRef<HTMLElement | null>(null);

  // Con el catálogo ya puesto (después de pintarlo), el clic que esperaba se repite tal cual.
  useEffect(() => {
    const target = pendingClick.current;
    if (catalog === null || target === null) {
      return;
    }
    pendingClick.current = null;
    if (target.isConnected) {
      target.click();
    }
  }, [catalog]);

  useEffect(() => {
    if (catalog !== null) {
      return;
    }
    let cancelled = false;
    const load = () => {
      loadSummaries()
        .then((list) => {
          if (!cancelled) {
            setCatalog(list);
          }
        })
        .catch(() => {});
    };
    const holdClick = (event: MouseEvent) => {
      const opener =
        event.target instanceof Element ? event.target.closest<HTMLElement>(OPENS_MODAL) : null;
      if (opener === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      pendingClick.current = opener;
      load();
    };
    const hasIdle = typeof window.requestIdleCallback === "function";
    const handle = hasIdle
      ? window.requestIdleCallback(load, { timeout: 3000 })
      : window.setTimeout(load, 1);
    document.addEventListener("pointerdown", load, { capture: true, once: true });
    document.addEventListener("click", holdClick, { capture: true });
    return () => {
      cancelled = true;
      if (hasIdle) {
        window.cancelIdleCallback(handle);
      } else {
        window.clearTimeout(handle);
      }
      document.removeEventListener("pointerdown", load, { capture: true });
      document.removeEventListener("click", holdClick, { capture: true });
    };
  }, [catalog]);

  return <ReleaseDetail {...props} catalog={catalog ?? reachable} isPageHeading />;
}
