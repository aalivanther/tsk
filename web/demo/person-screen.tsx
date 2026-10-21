"use client";

import Link from "next/link";

import { PersonDetail } from "@/components/PersonDetail";
import { releases } from "@/lib/connect/catalog";
import { ui } from "@/lib/i18n";
import { collaboratorsOf, findPersonInCatalog, pickHighlightRelease } from "@/lib/people";

export function PersonScreen({ id }: { id: string }) {
  const personId = Number.parseInt(id, 10);
  const person =
    Number.isSafeInteger(personId) && personId > 0 ? findPersonInCatalog(releases, personId) : null;

  if (person === null) {
    return (
      <main className="pd-main font-ui">
        <Link href="/" className="pd-back font-mono">
          <span aria-hidden="true">‹</span> {ui.person.back}
        </Link>
        <h1 className="font-display text-2xl font-medium text-text">{ui.person.notFoundTitle}</h1>
        <p className="text-sm text-text-muted">{ui.person.notFoundHint}</p>
      </main>
    );
  }

  return (
    <main className="pd-main font-ui">
      <Link href="/" className="pd-back font-mono">
        <span aria-hidden="true">‹</span> {ui.person.back}
      </Link>
      <PersonDetail
        person={person}
        collaborators={collaboratorsOf(releases, person)}
        highlight={pickHighlightRelease(person)}
      />
    </main>
  );
}
