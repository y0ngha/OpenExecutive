"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import SectionTabs from "@/components/ui/SectionTabs";
import { t } from "@/i18n/index.ts";
import RhythmSection, { FollowUpsCard, RecentActivity } from "./CadenceSection";
import MemorySection, { MEMORY_TABS } from "./MemorySection";
import { HeartbeatCard, PulseSummary, usePulseData } from "./PulseHeader";

// The Pulse page is the Executive's memory + heartbeat: what it knows
// (durable episodic memory) and the rhythm it runs on (recurring briefs,
// reflections, department check-ins, and internal scans). Both halves are
// built from data that already exists — episodic memory rows and the
// scheduled_actions queue grouped by `kind`.
//
// Layout: three headline numbers (the rest under "More stats"), then two
// tabs. Heartbeat holds the heatmap and Activity · Rhythm · Follow-ups;
// Memory holds what it knows (decisions, initiatives, advice, corrections,
// history). What it has learned about the signed-in person is theirs alone,
// so it lives in Settings → About you, not here.

type PulseTab = "heartbeat" | "memory";
type BeatView = "activity" | "rhythm" | "followups";

export default function PulsePage() {
  const pulse = usePulseData();
  const router = useRouter();
  // `/memories?tab=corrections` (the chat chip after remember_fact) and the
  // other memory tab names open the Memory tab; MemorySection picks the
  // inner tab from the same parameter.
  const wanted = useSearchParams().get("tab");
  const [tab, setTab] = useState<PulseTab>(() =>
    wanted === "memory" || (MEMORY_TABS as readonly string[]).includes(wanted ?? "")
      ? "memory"
      : "heartbeat",
  );
  const [beatView, setBeatView] = useState<BeatView>("activity");
  // The People tab moved to Settings → About you; old links follow it there.
  useEffect(() => {
    if (wanted === "people") router.replace("/settings/memory");
  }, [router, wanted]);

  const pending = pulse.data?.pending;
  const followups = pending ? pending.filter((a) => a.kind === "ad_hoc").length : null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg">{t("people.pulse.title")}</h1>
        <p className="text-[15px] text-fg-muted mt-1.5 max-w-2xl">
          {t("people.pulse.intro")}
        </p>
      </header>

      <PulseSummary pulse={pulse} />

      <SectionTabs
        label={t("people.pulse.title")}
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "heartbeat", label: t("people.pulse.heartbeat") },
          { id: "memory", label: t("people.pulse.memory") },
        ]}
      />

      {tab === "heartbeat" && (
        <div className="space-y-5">
          <HeartbeatCard pulse={pulse} />
          <SectionTabs
            label={t("people.pulse.heartbeat")}
            active={beatView}
            onChange={setBeatView}
            tabs={[
              { id: "activity", label: t("people.pulse.activity") },
              { id: "rhythm", label: t("people.pulse.rhythm") },
              { id: "followups", label: t("people.pulse.followUps"), badge: followups },
            ]}
          />
          {beatView === "activity" && <RecentActivity />}
          {beatView === "rhythm" && <RhythmSection />}
          {beatView === "followups" && <FollowUpsCard />}
        </div>
      )}

      {/* Kept mounted while hidden so its tab counts load once and its
          `?tab=` deep link is read on first render. */}
      <div className={tab === "memory" ? "" : "hidden"}>
        <MemorySection />
      </div>
    </div>
  );
}
