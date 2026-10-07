"use client";

import AboutCard from "@/components/settings/AboutCard";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSubpage from "@/components/settings/SettingsSubpage";
import { t } from "@/i18n/index.ts";

// Settings → About: the version this install runs.
export default function AboutSettingsPage() {
  return (
    <SettingsSubpage
      title={t("settings.about.title")}
      description={t("settings.about.description")}
    >
      <SettingsCard>
        <AboutCard />
      </SettingsCard>
    </SettingsSubpage>
  );
}
