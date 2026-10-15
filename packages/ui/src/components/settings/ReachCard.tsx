"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import LeadRulesEditor from "@/components/settings/LeadRulesEditor";
import SettingsCard from "@/components/settings/SettingsCard";
import {
  addMyLeadRule,
  deleteMyLeadRule,
  getDelegation,
  getMyLeadRules,
  setReach,
  setTraining,
  type DelegationSettings,
  type LeadRule,
  type ReachStep,
} from "@/lib/api";
import { t } from "@/i18n/index.ts";
import { REACH_ANCHOR, handleItModes, leadLine, reachOf, sentTodayLine, stepLabel } from "@/lib/reach";

// How far it goes as you: the one dial for everything Act as me does from
// your own mailbox (PUT /delegation/reach). It replaces three switches that
// used to depend on each other out of sight: Write drafts as me, Draft
// replies to my inbox and Handle it for me with its level. The first steps
// write and never send; the rest are Handle it for me, which sends. Moving
// down says what stops before it saves. In training (Replies and Follow-ups,
// delegation/training.py) applies to the sending steps. It is shown on
// Delegate → Act as me only; Handle it for me shows where it is and what it
// sent, and links back here (REACH_HREF).

type Step = {
  value: ReachStep;
  label: string;
  line: string;
  sends: boolean;
};

function stepsFor(settings: DelegationSettings, mailbox: string): Step[] {
  const sending: Step[] = handleItModes().map((m) => ({
    value: m.mode,
    label: m.label,
    line: t("settings.reach.sendingLine", { replies: m.replies, followUps: m.followUps }),
    sends: true,
  }));
  return [
    { value: "off", label: stepLabel("off"), line: t("settings.reach.line.off"), sends: false },
    {
      value: "when_asked",
      label: stepLabel("when_asked"),
      line: t("settings.reach.line.whenAsked", { mailbox }),
      sends: false,
    },
    {
      value: "inbox",
      label: stepLabel("inbox"),
      line: t("settings.reach.line.inbox"),
      sends: false,
    },
    ...sending,
    ...(settings.handle_it?.lead_available
      ? [{ value: "everything" as ReachStep, label: stepLabel("everything"), line: leadLine(), sends: true }]
      : []),
  ];
}

// What moving from `from` down to `to` stops, in a sentence.
function whatStops(steps: Step[], from: ReachStep, to: ReachStep): string {
  const i = steps.findIndex((s) => s.value === from);
  const j = steps.findIndex((s) => s.value === to);
  if (j >= i) return "";
  const target = steps[j];
  if (from === "everything" && target.sends) return t("settings.reach.stops.fromEverything");
  if (steps[i].sends && target.sends) return t("settings.reach.stops.sendsLess");
  if (steps[i].sends && to === "inbox") return t("settings.reach.stops.toInbox");
  if (to === "when_asked") return t("settings.reach.stops.toWhenAsked");
  return t("settings.reach.stops.toOff");
}

