"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

import { setup } from "@/lib/i18n";
import { emptySetupStatus, SETUP_HEADER, type SetupStatus } from "@/lib/setup-status";

type SecretField = "tmdbReadToken" | "omdbApiKey" | "adminAccessKey" | "metricsAccessKey";

const fieldCopy: Record<
  SecretField,
  { label: string; hint: string; configured: keyof SetupStatus; fromEnv: keyof SetupStatus }
> = {
  tmdbReadToken: {
    label: setup.tmdbLabel,
    hint: setup.tmdbHint,
    configured: "tmdbConfigured",
    fromEnv: "tmdbFromEnvironment",
  },
  omdbApiKey: {
    label: setup.omdbLabel,
    hint: setup.omdbHint,
    configured: "omdbConfigured",
    fromEnv: "omdbFromEnvironment",
  },
  adminAccessKey: {
    label: setup.adminLabel,
    hint: setup.adminHint,
    configured: "adminConfigured",
    fromEnv: "adminFromEnvironment",
  },
  metricsAccessKey: {
    label: setup.metricsLabel,
    hint: setup.metricsHint,
    configured: "metricsConfigured",
    fromEnv: "metricsFromEnvironment",
  },
};

export function ConfiguracionPanel() {
  const [status, setStatus] = useState<SetupStatus>(emptySetupStatus());
  const [values, setValues] = useState<Record<SecretField, string>>({
    tmdbReadToken: "",
    omdbApiKey: "",
    adminAccessKey: "",
    metricsAccessKey: "",
  });
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/configuracion/estado", { cache: "no-store" });
      if (!response.ok) {
        setStatus(emptySetupStatus());
        setNotice(setup.closed);
        return;
      }
      setStatus((await response.json()) as SetupStatus);
      setNotice("");
    } catch {
      setStatus(emptySetupStatus());
      setNotice(setup.downDetail);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body: Partial<Record<SecretField, string>> = {};
    for (const field of Object.keys(values) as SecretField[]) {
      const value = values[field].trim();
      if (value !== "" && status[fieldCopy[field].fromEnv] !== true) {
        body[field] = value;
      }
    }
    if (Object.keys(body).length === 0) {
      return;
    }
    setPending(true);
    setNotice("");
    try {
      const response = await fetch("/configuracion/guardar", {
        method: "POST",
        headers: { "content-type": "application/json", [SETUP_HEADER]: "1" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setNotice(setup.unread);
        return;
      }
      const next = (await response.json()) as Partial<SetupStatus>;
      setStatus((current) => ({ ...current, ...next, apiReachable: true }));
      setValues({ tmdbReadToken: "", omdbApiKey: "", adminAccessKey: "", metricsAccessKey: "" });
      setNotice(setup.savedOk);
    } catch {
      setNotice(setup.downDetail);
    } finally {
      setPending(false);
    }
  }

  async function clearField(field: SecretField) {
    setPending(true);
    setNotice("");
    try {
      const response = await fetch("/configuracion/guardar", {
        method: "POST",
        headers: { "content-type": "application/json", [SETUP_HEADER]: "1" },
        body: JSON.stringify({ [field]: "" }),
      });
      if (!response.ok) {
        setNotice(setup.unread);
        return;
      }
      const next = (await response.json()) as Partial<SetupStatus>;
      setStatus((current) => ({ ...current, ...next, apiReachable: true }));
      setNotice(setup.savedOk);
    } catch {
      setNotice(setup.downDetail);
    } finally {
      setPending(false);
    }
  }

  async function restart() {
    setPending(true);
    setNotice(setup.working);
    try {
      const response = await fetch("/configuracion/encender", {
        method: "POST",
        headers: { "content-type": "application/json", [SETUP_HEADER]: "1" },
        body: "{}",
      });
      if (!response.ok) {
        setNotice(setup.unread);
        setPending(false);
        return;
      }
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          const probe = await fetch("/configuracion/estado", { cache: "no-store" });
          if (!probe.ok) {
            continue;
          }
          const next = (await probe.json()) as SetupStatus;
          if (next.apiReachable && !next.setupMode) {
            setStatus(next);
            setNotice(setup.turnedOn);
            setPending(false);
            return;
          }
        } catch {
          // El proceso se está reiniciando.
        }
      }
      setNotice(setup.downDetail);
    } catch {
      setNotice(setup.downDetail);
    } finally {
      setPending(false);
    }
  }

  const problem =
    status.message === "gate"
      ? setup.gate
      : status.message === "unread"
        ? setup.unread
        : status.message === "down"
          ? setup.downDetail
          : "";

  const connectionText = !loaded ? setup.checking : status.apiReachable ? setup.up : setup.down;
  const connectionTone: StatusTone = !loaded ? "wait" : status.apiReachable ? "ok" : "off";
  const sessionText = !loaded
    ? setup.checking
    : status.sessionKeyFromEnvironment
      ? setup.sessionEnv
      : status.sessionKeyConfigured
        ? setup.sessionReady
        : setup.sessionMissing;
  const sessionTone: StatusTone = !loaded ? "wait" : status.sessionKeyConfigured ? "ok" : "idle";

  return (
    <main className="font-ui mx-auto flex w-full max-w-[720px] flex-col gap-6 px-5 py-10 sm:px-8 sm:py-14">
      <Link
        href="/"
        className="font-mono inline-flex w-fit items-center gap-2 text-xs tracking-[0.08em] text-gold no-underline"
      >
        <span aria-hidden="true">‹</span>
        {setup.back}
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-medium text-text">{setup.pageTitle}</h1>
        <p className="text-sm leading-relaxed text-text-muted">{setup.intro}</p>
      </header>

      <p role="status" className="min-h-5 text-sm text-text">
        {notice}
      </p>

      <section className={cardClass} style={cardStyle} aria-live="polite">
        <h2 className={kickerClass}>{setup.connection}</h2>
        <StatusLine tone={connectionTone} text={connectionText} />
        {status.setupMode ? (
          <p className="text-sm leading-relaxed text-text-muted">{setup.preparing}</p>
        ) : null}
        {problem ? <p className="text-sm text-text-muted">{problem}</p> : null}
        <button
          type="button"
          onClick={() => void refresh()}
          className={quietButtonClass}
          style={quietButtonStyle}
        >
          {setup.retry}
        </button>
      </section>

      <section className={cardClass} style={cardStyle}>
        <h2 className={kickerClass}>{setup.session}</h2>
        <StatusLine tone={sessionTone} text={sessionText} />
      </section>

      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-6">
        {fieldGroups.map((group) => (
          <div key={group.title} className="flex flex-col gap-3">
            <h2 className={kickerClass}>{group.title}</h2>
            {group.fields.map((field) => {
              const copy = fieldCopy[field];
              const fromEnv = status[copy.fromEnv] === true;
              const configured = status[copy.configured] === true;
              const tone: StatusTone = !loaded ? "wait" : fromEnv ? "wait" : configured ? "ok" : "idle";
              const stateText = !loaded
                ? setup.checking
                : fromEnv
                  ? setup.fromEnv
                  : configured
                    ? setup.statusReady
                    : setup.statusMissing;
              return (
                <fieldset key={field} className={`${cardClass} gap-3`} style={cardStyle}>
                  <legend className="px-1 text-sm font-medium text-text">{copy.label}</legend>
                  <p className="text-sm leading-relaxed text-text-muted">{copy.hint}</p>
                  <StatusLine tone={tone} text={stateText} />
                  {fromEnv ? null : (
                    <input
                      type="password"
                      name={field}
                      autoComplete="off"
                      spellCheck={false}
                      value={values[field]}
                      placeholder={setup.placeholder}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [field]: event.target.value }))
                      }
                      className="w-full rounded-base border px-3 py-2.5 text-sm text-text"
                      style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
                    />
                  )}
                  {configured && !fromEnv ? (
                    <button
                      type="button"
                      onClick={() => void clearField(field)}
                      disabled={pending}
                      className={quietButtonClass}
                      style={quietButtonStyle}
                    >
                      {setup.clear}
                    </button>
                  ) : null}
                </fieldset>
              );
            })}
          </div>
        ))}
        {status.ignored !== undefined && status.ignored.length > 0 ? (
          <p className="text-sm text-text-muted">{setup.ignoredNote}</p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className={primaryButtonClass}
          style={primaryButtonStyle}
        >
          {pending ? setup.working : setup.save}
        </button>
      </form>

      <section className={`${cardClass} gap-3`} style={cardStyle}>
        <p id="restart-hint" className="text-sm leading-relaxed text-text-muted">
          {status.setupMode ? setup.preparing : `${setup.restartHint} ${setup.restartWarn}`}
        </p>
        <button
          type="button"
          onClick={() => void restart()}
          disabled={pending || !status.sessionKeyConfigured}
          aria-describedby="restart-hint"
          className={status.setupMode ? primaryButtonClass : quietButtonClass}
          style={status.setupMode ? primaryButtonStyle : quietButtonStyle}
        >
          {status.setupMode ? setup.turnOn : setup.restart}
        </button>
        {!status.setupMode && status.apiReachable ? (
          <Link href="/" className="font-ui w-fit text-sm text-gold no-underline">
            {setup.home}
          </Link>
        ) : null}
      </section>
    </main>
  );
}

