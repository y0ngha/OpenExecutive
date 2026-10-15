// The plain lines on a person's Overview: how the Executive reaches them and
// whether they are away. The ids behind them are edited under Advanced.
//
// Type-only imports (and i18n by relative path), so `npm test` can exercise
// this under `node --experimental-strip-types` (see scripts/personReach.test.mjs).

import { displayLocale, t, type MessageKey } from "../i18n/index.ts";
import type { Person } from "@/lib/api";

type ReachFields = Pick<
  Person,
  "email" | "slack_user_id" | "discord_user_id" | "telegram_chat_id" | "preferred_channel" | "response_sla_hours"
>;

// How each channel reads after "Reaches them" when it is the only one named.
const VIA: Record<string, MessageKey> = {
  email: "people.reach.via.email",
  slack: "people.reach.via.slack",
  discord: "people.reach.via.discord",
  telegram: "people.reach.via.telegram",
};

const BRAND_NAMES: Record<string, string> = {
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
};

function channelName(channel: string): string {
  return channel === "email" ? t("people.reach.name.email") : (BRAND_NAMES[channel] ?? channel);
}

function channelPhrase(channel: string): string {
  const key = VIA[channel];
  return key ? t(key) : t("people.reach.via.other", { channel });
}

function joinOr(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return t("people.reach.joinOr", { rest: items.slice(0, -1).join(", "), last: items[items.length - 1] });
}

/** The channels this person has an address or id for, in a fixed order. */
export function availableChannels(p: ReachFields): string[] {
  return [
    p.email ? "email" : null,
    p.slack_user_id ? "slack" : null,
    p.discord_user_id ? "discord" : null,
    p.telegram_chat_id ? "telegram" : null,
  ].filter((c): c is string => c !== null);
}

/**
 * "Reaches them on Discord, replies within 12h". `self` says "you" on your
 * own card; a contact has no reply time.
 */
export function reachLine(p: ReachFields, opts: { self?: boolean; contact?: boolean } = {}): string {
  const have = availableChannels(p);
  let via: string;
  // Delivery tries the preferred channel first among those with an address
  // or id, so a preferred channel with nothing set reads like "any".
  if (p.preferred_channel && p.preferred_channel !== "any" && have.includes(p.preferred_channel)) {
    via = channelPhrase(p.preferred_channel);
  } else if (have.length === 0) {
    return opts.self ? t("people.reach.noneYou") : t("people.reach.noneThem");
  } else if (have.length === 1) {
    via = channelPhrase(have[0]);
  } else {
    // "by email or Telegram", "on Slack or Discord"
    const list = joinOr(have.map(channelName));
    via = have[0] === "email"
      ? t("people.reach.viaListEmail", { list })
      : t("people.reach.viaList", { list });
  }
  const how = opts.self ? t("people.reach.reachesYou", { via }) : t("people.reach.reachesThem", { via });
  return opts.contact ? how : t("people.reach.withReplyTime", { how, n: p.response_sla_hours });
}

/** "On leave until 24 Oct" for a YYYY-MM-DD date, with the year when it isn't this year. */
export function onLeaveLine(date: string | null | undefined, today: Date = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ymd = `${m[1]}-${m[2]}-${m[3]}`;
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  // A date that has passed means they are back.
  if (ymd < todayYmd) return null;
  const monthName = new Date(year, month - 1, 1).toLocaleDateString(displayLocale(), { month: "short" });
  const when =
    year === today.getFullYear()
      ? t("people.reach.leaveDate", { day, month: monthName })
      : t("people.reach.leaveDateYear", { day, month: monthName, year });
  return t("people.reach.onLeave", { date: when });
}
