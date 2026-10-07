"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelScheduledAction,
  getActivity,
  listScheduledActions,
  type ActivityItem,
  type ScheduledAction,
} from "@/lib/api";
import Icon, { type IconName } from "@/components/Icon";
import OverflowMenu from "@/components/ui/OverflowMenu";
import { t, tp } from "@/i18n/index.ts";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import {
  EmptyState,
  LivePulse,
  STATUS_PILL,
  statusLabel,
  SectionHeading,
  Skeleton,
  type TagTone,
  formatRunAt,
  groupByRhythm,
  metaFor,
  showsRhythm,
} from "./shared";
import FeatureName from "@/components/FeatureName";

// The "how it runs" half of the Pulse page. The rhythm taxonomy (KIND_META /
// metaFor / groupByRhythm) now lives in ./shared so the header stat strip and
// these cards agree on how raw scheduled_actions `kind`s map to human groups.
//
// The Heartbeat tab of the Pulse page has three views, each its own export:
// Activity (`RecentActivity`), Rhythm (the default export) and Follow-ups
// (`FollowUpsCard`). The rhythm card shows the *pending* queue only (the
// upcoming cadence), fetched soonest-first; follow-ups (ad_hoc one-offs) are
// their own view.

// Over-fetch cap. The backend can't filter by `kind`, so we pull a generous
// slice and group client-side; high-frequency system scans are capped at render
// time (see SystemPulse) so they can't bury the user-facing groups.
const FETCH_LIMIT = 500;

// ---------------------------------------------------------------------------
// Section shell
// ---------------------------------------------------------------------------