type StatusTone = "ok" | "wait" | "off" | "idle";

const fieldGroups: { title: string; fields: SecretField[] }[] = [
  { title: setup.catalogGroup, fields: ["tmdbReadToken", "omdbApiKey"] },
  { title: setup.accessGroup, fields: ["adminAccessKey", "metricsAccessKey"] },
];

const cardClass = "flex flex-col gap-2 rounded-base border p-5";
const cardStyle = { background: "var(--color-surface)", borderColor: "var(--color-border)" };
const quietButtonStyle = { borderColor: "var(--color-border)" };
const primaryButtonStyle = {
  borderColor: "var(--color-gold)",
  background: "color-mix(in srgb, var(--color-gold) 18%, transparent)",
};
const kickerClass =
  "font-hud text-[12px] font-semibold tracking-[0.16em] uppercase text-gold-bright";
const quietButtonClass =
  "font-ui w-fit rounded-base border px-3 py-2 text-sm text-text-muted disabled:opacity-50";
const primaryButtonClass =
  "font-ui w-fit rounded-base border px-5 py-2.5 text-sm text-text disabled:opacity-50";

function StatusLine({ tone, text }: { tone: StatusTone; text: string }) {
  const dot =
    tone === "ok"
      ? "bg-teal"
      : tone === "wait"
        ? "bg-gold"
        : tone === "off"
          ? "bg-[var(--color-live)]"
          : "bg-text-subtle";
  return (
    <p className="flex items-center gap-2 text-sm text-text">
      <span
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot}`}
      />
      <span>{text}</span>
    </p>
  );
}
