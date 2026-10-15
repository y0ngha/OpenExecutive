/**
 * A department's recurring check-in as a plain choice: every day, every week
 * on a given day, or off — the picker on a department's settings. The backend
 * stores a cadence spec (departments/cadence.py), always in UTC:
 * `daily@HH:MM`, `weekly@DOW@HH:MM` (or `weekly@DOW-HH:MM`), or an empty
 * string for off. Any other spec (a quarterly one, say) is kept as "custom"
 * so opening and saving the settings never rewrites it.
 */

import { displayLocale, t, type MessageKey } from "../i18n/index.ts";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type CheckInChoice =
  | { kind: "daily"; time: string }
  | { kind: "weekly"; day: Weekday; time: string }
  | { kind: "off" }
  | { kind: "custom"; spec: string };

export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const WEEKDAY_KEYS: Record<Weekday, MessageKey> = {
  mon: "people.weekdayLong.mon",
  tue: "people.weekdayLong.tue",
  wed: "people.weekdayLong.wed",
  thu: "people.weekdayLong.thu",
  fri: "people.weekdayLong.fri",
  sat: "people.weekdayLong.sat",
  sun: "people.weekdayLong.sun",
};

/** "Monday", in the deployment's language. */
export function weekdayLabel(day: Weekday): string {
  return t(WEEKDAY_KEYS[day]);
}

/** What a new department starts with (DEFAULT_CHECK_IN_CADENCE). */
export const DEFAULT_CHECK_IN_DAY: Weekday = "mon";
export const DEFAULT_CHECK_IN_TIME = "09:00";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAILY_RE = /^daily@(\d{2}:\d{2})$/;
const WEEKLY_RE = /^weekly@([A-Za-z]{3})[@-](\d{2}:\d{2})$/;

function isWeekday(v: string): v is Weekday {
  return (WEEKDAYS as string[]).includes(v);
}

/** Read a stored spec (missing or blank means off). */
export function parseCheckIn(spec: string | null | undefined): CheckInChoice {
  const raw = (spec ?? "").trim();
  if (!raw) return { kind: "off" };
  const daily = DAILY_RE.exec(raw);
  if (daily && TIME_RE.test(daily[1])) return { kind: "daily", time: daily[1] };
  const weekly = WEEKLY_RE.exec(raw);
  if (weekly) {
    const day = weekly[1].toLowerCase();
    if (isWeekday(day) && TIME_RE.test(weekly[2])) {
      return { kind: "weekly", day, time: weekly[2] };
    }
  }
  return { kind: "custom", spec: raw };
}

/** The spec to save for a choice. Off is the empty spec. */
export function checkInSpec(choice: CheckInChoice): string {
  switch (choice.kind) {
    case "daily":
      return `daily@${choice.time}`;
    case "weekly":
      return `weekly@${choice.day}@${choice.time}`;
    case "off":
      return "";
    case "custom":
      return choice.spec;
  }
}

/** Switch to another kind, keeping the time (and day) already picked. */
export function withKind(
  choice: CheckInChoice,
  kind: "daily" | "weekly" | "off",
): CheckInChoice {
  const time = "time" in choice ? choice.time : DEFAULT_CHECK_IN_TIME;
  if (kind === "daily") return { kind, time };
  if (kind === "weekly") {
    return { kind, day: choice.kind === "weekly" ? choice.day : DEFAULT_CHECK_IN_DAY, time };
  }
  return { kind: "off" };
}

/** The choice in words, for the settings summary. */
export function describeCheckIn(choice: CheckInChoice): string {
  switch (choice.kind) {
    case "daily":
      return t("people.checkIn.everyDay", { time: choice.time });
    case "weekly":
      return t("people.checkIn.everyWeekday", { day: weekdayLabel(choice.day), time: choice.time });
    case "off":
      return t("people.dept.checkIn.off");
    case "custom":
      return choice.spec;
  }
}

/**
 * The queued next check-in as a short local date and time, e.g.
 * "Mon 20 Oct, 09:00". Empty for a missing or unreadable timestamp.
 */
export function formatNextCheckIn(
  iso: string | null | undefined,
  timeZone?: string | null,
  locale: string = displayLocale(),
): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "";
  try {
    return at.toLocaleString(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    // An unknown zone name: fall back to the browser's own.
    return at.toLocaleString(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
