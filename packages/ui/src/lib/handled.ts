// Pure logic behind the briefing's handled rail (HandledOvernightPanel in
// components/Briefing.tsx): grouping audit rows per alert, the one-line
// summary, and the trailer links. No React here so `npm test` can exercise
// it directly (scripts/handled.test.mjs).
import { t, tp, type MessageKey } from "../i18n/index.ts";
import type { HandledItem } from "./api";

// Handled since your last brief — what the Executive's alert review COMPLETED
// on its own since the last delivered morning brief (routed, nudged,
// escalated, drafted, merged, closed) plus the research watch policy's
// autonomous adds/drops. Rewrites of open alerts are deliberately absent:
// the alert is still in "Needs you" and its card carries the note, so
// listing it here would double-report it and call it done.
//
// Deliberately quiet: the default render is ONE sentence of counts. The
// rows — and Undo for every autonomous close, which is what makes the
// autonomy un-scary (visible, evidence-cited, one click back) — sit behind
// a "details" disclosure. A night with nothing handled renders nothing.
//
// Voice: first person, past tense, specific, nothing the audit row cannot
// back. The heading counts three buckets and never interpolates names, so
// it reads the same whether the roster lookup found "Dana Kim" or not.

// One table per kind: reading order (what needs the principal first, then
// what they can undo, then what went to others, then transparency) and the
// short past-tense verb for the "also …" trailer.
export const HANDLED_KINDS: Record<string, { order: number; verb: MessageKey }> = {
  escalated: { order: 0, verb: "lib.handled.verb.escalated" },
  closed: { order: 1, verb: "lib.handled.verb.closed" },
  merged: { order: 1, verb: "lib.handled.verb.merged" },
  routed: { order: 2, verb: "lib.handled.verb.routed" },
  nudged: { order: 2, verb: "lib.handled.verb.nudged" },
  drafted: { order: 2, verb: "lib.handled.verb.drafted" },
  suggested_workflow: { order: 3, verb: "lib.handled.verb.suggestedWorkflow" },
  watching: { order: 3, verb: "lib.handled.verb.watching" },
  stopped_watching: { order: 3, verb: "lib.handled.verb.stoppedWatching" },
};
export const handledOrder = (kind: string) => HANDLED_KINDS[kind]?.order ?? 4;
export const handledVerb = (kind: string) => {
  const verb = HANDLED_KINDS[kind]?.verb;
  return verb ? t(verb) : kind;
};

// Stable key for one handled row (an alert can appear twice in one pass —
// e.g. routed then closed — so the alert id alone is not unique).
export function handledKey(h: HandledItem): string {
  return `${h.kind}-${h.at}-${h.alert_id ?? ""}`;
}

export function isCloseKind(h: HandledItem): boolean {
  return h.kind === "closed" || h.kind === "merged";
}

// One visible row plus the other moves on the same alert folded under it.
export interface HandledRow {
  item: HandledItem;
  also: HandledItem[];
  foldedIn: number;
}

// Collapse the newest-first list to one row per alert. A merge whose survivor
// is also listed becomes a "duplicate folded in" count on the survivor. The
// newest move wins the visible slot, with two overrides: a close (terminal,
// and the row that carries Undo) is never hidden behind an older move, and
// otherwise an escalation beats routed / nudged / drafted — the boast must
// never bury the row that needs the CEO.
export function groupHandled(items: HandledItem[]): HandledRow[] {
  const listed = new Set(items.map((h) => h.alert_id).filter((id): id is number => id != null));
  const foldedInto = new Map<number, number>();
  const rest: HandledItem[] = [];
  for (const h of items) {
    const into = h.superseded_by_alert_id;
    if (h.kind === "merged" && into != null && listed.has(into)) {
      foldedInto.set(into, (foldedInto.get(into) ?? 0) + 1);
    } else {
      rest.push(h);
    }
  }
  const byKey = new Map<string, HandledRow>();
  const rows: HandledRow[] = [];
  for (const h of rest) {
    const key = h.alert_id != null ? `alert-${h.alert_id}` : handledKey(h);
    const row = byKey.get(key);
    if (!row) {
      const fresh: HandledRow = {
        item: h,
        also: [],
        foldedIn: h.alert_id != null ? foldedInto.get(h.alert_id) ?? 0 : 0,
      };
      byKey.set(key, fresh);
      rows.push(fresh);
    } else if (h.kind === "escalated" && !isCloseKind(row.item) && row.item.kind !== "escalated") {
      row.also.push(row.item);
      row.item = h;
    } else {
      row.also.push(h);
    }
  }
  // Stable sort keeps newest-first inside each bucket.
  rows.sort((a, b) => handledOrder(a.item.kind) - handledOrder(b.item.kind));
  return rows;
}

