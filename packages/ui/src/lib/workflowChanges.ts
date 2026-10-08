// Plain-words view of a custom workflow: its schedule, and what a revision
// changes compared with the saved version. Pure (type imports and the
// relative i18n import only), so the node test runner can load it.
import type { DynamicStep, DynamicWorkflowDef } from "./api";
import { t, tp, type MessageKey } from "../i18n/index.ts";

const DAYS: Record<string, MessageKey> = {
  mon: "jobs.day.mon",
  tue: "jobs.day.tue",
  wed: "jobs.day.wed",
  thu: "jobs.day.thu",
  fri: "jobs.day.fri",
  sat: "jobs.day.sat",
  sun: "jobs.day.sun",
};

/** Plain-words rendering of the cadence DSL (daily@HH:MM, weekly@DOW@HH:MM, quarterly@DD-HH:MM). */
export function describeCadence(cadence: string | null | undefined): string {
  if (!cadence) return t("jobs.cadence.manual");
  const parts = cadence.split("@");
  if (parts[0] === "daily" && parts[1]) return t("jobs.cadence.daily", { time: parts[1] });
  if (parts[0] === "weekly" && parts[1] && parts[2]) {
    const dayKey = DAYS[parts[1].toLowerCase()];
    const day = dayKey ? t(dayKey) : parts[1];
    return t("jobs.cadence.weekly", { day, time: parts[2] });
  }
  if (parts[0] === "quarterly" && parts[1]) {
    const [dd, time] = parts[1].split("-");
    return t("jobs.cadence.quarterly", { day: Number(dd), time });
  }
  return cadence;
}

/** How to name people, specialists and tools — supplied by the page. */
export interface ChangeLabels {
  person: (id: number | null | undefined) => string;
  specialist: (key: string | undefined) => string;
  tool: (name: string) => string;
}

const ON_TIMEOUT: Record<string, MessageKey> = {
  escalate: "jobs.changes.onTimeout.escalate",
  auto_proceed: "jobs.changes.onTimeout.auto_proceed",
  fail: "jobs.changes.onTimeout.fail",
};

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return t("jobs.changes.listAnd", {
    items: items.slice(0, -1).join(", "),
    last: items[items.length - 1],
  });
}

function stepWho(step: DynamicStep, labels: ChangeLabels): string {
  if (step.kind === "specialist") return labels.specialist(step.specialist);
  if (step.kind === "approval_gate")
    return t("jobs.changes.who.signOff", { name: labels.person(step.person_id) });
  if (step.kind === "action") return tp("jobs.changes.who.uses", step.tools.length);
  return t("jobs.changes.who.final");
}

function stepText(step: DynamicStep): string {
  if (step.kind === "approval_gate") return step.question;
  if (step.kind === "synthesis") return step.instructions ?? "";
  return step.goal;
}

// What a sign-off asks for. Anything but approve/reject is a question, not
// permission: the run carries on whatever the answer, so say so.
const REPLY_SHAPE: Record<string, MessageKey> = {
  approve_reject: "jobs.changes.reply.approve_reject",
  free_text: "jobs.changes.reply.free_text",
  numeric: "jobs.changes.reply.numeric",
  document: "jobs.changes.reply.document",
};
const REPLY_SHAPE_SHORT: Record<string, MessageKey> = {
  approve_reject: "jobs.changes.replyShort.approve_reject",
  free_text: "jobs.changes.replyShort.free_text",
  numeric: "jobs.changes.replyShort.numeric",
  document: "jobs.changes.replyShort.document",
};

/** Text for `shape` from `table`, or the raw shape when it isn't known. */
function shapeText(table: Record<string, MessageKey>, shape: string): string {
  const key = table[shape];
  return key ? t(key) : shape;
}

// Fields each step kind's sentences cover, and the defaults the server fills
// in, so a field the model left out reads the same as its default. Any other
// field that differs still gets a line (see `otherFieldsDiffer`).
const STEP_DEFAULTS: Record<string, Record<string, unknown>> = {
  common: { kind: undefined, id: undefined, title: undefined, description: "" },
  specialist: { specialist: undefined, goal: undefined, rag_query: "", playbook: "" },
  approval_gate: {
    person_id: undefined,
    question: undefined,
    timeout_hours: 48,
    on_timeout: "escalate",
    expected_reply_shape: "approve_reject",
  },
  synthesis: { instructions: "", specialist: "cso" },
  action: { goal: undefined, tools: undefined, max_tool_calls: 20 },
};

function field(obj: object, key: string, defaults: Record<string, unknown>): unknown {
  const v = (obj as Record<string, unknown>)[key];
  return v === undefined || v === null ? defaults[key] : v;
}

