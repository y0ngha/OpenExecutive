"use client";

import { useState } from "react";

import Icon from "@/components/Icon";
import { formatPausedAt, useExecutiveStatus } from "@/components/executive/ExecutiveStatusContext";
import Button from "@/components/ui/Button";
import { t, tp } from "@/i18n/index.ts";

function heldLabel(n: number): string {
  if (n <= 0) return t("settings.runSwitch.nothingWaiting");
  return tp("settings.runSwitch.held", n);
}

// "Paused since 3:42 PM by dana@…." with either part optional.
function pausedLine(since: string, by: string | null): string {
  if (since && by) return t("settings.runSwitch.pausedSinceBy", { since, by });
  if (since) return t("settings.runSwitch.pausedSince", { since });
  if (by) return t("settings.runSwitch.pausedBy", { by });
  return t("settings.runSwitch.pausedPlain");
}

/**
 * Pause / resume the Executive's autonomous work: the body of the run card
 * on Settings → Your Executive. A status row with one button — Pause… opens
 * the pause form (scope and an optional reason); while paused, who paused it
 * and the held count stay in view with Resume as the button.
 */
export default function ExecutiveRunSwitch() {
  const { status, unknown, busy, error, pause, resume } = useExecutiveStatus();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");

  if (!status) return <p className="text-[15px] text-fg-muted">{t("common.loading")}</p>;
  if (unknown) {
    // The last status read failed: say so rather than show a stale state,
    // and offer no action whose effect we can't confirm.
    return (
      <div
        className="flex items-center gap-2.5 text-[15px] text-fg-muted"
        title={t("settings.runSwitch.unreachable")}
      >
        <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 bg-fg-subtle" aria-hidden="true" />
        <span>{t("settings.runSwitch.statusUnknown")}</span>
      </div>
    );
  }
  const paused = status.paused;

  // Collapse only on success so a failure's error stays visible.
  const onPause = async () => {
    if (await pause(reason)) {
      setReason("");
      setExpanded(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-base font-semibold text-fg">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              paused ? "bg-amber-400" : "bg-emerald-500"
            }`}
            aria-hidden="true"
          />
          <span>{paused ? t("settings.runSwitch.paused") : t("settings.runSwitch.running")}</span>
        </div>
        {paused ? (
          status.can_resume && (
            <Button variant="primary" onClick={() => void resume()} disabled={busy}>
              <Icon name="play" size="w-4 h-4" />
              {busy ? t("settings.executive.resuming") : t("settings.executive.resume")}
            </Button>
          )
        ) : (
          !expanded && (
            <Button
              onClick={() => setExpanded(true)}
              aria-expanded={false}
              aria-controls="executive-pause-panel"
            >
              <Icon name="pause" size="w-4 h-4" />
              {t("settings.runSwitch.pauseOpen")}
            </Button>
          )
        )}
      </div>

      {paused ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-sm text-fg-muted leading-relaxed">
            {pausedLine(formatPausedAt(status.paused_at), status.paused_by)}
            {status.reason && (
              <>
                {" "}
                <span className="text-fg">&ldquo;{status.reason}&rdquo;</span>
              </>
            )}
          </p>
          <p className="text-sm text-amber-500">{heldLabel(status.held_actions)}</p>
          {!status.can_resume && (
            <p className="text-sm text-fg-muted">{t("settings.runSwitch.onlyPrincipal")}</p>
          )}
        </div>
      ) : expanded ? (
        <div id="executive-pause-panel" className="mt-4 space-y-3">
          <p className="text-sm text-fg-muted leading-relaxed">{t("settings.runSwitch.pauseScope")}</p>
          <input
            type="text"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void onPause();
            }}
            placeholder={t("settings.runSwitch.reasonPlaceholder")}
            aria-label={t("settings.runSwitch.reasonLabel")}
            className="w-full h-11 px-3.5 rounded-xl text-[15px] bg-surface border border-line text-fg placeholder:text-fg-subtle focus:outline-none focus:border-line-strong"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void onPause()} disabled={busy}>
              <Icon name="pause" size="w-4 h-4" />
              {busy ? t("settings.runSwitch.pausing") : t("settings.runSwitch.pauseExecutive")}
            </Button>
            <Button variant="ghost" onClick={() => setExpanded(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-fg-muted leading-relaxed">
          {t("settings.runSwitch.runningNote")}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
