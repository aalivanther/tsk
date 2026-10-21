import { NextResponse } from "next/server";

import { localRefusal } from "@/lib/local-setup";

// refuseLocal cierra la ruta si la visita no es de esta computadora o si un
// formulario de otro sitio intenta escribir.
export function refuseLocal(request: Request): NextResponse | null {
  if (localRefusal(request) !== null) {
    return NextResponse.json({ error: "localhost" }, { status: 403 });
  }
  return null;
}
