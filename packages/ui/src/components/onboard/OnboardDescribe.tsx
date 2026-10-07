"use client";

import { useState } from "react";
import RoleFields from "@/components/workspace/RoleFields";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import {
  startOnboardInterview,
  understandOnboarding,
  updateWorkspace,
  type OnboardTurn,
  type OnboardUnderstanding,
  type WorkspaceMode,
} from "@/lib/api";
import {
  EMPTY_ROLE_FORM,
  roleFormErrors,
  roleUpdate,
  type RoleForm,
} from "@/lib/principalRole";
import { t, type MessageKey } from "@/i18n/index.ts";

// First run: describe your work, then confirm what was understood.
//
// Step 1 is one box (and optional files). Step 2 shows what the text already
// said — personal or team, role, company, focus — each editable, and asks only
// for what it could not tell (personal vs team is the one required answer).
// Continue saves the workspace mode and role, then opens the interview with
// the same text, which asks about whatever is still missing. Nothing is asked
// twice: the role the form shows is what the interview is told.

const MAX_FILES = 8;

const MODES: { mode: WorkspaceMode; title: MessageKey; lead: MessageKey }[] = [
  { mode: "solo", title: "chat.describe.modeSolo", lead: "chat.describe.modeSoloLead" },
  { mode: "team", title: "chat.describe.modeTeam", lead: "chat.describe.modeTeamLead" },
];

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export interface DescribeResult {
  mode: WorkspaceMode;
  turn: OnboardTurn;
  turns: { role: "user" | "assistant"; text: string }[];
}

function Steps({ at }: { at: 1 | 2 }) {
  return (
    <div className="flex gap-1.5 mb-6" aria-hidden>
      {[1, 2, 3].map((i) => (
        <i key={i} className={`h-1 flex-1 rounded-full ${i <= at ? "bg-indigo-500" : "bg-line"}`} />
      ))}
    </div>
  );
}

