"use client";

import { useEffect, useState } from "react";

import { MeetingAskFirstRow } from "@/components/settings/WorkspaceCard";
import LeadRulesEditor from "@/components/settings/LeadRulesEditor";
import SettingsCard from "@/components/settings/SettingsCard";
import Switch from "@/components/Switch";
import { displayLocale, t, tp, type MessageKey } from "@/i18n/index.ts";
import {
  addCompanyLeadRule,
  allowLeadSuggestion,
  deleteCompanyLeadRule,
  getTakeTheLead,
  removeLeadLearned,
  setTakeTheLead,
  type TakeTheLead,
} from "@/lib/api";

type Mode = "off" | "training" | "on";

const MODES: { mode: Mode; label: MessageKey }[] = [
  { mode: "off", label: "common.off" },
  { mode: "training", label: "settings.lead.mode.training" },
  { mode: "on", label: "common.on" },
];

function modeOf(lead: TakeTheLead): Mode {
  if (!lead.enabled) return "off";
  return lead.training ? "training" : "on";
}

// Take the lead as the Executive (GET/PUT /take-the-lead), the owner's
// alone: its unattended runs act on what they find, behind the gate. In
// training everything waits for a yes on Today unless it's on the "What it's
// learned" list (allowed from a card, or from a suggestion here). The six
// "Always asks first" kinds each have a switch, shown only while it's on (they
// gate nothing else). The company's rules always hold, for everyone's Take the
// lead as you too, so they stay. Anyone else (the route answers 403) sees only
// who can turn it on.
export default function TakeTheLeadCard() {
  const [lead, setLead] = useState<TakeTheLead | null>(null);
  const [state, setState] = useState<"loading" | "hidden" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getTakeTheLead(controller.signal)
      .then((next) => {
        setLead(next);
        setState(next ? "ready" : "hidden");
      })
      .catch((err) => {
        if ((err as Error)?.name !== "AbortError") setState("error");
      });
    return () => controller.abort();
  }, []);

  if (state === "loading") return <p className="text-[15px] text-fg-muted">{t("common.loading")}</p>;
  if (state === "hidden") {
    return (
      <SettingsCard title={t("settings.lead.title")}>
        <p className="text-sm text-fg-muted">{t("settings.lead.ownerOnly")}</p>
      </SettingsCard>
    );
  }
  if (state === "error" || !lead) {
    return (
      <SettingsCard>
        <p className="text-sm text-fg-muted">{t("settings.lead.loadFailed")}</p>
        {/* The meeting row has its own endpoint, so it still works here. */}
        <ul className="mt-3 flex flex-col">
          <MeetingAskFirstRow />
        </ul>
      </SettingsCard>
    );
  }

  const run = async (change: () => Promise<TakeTheLead>) => {
    setBusy(true);
    setError(null);
    try {
      setLead(await change());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.lead.saveFailed"));
    } finally {
      setBusy(false);
    }
  };
  const save = (update: { enabled?: boolean; training?: boolean; ask_first?: Record<string, boolean> }) =>
    run(() => setTakeTheLead(update));
  const mode = modeOf(lead);
  const pick = (next: Mode) => {
    if (next === mode) return;
    void save(next === "off" ? { enabled: false } : { enabled: true, training: next === "training" });
  };

  return (
    <SettingsCard
      title={t("settings.lead.title")}
      titleId="take-the-lead-label"
      description={
        !lead.available
          ? t("settings.lead.needsSignedSignIns")
          : mode === "training"
            ? t("settings.lead.trainingDescription")
            : mode === "on"
              ? t("settings.lead.onDescription")
              : t("settings.lead.offDescription")
      }
    >
      <div className="flex flex-col gap-5">
        <div
          role="radiogroup"
          aria-labelledby="take-the-lead-label"
          className="grid grid-cols-3 overflow-hidden rounded-xl border border-line"
        >
          {MODES.map((m, i) => {
            const picked = m.mode === mode;
            return (
              <button
                key={m.mode}
                type="button"
                role="radio"
                aria-checked={picked}
                disabled={busy || (m.mode !== "off" && !lead.available)}
                onClick={() => pick(m.mode)}
                className={`min-h-touch px-2 py-2.5 text-[15px] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                  i > 0 ? "border-l border-line " : ""
                }${picked ? "bg-accent-strong text-white" : "text-fg hover:bg-surface-overlay/60"}`}
              >
                {t(m.label)}
              </button>
            );
          })}
        </div>
        {(lead.learned.length > 0 || (lead.enabled && (lead.suggested.length > 0 || mode === "training"))) && (
          <div>
            <h3 className="text-[15px] font-semibold text-fg">{t("settings.lead.learnedTitle")}</h3>
            <p className="mt-1 text-sm text-fg-muted">{t("settings.lead.learnedDescription")}</p>
            {lead.learned.length === 0 && lead.suggested.length === 0 ? (
              <p className="mt-3 text-sm text-fg-muted">{t("settings.lead.learnedEmpty")}</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-line rounded-xl border border-line">
                {lead.learned.map((item) => {
                  const example = Object.values(item.example).join(" · ");
                  return (
                    <li key={item.id} className="flex min-h-touch items-center justify-between gap-3 px-4 py-2">
                      <span className="min-w-0">
                        <span className="block text-[15px] font-medium">{item.label}</span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-fg-muted line-clamp-2">
                          {item.feature === "act_as_me" ? t("settings.lead.learnedActAsMe") : ""}
                          {t("settings.lead.learnedAllowed", {
                            date: new Date(item.created_at).toLocaleDateString(displayLocale(), {
                              month: "short",
                              day: "numeric",
                            }),
                          })}
                          {item.uses > 0 ? tp("settings.lead.learnedUses", item.uses) : ""}
                          {example ? t("settings.lead.learnedExample", { example }) : ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(() => removeLeadLearned(item.id))}
                        className="flex-shrink-0 text-sm font-semibold text-accent hover:underline disabled:opacity-60"
                        aria-label={t("settings.lead.removeLabel", { label: item.label })}
                      >
                        {t("common.remove")}
                      </button>
                    </li>
                  );
                })}
                {lead.suggested.map((item) => (
                  <li key={item.key} className="flex min-h-touch items-center justify-between gap-3 px-4 py-2">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium">{item.label}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-fg-muted">
                        {t("settings.lead.suggested", { n: item.approvals })}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy || !lead.available}
                      onClick={() => void run(() => allowLeadSuggestion(item.key))}
                      className="flex-shrink-0 text-sm font-semibold text-accent hover:underline disabled:opacity-60"
                      aria-label={t("settings.lead.allowLabel", { label: item.label })}
                    >
                      {t("settings.lead.allow")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {lead.enabled && (
          <p className="rounded-xl bg-surface-overlay/60 px-4 py-3 text-sm leading-relaxed text-fg-muted">
            {t("settings.lead.departmentNote")}
          </p>
        )}
        <div>
          <h3 className="text-[15px] font-semibold text-fg">{t("settings.lead.askFirstTitle")}</h3>
          <p className="mt-1 text-sm text-fg-muted">
            {t("settings.lead.askFirstDescription")}
            {!lead.enabled && t("settings.lead.askFirstOffNote")}
          </p>
          <ul className="mt-3 flex flex-col divide-y divide-line rounded-xl border border-line">
            {lead.ask_first.map((item) => {
              const id = `ask-first-${item.kind}`;
              return (
                <li key={item.kind} className="flex min-h-touch items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0">
                    <span id={id} className="block text-[15px]">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-fg-muted">{item.hint}</span>
                  </span>
                  <Switch
                    checked={item.on}
                    onChange={() => void save({ ask_first: { [item.kind]: !item.on } })}
                    disabled={busy}
                    labelledBy={id}
                  />
                </li>
              );
            })}
            <MeetingAskFirstRow />
          </ul>
        </div>
        <div>
          <h3 className="text-[15px] font-semibold text-fg">{t("settings.lead.companyRulesTitle")}</h3>
          <p className="mt-1 mb-3 text-sm text-fg-muted">
            {t("settings.lead.companyRulesDescription")}
          </p>
          <LeadRulesEditor
            rules={lead.rules}
            emptyText={t("settings.lead.noCompanyRules")}
            disabled={busy}
            onAdd={async (kind, value) => setLead(await addCompanyLeadRule(kind, value))}
            onDelete={async (id) => setLead(await deleteCompanyLeadRule(id))}
          />
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </SettingsCard>
  );
}
