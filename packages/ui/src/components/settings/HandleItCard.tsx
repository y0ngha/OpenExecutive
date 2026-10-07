"use client";

import { useEffect, useState } from "react";

import LeadRulesEditor from "@/components/settings/LeadRulesEditor";
import SettingsCard from "@/components/settings/SettingsCard";
import { t, tp, type MessageKey } from "@/i18n/index.ts";
import {
  addMyLeadRule,
  deleteMyLeadRule,
  getDelegation,
  getHandledReplies,
  getMyLeadRules,
  setHandleIt,
  setLeadAsYou,
  type DelegationSettings,
  type HandledReply,
  type HandleIt,
  type HandleItMode,
  type LeadRule,
} from "@/lib/api";
import { formatAgo } from "@/lib/setupStatus";

// Handle it for me (PUT /delegation/handle-it) on Settings → Act as me:
// replies the inbox watcher sends from your mailbox on its own. Plain code
// decides each one (delegation/handle_it.py). One dial says how much goes
// without you: Off, Easy ones, People I know, Most mail, and for the owner
// Everything, which uses Take the lead
// (PUT /delegation/take-the-lead), where links, the topics that always wait and
// the added rules hold a reply back. Anything it won't send waits on Today as
// before. Below the dial, what it sent in the last week (GET /delegation/handled).
export const HANDLE_IT_MODES: { mode: HandleItMode; label: MessageKey; replies: MessageKey; followUps: MessageKey }[] = [
  {
    mode: "careful",
    label: "settings.handleIt.careful.label",
    replies: "settings.handleIt.careful.replies",
    followUps: "settings.handleIt.careful.followUps",
  },
  {
    mode: "balanced",
    label: "settings.handleIt.balanced.label",
    replies: "settings.handleIt.balanced.replies",
    followUps: "settings.handleIt.balanced.followUps",
  },
  {
    mode: "bold",
    label: "settings.handleIt.bold.label",
    replies: "settings.handleIt.bold.replies",
    followUps: "settings.handleIt.bold.followUps",
  },
];

// Under the mailbox card on Settings → Act as me: nothing for someone who
// can't have Act as me (GET /delegation answers null); until the inbox
// watcher is on, the card says to turn it on above.
export default function HandleItCard() {
  const [settings, setSettings] = useState<DelegationSettings | null>(null);
  const [state, setState] = useState<"loading" | "hidden" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    getDelegation(controller.signal)
      .then((next) => {
        if (!next || !next.handle_it || !next.inbox) {
          setState("hidden");
          return;
        }
        setSettings(next);
        setState("ready");
      })
      .catch((err) => {
        if ((err as Error)?.name !== "AbortError") setState("error");
      });
    return () => controller.abort();
  }, []);

  if (state === "loading") return <p className="text-[15px] text-fg-muted">{t("common.loading")}</p>;
  if (state === "error") {
    return (
      <SettingsCard>
        <p className="text-sm text-fg-muted">{t("settings.handleIt.loadFailed")}</p>
      </SettingsCard>
    );
  }
  if (state === "hidden" || !settings?.handle_it || !settings.inbox) return null;
  return (
    <HandleItSection handleIt={settings.handle_it} inboxOn={settings.inbox.enabled} onSettings={setSettings} />
  );
}

type Step = "off" | HandleItMode | "lead";


