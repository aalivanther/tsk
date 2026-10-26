// Exporta la web a una carpeta estática, sin servidor y sin cuentas.
// La salida queda en /pagina, en la raíz del repo, para publicarla tal cual.

import { cp, mkdir, readFile, writeFile, rm, symlink, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const web = fileURLToPath(new URL("../", import.meta.url));
const repo = fileURLToPath(new URL("../../", import.meta.url));
const stage = join(web, ".demo");
const output = join(repo, "pagina");
const demoDay = "2026-10-12";
const basePath = process.env.DEMO_BASE_PATH ?? "/theStoryKeeper";

if (basePath !== "" && !/^\/[a-zA-Z0-9/_-]+$/.test(basePath)) {
  throw new Error("DEMO_BASE_PATH no es una ruta válida");
}

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const filter = (path) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
for (const entry of ["src", "public", "app", "tsconfig.json", "postcss.config.mjs", "package.json"]) {
  await cp(join(web, entry), join(stage, entry), { recursive: true, filter });
}
for (const entry of ["admin", "configuracion", "rpc", "sitemap.ts", "robots.ts", "(public)/restablecer"]) {
  await rm(join(stage, "app", entry), { recursive: true, force: true });
}
await symlink(join(web, "node_modules"), join(stage, "node_modules"), "dir");

const put = (relativePath, contents) => writeFile(join(stage, relativePath), contents);

async function edit(relativePath, change) {
  const absolute = join(stage, relativePath);
  const before = await readFile(absolute, "utf8");
  const after = change(before);
  if (after === before) {
    throw new Error(`El parche no cambió ${relativePath}`);
  }
  await writeFile(absolute, after);
}

function swap(source, from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`No está el texto esperado (${label})`);
  }
  return source.replace(from, to);
}

