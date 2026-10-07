"use client";

import SettingsSubpage from "@/components/settings/SettingsSubpage";
import WorkspaceCard from "@/components/settings/WorkspaceCard";
import { t } from "@/i18n/index.ts";

// Settings → Workspace: who Open Executive is for, and when it acts.
export default function WorkspaceSettingsPage() {
  return (
    <SettingsSubpage
      title={t("settings.workspace.title")}
      description={t("settings.workspace.description")}
    >
      <WorkspaceCard />
    </SettingsSubpage>
  );
}
