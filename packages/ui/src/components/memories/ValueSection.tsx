"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { displayLocale, t } from "@/i18n/index.ts";
import { getValueSummary, type ValueSummary } from "@/lib/api";
import { deltaLabel, headline, visibleLines } from "@/lib/valueSummary";
import { Skeleton } from "./shared";

// What the Executive did for the owner this month (GET /today/value): a
// "Your month" card at the top of the Pulse overview and the full count on
// its own screen (`/memories?tab=value`). Every number is counted from the
// record; the endpoint is the owner's alone, so for anyone else (a 403) the
// card doesn't render.

type Period = "month" | "week";

function useValueSummary(period: Period, offset: number) {
  // Each answer is kept with the request it answers, so a stale one reads as
  // still loading after the period changes (no reset inside the effect).
  const key = `${period}:${offset}`;
  const [result, setResult] = useState<{ key: string; summary: ValueSummary | null; error: boolean }>();

  useEffect(() => {
    let cancelled = false;
    getValueSummary(period, offset)
      .then((summary) => {
        if (!cancelled) setResult({ key, summary, error: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, summary: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key, period, offset]);

  // undefined while loading; null when this viewer isn't the owner (or it failed).
  const current = result?.key === key ? result : undefined;
  return { summary: current?.summary, error: current?.error ?? false };
}

/** The overview card: one sentence about this month, linking to the rest. */
export function YourMonthCard() {
  const { summary } = useValueSummary("month", 0);
  if (summary === null) return null;
  const line = summary ? headline(summary.lines) : "";
  return (
    <Link
      href="/memories?tab=value"
      className="group flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface-elevated p-4 sm:p-6 hover:border-accent/50 hover:bg-surface-overlay transition-colors"
    >
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-fg">{t("people.pulse.screen.value.title")}</h2>
        {summary === undefined ? (
          <Skeleton className="h-5 w-64 mt-2" />
        ) : (
          <p className="text-[15px] text-fg-muted mt-1">
            {line
              ? t("people.value.cardLine", { label: summary.label, line })
              : t("people.value.cardEmpty", { label: summary.label })}
          </p>
        )}
      </div>
      <Icon name="chevron-right" size="w-5 h-5" />
    </Link>
  );
}

/** The full screen: every counted line, against the period before. */
export function ValueScreen() {
  const [period, setPeriod] = useState<Period>("month");
  const [offset, setOffset] = useState(0);
  const { summary, error } = useValueSummary(period, offset);

  function pick(next: Period) {
    setPeriod(next);
    setOffset(0);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-line p-1" role="group" aria-label={t("people.value.period")}>
          {(["month", "week"] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => pick(p)}
              className={`h-9 rounded-lg px-3 text-sm font-semibold transition-colors ${
                period === p ? "bg-accent text-white" : "text-fg-muted hover:bg-surface-overlay"
              }`}
            >
              {p === "month" ? t("people.value.month") : t("people.value.week")}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOffset((o) => o + 1)}
            className="h-10 w-10 inline-flex items-center justify-center rounded-xl border border-line hover:bg-surface-overlay"
            aria-label={period === "month" ? t("people.value.previousMonth") : t("people.value.previousWeek")}
          >
            <Icon name="chevron-left" size="w-4 h-4" />
          </button>
          <span className="min-w-[9rem] text-center text-[15px] font-semibold text-fg">
            {summary ? summary.label : " "}
          </span>
          <button
            type="button"
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
            disabled={offset === 0}
            className="h-10 w-10 inline-flex items-center justify-center rounded-xl border border-line hover:bg-surface-overlay disabled:opacity-40"
            aria-label={period === "month" ? t("people.value.nextMonth") : t("people.value.nextWeek")}
          >
            <Icon name="chevron-right" size="w-4 h-4" />
          </button>
        </div>
      </div>

      {summary === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : summary === null ? (
        <p className="text-[15px] text-fg-muted">
          {error ? t("people.value.loadError") : t("people.value.ownerOnly")}
        </p>
      ) : (
        <>
          <section className="rounded-2xl border border-line bg-surface-elevated p-4 sm:p-6">
            {visibleLines(summary.lines).length === 0 ? (
              <p className="text-[15px] text-fg-muted">{t("people.value.nothingCounted", { label: summary.label })}</p>
            ) : (
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="text-left text-sm text-fg-subtle">
                    <th className="font-medium pb-2">{t("people.value.whatItDid")}</th>
                    <th className="font-medium pb-2 text-right">{t("people.value.count")}</th>
                    <th className="font-medium pb-2 text-right">
                      {period === "month" ? t("people.value.vsLastMonth") : t("people.value.vsLastWeek")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines(summary.lines).map((l) => (
                    <tr key={l.key} className="border-t border-line">
                      <td className="py-2.5 text-fg">{l.label}</td>
                      <td className="py-2.5 text-right tabular-nums font-semibold text-fg">{l.count}</td>
                      <td className="py-2.5 text-right tabular-nums text-fg-muted">
                        {deltaLabel(l.count, l.previous)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          {summary.deliverables.length > 0 && (
            <section className="rounded-2xl border border-line bg-surface-elevated p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-fg mb-2">
                {t("people.value.deliverables")}
                {summary.deliverables_total > summary.deliverables.length &&
                  t("people.value.deliverablesLatest", {
                    shown: summary.deliverables.length,
                    total: summary.deliverables_total,
                  })}
              </h2>
              <ul>
                {summary.deliverables.map((d) => (
                  <li key={d.run_id} className="border-t border-line first:border-t-0">
                    <Link
                      href={`/jobs/runs/${encodeURIComponent(d.run_id)}`}
                      className="flex items-center justify-between gap-3 py-3 text-[15px] text-fg hover:text-accent"
                    >
                      <span className="min-w-0 truncate">{d.title}</span>
                      <span className="shrink-0 text-sm text-fg-subtle tabular-nums">
                        {new Date(d.finished_at).toLocaleDateString(displayLocale())}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-sm text-fg-subtle">
            {t("people.value.footnote")}
          </p>
        </>
      )}
    </div>
  );
}
