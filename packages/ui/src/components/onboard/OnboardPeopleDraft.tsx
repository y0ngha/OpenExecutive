"use client";

import { type OnboardPersonDraft } from "@/lib/api";
import { t } from "@/i18n/index.ts";

interface Props {
  people: OnboardPersonDraft[];
  onChange: (people: OnboardPersonDraft[]) => void;
}

/** The leadership roster. Deliberately has no contact columns: OE never
 * auto-imports emails or chat handles — those are added on the People page.
 * The one exception, the owner's own sign-in email, is its own field on the
 * review screen (OnboardDraftReview), confirmed by the person signing in. */
export default function OnboardPeopleDraft({ people, onChange }: Props) {
  function update(i: number, patch: Partial<OnboardPersonDraft>) {
    onChange(people.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  function setPrincipal(i: number) {
    onChange(people.map((p, j) => ({ ...p, is_principal: j === i })));
  }

  return (
    <div className="bg-surface-elevated border border-line rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-semibold text-fg">{t("chat.peopleDraft.title")}</h2>
        <button
          onClick={() =>
            onChange([...people, { full_name: "", role: "", is_principal: false }])
          }
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {t("chat.peopleDraft.add")}
        </button>
      </div>
      <p className="text-xs text-fg-muted mb-4">{t("chat.peopleDraft.lead")}</p>

      {people.length === 0 && (
        <p className="text-sm text-fg-subtle italic">{t("chat.peopleDraft.empty")}</p>
      )}

      <div className="flex flex-col gap-2">
        {people.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={p.full_name}
              onChange={(e) => update(i, { full_name: e.target.value })}
              placeholder={t("chat.peopleDraft.fullName")}
              className="flex-1 rounded-lg border border-line-strong bg-surface-overlay px-3 py-2 text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-colors"
            />
            <input
              value={p.role}
              onChange={(e) => update(i, { role: e.target.value })}
              placeholder={t("chat.peopleDraft.role")}
              className="flex-1 rounded-lg border border-line-strong bg-surface-overlay px-3 py-2 text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-colors"
            />
            <label className="flex items-center gap-1.5 text-xs text-fg-muted whitespace-nowrap cursor-pointer">
              <input
                type="radio"
                name="principal"
                checked={p.is_principal}
                onChange={() => setPrincipal(i)}
                className="accent-indigo-500"
              />
              {t("chat.peopleDraft.isMe")}
            </label>
            <button
              onClick={() => onChange(people.filter((_, j) => j !== i))}
              aria-label={t("chat.removeNamed", { name: p.full_name || t("chat.peopleDraft.person") })}
              className="text-xs text-fg-subtle hover:text-red-400 px-1 transition-colors"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
