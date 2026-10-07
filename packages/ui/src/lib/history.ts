// Always in the loop: how the History tab and the settings word a person's
// notes and how long they last, from GET /memories/history. Kept free of
// React so scripts/ can test it.

import { t, tp, type MessageKey } from "../i18n/index.ts";

export interface HistoryNote {
  id: number;
  source: string;
  channel: string;
  conversation_key: string;
  counterpart: string;
  subject: string;
  kind: string;
  summary: string;
  quote: string;
  due_date: string | null;
  trust: string;
  occurred_at: string;
  created_at: string;
  expires_at: string | null;
  pinned: boolean;
  correction: string | null;
  corrected_at: string | null;
}

export interface HistoryState {
  notes: HistoryNote[];
  reply_notes: boolean;
  /** The person's own choice; null is the company default. */
  retention_days: number | null;
  /** What applies to their new notes; null is until they forget them. */
  effective_retention_days: number | null;
  /** null is until forgotten. */
  company_retention_days: number | null;
  retention_choices: (number | null)[];
  /** Whether they may turn "Keep track of what happens" on: a team member
   * on the People list. */
  can_keep_notes: boolean;
  /** Whether notes from their email replies can come too (Act as me). */
  can_note_replies: boolean;
  can_set_company_retention: boolean;
}

/** "30 days", "1 year", or "until forgotten" for null. */
export function retentionLabel(days: number | null): string {
  if (days === null) return t("lib.history.untilForgotten");
  if (days === 365) return t("lib.history.oneYear");
  return tp("lib.history.days", days);
}

/** The choices a person may pick for their own notes: the company default
 * (null), then each choice shorter than the company's. Their stored choice
 * is always among them, even one no longer shorter (the owner shortening the
 * company time clamps it to the company's), so the box never shows a value
 * they didn't pick. */
export function personRetentionChoices(
  choices: (number | null)[],
  company: number | null,
  current: number | null = null,
): (number | null)[] {
  const shorter = choices.filter(
    (d): d is number => d !== null && (company === null || d < company),
  );
  if (current !== null && !shorter.includes(current)) shorter.push(current);
  return [null, ...shorter.sort((a, b) => a - b)];
}

const KIND_LABELS: Record<string, MessageKey> = {
  promised: "lib.history.kind.promised",
  agreed: "lib.history.kind.agreed",
  declined: "lib.history.kind.declined",
  answered: "lib.history.kind.answered",
  asked: "lib.history.kind.asked",
  shared: "lib.history.kind.shared",
};

export function kindLabel(kind: string): string {
  const key = KIND_LABELS[kind];
  return key ? t(key) : kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** "Dana Lee <dana@acme.example>" → "Dana Lee"; a bare address stays as it is. */
export function counterpartName(counterpart: string): string {
  const trimmed = counterpart.trim();
  const named = /^(.*?)\s*<[^>]*>$/.exec(trimmed);
  if (named && named[1].trim()) return named[1].trim().replace(/^"|"$/g, "");
  return trimmed.replace(/^<|>$/g, "");
}

const CHANNEL_LABELS: Record<string, MessageKey> = { email: "lib.channel.email", web: "lib.channel.webChat" };

/** "Email with Dana Lee", or the channel alone ("Slack", "Web chat") when
 * nobody is named, as for what someone said in chat. */
export function noteWhere(note: Pick<HistoryNote, "channel" | "counterpart">): string {
  const key = CHANNEL_LABELS[note.channel];
  const channel = key ? t(key) : note.channel.charAt(0).toUpperCase() + note.channel.slice(1);
  const who = counterpartName(note.counterpart);
  return who ? t("lib.history.where", { channel, who }) : channel;
}

/** What the note says now: their correction when they made one. */
export function noteText(note: Pick<HistoryNote, "summary" | "correction">): string {
  return note.correction?.trim() ? note.correction : note.summary;
}

/** When it goes, as the row says it: "Kept until you forget it" when pinned
 * or kept for good, else "Forgotten on 2026-12-30". */
export function noteExpiry(note: Pick<HistoryNote, "pinned" | "expires_at">): string {
  if (note.pinned) return t("lib.history.pinned");
  if (!note.expires_at) return t("lib.history.kept");
  return t("lib.history.forgottenOn", { date: note.expires_at.slice(0, 10) });
}
