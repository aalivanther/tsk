// Archivo: people.ts — Todo lo que se sabe de UNA PERSONA dentro de este catálogo.
//
// Qué problema resuelve, en español:
//
// En la ficha de una película, el nombre de un actor era texto muerto. No se podía pulsar, no llevaba
// a ningún sitio y el camino se acababa ahí. Este archivo es lo que hace posible la página de una
// persona: dado su número de identidad, recorre el catálogo y reúne en qué títulos aparece, con qué
// papel en cada uno y con quién se cruza más de una vez.
//
// EL DETALLE QUE HACE QUE ESTO SEA FIABLE, y que hasta hace poco no existía:
//
// Cada crédito trae ahora el NÚMERO DE IDENTIDAD de la persona en TMDB. Antes solo venía el nombre
// escrito, y con eso la identidad se rompe de dos formas opuestas: dos personas distintas que se
// llaman igual se funden en una (y la página enseña películas que no son suyas), y una misma persona
// escrita de dos maneras se parte en dos (y se pierde la mitad de su trabajo). Con el número, "es la
// misma persona" deja de ser una coincidencia de letras y pasa a ser un hecho.
//
// LA FRONTERA DE ESTA PÁGINA, declarada y no escondida: aquí solo aparece el trabajo de la persona
// DENTRO de la ventana de meses que cubre el producto. Su filmografía completa exigiría una operación
// nueva del servidor que hoy no existe, así que la página lo dice con todas las letras y enlaza a
// TMDB. Es preferible a dejar que alguien crea que estos son todos los trabajos de esa persona.

import { personIdentityKey } from "@/lib/person-identity";
import { type Credit, type Release } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// MIN_SHARED_TITLES_FOR_COLLABORATOR es cuántos títulos hay que compartir para salir como colaborador.
//
// Dos. Con uno solo, la lista sería "toda la gente que salía en la misma película", que no dice nada:
// evidentemente comparten un título, es el mismo reparto. Lo que sí dice algo es coincidir DOS veces,
// porque eso ya no es casualidad del reparto de una película concreta.
const MIN_SHARED_TITLES_FOR_COLLABORATOR = 2;

// MAX_COLLABORATORS es cuántos colaboradores se enseñan como mucho.
// En español: doce caben en una rejilla sin que la sección se coma la página. Van ordenados por
// cuántas veces coinciden, así que los doce primeros son justamente los que más significan.
const MAX_COLLABORATORS = 12;

// PersonCredit es la participación de la persona EN UN TÍTULO, con todo lo que hace en él.
//
// UN TÍTULO, UNA ENTRADA, y esto es una corrección de algo que se vio mal en pantalla: en el catálogo
// hay quien firma ocho oficios distintos de la misma película —dirección, guion, montaje, sonido,
// fotografía…—. Con una entrada por oficio, la página enseñaba ocho tarjetas de la MISMA película y
// el encabezado decía "8 títulos en el catálogo" cuando en realidad era uno. Eso no es un problema de
// presentación: es la página afirmando algo falso. Agrupando por título, dice ocho oficios en una
// película, que es lo que ocurre.
export type PersonCredit = {
  // release es el estreno del catálogo en el que participa.
  release: Release;
  // roles son sus papeles y oficios en ESE título, sin repetir y en el orden en que vienen: el
  // personaje si actúa ("Margarita"), el oficio si es del equipo ("Director"). Puede quedar vacío
  // —hay créditos sin papel anotado— y entonces no se enseña nada, en vez de inventar.
  roles: string[];
  // departments son sus áreas en ese título según TMDB, en inglés ("Acting", "Directing"…), sin
  // repetir. La interfaz las traduce y las usa como respaldo cuando no hay ningún papel anotado.
  departments: string[];
  // inCast distingue si aparece como reparto o como equipo técnico en ESE título. La misma persona
  // puede ser las dos cosas en la misma obra (dirige y actúa), y eso hay que poder decirlo.
  inCast: boolean;
  // episodeCount es en cuántos episodios participa; solo tiene sentido en series. Vale 0 si no aplica.
  episodeCount: number;
};

// PersonProfile es la ficha de una persona armada a partir del catálogo.
export type PersonProfile = {
  // personTmdbId es su número de identidad en TMDB: lo que la identifica sin ambigüedad.
  personTmdbId: number;
  // name es su nombre tal y como aparece en los créditos.
  name: string;
  // photoUrl es su foto, si el catálogo trae alguna en cualquiera de sus créditos. Puede venir vacía.
  photoUrl: string;
  // departments son sus áreas de trabajo dentro de este catálogo, de la más frecuente a la menos.
  departments: string[];
  // credits son sus participaciones, ordenadas por fecha de estreno (lo más reciente primero).
  credits: PersonCredit[];
};

