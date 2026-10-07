"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DYNAMIC_SPECIALISTS,
  DynamicStep,
  DynamicWorkflowDef,
  Person,
  CustomWorkflowError,
  WorkflowDesignerDraft,
  activateCustomWorkflow,
  createCustomWorkflow,
  saveWorkflowDesignerEdit,
} from "@/lib/api";
import {
  addedTools,
  describeCadence,
  describeChanges,
  replyShapeLabel,
} from "@/lib/workflowChanges";
import { sectionLabel } from "./sectionLabel";
import ToolChips, { mayWrite, toolLabel, useToolInfo } from "./ToolChips";
import { t, tp, type MessageKey } from "@/i18n/index.ts";

// Keyed by DYNAMIC_SPECIALISTS so adding a specialist there without a label
// here fails the build instead of falling back to the raw key.
const SPECIALIST_LABELS: Record<(typeof DYNAMIC_SPECIALISTS)[number], MessageKey> = {
  cso: "jobs.specialist.cso",
  cfo: "jobs.specialist.cfo",
  chro: "jobs.specialist.chro",
  gc: "jobs.specialist.gc",
  coo: "jobs.specialist.coo",
  cmo: "jobs.specialist.cmo",
  cpo: "jobs.specialist.cpo",
  sales: "jobs.specialist.sales",
  board_comms: "jobs.specialist.boardComms",
};

function specialistLabel(key: string | undefined): string {
  if (!key) return t("jobs.specialist.cso");
  const label = (SPECIALIST_LABELS as Record<string, MessageKey>)[key];
  return label ? t(label) : key;
}

function personName(people: Person[], id: number | null | undefined): string {
  if (id == null) return t("jobs.review.someone");
  return people.find((p) => p.id === id)?.full_name ?? t("jobs.review.personId", { id });
}

function stepLine(step: DynamicStep, people: Person[]): { who: string; what: string } {
  if (step.kind === "specialist")
    return { who: specialistLabel(step.specialist), what: step.goal };
  if (step.kind === "approval_gate") {
    // A question rather than a yes/no: the run continues whatever the answer.
    const shape = replyShapeLabel(step.expected_reply_shape);
    return {
      who: shape
        ? t("jobs.review.stepSignOffAsks", { name: personName(people, step.person_id), shape })
        : t("jobs.review.stepSignOff", { name: personName(people, step.person_id) }),
      what: step.question,
    };
  }
  if (step.kind === "action")
    return {
      who: tp("jobs.review.stepAction", step.tools.length),
      what: step.goal,
    };
  return {
    who: t("jobs.review.stepAssemble", { name: specialistLabel(step.specialist) }),
    what: step.instructions || t("jobs.review.assembleDefault"),
  };
}

/**
 * The human check on a workflow before it can act. Modes:
 * - wizard draft (sessionId + onRefine): "Create workflow" saves it;
 * - `edit`: a revision of a saved workflow — lists what changes and
 *   "Save changes" updates it;
 * - `pending`: a workflow chat saved switched off — "Turn on workflow"
 *   activates it, and that click is the approval of its tools;
 * - `readOnly`: the saved workflow as it is, with no actions.
 */
