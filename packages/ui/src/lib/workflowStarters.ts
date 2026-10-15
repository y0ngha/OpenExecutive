import { t, type MessageKey } from "../i18n/index.ts";
import type { WorkspaceMode } from "./api";

// Each item is read through t() when it is used, so it follows the
// deployment's language.
function lazyList(keys: readonly MessageKey[]): string[] {
  const list: string[] = [];
  keys.forEach((key, i) => Object.defineProperty(list, i, { get: () => t(key), enumerable: true }));
  return list;
}

function chip(label: MessageKey, starters: readonly string[], starter: number): { label: string; text: string } {
  return {
    get label() {
      return t(label);
    },
    get text() {
      return starters[starter];
    },
  };
}

const COMPETITOR_DIGEST: MessageKey = "lib.starter.competitorDigest";

/**
 * Example one-liners for describing a new workflow in a team workspace.
 * Shared by the "Start here" panel on /jobs and the conversational wizard at
 * /jobs/new (through `workflowStartersFor`).
 */
export const WORKFLOW_STARTERS: string[] = lazyList([
  COMPETITOR_DIGEST,
  "lib.starter.boardPreRead",
  "lib.starter.hiringPlan",
  "lib.starter.launchReadiness",
]);

/**
 * The same for someone running the business on their own ("Just you"): no
 * board, no CFO to sign off, no hiring plan, just the numbers they watch.
 */
export const SOLO_WORKFLOW_STARTERS: string[] = lazyList([
  "lib.starter.soloCashCheck",
  "lib.starter.soloLostCustomers",
  COMPETITOR_DIGEST,
]);

/**
 * Short chips for the front of /jobs in a team workspace: a label to tap and
 * the starter it puts in the box. The wizard shows the full sentences.
 */
export const WORKFLOW_STARTER_CHIPS: { label: string; text: string }[] = [
  chip("lib.starter.chip.competitorDigest", WORKFLOW_STARTERS, 0),
  chip("lib.starter.chip.boardPreRead", WORKFLOW_STARTERS, 1),
  chip("lib.starter.chip.hiringPlan", WORKFLOW_STARTERS, 2),
];

export const SOLO_WORKFLOW_STARTER_CHIPS: { label: string; text: string }[] = [
  chip("lib.starter.chip.soloCashCheck", SOLO_WORKFLOW_STARTERS, 0),
  chip("lib.starter.chip.soloLostCustomers", SOLO_WORKFLOW_STARTERS, 1),
  chip("lib.starter.chip.competitorDigest", SOLO_WORKFLOW_STARTERS, 2),
];

/** The starter sentences for this workspace's mode. */
export function workflowStartersFor(mode: WorkspaceMode): string[] {
  return mode === "solo" ? SOLO_WORKFLOW_STARTERS : WORKFLOW_STARTERS;
}

/** The /jobs chips for this workspace's mode. */
export function workflowStarterChipsFor(mode: WorkspaceMode): { label: string; text: string }[] {
  return mode === "solo" ? SOLO_WORKFLOW_STARTER_CHIPS : WORKFLOW_STARTER_CHIPS;
}

export type StarterPick = { name: string; useFor: string };

function pick(name: string, useFor: MessageKey): StarterPick {
  return {
    name,
    get useFor() {
      return t(useFor);
    },
  };
}

/**
 * Ready-made workflows shown first in the ready-made panel on /jobs, each
 * with a plain line on when to use it. Names are WORKFLOW_REGISTRY keys; one
 * the catalog does not list is skipped.
 */
export const TEAM_STARTER_PICKS: StarterPick[] = [
  pick("investor_update", "lib.starter.pick.investorUpdate"),
  pick("board_prep", "lib.starter.pick.boardPrep"),
  pick("mbr", "lib.starter.pick.mbr"),
  pick("competitive_teardown", "lib.starter.pick.competitiveTeardown"),
];

/** For an owner-operator: no board or investors to report to. */
export const SOLO_STARTER_PICKS: StarterPick[] = [
  pick("mbr", "lib.starter.pick.soloMbr"),
  pick("pricing_review", "lib.starter.pick.pricingReview"),
  pick("churn_deep_dive", "lib.starter.pick.churnDeepDive"),
  pick("quarterly_plan", "lib.starter.pick.quarterlyPlan"),
];

/** The first picks for this workspace's mode. */
export function starterPicksFor(mode: WorkspaceMode): StarterPick[] {
  return mode === "solo" ? SOLO_STARTER_PICKS : TEAM_STARTER_PICKS;
}

const HANDOFF_KEY = "oe.workflowWizard.describe";
// A hand-off older than this is from a Start the user walked away from, and
// must not fire on a later visit to the wizard.
const HANDOFF_TTL_MS = 5 * 60 * 1000;

/**
 * Hand a description typed on /jobs to the wizard, which sends it as the
 * first message. Session storage rather than the URL, so a link cannot make
 * the wizard send text the user never typed. Returns false when storage is
 * unavailable; the caller then falls back to `?describe=`, which only
 * prefills the composer.
 */
export function stashWorkflowDescription(text: string): boolean {
  try {
    // Cleared first, so a failed write can't leave an older hand-off behind.
    window.sessionStorage.removeItem(HANDOFF_KEY);
    window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ text, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/** Read and clear the handed-off description, so a refresh doesn't resend it. */
export function takeWorkflowDescription(): string | null {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_KEY);
    window.sessionStorage.removeItem(HANDOFF_KEY);
    if (!raw) return null;
    const { text, at } = JSON.parse(raw) as { text?: unknown; at?: unknown };
    const age = Date.now() - Number(at);
    return typeof text === "string" && age >= 0 && age < HANDOFF_TTL_MS ? text : null;
  } catch {
    return null;
  }
}
