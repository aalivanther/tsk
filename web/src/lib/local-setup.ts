// Lectura del archivo de ajustes locales y las comprobaciones que no necesitan
// el ciclo de una petición de Next. La página y las rutas lo usan en el servidor.

import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { emptySetupStatus, SETUP_HEADER, type SetupStatus } from "@/lib/setup-status";

export { SETUP_HEADER };
export const ADMIN_COOKIE = "tsk-admin";

const GATE_HEADER = "X-TSK-Setup-Gate";
const DEFAULT_API_BASE_URL = "http://localhost:8080";

type SettingsDocument = {
  sessionSigningKey?: string;
  tmdbReadToken?: string;
  omdbApiKey?: string;
  adminAccessKey?: string;
  metricsAccessKey?: string;
  setupGate?: string;
  setupPending?: boolean;
};

type CacheEntry = { path: string; mtimeMs: number; doc: SettingsDocument };

let cache: CacheEntry | null = null;

export function clearSettingsCache(): void {
  cache = null;
}

export function settingsPath(): string {
  const fromEnv = process.env.LOCAL_SETTINGS_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const dockerPath = "/data/local-settings.json";
  if (fs.existsSync(dockerPath)) {
    return dockerPath;
  }
  return path.join(process.cwd(), "data", "local-settings.json");
}

export function readSettings(): SettingsDocument {
  const filePath = settingsPath();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return {};
  }
  if (cache && cache.path === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache.doc;
  }
  try {
    const doc = JSON.parse(fs.readFileSync(filePath, "utf8")) as SettingsDocument;
    cache = { path: filePath, mtimeMs: stat.mtimeMs, doc };
    return doc;
  } catch {
    return {};
  }
}

export function setupPending(): boolean {
  return readSettings().setupPending === true;
}

export function setupGate(): string {
  return readSettings().setupGate?.trim() ?? "";
}

export function isLocalHostHeader(hostHeader: string | null): boolean {
  if (!hostHeader) {
    return false;
  }
  const host = stripPort(hostHeader.trim().toLowerCase());
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function localRefusal(request: Request): "host" | "origin" | "header" | null {
  if (!isLocalHostHeader(request.headers.get("host"))) {
    return "host";
  }
  const origin = request.headers.get("origin");
  if (origin && !isLocalOrigin(origin)) {
    return "origin";
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.headers.get(SETUP_HEADER) !== "1") {
      return "header";
    }
  }
  return null;
}

export type AdminDecision = "open" | "closed" | "challenge";

export function decideAdmin(input: {
  envKey: string;
  fileKey: string;
  authorization: string;
  cookie: string;
}): AdminDecision {
  const key = input.envKey.trim() || input.fileKey.trim();
  if (key === "") {
    return "closed";
  }
  if (isValidBasicAuth(input.authorization, "admin", key)) {
    return "open";
  }
  if (input.cookie !== "" && adminCookieMatches(input.cookie, key)) {
    return "open";
  }
  return "challenge";
}

export function adminCookieValue(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function adminCookieMatches(cookie: string, key: string): boolean {
  const expected = Buffer.from(adminCookieValue(key));
  const actual = Buffer.from(cookie);
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

export function apiBaseURL(): string {
  return (process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export async function apiHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${apiBaseURL()}/healthz`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function callSetup(
  apiPath: string,
  init?: { method?: string; body?: string },
): Promise<{ ok: true; body: unknown } | { ok: false; reason: "down" | "gate" | "forbidden" | "invalid" }> {
  const gate = setupGate();
  if (gate === "") {
    return { ok: false, reason: "gate" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${apiBaseURL()}${apiPath}`, {
      method: init?.method ?? "GET",
      headers: {
        [GATE_HEADER]: gate,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
      body: init?.body,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (response.status === 403) {
      return { ok: false, reason: "forbidden" };
    }
    if (!response.ok) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, body: text ? (JSON.parse(text) as unknown) : {} };
  } catch {
    return { ok: false, reason: "down" };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadSetupStatus(): Promise<SetupStatus> {
  const reachable = await apiHealth();
  const result = await callSetup("/setup/status");
  if (!result.ok || !isStatusBody(result.body)) {
    const status = emptySetupStatus();
    status.apiReachable = reachable;
    if (!result.ok && result.reason === "gate") {
      status.message = "gate";
    } else if (reachable) {
      status.message = "unread";
    } else {
      status.message = "down";
    }
    return status;
  }
  return { ...result.body, apiReachable: reachable };
}

function isStatusBody(value: unknown): value is SetupStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.setupMode === "boolean" && typeof record.sessionKeyConfigured === "boolean";
}

function isLocalOrigin(origin: string): boolean {
  try {
    return isLocalHostHeader(new URL(origin).host);
  } catch {
    return false;
  }
}

function stripPort(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  const separator = host.lastIndexOf(":");
  if (separator === -1) {
    return host;
  }
  return host.slice(0, separator);
}

function isValidBasicAuth(header: string, expectedUser: string, expectedPassword: string): boolean {
  const prefix = "Basic ";
  if (!header.startsWith(prefix)) {
    return false;
  }
  let decoded = "";
  try {
    decoded = Buffer.from(header.slice(prefix.length), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return false;
  }
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return constantTimeEquals(user, expectedUser) && constantTimeEquals(password, expectedPassword);
}

function constantTimeEquals(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
