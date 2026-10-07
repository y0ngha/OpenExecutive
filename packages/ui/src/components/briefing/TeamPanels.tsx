"use client";

import Link from "next/link";
import { useState } from "react";

import { t, tp, type MessageKey } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";
import type { DepartmentBriefItem, PersonBriefItem } from "@/lib/api";

import { Chip, ClickableBriefingItem, PanelIntro, TONE_TEXT, formatRelTime, type ContinueHandler } from "./shared";

// The team-only side panels behind Home's Departments and People tiles.

export function DeptCard({
  dept,
  onContinue,
  dimmed = false,
}: {
  dept: DepartmentBriefItem;
  onContinue?: ContinueHandler;
  dimmed?: boolean;
}) {
  const hasIssues = dept.at_risk_count > 0 || dept.off_track_count > 0;
  const prompt = `Tell me about ${dept.title} — what's the current status?`;
  // Problem goals beyond the inline cap fall to the department page.
  const attentionGoalOverflow =
    dept.at_risk_count + dept.off_track_count - (dept.attention_goals?.length ?? 0);
  return (
    <ClickableBriefingItem
      onContinue={onContinue}
      prompt={prompt}
      href={`/departments/${dept.slug}`}
      className={`block group rounded-xl -mx-2 px-2 py-3.5 hover:bg-surface-overlay transition-colors${dimmed ? " opacity-60 hover:opacity-100" : ""}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-base font-semibold text-fg group-hover:text-accent transition-colors" title={dept.title}>
          {dept.title}
        </div>
        <span className="flex-shrink-0 text-xs text-fg-muted">{dept.authority_level.replace("_", " ")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-muted">{tp("briefing.dept.goals", dept.goal_count)}</span>
        {dept.at_risk_count > 0 && <Chip tone="amber">{t("briefing.dept.atRiskCount", { n: dept.at_risk_count })}</Chip>}
        {dept.off_track_count > 0 && (
          <Chip tone="rose">{t("briefing.dept.offTrackCount", { n: dept.off_track_count })}</Chip>
        )}
        {!hasIssues && dept.goal_count > 0 && <Chip tone="emerald">{t("briefing.home.onTrack")}</Chip>}
        {dept.awaiting_count > 0 && <Chip tone="sky">{t("briefing.dept.awaitingCount", { n: dept.awaiting_count })}</Chip>}
      </div>
      {/* The actual off-track / at-risk goals, inline — so the row is
          insightful at rest instead of a count you have to click into. */}
      {dept.attention_goals && dept.attention_goals.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-line pt-2.5">
          {dept.attention_goals.map((g, i) => (
            <div key={i} className="flex items-start gap-2 text-sm leading-snug">
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${g.status === "off_track" ? "bg-rose-400" : "bg-amber-400"}`}
              />
              <span className="min-w-0">
                <span className="text-fg">{g.key_result}</span>
                {(g.current || g.target) && (
                  <span className="text-fg-subtle">
                    {t("briefing.dept.versus", { current: g.current || "—", target: g.target || "—" })}
                  </span>
                )}
              </span>
            </div>
          ))}
          {attentionGoalOverflow > 0 && <div className="pl-4 text-xs text-fg-subtle">{t("briefing.dept.more", { n: attentionGoalOverflow })}</div>}
        </div>
      )}
    </ClickableBriefingItem>
  );
}

