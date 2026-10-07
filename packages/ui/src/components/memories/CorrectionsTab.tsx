"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  listFactApprovalRules,
  listStandingFacts,
  retireStandingFact,
  reviewStandingFact,
  setFactApprovalRule,
  type FactApprovalRule,
  type StandingFact,
} from "@/lib/api";
import Button from "@/components/ui/Button";
import OverflowMenu from "@/components/ui/OverflowMenu";
import { t, type MessageKey } from "@/i18n/index.ts";
import { EmptyState, formatDate } from "./shared";

// The "what stuck" view: facts and corrections the principal or a teammate
// told the Executive to keep (the `remember_fact` chat tool) and company-profile
// fields changed from chat (`update_company_profile`). Active facts are read by
// every prompt that produces output — chat, briefs, scheduled runs, the alert
// review — so this is where the owner checks a correction actually held, and
// retires one that no longer does. A teammate's fact is marked with their name
// and waits for the owner's approval (listed first, with Approve and Decline)
// unless the owner trusts that teammate — and even then when it would replace
// the owner's own fact. The owner sets, per teammate, whether theirs need
// approval (on by default).

const KIND_LABEL: Record<StandingFact["kind"], MessageKey> = {
  fact: "people.corrections.kind.fact",
  correction: "people.corrections.kind.correction",
  profile: "people.corrections.kind.profile",
};

const KIND_PILL: Record<StandingFact["kind"], string> = {
  fact: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  correction: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  profile: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
};

const HISTORY_STATUSES = new Set<StandingFact["status"]>(["superseded", "retired", "declined"]);