/** True when a field not in `covered` differs (a field this file doesn't know yet). */
function otherFieldsDiffer(a: object, b: object, covered: string[]): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (covered.includes(k)) continue;
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (JSON.stringify(va ?? null) !== JSON.stringify(vb ?? null)) return true;
  }
  return false;
}

function stepChanges(a: DynamicStep, b: DynamicStep, labels: ChangeLabels): string[] {
  const out: string[] = [];
  const name = `“${b.title}”`;
  const defaults = { ...STEP_DEFAULTS.common, ...STEP_DEFAULTS[b.kind] };
  const get = (s: DynamicStep, k: string) => field(s, k, defaults);
  if (a.title !== b.title) out.push(t("jobs.changes.renamedStep", { old: a.title, name }));
  if (a.kind === "specialist" && b.kind === "specialist" && a.specialist !== b.specialist)
    out.push(
      t("jobs.changes.handledBy", {
        name,
        new: labels.specialist(b.specialist),
        old: labels.specialist(a.specialist),
      })
    );
  if (a.kind === "synthesis" && b.kind === "synthesis" && get(a, "specialist") !== get(b, "specialist"))
    out.push(
      t("jobs.changes.writtenBy", {
        name,
        new: labels.specialist(b.specialist),
        old: labels.specialist(a.specialist),
      })
    );
  if (a.kind === "approval_gate" && b.kind === "approval_gate") {
    if (a.person_id !== b.person_id)
      out.push(
        t("jobs.changes.signOffBy", {
          name,
          new: labels.person(b.person_id),
          old: labels.person(a.person_id),
        })
      );
    const sa = String(get(a, "expected_reply_shape"));
    const sb = String(get(b, "expected_reply_shape"));
    if (sa !== sb)
      out.push(
        t("jobs.changes.asksFor", {
          name,
          new: shapeText(REPLY_SHAPE, sb),
          old: shapeText(REPLY_SHAPE_SHORT, sa),
        })
      );
    const ha = get(a, "timeout_hours");
    const hb = get(b, "timeout_hours");
    if (ha !== hb) out.push(t("jobs.changes.timeout", { name, new: String(hb), old: String(ha) }));
    const tb = String(get(b, "on_timeout"));
    if (get(a, "on_timeout") !== tb)
      out.push(t("jobs.changes.onTimeout", { name, action: shapeText(ON_TIMEOUT, tb) }));
  }
  if (a.kind === "action" && b.kind === "action") {
    const added = b.tools.filter((tool) => !a.tools.includes(tool));
    const removed = a.tools.filter((tool) => !b.tools.includes(tool));
    if (added.length) out.push(t("jobs.changes.canUse", { name, tools: list(added.map(labels.tool)) }));
    if (removed.length)
      out.push(t("jobs.changes.noLongerUses", { name, tools: list(removed.map(labels.tool)) }));
    const ma = get(a, "max_tool_calls");
    const mb = get(b, "max_tool_calls");
    if (ma !== mb) out.push(t("jobs.changes.maxCalls", { name, new: String(mb), old: String(ma) }));
  }
  if (a.kind === "specialist" && b.kind === "specialist") {
    if (get(a, "playbook") !== get(b, "playbook"))
      out.push(
        b.playbook
          ? t("jobs.changes.followsPlaybook", { name, playbook: b.playbook })
          : t("jobs.changes.noPlaybook", { name })
      );
    if (get(a, "rag_query") !== get(b, "rag_query")) out.push(t("jobs.changes.ragQuery", { name }));
  }
  if (stepText(a).trim() !== stepText(b).trim()) out.push(t("jobs.changes.newInstructions", { name }));
  if (String(get(a, "description")).trim() !== String(get(b, "description")).trim())
    out.push(t("jobs.changes.stepDescription", { name }));
  if (otherFieldsDiffer(a, b, Object.keys(defaults))) out.push(t("jobs.changes.stepOther", { name }));
  return out;
}

// Top-level fields covered above, plus ones the server owns (not changes).
const TOP_LEVEL_FIELDS = [
  "name", "title", "description", "section", "estimated_minutes", "input_fields", "steps",
  "cadence", "cadence_person_id", "is_active", "created_at", "updated_at", "owner_person_id",
];

/** Plain words for what a sign-off asks for (shown on the review card). */
export function replyShapeLabel(shape: string | undefined): string | null {
  if (!shape || shape === "approve_reject") return null;
  return shapeText(REPLY_SHAPE_SHORT, shape);
}

/**
 * What `after` changes compared with `before`, one plain sentence per change.
 * Empty when nothing a person would notice changed.
 */
