"use client";

import { useEffect, useState } from "react";

import LeadRulesEditor from "@/components/settings/LeadRulesEditor";
import SettingsCard from "@/components/settings/SettingsCard";
import Switch from "@/components/Switch";
import { t } from "@/i18n/index.ts";
import {
  addCompanyLeadRule,
  deleteCompanyLeadRule,
  getTakeTheLead,
  setTakeTheLead,
  type TakeTheLead,
} from "@/lib/api";

// Take the lead as the Executive (GET/PUT /take-the-lead), the owner's
// alone: its unattended runs act on what they find, behind the gate. The six
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
      </SettingsCard>
    );
  }

  const save = async (update: { enabled?: boolean; ask_first?: Record<string, boolean> }) => {
    setBusy(true);
    setError(null);
    try {
      setLead(await setTakeTheLead(update));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.lead.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      title={t("settings.lead.title")}
      titleId="take-the-lead-label"
      description={
        !lead.available
          ? t("settings.lead.needsSignedSignIns")
          : lead.enabled
            ? t("settings.lead.onDescription")
            : t("settings.lead.offDescription")
      }
      action={
        <Switch
          checked={lead.enabled}
          onChange={() => void save({ enabled: !lead.enabled })}
          disabled={busy || (!lead.enabled && !lead.available)}
          labelledBy="take-the-lead-label"
        />
      }
    >
      <div className="flex flex-col gap-5">
        {lead.enabled && (
          <>
            <p className="rounded-xl bg-surface-overlay/60 px-4 py-3 text-sm leading-relaxed text-fg-muted">
              {t("settings.lead.departmentNote")}
            </p>
            <div>
              <h3 className="text-[15px] font-semibold text-fg">{t("settings.lead.askFirstTitle")}</h3>
              <p className="mt-1 text-sm text-fg-muted">
                {t("settings.lead.askFirstDescription")}
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
              </ul>
            </div>
          </>
        )}
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