export default function ReachCard({
  settings,
  onSettings,
}: {
  settings: DelegationSettings;
  onSettings: (next: DelegationSettings) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ReachStep | null>(null);

  // Linked from Handle it for me or What it may do (REACH_HREF): the card
  // appears after the settings load, so the browser's own jump to the
  // anchor has already passed it.
  useEffect(() => {
    if (window.location.hash === `#${REACH_ANCHOR}`) {
      document.getElementById(REACH_ANCHOR)?.scrollIntoView({ block: "start" });
    }
  }, []);

  const mailbox = settings.gmail?.provider === "microsoft" ? "Outlook" : "Gmail";
  const steps = stepsFor(settings, mailbox);
  const current = reachOf(settings);
  const currentStep = steps.find((s) => s.value === current);
  const sending = Boolean(currentStep?.sends);
  const training = Boolean(settings.training?.replies);
  const followUpsTraining = Boolean(settings.training?.follow_ups);
  const connected = settings.gmail?.status === "connected";
  const canSend = Boolean(settings.handle_it?.available);

  const save = async (work: () => Promise<DelegationSettings>) => {
    setBusy(true);
    setError(null);
    try {
      onSettings(await work());
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.reach.saveFailed"));
      // A refused move up can stop part way, at a lower step: show where it is.
      try {
        const now = await getDelegation();
        if (now) onSettings(now);
      } catch {
        // Keep what's shown; the error above already says it didn't save.
      }
    } finally {
      setBusy(false);
    }
  };

  const pick = (to: ReachStep) => {
    if (to === current) return;
    const i = steps.findIndex((s) => s.value === current);
    const j = steps.findIndex((s) => s.value === to);
    if (j < i) {
      setConfirming(to);
      return;
    }
    void save(() => setReach(to));
  };

  const disabledReason = (step: Step): string | null => {
    if (step.value === "off") return null;
    if (!connected && current === "off") return t("settings.reach.disabled.connectFirst");
    if (step.sends && !canSend) return t("settings.reach.disabled.needsSignedSignIns");
    if (step.value === "everything" && (training || followUpsTraining)) return t("settings.reach.disabled.inTraining");
    return null;
  };

  const groups: { title: string; steps: Step[] }[] = [
    { title: t("settings.reach.group.writes"), steps: steps.filter((s) => !s.sends) },
    { title: t("settings.reach.group.sends"), steps: steps.filter((s) => s.sends) },
  ];

  return (
    <div id={REACH_ANCHOR} className="scroll-mt-24">
    <SettingsCard
      title={t("settings.handleIt.reachLabel")}
      titleId="reach-label"
      description={t("settings.reach.description")}
    >
      <div role="radiogroup" aria-labelledby="reach-label" className="flex flex-col gap-5">
        {groups.map((group) => (
          <div key={group.title}>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">{group.title}</h3>
            <div className="flex flex-col gap-2">
              {group.steps.map((step) => {
                const checked = step.value === current;
                const reason = disabledReason(step);
                return (
                  <label
                    key={step.value}
                    className={`flex items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                      checked ? "border-accent/60 bg-accent/10" : "border-line bg-surface-elevated hover:border-line-strong"
                    } ${reason && !checked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                  >
                    <input
                      type="radio"
                      name="reach"
                      value={step.value}
                      checked={checked}
                      disabled={busy || (Boolean(reason) && !checked)}
                      onChange={() => pick(step.value)}
                      className="mt-1 h-4 w-4 flex-shrink-0 accent-indigo-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium text-fg">{step.label}</span>
                      <span className="mt-0.5 block text-sm text-fg-muted leading-snug">
                        {reason && !checked ? reason : step.line}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {confirming && (
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm text-fg leading-relaxed">
            {t("settings.reach.confirmMove", {
              step: steps.find((s) => s.value === confirming)?.label ?? "",
              stops: whatStops(steps, current, confirming),
            })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(() => setReach(confirming))}
              className="h-9 rounded-lg bg-fg px-3 text-sm font-medium text-fg-inverse disabled:opacity-50"
            >
              {busy ? t("common.saving") : t("settings.reach.moveDown")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(null)}
              className="h-9 rounded-lg border border-line px-3 text-sm font-medium text-fg"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Shown from Drafts for my inbox up, so it can be in training before
          the first move to a step that sends: training stays across moves. */}
      {(sending || current === "inbox") && (
        <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={training}
              disabled={busy || current === "everything"}
              onChange={(e) => {
                const train = e.target.checked;
                void save(() => setTraining({ replies: train, follow_ups: train }));
              }}
              className="mt-0.5 h-5 w-5 flex-shrink-0 accent-indigo-500"
            />
            <span>
              <span className="block text-[15px] font-semibold text-fg">{t("settings.handleIt.inTraining")}</span>
              <span className="mt-0.5 block text-sm text-fg-muted leading-snug">
                {current === "everything"
                  ? t("settings.reach.training.atEverything")
                  : !sending
                    ? t("settings.reach.training.beforeSending")
                    : t("settings.reach.training.sending")}
              </span>
            </span>
          </label>
          {(training || followUpsTraining) && (
            <label className="ml-8 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={followUpsTraining}
                disabled={busy}
                onChange={(e) => {
                  const train = e.target.checked;
                  void save(() => setTraining({ follow_ups: train }));
                }}
                className="mt-0.5 h-5 w-5 flex-shrink-0 accent-indigo-500"
              />
              <span>
                <span className="block text-[15px] font-semibold text-fg">{t("settings.reach.trainFollowUps")}</span>
                <span className="mt-0.5 block text-sm text-fg-muted leading-snug">
                  {t("settings.reach.trainFollowUpsHelp")}
                </span>
              </span>
            </label>
          )}
          <p className="text-sm text-fg-muted">{t("settings.handleIt.alwaysWait")}</p>
        </div>
      )}
      {current !== "off" && (
        <label className="mt-5 flex cursor-pointer items-start gap-3 border-t border-line pt-4">
          <input
            type="checkbox"
            checked={Boolean(settings.training?.drafts)}
            disabled={busy}
            onChange={(e) => {
              const learn = e.target.checked;
              void save(() => setTraining({ drafts: learn }));
            }}
            className="mt-0.5 h-5 w-5 flex-shrink-0 accent-indigo-500"
          />
          <span>
            <span className="block text-[15px] font-semibold text-fg">{t("settings.reach.learnTitle")}</span>
            <span className="mt-0.5 block text-sm text-fg-muted leading-snug">{t("settings.reach.learnHelp")}</span>
          </span>
        </label>
      )}
      {current === "everything" && <YourRules />}
      {sending && (
        <p className="mt-5 border-t border-line pt-4 text-sm text-fg-muted">
          {sentTodayLine(settings.handle_it?.sent_today ?? 0)}{" "}
          <Link href="/delegate/handle-it" className="font-medium text-accent underline-offset-2 hover:underline">
            {t("settings.handleIt.whatItSent")}
          </Link>
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </SettingsCard>
    </div>
  );
}

// At Everything, your own rules: a reply matching one waits for you, on top
// of your company's rules (GET/POST/DELETE /delegation/lead-rules).
function YourRules() {
  const [rules, setRules] = useState<LeadRule[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getMyLeadRules(controller.signal)
      .then(setRules)
      .catch(() => setRules(null));
    return () => controller.abort();
  }, []);

  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-[15px] font-semibold text-fg">{t("settings.handleIt.yourRules")}</h3>
      <p className="mt-1 mb-3 text-sm text-fg-muted">{t("settings.handleIt.yourRulesDescription")}</p>
      <LeadRulesEditor
        rules={rules ?? []}
        emptyText={t("settings.handleIt.noRules")}
        onAdd={async (kind, value) => setRules(await addMyLeadRule(kind, value))}
        onDelete={async (id) => setRules(await deleteMyLeadRule(id))}
      />
    </div>
  );
}
