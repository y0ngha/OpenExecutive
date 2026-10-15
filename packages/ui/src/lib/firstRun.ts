// The first run, as pure rules: when Home sends the owner to setup, what the
// browser remembers between page loads, and what the getting-started
// checklist shows. The components in components/onboard/ read these; the
// tests in scripts/firstRun.test.mjs pin them.

import type { SetupCheck } from "@/lib/setupStatus";
import { t } from "../i18n/index.ts";

// Browser-side memory of a setup in progress. The interview itself is kept
// on the server (GET /onboard/interview/{id}); the browser only keeps which
// one is theirs, the description typed before Continue, and that they chose
// to do setup later.
export const STORAGE_KEYS = {
  session: "oe.onboard.session",
  description: "oe.onboard.description",
  later: "oe.onboard.later",
  checklistHidden: "oe.gettingStarted.hidden",
  // The question the last setup screen hands to Home, which asks it once.
  firstQuestion: "oe.onboard.firstQuestion",
} as const;

type Where = "local" | "session";

// The description is the one thing here that is the person's own words
// (it becomes the first interview turn, financials and all), so it lives in
// sessionStorage: gone with the tab, never synced.
const WHERE: Record<string, Where> = {
  [STORAGE_KEYS.description]: "session",
  // Built from their own priorities, and asked on the next page load only.
  [STORAGE_KEYS.firstQuestion]: "session",
};

function storage(key: string): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return WHERE[key] === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function remember(key: string, value: string | null): void {
  const s = storage(key);
  if (!s) return;
  try {
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    // Private mode or a full store: setup still works, it just won't resume.
  }
}

