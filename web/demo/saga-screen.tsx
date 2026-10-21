"use client";

import Link from "next/link";

import { SagaDetail } from "@/components/SagaDetail";
import { releases } from "@/lib/connect/catalog";
import { ui } from "@/lib/i18n";
import { findSagaBySlug, pickSagaHighlight, pickSagaOrigin } from "@/lib/saga";

export function SagaScreen({ id }: { id: string }) {
  const saga = findSagaBySlug(releases, id);

  if (saga === null) {
    return (
      <main className="sg-main font-ui">
        <Link href="/" className="sg-back font-mono">
          <span aria-hidden="true">‹</span> {ui.saga.back}
        </Link>
        <h1 className="font-display text-2xl font-medium text-text">{ui.saga.notFoundTitle}</h1>
        <p className="text-sm text-text-muted">{ui.saga.notFoundHint}</p>
      </main>
    );
  }

  return (
    <main className="sg-main font-ui">
      <Link href="/" className="sg-back font-mono">
        <span aria-hidden="true">‹</span> {ui.saga.back}
      </Link>
      <SagaDetail saga={saga} highlight={pickSagaHighlight(saga)} origin={pickSagaOrigin(saga, "")} />
    </main>
  );
}
