"use client";

import { useState } from "react";

import { t, type MessageKey } from "@/i18n/index.ts";
import type { LeadRule, LeadRuleKind } from "@/lib/api";

// Rules added on top of Take the lead's gate (orchestrator/take_the_lead.py):
// anything matching one always waits for someone first. The company's live
// on As the Executive, a person's own on their As you.
export const RULE_KINDS: { kind: LeadRuleKind; label: MessageKey; placeholder: MessageKey; describe: (v: string) => string }[] = [
  { kind: "person", label: "settings.rules.person.label", placeholder: "settings.rules.person.placeholder", describe: (v) => t("settings.rules.person.describe", { v }) },
  { kind: "domain", label: "settings.rules.domain.label", placeholder: "settings.rules.domain.placeholder", describe: (v) => t("settings.rules.domain.describe", { v }) },
  { kind: "words", label: "settings.rules.words.label", placeholder: "settings.rules.words.placeholder", describe: (v) => t("settings.rules.words.describe", { v }) },
  { kind: "amount", label: "settings.rules.amount.label", placeholder: "settings.rules.amount.placeholder", describe: (v) => t("settings.rules.amount.describe", { v }) },
];

export default function LeadRulesEditor({
  rules,
  onAdd,
  onDelete,
  disabled = false,
  emptyText,
}: {
  rules: LeadRule[];
  onAdd: (kind: LeadRuleKind, value: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  disabled?: boolean;
  emptyText: string;
}) {
  const [kind, setKind] = useState<LeadRuleKind>("person");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spec = RULE_KINDS.find((r) => r.kind === kind) ?? RULE_KINDS[0];

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.rules.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {rules.length === 0 ? (
        <p className="text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("settings.rules.listLabel")}>
          {rules.map((rule) => {
            const describe = RULE_KINDS.find((r) => r.kind === rule.kind)?.describe ?? ((v: string) => v);
            return (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[15px]"
              >
                <span className="min-w-0 break-words">{describe(rule.value)}</span>
                <button
                  type="button"
                  onClick={() => void run(() => onDelete(rule.id))}
                  disabled={busy || disabled}
                  className="min-h-touch flex-shrink-0 px-2 text-sm text-accent hover:underline disabled:opacity-50"
                >
                  {t("common.remove")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          const text = value.trim();
          if (!text) return;
          void run(async () => {
            await onAdd(kind, text);
            setValue("");
          });
        }}
      >
        <label className="sr-only" htmlFor="lead-rule-kind">
          {t("settings.rules.kindLabel")}
        </label>
        <select
          id="lead-rule-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as LeadRuleKind)}
          disabled={busy || disabled}
          className="min-h-touch rounded-lg border border-line bg-surface px-3 text-[15px]"
        >
          {RULE_KINDS.map((r) => (
            <option key={r.kind} value={r.kind}>
              {t(r.label)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="lead-rule-value">
          {t(spec.label)}
        </label>
        <input
          id="lead-rule-value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t(spec.placeholder)}
          maxLength={200}
          disabled={busy || disabled}
          className="min-h-touch min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[15px]"
        />
        <button
          type="submit"
          disabled={busy || disabled || !value.trim()}
          className="min-h-touch rounded-lg bg-accent px-4 text-[15px] font-semibold text-white disabled:opacity-50"
        >
          {t("settings.rules.add")}
        </button>
      </form>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
