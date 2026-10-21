import { NextResponse } from "next/server";

import { callSetup } from "@/lib/local-setup";

import { refuseLocal } from "../routes";

export const dynamic = "force-dynamic";

const fields = ["tmdbReadToken", "omdbApiKey", "adminAccessKey", "metricsAccessKey"] as const;

export async function POST(request: Request): Promise<NextResponse> {
  const refused = refuseLocal(request);
  if (refused) {
    return refused;
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (typeof payload !== "object" || payload === null) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const body: Record<string, string> = {};
  const record = payload as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string") {
      body[field] = value;
    }
  }
  const result = await callSetup("/setup/settings", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === "down" ? 503 : 400 });
  }
  return NextResponse.json(result.body);
}
