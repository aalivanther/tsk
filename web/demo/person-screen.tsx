import Link from "next/link";

import { PersonDetail } from "@/components/PersonDetail";
import { releases } from "@/lib/connect/catalog";
import { pickFields } from "@/components/demo/pick-fields";
import { ui } from "@/lib/i18n";
import {
  collaboratorsOf,
  findPersonInCatalog,
  pickHighlightRelease,
  type PersonProfile,
} from "@/lib/people";

// Se resuelve al exportar: el navegador ya no carga el catálogo entero para buscar a una persona.
// De cada título viaja solo lo que la ficha de la persona pinta (ver PersonDetail).
function slimPerson(person: PersonProfile): PersonProfile {
  return {
    ...person,
    credits: person.credits.map((credit) => ({
      ...credit,
      release: pickFields(credit.release, ["id", "title", "posterUrl", "backdropUrl"]),
    })),
  };
}

export function PersonScreen({ id }: { id: string }) {
  const personId = Number.parseInt(id, 10);
  const person =
    Number.isSafeInteger(personId) && personId > 0 ? findPersonInCatalog(releases, personId) : null;

  if (person === null) {
    return (
      <main className="pd-main font-ui">
        <Link href="/" prefetch={false} data-intent-prefetch="/" className="pd-back font-mono">
          <span aria-hidden="true">‹</span> {ui.person.back}
        </Link>
        <h1 className="font-display text-2xl font-medium text-text">{ui.person.notFoundTitle}</h1>
        <p className="text-sm text-text-muted">{ui.person.notFoundHint}</p>
      </main>
    );
  }

  const highlight = pickHighlightRelease(person);
  return (
    <main className="pd-main font-ui">
      <Link href="/" prefetch={false} data-intent-prefetch="/" className="pd-back font-mono">
        <span aria-hidden="true">‹</span> {ui.person.back}
      </Link>
      <PersonDetail
        person={slimPerson(person)}
        collaborators={collaboratorsOf(releases, person)}
        highlight={
          highlight === null
            ? null
            : pickFields(highlight, ["id", "title", "backdropUrl", "videos"])
        }
      />
    </main>
  );
}
