"use client";

import { useState } from "react";

import ModePicker from "@/components/settings/ModePicker";
import SettingsCard from "@/components/settings/SettingsCard";
import { displayLocale, t, type MessageKey } from "@/i18n/index.ts";
import {
  removeTrainingLearned,
  setTraining,
  type DelegationSettings,
  type Training,
  type TrainingLearned,
  type TrainingSetting,
} from "@/lib/api";

// Training on Delegate → Act as me (delegation/training.py), the way Take the
// lead has it: like someone new, each job can be In training, where it brings
// you its work first and learns who and how from what you approve. Replies,
// follow-ups and drafts are trained from How far it goes as you (ReachCard);
// this file holds the note at the top, the Suggested actions card
// (Always ask / In training, PUT /delegation/training) and, at the bottom, one
// "What it's learned" list, each item named by its job, with Remove
// (DELETE /delegation/learned/{id}).

// The job each learned item came from, as its card is titled.
const JOB_NAMES: Record<TrainingSetting, MessageKey> = {
  replies: "settings.training.job.replies",
  follow_ups: "settings.training.job.followUps",
  actions: "settings.training.job.actions",
  drafts: "settings.training.job.drafts",
};

function useSave(onSettings: (next: DelegationSettings) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<DelegationSettings>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      onSettings(await work());
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function TrainingNote() {
  return (
    <section className="rounded-2xl border border-accent/30 bg-accent/5 p-5 sm:p-6">
      <h2 className="text-base sm:text-lg font-semibold text-fg">{t("settings.training.noteTitle")}</h2>
      <p className="mt-1 text-sm text-fg leading-relaxed">{t("settings.training.noteText")}</p>
    </section>
  );
}

type ActionsMode = "ask" | "training";

export function SuggestedActionsCard({
  training,
  onSettings,
}: {
  training: Training;
  onSettings: (next: DelegationSettings) => void;
}) {
  const { busy, error, run } = useSave(onSettings);
  const mode: ActionsMode = training.actions ? "training" : "ask";
  return (
    <SettingsCard
      title={t("settings.training.job.actions")}
      titleId="act-as-me-actions-label"
      description={t("settings.training.actionsDescription")}
    >
      <ModePicker<ActionsMode>
        labelledBy="act-as-me-actions-label"
        value={mode}
        disabled={busy}
        options={[
          { value: "ask", label: t("settings.training.alwaysAsk") },
          { value: "training", label: t("settings.handleIt.inTraining") },
        ]}
        onPick={(next) => void run(() => setTraining({ actions: next === "training" }), t("settings.training.changeFailed"))}
      />
      <p className="mt-3 text-sm text-fg-muted leading-relaxed">
        {mode === "training"
          ? t("settings.training.actionsTraining")
          : t("settings.training.actionsAsk")}
      </p>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </SettingsCard>
  );
}

function times(n: number): string {
  return n === 1
    ? t("settings.training.times.once")
    : n === 2
      ? t("settings.training.times.twice")
      : t("settings.training.times.many", { n });
}

function learnedLine(item: TrainingLearned): string {
  const when = new Date(item.created_at).toLocaleDateString(displayLocale(), { month: "short", day: "numeric" });
  const job = JOB_NAMES[item.setting];
  const parts = [job ? t(job) : t("settings.actAsMe.title")];
  parts.push(
    item.setting === "drafts" ? t("settings.training.learnedOn", { when }) : t("settings.training.allowedOn", { when }),
  );
  if (item.uses > 0) parts.push(t("settings.training.doneSince", { times: times(item.uses) }));
  if (item.example) parts.push(t("settings.training.writesLike", { example: item.example }));
  return parts.join(" · ");
}

// Shown while any job is in training or something is on the list.
export function LearnedCard({
  training,
  onSettings,
}: {
  training: Training;
  onSettings: (next: DelegationSettings) => void;
}) {
  const { busy, error, run } = useSave(onSettings);
  const learned = training.learned;
  const anyOn = training.replies || training.follow_ups || training.actions || training.drafts;
  if (!anyOn && learned.length === 0) return null;
  return (
    <SettingsCard
      title={t("settings.training.learnedTitle")}
      titleId="act-as-me-learned-label"
      description={t("settings.training.learnedDescription")}
    >
      {learned.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("settings.training.nothingYet")}</p>
      ) : (
        <ul
          aria-labelledby="act-as-me-learned-label"
          className="flex flex-col divide-y divide-line rounded-xl border border-line"
        >
          {learned.map((item) => (
            <li key={item.id} className="flex min-h-touch items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="block text-[15px] font-medium break-words">{item.label}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-fg-muted line-clamp-2">
                  {learnedLine(item)}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => removeTrainingLearned(item.id), t("settings.training.removeFailed"))}
                className="flex-shrink-0 min-h-touch text-sm font-semibold text-accent hover:underline disabled:opacity-60"
                aria-label={t("settings.training.removeLabel", { label: item.label })}
              >
                {t("common.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </SettingsCard>
  );
}
