import { cookies, headers } from "next/headers";

import { ADMIN_COOKIE, decideAdmin, readSettings, type AdminDecision } from "@/lib/local-setup";

// currentAdminDecision junta la contraseña del entorno, la del archivo local y
// lo que presentó esta visita. La página de admin la consulta antes de pedir el catálogo.
export async function currentAdminDecision(): Promise<AdminDecision> {
  const headerStore = await headers();
  const cookieStore = await cookies();
  return decideAdmin({
    envKey: process.env.ADMIN_ACCESS_KEY ?? "",
    fileKey: readSettings().adminAccessKey ?? "",
    authorization: headerStore.get("authorization") ?? "",
    cookie: cookieStore.get(ADMIN_COOKIE)?.value ?? "",
  });
}
