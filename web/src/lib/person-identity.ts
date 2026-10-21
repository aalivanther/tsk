// Archivo: person-identity.ts — CUÁNDO dos créditos son la misma persona. Una sola respuesta.
//
// QUÉ PROBLEMA RESUELVE, en español:
//
// El producto responde dos veces a la misma pregunta —"¿esto lo hace la misma persona?"— y lo hacía
// de dos formas distintas. La ficha de un título, para decir "mismo director", comparaba el NOMBRE
// ESCRITO. La página de una persona, para reunir su trabajo, comparaba el NÚMERO DE IDENTIDAD. Con
// dos criterios, dos personas que se llaman igual se comportan de forma distinta según por dónde
// entres: la ficha las funde en una y la página de la persona las separa. Ninguna de las dos falla;
// simplemente se contradicen, que es peor, porque nadie se entera.
//
// Aquí vive LA respuesta, una sola vez, y las dos pantallas la usan.
//
// LA REGLA, en dos escalones:
//
//   1. Si se conoce el NÚMERO DE IDENTIDAD de la persona, manda ese número. Es un hecho: dos créditos
//      con el mismo número son la misma persona, se escriba su nombre como se escriba, y dos números
//      distintos son dos personas aunque se llamen exactamente igual.
//   2. Si NO se conoce, se compara el nombre escrito, normalizado. Es un apaño y se declara como tal:
//      dos homónimos se funden en uno y una misma persona escrita de dos maneras se parte en dos. Es
//      lo único que se puede hacer cuando el dato de identidad no existe, y es mejor que no comparar.
//
// FRONTERA DE ALCANCE DECLARADA, porque este archivo no la puede cruzar solo:
//
// Hoy el escalón 2 sigue usándose en la ficha de un título, y no por descuido. La ficha compara ese
// título contra el catálogo entero, y del catálogo se piden RESÚMENES —la forma ligera, que es lo que
// hizo que la portada dejara de pesar 3,6 MB—. El resumen trae los NOMBRES de quien dirige y del
// reparto principal, pero NO sus números de identidad: el contrato de datos (proto) no los incluye en
// esa forma ligera, solo dentro de la ficha completa. Para que la ficha compare por número harían
// falta dos cambios que están fuera de este trabajo: añadir los identificadores al resumen en el
// contrato y rellenarlos en el servidor. Mientras eso no ocurra, la ficha usa el escalón 2 y la
// página de una persona el escalón 1, pero los dos escalones son de la MISMA regla y viven aquí: el
// día que el resumen traiga los números, cambia una línea y las dos pantallas quedan alineadas solas.

// PersonIdentity es lo que se sabe de una persona en un crédito, a efectos de compararla.
export type PersonIdentity = {
  // personTmdbId es su número de identidad. Vale 0 (o falta) cuando el dato no viaja en esa forma.
  personTmdbId?: number;
  // name es su nombre tal y como está escrito en el crédito.
  name: string;
};

// ID_KEY_PREFIX y NAME_KEY_PREFIX distinguen los dos escalones dentro de la misma clave.
//
// Por qué llevan prefijo, en español: sin él, una persona identificada por el número 42 y otra
// llamada literalmente "42" producirían la misma clave y el producto las trataría como la misma. Con
// el prefijo, una clave de número y una de nombre nunca pueden coincidir por accidente.
const ID_KEY_PREFIX = "id:";
const NAME_KEY_PREFIX = "name:";

// normalizePersonName deja un nombre en la forma con la que se compara con otro.
//
// En español: sin espacios de sobra y sin mayúsculas, de modo que "Lucía Arenas" y "lucía arenas "
// cuenten como la misma persona. NO se le quitan los acentos a propósito: "Peña" y "Pena" son dos
// apellidos distintos, y borrar la tilde fundiría a dos personas de verdad diferentes.
export function normalizePersonName(name: string): string {
  return name.trim().toLowerCase();
}

// personIdentityKey devuelve la clave con la que se decide si dos créditos son la misma persona.
//
// Dos créditos son la misma persona exactamente cuando esta función les devuelve la misma clave. La
// cadena vacía significa "no hay nada con qué identificar a esta persona" y quien la reciba debe
// descartarla: dos personas sin ningún dato NO son la misma, y tratarlas como tal juntaría a todos
// los créditos incompletos del catálogo en un único personaje inexistente.
export function personIdentityKey(person: PersonIdentity): string {
  const tmdbId = person.personTmdbId ?? 0;
  if (tmdbId > 0) {
    return `${ID_KEY_PREFIX}${tmdbId}`;
  }
  const name = normalizePersonName(person.name);
  return name === "" ? "" : `${NAME_KEY_PREFIX}${name}`;
}

// personIdentityKeySet convierte una lista de personas en el conjunto de sus claves de identidad.
// En español: es lo que permite preguntar "¿estas dos obras comparten a alguien?" de un vistazo, sin
// recorrer una lista dentro de la otra. Los créditos sin ningún dato se quedan fuera (ver arriba).
export function personIdentityKeySet(people: readonly PersonIdentity[]): Set<string> {
  const keys = new Set<string>();
  for (const person of people) {
    const key = personIdentityKey(person);
    if (key !== "") {
      keys.add(key);
    }
  }
  return keys;
}

// sharesAnyPerson dice si dos conjuntos de claves de identidad tienen a alguien en común.
export function sharesAnyPerson(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const key of right) {
    if (left.has(key)) {
      return true;
    }
  }
  return false;
}
