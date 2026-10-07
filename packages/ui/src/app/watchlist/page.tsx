"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import Switch from "@/components/Switch";
import Button from "@/components/ui/Button";
import OverflowMenu, { type OverflowItem } from "@/components/ui/OverflowMenu";

import {
  approveWatchSuggestion,
  createWatchlistItem,
  declineWatchSuggestion,
  deleteWatchlistItem,
  listDepartments,
  listWatchlist,
  patchWatchlistItem,
  type WatchDeclineReason,
  type WatchlistCadence,
  type WatchlistItem,
  type WatchlistSeverity,
  type WatchlistSignalType,
} from "@/lib/api";
import { suggestWatchSlug } from "@/lib/watchSlug";
import { t, tp, type MessageKey } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";
import { valueLabel } from "./labels";

const fieldCls =
  "w-full px-3.5 py-2.5 text-[15px] rounded-xl bg-surface border border-line text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40";
const labelCls = "block text-sm font-medium text-fg-muted mb-1.5";

// A research suggestion: the Executive wanted to watch this but was not sure
// enough to add it on its own. Sits in dry_run (polls, never alerts) until
// approved or declined here.
function isSuggestion(item: WatchlistItem): boolean {
  return item.origin === "research_proposed" && item.mode === "dry_run";
}

const DECLINE_REASONS: { value: WatchDeclineReason; label: MessageKey; hint: MessageKey }[] = [
  { value: "not_relevant", label: "jobs.watch.notRelevant", hint: "jobs.watch.notRelevantHint" },
  { value: "too_noisy", label: "jobs.watch.tooNoisy", hint: "jobs.watch.tooNoisyHint" },
  { value: "wrong_source", label: "jobs.watch.wrongSource", hint: "jobs.watch.wrongSourceHint" },
];

// Rationale + provenance stamp the research policy left on the row.
function policyStamp(item: WatchlistItem): { entity?: string; score?: number; source_url?: string } {
  const raw = (item.config_json as Record<string, unknown> | undefined)?._policy;
  return raw && typeof raw === "object" ? (raw as { entity?: string; score?: number; source_url?: string }) : {};
}

const CADENCES: WatchlistCadence[] = ["real_time", "15min", "hourly", "daily", "weekly"];
const SEVERITIES: WatchlistSeverity[] = ["low", "medium", "high", "urgent"];
const SIGNAL_TYPES: { value: WatchlistSignalType; label: MessageKey; hint: MessageKey }[] = [
  { value: "stock", label: "jobs.watch.typeStock", hint: "jobs.watch.typeStockHint" },
  { value: "rss", label: "jobs.watch.typeRss", hint: "jobs.watch.typeRssHint" },
  { value: "vendor_status", label: "jobs.watch.typeVendor", hint: "jobs.watch.typeVendorHint" },
  { value: "edgar", label: "jobs.watch.typeEdgar", hint: "jobs.watch.typeEdgarHint" },
  { value: "page_watch", label: "jobs.watch.typePage", hint: "jobs.watch.typePageHint" },
  { value: "query", label: "jobs.watch.typeQuery", hint: "jobs.watch.typeQueryHint" },
];

// query runs an LLM web search every poll, so it bills per tick — unlike the
// keyless feed/EDGAR/page adapters. Surfaced as a warning in the add modal.
const BILLED_SIGNAL_TYPES: ReadonlySet<string> = new Set(["query"]);

// Pretty group-header label per signal type, derived from the add-modal's
// SIGNAL_TYPES so the two never drift. Unknown types fall back to the raw value.
const SIGNAL_TYPE_LABELS: Record<string, MessageKey> = Object.fromEntries(
  SIGNAL_TYPES.map((s) => [s.value, s.label]),
);

function signalTypeLabel(type: string): string {
  const key = SIGNAL_TYPE_LABELS[type];
  return key ? t(key) : type;
}

// Group display order: known types in SIGNAL_TYPES order; unknown types sort last.
const SIGNAL_TYPE_ORDER: string[] = SIGNAL_TYPES.map((s) => s.value);

// Turn a kebab-case slug into a readable title: "stock-aapl" → "stock aapl".
// The full slug stays the identity (used for routing + shown on hover).
function humanizeSlug(slug: string): string {
  return slug.replace(/-+/g, " ").trim();
}

