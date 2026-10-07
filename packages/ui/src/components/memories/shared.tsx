// Shared helpers for the Pulse page (memory + cadence). Extracted from the
// former single-file EpisodicMemories component so the Cadence and Memory
// sections — and the redesigned PulseHeader — can reuse them without
// duplication. Holds three things: domain/format helpers, the scheduled-action
// "rhythm" taxonomy (used by both the header stat strip and CadenceSection),
// and a handful of presentational primitives (StatTile, LivePulse, etc.).

import Icon, { type IconName } from "@/components/Icon";
import type { ScheduledAction, WorkspaceMode } from "@/lib/api";
import { displayLocale, t, type MessageKey } from "@/i18n/index.ts";

export const DOMAINS = [
  "strategy",
  "finance",
  "hr",
  "legal",
  "operations",
  "marketing",
  "product",
  "board",
  "general",
];

export const STATUSES = ["active", "paused", "completed", "planned"];

// Display labels for the raw domain / initiative-status values above; the raw
// value stays what is stored and sent. Unknown values show as-is.
function labelFor(prefix: string, value: string): string {
  const key = `${prefix}.${value}` as MessageKey;
  const text = t(key);
  return text === key ? value : text;
}

export function domainLabel(domain: string): string {
  return labelFor("people.domain", domain);
}

export function initiativeStatusLabel(status: string): string {
  return labelFor("people.initiativeStatus", status);
}

/** ISO timestamp → YYYY-MM-DD. */
export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

/** ISO timestamp → an absolute string plus a coarse relative label ("in 5m", "3d ago"). */
export function formatRunAt(iso: string): { absolute: string; relative: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { absolute: iso, relative: "" };
  const absolute = d.toLocaleString(displayLocale());
  const deltaMs = d.getTime() - Date.now();
  const abs = Math.abs(deltaMs);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let unit: string;
  if (mins < 60) unit = t("people.time.minutes", { n: mins });
  else if (hours < 48) unit = t("people.time.hours", { n: hours });
  else unit = t("people.time.days", { n: days });
  const relative = deltaMs >= 0 ? t("people.time.in", { unit }) : t("people.time.ago", { unit });
  return { absolute, relative };
}

export const STATUS_PILL: Record<string, string> = {
  pending: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  running: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  done: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-500 border-red-500/30",
  cancelled: "bg-surface-input/40 text-fg-muted border-line-strong/40",
};

const STATUS_LABEL_KEY: Record<string, MessageKey> = {
  pending: "people.status.pending",
  running: "people.status.running",
  done: "people.status.done",
  failed: "people.status.failed",
  cancelled: "people.status.cancelled",
};

/** Display label for a scheduled_actions status; the raw value stays the key. */
export function statusLabel(status: string): string {
  const key = STATUS_LABEL_KEY[status];
  return key ? t(key) : status;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-14 px-4 text-fg-muted text-[15px]">{message}</div>
  );
}

// ---------------------------------------------------------------------------
// Rhythm taxonomy — turns raw scheduled_actions `kind` strings into the human
// rhythm groups shown on the Pulse page. Shared by PulseHeader (counts) and
// CadenceSection (cards). `ad_hoc` is intentionally absent from the groups: the
// Follow-ups block owns it (its own status filter + cancel).
// ---------------------------------------------------------------------------

export type RhythmGroup = "daily" | "departments" | "awaiting" | "system";

export interface KindMeta {
  label: string;
  group: RhythmGroup;
  blurb?: string;
}

// Labels and blurbs are dictionary keys, looked up when metaFor runs.
const KIND_META: Record<string, { label: MessageKey; group: RhythmGroup; blurb?: MessageKey }> = {
  principal_brief_morning: {
    label: "people.kind.morningBrief",
    group: "daily",
    blurb: "people.kind.morningBriefBlurb",
  },
  executive_reflection: {
    label: "people.kind.reflection",
    group: "daily",
    blurb: "people.kind.reflectionBlurb",
  },
  principal_brief_eod: {
    label: "people.kind.eod",
    group: "daily",
    blurb: "people.kind.eodBlurb",
  },
  // Solo mode only: scheduled weekly, Friday afternoon by default.
  principal_weekly_review: {
    label: "people.kind.weeklyReview",
    group: "daily",
    blurb: "people.kind.weeklyReviewBlurb",
  },
  dept_cadence: { label: "people.kind.checkIn", group: "departments" },
  awaiting_human: { label: "people.kind.awaitingHuman", group: "awaiting" },
  proactive_nudge: { label: "people.kind.nudge", group: "awaiting" },
  nudge_scan: {
    label: "people.kind.nudgeScan",
    group: "system",
    blurb: "people.kind.nudgeScanBlurb",
  },
  external_monitor_scan: {
    label: "people.kind.externalMonitor",
    group: "system",
    blurb: "people.kind.externalMonitorBlurb",
  },
  watchlist_research_scan: {
    label: "people.kind.watchlistResearch",
    group: "system",
    blurb: "people.kind.watchlistResearchBlurb",
  },
};

