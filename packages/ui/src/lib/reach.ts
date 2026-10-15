import { t, tp } from "../i18n/index.ts";
import type { DelegationSettings, HandleItMode, ReachStep } from "@/lib/api";

// How far it goes as you: the one dial for everything Act as me does from
// your own mailbox (PUT /delegation/reach). It lives on Delegate → Act as me
// only; Handle it for me and What it may do show where it is and link here.

// Where the dial sits on Act as me, for links from the other tabs.
export const REACH_HREF = "/delegate/act-as-me#how-far";
export const REACH_ANCHOR = "how-far";

// The sending steps, which are Handle it for me.
export function handleItModes(): { mode: HandleItMode; label: string; replies: string; followUps: string }[] {
  return [
    {
      mode: "careful",
      label: t("settings.handleIt.careful.label"),
      replies: t("settings.handleIt.careful.replies"),
      followUps: t("settings.handleIt.careful.followUps"),
    },
    {
      mode: "balanced",
      label: t("settings.handleIt.balanced.label"),
      replies: t("settings.handleIt.balanced.replies"),
      followUps: t("settings.handleIt.balanced.followUps"),
    },
    {
      mode: "bold",
      label: t("settings.handleIt.bold.label"),
      replies: t("settings.handleIt.bold.replies"),
      followUps: t("settings.handleIt.bold.followUps"),
    },
  ];
}

export function leadLine(): string {
  return t("settings.reach.leadLine");
}

export function reachOf(settings: DelegationSettings): ReachStep {
  if (!settings.enabled) return "off";
  if (!settings.inbox?.enabled) return "when_asked";
  const h = settings.handle_it;
  if (!h?.enabled) return "inbox";
  if (h.lead) return "everything";
  return h.mode;
}

export function stepLabel(step: ReachStep): string {
  if (step === "off") return t("settings.reach.step.off");
  if (step === "when_asked") return t("settings.reach.step.whenAsked");
  if (step === "inbox") return t("settings.reach.step.inbox");
  if (step === "everything") return t("settings.handleIt.lead.label");
  return handleItModes().find((m) => m.mode === step)?.label ?? step;
}

// Where the dial is, for the Handle it for me tab: the step, whether that
// step sends, whether it's in training, and one line on what it means.
export function reachSummary(settings: DelegationSettings): {
  label: string;
  sends: boolean;
  training: boolean;
  line: string;
} {
  const step = reachOf(settings);
  const mode = handleItModes().find((m) => m.mode === step);
  const sends = Boolean(mode) || step === "everything";
  const training = sends && step !== "everything" && Boolean(settings.training?.replies || settings.training?.follow_ups);
  const line = mode
    ? mode.replies
    : step === "everything"
      ? leadLine()
      : t("settings.reach.handleItOff");
  return { label: stepLabel(step), sends, training, line };
}

export function sentTodayLine(n: number): string {
  return tp("settings.handleIt.sentToday", n);
}