// Relative time. Kept inline so the watchlist page is self-contained;
// Briefing.tsx has its own copy with the same formula.
function formatRelTime(iso: string | null): string {
  if (!iso) return t("jobs.watch.never");
  try {
    const diff = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(diff);
    if (abs < 60_000) return t("jobs.watch.now");
    if (abs < 3_600_000) return t("jobs.watch.minutes", { n: Math.round(abs / 60_000) });
    if (abs < 86_400_000) return t("jobs.watch.hours", { n: Math.round(abs / 3_600_000) });
    return t("jobs.watch.days", { n: Math.round(abs / 86_400_000) });
  } catch {
    return "—";
  }
}

/** The decline reasons as ⋯ items, each saying what it does. */
function declineItems(
  verb: string,
  slug: string,
  busy: boolean,
  onPick: (slug: string, reason: WatchDeclineReason) => void,
): OverflowItem[] {
  return DECLINE_REASONS.map((r) => {
    const hint = t(r.hint);
    return {
      label: `${verb}: ${t(r.label).toLowerCase()} (${hint.charAt(0).toLowerCase()}${hint.slice(1)})`,
      disabled: busy,
      onSelect: () => onPick(slug, r.value),
    };
  });
}

function SuggestionCard({
  item,
  busy,
  onApprove,
  onDecline,
  departmentTitle,
}: {
  item: WatchlistItem;
  busy: boolean;
  onApprove: (slug: string) => void;
  onDecline: (slug: string, reason: WatchDeclineReason) => void;
  departmentTitle?: string;
}) {
  const stamp = policyStamp(item);
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-amber-500/40 bg-surface-elevated p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-fg truncate" title={item.slug}>
            {humanizeSlug(item.slug)}
          </div>
          <div className="text-sm text-fg-muted truncate" title={item.target}>
            {signalTypeLabel(item.signal_type)} · {item.target}
          </div>
        </div>
        <span className="flex-shrink-0 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-300">
          {t("jobs.watch.suggested")}
        </span>
      </div>
      {item.notes && <p className="text-[15px] text-fg mt-2">{item.notes}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted mt-2">
        {stamp.entity && <span>{t("jobs.watch.about", { entity: stamp.entity })}</span>}
        {item.route_to_department && (
          <span title={t("jobs.watch.forTitle")}>
            {t("jobs.watch.for", { department: departmentTitle ?? item.route_to_department })}
          </span>
        )}
        <span>{t("jobs.watch.suggestedAgo", { when: formatRelTime(item.created_at) })}</span>
        <span>{tp("jobs.watch.seenInShadow", item.fired_count)}</span>
        {stamp.source_url && (
          <a href={stamp.source_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {t("jobs.watch.source")}
          </a>
        )}
      </div>
      <div className="mt-auto flex items-center gap-2 pt-4">
        <Button variant="primary" disabled={busy} onClick={() => onApprove(item.slug)}>
          {busy ? "…" : t("common.approve")}
        </Button>
        <OverflowMenu
          label={t("jobs.watch.declineAria", { name: humanizeSlug(item.slug) })}
          items={declineItems(t("jobs.watch.decline"), item.slug, busy, onDecline)}
        />
      </div>
    </div>
  );
}

function WatchCard({
  item,
  onToggle,
  toggleBusy,
  onStopWatching,
}: {
  item: WatchlistItem;
  onToggle: (slug: string, enabled: boolean) => void;
  toggleBusy: boolean;
  onStopWatching?: (slug: string, reason: WatchDeclineReason) => void;
}) {
  // Mode, severity, cadence and counts live on the monitor's own page.
  const isResearch = item.origin === "research";
  const labelId = useId();
  const href = `/watchlist/${encodeURIComponent(item.slug)}`;
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-line bg-surface-elevated p-5 shadow-sm">
      <Link href={href} className="min-w-0 flex-1 group">
        <div
          id={labelId}
          className="text-lg font-semibold text-fg group-hover:text-accent transition-colors truncate"
          title={item.slug}
        >
          {humanizeSlug(item.slug)}
        </div>
        <div className="text-sm text-fg-muted mt-0.5 truncate" title={item.target}>
          {item.target}
        </div>
        <div className="text-sm text-fg-subtle mt-1.5">
          {item.last_fired_at
            ? t("jobs.watch.lastFiredAgo", { when: formatRelTime(item.last_fired_at) })
            : t("jobs.watch.notFiredYet")}
          {isResearch && t("jobs.watch.addedByExecutive")}
        </div>
      </Link>
      <div className="relative flex flex-shrink-0 items-center gap-1 pt-1">
        <span className="sr-only">{item.enabled ? t("common.on") : t("common.off")}</span>
        {/* The label pads the small switch out to a 40px tap target. */}
        <label className="inline-flex h-10 w-12 cursor-pointer items-center justify-center">
          <Switch
            checked={item.enabled}
            disabled={toggleBusy}
            labelledBy={labelId}
            onChange={(on) => onToggle(item.slug, on)}
          />
        </label>
        <OverflowMenu
          label={t("jobs.watch.moreFor", { name: humanizeSlug(item.slug) })}
          items={[
            { label: t("jobs.watch.openDetails"), href },
            ...(isResearch && onStopWatching
              ? declineItems(t("jobs.watch.stopWatching"), item.slug, toggleBusy, onStopWatching)
              : []),
          ]}
        />
      </div>
    </div>
  );
}

