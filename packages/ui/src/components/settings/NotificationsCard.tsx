"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import SettingsCard from "@/components/settings/SettingsCard";
import Switch from "@/components/Switch";
import Button from "@/components/ui/Button";
import { t } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";
import { getNotificationSettings, updateNotificationSettings, type NotificationSettings } from "@/lib/api";
import {
  QUIET_DAYS,
  daysLabel,
  deliveryLabel,
  digestDescription,
  heldLine,
  quietError,
  quietSummary,
  toUpdate,
  type Delivery,
  type QuietDays,
  type QuietHours,
} from "@/lib/notifications";

// Settings → Notifications (GET/PUT /notifications/settings): the signed-in
// person's own quiet hours, whether things reach them as they happen or in
// their briefs, and whether urgent things get through. Every change saves at
// once except the quiet-hours times, which have a Save button so a half-typed
// time is never stored.

const INPUT =
  "w-full h-11 px-3 rounded-xl text-[15px] bg-surface border border-line text-fg focus:outline-none focus:border-line-strong disabled:opacity-60";

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

type Loaded = NotificationSettings | null | "loading" | "error";

export default function NotificationsCard() {
  const [state, setState] = useState<Loaded>("loading");
  const [draft, setDraft] = useState<QuietHours | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const browserZone = useMemo(() => browserTimeZone(), []);

  useEffect(() => {
    const ctrl = new AbortController();
    getNotificationSettings(ctrl.signal)
      .then((s) => {
        setState(s);
        if (s) setDraft(s.quiet_hours);
      })
      .catch((err) => {
        if ((err as Error)?.name !== "AbortError") setState("error");
      });
    return () => ctrl.abort();
  }, []);

  if (state === "loading") return null;
  if (state === "error") {
    return (
      <SettingsCard title={t("settings.notifications.title")}>
        <p className="text-[15px] text-fg-muted">{t("settings.notifications.loadFailed")}</p>
      </SettingsCard>
    );
  }
  if (state === null) {
    return (
      <SettingsCard title={t("settings.notifications.title")}>
        <p className="text-[15px] text-fg-muted">{t("settings.notifications.notOnPeople")}</p>
      </SettingsCard>
    );
  }

  const current = state;
  const quiet = draft ?? current.quiet_hours;
  const dirty = JSON.stringify(quiet) !== JSON.stringify(current.quiet_hours);
  const draftError = quietError(quiet);

  async function save(change: Partial<Pick<NotificationSettings, "quiet_hours" | "delivery" | "urgent_through" | "timezone">>) {
    setBusy(true);
    setError(null);
    try {
      const next = await updateNotificationSettings(toUpdate({ ...current, ...change }, browserZone));
      setState(next);
      setDraft(next.quiet_hours);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.notifications.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const held = heldLine(current.held_count, current.delivery);
  const zone = current.effective_timezone;

  return (
    <>
      {error && (
        <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          {error}
        </p>
      )}
      {held && (
        <p role="status" className="rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-fg">
          {held}
        </p>
      )}

      <SettingsCard
        title={t("settings.notifications.quietTitle")}
        titleId="quiet-hours-label"
        description={quietSummary(current.quiet_hours)}
        action={
          <Switch
            checked={current.quiet_hours.enabled}
            labelledBy="quiet-hours-label"
            disabled={busy}
            onChange={(enabled) => void save({ quiet_hours: { ...quiet, enabled } })}
          />
        }
      >
        {current.quiet_hours.enabled && (
          <div className="space-y-4">
            <p className="text-[15px] text-fg-muted leading-relaxed">{t("settings.notifications.quietExplain")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
                {t("settings.notifications.from")}
                <input
                  type="time"
                  value={quiet.start}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...quiet, start: e.target.value })}
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
                {t("settings.notifications.to")}
                <input
                  type="time"
                  value={quiet.end}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...quiet, end: e.target.value })}
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
                {t("settings.notifications.days")}
                <select
                  value={quiet.days}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...quiet, days: e.target.value as QuietDays })}
                  className={INPUT}
                >
                  {QUIET_DAYS.map((d) => (
                    <option key={d} value={d}>
                      {daysLabel(d)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {draftError && dirty && <p className="text-sm text-red-500">{draftError}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                disabled={busy || !dirty || draftError !== null}
                onClick={() => void save({ quiet_hours: quiet })}
              >
                {busy ? t("common.saving") : t("settings.notifications.saveQuiet")}
              </Button>
              {dirty && (
                <Button variant="ghost" disabled={busy} onClick={() => setDraft(current.quiet_hours)}>
                  {t("common.cancel")}
                </Button>
              )}
            </div>
            <p className="text-[13px] text-fg-subtle">
              {t("settings.notifications.timesIn", { zone })}
              {browserZone && browserZone !== zone && (
                <>
                  {" "}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save({ timezone: browserZone })}
                    className="font-medium text-accent hover:underline cursor-pointer disabled:opacity-50"
                  >
                    {t("settings.notifications.useZone", { zone: browserZone })}
                  </button>
                </>
              )}
            </p>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("settings.notifications.deliveryTitle")}
        titleId="delivery-label"
        description={t("settings.notifications.deliveryDescription")}
      >
        <div role="radiogroup" aria-labelledby="delivery-label" className="flex flex-col gap-2">
          {(["instant", "digest"] as Delivery[]).map((d) => {
            const selected = current.delivery === d;
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={busy}
                onClick={() => {
                  if (!selected) void save({ delivery: d });
                }}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected ? "border-accent bg-accent/5" : "border-line bg-surface hover:border-line-strong"
                }`}
              >
                <span className="block text-[15px] font-semibold text-fg">{deliveryLabel(d)}</span>
                <span className="mt-0.5 block text-sm text-fg-muted leading-relaxed">
                  {d === "instant" ? t("settings.notifications.instantDescription") : digestDescription(current.gets_briefs)}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        title={t("settings.notifications.urgentTitle")}
        titleId="urgent-through-label"
        description={
          current.urgent_through
            ? t("settings.notifications.urgentOn")
            : t("settings.notifications.urgentOff")
        }
        action={
          <Switch
            checked={current.urgent_through}
            labelledBy="urgent-through-label"
            disabled={busy}
            onChange={(urgent_through) => void save({ urgent_through })}
          />
        }
      />

      {current.gets_briefs && (
        <p className="text-[15px] text-fg-muted">
          {tRich("settings.notifications.briefsNote", {
            link: (
              <Link href="/settings/executive" className="font-medium text-accent underline-offset-2 hover:underline">
                {t("settings.notifications.yourExecutive")}
              </Link>
            ),
          })}
        </p>
      )}
    </>
  );
}
