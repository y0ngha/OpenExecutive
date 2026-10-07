"use client";

import Link from "next/link";

import { useExecutiveStatus } from "@/components/executive/ExecutiveStatusContext";
import ExecutiveRunSwitch from "@/components/executive/ExecutiveRunSwitch";
import VoicePicker from "@/components/executive/VoicePicker";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSubpage from "@/components/settings/SettingsSubpage";
import TakeTheLeadCard from "@/components/settings/TakeTheLeadCard";
import { MeetingAutonomySwitch } from "@/components/settings/WorkspaceCard";
import { t, type MessageKey } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";

// What it always does without asking: no switch, only Pause stops these.
const ALWAYS_DOES: { title: MessageKey; text: MessageKey }[] = [
  { title: "settings.executive.always.briefs.title", text: "settings.executive.always.briefs.text" },
  { title: "settings.executive.always.nudges.title", text: "settings.executive.always.nudges.text" },
  { title: "settings.executive.always.day.title", text: "settings.executive.always.day.text" },
  { title: "settings.executive.always.research.title", text: "settings.executive.always.research.text" },
];

// Settings → Your Executive: everything the Executive does without asking
// first, and the voice it answers in. Pause at the top stops all of it; then
// what it always does and what it does as itself (Take the lead, booking
// meetings). What it sends as you lives on Act as me. /settings/on-its-own
// lands here.
export default function ExecutiveSettingsPage() {
  return (
    <SettingsSubpage
      title={t("settings.executive.title")}
      description={t("settings.executive.description")}
    >
      <SettingsCard
        title={t("settings.executive.pauseTitle")}
        description={t("settings.executive.pauseDescription")}
      >
        <ExecutiveRunSwitch />
      </SettingsCard>

      <PausedNote />

      <SettingsCard title={t("settings.executive.alwaysTitle")} description={t("settings.executive.alwaysDescription")}>
        <ul className="flex flex-col gap-3">
          {ALWAYS_DOES.map((item) => (
            <li key={item.title} className="text-[15px] leading-snug">
              <span className="font-semibold text-fg">{t(item.title)}.</span>{" "}
              <span className="text-fg-muted">{t(item.text)}</span>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <section aria-labelledby="exec-as-executive" className="space-y-3">
        <div>
          <h2 id="exec-as-executive" className="text-lg font-semibold text-fg">{t("settings.executive.asExecutiveTitle")}</h2>
          <p className="mt-1 text-[15px] text-fg-muted">{t("settings.executive.asExecutiveText")}</p>
        </div>
        <TakeTheLeadCard />
        <MeetingAutonomySwitch />
      </section>

      <p className="text-[15px] text-fg-muted">
        {tRich("settings.executive.actAsMeNote", {
          link: (
            <Link href="/settings/act-as-me" className="font-medium text-accent underline-offset-2 hover:underline">
              {t("settings.actAsMe.title")}
            </Link>
          ),
        })}
      </p>

      <SettingsCard title={t("settings.executive.voiceTitle")} description={t("settings.executive.voiceDescription")}>
        <VoicePicker variant="card" />
      </SettingsCard>
    </SettingsSubpage>
  );
}

// While paused, say so above the switches, so nothing below reads as running.
function PausedNote() {
  const { status } = useExecutiveStatus();
  if (!status?.paused) return null;
  return (
    <p
      role="status"
      className="rounded-xl border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-[15px] font-medium text-fg"
    >
      {t("settings.executive.pausedNote")}
    </p>
  );
}
