"use client";

import { useState } from "react";

import SettingsCard from "@/components/settings/SettingsCard";
import { t, type MessageKey } from "@/i18n/index.ts";
import { setReplyDisclosure, type DelegationSettings, type ReplyDisclosure } from "@/lib/api";

type Switch = "handle_it" | "approved_sends";

const SWITCHES: { key: Switch; label: MessageKey; help: MessageKey }[] = [
  {
    key: "handle_it",
    label: "settings.disclosure.handleIt.label",
    help: "settings.disclosure.handleIt.help",
  },
  {
    key: "approved_sends",
    label: "settings.disclosure.approved.label",
    help: "settings.disclosure.approved.help",
  },
];

// On Delegate → Act as me: your own switches for the AI line on replies sent
// as you (PUT /delegation/disclosure, delegation/disclosure.py). The line is
// written into each reply when it's drafted, so a change applies to the next
// one. Turning off the Handle it line asks first. Nothing shows when the
// install has AI disclosure off.
export default function ReplyDisclosureCard({
  disclosure,
  onSettings,
}: {
  disclosure: ReplyDisclosure;
  onSettings: (next: DelegationSettings) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  if (!disclosure.enabled) return null;

  const save = async (key: Switch, value: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onSettings(await setReplyDisclosure({ [key]: value }));
      setConfirmOff(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.reach.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: Switch, value: boolean) => {
    if (key === "handle_it" && !value) {
      setConfirmOff(true);
      return;
    }
    void save(key, value);
  };

  return (
    <SettingsCard
      title={t("settings.disclosure.title")}
      description={t("settings.disclosure.description", { line: disclosure.line })}
    >
      <div className="flex flex-col gap-4">
        {SWITCHES.map((s) => (
          <label key={s.key} className="flex cursor-pointer items-start gap-3">
            <input
              id={`reply-disclosure-${s.key}`}
              type="checkbox"
              checked={disclosure[s.key]}
              disabled={busy}
              onChange={(e) => toggle(s.key, e.target.checked)}
              className="mt-0.5 h-5 w-5 flex-shrink-0 accent-indigo-500"
            />
            <span>
              <span className="block text-[15px] font-semibold text-fg">{t(s.label)}</span>
              <span className="mt-0.5 block text-sm text-fg-muted leading-snug">{t(s.help)}</span>
            </span>
          </label>
        ))}
        {confirmOff && (
          <div className="rounded-md border border-line p-3 text-sm">
            <p className="text-fg">{t("settings.disclosure.confirmOff")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void save("handle_it", false)}
                className="rounded-md border border-line px-3 py-1.5 font-medium text-fg"
              >
                {t("settings.disclosure.turnOff")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmOff(false)}
                className="rounded-md px-3 py-1.5 text-fg-muted"
              >
                {t("settings.disclosure.keepOn")}
              </button>
            </div>
          </div>
        )}
        <p className="text-sm text-fg-muted">{t("settings.disclosure.appliesNext")}</p>
      </div>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </SettingsCard>
  );
}
