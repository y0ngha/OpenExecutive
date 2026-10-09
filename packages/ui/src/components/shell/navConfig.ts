// Type-only imports, so `npm test` can load this file under
// `node --experimental-strip-types` (see scripts/navConfig.test.mjs).
import type { IconName } from "@/components/Icon";
import type { RoleKind, WorkspaceMode } from "@/lib/api";
// Relative, with the extension: node loads this file without the `@/` alias.
// Labels are getters or built inside functions so t() runs when they are read.
import { t } from "../../i18n/index.ts";

// Single source of truth for the app's navigation. The one sidebar
// (`components/shell/AppSidebar.tsx`, rendered by both the chat home and
// the AppShell) and the mobile bottom bar build their menus from here.
// When adding a destination, add it ONCE in this file.

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /**
   * One-line plain-language explanation of the destination, surfaced as a
   * tooltip in the rail/sidebar and as card copy on the Settings hub.
   * Required so every new destination ships with an explanation.
   */
  description: string;
  /** Optional pending-count badge (e.g. items awaiting review). */
  badge?: number;
}

interface BuildOpts {
  /**
   * When false, the Company-profile entry points at the onboarding
   * wizard and is relabelled "Set up company". The chat home knows the
   * onboarding state from `/health`; the rail assumes onboarded (its
   * routes are only reachable post-setup).
   */
  isOnboarded?: boolean;
  /** Pending + needs-revision count shown on the Review entry. */
  reviewBadge?: number;
  /**
   * "solo" (one person using Hoiv Executive just for themselves) swaps the
   * Company group — Departments, People, Company profile — for "You":
   * Goals, People and the profile, named for `roleKind` (see
   * `profileWording`). Defaults to "team".
   */
  mode?: WorkspaceMode;
  /**
   * The principal's role kind from the workspace settings. Only solo reads
   * it; null when unset or hidden (GET /workspace returns no role to anyone
   * but the principal).
   */
  roleKind?: RoleKind | null;
}

// What the profile at /company-profile is called. A team's is its company.
// In solo it follows the principal's role: an owner's is their business;
// anyone else's is their work — the organisation they work in, who it
// serves and their priorities. An unset role, or one the caller can't see,
// reads as "work", so nobody is told they run a business they don't.
// The profile page, its breadcrumb and onboarding use the same rule.
export type ProfileWording = "company" | "business" | "work";

export function profileWording(
  mode: WorkspaceMode = "team",
  roleKind: RoleKind | null = null,
): ProfileWording {
  if (mode !== "solo") return "company";
  return roleKind === "owner" ? "business" : "work";
}

// The profile's nav entry: its label once set up, before setup (it then
// points at /onboard), and the tooltip / Settings-card description.
export const PROFILE_NAV: Record<
  ProfileWording,
  { label: string; setupLabel: string; description: string }
> = {
  company: {
    get label() { return t("chat.nav.profile.company"); },
    get setupLabel() { return t("chat.nav.profile.companySetup"); },
    get description() { return t("chat.nav.desc.profileCompany"); },
  },
  business: {
    get label() { return t("chat.nav.profile.business"); },
    get setupLabel() { return t("chat.nav.profile.businessSetup"); },
    get description() { return t("chat.nav.desc.profileBusiness"); },
  },
  work: {
    get label() { return t("chat.nav.profile.work"); },
    get setupLabel() { return t("chat.nav.profile.workSetup"); },
    get description() { return t("chat.nav.desc.profileWork"); },
  },
};

function profileItem(wording: ProfileWording, isOnboarded: boolean): NavItem {
  const copy = PROFILE_NAV[wording];
  return {
    href: isOnboarded ? "/company-profile" : "/onboard",
    label: isOnboarded ? copy.label : copy.setupLabel,
    icon: "building",
    description: copy.description,
  };
}

const GOALS_ITEM: NavItem = {
  href: "/goals",
  get label() { return t("chat.nav.goals"); },
  icon: "flag",
  get description() { return t("chat.nav.desc.goals"); },
};