export function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return t("lib.handled.joinTwo", { a: parts[0], b: parts[1] });
  return t("lib.handled.joinMany", { list: parts.slice(0, -1).join(", "), last: parts[parts.length - 1] });
}

// "Since your last brief: 3 off your plate, 2 in others' hands, and 1 waiting
// on you." Counts only — a name lookup that fell back to "person 12" can
// never leak into the headline. Every kind lands in some bucket, because
// this sentence is the whole default render: a close the principal already
// undid reads as "back on your plate" (the status alone does not say who
// reopened it), never as a fresh move.
export function handledHeadline(rows: HandledRow[], reverted: (h: HandledItem) => boolean): string {
  const counts = { offPlate: 0, reopened: 0, others: 0, waiting: 0, drafted: 0, suggested: 0, watches: 0, other: 0 };
  for (const r of rows) {
    const k = r.item.kind;
    if (isCloseKind(r.item)) counts[reverted(r.item) ? "reopened" : "offPlate"] += 1;
    else if (k === "routed" || k === "nudged") counts.others += 1;
    else if (k === "escalated") counts.waiting += 1;
    else if (k === "drafted") counts.drafted += 1;
    else if (k === "suggested_workflow") counts.suggested += 1;
    else if (k === "watching" || k === "stopped_watching") counts.watches += 1;
    else counts.other += 1;
  }
  const parts: string[] = [];
  if (counts.offPlate > 0) parts.push(t("lib.handled.offPlate", { n: counts.offPlate }));
  if (counts.others > 0) parts.push(t("lib.handled.others", { n: counts.others }));
  if (counts.waiting > 0) parts.push(t("lib.handled.waiting", { n: counts.waiting }));
  if (counts.drafted > 0) parts.push(tp("lib.handled.drafts", counts.drafted));
  if (counts.suggested > 0) parts.push(tp("lib.handled.workflows", counts.suggested));
  if (counts.watches > 0) parts.push(tp("lib.handled.watches", counts.watches));
  if (counts.other > 0) parts.push(tp("lib.handled.otherMoves", counts.other));
  if (counts.reopened > 0) parts.push(t("lib.handled.reopened", { n: counts.reopened }));
  return t("lib.handled.headline", { parts: joinClauses(parts) });
}

// Statuses `POST /alerts/{id}/reopen` accepts, plus "" for an unknown lookup.
export const HANDLED_REOPENABLE = new Set(["", "resolved", "dismissed", "expired", "merged"]);


// The audit page pre-filters on these two query params, so the row's
// "evidence" link lands on the rows that back it.
export function handledProofHref(h: HandledItem): string | null {
  if (!h.event_type) return null;
  const q = (h.headline ?? "").slice(0, 40);
  return `/audit?event_type=${encodeURIComponent(h.event_type)}&q=${encodeURIComponent(q)}`;
}

// Muted trailer under a collapsed row: duplicates folded in, other moves.
export function handledAlsoLine(row: HandledRow): string {
  const parts: string[] = [];
  if (row.foldedIn > 0) parts.push(tp("lib.handled.foldedIn", row.foldedIn));
  if (row.also.length > 0) parts.push(t("lib.handled.also", { verbs: row.also.map((a) => handledVerb(a.kind)).join(", ") }));
  return parts.join(" · ");
}
