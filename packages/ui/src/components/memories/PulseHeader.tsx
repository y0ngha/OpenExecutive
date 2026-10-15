"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  getActivityDaily,
  listAdvice,
  listDecisions,
  listInitiatives,
  listScheduledActions,
  type Advice,
  type DailyActivityCount,
  type Decision,
  type Initiative,
  type ScheduledAction,
  type WorkspaceMode,
} from "@/lib/api";
import Icon from "@/components/Icon";
import { t, tp } from "@/i18n/index.ts";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import {
  deriveVitals,
  formatTrend,
  formatVitalDate,
  type TrendDirection,
} from "@/lib/heartbeatVitals";
import {
  LivePulse,
  STAT_VALUE_TONE,
  Skeleton,
  groupByRhythm,
  metaFor,
  type StatTone,
} from "./shared";

// The Pulse page's heartbeat card: a GitHub-contributions-style heatmap of
// the Executive's self-initiated activity over the last 90 days, beside three
// headline numbers (done today, the next thing it will do, days in a row).
// The rest (rhythm counts and the vitals derived from the heatmap: streaks,
// totals, trend) sit under "More detail" in the same card. Every metric is
// derived from data the page already needs (pending scheduled actions + the
// three memory lists, which the memory tiles reuse); only the per-day heatmap
// requires its own endpoint, since /today/activity returns the last-N items,
// not a daily timeline. What peer memory learned about the signed-in person
// is theirs alone (Settings → About you), so it is not counted here.

const HEATMAP_DAYS = 90;

interface HeaderData {
  pending: ScheduledAction[];
  decisions: Decision[];
  initiatives: Initiative[];
  advice: Advice[];
  heatmap: DailyActivityCount[];
}

export interface PulseData {
  data: HeaderData | null;
  loading: boolean;
  /** Headline numbers first, then the ones under "More detail". */
  stats: { headline: Stat[]; more: Stat[] } | null;
}