// The Company hub's tabs in a team: who's on it, what you're aiming for,
// how it's organised, and the profile.
function companyTabs(isOnboarded: boolean): NavItem[] {
  return [
    { href: "/people", label: t("chat.nav.people"), icon: "users", description: t("chat.nav.desc.people") },
    {
      ...GOALS_ITEM,
      description: t("chat.nav.desc.goalsTeam"),
    },
    {
      href: "/departments",
      label: t("chat.nav.departments"),
      icon: "grid",
      description: t("chat.nav.desc.departments"),
    },
    profileItem("company", isOnboarded),
  ];
}

// Solo: the same destinations minus Departments (their goals live on /goals,
// grouped by area), with the copy speaking to one person. Goals come first:
// it's the page a team of one visits most.
function youTabs(isOnboarded: boolean, roleKind: RoleKind | null): NavItem[] {
  return [
    GOALS_ITEM,
    {
      href: "/people",
      label: t("chat.nav.people"),
      icon: "users",
      description: t("chat.nav.desc.peopleSolo"),
    },
    profileItem(profileWording("solo", roleKind), isOnboarded),
  ];
}

function workTabs(): NavItem[] {
  return [
    {
      href: "/jobs",
      label: t("chat.nav.workflows"),
      icon: "doc",
      description: t("chat.nav.desc.workflows"),
    },
    {
      href: "/artifacts",
      label: t("chat.nav.documents"),
      icon: "book",
      description: t("chat.nav.desc.documents"),
    },
    {
      href: "/watchlist",
      label: t("chat.nav.watchList"),
      icon: "eye",
      description: t("chat.nav.desc.watchList"),
    },
  ];
}

/**
 * A hub: one menu entry that holds several pages, shown as a row of tabs at
 * the top of each of them (components/ui/HubTabs.tsx). The menu entry opens
 * the first tab.
 */
export interface Hub {
  key: "work" | "company" | "you";
  label: string;
  icon: IconName;
  description: string;
  tabs: NavItem[];
}

export function buildHubs({
  isOnboarded = true,
  mode = "team",
  roleKind = null,
}: BuildOpts = {}): Hub[] {
  const work: Hub = {
    key: "work",
    label: t("chat.nav.work"),
    icon: "briefcase",
    description: t("chat.nav.desc.work"),
    tabs: workTabs(),
  };
  const people: Hub =
    mode === "solo"
      ? {
          key: "you",
          label: t("chat.nav.you"),
          icon: "users",
          description: t("chat.nav.desc.you"),
          tabs: youTabs(isOnboarded, roleKind),
        }
      : {
          key: "company",
          label: t("chat.nav.company"),
          icon: "building",
          description: t("chat.nav.desc.company"),
          tabs: companyTabs(isOnboarded),
        };
  return [work, people];
}

// The hub a page belongs to, or null for a page that isn't in one.
export function hubForPath(pathname: string, opts: BuildOpts = {}): Hub | null {
  return (
    buildHubs(opts).find((hub) => hub.tabs.some((tab) => isNavActive(tab.href, pathname))) ?? null
  );
}

export const PULSE_NAV_ITEM: NavItem = {
  href: "/memories",
  get label() { return t("chat.nav.pulse"); },
  icon: "activity",
  get description() { return t("chat.nav.desc.pulse"); },
};

/** A main-menu entry. A hub's entry is active on any of its tabs. */
export interface Destination extends NavItem {
  key: string;
  /** Pages that light this entry up, besides `href` itself. */
  alsoActiveOn?: string[];
}

// The main menu, the same in the sidebar on every page: six places, then
// Settings at the bottom. Everything else is a tab inside one of them or a
// tool under Settings.
export function buildDestinations({
  isOnboarded = true,
  reviewBadge = 0,
  mode = "team",
  roleKind = null,
}: BuildOpts = {}): Destination[] {
  const hubs = buildHubs({ isOnboarded, mode, roleKind });
  const hubEntry = (hub: Hub): Destination => ({
    key: hub.key,
    href: hub.tabs[0].href,
    label: hub.label,
    icon: hub.icon,
    description: hub.description,
    alsoActiveOn: hub.tabs.slice(1).map((tab) => tab.href),
  });
  return [
    { key: "home", href: "/", label: t("chat.nav.home"), icon: "home", description: t("chat.nav.desc.home") },
    {
      key: "chats",
      href: "/chats",
      label: t("chat.nav.chats"),
      icon: "chat",
      description: t("chat.nav.desc.chats"),
    },
    ...hubs.map(hubEntry),
    {
      key: "knowledge",
      href: "/knowledge",
      label: t("chat.nav.knowledge"),
      icon: "book",
      badge: reviewBadge,
      description: t("chat.nav.desc.knowledge"),
    },
    { key: "pulse", ...PULSE_NAV_ITEM },
  ];
}

