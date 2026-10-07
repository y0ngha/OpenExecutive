"use client";

import Link from "next/link";

import Button from "@/components/ui/Button";
import { t } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";
import OverflowMenu from "@/components/ui/OverflowMenu";
import type { ClientCockpitCard, HandledItem, InFlightItem, ProposalItem } from "@/lib/api";
import { MEMORY_ACTIONS, briefingMemoryLine } from "@/lib/briefing-memory";
import { ageLabel } from "@/lib/briefingSummary";
import {
  HANDLED_REOPENABLE,
  groupHandled,
  handledAlsoLine,
  handledHeadline,
  handledKey,
  handledProofHref,
  isCloseKind,
  type HandledRow,
} from "@/lib/handled";
import { clientCountsSummary, renewalBadge } from "@/lib/practice";

import {
  Chip,
  MONITORING_DISMISS_OLDER_THAN_DAYS,
  PanelIntro,
  TONE_TEXT,
  buildMonitoringSeed,
  formatFuture,
  olderThan,
  type ContinueHandler,
} from "./shared";

// The side panels behind Home's awareness tiles: In flight, Across your
// clients, Monitoring and Handled overnight. Each holds the section's full
// list and every button it had on the page.

// In flight — what the Executive is about to do (scheduled follow-ups &
// nudges). Nothing here needs approval; it's a heads-up.
export function InFlightPanelBody({ inFlight }: { inFlight: InFlightItem[] }) {
  return (
    <>
      <PanelIntro>
        {t("briefing.inFlight.intro")}
      </PanelIntro>
      <div className="divide-y divide-line">
        {inFlight.map((f) => (
          <div
            key={`if-${f.action_id}`}
            className={`py-3.5 pl-3 border-l-2 ${f.overdue ? "border-amber-500/60" : "border-transparent"}`}
          >
            <div className="text-[15px] text-fg break-words" title={f.intent}>
              {f.intent}
            </div>
            <div className="mt-1 text-sm text-fg-muted">
              {f.target ? <span>→ {f.target}</span> : null}
              {f.department ? <span> · {f.department}</span> : null}
              <span>
                {" · "}
                {f.overdue ? <span className={TONE_TEXT.amber}>{t("briefing.inFlight.overdue")}</span> : formatFuture(f.run_at)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// The In flight tile's sub-line: overdue first, else when the next one runs.
export function inFlightNext(inFlight: InFlightItem[]): string {
  const overdue = inFlight.filter((f) => f.overdue).length;
  if (overdue > 0) return t("briefing.home.overdueCount", { n: overdue });
  const next = inFlight
    .map((f) => Date.parse(f.run_at))
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => a - b)[0];
  return next == null
    ? t("briefing.inFlight.scheduled")
    : t("briefing.inFlight.next", { when: formatFuture(new Date(next).toISOString()) });
}

// Multi-client practice mode only: rollup rows for PARKED client slots so
// the operator sees the whole practice from the active client's brief. The
// backend sends [] for single-company installs, so the tile never shows there.
export function PracticeClientsPanelBody({ clients }: { clients: ClientCockpitCard[] }) {
  return (
    <>
      <PanelIntro>
        {t("briefing.clients.intro")}
      </PanelIntro>
      <div className="divide-y divide-line">
        {clients.map((c) => {
          const badge = renewalBadge(c.days_to_renewal);
          return (
            <div key={`practice-${c.slug}`} className="py-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-[15px] font-medium text-fg">
                  {c.display_name}
                  {c.role ? <span className="font-normal text-fg-muted"> · {c.role}</span> : null}
                </div>
                {badge && <Chip tone={badge.urgent ? "rose" : "amber"}>{badge.label}</Chip>}
              </div>
              <div className="mt-1 text-sm text-fg-muted">{clientCountsSummary(c)}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// One passive monitoring signal: headline + body excerpt, tap to discuss, and
// Dismiss signal in its ⋯ menu. The Discuss handoff reuses
// buildMonitoringSeed so it behaves exactly like the card does.
function MonitoringRow({
  proposal,
  onContinue,
  onDismiss,
}: {
  proposal: ProposalItem;
  onContinue?: ContinueHandler;
  onDismiss?: (p: ProposalItem) => void;
}) {
  const seed = buildMonitoringSeed(proposal);
  const inner = (
    <>
      <div className="text-[15px] font-medium text-fg group-hover:text-accent transition-colors line-clamp-2" title={proposal.headline}>
        {proposal.headline}
      </div>
      {proposal.body && proposal.body !== proposal.headline && (
        <div className="mt-1 text-sm leading-snug text-fg-muted line-clamp-2">{proposal.body}</div>
      )}
    </>
  );
  return (
    <div id={`alert-${proposal.alert_id}`} className="group flex items-start gap-2 py-3">
      {onContinue ? (
        <button
          type="button"
          onClick={() => onContinue(seed, briefingMemoryLine(MEMORY_ACTIONS.monitoring, proposal.headline))}
          className="block min-w-0 flex-1 cursor-pointer rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {inner}
        </button>
      ) : (
        <Link href="/watchlist" className="block min-w-0 flex-1">
          {inner}
        </Link>
      )}
      {onDismiss && (
        <OverflowMenu
          size="sm"
          label={t("briefing.monitoring.moreActions")}
          items={[{ label: t("briefing.monitoring.dismissSignal"), onSelect: () => onDismiss(proposal) }]}
        />
      )}
    </div>
  );
}

// Monitoring — passive signals (watchlist tickers, vendor status, external
// news) the Executive is tracking.
export function MonitoringPanelBody({
  proposals,
  onContinue,
  onDismiss,
  onBulkDismiss,
}: {
  proposals: ProposalItem[];
  onContinue?: ContinueHandler;
  onDismiss?: (p: ProposalItem) => void;
  onBulkDismiss?: (ids: number[]) => void;
}) {
  const staleIds = olderThan(proposals, MONITORING_DISMISS_OLDER_THAN_DAYS);
  return (
    <>
      <PanelIntro>
        {t("briefing.monitoring.intro")}
      </PanelIntro>
      {proposals.length === 0 ? (
        <p className="py-3 text-[15px] text-fg-muted">{t("briefing.monitoring.empty")}</p>
      ) : (
        <div className="divide-y divide-line">
          {proposals.map((p) => (
            <MonitoringRow key={p.alert_id} proposal={p} onContinue={onContinue} onDismiss={onDismiss} />
          ))}
        </div>
      )}
      {onBulkDismiss && staleIds.length > 0 && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => onBulkDismiss(staleIds)}>
          {t("briefing.home.dismissOlder", { n: staleIds.length, days: MONITORING_DISMISS_OLDER_THAN_DAYS })}
        </Button>
      )}
    </>
  );
}

// First-person sentence for one handled row. Falls back to the audit summary
// when the row predates the structured fields.
function handledSentence(h: HandledItem): React.ReactNode {
  const headline = h.headline ?? "";
  const target = h.target ?? "";
  const H = <span className="text-fg">{headline}</span>;
  const T = <span className="text-fg">{target}</span>;
  const why = h.detail ? <span className="text-fg-subtle"> — {h.detail}</span> : null;
  if (!headline) return h.summary;
  const nodes = { headline: H, target: T, why };
  switch (h.kind) {
    case "closed":
      return h.outcome === "dismissed"
        ? tRich("briefing.handled.dismissed", nodes)
        : tRich("briefing.handled.resolved", nodes);
    case "routed":
      if (!target) return h.summary;
      return h.outcome === "proposed"
        ? tRich("briefing.handled.proposed", {
            ...nodes,
            awaiting: <span className="text-fg-subtle">{t("briefing.handled.awaitingApproval")}</span>,
          })
        : tRich("briefing.handled.handed", nodes);
    case "nudged":
      return target ? tRich("briefing.handled.chased", nodes) : h.summary;
    case "escalated":
      return target ? tRich("briefing.handled.raisedTo", nodes) : tRich("briefing.handled.raised", nodes);
    case "drafted":
      return target ? tRich("briefing.handled.drafted", nodes) : h.summary;
    case "merged":
      return target ? tRich("briefing.handled.folded", nodes) : h.summary;
    case "suggested_workflow":
      return target ? tRich("briefing.handled.suggested", nodes) : h.summary;
    case "watching":
      return tRich("briefing.handled.watching", nodes);
    case "stopped_watching":
      return tRich("briefing.handled.stoppedWatching", nodes);
    default:
      return h.summary;
  }
}

function HandledTrailerLink({ href, label }: { href: string; label: string }) {
  return (
    <>
      <span aria-hidden="true">·</span>
      <Link href={href} className="hover:text-accent transition-colors underline-offset-2 hover:underline">
        {label}
      </Link>
    </>
  );
}

function HandledRowView({
  row,
  reverted,
  onReopen,
  onJumpToAlert,
}: {
  row: HandledRow;
  reverted: boolean;
  onReopen?: (rowKey: string, alertId: number) => void;
  onJumpToAlert: (alertId: number) => void;
}) {
  const h = row.item;
  // Undo only while the close still stands and the server would accept a
  // reopen (resolved / dismissed / expired / merged; "" = status unknown).
  const canUndo =
    Boolean(onReopen) && h.alert_id != null && isCloseKind(h) && !reverted && HANDLED_REOPENABLE.has(h.status ?? "");
  // "open" means live in the queue right now — the only state with a card to
  // jump to (an acked or snoozed alert has none).
  const stillOpen = h.alert_id != null && h.status === "open" && !isCloseKind(h);
  const proofHref = handledProofHref(h);
  const alsoLine = handledAlsoLine(row);
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className={`text-[15px] leading-snug ${reverted ? "line-through text-fg-subtle" : "text-fg-muted"}`}>
          {handledSentence(h)}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-subtle">
          {alsoLine && <span>{alsoLine}</span>}
          {alsoLine && <span aria-hidden="true">·</span>}
          <span>{t("briefing.handled.ago", { age: ageLabel(h.at) })}</span>
          {proofHref && <HandledTrailerLink href={proofHref} label={h.evidence_ref || t("briefing.handled.evidence")} />}
          {h.kind === "drafted" && <HandledTrailerLink href="/artifacts" label={t("briefing.handled.readDraft")} />}
          {(h.kind === "watching" || h.kind === "stopped_watching") && (
            <HandledTrailerLink href="/watchlist" label={t("briefing.handled.watchlist")} />
          )}
          {reverted && (
            <>
              <span aria-hidden="true">·</span>
              <span className={TONE_TEXT.sky}>{t("briefing.handled.reopened")}</span>
            </>
          )}
        </p>
      </div>
      {canUndo && (
        <Button variant="secondary" size="sm" onClick={() => onReopen?.(handledKey(h), h.alert_id as number)}>
          {t("briefing.handled.undo")}
        </Button>
      )}
      {stillOpen && (
        <Button
          variant="ghost"
          size="sm"
          title={t("briefing.handled.jumpTitle")}
          onClick={() => onJumpToAlert(h.alert_id as number)}
        >
          {t("briefing.handled.stillOpen")}
        </Button>
      )}
    </div>
  );
}

// Handled overnight — moves the Executive completed on its own since the
// last delivered brief. The rail is rebuilt from the audit log on every
// fetch, so a close the principal already undid still has its row:
// `status === "open"` (server truth after a reload) or the in-session set
// marks it reverted.
export function handledReverted(undone: Set<string>) {
  return (h: HandledItem) => isCloseKind(h) && (h.status === "open" || undone.has(handledKey(h)));
}

export function HandledPanelBody({
  items,
  onReopen,
  undone,
  onJumpToAlert,
}: {
  items: HandledItem[];
  onReopen?: (rowKey: string, alertId: number) => void;
  undone: Set<string>;
  onJumpToAlert: (alertId: number) => void;
}) {
  const reverted = handledReverted(undone);
  // Grouped rows, not raw items: a merge folded into a listed survivor
  // leaves no row of its own.
  const rows = groupHandled(items);
  return (
    <>
      <p className="mb-1 text-[15px] font-medium text-fg">{handledHeadline(rows, reverted)}</p>
      <PanelIntro>
        {t("briefing.handled.intro")}
      </PanelIntro>
      <div className="divide-y divide-line border-t border-line">
        {rows.map((row) => (
          <HandledRowView
            key={handledKey(row.item)}
            row={row}
            reverted={reverted(row.item)}
            onReopen={onReopen}
            onJumpToAlert={onJumpToAlert}
          />
        ))}
      </div>
    </>
  );
}