function channelLabel(channel: string): string {
  if (!channel) return t("people.corrections.channelChat");
  if (channel === "web") return t("people.corrections.channelWeb");
  if (channel === "google_chat") return "Google Chat";
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

export default function CorrectionsTab({ onCount }: { onCount: (n: number) => void }) {
  const [facts, setFacts] = useState<StandingFact[]>([]);
  const [retirable, setRetirable] = useState<Set<number>>(new Set());
  const [canReview, setCanReview] = useState(false);
  const [rules, setRules] = useState<FactApprovalRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const page = await listStandingFacts();
      setFacts(page.facts);
      setRetirable(new Set(page.retirable_ids ?? []));
      setCanReview(page.can_review ?? false);
      setFailed(false);
      onCount(page.facts.filter((f) => f.status === "active").length);
      if (page.can_review) {
        // The switch list is extra: failing to load it leaves the facts shown.
        setRules(await listFactApprovalRules().catch(() => []));
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [onCount]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRetire = useCallback(
    async (fact: StandingFact) => {
      if (!window.confirm(t("people.corrections.retireConfirm", { statement: fact.statement }))) return;
      try {
        await retireStandingFact(fact.id);
      } catch {
        window.alert(t("people.corrections.retireFailed"));
        return;
      }
      void refresh();
    },
    [refresh],
  );

  const handleReview = useCallback(
    async (fact: StandingFact, decision: "approve" | "decline") => {
      try {
        await reviewStandingFact(fact.id, decision);
      } catch {
        window.alert(decision === "approve" ? t("people.corrections.approveFailed") : t("people.corrections.declineFailed"));
        return;
      }
      void refresh();
    },
    [refresh],
  );

  const handleRule = useCallback(async (rule: FactApprovalRule) => {
    try {
      const saved = await setFactApprovalRule(rule.person_id, !rule.needs_approval);
      setRules((prev) => prev.map((r) => (r.person_id === saved.person_id ? saved : r)));
    } catch {
      window.alert(t("people.corrections.ruleFailed"));
    }
  }, []);

  if (loading) return <div className="text-fg-muted text-[15px] py-4">{t("common.loading")}</div>;
  if (failed) return <EmptyState message={t("people.corrections.unavailable")} />;

  const proposed = facts.filter((f) => f.status === "proposed");
  const active = facts.filter((f) => f.status === "active");
  const history = facts.filter((f) => HISTORY_STATUSES.has(f.status));
  const byId = new Map(facts.map((f) => [f.id, f]));

  return (
    <div className="space-y-3 py-3">
      {facts.length === 0 ? (
        <EmptyState message={t("people.corrections.empty")} />
      ) : (
        <p className="text-sm text-fg-muted">
          {t("people.corrections.intro")}
        </p>
      )}
      {proposed.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4">
          <div className="pt-3 text-sm font-semibold text-amber-500">
            {canReview ? t("people.corrections.waitingYours") : t("people.corrections.waitingOwner")}
          </div>
          <div className="divide-y divide-line">
            {proposed.map((f) => (
              <FactRow
                key={f.id}
                fact={f}
                replaces={f.replaces_fact_id ? byId.get(f.replaces_fact_id) : undefined}
                onApprove={canReview ? () => handleReview(f, "approve") : undefined}
                onDecline={canReview ? () => handleReview(f, "decline") : undefined}
              />
            ))}
          </div>
        </div>
      )}
      {facts.length > 0 &&
        (active.length === 0 ? (
          <div className="text-[15px] text-fg-muted py-4">{t("people.corrections.nothingActive")}</div>
        ) : (
          <div className="divide-y divide-line">
            {active.map((f) => (
              <FactRow
                key={f.id}
                fact={f}
                onRetire={retirable.has(f.id) && f.kind !== "profile" ? () => handleRetire(f) : undefined}
              />
            ))}
          </div>
        ))}
      {history.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="h-10 text-sm font-medium text-accent hover:underline"
          >
            {showHistory
              ? t("people.corrections.hideHistory", { n: history.length })
              : t("people.corrections.showHistory", { n: history.length })}
          </button>
          {showHistory && (
            <div className="divide-y divide-line opacity-70">
              {history.map((f) => (
                <FactRow key={f.id} fact={f} replacedBy={f.superseded_by ? byId.get(f.superseded_by) : undefined} />
              ))}
            </div>
          )}
        </div>
      )}
      {canReview && rules.length > 0 && (
        <div className="border-t border-line pt-3">
          <div className="text-base font-semibold text-fg">{t("people.corrections.teammatesTitle")}</div>
          <p className="text-sm text-fg-muted mb-2">
            {t("people.corrections.teammatesBody")}
          </p>
          <ul className="space-y-1">
            {rules.map((r) => (
              <li key={r.person_id}>
                <label className="flex items-center gap-3 min-h-10 text-[15px] text-fg cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[rgb(var(--accent-strong))]"
                    checked={r.needs_approval}
                    onChange={() => void handleRule(r)}
                  />
                  <span>{r.full_name}</span>
                  <span className="text-sm text-fg-muted">{t("people.corrections.needsMyApproval")}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FactRow({
  fact,
  onRetire,
  onApprove,
  onDecline,
  replacedBy,
  replaces,
}: {
  fact: StandingFact;
  onRetire?: () => void;
  onApprove?: () => void;
  onDecline?: () => void;
  replacedBy?: StandingFact;
  replaces?: StandingFact;
}) {
  return (
    <div className="py-3.5">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted min-w-0 pt-1.5">
          <span className={`px-2 py-0.5 rounded border font-medium ${KIND_PILL[fact.kind]}`}>
            {t(KIND_LABEL[fact.kind])}
          </span>
          <span className="truncate" title={fact.subject}>{fact.subject}</span>
          <span>{t("people.corrections.via", { date: formatDate(fact.created_at), channel: channelLabel(fact.source_channel) })}</span>
          {fact.recorded_by_role === "teammate" && (
            <span className="text-fg">{t("people.corrections.per", { name: fact.recorded_by_name || t("people.corrections.aTeammate") })}</span>
          )}
        </div>
        {(onApprove || onDecline) && (
          <div className="shrink-0 flex gap-2">
            {onApprove && (
              <Button variant="primary" size="sm" className="!h-10" onClick={onApprove}>
                {t("common.approve")}
              </Button>
            )}
            {onDecline && (
              <Button variant="danger" size="sm" className="!h-10" onClick={onDecline}>
                {t("people.corrections.decline")}
              </Button>
            )}
          </div>
        )}
        {onRetire && (
          <OverflowMenu
            size="sm"
            label={t("people.corrections.actions")}
            items={[{ label: t("people.corrections.retire"), danger: true, onSelect: onRetire }]}
          />
        )}
        {fact.kind === "profile" && fact.status === "active" && (
          <Link
            href="/company-profile"
            className="shrink-0 h-9 inline-flex items-center text-sm font-medium text-accent hover:underline"
          >
            {t("people.corrections.companyProfile")}
          </Link>
        )}
      </div>
      <div className="text-[15px] text-fg">{fact.statement}</div>
      {fact.previous_statement && (
        <div className="text-sm text-fg-muted mt-0.5">
          <span className="line-through">{fact.previous_statement}</span>
        </div>
      )}
      {fact.source_quote && (
        <div className="text-sm text-fg-subtle italic mt-1 line-clamp-2" title={fact.source_quote}>
          “{fact.source_quote}”
        </div>
      )}
      {fact.status === "proposed" && replaces && (
        <div className="text-sm text-fg-subtle mt-1">{t("people.corrections.wouldReplace", { statement: replaces.statement })}</div>
      )}
      {fact.status === "superseded" && (
        <div className="text-sm text-fg-subtle mt-1">
          {replacedBy
            ? t("people.corrections.replacedBy", { statement: replacedBy.statement })
            : t("people.corrections.replaced")}
        </div>
      )}
      {(fact.status === "retired" || fact.status === "declined") && (
        <div className="text-sm text-fg-subtle mt-1">
          {t(fact.status === "declined" ? "people.corrections.declinedOn" : "people.corrections.retiredOn", {
            date: fact.retired_at ? formatDate(fact.retired_at) : "",
          })}
          {fact.retired_reason ? ` — ${fact.retired_reason}` : ""}
        </div>
      )}
    </div>
  );
}
