import { NextResponse } from "next/server";

import { callSetup } from "@/lib/local-setup";

import { refuseLocal } from "../routes";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const refused = refuseLocal(request);
  if (refused) {
    return refused;
  }
  const result = await callSetup("/setup/activate", { method: "POST", body: "{}" });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === "down" ? 503 : 400 });
  }
  return NextResponse.json(result.body);
}
