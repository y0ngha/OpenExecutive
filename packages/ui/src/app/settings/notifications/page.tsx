"use client";

import NotificationsCard from "@/components/settings/NotificationsCard";
import SettingsSubpage from "@/components/settings/SettingsSubpage";
import { t } from "@/i18n/index.ts";

// Settings → Notifications: each person's own quiet hours, whether things
// reach them as they happen or in their briefs, and urgent things through.
export default function NotificationsSettingsPage() {
  return (
    <SettingsSubpage
      title={t("settings.notifications.title")}
      description={t("settings.notifications.description")}
    >
      <NotificationsCard />
    </SettingsSubpage>
  );
}