// Collaborator es alguien con quien esta persona coincide en más de un título del catálogo.
export type Collaborator = {
  personTmdbId: number;
  name: string;
  photoUrl: string;
  // sharedTitles es en cuántos títulos coinciden. Es lo que ordena la lista y lo que se enseña.
  sharedTitles: number;
};

// creditsOf devuelve los créditos de un estreno junto con si eran reparto o equipo.
// En español: reparto y equipo viven en dos listas separadas, y casi todo lo que hace este archivo
// necesita recorrer las dos a la vez sin perder de vista de cuál venía cada persona.
function creditsOf(release: Release): { credit: Credit; inCast: boolean }[] {
  const all: { credit: Credit; inCast: boolean }[] = [];
  for (const credit of release.cast) {
    all.push({ credit, inCast: true });
  }
  for (const credit of release.crew) {
    all.push({ credit, inCast: false });
  }
  return all;
}

// findPersonInCatalog arma la ficha de una persona buscándola por su número de identidad.
//
// En español: recorre el catálogo entero una sola vez. Si esa persona no aparece en ningún título,
// devuelve null y la página enseña su estado de "no encontrada" — que es un desenlace normal, porque
// el catálogo solo cubre unos meses y alguien puede llegar por un enlace viejo.
//
// El nombre y la foto se toman del PRIMER crédito que los traiga. Puede que TMDB no tenga foto suya
// en un título y sí en otro, así que se recorren todos antes de rendirse: enseñar unas iniciales
// teniendo la foto a mano sería un descuido.
export function findPersonInCatalog(
  catalog: readonly Release[],
  personTmdbId: number,
): PersonProfile | null {
  if (personTmdbId <= 0) {
    return null;
  }

  // La clave de identidad de la persona buscada, con la misma regla que usa todo el producto.
  const wantedKey = personIdentityKey({ personTmdbId, name: "" });

  let name = "";
  let photoUrl = "";
  // creditsByRelease junta en una sola entrada todo lo que la persona hace en cada título, sin repetir
  // el título por cada oficio que firme (ver PersonCredit).
  const creditsByRelease = new Map<string, PersonCredit>();
  // departmentCounts cuenta en cuántos TÍTULOS hace cada cosa, para saber cuál es su área principal.
  // Se cuenta por título y no por crédito: quien firma seis oficios de una misma película no debería
  // parecer, por eso, seis veces más "de sonido" que alguien que hace sonido en seis películas.
  const departmentCounts = new Map<string, number>();

  for (const release of catalog) {
    for (const { credit, inCast } of creditsOf(release)) {
      // "Es la misma persona" lo decide lib/person-identity, que es donde vive esa regla para todo el
      // producto. Aquí siempre resuelve por NÚMERO DE IDENTIDAD, porque la ficha completa —que es de
      // donde salen estos créditos— sí lo trae. Se usa la función compartida igualmente para que el
      // día que cambie el criterio no haya una copia suelta aquí que se quede con el viejo.
      if (personIdentityKey(credit) !== wantedKey) {
        continue;
      }
      if (name === "" && credit.name.trim() !== "") {
        name = credit.name.trim();
      }
      if (photoUrl === "" && credit.photoUrl !== "") {
        photoUrl = credit.photoUrl;
      }

      let entry = creditsByRelease.get(release.id);
      if (entry === undefined) {
        entry = { release, roles: [], departments: [], inCast: false, episodeCount: 0 };
        creditsByRelease.set(release.id, entry);
      }
      const role = credit.role.trim();
      if (role !== "" && !entry.roles.includes(role)) {
        entry.roles.push(role);
      }
      if (credit.department !== "" && !entry.departments.includes(credit.department)) {
        entry.departments.push(credit.department);
        departmentCounts.set(credit.department, (departmentCounts.get(credit.department) ?? 0) + 1);
      }
      // Aparecer como reparto en cualquiera de sus créditos de ese título basta para que lo sea.
      entry.inCast = entry.inCast || inCast;
      // De todos sus créditos en ese título se conserva el mayor número de episodios: es el que
      // describe de verdad cuánto sale.
      entry.episodeCount = Math.max(entry.episodeCount, credit.episodeCount);
    }
  }

  const credits = [...creditsByRelease.values()];
  if (credits.length === 0) {
    return null;
  }

  // Lo más reciente primero: es lo que alguien espera al abrir la ficha de una persona. Las fechas
  // son texto "AAAA-MM-DD", que ordena igual que el calendario sin husos horarios de por medio.
  credits.sort((left, right) => right.release.releaseDate.localeCompare(left.release.releaseDate));

  const departments = [...departmentCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([department]) => department);

  return { personTmdbId, name, photoUrl, departments, credits };
}

