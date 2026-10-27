import type { Release } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// pickFields deja de un título solo los campos que una pantalla pinta, para que lo que viaja del
// servidor al navegador no sea la ficha entera (reparto, equipo, galería…) repetida en cada página.
//
// El tipo sigue siendo Release a propósito: los componentes que lo reciben no cambian. La lista de
// campos de cada llamada es un contrato con ese componente: si un día lee otro campo, hay que
// añadirlo ahí.
export function pickFields<K extends keyof Release>(release: Release, keys: readonly K[]): Release {
  const picked: Partial<Release> = { $typeName: release.$typeName };
  for (const key of keys) {
    picked[key] = release[key];
  }
  return picked as Release;
}