export default function OnboardDescribe({ onReady }: { onReady: (r: DescribeResult) => void }) {
  const { role, refresh } = useWorkspace();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<"describe" | "confirm">("describe");
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [understood, setUnderstood] = useState<OnboardUnderstanding | null>(null);
  const [mode, setMode] = useState<WorkspaceMode | null>(null);
  const [form, setForm] = useState<RoleForm>(EMPTY_ROLE_FORM);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasInput = text.trim().length > 0 || files.length > 0;

  function toConfirm(u: OnboardUnderstanding | null) {
    setUnderstood(u);
    setMode(u?.mode ?? null);
    setForm({
      ...EMPTY_ROLE_FORM,
      role_kind: u?.role_kind ?? null,
      role_title: u?.role_title ?? "",
      reports_to: u?.reports_to ?? "",
    });
    setStep("confirm");
  }

  async function read() {
    if (!hasInput || reading) return;
    setReading(true);
    setNote(null);
    try {
      toConfirm(await understandOnboarding(text.trim(), files));
    } catch {
      // Not fatal: the text is kept and the person just picks below.
      setNote(t("chat.describe.readFailed"));
      toConfirm(null);
    } finally {
      setReading(false);
    }
  }

  const problems = roleFormErrors(form);

  async function carryOn() {
    if (!mode || saving || problems.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      const timezone = browserTimeZone();
      try {
        await updateWorkspace(timezone ? { mode, timezone } : { mode });
      } catch (err) {
        // A zone the server does not know must not block setup.
        if (!timezone || (err instanceof Error && /principal/i.test(err.message))) throw err;
        await updateWorkspace({ mode });
      }
      if (mode === "solo") {
        const update = roleUpdate(form, role);
        if (Object.keys(update).length > 0) await updateWorkspace(update);
      }
      await refresh();
      const description = text.trim();
      const turn = await startOnboardInterview(description, files);
      const turns: DescribeResult["turns"] = [];
      if (description) turns.push({ role: "user", text: description });
      if (turn.phase === "question" && turn.question) {
        turns.push({ role: "assistant", text: turn.question });
      }
      onReady({ mode, turn, turns });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("chat.describe.saveFailed"));
      setSaving(false);
    }
  }

  if (step === "describe") {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-16 w-full">
        <Steps at={1} />
        <h1 className="text-xl font-semibold text-fg">{t("chat.onboard.title")}</h1>
        <p className="text-sm text-fg-muted mt-1">{t("chat.describe.lead")}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          autoFocus
          disabled={reading}
          placeholder={t("chat.conversation.example.solo")}
          aria-label={t("chat.describe.textLabel")}
          className="mt-6 w-full rounded-lg border border-line-strong bg-surface-overlay px-3 py-2 text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 resize-none transition-colors disabled:opacity-50"
        />
        <div className="mt-2 flex items-center gap-3">
          <label className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer transition-colors">
            {t("chat.describe.attach")}
            <input
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.docx,.doc,.xlsx,.xlsm,.csv,.md,.txt"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES))}
            />
          </label>
          {files.length > 0 && (
            <p className="text-xs text-fg-muted truncate">{files.map((f) => f.name).join(", ")}</p>
          )}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => void read()}
            disabled={!hasInput || reading}
            className="px-5 py-2.5 rounded-lg text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {reading ? t("chat.describe.reading") : t("chat.describe.continue")}
          </button>
          <button
            type="button"
            onClick={() => toConfirm(null)}
            disabled={reading}
            className="text-sm text-fg-muted hover:text-fg transition-colors cursor-pointer disabled:opacity-50"
          >
            {t("chat.describe.skip")}
          </button>
        </div>
      </div>
    );
  }

  const facts: [string, string | null][] = [
    [t("chat.describe.factCompany"), understood?.company ?? null],
    [t("chat.describe.factFocus"), understood?.focus ?? null],
  ];
  const shown = facts.filter(([, v]) => v);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-16 w-full">
      <Steps at={2} />
      <h1 className="text-xl font-semibold text-fg">
        {t(understood ? "chat.describe.gotTitle" : "chat.describe.whoTitle")}
      </h1>
      <p className="text-sm text-fg-muted mt-1">
        {t(understood ? "chat.describe.gotLead" : "chat.describe.whoLead")}
      </p>
      {note && <p className="text-xs text-amber-400 mt-2">{note}</p>}

      <div role="radiogroup" aria-label={t("chat.describe.modeLabel")} className="mt-6 grid gap-3 sm:grid-cols-2">
        {MODES.map((m) => {
          const on = mode === m.mode;
          return (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={saving}
              onClick={() => setMode(m.mode)}
              className={`text-left rounded-xl border p-4 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-60 ${
                on
                  ? "border-indigo-500/70 bg-indigo-500/10"
                  : "border-line bg-surface-elevated hover:border-line-strong"
              }`}
            >
              <span className="block text-sm font-semibold text-fg">{t(m.title)}</span>
              <span className="block text-xs text-fg-muted mt-1 leading-snug">{t(m.lead)}</span>
            </button>
          );
        })}
      </div>

      {shown.length > 0 && (
        <dl className="mt-4 rounded-xl border border-line bg-surface-elevated px-4 py-1">
          {shown.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5 text-sm border-b border-line last:border-0">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="text-fg text-right">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {mode === "solo" && (
        <div className="mt-4 rounded-xl border border-line bg-surface-elevated p-4">
          {!editing && (form.role_kind || form.role_title || form.reports_to) ? (
            <div className="flex items-start justify-between gap-4 text-sm">
              <div className="text-fg">
                {[form.role_title, form.reports_to && t("chat.describe.reportsTo", { name: form.reports_to })]
                  .filter(Boolean)
                  .join(" · ") || t("chat.describe.roleSet")}
              </div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
              >
                {t("common.edit")}
              </button>
            </div>
          ) : (
            <RoleFields value={form} onChange={setForm} disabled={saving} idPrefix="describe-role" />
          )}
        </div>
      )}

      {(problems.length > 0 || error) && (
        <div className="mt-3 space-y-1 text-xs text-red-400">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {error && <p>{error}</p>}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => void carryOn()}
          disabled={!mode || saving || problems.length > 0}
          className="px-5 py-2.5 rounded-lg text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? t("common.saving") : t("chat.describe.continue")}
        </button>
        <button
          type="button"
          onClick={() => setStep("describe")}
          disabled={saving}
          className="text-sm text-fg-muted hover:text-fg transition-colors cursor-pointer disabled:opacity-50"
        >
          {t("common.back")}
        </button>
      </div>
    </div>
  );
}