export function metaFor(action: ScheduledAction): KindMeta {
  const meta = KIND_META[action.kind];
  if (meta) {
    return {
      label: t(meta.label),
      group: meta.group,
      blurb: meta.blurb ? t(meta.blurb) : undefined,
    };
  }
  // Unknown kind: keep it visible rather than dropping it. Internal-channel
  // rows are system plumbing; anything else is a pending commitment.
  return {
    label: action.kind || t("people.kind.scheduledAction"),
    group: action.channel === "__internal__" ? "system" : "awaiting",
  };
}

/** Group pending rows (excluding ad_hoc) by rhythm group, each sorted soonest-first. */
export function groupByRhythm(
  actions: ScheduledAction[],
): Record<RhythmGroup, ScheduledAction[]> {
  const groups: Record<RhythmGroup, ScheduledAction[]> = {
    daily: [],
    departments: [],
    awaiting: [],
    system: [],
  };
  for (const a of actions) {
    if (a.kind === "ad_hoc") continue;
    groups[metaFor(a).group].push(a);
  }
  for (const key of Object.keys(groups) as RhythmGroup[]) {
    groups[key].sort((x, y) => x.run_at.localeCompare(y.run_at));
  }
  return groups;
}

// Groups a solo workspace (one person, just for themselves) does not show:
// it has no department check-ins, and no team whose replies are awaited.
export const SOLO_HIDDEN_RHYTHMS: ReadonlySet<RhythmGroup> = new Set<RhythmGroup>([
  "departments",
  "awaiting",
]);

/** Whether a rhythm group is shown in this workspace mode. */
export function showsRhythm(group: RhythmGroup, mode: WorkspaceMode): boolean {
  return mode !== "solo" || !SOLO_HIDDEN_RHYTHMS.has(group);
}

// ---------------------------------------------------------------------------
// Presentational primitives — kept dependency-free and theme-token-driven so
// they render correctly in both light and dark mode.
// ---------------------------------------------------------------------------

export type StatTone = "default" | "accent" | "emerald" | "amber";

export const STAT_VALUE_TONE: Record<StatTone, string> = {
  default: "text-fg",
  accent: "text-accent",
  emerald: "text-emerald-500",
  amber: "text-amber-500",
};

/** A single at-a-glance metric: label, big number, optional hint. */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: StatTone;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface-elevated px-3 py-3 sm:px-5 sm:py-4 min-w-0">
      <div className="text-sm font-medium text-fg-muted leading-snug">{label}</div>
      <div className={`mt-1 text-2xl sm:text-3xl font-bold tracking-tight tabular-nums leading-tight break-words ${STAT_VALUE_TONE[tone]}`}>
        {value}
      </div>
      {hint && <div className="text-sm text-fg-subtle mt-0.5 leading-snug line-clamp-2">{hint}</div>}
    </div>
  );
}

/**
 * "Live" indicator: a beating emerald dot + optional label. The ping animation
 * is disabled under `prefers-reduced-motion` via Tailwind's `motion-reduce`
 * variant (SSR-safe — no JS hook, no hydration mismatch). The solid dot always
 * shows, so the indicator never disappears, it just stops animating.
 */
export function LivePulse({
  label = t("people.pulse.live"),
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping motion-reduce:hidden" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      {label && (
        <span className="text-xs font-medium uppercase tracking-wide text-emerald-500">
          {label}
        </span>
      )}
    </span>
  );
}

export type TagTone = "info" | "muted";

const TAG_TONE: Record<TagTone, string> = {
  info: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  muted: "bg-surface-input/40 text-fg-subtle border-line",
};

/** Small categorical pill (e.g. "Once a day · for you"). Reuses the app's pill recipe. */
export function Tag({ label, tone = "muted" }: { label: string; tone?: TagTone }) {
  return (
    <span className={`px-2 py-0.5 rounded-lg border text-xs font-medium ${TAG_TONE[tone]}`}>
      {label}
    </span>
  );
}

/** Section header: optional icon, title, optional count badge, optional tag pill, optional subtitle. */
export function SectionHeading({
  title,
  count,
  icon,
  tag,
  tagTone = "muted",
  subtitle,
}: {
  title: string;
  count?: number;
  icon?: IconName;
  tag?: string;
  tagTone?: TagTone;
  subtitle?: string;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        {icon && <Icon name={icon} size="w-4 h-4" className="text-fg-subtle" />}
        <h3 className="text-base font-semibold text-fg">{title}</h3>
        {count != null && (
          <span className="text-sm font-normal tabular-nums text-fg-subtle">{count}</span>
        )}
        {tag && <Tag label={tag} tone={tagTone} />}
      </div>
      {subtitle && <p className="text-sm text-fg-muted mt-1">{subtitle}</p>}
    </div>
  );
}

/** Shimmer placeholder for >300ms loads. Honors reduced-motion. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse motion-reduce:animate-none rounded-md bg-surface-input/60 ${className}`}
      aria-hidden="true"
    />
  );
}