// Departments: those needing attention first; healthy and inactive ones fold
// into one quiet toggle.
export function DepartmentsPanelBody({
  departments,
  onContinue,
}: {
  departments: DepartmentBriefItem[];
  onContinue?: ContinueHandler;
}) {
  const [showQuiet, setShowQuiet] = useState(false);
  const active = departments.filter((d) => d.goal_count > 0 || d.awaiting_count > 0);
  const inactive = departments.filter((d) => d.goal_count === 0 && d.awaiting_count === 0);
  const attention = active.filter((d) => d.at_risk_count > 0 || d.off_track_count > 0 || d.awaiting_count > 0);
  const onTrack = active.filter((d) => d.at_risk_count === 0 && d.off_track_count === 0 && d.awaiting_count === 0);
  const quietCount = onTrack.length + inactive.length;
  const quietSummary = [
    onTrack.length > 0 ? t("briefing.dept.onTrackCount", { n: onTrack.length }) : null,
    inactive.length > 0 ? t("briefing.dept.inactiveCount", { n: inactive.length }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <PanelIntro>
        {tRich("briefing.dept.intro", {
          atRisk: <span className={TONE_TEXT.amber}>{t("briefing.dept.legendAtRisk")}</span>,
          offTrack: <span className={TONE_TEXT.rose}>{t("briefing.dept.legendOffTrack")}</span>,
          awaiting: <span className={TONE_TEXT.sky}>{t("briefing.dept.legendAwaiting")}</span>,
          inactive: <span className="text-fg">{t("briefing.dept.legendInactive")}</span>,
        })}
      </PanelIntro>
      {active.length === 0 && (
        <div className="py-3">
          <p className="mb-2 text-[15px] text-fg-muted">{t("briefing.dept.noneActive")}</p>
          <Link href="/departments" className="text-sm font-medium text-accent hover:underline">
            {t("briefing.dept.pickOne")}
          </Link>
        </div>
      )}
      {attention.length > 0 && (
        <div className="divide-y divide-line">
          {attention.map((d) => (
            <DeptCard key={d.slug} dept={d} onContinue={onContinue} />
          ))}
        </div>
      )}
      {quietCount > 0 && (
        <div className={attention.length > 0 ? "mt-3 border-t border-line pt-2" : ""}>
          <button
            type="button"
            onClick={() => setShowQuiet((v) => !v)}
            aria-expanded={showQuiet}
            className="flex min-h-[44px] items-center gap-2 text-sm font-medium text-fg-muted hover:text-fg transition-colors"
          >
            <span aria-hidden="true" className={`text-xs transition-transform ${showQuiet ? "rotate-90" : ""}`}>
              ▸
            </span>
            {quietSummary}
          </button>
          {showQuiet && (
            <div className="divide-y divide-line">
              {onTrack.map((d) => (
                <DeptCard key={d.slug} dept={d} onContinue={onContinue} />
              ))}
              {inactive.map((d) => (
                <DeptCard key={d.slug} dept={d} onContinue={onContinue} dimmed />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Compact label for an authority-scope token (see people/models.py).
const AUTHORITY_LABELS: Record<string, MessageKey> = {
  spend_lt_2k: "briefing.authority.spendLt2k",
  spend_lt_10k: "briefing.authority.spendLt10k",
  spend_gt_10k: "briefing.authority.spendGt10k",
  hiring_signoff: "briefing.authority.hiring",
  vendor_onboarding: "briefing.authority.vendors",
  customer_credit: "briefing.authority.credit",
  legal_sign: "briefing.authority.legal",
  board_comms: "briefing.authority.board",
  meeting_scheduling: "briefing.authority.meetings",
  wildcard: "briefing.authority.all",
};

function authorityLabel(token: string): string {
  const key = AUTHORITY_LABELS[token];
  return key ? t(key) : token;
}

// Status chip text + tone. `overdue` repaints the attention states red.
function personStatusChip(person: PersonBriefItem): { label: string; tone: "rose" | "amber" | "sky" | "neutral" } | null {
  switch (person.status) {
    case "needs_reply":
      return {
        label:
          person.awaiting_reply_count > 1
            ? t("briefing.person.awaitingReplyCount", { n: person.awaiting_reply_count })
            : t("briefing.person.awaitingReply"),
        tone: person.overdue ? "rose" : "amber",
      };
    case "awaiting":
      return { label: t("briefing.person.toAction", { n: person.awaiting_count }), tone: person.overdue ? "rose" : "sky" };
    case "on_leave":
      return { label: t("briefing.person.onLeave"), tone: "neutral" };
    default:
      return null; // "clear" — no chip, shown as subtle text instead
  }
}

function PersonRow({ person }: { person: PersonBriefItem }) {
  const chip = personStatusChip(person);
  const pills = person.authority_scope.slice(0, 2);
  const extraPills = person.authority_scope.length - pills.length;
  return (
    <Link
      href={`/people/${person.id}`}
      className="block group rounded-xl -mx-2 px-2 py-3.5 hover:bg-surface-overlay transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600">
            <span className="text-sm font-bold text-white">{person.full_name.charAt(0)}</span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium text-fg">{person.full_name}</div>
            <div className="truncate text-sm text-fg-muted">{person.role}</div>
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          {chip ? <Chip tone={chip.tone}>{chip.label}</Chip> : <span className="text-sm text-fg-subtle">{t("briefing.person.clear")}</span>}
          {chip && person.status === "awaiting" && person.soonest_sla_at && (
            <div className={`mt-0.5 text-xs ${person.overdue ? TONE_TEXT.rose : "text-fg-muted"}`}>
              {person.overdue
                ? t("briefing.person.slaOverdue")
                : t("briefing.person.slaIn", { when: formatRelTime(person.soonest_sla_at) })}
            </div>
          )}
        </div>
      </div>

      {person.insight && <p className="mt-2 text-sm leading-snug text-fg-muted line-clamp-2">{person.insight}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {person.status !== "on_leave" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
            <span className={`h-2 w-2 rounded-full ${person.reachable_now ? "bg-emerald-400" : "bg-slate-500"}`} />
            {person.reachable_now
              ? t("briefing.person.available")
              : person.next_window_at
                ? t("briefing.person.backIn", { when: formatRelTime(person.next_window_at) })
                : t("briefing.person.away")}
          </span>
        )}
        {pills.map((tok) => (
          <span key={tok} className="rounded-md border border-line bg-surface-overlay px-1.5 py-px text-[11px] text-fg-subtle">
            {authorityLabel(tok)}
          </span>
        ))}
        {extraPills > 0 && <span className="text-[11px] text-fg-subtle">+{extraPills}</span>}
      </div>
    </Link>
  );
}

// One-line roster summary: the People tile's sub-line and the panel's.
export function peopleSummary(people: PersonBriefItem[]): { text: string; hasOverdue: boolean } {
  const needsReply = people.filter((p) => p.status === "needs_reply").length;
  const awaiting = people.filter((p) => p.status === "awaiting").length;
  const onLeave = people.filter((p) => p.status === "on_leave").length;
  const overdue = people.filter((p) => p.overdue).length;
  const parts: string[] = [];
  if (needsReply > 0) parts.push(t("briefing.person.toReplyCount", { n: needsReply }));
  if (awaiting > 0) parts.push(t("briefing.person.toAction", { n: awaiting }));
  if (overdue > 0) parts.push(t("briefing.home.overdueCount", { n: overdue }));
  if (onLeave > 0) parts.push(t("briefing.person.onLeaveCount", { n: onLeave }));
  return { text: parts.length > 0 ? parts.join(" · ") : t("briefing.person.allClear"), hasOverdue: overdue > 0 };
}

export function PeoplePanelBody({ people }: { people: PersonBriefItem[] }) {
  const summary = peopleSummary(people);
  return (
    <>
      <p className={`mb-2 text-[15px] ${summary.hasOverdue ? TONE_TEXT.rose : "text-fg-muted"}`}>{summary.text}</p>
      <div className="divide-y divide-line">
        {people.map((p) => (
          <PersonRow key={p.id} person={p} />
        ))}
      </div>
    </>
  );
}
