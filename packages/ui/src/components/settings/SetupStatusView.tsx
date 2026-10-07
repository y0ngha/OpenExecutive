"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import Icon from "@/components/Icon";
import { t, type MessageKey } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";
import { getSetupStatus } from "@/lib/api";
import {
  formatAgo,
  safeInAppLink,
  sortChecks,
  type SetupCheck,
  type SetupState,
  type SetupStatus,
} from "@/lib/setupStatus";

const STATE_STYLE: Record<SetupState, { dot: string; word: MessageKey; wordClass: string }> = {
  ok: { dot: "bg-emerald-400", word: "settings.status.state.ok", wordClass: "text-emerald-300" },
  warn: { dot: "bg-amber-400", word: "settings.status.state.warn", wordClass: "text-amber-300" },
  error: { dot: "bg-rose-400", word: "settings.status.state.error", wordClass: "text-rose-300" },
  off: { dot: "bg-fg-subtle", word: "settings.status.state.off", wordClass: "text-fg-muted" },
};

const LINK_LABELS: Record<string, MessageKey> = {
  "/people": "settings.status.link.people",
  "/onboard": "settings.status.link.onboard",
  "/settings": "settings.status.link.settings",
};

function linkLabel(link: string): string {
  // A person's page: the daily brief light links the owner's own profile.
  if (link.startsWith("/people/")) return t("settings.status.link.profile");
  return t(LINK_LABELS[link] ?? "settings.status.link.open");
}

function CheckRow({ check }: { check: SetupCheck }) {
  const style = STATE_STYLE[check.state];
  const link = safeInAppLink(check.link);
  return (
    <li className="rounded-xl border border-line bg-surface-elevated p-4">
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${style.dot}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h2 className="text-sm font-medium text-fg">{check.label}</h2>
            <span className={`text-xs ${style.wordClass}`}>{t(style.word)}</span>
          </div>
          <p className="mt-1 text-sm text-fg-muted leading-relaxed break-words">{check.summary}</p>
          {check.fix && check.state !== "ok" ? (
            <p
              className={`mt-2 text-sm leading-relaxed break-words ${
                check.state === "off" ? "text-fg-subtle" : "text-fg"
              }`}
            >
              <span className="font-medium">{check.state === "off" ? t("settings.status.toTurnOn") : t("settings.status.whatToDo")}</span>
              {check.fix}
            </p>
          ) : null}
          {link ? (
            <Link
              href={link}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-fg hover:underline"
            >
              {linkLabel(link)}
              <Icon name="chevron-right" size="w-3.5 h-3.5" />
            </Link>
          ) : null}
          {check.last_activity ? (
            <p className="mt-2 text-xs text-fg-subtle">
              {t("settings.status.lastMessage", { ago: formatAgo(check.last_activity) })}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Tally({ checks }: { checks: SetupCheck[] }) {
  const count = (state: SetupState) => checks.filter((c) => c.state === state).length;
  const parts = (["error", "warn", "ok", "off"] as const)
    .map((state) => ({ state, n: count(state) }))
    .filter(({ n }) => n > 0);
  return (
    <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-live="polite">
      {parts.map(({ state, n }) => (
        <span key={state} className="inline-flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${STATE_STYLE[state].dot}`} aria-hidden="true" />
          {n} {t(STATE_STYLE[state].word).toLowerCase()}
        </span>
      ))}
    </p>
  );
}

/**
 * Settings → Setup status. `signIn` is worked out on the server from this
 * app's own settings; everything else comes from the API, which tests each
 * part live — so a run takes a few seconds.
 */
export default function SetupStatusView({ signIn }: { signIn: SetupCheck }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inflight = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setLoading(true);
    setError(null);
    try {
      setStatus(await getSetupStatus(controller.signal));
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (inflight.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check();
    return () => inflight.current?.abort();
  }, [check]);

  const checks = sortChecks([signIn, ...(status?.checks ?? [])]);

  return (
    <main className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg transition-colors"
        >
          <Icon name="arrow-left" size="w-3.5 h-3.5" />
          {t("settings.subpage.back")}
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-fg">{t("settings.status.title")}</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {t("settings.status.intro")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void check()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-line bg-surface-elevated text-fg hover:bg-surface-overlay transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon name="restore" size="w-4 h-4" />
            {loading ? t("settings.status.checking") : t("settings.status.checkAgain")}
          </button>
        </div>

        {status && !loading ? <Tally checks={checks} /> : null}
        {status && !loading ? (
          <p className="mt-1 text-xs text-fg-subtle">{t("settings.status.checked", { ago: formatAgo(status.checked_at) })}</p>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200" role="alert">
            <p className="font-medium">{t("settings.status.runFailed", { error })}</p>
            <p className="mt-1 text-rose-200/80">
              {tRich("settings.status.apiDown", { cmd: <code>make dev</code> })}
            </p>
          </div>
        ) : null}

        <ul className="mt-6 space-y-3" aria-busy={loading}>
          {checks.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
          {loading && !status ? (
            <li className="rounded-xl border border-line bg-surface-overlay/60 p-4 text-sm text-fg-muted animate-pulse motion-reduce:animate-none">
              {t("settings.status.testing")}
            </li>
          ) : null}
        </ul>
      </div>
    </main>
  );
}