export function isDestinationActive(dest: Destination, pathname: string): boolean {
  return [dest.href, ...(dest.alsoActiveOn ?? [])].some((href) => isNavActive(href, pathname));
}

// Single rail/sidebar entry that leads to the Settings hub.
export const SETTINGS_NAV_ITEM: NavItem = {
  href: "/settings",
  get label() { return t("chat.nav.settings"); },
  icon: "cog",
  get description() { return t("chat.nav.desc.settings"); },
};

// User Guide — in the account menu at the foot of the sidebar so help is
// always one click away (it also stays listed under Settings → Advanced).
export const GUIDE_NAV_ITEM: NavItem = {
  href: "/guide",
  get label() { return t("chat.nav.userGuide"); },
  icon: "info",
  get description() { return t("chat.nav.desc.guide"); },
};

// Where a Settings tool sits on Settings → Advanced: what you open to check
// on the install, to change how it runs, or to learn how it works.
export type AdvancedGroupKey = "diagnose" | "configure" | "learn";

export interface AdvancedItem extends NavItem {
  group: AdvancedGroupKey;
}

export const ADVANCED_GROUPS: { key: AdvancedGroupKey; label: string }[] = [
  { key: "diagnose", get label() { return t("chat.nav.group.diagnose"); } },
  { key: "configure", get label() { return t("chat.nav.group.configure"); } },
  { key: "learn", get label() { return t("chat.nav.group.learn"); } },
];

// Admin / power-user tools surfaced on Settings → Advanced rather than
// in the primary nav — they aren't part of the day-to-day loop.
export const ADVANCED_ITEMS: AdvancedItem[] = [
  {
    href: "/settings/status",
    get label() { return t("chat.nav.setupStatus"); },
    icon: "check-circle",
    group: "diagnose",
    get description() { return t("chat.nav.desc.setupStatus"); },
  },
  {
    href: "/council",
    get label() { return t("chat.nav.agentCouncil"); },
    icon: "users",
    group: "configure",
    get description() { return t("chat.nav.desc.agentCouncil"); },
  },
  {
    href: "/audit",
    get label() { return t("chat.nav.auditLog"); },
    icon: "doc-search",
    group: "diagnose",
    get description() { return t("chat.nav.desc.auditLog"); },
  },
  {
    href: "/audit/usage",
    get label() { return t("chat.nav.tokenUsage"); },
    icon: "activity",
    group: "diagnose",
    get description() { return t("chat.nav.desc.tokenUsage"); },
  },
  {
    href: "/guide",
    get label() { return t("chat.nav.userGuide"); },
    icon: "info",
    group: "learn",
    get description() { return t("chat.nav.desc.guide"); },
  },
  {
    href: "/architecture",
    get label() { return t("chat.nav.architecture"); },
    icon: "grid",
    group: "learn",
    get description() { return t("chat.nav.desc.architecture"); },
  },
  {
    href: "/settings/tools",
    get label() { return t("chat.nav.customTools"); },
    icon: "bolt",
    group: "configure",
    get description() { return t("chat.nav.desc.customTools"); },
  },
  {
    href: "/demo",
    get label() { return t("chat.nav.companySimulator"); },
    icon: "cog",
    group: "configure",
    get description() { return t("chat.nav.desc.companySimulator"); },
  },
  {
    href: "/clients",
    get label() { return t("chat.nav.clientCompanies"); },
    icon: "building",
    group: "configure",
    get description() { return t("chat.nav.desc.clientCompanies"); },
  },
];

// The tools as Settings → Advanced lists them: by group, in ADVANCED_GROUPS
// order, each keeping its ADVANCED_ITEMS order within the group.
export function advancedItemsByGroup(): {
  key: AdvancedGroupKey;
  label: string;
  items: AdvancedItem[];
}[] {
  return ADVANCED_GROUPS.map((group) => ({
    ...group,
    items: ADVANCED_ITEMS.filter((item) => item.group === group.key),
  }));
}

