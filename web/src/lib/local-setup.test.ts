import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  adminCookieMatches,
  adminCookieValue,
  clearSettingsCache,
  decideAdmin,
  isLocalHostHeader,
  localRefusal,
  readSettings,
  setupPending,
} from "@/lib/local-setup";

describe("configuración local", () => {
  afterEach(() => {
    clearSettingsCache();
    delete process.env.LOCAL_SETTINGS_PATH;
  });

  it("solo acepta esta computadora como host", () => {
    expect(isLocalHostHeader("localhost:3000")).toBe(true);
    expect(isLocalHostHeader("127.0.0.1:3000")).toBe(true);
    expect(isLocalHostHeader("[::1]:3000")).toBe(true);
    expect(isLocalHostHeader("192.168.1.20:3000")).toBe(false);
    expect(isLocalHostHeader(null)).toBe(false);
  });

  it("una escritura sin la cabecera propia se rechaza", () => {
    const request = new Request("http://localhost:3000/configuracion/guardar", {
      method: "POST",
      headers: { host: "localhost:3000" },
    });
    expect(localRefusal(request)).toBe("header");
  });

  it("una escritura de otro sitio se rechaza aunque finja el host", () => {
    const request = new Request("http://localhost:3000/configuracion/guardar", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "https://otro.example",
        "x-tsk-local-setup": "1",
      },
    });
    expect(localRefusal(request)).toBe("origin");
  });

  it("sin ninguna contraseña el panel queda cerrado", () => {
    expect(decideAdmin({ envKey: "", fileKey: "", authorization: "", cookie: "" })).toBe("closed");
  });

  it("la contraseña del archivo abre el panel y la cookie también", () => {
    const key = "clave-del-archivo";
    const authorization = `Basic ${Buffer.from(`admin:${key}`).toString("base64")}`;
    expect(decideAdmin({ envKey: "", fileKey: key, authorization, cookie: "" })).toBe("open");
    expect(decideAdmin({ envKey: "", fileKey: key, authorization: "", cookie: "no" })).toBe("challenge");
    expect(
      decideAdmin({
        envKey: "",
        fileKey: key,
        authorization: "",
        cookie: adminCookieValue(key),
      }),
    ).toBe("open");
    expect(adminCookieMatches(adminCookieValue(key), key)).toBe(true);
    expect(adminCookieMatches(adminCookieValue("otra"), key)).toBe(false);
  });

  it("lee si el servicio sigue en preparación", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tsk-setup-"));
    const filePath = path.join(directory, "local-settings.json");
    process.env.LOCAL_SETTINGS_PATH = filePath;
    writeFileSync(filePath, JSON.stringify({ setupPending: true, setupGate: "puerta" }));
    clearSettingsCache();
    expect(setupPending()).toBe(true);
    expect(readSettings().setupGate).toBe("puerta");
  });
});
