"use client";

import { useCallback, useEffect, useState } from "react";

import Switch from "@/components/Switch";
import SettingsCard from "@/components/settings/SettingsCard";
import SettingsSubpage from "@/components/settings/SettingsSubpage";
import Button from "@/components/ui/Button";
import {
  getSavedTool,
  listSavedTools,
  rollbackSavedTool,
  setSavedToolEnabled,
  setSavedToolWorkflows,
  type SavedTool,
  type SavedToolDetail,
} from "@/lib/api";
import { displayLocale, t, tp } from "@/i18n/index.ts";

// Where a tool was saved or run: "chat", or "workflow:<name>/<step>".
function originLabel(origin: string): string {
  if (origin === "chat") return t("settings.tools.origin.chat");
  if (origin.startsWith("workflow:"))
    return t("settings.tools.origin.workflow", { name: origin.slice("workflow:".length) });
  return origin;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(displayLocale());
}

function ToolDetail({
  detail,
  busy,
  onRollback,
}: {
  detail: SavedToolDetail;
  busy: boolean;
  onRollback: (version: number) => void;
}) {
  return (
    <div className="mt-4 space-y-5 border-t border-line pt-4">
      <div>
        <h3 className="text-sm font-semibold text-fg">
          {t("settings.tools.howItWorks", { n: detail.version })}
        </h3>
        <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-surface p-3 text-xs leading-relaxed text-fg whitespace-pre-wrap break-words">
          {detail.script}
        </pre>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-fg">{t("settings.tools.versions")}</h3>
        <ul className="mt-2 space-y-2">
          {detail.versions.map((v) => (
            <li key={v.version} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-fg">{t("settings.tools.version", { n: v.version })}</span>
                <span className="text-fg-muted">
                  {t("settings.tools.versionMeta", {
                    when: when(v.created_at),
                    origin: originLabel(v.origin),
                  })}
                </span>
                <p className="text-fg-muted">{v.description}</p>
              </div>
              {v.version === detail.version ? (
                <span className="flex-shrink-0 text-xs text-fg-subtle pt-1">{t("settings.tools.inUse")}</span>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => onRollback(v.version)}>
                  {t("settings.tools.useThis")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-fg">{t("settings.tools.recentRuns")}</h3>
        {detail.runs.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">{t("settings.tools.noRuns")}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {detail.runs.map((r, i) => (
              <li key={`${r.at}-${i}`} className="text-fg-muted">
                <span className={r.ok ? "text-emerald-600" : "text-rose-500"}>
                  {r.ok ? t("settings.tools.worked") : t("settings.tools.failed")}
                </span>
                {tp("settings.tools.runMeta", r.calls, {
                  when: when(r.at),
                  version: r.version,
                  secs: (r.duration_ms / 1000).toFixed(1),
                  origin: originLabel(r.origin),
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ToolCard({
  tool,
  onChanged,
}: {
  tool: SavedTool;
  onChanged: (tool: SavedTool) => void;
}) {
  const [detail, setDetail] = useState<SavedToolDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = `saved-tool-${tool.name}`;
  const python = tool.kind === "python";

  const apply = (next: SavedToolDetail) => {
    setDetail(next);
    onChanged(next);
  };

  const run = async (fn: () => Promise<SavedToolDetail>) => {
    setBusy(true);
    setError(null);
    try {
      apply(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.tools.genericError"));
    } finally {
      setBusy(false);
    }
  };

  const toggleOpen = async () => {
    const next = !open;
    setOpen(next);
    // Fetched on every open: the Executive may have saved a new version since.
    if (next) await run(() => getSavedTool(tool.name));
  };

  return (
    <SettingsCard
      title={<span className="font-mono">{tool.name}</span>}
      titleId={titleId}
      description={tool.description}
      action={
        <Switch
          checked={tool.enabled}
          disabled={busy}
          labelledBy={titleId}
          onChange={(on) => run(() => setSavedToolEnabled(tool.name, on))}
        />
      }
    >
      <p className="text-sm text-fg-muted">
        {t("settings.tools.summary", {
          version: tool.version,
          origin: originLabel(tool.origin),
          when: when(tool.updated_at),
        })}
      </p>
      <p className="mt-1 text-sm text-fg-muted">
        {python ? (
          t("settings.tools.pythonNote")
        ) : (
          <>
            {t("settings.tools.uses")}{" "}
            {tool.uses_tools.length ? (
              <span className="font-mono text-xs">{tool.uses_tools.join(", ")}</span>
            ) : (
              t("settings.tools.noOtherTools")
            )}
          </>
        )}
      </p>
      {!python && (
        <div className="mt-3 flex items-start justify-between gap-4 rounded-xl border border-line px-3 py-2.5">
          <div className="min-w-0">
            <p id={`${titleId}-workflows`} className="text-sm font-medium text-fg">
              {t("settings.tools.useInWorkflows")}
            </p>
            <p className="text-xs text-fg-muted">
              {tool.workflow_version == null
                ? t("settings.tools.workflowsOff")
                : tool.workflow_version === tool.version
                  ? t("settings.tools.workflowsOn", { n: tool.workflow_version })
                  : t("settings.tools.workflowsStill", { n: tool.workflow_version })}
            </p>
            {tool.workflow_version != null && tool.workflow_version !== tool.version && (
              <Button
                size="sm"
                className="mt-2"
                disabled={busy || !tool.enabled}
                onClick={() => run(() => setSavedToolWorkflows(tool.name, tool.version))}
              >
                {t("settings.tools.useVersionInWorkflows", { n: tool.version })}
              </Button>
            )}
          </div>
          <Switch
            checked={tool.workflow_version != null}
            disabled={busy || !tool.enabled}
            labelledBy={`${titleId}-workflows`}
            onChange={(on) => run(() => setSavedToolWorkflows(tool.name, on ? tool.version : null))}
          />
        </div>
      )}
      <div className="mt-3">
        <Button size="sm" variant="ghost" onClick={toggleOpen} aria-expanded={open}>
          {open ? t("settings.tools.hideDetails") : t("settings.tools.showDetails")}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
      {open && detail && (
        <ToolDetail
          detail={detail}
          busy={busy}
          onRollback={(version) => run(() => rollbackSavedTool(tool.name, version))}
        />
      )}
    </SettingsCard>
  );
}

// Settings → Advanced → Custom tools: the tools the Executive built and kept
// (saved tools, run_script save_as), with a switch for each, their versions
// and their recent runs.
export default function SavedToolsSettingsPage() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "forbidden" }
    | { kind: "error"; message: string }
    | { kind: "ready"; enabled: boolean; tools: SavedTool[] }
  >({ kind: "loading" });

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const body = await listSavedTools(signal);
      setState(body ? { kind: "ready", ...body } : { kind: "forbidden" });
    } catch (e) {
      if (signal?.aborted) return;
      setState({ kind: "error", message: e instanceof Error ? e.message : t("settings.tools.loadFailed") });
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const replace = (next: SavedTool) =>
    setState((s) =>
      s.kind === "ready" ? { ...s, tools: s.tools.map((tool) => (tool.name === next.name ? next : tool)) } : s,
    );

  return (
    <SettingsSubpage
      title={t("settings.tools.title")}
      description={t("settings.tools.description")}
    >
      {state.kind === "loading" && <p className="text-sm text-fg-muted">{t("common.loading")}</p>}
      {state.kind === "forbidden" && (
        <SettingsCard>
          <p className="text-sm text-fg-muted">{t("settings.tools.ownerOnly")}</p>
        </SettingsCard>
      )}
      {state.kind === "error" && (
        <SettingsCard>
          <p className="text-sm text-rose-500">{state.message}</p>
        </SettingsCard>
      )}
      {state.kind === "ready" && (
        <>
          {!state.enabled && (
            <SettingsCard>
              <p className="text-sm text-fg-muted">
                {t("settings.tools.serverOff")}
              </p>
            </SettingsCard>
          )}
          {state.tools.length === 0 ? (
            <SettingsCard>
              <p className="text-sm text-fg-muted">
                {t("settings.tools.empty")}
              </p>
            </SettingsCard>
          ) : (
            state.tools.map((tool) => <ToolCard key={tool.name} tool={tool} onChanged={replace} />)
          )}
        </>
      )}
    </SettingsSubpage>
  );
}