const snapshot = JSON.parse(await readFile(join(repo, "backend/seed/seed.json"), "utf8"));
const windowMonths = new Set(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
const windowReleases = snapshot.releases.filter((release) =>
  windowMonths.has(String(release.releaseDate ?? "").slice(0, 7)),
);

await put(
  "next.config.mjs",
  `export default {output:'export',trailingSlash:true,basePath:${JSON.stringify(basePath)},images:{unoptimized:true},env:{DEMO_TODAY:${JSON.stringify(demoDay)},NEXT_PUBLIC_DEMO_BASE_PATH:${JSON.stringify(basePath)}}};`,
);

for (const [from, to] of [
  ["catalog.ts", "src/lib/connect/catalog.ts"],
  ["auth-context.tsx", "src/lib/auth-context.tsx"],
  ["Providers.tsx", "src/components/Providers.tsx"],
  ["visitor-page.tsx", "app/(public)/login/page.tsx"],
]) {
  await cp(join(web, "demo", from), join(stage, to));
}

// El perfil de la demo no se sincroniza con ningún servidor: profile-sync se cambia por su versión
// sin red, y el módulo real queda al lado solo para que esa versión tome de él sus tipos.
await cp(join(stage, "src/lib/connect/profile-sync.ts"), join(stage, "src/lib/connect/profile-sync-server.ts"));
await cp(join(web, "demo/profile-sync.ts"), join(stage, "src/lib/connect/profile-sync.ts"));

await put("src/demo-catalog.json", JSON.stringify({ releases: windowReleases }));
await mkdir(join(stage, "public/demo/releases"), { recursive: true });
for (const release of windowReleases) {
  if (!/^[a-zA-Z0-9_-]+$/.test(release.id)) {
    throw new Error(`Identificador de título no usable en una ruta: ${release.id}`);
  }
  await put(`public/demo/releases/${release.id}.json`, JSON.stringify(release));
}

await edit("src/lib/connect/release-detail.ts", (source) => {
  let next = swap(
    source,
    'import { createClient } from "@connectrpc/connect";\nimport { Code, ConnectError } from "@connectrpc/connect";\n\nimport { createBrowserTransport } from "@/lib/connect/browser-transport";\nimport { CatalogService, type Release } from "@/gen/mdm7mo/catalog/v1/catalog_pb";',
    'import { Code, ConnectError } from "@connectrpc/connect";\nimport { fromJson } from "@bufbuild/protobuf";\n\nimport { ReleaseSchema, type Release } from "@/gen/mdm7mo/catalog/v1/catalog_pb";',
    "imports de la ficha",
  );
  next = swap(
    next,
    `let cachedClient: ReturnType<typeof createClient<typeof CatalogService>> | null = null;
function getCatalogBrowserClient() {
  if (cachedClient === null) {
    cachedClient = createClient(CatalogService, createBrowserTransport());
  }
  return cachedClient;
}

`,
    "",
    "cliente del navegador",
  );
  next = swap(next, "  cachedClient = null;\n", "", "olvido del cliente");
  next = swap(
    next,
    "const response = await getCatalogBrowserClient().getRelease({ id });\n    const release = response.release;",
    `const response = await fetch((process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "") + "/demo/releases/" + encodeURIComponent(id) + ".json");
    if (!response.ok) throw new ConnectError("Missing demo detail", Code.NotFound);
    const release = fromJson(ReleaseSchema, await response.json(), { ignoreUnknownFields: true });`,
    "lectura de la ficha",
  );
  return next;
});

await edit("src/lib/profile-context.tsx", (source) =>
  swap(source, '"tsk-profile-v2"', '"tsk-demo-profile-v2"', "llave del perfil").replace(
    'const LEGACY_STORAGE_KEYS = ["tsk-profile-v1", "mdm7mo-profile-v1"] as const;',
    "const LEGACY_STORAGE_KEYS: readonly string[] = [];",
  ),
);

await edit("app/layout.tsx", (source) => {
  let next = source
    .replace('import { headers } from "next/headers";\n', "")
    .replace('import { redirect } from "next/navigation";\n', "")
    .replace('import { setupPending } from "@/lib/local-setup";\n', "");
  next = swap(
    next,
    `  const headerStore = await headers();
  const nonce = headerStore.get("x-nonce") ?? "";
  const pathname = headerStore.get("x-pathname") ?? "";
  // En preparación solo se abre la pantalla de configuración. El resto espera a que
  // el servicio reinicie con la clave de sesión ya guardada.
  if (
    setupPending() &&
    pathname !== "/configuracion" &&
    !pathname.startsWith("/configuracion/")
  ) {
    redirect("/configuracion");
  }

  return (`,
    "  return (",
    "arranque del layout",
  );
  next = swap(next, "nonce={nonce}\n", "", "nonce del tema");
  next = swap(
    next,
    '<div className="app-shell relative z-[1]">{children}</div>',
    `<div className="app-shell relative z-[1]"><aside className="font-mono px-4 py-2 text-center text-xs text-gold" aria-label="Modo demo">DEMO · Catálogo fijo al 12 oct 2026 · ${windowReleases.length} títulos · El perfil se guarda en este navegador</aside>{children}</div>`,
    "franja de la demo",
  );
  return next;
});

await edit("src/components/Footer.tsx", (source) =>
  swap(
    source,
    `          <Link
            href="/configuracion"
            className="font-mono tracking-[0.08em] text-text-muted underline-offset-4 transition-colors hover:text-gold"
          >
            {footer.setupLink}
          </Link>
`,
    "",
    "enlace de configuración",
  ),
);

await mkdir(join(stage, "src/components/demo"), { recursive: true });
for (const [from, to] of [
  ["title-screen.tsx", "src/components/demo/TitleScreen.tsx"],
  ["person-screen.tsx", "src/components/demo/PersonScreen.tsx"],
  ["saga-screen.tsx", "src/components/demo/SagaScreen.tsx"],
  ["title-page.tsx", "app/(public)/titulo/[id]/page.tsx"],
  ["person-page.tsx", "app/(public)/persona/[id]/page.tsx"],
  ["saga-page.tsx", "app/(public)/saga/[id]/page.tsx"],
  ["title-detail-client.tsx", "src/components/demo/TitleDetailClient.tsx"],
  ["pick-fields.ts", "src/components/demo/pick-fields.ts"],
]) {
  await cp(join(web, "demo", from), join(stage, to));
}

// Los resúmenes del catálogo, como archivo estático aparte (/demo/summaries.json). La ficha de un
// título los pide cuando el navegador queda libre, en vez de llevarlos dentro de su JavaScript.
await mkdir(join(stage, "app/demo/summaries.json"), { recursive: true });
await cp(join(web, "demo/summaries-route.ts"), join(stage, "app/demo/summaries.json/route.ts"));

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!/\.[jt]sx?$/.test(path)) {
      continue;
    }
    const source = await readFile(path, "utf8");
    const next = source
      .replaceAll('export const dynamic = "force-dynamic";', 'export const dynamic = "force-static";')
      .replaceAll('resolveDemoToday(process.env.DEMO_TODAY)', `resolveDemoToday("${demoDay}")`);
    if (next !== source) {
      await writeFile(path, next);
    }
  }
}
await walk(join(stage, "app"));

await edit("app/manifest.ts", (source) => `${source}\nexport const dynamic = "force-static";\n`);
await put("public/robots.txt", "User-agent: *\nDisallow: /\n");

if (basePath !== "") {
  for (const relativePath of ["src/components/Footer.tsx", "app/layout.tsx"]) {
    await edit(relativePath, (source) =>
      source.replace(
        /"\/(tmdb\.svg|favicon-32\.png|icon-[^"]+\.png|apple-icon\.png)"/g,
        `"${basePath}/$1"`,
      ),
    );
  }
}

const result = spawnSync(
  process.execPath,
  [join(web, "node_modules/next/dist/bin/next"), "build", "--webpack"],
  {
    cwd: stage,
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
      NODE_OPTIONS: "--max-old-space-size=8192",
    },
  },
);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

await rm(output, { recursive: true, force: true });
await cp(join(stage, "out"), output, { recursive: true });
await writeFile(join(output, ".nojekyll"), "");
console.log(`Demo estática escrita en ${output}`);
