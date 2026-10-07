"use client";

import { type OnboardDepartmentDraft, type OnboardPersonDraft } from "@/lib/api";
import { t, type MessageKey } from "@/i18n/index.ts";

const AUTHORITY_LEVELS: { value: string; label: MessageKey }[] = [
  { value: "propose_only", label: "chat.deptDraft.authority.proposeOnly" },
  { value: "escalate", label: "chat.deptDraft.authority.escalate" },
  { value: "auto_execute", label: "chat.deptDraft.authority.autoExecute" },
];

interface Props {
  departments: OnboardDepartmentDraft[];
  people: OnboardPersonDraft[];
  /** Titles of departments that already exist, so each row can say whether it
   * updates one or creates a new one. Nothing is ever deleted. */
  existingTitles: string[];
  onChange: (departments: OnboardDepartmentDraft[]) => void;
}

export default function OnboardDepartmentsDraft({
  departments,
  people,
  existingTitles,
  onChange,
}: Props) {
  const existing = new Set(existingTitles.map((title) => title.trim().toLowerCase()));

  function update(i: number, patch: Partial<OnboardDepartmentDraft>) {
    onChange(departments.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  return (
    <div className="bg-surface-elevated border border-line rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-semibold text-fg">{t("chat.nav.departments")}</h2>
        <button
          onClick={() =>
            onChange([
              ...departments,
              {
                title: "",
                mission: "",
                head_person_name: "",
                authority_level: "propose_only",
              },
            ])
          }
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {t("chat.deptDraft.add")}
        </button>
      </div>
      <p className="text-xs text-fg-muted mb-4">{t("chat.deptDraft.lead")}</p>

      {departments.length === 0 && (
        <p className="text-sm text-fg-subtle italic">{t("chat.deptDraft.empty")}</p>
      )}

      <div className="flex flex-col gap-3">
        {departments.map((d, i) => {
          const isExisting = existing.has(d.title.trim().toLowerCase());
          return (
            <div key={i} className="flex flex-col gap-2 pb-3 border-b border-line last:border-0 last:pb-0">
              <div className="flex items-center gap-2">
                <input
                  value={d.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder={t("chat.deptDraft.title")}
                  className="flex-1 rounded-lg border border-line-strong bg-surface-overlay px-3 py-2 text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-colors"
                />
                <span
                  className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-md whitespace-nowrap ${
                    isExisting
                      ? "bg-surface-overlay text-fg-muted"
                      : "bg-indigo-500/10 text-indigo-400"
                  }`}
                >
                  {d.title.trim() ? t(isExisting ? "chat.deptDraft.existing" : "chat.deptDraft.new") : "—"}
                </span>
                <button
                  onClick={() => onChange(departments.filter((_, j) => j !== i))}
                  aria-label={t("chat.removeNamed", { name: d.title || t("chat.deptDraft.department") })}
                  className="text-xs text-fg-subtle hover:text-red-400 px-1 transition-colors"
                >
                  ✕
                </button>
              </div>
              <input
                value={d.mission}
                onChange={(e) => update(i, { mission: e.target.value })}
                placeholder={t("chat.deptDraft.mission")}
                className="w-full rounded-lg border border-line-strong bg-surface-overlay px-3 py-2 text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-colors"
              />
              <div className="flex items-center gap-2">
                <select
                  value={d.head_person_name}
                  onChange={(e) => update(i, { head_person_name: e.target.value })}
                  className="flex-1 rounded-lg border border-line-strong bg-surface-overlay px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-colors"
                >
                  <option value="">{t("chat.deptDraft.noHead")}</option>
                  {people
                    .filter((p) => p.full_name.trim())
                    .map((p) => (
                      <option key={p.full_name} value={p.full_name}>
                        {p.full_name}
                      </option>
                    ))}
                </select>
                <select
                  value={d.authority_level}
                  onChange={(e) => update(i, { authority_level: e.target.value })}
                  className="flex-1 rounded-lg border border-line-strong bg-surface-overlay px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-colors"
                >
                  {AUTHORITY_LEVELS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {t(a.label)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
