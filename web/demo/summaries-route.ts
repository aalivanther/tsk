import { releases, summarize } from "@/lib/connect/catalog";

export const dynamic = "force-static";

// Los resúmenes del catálogo como archivo estático aparte: la ficha de un título los pide cuando el
// navegador queda libre, en vez de llevarlos dentro de su JavaScript.
export function GET() {
  return Response.json(releases.map(summarize));
}