export function recall(key: string): string | null {
  const s = storage(key);
  if (!s) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

/** Forget everything about the setup in progress (after it is saved). */
export function clearSetupMemory(): void {
  remember(STORAGE_KEYS.session, null);
  remember(STORAGE_KEYS.description, null);
  remember(STORAGE_KEYS.later, null);
}

/** What reading your own mailbox does, in the one wording every screen uses:
 * Handle it for me can send, so "never sends" would be untrue. */
export function ownMailboxSends(): string {
  return t("chat.firstRun.ownMailboxSends");
}

const FIRST_QUESTION_MAX = 160;

/**
 * The first question the last setup screen offers, built from what setup
 * just saved: the first of this year's priorities, else the north star,
 * else a general opener. The person can edit it before it is asked.
 */
export function firstQuestion(
  priorities: { current_year?: readonly string[] | null; north_star_metric?: string | null } | null | undefined,
  solo: boolean,
): string {
  const tidy = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  const first = (priorities?.current_year ?? []).map(tidy).find(Boolean);
  const star = tidy(priorities?.north_star_metric);
  const pick = (first || star).slice(0, FIRST_QUESTION_MAX).trim();
  if (pick) return t("chat.firstRun.questionOn", { pick });
  return solo ? t("chat.firstRun.questionSolo") : t("chat.firstRun.questionTeam");
}

export interface RedirectInput {
  /** `company_profile_loaded` from /health; undefined while unknown. */
  profileLoaded: boolean | undefined;
  /** The viewer is the owner (the person setup is for); undefined while unknown. */
  isPrincipal: boolean | undefined;
  /** They chose "I'll do this later" on the setup screen. */
  later: boolean;
}

/**
 * Whether a page should send the viewer to /onboard. Only once both answers
 * are in, only for the owner (a teammate can't finish setup for them), and
 * not after they asked to do it later: the checklist on Home keeps the way
 * back.
 */
export function shouldRedirectToOnboard(input: RedirectInput): boolean {
  if (input.profileLoaded === undefined || input.isPrincipal === undefined) return false;
  return !input.profileLoaded && input.isPrincipal && !input.later;
}

// Where each checklist item sends people. One place, so a deployment with
// its own connection screens points these elsewhere.
export const FIRST_RUN_LINKS = {
  setup: "/onboard",
  execMailbox: "/settings/status",
  ownMailbox: "/settings/act-as-me",
  people: "/people",
} as const;

export type ChecklistItemId = "profile" | "ask" | "exec_mailbox" | "own_mailbox" | "team";

export interface ChecklistItem {
  id: ChecklistItemId;
  title: string;
  detail: string;
  done: boolean;
  optional: boolean;
  href: string;
  action: string;
}

export interface ChecklistInput {
  profileLoaded: boolean;
  companyName: string | null | undefined;
  /** Any conversation exists. */
  hasAsked: boolean;
  /** /setup/status checks, or null while loading or when it failed. */
  checks: readonly SetupCheck[] | null;
  /** Team mode: the roster has more than the owner. */
  team: boolean;
  teamSize: number;
}

function checkState(checks: readonly SetupCheck[] | null, id: string): SetupCheck["state"] | null {
  const c = checks?.find((x) => x.id === id);
  return c ? c.state : null;
}

/** The checklist rows, in the order they are shown. */
export function gettingStartedItems(input: ChecklistInput): ChecklistItem[] {
  const execMail = checkState(input.checks, "gmail");
  const ownMail = checkState(input.checks, "your_gmail");
  const items: ChecklistItem[] = [
    {
      id: "profile",
      title: t("chat.firstRun.profile.title"),
      detail: input.profileLoaded
        ? t("chat.firstRun.profile.done", { name: input.companyName?.trim() || t("chat.firstRun.profile.saved") })
        : t("chat.firstRun.profile.detail"),
      done: input.profileLoaded,
      optional: false,
      href: FIRST_RUN_LINKS.setup,
      action: t("chat.firstRun.profile.action"),
    },
    {
      id: "ask",
      title: t("chat.firstRun.ask.title"),
      detail: input.hasAsked
        ? t("chat.firstRun.ask.done")
        : t("chat.firstRun.ask.detail", { question: t("chat.firstRun.questionSolo") }),
      done: input.hasAsked,
      optional: false,
      href: "/?new=1",
      action: t("chat.firstRun.ask.action"),
    },
    {
      id: "exec_mailbox",
      title: t("chat.firstRun.execMailbox.title"),
      detail: t("chat.firstRun.execMailbox.detail"),
      done: execMail === "ok",
      optional: false,
      href: FIRST_RUN_LINKS.execMailbox,
      action: t("chat.firstRun.connect"),
    },
    {
      id: "own_mailbox",
      title: t("chat.firstRun.ownMailbox.title"),
      detail: t("chat.firstRun.ownMailbox.detail", { sends: ownMailboxSends() }),
      done: ownMail === "ok",
      optional: true,
      href: FIRST_RUN_LINKS.ownMailbox,
      action: t("chat.firstRun.connect"),
    },
  ];
  if (input.team) {
    items.push({
      id: "team",
      title: t("chat.firstRun.team.title"),
      detail:
        input.teamSize > 1
          ? t("chat.firstRun.team.done", { n: input.teamSize })
          : t("chat.firstRun.team.detail"),
      done: input.teamSize > 1,
      optional: false,
      href: FIRST_RUN_LINKS.people,
      action: t("chat.firstRun.team.action"),
    });
  }
  return items;
}

/** "2 of 5" for the heading; optional rows count once done. */
export function checklistProgress(items: readonly ChecklistItem[]): { done: number; total: number } {
  const required = items.filter((i) => !i.optional);
  return { done: required.filter((i) => i.done).length, total: required.length };
}

/** The checklist leaves Home once every required row is done. */
export function checklistComplete(items: readonly ChecklistItem[]): boolean {
  return items.every((i) => i.optional || i.done);
}

/**
 * Whether Home shows the checklist: only once every answer it depends on is
 * in. Drawn while they load, the rows read as not done and the card flashes
 * up for someone whose setup is finished, then vanishes.
 */
export function checklistVisible(input: {
  hidden: boolean;
  /** /health, /setup/status, the sessions and the roster have all answered. */
  loaded: boolean;
  items: readonly ChecklistItem[];
}): boolean {
  return !input.hidden && input.loaded && !checklistComplete(input.items);
}
