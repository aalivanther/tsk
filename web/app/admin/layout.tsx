import type { ReactNode } from "react";

import { currentAdminDecision } from "@/lib/admin-decision";

import { AdminGateView } from "./AdminGate";

export const dynamic = "force-dynamic";

// AdminLayout cierra el panel antes de mostrar cualquier pantalla interna.
export default async function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const decision = await currentAdminDecision();
  if (decision !== "open") {
    return <AdminGateView kind={decision} />;
  }
  return children;
}