export function HandleItSection({
  handleIt,
  inboxOn,
  onSettings,
}: {
  handleIt: HandleIt;
  inboxOn: boolean;
  onSettings: (next: DelegationSettings) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handled, setHandled] = useState<HandledReply[] | null>(null);
  const [rules, setRules] = useState<LeadRule[] | null>(null);
  const on = handleIt.enabled;
  const lead = Boolean(on && handleIt.lead);
  const step: Step = !on ? "off" : lead ? "lead" : handleIt.mode;
  const canTurnOn = inboxOn && handleIt.available;

  useEffect(() => {
    if (!on) return;
    const controller = new AbortController();
    getHandledReplies(controller.signal)
      .then(setHandled)
      .catch(() => setHandled(null));
    return () => controller.abort();
  }, [on, handleIt.sent_today]);

  useEffect(() => {
    if (!lead) return;
    const controller = new AbortController();
    getMyLeadRules(controller.signal)
      .then(setRules)
      .catch(() => setRules(null));
    return () => controller.abort();
  }, [lead]);

  // One dial: each step includes the one before. Take the lead as you is
  // its own switch on the server, so leaving it turns it off first.
  const pick = async (next: Step) => {
    if (next === step) return;
    setBusy(true);
    setError(null);
    try {
      if (next === "lead") {
        onSettings(await setLeadAsYou(true));
      } else {
        if (lead) await setLeadAsYou(false);
        onSettings(await setHandleIt(next === "off" ? { enabled: false } : { enabled: true, mode: next }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.lead.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const steps: { step: Step; label: string; lines: string[] }[] = [
    { step: "off", label: t("common.off"), lines: [t("settings.handleIt.off.text")] },
    ...HANDLE_IT_MODES.map((m) => ({
      step: m.mode as Step,
      label: t(m.label),
      lines: [
        t("settings.handleIt.repliesLine", { text: t(m.replies) }),
        t("settings.handleIt.followUpsLine", { text: t(m.followUps) }),
      ],
    })),
    ...(handleIt.lead_available
      ? [{ step: "lead" as Step, label: t("settings.handleIt.lead.label"), lines: [t("settings.handleIt.lead.text")] }]
      : []),
  ];

  return (
    <SettingsCard
      title={t("settings.handleIt.title")}
      titleId="handle-it-label"
      description={
        !handleIt.available
          ? t("settings.handleIt.needsSignedSignIns")
          : inboxOn
            ? t("settings.handleIt.description")
            : t("settings.handleIt.turnOnInboxFirst")
      }
    >
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-labelledby="handle-it-label" className="flex flex-col gap-2">
          {steps.map((s) => {
            const picked = s.step === step;
            return (
              <button
                key={s.step}
                type="button"
                role="radio"
                aria-checked={picked}
                disabled={busy || (s.step !== "off" && !canTurnOn)}
                onClick={() => void pick(s.step)}
                className={`min-h-touch rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                  picked ? "border-accent bg-accent/5" : "border-line hover:border-line-strong"
                }`}
              >
                <span className="flex items-center gap-2 text-[15px] font-semibold text-fg">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-4 w-4 flex-shrink-0 rounded-full border-2 ${
                      picked ? "border-accent bg-accent" : "border-line-strong"
                    }`}
                  />
                  {s.label}
                </span>
                {s.lines.map((line) => (
                  <span key={line} className="mt-1 block text-sm leading-snug text-fg-muted">
                    {line}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
        {on && (
          <p className="text-sm text-fg-muted">
            {t("settings.handleIt.alwaysWait")}
          </p>
        )}
        {lead && (
          <div>
            <h3 className="text-[15px] font-semibold text-fg">{t("settings.handleIt.yourRules")}</h3>
            <p className="mt-1 mb-3 text-sm text-fg-muted">
              {t("settings.handleIt.yourRulesDescription")}
            </p>
            <LeadRulesEditor
              rules={rules ?? []}
              emptyText={t("settings.handleIt.noRules")}
              disabled={busy}
              onAdd={async (kind, value) => setRules(await addMyLeadRule(kind, value))}
              onDelete={async (id) => setRules(await deleteMyLeadRule(id))}
            />
          </div>
        )}
        {on && (
          <p className="text-sm text-fg-muted">
            {tp("settings.handleIt.sentToday", handleIt.sent_today)}
          </p>
        )}
        {on && handled && handled.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label={t("settings.handleIt.handledLabel")}>
            {handled.map((h) => (
              <li key={h.decision_id} className="rounded-md border border-border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0 font-medium">
                    {t(h.source === "follow_up" ? "settings.handleIt.followedUpWith" : "settings.handleIt.repliedTo", {
                      who: h.to_name || h.to_email,
                    })}{" "}
                    {h.subject}
                  </span>
                  <span className="text-xs text-fg-muted">{formatAgo(h.sent_at)}</span>
                </div>
                {h.open_questions.length > 0 && (
                  <p className="mt-1 text-fg-muted">{t("settings.handleIt.stillYours", { questions: h.open_questions.join(" ") })}</p>
                )}
                {h.gmail_link && (
                  <a href={h.gmail_link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-accent">
                    {t("settings.handleIt.openInMailbox")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </SettingsCard>
  );
}
