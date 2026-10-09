"use client";

import { useEffect, useMemo, useState } from "react";

import AdvancedFold from "@/components/settings/AdvancedFold";
import SettingsCard from "@/components/settings/SettingsCard";
import Switch from "@/components/Switch";
import Button from "@/components/ui/Button";
import RoleFields from "@/components/workspace/RoleFields";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { t, type MessageKey } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";
import {
  getDecisionClassMode,
  getPeopleViewer,
  getWorkspace,
  MEETING_SCHEDULING_CLASS,
  setDecisionClassMode,
  updateWorkspace,
  type DecisionClassMode,
  type WorkspaceMode,
} from "@/lib/api";
import { roleFormErrors, roleFormFrom, roleUpdate, type RoleForm } from "@/lib/principalRole";

// Settings → Workspace: who Hoiv Executive is for (personal, or for your
// team), your role when it's just you, the time zone its briefs run in, and
// whether it books meetings without asking, as one card each, with company
// email domains under Advanced. Mode, role and zone go through PUT
// /workspace and then the app-wide WorkspaceProvider is refreshed so the nav
// and pages follow. The page supplies the title; this is the body.

const MODE_LABEL: Record<WorkspaceMode, MessageKey> = {
  solo: "settings.ws.mode.solo",
  team: "settings.ws.mode.team",
};

export function modeLabel(mode: WorkspaceMode): string {
  return t(MODE_LABEL[mode]);
}

// What changes, shown before the switch is made.
const SWITCH_EFFECT: Record<WorkspaceMode, MessageKey> = {
  team: "settings.ws.switchEffect.team",
  solo: "settings.ws.switchEffect.solo",
};

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function allTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

export default function WorkspaceCard() {
  const { mode, timezone, effectiveTimezone, loading, refresh } = useWorkspace();
  const [pendingMode, setPendingMode] = useState<WorkspaceMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browserZone = useMemo(() => browserTimeZone(), []);
  const zones = useMemo(() => {
    const list = allTimeZones();
    // A stored zone the browser's list lacks (e.g. "UTC" in some engines)
    // must still show as selected.
    if (timezone && !list.includes(timezone)) list.unshift(timezone);
    return list;
  }, [timezone]);

  async function save(update: { mode?: WorkspaceMode; timezone?: string | null }) {
    setBusy(true);
    setError(null);
    try {
      await updateWorkspace(update);
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.ws.saveFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const select =
    "w-full h-11 px-3 rounded-xl text-[15px] bg-surface border border-line text-fg focus:outline-none focus:border-line-strong disabled:opacity-60";
  return (
    <>
      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          {error}
        </p>
      )}

      <SettingsCard
        title={t("settings.ws.usingTitle")}
        titleId="ws-mode-label"
        description={t("settings.ws.usingDescription")}
      >
        <div
          role="radiogroup"
          aria-labelledby="ws-mode-label"
          className="inline-flex w-full sm:w-auto rounded-xl border border-line p-1 bg-surface"
        >
          {(["solo", "team"] as const).map((m) => {
            const selected = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={loading || busy}
                onClick={() => {
                  setError(null);
                  setPendingMode(selected ? null : m);
                }}
                className={`flex-1 sm:flex-none h-10 px-5 rounded-lg text-[15px] font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected ? "bg-surface-elevated text-fg shadow-sm" : "text-fg-muted hover:text-fg"
                }`}
              >
                {modeLabel(m)}
              </button>
            );
          })}
        </div>

        {pendingMode && pendingMode !== mode && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-sm text-fg leading-relaxed">
              {tRich("settings.ws.switchQuestion", {
                mode: <span className="font-semibold">{modeLabel(pendingMode)}</span>,
              })}{" "}
              {t(SWITCH_EFFECT[pendingMode])}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  if (await save({ mode: pendingMode })) setPendingMode(null);
                }}
              >
                {busy ? t("settings.ws.switching") : t("settings.ws.switchTo", { mode: modeLabel(pendingMode) })}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setPendingMode(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
        <p className="mt-4 text-[13px] text-fg-subtle">
          {t("settings.ws.personaNote")}
        </p>
      </SettingsCard>

      {mode === "solo" && <RoleSection />}

      <SettingsCard
        title={<label htmlFor="ws-timezone">{t("settings.ws.timezoneTitle")}</label>}
        description={
          <>
            {t("settings.ws.timezoneDescription")}
            {effectiveTimezone && <>{t("settings.ws.timezoneNow", { zone: effectiveTimezone })}</>}
          </>
        }
      >
        <select
          id="ws-timezone"
          value={timezone ?? ""}
          disabled={loading || busy}
          onChange={(e) => void save({ timezone: e.target.value || null })}
          className={select}
        >
          <option value="">{t("settings.ws.followServer")}</option>
          {browserZone && (
            <optgroup label={t("settings.ws.suggested")}>
              <option value={browserZone}>{t("settings.ws.thisBrowser", { zone: browserZone })}</option>
            </optgroup>
          )}
          <optgroup label={t("settings.ws.allZones")}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </optgroup>
        </select>
        {browserZone && timezone !== browserZone && (
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => void save({ timezone: browserZone })}
            className="mt-2 min-h-touch text-left text-[15px] font-medium text-accent hover:underline cursor-pointer disabled:opacity-50"
          >
            {t("settings.ws.useBrowserZone", { zone: browserZone })}
          </button>
        )}
      </SettingsCard>

      <CompanyDomainsSection />
    </>
  );
}

