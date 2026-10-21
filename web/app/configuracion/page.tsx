import type { Metadata } from "next";
import { headers } from "next/headers";

import { setup } from "@/lib/i18n";
import { isLocalHostHeader } from "@/lib/local-setup";

import { ConfiguracionPanel } from "./ConfiguracionPanel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${setup.pageTitle} · The Story Keeper`,
  robots: { index: false, follow: false },
};

export default async function ConfiguracionPage() {
  const host = (await headers()).get("host");
  if (!isLocalHostHeader(host)) {
    return (
      <main className="font-ui mx-auto flex max-w-[720px] flex-col gap-4 px-5 py-16">
        <h1 className="font-display text-3xl text-text">{setup.pageTitle}</h1>
        <p className="text-sm leading-relaxed text-text-muted">{setup.closed}</p>
      </main>
    );
  }
  return <ConfiguracionPanel />;
}
