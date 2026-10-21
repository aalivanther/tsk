// Catálogo de la demo estática. Sustituye al cliente del servidor: lee el seed
// congelado y no abre ninguna conexión.

import { create, fromJson, type JsonValue } from "@bufbuild/protobuf";
import {
  ReleaseSchema,
  ReleaseSummarySchema,
  type Release,
  type ReleaseSummary,
} from "@/gen/mdm7mo/catalog/v1/catalog_pb";
import { sagaSlug } from "@/lib/saga";
import { catalogWindow, resolveDemoToday } from "@/lib/timeline";
import snapshot from "@/demo-catalog.json";

export type { Release, ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";
export { TitleType, Category } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// DEMO_DAY es el "hoy" congelado de esta exportación. La ventana de meses sale de aquí.
const DEMO_DAY = "2026-10-12";

const today = resolveDemoToday(DEMO_DAY);
const windowKeys = new Set(
  catalogWindow(today).map((month) => `${month.year}-${String(month.month).padStart(2, "0")}`),
);

export const releases: Release[] = (snapshot.releases as unknown[])
  .map((value) => fromJson(ReleaseSchema, value as JsonValue, { ignoreUnknownFields: true }))
  .filter((release) => windowKeys.has(release.releaseDate.slice(0, 7)));

function uniqueNames(credits: Release["cast"]): string[] {
  return [...new Set(credits.map((credit) => credit.name.trim()).filter((name) => name !== ""))];
}

function directorNames(release: Release): string[] {
  return uniqueNames(
    release.crew.filter((credit) => {
      const role = credit.role.trim().toLowerCase();
      const department = credit.department.trim().toLowerCase();
      const directs = role === "director" || role === "dirección" || role === "series director";
      return directs && (department === "" || department === "directing");
    }),
  );
}

export function summarize(release: Release): ReleaseSummary {
  return create(ReleaseSummarySchema, {
    id: release.id,
    type: release.type,
    category: release.category,
    title: release.title,
    overview: release.overview,
    releaseDate: release.releaseDate,
    posterUrl: release.posterUrl,
    backdropUrl: release.backdropUrl,
    genres: release.genres,
    ratings: release.ratings,
    availability: release.availability,
    overviewLanguage: release.overviewLanguage,
    sagaName: release.saga?.name ?? "",
    directorNames: directorNames(release),
    leadCastNames: uniqueNames(release.cast.slice(0, 10)),
  });
}

const summaries = releases.map(summarize);

function inMonth(releaseDate: string, year: number, month: number): boolean {
  return releaseDate.startsWith(`${year}-${String(month).padStart(2, "0")}`);
}

export async function listReleasesSafe(year: number, month: number) {
  return {
    summaries: summaries.filter((release) => inMonth(release.releaseDate, year, month)),
    error: null,
  };
}

export async function listReleaseDetailsSafe(year: number, month: number) {
  return {
    releases: releases.filter((release) => inMonth(release.releaseDate, year, month)),
    error: null,
  };
}

export async function getReleaseSafe(id: string) {
  const release = releases.find((item) => item.id === id) ?? null;
  return { release, summary: release === null ? null : summarize(release), error: null };
}

export async function loadCatalogWindowSummaries() {
  return { items: summaries, monthCount: windowKeys.size, failedMonthCount: 0 };
}

export async function loadCatalogWindowDetails() {
  return { items: releases, monthCount: windowKeys.size, failedMonthCount: 0 };
}

export function staticTitleParams(): { id: string }[] {
  return releases.map((release) => ({ id: release.id }));
}

export function staticPersonParams(): { id: string }[] {
  const ids = new Set<number>();
  for (const release of releases) {
    for (const credit of [...release.cast, ...release.crew]) {
      if (credit.personTmdbId > 0) {
        ids.add(credit.personTmdbId);
      }
    }
  }
  return [...ids].map((id) => ({ id: String(id) }));
}

export function staticSagaParams(): { id: string }[] {
  const slugs = new Set<string>();
  for (const release of releases) {
    const name = release.saga?.name ?? "";
    if (name !== "") {
      slugs.add(sagaSlug(name));
    }
  }
  return [...slugs].map((id) => ({ id }));
}
