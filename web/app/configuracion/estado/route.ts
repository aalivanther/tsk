import { NextResponse } from "next/server";

import { loadSetupStatus } from "@/lib/local-setup";

import { refuseLocal } from "../routes";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const refused = refuseLocal(request);
  if (refused) {
    return refused;
  }
  return NextResponse.json(await loadSetupStatus());
}