export default function WorkflowDraftReview({
  draft,
  people,
  busy = false,
  sessionId,
  onRefine,
  pending,
  edit,
  readOnly = false,
}: {
  draft: WorkflowDesignerDraft;
  people: Person[];
  busy?: boolean;
  sessionId?: string;
  onRefine?: () => void;
  pending?: { onActivated: () => void };
  edit?: { original: DynamicWorkflowDef };
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // HTTP status of the last error. On a pending card, 409 = the stored
  // workflow changed since this card loaded (its message already says to
  // reload) and 404 = it was deleted; anything else is fixed in the editor.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const def = draft.definition;
  const stepTools = def.steps.flatMap((s) => (s.kind === "action" ? s.tools : []));
  const toolInfo = useToolInfo(stepTools);
  // Editing: only the tools this revision adds need a fresh look.
  const reviewTools = edit ? addedTools(edit.original, def) : Array.from(new Set(stepTools));
  const writeTools = reviewTools.filter((name) => mayWrite(name, toolInfo));
  const changes = edit
    ? describeChanges(edit.original, def, {
        person: (id) => personName(people, id),
        specialist: specialistLabel,
        tool: (name) => toolLabel(name).label,
      })
    : [];

  async function confirm() {
    setError(null);
    setSaving(true);
    try {
      if (pending) {
        await activateCustomWorkflow(def);
        pending.onActivated();
      } else if (edit && sessionId) {
        const saved = await saveWorkflowDesignerEdit(sessionId, def);
        router.push(`/jobs/${encodeURIComponent(saved.name)}`);
      } else {
        const saved = await createCustomWorkflow(def);
        router.push(`/jobs/${encodeURIComponent(saved.name)}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setErrorStatus(e instanceof CustomWorkflowError ? e.status : null);
      setSaving(false);
    }
  }

  const editHref = readOnly
    ? null
    : pending
    ? `/jobs/new?edit=${encodeURIComponent(def.name)}&mode=advanced`
    : edit && sessionId
      ? `/jobs/new?edit=${encodeURIComponent(def.name)}&designer=${encodeURIComponent(sessionId)}`
      : sessionId
      ? `/jobs/new?designer=${encodeURIComponent(sessionId)}`
      : null;

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-surface-elevated/60 p-4 space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-indigo-300 mb-1">
          {pending
            ? t("jobs.review.waitingOff")
            : readOnly
              ? t("jobs.review.howItWorks")
              : edit
                ? t("jobs.review.proposedChanges")
                : t("jobs.review.draft")}
        </p>
        <h3 className="text-base font-semibold text-fg">{def.title}</h3>
        {def.owner_person_id != null && (
          <p className="text-xs text-fg-subtle mt-0.5">
            {t("jobs.review.createdBy", { name: personName(people, def.owner_person_id) })}
          </p>
        )}
        {def.description && (
          <p className="text-sm text-fg-muted mt-0.5">{def.description}</p>
        )}
        {draft.summary && (
          <p className="text-sm text-fg mt-2 whitespace-pre-wrap">{draft.summary}</p>
        )}
      </div>

      {edit && (
        <div className="rounded-md border border-indigo-500/30 bg-indigo-500/5 px-3 py-2">
          <p className="text-xs text-indigo-300 mb-1">{t("jobs.review.whatChanges")}</p>
          {changes.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("jobs.review.noChanges")}</p>
          ) : (
            <ul className="list-disc pl-4 space-y-0.5 text-sm text-fg">
              {changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <dt className="text-fg-subtle">{t("jobs.review.schedule")}</dt>
          <dd className="text-fg mt-0.5">
            {describeCadence(def.cadence)}
            {def.cadence && (
              <span className="text-fg-muted">
                {" "}
                {t("jobs.review.toPerson", { name: personName(people, def.cadence_person_id) })}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-fg-subtle">{t("jobs.review.fillEachRun")}</dt>
          <dd className="text-fg mt-0.5">
            {def.input_fields.length === 0
              ? t("jobs.review.nothing")
              : def.input_fields
                  .map((f) => (f.required === false ? t("jobs.review.optionalField", { label: f.label }) : f.label))
                  .join(", ")}
          </dd>
        </div>
        <div>
          <dt className="text-fg-subtle">{t("jobs.review.sectionTime")}</dt>
          <dd className="text-fg mt-0.5">
            {t("jobs.review.sectionMinutes", { section: sectionLabel(def.section), min: def.estimated_minutes })}
          </dd>
        </div>
      </dl>

      <ol className="space-y-2">
        {def.steps.map((step, i) => {
          const { who, what } = stepLine(step, people);
          return (
            <li key={step.id} className="flex gap-3 text-sm">
              <span className="shrink-0 w-5 h-5 rounded-full bg-surface-overlay text-[11px] text-fg-muted flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-fg">
                  {step.title}{" "}
                  <span className="text-xs text-fg-muted">· {who}</span>
                </p>
                {/* Unclamped: this card is the human check on every goal before it is saved. */}
                <p className="text-xs text-fg-muted whitespace-pre-wrap break-words">{what}</p>
                {step.kind === "action" && (
                  <div className="mt-1.5">
                    <ToolChips names={step.tools} info={toolInfo} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {!readOnly && draft.assumptions.length > 0 && (
        <div className="rounded-md bg-amber-500/5 border border-amber-500/20 px-3 py-2">
          <p className="text-xs text-amber-300 mb-1">{t("jobs.review.assumptions")}</p>
          <ul className="list-disc pl-4 space-y-0.5 text-xs text-fg-muted">
            {draft.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {!readOnly && writeTools.length > 0 && (
        <div className="rounded-md border border-indigo-500/30 bg-indigo-500/5 px-3 py-2 text-xs">
          <p className="text-fg">
            {pending
              ? t("jobs.review.writeToolsOn")
              : edit
                ? t("jobs.review.writeToolsEdit")
                : t("jobs.review.writeToolsCreate")}
          </p>
          <p className="mt-1 text-fg-muted">
            {writeTools.map((name) => toolLabel(name).label).join(" · ")}
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {!pending
            ? edit && errorStatus === 409
              ? error
              : t("jobs.review.errorDraft", { error })
            : errorStatus === 409
              ? error
              : errorStatus === 404
                ? t("jobs.review.errorDeleted", { error })
                : t("jobs.review.errorPending", { error })}
        </p>
      )}

      {!readOnly && (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={saving || busy || (!!edit && changes.length === 0)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition"
        >
          {pending
            ? saving
              ? t("jobs.review.turningOn")
              : t("jobs.review.turnOn")
            : edit
              ? saving
                ? t("common.saving")
                : t("jobs.review.saveChanges")
              : saving
                ? t("jobs.review.creating")
                : t("jobs.review.create")}
        </button>
        {onRefine && (
          <button
            type="button"
            onClick={onRefine}
            disabled={saving || busy}
            className="text-sm text-fg-muted hover:text-fg disabled:opacity-50 transition"
          >
            {t("jobs.review.keepRefining")}
          </button>
        )}
        {editHref && (
          <button
            type="button"
            onClick={() => router.push(editHref)}
            disabled={saving || busy}
            className="text-sm text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition"
          >
            {t("jobs.review.editDetails")}
          </button>
        )}
      </div>
      )}
    </div>
  );
}
