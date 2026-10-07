"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getAuditLog,
  listAuditLogs,
  type AuditEvent,
  type AuditEventDetail,
  type AuditQuery,
} from "@/lib/api";
import Icon from "@/components/Icon";
import { buttonClass } from "@/components/ui/Button";
import { displayLocale, t, tp, type PluralKey } from "@/i18n/index.ts";

const PAGE_SIZE = 100;

const TYPE_COLORS: Record<string, string> = {
  chat_turn: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  specialist_consult: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  tool_invocation: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  scheduled_action: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  alert: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  integration_inbound: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

function typePillClass(t: string): string {
  return TYPE_COLORS[t] ?? "bg-surface-input/40 text-fg border-line-strong/40";
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(displayLocale());
  } catch {
    return ts;
  }
}

// Human-relative phrase like "2m ago" / "3h ago" / "5d ago". Picks the
// largest unit whose magnitude is ≥1 so the result is one word + "ago".
// Intl.RelativeTimeFormat handles locale + pluralization for us.
const RELATIVE_DIVISIONS: { amount: number; name: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, name: "seconds" },
  { amount: 60, name: "minutes" },
  { amount: 24, name: "hours" },
  { amount: 7, name: "days" },
  { amount: 4.34524, name: "weeks" },
  { amount: 12, name: "months" },
  { amount: Number.POSITIVE_INFINITY, name: "years" },
];
function formatRelative(ts: string): string {
  try {
    const formatter = new Intl.RelativeTimeFormat(displayLocale(), {
      numeric: "auto",
      style: "narrow",
    });
    let duration = (new Date(ts).getTime() - Date.now()) / 1000;
    for (const div of RELATIVE_DIVISIONS) {
      if (Math.abs(duration) < div.amount) {
        return formatter.format(Math.round(duration), div.name);
      }
      duration /= div.amount;
    }
    return ts;
  } catch {
    return ts;
  }
}

// Pretty duration between two ISO timestamps. <1s → "ms", <60s → "Xs",
// <60m → "Xm Ys", else "Xh Ym". Always returns a compact 1–2 token string.
function formatSpan(firstTs: string, lastTs: string): string {
  try {
    const first = new Date(firstTs).getTime();
    const last = new Date(lastTs).getTime();
    const ms = Math.abs(last - first);
    if (ms < 1000) return t("audit.span.ms", { ms });
    const s = Math.floor(ms / 1000);
    if (s < 60) return t("audit.span.s", { s });
    const m = Math.floor(s / 60);
    const remS = s % 60;
    if (m < 60) return remS > 0 ? t("audit.span.ms2", { m, s: remS }) : t("audit.span.m", { m });
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return remM > 0 ? t("audit.span.hm", { h, m: remM }) : t("audit.span.h", { h });
  } catch {
    return "—";
  }
}

// Channel → dot color. Pulls from the same emerald/sky/etc palette as the
// event-type pills so the visual language stays unified. Fall back to a
// neutral fg-muted dot for unknown channels.
const CHANNEL_DOT: Record<string, string> = {
  discord: "bg-emerald-400",
  slack: "bg-fuchsia-400",
  telegram: "bg-sky-400",
  email: "bg-amber-400",
  google_chat: "bg-rose-400",
};

