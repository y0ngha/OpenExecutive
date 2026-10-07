// The reply cards on Today (GET /delegation/replies): the wording for who
// the sender is to you and for each warning a card carries, kept apart from
// the component so `npm test` can check it (see scripts/replyCards.test.mjs).
// The flags come from delegation/inbox.py (card_flags, the reconciler),
// delegation/threads.py (plan_reply) and delegation/ghostwriter.py (lint).

import { t, type MessageKey } from "../i18n/index.ts";

const RELATION_TEXT: Record<string, MessageKey> = {
  team: "lib.reply.relation.team",
  contact: "lib.reply.relation.contact",
  correspondent: "lib.reply.relation.correspondent",
  stranger: "lib.reply.relation.stranger",
};

/** Who the sender is to you, or "" for a relation this UI doesn't know. */
export function relationLabel(relation: string): string {
  const key = RELATION_TEXT[relation];
  return key ? t(key) : "";
}

// asks_if_ai is left out: the card's open questions already say it.
const FLAG_TEXT: Record<string, MessageKey> = {
  send_failed: "lib.reply.flag.sendFailed",
  sender_unverified: "lib.reply.flag.senderUnverified",
  thread_moved_on: "lib.reply.flag.threadMovedOn",
  others_on_thread: "lib.reply.flag.othersOnThread",
  executive_on_thread: "lib.reply.flag.executiveOnThread",
  reply_to_ignored: "lib.reply.flag.replyToIgnored",
  mailing_list: "lib.reply.flag.mailingList",
  removed_link: "lib.reply.flag.removedLink",
  removed_address: "lib.reply.flag.removedAddress",
  names_the_executive: "lib.reply.flag.namesTheExecutive",
  shortened: "lib.reply.flag.shortened",
};

// The order the warnings show in: the ones to act on first.
const FLAG_ORDER = Object.keys(FLAG_TEXT);

/** A card's warnings in plain words, most pressing first, each once.
 * Flags this UI doesn't know are left out rather than shown raw. */
export function replyFlagLines(flags: readonly string[]): string[] {
  const seen = new Set(flags);
  return FLAG_ORDER.filter((f) => seen.has(f)).map((f) => t(FLAG_TEXT[f]));
}

/** "Dana Park <dana@…>" as the card's From line; the address alone when
 * there is no name. */
export function senderLine(card: { from_name: string; from_email: string }): string {
  const name = card.from_name.trim();
  return name ? `${name} <${card.from_email}>` : card.from_email;
}

/** The sender as the card's short line shows it: the name with the address's
 * domain ("Dana Park · @x.example"), so the line fits a phone while the part a
 * lookalike would change stays in sight. A display name is the sender's own
 * text, so the domain is never dropped; without a confirmed sender (or a name)
 * the full address shows. */
export function senderShort(card: { from_name: string; from_email: string; sender_verified?: boolean }): string {
  const name = card.from_name.trim();
  const at = card.from_email.lastIndexOf("@");
  if (!name || card.sender_verified !== true || at < 0) return senderLine(card);
  return `${name} · @${card.from_email.slice(at + 1)}`;
}

/** Whether a draft is long enough to show clamped, with a Show full draft toggle. */
export function draftIsLong(body: string): boolean {
  return body.length > 280 || body.split("\n").length > 5;
}

// Where a draft in someone's own mailbox opens: Gmail, or Outlook on the web
// (work or school, and personal). Must match delegation.gmail's link builders.
export const MAILBOX_LINK_PREFIXES = [
  "https://mail.google.com/",
  "https://outlook.office.com/mail/",
  "https://outlook.live.com/mail/",
] as const;

/** Whether ``link`` opens the person's own mailbox (Gmail or Outlook). */
export function isMailboxLink(link: string): boolean {
  return MAILBOX_LINK_PREFIXES.some((prefix) => link.startsWith(prefix));
}

/** The card's mailbox link, only when it really opens their mailbox: the
 * backend builds it from a fixed prefix, and the page never links anywhere else. */
export function safeGmailLink(link: string): string {
  return isMailboxLink(link) ? link : "";
}

/** Which mailbox a card's link opens, to name it on the card. */
export function mailboxName(link: string): string {
  return link.startsWith("https://outlook.") ? "Outlook" : "Gmail";
}

/** The first Send's question: who it goes to, from where. */
export function sendQuestion(recipients: readonly string[], mailbox = "Gmail"): string {
  const to = recipients.length ? recipients.join(", ") : t("lib.reply.theSender");
  return t("lib.reply.sendQuestion", { to, mailbox });
}

// Send refusals after which the card is gone for good: its draft was sent or
// deleted in Gmail, you replied yourself, or another tap already sent it.
const GONE_CODES = new Set(["draft_gone", "you_replied", "already_handled"]);

/** Whether a Send refused with ``code`` leaves nothing to act on. */
export function sendLeftNothing(code: string): boolean {
  return GONE_CODES.has(code);
}
