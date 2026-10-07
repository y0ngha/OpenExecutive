// The words the profile uses for itself, by what it is (`profileWording` in
// components/shell/navConfig.ts): a team's company, a solo owner's business,
// or, for anyone else using Open Executive just for themselves, their work.
// Copy only: every field keeps its name and meaning in all three.

import type { ProfileWording } from "@/components/shell/navConfig";
// Relative: scripts/profileCopy.test.mjs loads this file under plain node.
import { t, type MessageKey } from "../../i18n/index.ts";

export interface ProfileCopy {
  /** The profile page when none exists yet. */
  missing: string;
  /** The chat home's banner when none exists yet. */
  missingBanner: string;
  /** A line under the page heading; null leaves the team page as it was. */
  intro: string | null;
  /** Points at Settings → Workspace, where the role lives; null in team. */
  roleNote: string | null;
  /** The step-by-step form's progress label. */
  progress: string;
  basicsTitle: string;
  missionPlaceholder: string;
  dependenciesNote: string;
  /** `org_structure.departments`: in solo a department is an area. */
  departmentsLabel: string;
}

type CopyKeys = { [K in keyof ProfileCopy]: ProfileCopy[K] extends string ? MessageKey : MessageKey | null };

// Each field is a getter, so the text is looked up when read (at render),
// in the deployment's language, not once at import.
function lazyCopy(keys: CopyKeys): ProfileCopy {
  const copy = {};
  for (const [field, key] of Object.entries(keys)) {
    Object.defineProperty(copy, field, {
      enumerable: true,
      get: () => (key === null ? null : t(key as MessageKey)),
    });
  }
  return copy as ProfileCopy;
}

export const PROFILE_COPY: Record<ProfileWording, ProfileCopy> = {
  company: lazyCopy({
    missing: "misc.profileCopy.company.missing",
    missingBanner: "misc.profileCopy.company.missingBanner",
    intro: null,
    roleNote: null,
    progress: "misc.profileCopy.company.progress",
    basicsTitle: "misc.profileCopy.company.basicsTitle",
    missionPlaceholder: "misc.profileCopy.company.missionPlaceholder",
    dependenciesNote: "misc.profileCopy.company.dependenciesNote",
    departmentsLabel: "misc.profileCopy.company.departmentsLabel",
  }),
  business: lazyCopy({
    missing: "misc.profileCopy.business.missing",
    missingBanner: "misc.profileCopy.business.missingBanner",
    intro: "misc.profileCopy.business.intro",
    roleNote: "misc.profileCopy.business.roleNote",
    progress: "misc.profileCopy.business.progress",
    basicsTitle: "misc.profileCopy.business.basicsTitle",
    missionPlaceholder: "misc.profileCopy.business.missionPlaceholder",
    dependenciesNote: "misc.profileCopy.business.dependenciesNote",
    departmentsLabel: "misc.profileCopy.areasLabel",
  }),
  work: lazyCopy({
    missing: "misc.profileCopy.work.missing",
    missingBanner: "misc.profileCopy.work.missingBanner",
    intro: "misc.profileCopy.work.intro",
    roleNote: "misc.profileCopy.work.roleNote",
    progress: "misc.profileCopy.work.progress",
    basicsTitle: "misc.profileCopy.work.basicsTitle",
    missionPlaceholder: "misc.profileCopy.work.missionPlaceholder",
    dependenciesNote: "misc.profileCopy.work.dependenciesNote",
    departmentsLabel: "misc.profileCopy.areasLabel",
  }),
};
