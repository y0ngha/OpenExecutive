"use client";

import { useState } from "react";

import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { updateWorkspace } from "@/lib/api";
import { t } from "@/i18n/index.ts";

// Shown after a team member is added (or a contact moved onto the team) while
// Open Executive is used just for yourself: a team now exists, so offer to
// switch the workspace to team mode — or keep it as it is.
export function TeamModeOffer({ name, onDone }: { name: string; onDone: () => void }) {
  const { refresh } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function switchToTeam() {
    setBusy(true);
    setErr(null);
    try {
      await updateWorkspace({ mode: "team" });
      await refresh();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("people.teamMode.failed"));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        role="alertdialog"
        aria-labelledby="team-mode-offer-title"
        className="w-full max-w-md bg-surface border border-line rounded-2xl shadow-2xl p-6 mx-4"
      >
        <h2 id="team-mode-offer-title" className="text-base font-semibold text-fg mb-2">
          {t("people.teamMode.title")}
        </h2>
        <p className="text-sm text-fg-muted mb-4">
          {t("people.teamMode.body", { name })}
        </p>
        {err && <p className="text-xs text-rose-300 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={switchToTeam}
            className="flex-1 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 font-medium"
          >
            {busy ? t("people.teamMode.switching") : t("people.teamMode.switch")}
          </button>
          <button
            disabled={busy}
            onClick={onDone}
            className="px-4 py-2 text-sm rounded-lg border border-line hover:bg-surface-overlay disabled:opacity-50"
          >
            {t("people.teamMode.keep")}
          </button>
        </div>
      </div>
    </div>
  );
}
