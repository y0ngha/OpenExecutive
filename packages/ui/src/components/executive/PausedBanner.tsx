"use client";

import Icon from "@/components/Icon";
import { t } from "@/i18n/index.ts";
import { formatPausedAt, useExecutiveStatus } from "@/components/executive/ExecutiveStatusContext";

// Full-width strip at the top of the main column while the Executive is
// paused, so the state is impossible to miss on any page — including mobile,
// where the sidebar switch sits behind the drawer.
export default function PausedBanner() {
  const { status, unknown, busy, error, resume } = useExecutiveStatus();
  // A failed status read renders nothing here: the sidebar switch says
  // "status unknown" instead of a possibly stale "paused".
  if (!status?.paused || unknown) return null;

  const since = formatPausedAt(status.paused_at);
  return (
    <div
      role="status"
      className="flex items-center gap-3 px-4 sm:px-6 py-2 border-b border-amber-500/30 bg-amber-500/10 text-amber-200 flex-shrink-0"
    >
      <Icon name="pause" size="w-4 h-4" />
      <p className="flex-1 min-w-0 text-xs leading-snug">
        <span className="font-medium">{since ? t("settings.pausedBanner.pausedSince", { since }) : t("settings.pausedBanner.paused")}</span>
        <span className="hidden sm:inline">
          {" "}
          {t("settings.pausedBanner.onHold")}
        </span>
        {status.held_actions > 0 && (
          <span className="text-amber-300/80"> · {t("settings.pausedBanner.waiting", { n: status.held_actions })}</span>
        )}
        {error && <span className="text-red-300"> · {error}</span>}
      </p>
      {status.can_resume && (
        <button
          type="button"
          onClick={() => void resume()}
          disabled={busy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Icon name="play" size="w-3.5 h-3.5" />
          {busy ? t("settings.executive.resuming") : t("settings.executive.resume")}
        </button>
      )}
    </div>
  );
}