// collaboratorsOf busca con quién coincide esta persona más de una vez dentro del catálogo.
//
// Por qué esta sección existe, en español: es lo que hace que la red se sienta viva. Ver que dos
// nombres se repiten juntos en tres de tus títulos cuenta una historia —un equipo que trabaja unido—
// que ninguna ficha suelta cuenta. Y es un dato REAL, contado sobre el catálogo, no una recomendación
// inventada.
//
// Lo que NO afirma, y por eso la interfaz lo aclara: que coincidan aquí no significa que trabajen
// juntos habitualmente en la vida real. Significa exactamente lo que dice: que en esta ventana de
// meses aparecen juntos varias veces.
export function collaboratorsOf(
  catalog: readonly Release[],
  person: PersonProfile,
): Collaborator[] {
  // Los títulos donde aparece esta persona; el resto del catálogo no interesa.
  const ownReleaseIds = new Set(person.credits.map((credit) => credit.release.id));

  // Para cada otra persona, en cuántos de esos títulos coincide.
  const sharedByPerson = new Map<
    number,
    { name: string; photoUrl: string; releases: Set<string> }
  >();

  for (const release of catalog) {
    if (!ownReleaseIds.has(release.id)) {
      continue;
    }
    for (const { credit } of creditsOf(release)) {
      if (credit.personTmdbId <= 0 || credit.personTmdbId === person.personTmdbId) {
        continue;
      }
      const entry = sharedByPerson.get(credit.personTmdbId);
      if (entry === undefined) {
        sharedByPerson.set(credit.personTmdbId, {
          name: credit.name.trim(),
          photoUrl: credit.photoUrl,
          releases: new Set([release.id]),
        });
        continue;
      }
      entry.releases.add(release.id);
      // La foto puede faltar en un título y estar en otro: se aprovecha la primera que aparezca.
      if (entry.photoUrl === "" && credit.photoUrl !== "") {
        entry.photoUrl = credit.photoUrl;
      }
    }
  }

  return [...sharedByPerson.entries()]
    .filter(([, entry]) => entry.releases.size >= MIN_SHARED_TITLES_FOR_COLLABORATOR)
    .map(([personTmdbId, entry]) => ({
      personTmdbId,
      name: entry.name,
      photoUrl: entry.photoUrl,
      sharedTitles: entry.releases.size,
    }))
    .sort((left, right) =>
      right.sharedTitles !== left.sharedTitles
        ? right.sharedTitles - left.sharedTitles
        : left.name.localeCompare(right.name, "es-MX"),
    )
    .slice(0, MAX_COLLABORATORS);
}

// TMDB_PERSON_BASE es la dirección pública de la ficha de una persona en TMDB.
// En español: no lleva ninguna clave ni credencial; es la misma página que vería cualquiera. Se usa
// para el enlace honesto de "aquí solo está su trabajo de estos meses; el resto vive allí".
const TMDB_PERSON_BASE = "https://www.themoviedb.org/person/";

// tmdbPersonUrl arma el enlace a la ficha de una persona en TMDB.
export function tmdbPersonUrl(personTmdbId: number): string {
  return `${TMDB_PERSON_BASE}${personTmdbId}`;
}

// pickHighlightRelease elige de qué título de la persona se enseña el tráiler en su página.
//
// Por qué hace falta elegir, en español: una persona no tiene tráiler propio. Lo que se puede enseñar
// es el de alguno de sus títulos, y entonces hay que decidir cuál — y decirlo claramente en pantalla,
// para que nadie crea que está viendo un video "de esa persona".
//
// Se elige el de mejor calificación de TMDB entre los que TIENEN algún video utilizable. Es la
// elección menos arbitraria posible: el título por el que más probablemente esa persona sea conocida
// dentro de lo que este catálogo cubre. Si ninguno tiene video, devuelve null y la página no dibuja
// la sección, en vez de dejar un recuadro anunciando algo que no existe.
export function pickHighlightRelease(person: PersonProfile): Release | null {
  let best: Release | null = null;
  let bestScore = -1;
  for (const credit of person.credits) {
    if (credit.release.videos.length === 0) {
      continue;
    }
    const score = credit.release.ratings?.tmdb ?? 0;
    if (score > bestScore) {
      best = credit.release;
      bestScore = score;
    }
  }
  return best;
}
