"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { t, type MessageKey } from "@/i18n/index.ts";
import { isMemoryView, pulseViewFor, type PulseView } from "@/lib/pulseView";
import RhythmSection, { FollowUpsCard, RecentActivity } from "./CadenceSection";
import MemoryList from "./MemorySection";
import { HeartbeatCard, usePulseData } from "./PulseHeader";
import { ComingUp, DoneRecently, FocusedScreen, MemoryTiles } from "./PulseOverview";
import { ValueScreen, YourMonthCard } from "./ValueSection";

// The Pulse page is the Executive's memory + heartbeat: what it knows
// (durable episodic memory) and the rhythm it runs on (recurring briefs,
// reflections, department check-ins, and internal scans). Both halves are
// built from data that already exists — episodic memory rows and the
// scheduled_actions queue grouped by `kind`.
//
// Layout: one overview with no tabs ("Your month", the owner's count of what
// it did for them; the heartbeat card with its numbers,
// a tile per kind of memory, then Coming up beside Done recently), and a
// focused screen behind each link, picked by `?tab=` so the older tab links
// still land (lib/pulseView.ts). What it has learned about the signed-in
// person is theirs alone, so it lives in Settings → About you, not here.

// Keys only: the text is looked up at render time.
const SCREENS: Record<Exclude<PulseView, "overview">, { title: MessageKey; description: MessageKey }> = {
  value: { title: "people.pulse.screen.value.title", description: "people.pulse.screen.value.description" },
  schedule: { title: "people.pulse.screen.schedule.title", description: "people.pulse.screen.schedule.description" },
  activity: { title: "people.pulse.screen.activity.title", description: "people.pulse.screen.activity.description" },
  decisions: { title: "people.pulse.screen.decisions.title", description: "people.pulse.screen.decisions.description" },
  initiatives: { title: "people.pulse.screen.initiatives.title", description: "people.pulse.screen.initiatives.description" },
  advice: { title: "people.pulse.screen.advice.title", description: "people.pulse.screen.advice.description" },
  corrections: { title: "people.pulse.screen.corrections.title", description: "people.pulse.screen.corrections.description" },
  history: { title: "people.pulse.screen.history.title", description: "people.pulse.screen.history.description" },
};

export default function PulsePage() {
  const router = useRouter();
  // `/memories?tab=corrections` (the chat chip after remember_fact),
  // `?tab=history` (Settings) and the other screen names open that screen.
  const wanted = useSearchParams().get("tab");
  const view = pulseViewFor(wanted);
  const top = useRef<HTMLDivElement>(null);

  // The People tab moved to Settings → About you; old links follow it there.
  useEffect(() => {
    if (wanted === "people") router.replace("/settings/memory");
  }, [router, wanted]);

  // Moving between the overview and a screen starts at the top.
  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
  }, [view]);

  return (
    <div ref={top} className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {view === "overview" ? (
        <Overview />
      ) : (
        <FocusedScreen title={t(SCREENS[view].title)} description={t(SCREENS[view].description)}>
          {view === "schedule" && (
            <div className="space-y-5">
              <RhythmSection />
              <FollowUpsCard />
            </div>
          )}
          {view === "activity" && <RecentActivity />}
          {view === "value" && <ValueScreen />}
          {isMemoryView(view) && <MemoryList view={view} />}
        </FocusedScreen>
      )}
    </div>
  );
}

/** Loaded each time it's shown, so counts reflect edits made on a list. */
function Overview() {
  const pulse = usePulseData();
  return (
    <>
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg">{t("people.pulse.title")}</h1>
        <p className="text-[15px] text-fg-muted mt-1.5 max-w-2xl">{t("people.pulse.intro")}</p>
      </header>
      <YourMonthCard />
      <HeartbeatCard pulse={pulse} />
      <MemoryTiles pulse={pulse} />
      <div className="grid gap-6 md:grid-cols-2">
        <ComingUp pulse={pulse} />
        <DoneRecently />
      </div>
    </>
  );
}
