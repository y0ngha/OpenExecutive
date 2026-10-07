"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  getActivityDaily,
  listAdvice,
  listDecisions,
  listInitiatives,
  listScheduledActions,
  type DailyActivityCount,
  type ScheduledAction,
  type WorkspaceMode,
} from "@/lib/api";
import Icon from "@/components/Icon";
import { t, tp } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import {
  deriveVitals,
  formatNextBeat,
  formatTrend,
  formatVitalDate,
  type TrendDirection,
} from "@/lib/heartbeatVitals";
import {
  LivePulse,
  STAT_VALUE_TONE,
  Skeleton,
  StatTile,
  groupByRhythm,
  metaFor,
  type StatTone,
} from "./shared";

// The Pulse page's at-a-glance numbers and its "heartbeat" — a
// GitHub-contributions-style heatmap of the Executive's self-initiated
// activity over the last 90 days. Up front sit three headline numbers (beats
// today, next beat, memories); the rest (rhythm counts and the vitals derived
// from the heatmap: streaks, totals, trend) sit under "More stats". Every
// metric is derived from data the page already needs (pending scheduled
// actions + the three memory lists); only the per-day heatmap requires its own
// endpoint, since /today/activity returns the last-N items, not a daily
// timeline. What peer memory learned about the signed-in person is theirs
// alone (Settings → About you), so it is not counted here.

const HEATMAP_DAYS = 90;

interface HeaderData {
  pending: ScheduledAction[];
  memoriesTotal: number;
  /** Initiatives with status "active" — solo's stand-in for dept check-ins. */
  activeProjects: number;
  heatmap: DailyActivityCount[];
}

export interface PulseData {
  data: HeaderData | null;
  loading: boolean;
  /** Headline numbers first, then the ones under "More stats". */
  stats: { headline: Stat[]; more: Stat[] } | null;
}

/** Loads everything the Pulse numbers and heatmap need, once per page. */
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
        setData({
          pending,
          memoriesTotal: decisions.length + initiatives.length + advice.length,
          activeProjects: initiatives.filter((i) => i.status === "active").length,
          heatmap: daily.days,
        });
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

/** The three headline numbers, with the rest folded under "More stats". */
export function PulseSummary({ pulse }: { pulse: PulseData }) {
  const { data, loading, stats } = pulse;
  const [open, setOpen] = useState(false);
  const moreId = useId();

  return (
    <section aria-label={t("people.pulse.atAGlance")} className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {loading || !stats
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-line bg-surface-elevated px-4 py-4 sm:px-5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-12 mt-2" />
              </div>
            ))
          : stats.headline.map((s) => (
              <StatTile key={s.label} label={s.label} value={s.value} hint={s.hint} tone={s.tone} />
            ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={moreId}
        className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay transition-colors"
      >
        <Icon
          name="chevron-right"
          size="w-4 h-4"
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        />
        {open ? t("people.pulse.fewerStats") : t("people.pulse.moreStats")}
      </button>

      {open && (
        <div id={moreId} className="rounded-2xl border border-line bg-surface-elevated p-4 sm:p-5 space-y-5">
          <div className={VITALS_GRID}>
            {loading || !stats
              ? Array.from({ length: 3 }).map((_, i) => <VitalSkeleton key={i} />)
              : stats.more.map((s) => (
                  <Vital key={s.label} label={s.label} value={String(s.value)} hint={s.hint} tone={s.tone} />
                ))}
          </div>
          <div className="border-t border-line pt-5">
            <h3 className="text-sm font-semibold text-fg mb-3">
              {t("people.pulse.heartbeatLastDays", { n: HEATMAP_DAYS })}
            </h3>
            {loading || !data ? <VitalsSkeleton /> : <Vitals days={data.heatmap} />}
          </div>
        </div>
      )}
    </section>
  );
}

/** The heatmap card at the top of the Heartbeat tab. */
export function HeartbeatCard({ pulse }: { pulse: PulseData }) {
  const { data, loading } = pulse;
  const vitals = useMemo(() => (data ? deriveVitals(data.heatmap) : null), [data]);
  return (
    <section className="rounded-2xl border border-line bg-surface-elevated p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-fg">{t("people.pulse.heartbeat")}</h2>
          <span className="text-sm text-fg-subtle">{t("people.pulse.lastDays", { n: HEATMAP_DAYS })}</span>
        </div>
        <LivePulse />
      </div>
      <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-8">
        <div className="shrink-0 min-w-0">
          {loading || !data ? <Skeleton className="h-32 w-60" /> : <Heatmap days={data.heatmap} />}
        </div>
        {vitals && data && (
          <p className="text-[15px] text-fg-muted leading-relaxed">
            {tRich("people.pulse.beatsOnDays", {
              beats: <span className="text-fg font-semibold">{tp("people.unit.beat", vitals.total)}</span>,
              active: vitals.activeDays,
              total: data.heatmap.length,
            })}
            <br />
            {tRich("people.pulse.currentStreakLine", {
              days: <span className="text-fg font-semibold">{tp("people.unit.day", vitals.currentStreak.days)}</span>,
            })}
          </p>
        )}
      </div>
    </section>
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
  { pending, memoriesTotal, activeProjects, heatmap }: HeaderData,
  mode: WorkspaceMode,
): { headline: Stat[]; more: Stat[] } {
  const groups = groupByRhythm(pending);
  const followups = pending.filter((a) => a.kind === "ad_hoc").length;

  // Soonest pending fire = the literal "next beat". One whose time has
  // passed is waiting for the scheduler's next tick, so it reads "Due now".
  const soonest = pending.reduce<ScheduledAction | null>((best, a) => {
    if (!best) return a;
    return a.run_at.localeCompare(best.run_at) < 0 ? a : best;
  }, null);
  const nextBeat = soonest
    ? { value: formatNextBeat(soonest.run_at) || t("people.pulse.soon"), hint: metaFor(soonest).label }
    : { value: "—", hint: t("people.pulse.nothingScheduled") };

  // The heatmap is oldest → newest, so the last entry is today.
  const beatsToday = heatmap.length > 0 ? heatmap[heatmap.length - 1].count : 0;

  // The three episodic lists the Memory tabs show.
  const memories: Stat = { label: t("people.pulse.memories"), value: memoriesTotal, hint: t("people.pulse.memoriesHint") };

  return {
    headline: [
      { label: t("people.pulse.beatsToday"), value: beatsToday, tone: "emerald", hint: t("people.pulse.actionsFired") },
      { label: t("people.pulse.nextBeat"), value: nextBeat.value, tone: "accent", hint: nextBeat.hint },
      memories,
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

// --------------------------------------------------------------------------- #
// Vitals — summary numbers beside the heatmap, derived from the same counts
// --------------------------------------------------------------------------- #

const VITALS_COUNT = 6;

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
    <div className={VITALS_GRID}>
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
        value={tp("people.unit.beat", v.total)}
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
    </div>
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

function VitalsSkeleton() {
  return (
    <div className={VITALS_GRID}>
      {Array.from({ length: VITALS_COUNT }).map((_, i) => (
        <VitalSkeleton key={i} />
      ))}
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
