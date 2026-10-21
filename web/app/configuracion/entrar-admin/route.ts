import { NextResponse } from "next/server";

import { ADMIN_COOKIE, adminCookieValue, decideAdmin, readSettings } from "@/lib/local-setup";

import { refuseLocal } from "../routes";

export const dynamic = "force-dynamic";

const maxPasswordLength = 4096;

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
  const password =
    typeof payload === "object" && payload !== null && typeof (payload as { password?: unknown }).password === "string"
      ? (payload as { password: string }).password
      : "";
  if (password.length === 0 || password.length > maxPasswordLength) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const envKey = process.env.ADMIN_ACCESS_KEY ?? "";
  const fileKey = readSettings().adminAccessKey ?? "";
  const key = envKey.trim() || fileKey.trim();
  const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  if (decideAdmin({ envKey, fileKey, authorization, cookie: "" }) !== "open") {
    return NextResponse.json({ error: "denied" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, adminCookieValue(key), {
    httpOnly: true,
    sameSite: "strict",
    path: "/admin",
    maxAge: 60 * 60 * 12,
    secure: (process.env.SITE_URL ?? "").startsWith("https://"),
  });
  return response;
}