/** Loads everything the Pulse numbers, heatmap and memory tiles need, once per page. */
export function usePulseData(): PulseData {
  const { mode } = useWorkspace();
  const [data, setData] = useState<HeaderData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    Promise.all([
      listScheduledActions("pending", 200, controller.signal),
      listDecisions(),
      listInitiatives(),
      listAdvice(),
      getActivityDaily(HEATMAP_DAYS, controller.signal),
    ])
      .then(([pending, decisions, initiatives, advice, daily]) => {
        if (cancelled) return;
        setData({ pending, decisions, initiatives, advice, heatmap: daily.days });
      })
      .catch((err) => {
        if ((err as Error)?.name !== "AbortError" && !cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const stats = useMemo(
    () => (data ? deriveStats(data, mode) : null),
    [data, mode],
  );
  return { data, loading, stats };
}

/** The heatmap and its numbers in one card, with the rest under "More detail". */
export function HeartbeatCard({ pulse }: { pulse: PulseData }) {
  const { data, loading, stats } = pulse;
  const [open, setOpen] = useState(false);
  const moreId = useId();

  return (
    <section
      aria-label={t("people.pulse.heartbeat")}
      className="rounded-2xl border border-line bg-surface-elevated p-4 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-fg">{t("people.pulse.heartbeat")}</h2>
          <LivePulse />
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={moreId}
          className="inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-accent hover:bg-surface-overlay transition-colors"
        >
          {open ? t("people.pulse.fewerStats") : t("people.pulse.moreStats")}
          <Icon
            name="chevron-right"
            size="w-4 h-4"
            className={`transition-transform ${open ? "rotate-90" : ""}`}
          />
        </button>
      </div>

      <div className="flex flex-col-reverse md:flex-row md:items-center gap-5 md:gap-10">
        <div className="shrink-0 min-w-0">
          {loading || !data ? <Skeleton className="h-32 w-60" /> : <Heatmap days={data.heatmap} />}
        </div>
        <div className="grid grid-cols-3 gap-3 sm:gap-6 flex-1 min-w-0">
          {loading || !stats
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i}>
                  <Skeleton className="h-8 w-12" />
                  <Skeleton className="h-4 w-20 mt-2" />
                </div>
              ))
            : stats.headline.map((s) => <Headline key={s.label} stat={s} />)}
        </div>
      </div>

      {open && (
        <div id={moreId} className="border-t border-line mt-5 pt-5">
          <div className={VITALS_GRID}>
            {loading || !stats || !data ? (
              Array.from({ length: VITALS_COUNT }).map((_, i) => <VitalSkeleton key={i} />)
            ) : (
              <>
                {stats.more.map((s) => (
                  <Vital key={s.label} label={s.label} value={String(s.value)} hint={s.hint} tone={s.tone} />
                ))}
                <Vitals days={data.heatmap} />
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** A big number with its label under it. */
function Headline({ stat }: { stat: Stat }) {
  return (
    <div className="min-w-0">
      <div
        className={`text-2xl sm:text-3xl font-bold tabular-nums leading-tight truncate ${STAT_VALUE_TONE[stat.tone ?? "default"]}`}
        title={String(stat.value)}
      >
        {stat.value}
      </div>
      <div className="text-sm text-fg-muted mt-1 line-clamp-2">{stat.label}</div>
    </div>
  );
}

// --------------------------------------------------------------------------- #
// Stat derivation
// --------------------------------------------------------------------------- #

export interface Stat {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "accent" | "emerald" | "amber";
}

function deriveStats(
  { pending, initiatives, heatmap }: HeaderData,
  mode: WorkspaceMode,
): { headline: Stat[]; more: Stat[] } {
  const groups = groupByRhythm(pending);
  const followups = pending.filter((a) => a.kind === "ad_hoc").length;
  const activeProjects = initiatives.filter((i) => i.status === "active").length;

  // The next thing it will do for you. Background scans fire every few
  // minutes, so counting them would make this read "Due now" all day. One
  // whose time has passed is waiting for the scheduler's next tick.
  const soonest = pending
    .filter((a) => metaFor(a).group !== "system")
    .reduce<ScheduledAction | null>(
      (best, a) => (!best || a.run_at.localeCompare(best.run_at) < 0 ? a : best),
      null,
    );
  const until = soonest ? untilNext(soonest.run_at) : null;
  const next: Stat = soonest && until
    ? {
        label: until.due
          ? t("people.pulse.nextDue", { name: nextName(soonest) })
          : t("people.pulse.nextUntil", { name: nextName(soonest) }),
        value: until.value,
        tone: "accent",
      }
    : { label: t("people.pulse.nothingScheduled"), value: "—", tone: "accent" };

  // The heatmap is oldest → newest, so the last entry is today.
  const doneToday = heatmap.length > 0 ? heatmap[heatmap.length - 1].count : 0;
  const streak = deriveVitals(heatmap).currentStreak.days;

  return {
    headline: [
      { label: t("people.pulse.doneToday"), value: doneToday, tone: "emerald" },
      next,
      { label: tp("people.pulse.inARow", streak), value: streak },
    ],
    more: [
      { label: t("people.pulse.dailyRhythms"), value: groups.daily.length },
      // Solo has no department check-ins; the projects it tracks take the slot.
      mode === "solo"
        ? { label: t("people.pulse.projects"), value: activeProjects, hint: t("people.pulse.active") }
        : { label: t("people.pulse.deptCheckIns"), value: groups.departments.length },
      { label: t("people.pulse.followUps"), value: followups },
    ],
  };
}

/** "the morning brief", "a follow-up": the next action's name, in a sentence. */
function nextName(action: ScheduledAction): string {
  if (action.kind === "ad_hoc") return t("people.pulse.nextFollowUp");
  const label = metaFor(action).label;
  return t("people.pulse.nextNamed", { label: `${label.charAt(0).toLowerCase()}${label.slice(1)}` });
}

/**
 * How long until the next action, without the "in": "12m", "3h", "2d", or
 * "Now" once it is due. Same thresholds as formatNextBeat, worked out here so
 * no language has to strip a prefix off that function's text.
 */
function untilNext(runAt: string, now: number = Date.now()): { due: boolean; value: string } {
  const at = new Date(runAt).getTime();
  if (!Number.isFinite(at)) return { due: false, value: t("people.pulse.soon") };
  const deltaMs = at - now;
  if (deltaMs < 60_000) return { due: true, value: t("people.pulse.now") };
  const mins = Math.round(deltaMs / 60_000);
  if (mins < 60) return { due: false, value: t("people.pulse.untilMinutes", { n: mins }) };
  const hours = Math.round(deltaMs / 3_600_000);
  if (hours < 48) return { due: false, value: t("people.pulse.untilHours", { n: hours }) };
  return { due: false, value: t("people.pulse.untilDays", { n: Math.round(deltaMs / 86_400_000) }) };
}

// --------------------------------------------------------------------------- #
// Vitals — summary numbers beside the heatmap, derived from the same counts
// --------------------------------------------------------------------------- #

// The three counts plus the six vitals.
const VITALS_COUNT = 9;

const TREND_TONE: Record<TrendDirection, StatTone> = {
  up: "emerald",
  down: "amber",
  flat: "default",
  new: "emerald",
  none: "default",
};

function Vital({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: StatTone;
}) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium text-fg-muted truncate">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums truncate ${STAT_VALUE_TONE[tone]}`}>
        {value}
      </div>
      {hint && <div className="text-sm text-fg-subtle mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

const VITALS_GRID = "grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5";

function Vitals({ days }: { days: DailyActivityCount[] }) {
  const v = useMemo(() => deriveVitals(days), [days]);
  const { trend } = v;

  return (
    <>
      <Vital
        label={t("people.pulse.currentStreak")}
        value={tp("people.unit.day", v.currentStreak.days)}
        hint={
          v.currentStreak.days === 0
            ? t("people.pulse.noActiveDays")
            : v.currentStreak.throughToday
              ? t("people.pulse.throughToday")
              : t("people.pulse.throughYesterday")
        }
        tone="emerald"
      />
      <Vital label={t("people.pulse.longestStreak")} value={tp("people.unit.day", v.longestStreak)} />
      <Vital
        label={t("people.pulse.dayTotal", { n: days.length })}
        value={tp("people.unit.action", v.total)}
        hint={t("people.pulse.onActiveDays", { active: v.activeDays, total: days.length })}
      />
      <Vital
        label={t("people.pulse.avgPerActiveDay")}
        value={v.avgPerActiveDay === null ? "—" : v.avgPerActiveDay.toFixed(1)}
      />
      <Vital
        label={t("people.pulse.busiestDay")}
        value={v.busiestDay ? formatVitalDate(v.busiestDay.date) : "—"}
        hint={v.busiestDay ? tp("people.unit.action", v.busiestDay.count) : undefined}
      />
      <Vital
        label={t("people.pulse.lastVsPrior", { n: trend.windowDays })}
        value={formatTrend(trend)}
        hint={trend.windowDays > 0 ? t("people.pulse.vs", { current: trend.current, prior: trend.prior }) : undefined}
        tone={TREND_TONE[trend.direction]}
      />
    </>
  );
}

function VitalSkeleton() {
  return (
    <div>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-6 w-14 mt-2" />
    </div>
  );
}

// --------------------------------------------------------------------------- #
// Heatmap — GitHub-contributions-style grid (weeks as columns, weekdays as rows)
// --------------------------------------------------------------------------- #

// Intensity → background. Step 0 is an idle cell (surface), 1–4 ramp emerald.
// These read correctly in both light and dark mode.
const LEVEL_BG = [
  "bg-surface-input/60",
  "bg-emerald-500/30",
  "bg-emerald-500/55",
  "bg-emerald-400/80",
  "bg-emerald-400",
];

// Inclusive upper bound of each non-max step; a day's count maps to the first
// step it fits under, else the top level. Length is LEVEL_BG.length − 1 so the
// two arrays stay in lockstep (steps 0..3 here, step 4 = "more than 6").
const INTENSITY_STOPS = [0, 1, 3, 6];

function intensity(count: number): number {
  for (let i = 0; i < INTENSITY_STOPS.length; i++) {
    if (count <= INTENSITY_STOPS[i]) return i;
  }
  return INTENSITY_STOPS.length; // top level (= LEVEL_BG.length − 1)
}

/** UTC weekday (0=Sun) of a YYYY-MM-DD date string. */
function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Chunk the dense day list into weekday-aligned columns of 7. */
function toWeeks(days: DailyActivityCount[]): (DailyActivityCount | null)[][] {
  if (days.length === 0) return [];
  const cells: (DailyActivityCount | null)[] = [];
  for (let i = 0; i < weekday(days[0].date); i++) cells.push(null); // lead padding
  cells.push(...days);
  while (cells.length % 7 !== 0) cells.push(null); // trailing padding
  const weeks: (DailyActivityCount | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function Heatmap({ days }: { days: DailyActivityCount[] }) {
  const weeks = useMemo(() => toWeeks(days), [days]);
  const total = useMemo(() => days.reduce((n, d) => n + d.count, 0), [days]);

  return (
    <div>
      <div
        className="flex gap-1 overflow-x-auto pb-1"
        role="img"
        aria-label={t("people.pulse.heatmapLabel", { total, n: days.length })}
      >
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((cell, di) =>
              cell === null ? (
                <div key={di} className="h-3.5 w-3.5" />
              ) : (
                <div
                  key={di}
                  className={`h-3.5 w-3.5 rounded-[4px] ${LEVEL_BG[intensity(cell.count)]}`}
                  title={`${cell.date}: ${tp("people.unit.action", cell.count)}`}
                  aria-label={`${cell.date}: ${tp("people.unit.action", cell.count)}`}
                />
              ),
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1.5 mt-2 text-xs text-fg-subtle">
        <span>{t("people.pulse.less")}</span>
        {LEVEL_BG.map((bg, i) => (
          <span key={i} className={`h-3 w-3 rounded-[3px] ${bg}`} aria-hidden="true" />
        ))}
        <span>{t("people.pulse.more")}</span>
      </div>
    </div>
  );
}
