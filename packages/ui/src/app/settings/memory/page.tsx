"use client";

import AboutYouCard from "@/components/settings/AboutYouCard";
import { CompanyRetentionCard, KeepTrackCard } from "@/components/settings/HistorySettings";
import SettingsSubpage from "@/components/settings/SettingsSubpage";
import { t } from "@/i18n/index.ts";

// Settings → About you: everything the Executive keeps about the signed-in
// person, which only they see. What peer memory has learned about them
// (their profile and notes), then Always in the loop: their own "Keep track
// of what happens" switch, and how long notes last for everyone.
export default function MemorySettingsPage() {
  return (
    <SettingsSubpage
      title={t("settings.memory.title")}
      description={t("settings.memory.description")}
    >
      <div className="space-y-4">
        <AboutYouCard />
        <KeepTrackCard />
        <CompanyRetentionCard />
      </div>
    </SettingsSubpage>
  );
}
