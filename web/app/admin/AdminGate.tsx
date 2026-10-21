"use client";

import { useState, type FormEvent } from "react";

import { setup } from "@/lib/i18n";
import { SETUP_HEADER } from "@/lib/setup-status";

// AdminGateView cubre el panel cuando no hay contraseña o todavía no se demostró.
export function AdminGateView({ kind }: { kind: "closed" | "challenge" }) {
  if (kind === "closed") {
    return (
      <main className="font-ui mx-auto flex max-w-[560px] flex-col gap-4 px-5 py-16">
        <h1 className="font-display text-2xl text-text">{setup.pageTitle}</h1>
        <p className="text-sm leading-relaxed text-text-muted">{setup.adminClosed}</p>
        <a href="/configuracion" className="font-mono text-xs tracking-[0.08em] text-gold">
          {setup.pageTitle}
        </a>
      </main>
    );
  }
  return <AdminPasswordForm />;
}

function AdminPasswordForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(false);
    try {
      const response = await fetch("/configuracion/entrar-admin", {
        method: "POST",
        headers: { "content-type": "application/json", [SETUP_HEADER]: "1" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError(true);
        return;
      }
      window.location.assign("/admin");
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="font-ui mx-auto flex max-w-[560px] flex-col gap-4 px-5 py-16">
      <h1 className="font-display text-2xl text-text">{setup.adminPrompt}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-sm text-text-muted">
          {setup.adminLabel}
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-base border px-3 py-2 text-text"
            style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
            required
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-text">
            {setup.adminDenied}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="font-mono w-fit rounded-base border px-4 py-2 text-xs tracking-[0.08em] text-gold"
          style={{ borderColor: "var(--color-border)" }}
        >
          {pending ? setup.working : setup.adminEnter}
        </button>
      </form>
    </main>
  );
}
