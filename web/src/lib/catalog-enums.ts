// Archivo: catalog-enums.ts — Los valores de los enums del catálogo, sin el código generado detrás.
//
// En español: el código generado (catalog_pb.ts) declara TitleType y Category junto con la
// descripción binaria de todo el contrato, y esa descripción arrastra el motor de protobuf entero
// (~30 KB comprimidos) a cualquier página que solo quería comparar un número. La línea de tiempo,
// el buscador o la saga no decodifican nada: solo preguntan "¿es una serie?". Para eso basta con los
// números, y viven aquí.
//
// Los TIPOS siguen siendo los generados (import type no carga nada): así un valor de aquí y el campo
// `type` de un Release son el mismo tipo para TypeScript. catalog-enums.test.ts comprueba que cada
// número coincide con el del contrato, para que un cambio en el .proto no los desincronice en silencio.

import type {
  Category as CategoryEnum,
  TitleType as TitleTypeEnum,
} from "@/gen/mdm7mo/catalog/v1/catalog_pb";

export type TitleType = TitleTypeEnum;
export const TitleType = {
  TITLE_TYPE_UNSPECIFIED: 0 as TitleTypeEnum.TITLE_TYPE_UNSPECIFIED,
  MOVIE: 1 as TitleTypeEnum.MOVIE,
  SERIES: 2 as TitleTypeEnum.SERIES,
} as const;

export type Category = CategoryEnum;
export const Category = {
  CATEGORY_UNSPECIFIED: 0 as CategoryEnum.CATEGORY_UNSPECIFIED,
  CINE: 1 as CategoryEnum.CINE,
  STREAMING: 2 as CategoryEnum.STREAMING,
  TV: 3 as CategoryEnum.TV,
  INDIE: 4 as CategoryEnum.INDIE,
} as const;