// "Company email domains": addresses on these match a teammate by the part
// before the @ (anna+invoices@acme.io is the Anna at anna@acme.com); a new
// address there is pre-filled as a teammate when someone writes in. Derived
// from your own address unless set here. The server returns them only to the
// principal, so the row shows only to them.
function CompanyDomainsSection() {
  const [domains, setDomains] = useState<string[] | null>(null);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(ws: { company_domains?: string[]; company_domains_custom?: boolean }) {
    const list = ws.company_domains ?? [];
    setDomains(list);
    setCustom(Boolean(ws.company_domains_custom));
    setDraft(list.join(", "));
  }

  useEffect(() => {
    const ctrl = new AbortController();
    getPeopleViewer()
      .then((viewer) => (viewer.is_principal ? getWorkspace(ctrl.signal).then(apply) : undefined))
      .catch(() => setDomains(null));
    return () => ctrl.abort();
  }, []);

  async function save(value: string[] | null) {
    setBusy(true);
    setError(null);
    try {
      apply(await updateWorkspace({ company_domains: value }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.ws.domainsSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (domains === null) return null;
  const parsed = draft.split(/[\s,;]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  return (
    <AdvancedFold id="ws-advanced" summary={t("settings.ws.domainsTitle")}>
      <SettingsCard
        title={<label htmlFor="ws-domains">{t("settings.ws.domainsTitle")}</label>}
        description={
          <>
            {t("settings.ws.domainsDescription")}
            {!custom && t("settings.ws.domainsDerived")}
          </>
        }
      >
        <input
          id="ws-domains"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="acme.com, acme.io"
          className="w-full h-11 px-3.5 rounded-xl text-[15px] bg-surface border border-line text-fg focus:outline-none focus:border-line-strong disabled:opacity-60"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={busy || parsed.join(",") === domains.join(",")}
            onClick={() => void save(parsed.length ? parsed : null)}
          >
            {t("common.save")}
          </Button>
          {custom && (
            <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
              {t("settings.ws.useMyAddress")}
            </Button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </SettingsCard>
    </AdvancedFold>
  );
}

// "Your role" (solo only): what kind of principal you are and what you do.
// The Executive and its specialists use it to fit their advice to your job.
// Edits stay local until saved; Save sends only the fields that changed.
function RoleSection() {
  const { role, loading, refresh } = useWorkspace();
  const [form, setForm] = useState<RoleForm>(() => roleFormFrom(role));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Follow the saved role when it (re)loads — unless there are local edits.
  const [synced, setSynced] = useState(role);
  if (synced !== role) {
    setSynced(role);
    if (Object.keys(roleUpdate(form, synced)).length === 0) setForm(roleFormFrom(role));
  }

  const update = roleUpdate(form, role);
  const dirty = Object.keys(update).length > 0;
  const problems = roleFormErrors(form);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateWorkspace(update);
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.ws.roleSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      title={t("settings.ws.roleTitle")}
      description={t("settings.ws.roleDescription")}
    >
      <RoleFields
        value={form}
        onChange={(next) => {
          setSaved(false);
          setForm(next);
        }}
        disabled={loading || busy}
        idPrefix="ws-role"
      />
      {problems.map((p) => (
        <p key={p} className="mt-2 text-sm text-red-500">
          {p}
        </p>
      ))}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={!dirty || busy || problems.length > 0}
          onClick={() => void save()}
        >
          {busy ? t("common.saving") : t("settings.ws.saveRole")}
        </Button>
        {dirty && !busy && (
          <Button variant="ghost" onClick={() => setForm(roleFormFrom(role))}>
            {t("settings.ws.discard")}
          </Button>
        )}
        {saved && !dirty && <span className="text-sm text-fg-muted">{t("settings.ws.saved")}</span>}
      </div>
    </SettingsCard>
  );
}

// "Book meetings without asking" — the meeting_scheduling decision class
// between "propose" (each booking waits for approval in the briefing) and
// "auto_execute". Hidden when this backend has no such setting (404). Shown
// on Settings → Your Executive, with what else the Executive does by itself.
export function MeetingAutonomySwitch() {
  const [mode, setMode] = useState<DecisionClassMode | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "absent" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getDecisionClassMode(MEETING_SCHEDULING_CLASS, controller.signal)
      .then((setting) => {
        if (!setting) {
          setState("absent");
          return;
        }
        setMode(setting.mode);
        setState("ready");
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, []);

  if (state === "absent" || state === "loading") return null;
  if (state === "error") {
    return (
      <SettingsCard>
        <p className="text-sm text-fg-muted">{t("settings.ws.meetingsLoadFailed")}</p>
      </SettingsCard>
    );
  }

  const on = mode === "auto_execute";
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await setDecisionClassMode(MEETING_SCHEDULING_CLASS, on ? "propose" : "auto_execute");
      setMode(next.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.lead.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      title={t("settings.ws.meetingsTitle")}
      titleId="ws-meetings-label"
      description={on ? t("settings.ws.meetingsOn") : t("settings.ws.meetingsOff")}
      action={<Switch checked={on} onChange={() => void toggle()} disabled={busy} labelledBy="ws-meetings-label" />}
    >
      {error && <p className="text-sm text-red-500">{error}</p>}
    </SettingsCard>
  );
}
