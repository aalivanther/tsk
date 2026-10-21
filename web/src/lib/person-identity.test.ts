// Archivo: person-identity.test.ts — Pruebas de la ÚNICA respuesta a "¿es la misma persona?".
//
// Qué se defiende aquí, en español: que el número de identidad mande sobre el nombre escrito (dos
// personas que se llaman igual son dos personas), que sin número se pueda seguir comparando por el
// nombre sin que dos formas de escribirlo se separen, y que un crédito del que no se sabe nada NO se
// funda con los demás créditos vacíos formando un personaje inexistente.

import { describe, expect, it } from "vitest";

import {
  normalizePersonName,
  personIdentityKey,
  personIdentityKeySet,
  sharesAnyPerson,
} from "@/lib/person-identity";

describe("personIdentityKey", () => {
  it("dos homónimos con número distinto NO son la misma persona", () => {
    // Es el caso que rompía el producto: la ficha de un título los fundía en uno y la página de la
    // persona los separaba, así que el mismo director "conectaba" películas que no eran suyas.
    const primera = personIdentityKey({ personTmdbId: 111, name: "Ana Ruiz" });
    const segunda = personIdentityKey({ personTmdbId: 222, name: "Ana Ruiz" });

    expect(primera).not.toBe(segunda);
  });

  it("la misma persona escrita de dos maneras sí lo es, si comparten número", () => {
    const primera = personIdentityKey({ personTmdbId: 111, name: "Ana Ruiz" });
    const segunda = personIdentityKey({ personTmdbId: 111, name: "ANA  RUIZ " });

    expect(primera).toBe(segunda);
  });

  it("sin número, compara el nombre sin distinguir mayúsculas ni espacios de sobra", () => {
    expect(personIdentityKey({ name: "Lucía Arenas" })).toBe(
      personIdentityKey({ name: "  lucía arenas " }),
    );
  });

  it("un nombre con acento NO es el mismo que uno sin él", () => {
    // "Peña" y "Pena" son dos apellidos distintos: quitar la tilde para comparar fundiría a dos
    // personas reales en una.
    expect(personIdentityKey({ name: "Peña" })).not.toBe(personIdentityKey({ name: "Pena" }));
  });

  it("una clave de número nunca choca con una clave de nombre", () => {
    expect(personIdentityKey({ personTmdbId: 42, name: "" })).not.toBe(
      personIdentityKey({ name: "42" }),
    );
  });

  it("un crédito sin ningún dato no identifica a nadie", () => {
    // La cadena vacía es la señal de "descártame". Si estos créditos compartieran clave, todos los
    // créditos incompletos del catálogo se convertirían en una sola persona inventada.
    expect(personIdentityKey({ name: "   " })).toBe("");
    expect(personIdentityKey({ personTmdbId: 0, name: "" })).toBe("");
  });
});

describe("personIdentityKeySet y sharesAnyPerson", () => {
  it("deja fuera a los créditos sin ningún dato", () => {
    const claves = personIdentityKeySet([{ name: "Ana Ruiz" }, { name: "  " }]);

    expect(claves.size).toBe(1);
  });

  it("encuentra a quien coincide en las dos listas", () => {
    const izquierda = personIdentityKeySet([{ name: "Ana Ruiz" }, { name: "Marco Díaz" }]);
    const derecha = personIdentityKeySet([{ name: "marco díaz" }]);

    expect(sharesAnyPerson(izquierda, derecha)).toBe(true);
  });

  it("no inventa coincidencias entre listas sin nadie en común", () => {
    const izquierda = personIdentityKeySet([{ name: "Ana Ruiz" }]);
    const derecha = personIdentityKeySet([{ name: "Marco Díaz" }]);

    expect(sharesAnyPerson(izquierda, derecha)).toBe(false);
  });
});

describe("normalizePersonName", () => {
  it("deja el nombre listo para comparar sin destruir información", () => {
    expect(normalizePersonName("  Lucía  Arenas ")).toBe("lucía  arenas");
  });
});