// Shape-summary: replaces the unbounded chip wall with a bounded set of
// "kind × count" badges. Keys are event_type, values are occurrence
// counts. Sorted by a stable canonical order so badges read the same
// way every render (inbound first, response last — matches turn flow).
const TYPE_ORDER: Record<string, number> = {
  integration_inbound: 0,
  memory_snapshot: 1,
  chat_turn: 2,
  knowledge_retrieval: 3,
  specialist_consult: 4,
  tool_invocation: 5,
  cache_event: 6,
  scheduled_action: 7,
  alert: 8,
  // Anything unknown lands after the known canonical types.
};
function summarizeShape(items: AuditEvent[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const evt of items) {
    counts.set(evt.event_type, (counts.get(evt.event_type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => {
      const ao = TYPE_ORDER[a.type] ?? 99;
      const bo = TYPE_ORDER[b.type] ?? 99;
      return ao - bo;
    });
}

// Friendly short noun for the shape-summary badges (the count renders
// beside it). Matches what an engineer would say out loud ("4 specialists"
// rather than "4 specialist_consults"). Falls back to the raw event_type
// when no alias is defined so new event types still render correctly.
const SHAPE_LABEL: Record<string, PluralKey> = {
  integration_inbound: "audit.shape.inbound",
  memory_snapshot: "audit.shape.memory",
  chat_turn: "audit.shape.turn",
  knowledge_retrieval: "audit.shape.knowledge",
  specialist_consult: "audit.shape.specialist",
  tool_invocation: "audit.shape.tool",
  cache_event: "audit.shape.cache",
  scheduled_action: "audit.shape.scheduled",
  alert: "audit.shape.alert",
};
function shapeNoun(type: string, count: number): string {
  const key = SHAPE_LABEL[type];
  return key ? tp(key, count) : type;
}

function formatTimeOnly(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString(displayLocale());
  } catch {
    return ts;
  }
}

// Deep links (e.g. the briefing's "Handled" rail linking a move to its
// evidence) pre-fill the type and text filters from the query string.
export default function AuditPage() {
  return (
    <Suspense fallback={null}>
      <AuditPageInner />
    </Suspense>
  );
}

function AuditPageInner() {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eventType, setEventType] = useState<string>(searchParams.get("event_type") ?? "");
  const [sessionId, setSessionId] = useState<string>("");
  const [q, setQ] = useState<string>(searchParams.get("q") ?? "");
  const [since, setSince] = useState<string>("");
  const [until, setUntil] = useState<string>("");
  const [offset, setOffset] = useState<number>(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, AuditEventDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  // Sessions view is the default surface — most "what happened?" questions
  // start at the session level (one Discord message produced this turn,
  // here's the shape), and users drop into Events view by clicking a
  // session_id to chase chronological detail.
  const [groupBySession, setGroupBySession] = useState<boolean>(true);
  const [collapsedSessions, setCollapsedSessions] = useState<Record<string, boolean>>({});

  const debounceRef = useRef<number | null>(null);
  const filters = useMemo<AuditQuery>(
    () => ({
      event_type: eventType || undefined,
      session_id: sessionId || undefined,
      q: q || undefined,
      // `datetime-local` returns naive strings like "2026-05-19T14:30". The
      // backend `ts` column stores ISO with offset, and SQLite filters via
      // string comparison — so we must normalize to ISO with offset here.
      since: since ? new Date(since).toISOString() : undefined,
      until: until ? new Date(until).toISOString() : undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [eventType, sessionId, q, since, until, offset]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAuditLogs(filters);
      setItems(res.items);
      setTotal(res.total);
      setEventTypes(res.event_types);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("audit.log.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      void refresh();
    }, 250);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [refresh]);

  // Reset to page 0 whenever a filter changes (not on raw offset change).
  useEffect(() => {
    setOffset(0);
  }, [eventType, sessionId, q, since, until]);

  // Lazy-fetch the un-truncated drill-down payload when a row expands.
  // Cache per-id so toggling closed/open doesn't re-fetch.
  useEffect(() => {
    if (expandedId === null) {
      setDetailError(null);
      return;
    }
    if (details[expandedId]) {
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailLoadingId(expandedId);
    setDetailError(null);
    getAuditLog(expandedId)
      .then((d) => {
        if (cancelled) return;
        setDetails((prev) => ({ ...prev, [d.id]: d }));
      })
      .catch((e) => {
        if (cancelled) return;
        setDetailError(e instanceof Error ? e.message : t("audit.log.loadDetailFailed"));
      })
      .finally(() => {
        if (!cancelled) setDetailLoadingId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [expandedId, details]);

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  // Cluster the current page into contiguous runs of the same session_id.
  // Events without a session_id form their own singleton groups so they
  // still render. Ordering within a group preserves API order (id DESC).
  type SessionGroup = {
    key: string;
    sessionId: string | null;
    actor: string | null;
    channel: string | null;
    firstTs: string;
    lastTs: string;
    items: AuditEvent[];
  };
  const sessionGroups = useMemo<SessionGroup[]>(() => {
    if (!groupBySession) return [];
    const groups: SessionGroup[] = [];
    for (const evt of items) {
      const sid = evt.session_id ?? null;
      const channelFromDetails =
        evt.details && typeof evt.details === "object" && "channel" in evt.details
          ? String((evt.details as Record<string, unknown>).channel ?? "")
          : "";
      const last = groups[groups.length - 1];
      if (last && last.sessionId === sid && sid !== null) {
        last.items.push(evt);
        last.lastTs = evt.ts;
        if (!last.actor && evt.actor) last.actor = evt.actor;
        if (!last.channel && channelFromDetails) last.channel = channelFromDetails;
      } else {
        groups.push({
          key: sid ? `s:${sid}:${evt.id}` : `n:${evt.id}`,
          sessionId: sid,
          actor: evt.actor ?? null,
          channel: channelFromDetails || null,
          firstTs: evt.ts,
          lastTs: evt.ts,
          items: [evt],
        });
      }
    }
    return groups;
  }, [groupBySession, items]);

  const toggleSessionCollapsed = useCallback((key: string) => {
    setCollapsedSessions((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Once the user picks a single session, the "compare sessions" job is
  // done — they want chronological detail. Auto-switching to Events view
  // saves them a manual toggle. Called from every clickable session_id
  // affordance (card header, table row, event-row session column).
  const focusSession = useCallback((sid: string) => {
    setSessionId(sid);
    setGroupBySession(false);
  }, []);

  // Consolidate the per-event "no-session" singletons into a single tail
  // bucket so the cards list isn't dominated by orphan rows from before
  // PR #158 (when integration_inbound didn't propagate session_id). Real
  // sessions render in their original chronological order; unattributed
  // events all collapse into one card at the end.
  const sessionCards = useMemo(() => {
    if (!groupBySession) return [];
    const real = sessionGroups.filter((g) => g.sessionId !== null);
    const orphans = sessionGroups.filter((g) => g.sessionId === null);
    if (orphans.length === 0) return real;
    const merged = orphans.flatMap((g) => g.items);
    const firstTs = merged.length > 0 ? merged[merged.length - 1].ts : "";
    const lastTs = merged.length > 0 ? merged[0].ts : "";
    return [
      ...real,
      {
        key: "unattributed",
        sessionId: null,
        actor: null,
        channel: "unattributed",
        firstTs,
        lastTs,
        items: merged,
      },
    ];
  }, [groupBySession, sessionGroups]);

  const renderEventRow = (evt: AuditEvent) => {
    const isOpen = expandedId === evt.id;
    return (
      <Fragment key={evt.id}>
        <tr
          onClick={() => setExpandedId(isOpen ? null : evt.id)}
          className="border-t border-line hover:bg-surface-elevated/40 cursor-pointer"
        >
          <td className="px-3 py-2 text-fg-muted whitespace-nowrap font-mono text-xs">
            {formatTs(evt.ts)}
          </td>
          <td className="px-3 py-2">
            <span
              className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-medium ${typePillClass(
                evt.event_type
              )}`}
            >
              {evt.event_type}
            </span>
          </td>
          <td className="px-3 py-2 text-fg whitespace-nowrap">
            {evt.actor ?? "—"}
          </td>
          <td className="px-3 py-2 text-fg">{evt.summary}</td>
          <td className="px-3 py-2 font-mono text-xs">
            {evt.session_id ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  focusSession(evt.session_id ?? "");
                }}
                className="text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline"
                title={t("audit.log.filterBySession", { id: evt.session_id })}
              >
                {evt.session_id.slice(0, 8)}
              </button>
            ) : (
              <span className="text-fg-muted">—</span>
            )}
          </td>
        </tr>
        {isOpen && (
          <tr className="border-t border-line bg-surface-elevated/30">
            <td colSpan={5} className="px-4 py-3">
              <div className="grid grid-cols-2 gap-2 text-xs text-fg-muted mb-2">
                <div>id: <span className="text-fg font-mono">{evt.id}</span></div>
                <div>turn_id: <span className="text-fg font-mono">{evt.turn_id ?? "—"}</span></div>
                <div>session_id: <span className="text-fg font-mono">{evt.session_id ?? "—"}</span></div>
                <div>ts: <span className="text-fg font-mono">{evt.ts}</span></div>
              </div>
              <div className="text-[10px] uppercase tracking-wide text-fg-muted mb-1">
                {t("audit.log.detailsSummary")}
              </div>
              <pre className="text-xs text-fg bg-black/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
{JSON.stringify(evt.details, null, 2)}
              </pre>
              {detailLoadingId === evt.id && !details[evt.id] && (
                <div className="mt-3 text-xs text-fg-muted">{t("audit.log.loadingPayload")}</div>
              )}
              {detailError && expandedId === evt.id && !details[evt.id] && (
                <div className="mt-3 text-xs text-rose-300">
                  {t("audit.log.payloadFailed", { error: detailError })}
                </div>
              )}
              {details[evt.id]?.full && (
                <>
                  <div className="text-[10px] uppercase tracking-wide text-fg-muted mt-4 mb-1">
                    {t("audit.log.fullPayload")}
                  </div>
                  <pre className="text-xs text-fg bg-black/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-[60vh]">
{JSON.stringify(details[evt.id].full, null, 2)}
                  </pre>
                </>
              )}
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div className="flex flex-col h-full bg-surface text-fg">
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <Link
            href="/settings/advanced"
            className="-ml-2 inline-flex min-h-touch items-center gap-1.5 rounded-lg px-2 text-[15px] text-fg-muted hover:text-fg hover:bg-surface-overlay transition-colors"
          >
            <Icon name="arrow-left" size="w-4 h-4" />
            {t("audit.log.settings")}
          </Link>
          <div className="mt-2 mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg">{t("audit.log.title")}</h1>
              <p className="mt-1 text-[15px] text-fg-muted">
                {t("audit.log.intro")}
              </p>
            </div>
            <Link href="/audit/usage" className={buttonClass("secondary", "sm")}>
              {t("audit.log.tokenUsage")}
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
            <input
              type="search"
              placeholder={t("audit.log.searchPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="md:col-span-2 px-3 py-1.5 rounded-lg bg-surface-elevated border border-line text-sm focus:outline-none focus:border-indigo-500 placeholder-fg-subtle"
            />
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-line text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="">{t("audit.log.allEventTypes")}</option>
              {eventTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder={t("audit.log.sessionIdPlaceholder")}
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-line text-sm focus:outline-none focus:border-indigo-500 placeholder-fg-subtle"
            />
            <button
              onClick={() => {
                setEventType("");
                setSessionId("");
                setQ("");
                setSince("");
                setUntil("");
              }}
              className="px-3 py-1.5 rounded-lg bg-surface-overlay hover:bg-surface-input text-sm border border-line-strong"
            >
              {t("audit.log.clearFilters")}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <label className="text-xs text-fg-muted flex flex-col gap-1">
              {t("audit.log.from")}
              <input
                type="datetime-local"
                value={since}
                onChange={(e) => setSince(e.target.value)}
                className="px-2 py-1 rounded-lg bg-surface-elevated border border-line text-sm focus:outline-none focus:border-indigo-500"
              />
            </label>
            <label className="text-xs text-fg-muted flex flex-col gap-1">
              {t("audit.log.until")}
              <input
                type="datetime-local"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                className="px-2 py-1 rounded-lg bg-surface-elevated border border-line text-sm focus:outline-none focus:border-indigo-500"
              />
            </label>
            <div className="text-xs text-fg-muted self-end pb-1">
              {loading ? t("common.loading") : t("audit.log.eventCount", { n: total.toLocaleString(displayLocale()) })}
            </div>
            {/* Segmented view switcher — communicates "these are distinct
                surfaces" rather than the checkbox's "annotation on top".
                Events view = the chronological table; Sessions view = the
                grouped card list. */}
            <div
              role="tablist"
              aria-label={t("audit.log.viewMode")}
              className="self-end pb-1 inline-flex rounded-lg bg-surface-elevated border border-line p-0.5 text-xs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={!groupBySession}
                onClick={() => setGroupBySession(false)}
                className={[
                  "px-2.5 py-1 rounded-md transition-colors",
                  !groupBySession
                    ? "bg-surface-input text-fg shadow-sm"
                    : "text-fg-muted hover:text-fg",
                ].join(" ")}
              >
                {t("audit.log.events")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={groupBySession}
                onClick={() => setGroupBySession(true)}
                className={[
                  "px-2.5 py-1 rounded-md transition-colors",
                  groupBySession
                    ? "bg-surface-input text-fg shadow-sm"
                    : "text-fg-muted hover:text-fg",
                ].join(" ")}
              >
                {t("audit.log.sessions")}
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
              {error}
            </div>
          )}

          {groupBySession ? (
            // Sessions view — a vertical stack of session cards. The detailed
            // event transcript lives at /audit/session/[id] (the flow chart);
            // this surface is the *map* of sessions, optimized for scanning.
            <div className="flex flex-col gap-3">
              {sessionCards.length === 0 && !loading && (
                <div className="rounded-xl border border-line bg-surface-elevated/30 px-4 py-8 text-center text-sm text-fg-muted">
                  {t("audit.log.noSessions")}{" "}
                  <button
                    type="button"
                    onClick={() => setGroupBySession(false)}
                    className="text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline"
                  >
                    {t("audit.log.switchToEvents")}
                  </button>
                </div>
              )}
              {sessionCards.map((g) => {
                const collapsed = !!collapsedSessions[g.key];
                const shape = summarizeShape(g.items);
                // Items arrive newest-first (id DESC); SessionGroup preserves
                // that order. For the peek we want the most recent first too.
                const peekCount = collapsed ? g.items.length : 3;
                const peekItems = g.items.slice(0, peekCount);
                const hiddenCount = g.items.length - peekItems.length;
                const channelKey = (g.channel ?? "").toLowerCase();
                const dotClass = CHANNEL_DOT[channelKey] ?? "bg-fg-muted";
                return (
                  <div
                    key={g.key}
                    className="group rounded-xl border border-line bg-surface-elevated/30 hover:bg-surface-elevated/60 hover:border-line-strong transition-colors"
                  >
                    {/* Identity strip — channel · session_id · relative · span.
                        Lives in its own row so the eye lands on identity
                        before scanning shape. */}
                    <div className="flex items-center gap-2 px-4 pt-3 text-xs">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${dotClass} flex-shrink-0`}
                        aria-hidden
                      />
                      <span className="text-fg-muted">
                        {g.key === "unattributed" ? t("audit.log.unattributed") : g.channel ?? "—"}
                      </span>
                      <span className="text-fg-subtle">·</span>
                      {g.sessionId ? (
                        <button
                          type="button"
                          onClick={() => focusSession(g.sessionId ?? "")}
                          className="font-mono text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline truncate max-w-[40ch]"
                          title={t("audit.log.filterBy", { id: g.sessionId })}
                        >
                          {g.sessionId}
                        </button>
                      ) : (
                        <span className="font-mono text-fg-muted italic">{t("audit.log.unattributed")}</span>
                      )}
                      <span className="text-fg-subtle">·</span>
                      <span
                        className="text-fg-muted"
                        title={formatTs(g.lastTs)}
                      >
                        {formatRelative(g.lastTs)}
                      </span>
                      {g.firstTs !== g.lastTs && (
                        <>
                          <span className="text-fg-subtle">·</span>
                          <span className="text-fg-muted">
                            {t("audit.log.span", { span: formatSpan(g.firstTs, g.lastTs) })}
                          </span>
                        </>
                      )}
                      {g.sessionId && (
                        <Link
                          href={`/audit/session/${encodeURIComponent(g.sessionId)}`}
                          className="ml-auto text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline whitespace-nowrap"
                          title={t("audit.log.openFlowTitle")}
                        >
                          {t("audit.log.openFlow")}
                        </Link>
                      )}
                    </div>

                    {/* Shape summary — bounded count badges per event type.
                        Reads as "1 inbound · 4 specialists · 6 tools" rather
                        than the previous unbounded chip wall. */}
                    <div className="flex items-center gap-1.5 flex-wrap px-4 pt-2.5 text-[11px]">
                      {shape.map(({ type, count }) => (
                        <span
                          key={type}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-medium ${typePillClass(type)}`}
                          title={`${count} × ${type}`}
                        >
                          <span className="tabular-nums">{count}</span>
                          <span className="opacity-80">{shapeNoun(type, count)}</span>
                        </span>
                      ))}
                    </div>

                    {/* Recent events peek — three lines of HH:MM:SS · type · summary.
                        Each line reuses the existing JSON drill-down state, so
                        clicking opens the same detail panel as the table.
                        Expanding (chevron) widens this peek to the full set. */}
                    <ul className="mt-2 mx-4 mb-3 divide-y divide-line/70 rounded-md border border-line/60 bg-surface/40 text-xs overflow-hidden">
                      {peekItems.map((evt) => {
                        const isOpen = expandedId === evt.id;
                        return (
                          <li key={evt.id}>
                            <button
                              type="button"
                              onClick={() => setExpandedId(isOpen ? null : evt.id)}
                              className="w-full flex items-center gap-3 px-3 py-1.5 hover:bg-surface-elevated/60 text-left"
                            >
                              <span className="font-mono text-[10px] text-fg-muted whitespace-nowrap flex-shrink-0 min-w-[11ch]">
                                {formatTimeOnly(evt.ts)}
                              </span>
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded border text-[9px] font-medium whitespace-nowrap ${typePillClass(evt.event_type)}`}
                              >
                                {evt.event_type}
                              </span>
                              <span className="text-fg truncate">{evt.summary}</span>
                            </button>
                            {isOpen && (
                              <div className="px-4 py-3 bg-surface/60 border-t border-line/70">
                                <div className="grid grid-cols-2 gap-2 text-xs text-fg-muted mb-2">
                                  <div>id: <span className="text-fg font-mono">{evt.id}</span></div>
                                  <div>turn_id: <span className="text-fg font-mono">{evt.turn_id ?? "—"}</span></div>
                                  <div>session_id: <span className="text-fg font-mono">{evt.session_id ?? "—"}</span></div>
                                  <div>ts: <span className="text-fg font-mono">{evt.ts}</span></div>
                                </div>
                                <div className="text-[10px] uppercase tracking-wide text-fg-muted mb-1">
                                  {t("audit.log.detailsSummary")}
                                </div>
                                <pre className="text-xs text-fg bg-black/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
{JSON.stringify(evt.details, null, 2)}
                                </pre>
                                {detailLoadingId === evt.id && !details[evt.id] && (
                                  <div className="mt-3 text-xs text-fg-muted">{t("audit.log.loadingPayload")}</div>
                                )}
                                {detailError && expandedId === evt.id && !details[evt.id] && (
                                  <div className="mt-3 text-xs text-rose-300">
                                    {t("audit.log.payloadFailed", { error: detailError })}
                                  </div>
                                )}
                                {details[evt.id]?.full && (
                                  <>
                                    <div className="text-[10px] uppercase tracking-wide text-fg-muted mt-4 mb-1">
                                      {t("audit.log.fullPayload")}
                                    </div>
                                    <pre className="text-xs text-fg bg-black/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-[60vh]">
{JSON.stringify(details[evt.id].full, null, 2)}
                                    </pre>
                                  </>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                      {hiddenCount > 0 && (
                        <li>
                          <button
                            type="button"
                            onClick={() => toggleSessionCollapsed(g.key)}
                            className="w-full text-left px-3 py-1.5 text-fg-muted hover:text-fg hover:bg-surface-elevated/60"
                          >
                            {tp("audit.log.earlierEvents", hiddenCount)}
                          </button>
                        </li>
                      )}
                      {collapsed && g.items.length > 3 && (
                        <li>
                          <button
                            type="button"
                            onClick={() => toggleSessionCollapsed(g.key)}
                            className="w-full text-left px-3 py-1.5 text-fg-muted hover:text-fg hover:bg-surface-elevated/60"
                          >
                            {t("audit.log.collapse")}
                          </button>
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            // Events view — the original chronological table, untouched.
            <div className="rounded-xl border border-line overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-elevated/60 text-fg-muted text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t("audit.log.col.time")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("audit.log.col.type")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("audit.log.col.actor")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("audit.log.col.summary")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("audit.log.col.session")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && !loading && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-fg-muted">
                        {t("audit.log.noEvents")}
                      </td>
                    </tr>
                  )}
                  {items.map((evt) => renderEventRow(evt))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between mt-4 text-sm">
            <div className="text-fg-muted">
              {t("audit.log.page", {
                page: Math.floor(offset / PAGE_SIZE) + 1,
                total: Math.max(1, Math.ceil(total / PAGE_SIZE)),
              })}
            </div>
            <div className="flex gap-2">
              <button
                disabled={!hasPrev}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="px-3 py-1.5 rounded-lg bg-surface-overlay hover:bg-surface-input disabled:opacity-40 disabled:cursor-not-allowed border border-line-strong"
              >
                {t("audit.log.prev")}
              </button>
              <button
                disabled={!hasNext}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="px-3 py-1.5 rounded-lg bg-surface-overlay hover:bg-surface-input disabled:opacity-40 disabled:cursor-not-allowed border border-line-strong"
              >
                {t("audit.log.next")}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
