// Settings → Notifications: the signed-in person's own quiet hours, digest or
// instant, and whether urgent things get through (GET/PUT
// /notifications/settings). Types and wording only, kept free of React so
// scripts/ can test it.

import { t, tp } from "../i18n/index.ts";

export type QuietDays = "every_day" | "weekdays";
export type Delivery = "instant" | "digest";

export interface QuietHours {
  enabled: boolean;
  /** HH:MM, 24-hour, in `effective_timezone`. May be later than `end`. */
  start: string;
  end: string;
  days: QuietDays;
}

export interface NotificationSettings {
  quiet_hours: QuietHours;
  delivery: Delivery;
  urgent_through: boolean;
  /** The zone they chose; "" for the workspace's. */
  timezone: string;
  effective_timezone: string;
  /** Messages waiting for quiet hours to end or for their next brief. */
  held_count: number;
  /** They get the morning and end-of-day briefs (the account owner). */
  gets_briefs: boolean;
  updated_at: string;
}

export interface NotificationSettingsUpdate {
  quiet_hours: QuietHours;
  delivery: Delivery;
  urgent_through: boolean;
  timezone: string;
}

export const QUIET_DAYS: QuietDays[] = ["every_day", "weekdays"];

export function daysLabel(days: QuietDays): string {
  return days === "weekdays" ? t("settings.notifications.days.weekdays") : t("settings.notifications.days.everyDay");
}

/** "10:00 pm" for "22:00". */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const time = `${h % 12 || 12}:${String(m).padStart(2, "0")}`;
  return h < 12 ? t("settings.notifications.clock.am", { time }) : t("settings.notifications.clock.pm", { time });
}

/** Whether the quiet hours run past midnight (22:00 → 07:00). */
export function crossesMidnight(q: Pick<QuietHours, "start" | "end">): boolean {
  return q.end <= q.start;
}

/** One line saying what the quiet hours do, from the person's side. */
export function quietSummary(q: QuietHours): string {
  if (!q.enabled) return t("settings.notifications.quiet.off");
  const span = crossesMidnight(q)
    ? t("settings.notifications.quiet.spanOvernight", { start: clockLabel(q.start), end: clockLabel(q.end) })
    : t("settings.notifications.quiet.span", { start: clockLabel(q.start), end: clockLabel(q.end) });
  return q.days === "weekdays"
    ? t("settings.notifications.quiet.weekdays", { span })
    : t("settings.notifications.quiet.everyDay", { span });
}

/** Why the form can't be saved yet, or null. */
export function quietError(q: QuietHours): string | null {
  if (!q.enabled) return null;
  if (!/^\d{2}:\d{2}$/.test(q.start) || !/^\d{2}:\d{2}$/.test(q.end)) return t("settings.notifications.error.pickTimes");
  if (q.start === q.end) return t("settings.notifications.error.sameTimes");
  return null;
}

/** What "In my briefs" means for this person: the owner gets briefs; anyone
 * else gets the held messages on their own when the briefs go out. */
export function digestDescription(getsBriefs: boolean): string {
  return getsBriefs
    ? t("settings.notifications.digest.owner")
    : t("settings.notifications.digest.member");
}

/** "2 messages are waiting for you", or null when none are. */
export function heldLine(count: number, delivery: Delivery): string | null {
  if (count <= 0) return null;
  return delivery === "digest"
    ? tp("settings.notifications.held.brief", count)
    : tp("settings.notifications.held.quiet", count);
}

/** The PUT body for a form state; the browser's zone fills an unset one, so
 * the times mean what the person sees. */
export function toUpdate(
  s: Pick<NotificationSettings, "quiet_hours" | "delivery" | "urgent_through" | "timezone">,
  browserZone: string | null,
): NotificationSettingsUpdate {
  return {
    quiet_hours: { ...s.quiet_hours },
    delivery: s.delivery,
    urgent_through: s.urgent_through,
    timezone: s.timezone || browserZone || "",
  };
}

export function deliveryLabel(delivery: Delivery): string {
  return delivery === "digest" ? t("settings.notifications.delivery.digest") : t("settings.notifications.delivery.instant");
}

/** The Settings hub tile's one-line status. */
export function tileStatus(s: Pick<NotificationSettings, "quiet_hours" | "delivery">): string {
  const q = s.quiet_hours;
  const quiet = q.enabled
    ? t("settings.notifications.tile.quiet", { start: clockLabel(q.start), end: clockLabel(q.end) })
    : t("settings.notifications.tile.quietOff");
  return `${quiet} · ${deliveryLabel(s.delivery)}`;
}