interface AddModalProps {
  onCreated: (w: WatchlistItem) => void;
  onClose: () => void;
}

function AddWatchModal({ onCreated, onClose }: AddModalProps) {
  const [slug, setSlug] = useState("");
  const [signalType, setSignalType] = useState<WatchlistSignalType>("stock");
  const [target, setTarget] = useState("");
  const [trigger, setTrigger] = useState("");
  const [cadence, setCadence] = useState<WatchlistCadence>("15min");
  const [severityFloor, setSeverityFloor] = useState<WatchlistSeverity>("low");
  const [severityCeiling, setSeverityCeiling] = useState<WatchlistSeverity>("urgent");
  const [mode, setMode] = useState<"active" | "dry_run">("active");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Slug, trigger, cadence, mode and severity sit under "More options" with
  // their defaults; it opens by itself when an error points into it.
  const [moreOpen, setMoreOpen] = useState(false);
  const typeRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    typeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (saving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const targetHintKey = SIGNAL_TYPES.find((s) => s.value === signalType)?.hint;
  const targetHint = targetHintKey ? t(targetHintKey) : "";
  const slugSuggestion = suggestWatchSlug(signalType, target);

  async function submit() {
    setSaving(true);
    setErr(null);
    let parsedTrigger: Record<string, unknown> = {};
    if (trigger.trim()) {
      try {
        parsedTrigger = JSON.parse(trigger);
      } catch {
        setErr(t("jobs.watch.triggerInvalid"));
        setMoreOpen(true);
        setSaving(false);
        return;
      }
    }
    try {
      const created = await createWatchlistItem({
        slug: slug.trim() || slugSuggestion,
        signal_type: signalType,
        target: target.trim(),
        trigger: parsedTrigger,
        cadence,
        severity_floor: severityFloor,
        severity_ceiling: severityCeiling,
        mode,
        notes: notes.trim(),
      });
      onCreated(created);
    } catch (e) {
      const message = e instanceof Error ? e.message : t("jobs.watch.createFailed");
      setErr(message);
      if (/slug|trigger|cadence|severity|mode/i.test(message)) setMoreOpen(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
      onClick={saving ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("jobs.watch.addMonitor")}
        className="bg-surface-elevated border border-line rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto p-5 sm:p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold tracking-tight text-fg mb-5">{t("jobs.watch.addMonitor")}</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="watch-signal-type" className={labelCls}>{t("jobs.watch.signalType")}</label>
            <select
              id="watch-signal-type"
              ref={typeRef}
              value={signalType}
              onChange={(e) => setSignalType(e.target.value as WatchlistSignalType)}
              className={fieldCls}
            >
              {SIGNAL_TYPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.label)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="watch-target" className={labelCls}>{t("jobs.watch.target")}</label>
            <input
              id="watch-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={targetHint}
              className={fieldCls}
            />
            <p className="text-sm text-fg-subtle mt-1.5">{targetHint}</p>
            {BILLED_SIGNAL_TYPES.has(signalType) && (
              <p className="text-sm text-amber-600 dark:text-amber-300 mt-1.5">
                {t("jobs.watch.billedWarning")}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="watch-notes" className={labelCls}>{t("jobs.watch.notes")}</label>
            <input
              id="watch-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              placeholder={t("jobs.watch.notesPlaceholder")}
              className={fieldCls}
            />
          </div>

          <details
            className="rounded-xl border border-line px-4 py-2"
            open={moreOpen}
            onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="flex min-h-10 cursor-pointer items-center text-[15px] font-medium text-fg">
              {t("jobs.watch.moreOptions")}
              <span className="ml-2 text-sm font-normal text-fg-subtle">
                {slug.trim() || slugSuggestion || t("jobs.watch.nameFallback")} · {valueLabel(cadence)} · {valueLabel(mode)} · {valueLabel(severityFloor)}→{valueLabel(severityCeiling)}
              </span>
            </summary>
            <div className="space-y-4 py-3">
              <div>
                <label htmlFor="watch-slug" className={labelCls}>{t("jobs.watch.slugLabel")}</label>
                <input
                  id="watch-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder={slugSuggestion || "stock-aapl"}
                  className={fieldCls}
                />
                <p className="text-sm text-fg-subtle mt-1.5">
                  {tRich("jobs.watch.slugHint", {
                    name: slugSuggestion ? <code>{slugSuggestion}</code> : t("jobs.watch.slugHintFallback"),
                  })}
                </p>
              </div>
              <div>
                <label htmlFor="watch-trigger" className={labelCls}>{t("jobs.watch.triggerLabel")}</label>
                <textarea
                  id="watch-trigger"
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                  placeholder={
                    signalType === "stock"
                      ? '{"abs_change_pct_gte": 5}'
                      : signalType === "edgar"
                        ? '{"forms": ["8-K", "10-K"]}'
                        : signalType === "rss" ||
                            signalType === "query" ||
                            signalType === "page_watch"
                          ? '{"keywords": ["layoffs", "downtime"]}'
                          : "{}"
                  }
                  rows={3}
                  className={`${fieldCls} font-mono text-sm`}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="watch-cadence" className={labelCls}>{t("jobs.builder.cadence")}</label>
                  <select
                    id="watch-cadence"
                    value={cadence}
                    onChange={(e) => setCadence(e.target.value as WatchlistCadence)}
                    className={fieldCls}
                  >
                    {CADENCES.map((c) => (
                      <option key={c} value={c}>
                        {valueLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="watch-mode" className={labelCls}>{t("jobs.watch.mode")}</label>
                  <select
                    id="watch-mode"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "active" | "dry_run")}
                    className={fieldCls}
                  >
                    <option value="active">{valueLabel("active")}</option>
                    <option value="dry_run">{valueLabel("dry_run")}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="watch-floor" className={labelCls}>{t("jobs.watch.severityFloor")}</label>
                  <select
                    id="watch-floor"
                    value={severityFloor}
                    onChange={(e) => setSeverityFloor(e.target.value as WatchlistSeverity)}
                    className={fieldCls}
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {valueLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="watch-ceiling" className={labelCls}>{t("jobs.watch.severityCeiling")}</label>
                  <select
                    id="watch-ceiling"
                    value={severityCeiling}
                    onChange={(e) => setSeverityCeiling(e.target.value as WatchlistSeverity)}
                    className={fieldCls}
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {valueLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </details>
        </div>

        {err && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[15px]">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={saving || !(slug.trim() || slugSuggestion) || !target.trim()}
            onClick={submit}
          >
            {saving ? t("jobs.watch.adding") : t("jobs.watch.addMonitor")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busySlugs, setBusySlugs] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // slug → title for the "for: <department>" label on routed watches.
  const [departmentTitles, setDepartmentTitles] = useState<Record<string, string>>({});

  const toggleCollapsed = (key: string) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // Group monitors by signal type, mirroring the artifacts/runs collapsible
  // groups. Known types render in SIGNAL_TYPES order; any unknown type sorts
  // last (alphabetically) so a new backend adapter never silently vanishes.
  const suggestions = useMemo(() => items.filter(isSuggestion), [items]);

  const groups = useMemo(() => {
    const map = new Map<string, WatchlistItem[]>();
    for (const it of items) {
      if (isSuggestion(it)) continue;
      const bucket = map.get(it.signal_type);
      if (bucket) bucket.push(it);
      else map.set(it.signal_type, [it]);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      const ia = SIGNAL_TYPE_ORDER.indexOf(a);
      const ib = SIGNAL_TYPE_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({
      key: k,
      label: signalTypeLabel(k),
      items: map.get(k)!,
    }));
  }, [items]);

  function refresh() {
    setLoading(true);
    listWatchlist()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : t("jobs.watch.loadFailed")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
    listDepartments()
      .then((states) =>
        setDepartmentTitles(Object.fromEntries(states.map((d) => [d.config.slug, d.config.title]))),
      )
      .catch(() => {});
  }, []);

  function markBusy(slug: string, busy: boolean) {
    setBusySlugs((prev) => {
      const next = new Set(prev);
      if (busy) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }

  async function approve(slug: string) {
    markBusy(slug, true);
    try {
      const updated = await approveWatchSuggestion(slug);
      setItems((prev) => prev.map((it) => (it.slug === slug ? updated : it)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jobs.watch.approveFailed"));
    } finally {
      markBusy(slug, false);
    }
  }

  async function decline(slug: string, reason: WatchDeclineReason) {
    markBusy(slug, true);
    try {
      const res = await declineWatchSuggestion(slug, reason);
      if (res.result === "removed") {
        setItems((prev) => prev.filter((it) => it.slug !== slug));
      } else {
        // too_noisy: the row went live with a high floor — reload it.
        refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jobs.watch.declineFailed"));
    } finally {
      markBusy(slug, false);
    }
  }

  async function stopWatching(slug: string, reason: WatchDeclineReason) {
    markBusy(slug, true);
    try {
      if (reason === "too_noisy") {
        // Same remedy the decline route applies: keep the source, only
        // high-severity signals surface.
        const updated = await patchWatchlistItem(slug, { severity_floor: "high" });
        setItems((prev) => prev.map((it) => (it.slug === slug ? updated : it)));
      } else {
        await deleteWatchlistItem(slug, reason);
        setItems((prev) => prev.filter((it) => it.slug !== slug));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jobs.watch.removeFailed"));
    } finally {
      markBusy(slug, false);
    }
  }

  async function toggle(slug: string, enabled: boolean) {
    // Optimistic. The disabled prop on the input prevents a second
    // click landing while the PATCH is in flight, so the revert path
    // can safely flip back to the prior value.
    setBusySlugs((prev) => new Set(prev).add(slug));
    setItems((prev) =>
      prev.map((it) => (it.slug === slug ? { ...it, enabled } : it)),
    );
    try {
      const updated = await patchWatchlistItem(slug, { enabled });
      setItems((prev) => prev.map((it) => (it.slug === slug ? updated : it)));
    } catch (e) {
      setItems((prev) =>
        prev.map((it) => (it.slug === slug ? { ...it, enabled: !enabled } : it)),
      );
      setError(e instanceof Error ? e.message : t("jobs.watch.toggleFailed"));
    } finally {
      setBusySlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      {showAdd && (
        <AddWatchModal
          onCreated={(w) => {
            setItems((prev) => [...prev, w]);
            setShowAdd(false);
          }}
          onClose={() => setShowAdd(false)}
        />
      )}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div className="max-w-2xl">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg">
                {t("jobs.watch.title")}
              </h1>
              <p className="text-[15px] text-fg-muted mt-2">
                {t("jobs.watch.intro")}
              </p>
            </div>
            <Button variant="primary" className="self-start sm:self-auto flex-shrink-0" onClick={() => setShowAdd(true)}>
              {t("jobs.watch.addMonitorButton")}
            </Button>
          </div>

          {loading && <p className="text-fg-muted text-[15px]">{t("common.loading")}</p>}
          {error && (
            <div className="px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[15px] mb-4">
              {error}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line p-8 text-center">
              <p className="text-fg-muted text-[15px] mb-3">{t("jobs.watch.empty")}</p>
              <p className="text-sm text-fg-subtle mb-4">
                {tRich("jobs.watch.emptyHint", {
                  example: <span className="italic">{t("jobs.watch.emptyHintExample")}</span>,
                })}
              </p>
              <Button variant="primary" onClick={() => setShowAdd(true)}>
                {t("jobs.watch.addMonitorArrow")}
              </Button>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="mb-10">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
                <h2 className="text-xl font-bold tracking-tight text-fg">{t("jobs.watch.suggestedTitle")}</h2>
                <span className="text-[15px] text-fg-muted">
                  {t("jobs.watch.waitingForYou", { n: suggestions.length })}
                </span>
              </div>
              <p className="text-sm text-fg-subtle mb-4 max-w-3xl">
                {t("jobs.watch.suggestedIntro")}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {suggestions.map((item) => (
                  <SuggestionCard
                    key={item.id}
                    item={item}
                    busy={busySlugs.has(item.slug)}
                    onApprove={approve}
                    onDecline={decline}
                    departmentTitle={departmentTitles[item.route_to_department]}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="space-y-6">
            {groups.map((group) => {
              const isCollapsed = !!collapsed[group.key];
              return (
                <div key={group.key}>
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleCollapsed(group.key)}
                    className="w-full min-h-10 flex items-center gap-2 mb-3 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className={`text-fg-muted text-xs transition-transform ${
                        isCollapsed ? "" : "rotate-90"
                      }`}
                    >
                      ▶
                    </span>
                    <span className="text-base font-semibold text-fg">
                      {group.label}
                    </span>
                    <span className="text-sm text-fg-muted">
                      {tp("jobs.watch.monitorCount", group.items.length)}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {group.items.map((item) => (
                        <WatchCard
                          key={item.id}
                          item={item}
                          onToggle={toggle}
                          toggleBusy={busySlugs.has(item.slug)}
                          onStopWatching={stopWatching}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