// The Settings hub's tiles, in hub order. Each opens a short page of its
// own at `href`. "act-as-me" shows only for someone who can have Act as me
// (the hub drops it when the card is hidden), "memory" only for someone with
// notes to keep (signed in and on the People list). `hashes` are the anchors the
// old one-page Settings used (`/settings#workspace`): links that still
// carry one land on the matching page (see settingsPageForHash).
export type SettingsPageId = "executive" | "act-as-me" | "memory" | "workspace" | "advanced" | "about";

export interface SettingsPageDef {
  id: SettingsPageId;
  label: string;
  href: string;
  icon: IconName;
  /** What's on the page, as the hub tile says it. */
  description: string;
  hashes: string[];
}

export const SETTINGS_PAGES: SettingsPageDef[] = [
  {
    id: "executive",
    get label() { return t("chat.nav.yourExecutive"); },
    href: "/settings/executive",
    icon: "cog",
    get description() { return t("chat.nav.desc.yourExecutive"); },
    hashes: ["executive", "on-its-own"],
  },
  {
    id: "act-as-me",
    get label() { return t("chat.nav.actAsMe"); },
    href: "/settings/act-as-me",
    icon: "mail",
    get description() { return t("chat.nav.desc.actAsMe"); },
    hashes: ["act-as-me"],
  },
  {
    id: "memory",
    get label() { return t("chat.nav.aboutYou"); },
    href: "/settings/memory",
    icon: "user",
    get description() { return t("chat.nav.desc.aboutYou"); },
    hashes: ["memory"],
  },
  {
    id: "workspace",
    get label() { return t("chat.nav.workspace"); },
    href: "/settings/workspace",
    icon: "building",
    get description() { return t("chat.nav.desc.workspace"); },
    hashes: ["workspace"],
  },
  {
    id: "advanced",
    get label() { return t("chat.nav.advanced"); },
    href: "/settings/advanced",
    icon: "grid",
    get description() { return t("chat.nav.desc.advanced"); },
    // The old Tools section, and the anchors of its groups.
    hashes: ["tools", ...ADVANCED_GROUPS.map((g) => `tools-${g.key}`)],
  },
  {
    id: "about",
    get label() { return t("chat.nav.about"); },
    href: "/settings/about",
    icon: "info",
    get description() { return t("chat.nav.desc.about"); },
    hashes: ["about"],
  },
];

// The page an old `/settings#<hash>` link meant, or null for no hash or one
// that never named a section. Takes the hash with or without its "#".
export function settingsPageForHash(hash: string): SettingsPageDef | null {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // A malformed escape: match it as typed.
  }
  id = id.trim();
  if (!id) return null;
  return SETTINGS_PAGES.find((p) => p.hashes.includes(id)) ?? null;
}

// The phone's bottom bar: five, with New chat in the middle. Knowledge,
// Pulse and Settings are in the menu the top bar's button opens.
// `?new=1` signals the chat home to reset to a fresh chat and strip the
// query — see the effect in app/page.tsx.
export function buildMobilePrimary(opts: BuildOpts = {}): Destination[] {
  const all = buildDestinations(opts);
  const pick = (key: string) => all.find((d) => d.key === key)!;
  const newChat: Destination = {
    key: "new",
    href: "/?new=1",
    label: t("chat.nav.newChat"),
    icon: "plus",
    description: t("chat.nav.desc.newChat"),
  };
  const people = all.find((d) => d.key === "company" || d.key === "you")!;
  return [pick("home"), pick("chats"), newChat, pick("work"), people];
}

// Is `href` the active destination for `pathname`? Active on an exact match
// or anywhere below it (`/jobs` is active on `/jobs/runs/42`).
/** Whether a page is one of the Advanced items (Agent Council, Audit log,
 * ...): they live at their own top-level paths but are opened from Settings →
 * Advanced, so the top bar and sidebar place them under Settings. */
export function isAdvancedPath(pathname: string): boolean {
  return ADVANCED_ITEMS.some((item) => isNavActive(item.href, pathname));
}

export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