export function describeChanges(
  before: DynamicWorkflowDef,
  after: DynamicWorkflowDef,
  labels: ChangeLabels
): string[] {
  const out: string[] = [];

  if (before.title !== after.title)
    out.push(t("jobs.changes.renamed", { old: before.title, new: after.title }));
  if ((before.description ?? "").trim() !== (after.description ?? "").trim())
    out.push(t("jobs.changes.description"));
  if (before.section !== after.section)
    out.push(t("jobs.changes.moved", { old: before.section, new: after.section }));
  if (before.estimated_minutes !== after.estimated_minutes)
    out.push(
      t("jobs.changes.minutes", {
        new: String(after.estimated_minutes),
        old: String(before.estimated_minutes),
      })
    );

  // Schedule.
  const ca = before.cadence || null;
  const cb = after.cadence || null;
  if (ca !== cb) {
    out.push(
      cb
        ? t("jobs.changes.schedule", {
            new: describeCadence(cb),
            person: labels.person(after.cadence_person_id),
            old: describeCadence(ca),
          })
        : t("jobs.changes.scheduleOff", { old: describeCadence(ca) })
    );
  } else if (cb && before.cadence_person_id !== after.cadence_person_id) {
    out.push(
      t("jobs.changes.recipient", {
        new: labels.person(after.cadence_person_id),
        old: labels.person(before.cadence_person_id),
      })
    );
  }

  // Inputs, matched by field name.
  const fieldsBefore = new Map(before.input_fields.map((f) => [f.name, f]));
  const fieldsAfter = new Map(after.input_fields.map((f) => [f.name, f]));
  for (const f of after.input_fields) {
    const old = fieldsBefore.get(f.name);
    if (!old) {
      out.push(
        t(f.required === false ? "jobs.changes.asksInputOptional" : "jobs.changes.asksInput", {
          label: f.label,
        })
      );
      continue;
    }
    if (old.label !== f.label)
      out.push(t("jobs.changes.inputRenamed", { old: old.label, new: f.label }));
    if ((old.required !== false) !== (f.required !== false))
      out.push(
        t(f.required === false ? "jobs.changes.nowOptional" : "jobs.changes.nowRequired", {
          label: f.label,
        })
      );
    if (
      (old.description ?? "").trim() !== (f.description ?? "").trim() ||
      !!old.multiline !== !!f.multiline ||
      otherFieldsDiffer(old, f, ["name", "label", "required", "description", "multiline"])
    )
      out.push(t("jobs.changes.formChanged", { label: f.label }));
  }
  for (const f of before.input_fields)
    if (!fieldsAfter.has(f.name)) out.push(t("jobs.changes.noLongerAsks", { label: f.label }));

  // Steps: matched by id, then by title for any the revision re-numbered.
  const unmatched = new Map(before.steps.map((s) => [s.id, s]));
  const pairs: [DynamicStep | null, DynamicStep][] = after.steps.map((s) => {
    const old = unmatched.get(s.id);
    if (old && old.kind === s.kind) {
      unmatched.delete(s.id);
      return [old, s];
    }
    return [null, s];
  });
  for (const pair of pairs) {
    if (pair[0]) continue;
    const s = pair[1];
    const byTitle = Array.from(unmatched.values()).find(
      (o) => o.kind === s.kind && o.title === s.title
    );
    if (byTitle) {
      unmatched.delete(byTitle.id);
      pair[0] = byTitle;
    }
  }
  pairs.forEach(([old, s], i) => {
    if (!old)
      out.push(t("jobs.changes.addedStep", { n: i + 1, title: s.title, who: stepWho(s, labels) }));
    else out.push(...stepChanges(old, s, labels));
  });
  for (const old of unmatched.values()) out.push(t("jobs.changes.removedStep", { title: old.title }));

  const kept = pairs.flatMap(([old]) => (old ? [old.id] : []));
  const keptBefore = before.steps.map((s) => s.id).filter((id) => kept.includes(id));
  if (kept.join("\n") !== keptBefore.join("\n")) out.push(t("jobs.changes.reordered"));

  if (otherFieldsDiffer(before, after, TOP_LEVEL_FIELDS)) out.push(t("jobs.changes.other"));

  return out;
}

/** Tool names a revision adds that the saved version's steps did not use. */
export function addedTools(before: DynamicWorkflowDef, after: DynamicWorkflowDef): string[] {
  const had = new Set(before.steps.flatMap((s) => (s.kind === "action" ? s.tools : [])));
  return Array.from(
    new Set(after.steps.flatMap((s) => (s.kind === "action" ? s.tools : [])))
  ).filter((tool) => !had.has(tool));
}