export default function RhythmSection() {
  // Solo hides the department check-ins and the awaiting-people block.
  const { mode } = useWorkspace();
  const [rows, setRows] = useState<ScheduledAction[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      // Pending only — the upcoming cadence, soonest-first.
      const data = await listScheduledActions("pending", FETCH_LIMIT, signal, "asc");
      if (!signal?.aborted) setRows(data);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      if (!signal?.aborted) setRows([]);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  // groupByRhythm sorts each group soonest-first and deliberately drops ad_hoc
  // (those are the Follow-ups, now their own card under Memory).
  const groups = useMemo(() => groupByRhythm(rows), [rows]);

  // Whether any rhythm group has rows to show. We gate the empty-state on this
  // rather than `rows.length`, because `rows` still contains the ad_hoc
  // follow-ups (dropped by groupByRhythm) — without this, a queue of only
  // follow-ups would render an empty padded card instead of the empty message.
  const hasRhythm =
    groups.daily.length > 0 ||
    (showsRhythm("departments", mode) && groups.departments.length > 0) ||
    (showsRhythm("awaiting", mode) && groups.awaiting.length > 0) ||
    groups.system.length > 0;

  return (
    <div>
      <div className="rounded-2xl border border-line bg-surface-elevated p-4 sm:p-5">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !hasRhythm ? (
          <div className="px-2 py-8 text-center text-[15px] text-fg-muted">
            {t("people.cadence.empty")}
          </div>
        ) : (
          <div className="space-y-8">
            <RhythmBlock
              title={t("people.cadence.dailyTitle")}
              subtitle={t("people.cadence.dailySubtitle")}
              icon="clipboard"
              tag={t("people.cadence.dailyTag")}
              tagTone="info"
              actions={groups.daily}
            />
            {showsRhythm("departments", mode) && (
              <RhythmBlock
                title={t("people.cadence.deptTitle")}
                subtitle={t("people.cadence.deptSubtitle")}
                icon="grid"
                actions={groups.departments}
                showDepartment
              />
            )}

            {showsRhythm("awaiting", mode) && (
              <RhythmBlock
                title={t("people.cadence.awaitingTitle")}
                subtitle={t("people.cadence.awaitingSubtitle")}
                icon="bell"
                actions={groups.awaiting}
              />
            )}

            <SystemPulse actions={groups.system} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent activity — the literal heartbeat. A live timeline of the most recent
// self-initiated actions (reuses GET /today/activity). Independent of the
// status filter — it's always the live "what just happened" feed.
// ---------------------------------------------------------------------------

// One-line verb + subject for an activity item — the `kind` decides the verb;
// `subject` names who/what it was directed at. Ported from the Briefing rail
// (now removed) so the Pulse shows the same rich rows. The full summary is
// always rendered as the body, so no information is lost.
function activityLine(item: ActivityItem): { verb: string; subject: string } {
  switch (item.kind) {
    case "dm_sent":
      return { verb: t("people.activity.dmd"), subject: item.target ?? t("people.activity.aColleague") };
    case "email_sent":
      return { verb: t("people.activity.emailed"), subject: item.target ?? t("people.activity.aColleague") };
    case "nudge_sent":
      return { verb: t("people.activity.nudged"), subject: item.target ?? t("people.activity.aStalledItem") };
    case "cadence_sent":
      return { verb: t("people.activity.ranCadence"), subject: item.department ?? t("people.activity.aDepartment") };
    case "workflow_resumed":
      return { verb: t("people.activity.resumedWorkflow"), subject: item.target ?? t("people.activity.someone") };
    case "proposal_routed":
      // propose_only path — backend marked the action done without dispatching,
      // so describe the intent ("proposed to X") rather than implying a send.
      return { verb: t("people.activity.proposedTo"), subject: item.target ?? t("people.activity.anApprover") };
    case "decision_logged":
      return { verb: t("people.activity.loggedDecision"), subject: item.summary };
    case "advice_given":
      return { verb: t("people.activity.advisedOn"), subject: item.summary };
    case "workflow_done":
      return { verb: t("people.activity.completed"), subject: item.summary };
    case "initiative_started":
      return { verb: t("people.activity.kickedOff"), subject: item.summary };
    case "decision_resolved":
      return { verb: t("people.activity.resolvedDecision"), subject: item.summary };
    case "alert_raised":
      return { verb: t("people.activity.raisedAlert"), subject: item.summary };
    case "took_the_lead":
      return { verb: t("people.activity.tookTheLead"), subject: item.summary };
    case "sent_as_you":
      return { verb: t("people.activity.sentAsYou"), subject: item.summary };
    default:
      return { verb: t("people.activity.actedOn"), subject: item.summary };
  }
}

// Kinds whose `subject` IS the full summary: the body row renders the text, so
// the inline subject span is suppressed to avoid repeating it (only the verb
// shows inline). Kept beside activityLine so adding a kind is a one-place edit.
const SUMMARY_KINDS = new Set([
  "decision_logged",
  "advice_given",
  "action",
  "workflow_done",
  "initiative_started",
  "decision_resolved",
  "alert_raised",
  "took_the_lead",
  "sent_as_you",
]);

// Take the lead and Handle it for me rows say whose name it acted in.
function actingAs(item: ActivityItem): string | null {
  if (item.kind === "sent_as_you") return t("people.activity.asYou");
  if (item.kind === "took_the_lead") return t("people.activity.asExecutive");
  return null;
}

// Live activity refreshes on this cadence so new events stream into the feed
// without a reload (mirrors the departments page poll). Kept modest — the feed
// is read-only and the payload is small.
const ACTIVITY_POLL_INTERVAL_MS = 20_000;

export function RecentActivity() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // The Pulse is the single home for recent activity (removed from the
    // Briefing), so pull a generous slice (the list scrolls internally) and
    // then refresh on an interval so the feed stays live.
    const load = () => {
      getActivity(100)
        .then((res) => {
          if (!cancelled) setItems(res.items);
        })
        .catch(() => {
          // Swallow transient errors — keep the last good list and let the
          // next tick retry rather than blanking the feed.
        })
        .finally(() => {
          // Only the first load drives the skeleton; interval refreshes update
          // silently so the feed doesn't flash on every tick.
          if (!cancelled) setLoading(false);
        });
    };

    load();
    const interval = window.setInterval(load, ACTIVITY_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-line bg-surface-elevated p-4 sm:p-5 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface-elevated">
        <EmptyState message={t("people.activity.empty")} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface-elevated p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Icon name="activity" size="w-5 h-5" className="text-emerald-500" />
          <h3 className="text-base font-semibold text-fg">{t("people.activity.title")}</h3>
        </div>
        <LivePulse />
      </div>
      {/* The timeline line lives on the <ol> (sized to the full list). */}
      <div>
        <ol className="relative space-y-4 before:absolute before:left-[3px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-line">
          {items.map((it, i) => {
            const { relative } = formatRunAt(it.at);
            const { verb, subject } = activityLine(it);
            // For summary-style kinds the subject IS the summary, so don't
            // repeat it inline — the body row below carries the text.
            const subjectIsSummary = SUMMARY_KINDS.has(it.kind);
            return (
              <li key={`${it.at}-${it.kind}-${i}`} className="relative pl-5">
                <span
                  className="absolute left-0 top-2 h-[7px] w-[7px] rounded-full bg-emerald-500/80 ring-2 ring-surface-elevated"
                  aria-hidden="true"
                />
                <div className="flex items-baseline gap-2 flex-wrap">
                  {relative && (
                    <span className="text-xs text-fg-subtle tabular-nums">{relative}</span>
                  )}
                  {actingAs(it) && (
                    <>
                      <FeatureName
                        feature={it.kind === "sent_as_you" ? "handle_it" : "take_the_lead"}
                        className="text-xs"
                      />
                      <span className="text-xs font-semibold text-fg-muted">{actingAs(it)}</span>
                    </>
                  )}
                  <span className="text-sm text-fg-muted">{verb}</span>
                  {!subjectIsSummary && (
                    <span className="text-sm text-fg" title={subject}>{subject}</span>
                  )}
                  {it.department && (
                    <span className="ml-auto text-xs text-fg-subtle hidden sm:inline capitalize">
                      {it.department}
                    </span>
                  )}
                </div>
                {it.summary && (
                  <p className="text-[15px] text-fg leading-snug break-words line-clamp-2 mt-0.5" title={it.summary}>
                    {it.summary}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only rhythm cards (recurring briefs, dept check-ins, awaiting items).
// ---------------------------------------------------------------------------

function RhythmBlock({
  title,
  subtitle,
  icon,
  tag,
  tagTone,
  actions,
  showDepartment = false,
}: {
  title: string;
  subtitle: string;
  icon: IconName;
  tag?: string;
  tagTone?: TagTone;
  actions: ScheduledAction[];
  showDepartment?: boolean;
}) {
  if (actions.length === 0) return null;
  return (
    <section>
      <SectionHeading
        title={title}
        count={actions.length}
        icon={icon}
        tag={tag}
        tagTone={tagTone}
        subtitle={subtitle}
      />
      <div className="divide-y divide-line">
        {actions.map((a) => (
          <RhythmCard key={a.id} action={a} showDepartment={showDepartment} />
        ))}
      </div>
    </section>
  );
}

function RhythmCard({
  action,
  showDepartment,
}: {
  action: ScheduledAction;
  showDepartment: boolean;
}) {
  const meta = metaFor(action);
  const { absolute, relative } = formatRunAt(action.run_at);
  const isPending = action.status === "pending";
  return (
    <div className="py-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] text-fg font-semibold" title={meta.label}>{meta.label}</span>
          {showDepartment && action.department && (
            <span className="px-2 py-0.5 rounded-lg bg-surface-overlay text-fg text-xs font-medium capitalize">
              {action.department}
            </span>
          )}
        </div>
        {meta.blurb && (
          <div className="text-sm text-fg-muted mt-0.5 line-clamp-2" title={meta.blurb}>
            {meta.blurb}
          </div>
        )}
        {action.last_error && action.status === "failed" && (
          <div className="text-sm text-red-500 mt-1 font-mono break-words">
            {action.last_error}
          </div>
        )}
      </div>
      <div className="text-right whitespace-nowrap shrink-0">
        {isPending ? (
          <div className="text-sm font-medium text-sky-500" title={absolute}>
            {relative ? t("people.cadence.next", { relative }) : absolute}
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <span
              className={`px-2 py-0.5 rounded border text-[10px] font-medium capitalize ${
                STATUS_PILL[action.status] ?? STATUS_PILL.cancelled
              }`}
            >
              {statusLabel(action.status)}
            </span>
            <span className="text-xs text-fg-subtle" title={absolute}>
              {relative || absolute}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System pulse — the literal heartbeat (internal scans). Shown like the other
// rhythm groups (shared SectionHeading) and always expanded. Capped at render
// time: under done/all these fire every few minutes, so an uncapped list would
// bury the user-facing groups above.
// ---------------------------------------------------------------------------

const SYSTEM_PULSE_CAP = 50;

function SystemPulse({ actions }: { actions: ScheduledAction[] }) {
  if (actions.length === 0) return null;
  const shown = actions.slice(0, SYSTEM_PULSE_CAP);
  const hidden = actions.length - shown.length;
  return (
    <section>
      <SectionHeading
        title={t("people.cadence.systemTitle")}
        count={actions.length}
        icon="activity"
        tag={t("people.cadence.systemTag")}
        tagTone="muted"
        subtitle={t("people.cadence.systemSubtitle")}
      />
      <div className="divide-y divide-line">
        {shown.map((a) => (
          <RhythmCard key={a.id} action={a} showDepartment={false} />
        ))}
      </div>
      {hidden > 0 && (
        <div className="text-sm text-fg-subtle mt-2">{t("people.cadence.moreNotShown", { n: hidden })}</div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Follow-ups — one-off ad_hoc commitments, the Follow-ups view of the Pulse
// page's Heartbeat tab. Self-contained: fetches the pending queue itself
// (independent of the rhythm card) and owns the per-row cancel.
// ---------------------------------------------------------------------------
export function FollowUpsCard() {
  const [rows, setRows] = useState<ScheduledAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  // Bumped after a cancel to retrigger the AbortController-guarded fetch effect.
  const [reloadNonce, setReloadNonce] = useState(0);

  // `loading` is only ever true for the first load (initial state). Refetches
  // (after a cancel) deliberately DON'T flip it back to true, so the list stays
  // visible and the cancelled row just drops out when fresh data arrives —
  // rather than flashing a skeleton mid-cancel.
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await listScheduledActions("pending", FETCH_LIMIT, signal, "asc");
      if (!signal?.aborted) setRows(data);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      if (!signal?.aborted) setRows([]);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, reloadNonce]);

  const handleCancel = useCallback(async (id: number) => {
    if (!window.confirm(t("people.followUps.cancelConfirm"))) return;
    setCancellingId(id);
    try {
      await cancelScheduledAction(id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t("people.followUps.cancelFailed"));
      setCancellingId(null);
      return;
    }
    setCancellingId(null);
    setReloadNonce((n) => n + 1);
  }, []);

  // ad_hoc one-offs, soonest-first (groupByRhythm deliberately drops these).
  const followups = useMemo(() => {
    const f = rows.filter((r) => r.kind === "ad_hoc");
    f.sort((a, b) => a.run_at.localeCompare(b.run_at));
    return f;
  }, [rows]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-line bg-surface-elevated p-4 sm:p-5 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (followups.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface-elevated">
        <EmptyState message={t("people.followUps.empty")} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface-elevated p-4 sm:p-5">
      <SectionHeading
        title={t("people.pulse.followUps")}
        count={followups.length}
        icon="flag"
        subtitle={t("people.followUps.subtitle")}
      />
      <div className="divide-y divide-line">
        {followups.map((a) => (
          <FollowUpRow
            key={a.id}
            action={a}
            cancelling={cancellingId === a.id}
            onCancel={() => handleCancel(a.id)}
          />
        ))}
      </div>
    </div>
  );
}

function FollowUpRow({
  action,
  cancelling,
  onCancel,
}: {
  action: ScheduledAction;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const { absolute, relative } = formatRunAt(action.run_at);
  const pill = STATUS_PILL[action.status] ?? STATUS_PILL.cancelled;
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 text-sm text-fg-muted flex-wrap min-w-0 pt-2">
          <span className={`px-2 py-0.5 rounded border font-medium capitalize ${pill}`}>
            {statusLabel(action.status)}
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-surface-overlay text-fg font-medium">
            {action.channel}
          </span>
          <span className="text-fg-subtle">→</span>
          <span className="text-fg-muted font-mono text-xs truncate max-w-[12rem]" title={action.channel_ref}>{action.channel_ref}</span>
          <span title={absolute}>{relative || absolute}</span>
          {action.attempts > 0 && (
            <span className="text-amber-400">{tp("people.followUps.attempts", action.attempts)}</span>
          )}
        </div>
        {action.status === "pending" &&
          (cancelling ? (
            <span className="shrink-0 h-10 inline-flex items-center text-sm text-fg-muted">{t("people.followUps.cancelling")}</span>
          ) : (
            <OverflowMenu
              size="sm"
              label={t("people.followUps.menu")}
              items={[{ label: t("people.followUps.cancel"), danger: true, onSelect: onCancel }]}
            />
          ))}
      </div>
      <div className="text-[15px] text-fg break-words line-clamp-2" title={action.intent_text}>
        {action.intent_text}
      </div>
      {action.last_error && (
        <div className="text-sm text-red-500 mt-2 font-mono break-words line-clamp-2" title={action.last_error}>
          {action.last_error}
        </div>
      )}
      {action.originating_session_id && (
        <div className="text-xs text-fg-subtle mt-2 font-mono truncate" title={t("people.followUps.session", { id: action.originating_session_id })}>
          {t("people.followUps.session", { id: action.originating_session_id })}
        </div>
      )}
    </div>
  );
}
