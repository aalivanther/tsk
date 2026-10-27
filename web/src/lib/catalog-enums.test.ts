import { describe, expect, it } from "vitest";

import { Category, TitleType } from "@/lib/catalog-enums";
import {
  Category as GeneratedCategory,
  TitleType as GeneratedTitleType,
} from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// Los valores copiados tienen que ser EXACTAMENTE los del contrato generado, nombre por nombre.
function numericMembers(generated: Record<string, string | number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(generated).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

describe("catalog-enums", () => {
  it("TitleType coincide con el contrato", () => {
    expect({ ...TitleType }).toEqual(numericMembers(GeneratedTitleType));
  });

  it("Category coincide con el contrato", () => {
    expect({ ...Category }).toEqual(numericMembers(GeneratedCategory));
  });
});
