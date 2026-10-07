"use client";

import type { PeriodType } from "@/lib/api";
import { t, type MessageKey } from "@/i18n/index.ts";

/**
 * Pair of (period_type dropdown + period_value text input) for editing a Goal's
 * timeframe. When the dropdown changes, the parent receives both new values via
 * `onChange`; the helper `suggestPeriodValue(type, today)` lets callers populate
 * a sensible default for the new type.
 *
 * For period_type="ongoing" the value input is hidden and the value is forced
 * to the literal string "Ongoing" so the stored row is well-formed.
 */

const PERIOD_TYPES: { value: PeriodType; label: MessageKey; placeholder: MessageKey }[] = [
  { value: "week", label: "misc.timeframe.week", placeholder: "misc.timeframe.weekPlaceholder" },
  { value: "month", label: "misc.timeframe.month", placeholder: "misc.timeframe.monthPlaceholder" },
  { value: "quarter", label: "misc.timeframe.quarter", placeholder: "misc.timeframe.quarterPlaceholder" },
  { value: "year", label: "misc.timeframe.year", placeholder: "misc.timeframe.yearPlaceholder" },
  { value: "ongoing", label: "misc.timeframe.ongoing", placeholder: "misc.timeframe.ongoing" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Suggest a sensible period_value string for a given period_type, anchored on
 * `today`. Used by the form when the user changes the dropdown so they're not
 * left with a stale value from a different period scale.
 *
 * Week: "Week of {Mon DD}" — anchored on the most recent Monday.
 * Month: "{MonthName YYYY}"
 * Quarter: "Q{1-4} YYYY"
 * Year: "{YYYY}"
 * Ongoing: "Ongoing"
 */
export function suggestPeriodValue(periodType: PeriodType, today: Date = new Date()): string {
  switch (periodType) {
    case "week": {
      const d = new Date(today);
      // ISO weekday: Mon=1..Sun=7. Date.getDay(): Sun=0..Sat=6.
      const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
      d.setDate(d.getDate() - (dayOfWeek - 1));
      return `Week of ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
    }
    case "month":
      return `${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}`;
    case "quarter": {
      const q = Math.floor(today.getMonth() / 3) + 1;
      return `Q${q} ${today.getFullYear()}`;
    }
    case "year":
      return String(today.getFullYear());
    case "ongoing":
      return "Ongoing";
  }
}

const CHIP_LABELS: Record<PeriodType, MessageKey> = {
  week: "misc.timeframe.thisWeek",
  month: "misc.timeframe.thisMonth",
  quarter: "misc.timeframe.thisQuarter",
  year: "misc.timeframe.thisYear",
  ongoing: "misc.timeframe.ongoing",
};

/**
 * One-click timeframe for a new goal: each chip picks a period type and the
 * current period's label (`suggestPeriodValue`), so there is nothing to type.
 * Editing an existing goal uses the full picker below, where the label is
 * free text ("H2 FY27").
 */
export function TimeframeChips({
  periodType,
  onChange,
}: {
  periodType: PeriodType;
  onChange: (periodType: PeriodType, periodValue: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-fg-muted" id="timeframe-chips-label">
        {t("misc.timeframe.label")}
      </span>
      <div role="radiogroup" aria-labelledby="timeframe-chips-label" className="flex flex-wrap gap-2">
        {PERIOD_TYPES.map((p) => {
          const selected = p.value === periodType;
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(p.value, suggestPeriodValue(p.value))}
              title={p.value === "ongoing" ? undefined : suggestPeriodValue(p.value)}
              className={
                "h-10 px-4 rounded-full border text-[15px] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
                (selected
                  ? "border-accent/70 bg-accent/10 text-fg font-medium"
                  : "border-line text-fg-muted hover:text-fg hover:border-line-strong")
              }
            >
              {t(CHIP_LABELS[p.value])}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface TimeframePickerProps {
  periodType: PeriodType;
  periodValue: string;
  onChange: (periodType: PeriodType, periodValue: string) => void;
  /** Visual size: compact inputs match the in-list edit row; default matches the new-row form. */
  size?: "compact" | "default";
}

export default function TimeframePicker({
  periodType,
  periodValue,
  onChange,
  size = "default",
}: TimeframePickerProps) {
  const placeholderKey = PERIOD_TYPES.find((p) => p.value === periodType)?.placeholder;
  const placeholder = placeholderKey ? t(placeholderKey) : "";
  const inputCls =
    size === "compact"
      ? "h-11 px-3 rounded-xl bg-surface-input/60 border border-line text-[15px] text-fg focus:outline-none focus:border-accent"
      : "h-11 px-3 rounded-xl bg-surface-input/60 border border-line text-[15px] text-fg focus:outline-none focus:border-accent";

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="text-sm text-fg-muted flex flex-col gap-1.5">
        {t("misc.timeframe.label")}
        <select
          value={periodType}
          onChange={(e) => {
            const next = e.target.value as PeriodType;
            // Auto-fill a sensible default for the new type unless the existing
            // value still makes sense (rare; the type usually implies a format).
            onChange(next, suggestPeriodValue(next));
          }}
          className={inputCls}
        >
          {PERIOD_TYPES.map((p) => (
            <option key={p.value} value={p.value}>{t(p.label)}</option>
          ))}
        </select>
      </label>
      {periodType !== "ongoing" && (
        <label className="text-sm text-fg-muted flex flex-col gap-1.5">
          {t("misc.timeframe.period")}
          <input
            value={periodValue}
            onChange={(e) => onChange(periodType, e.target.value)}
            className={inputCls}
            placeholder={placeholder}
          />
        </label>
      )}
    </div>
  );
}
