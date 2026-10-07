"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FixtureSummary,
  FixtureLoadResult,
  FixtureStatus,
  GenerateFixtureResult,
  listFixtures,
  loadFixture,
  getFixtureStatus,
  snapshotCurrentState,
  unloadFixture,
  resetAllState,
  generateFixture,
  createFixture,
  deleteFixture,
} from "@/lib/api";
import { t, tp } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";

const RESET_CONFIRM_TOKEN = "RESET";

function formatARR(arr: number | null): string {
  if (arr == null) return "—";
  if (arr >= 1_000_000_000) return `$${(arr / 1_000_000_000).toFixed(1)}B`;
  if (arr >= 1_000_000) return `$${(arr / 1_000_000).toFixed(0)}M`;
  if (arr >= 1_000) return `$${(arr / 1_000).toFixed(0)}K`;
  return `$${arr.toFixed(0)}`;
}

const STAGE_COLORS: Record<string, string> = {
  Seed: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "Seed to Series A": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "Pre-Series B": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "Series A": "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  "Series B": "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  Growth: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "Post-Deal Growth": "bg-violet-500/15 text-violet-400 border-violet-500/30",
  "Post-Deal": "bg-violet-500/15 text-violet-400 border-violet-500/30",
};

function stageBadge(stage: string) {
  const cls =
    STAGE_COLORS[stage] ?? "bg-surface-overlay text-fg-muted border-line";
  return (
    <span
      className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${cls}`}
    >
      {stage}
    </span>
  );
}

export default function DemoPage() {
  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingFixture, setLoadingFixture] = useState<string | null>(null);
  const [status, setStatus] = useState<FixtureStatus>({
    active_fixture: null,
    has_snapshot: false,
  });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    kind: "success" | "error";
  } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");

  // Create-with-AI modal state.
  const [createOpen, setCreateOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<GenerateFixtureResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  async function refreshFixtures() {
    try {
      setFixtures(await listFixtures());
    } catch {
      // tolerate transient failures — keep last-known list
    }
  }

  function closeCreate() {
    setCreateOpen(false);
    setDescription("");
    setDraft(null);
    setGenerating(false);
    setSaving(false);
  }

  async function handleGenerate() {
    if (!description.trim()) return;
    setGenerating(true);
    try {
      const result = await generateFixture(description.trim());
      setDraft(result);
    } catch (e: unknown) {
      setToast({
        message: e instanceof Error ? e.message : t("misc.demo.generationFailed"),
        kind: "error",
      });
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveDraft(thenLoad: boolean) {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await createFixture(draft.bundle, description.trim());
      setToast({
        message: t(thenLoad ? "misc.demo.savedLoading" : "misc.demo.saved", { name: result.display_name }),
        kind: "success",
      });
      closeCreate();
      await refreshFixtures();
      if (thenLoad) await handleLoad(result.name);
    } catch (e: unknown) {
      setToast({
        message: e instanceof Error ? e.message : t("misc.demo.saveFailed"),
        kind: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(name: string) {
    setDeletingName(name);
    try {
      await deleteFixture(name);
      setToast({ message: t("misc.demo.deleted", { name }), kind: "success" });
      await refreshFixtures();
      await refreshStatus();
    } catch (e: unknown) {
      setToast({
        message: e instanceof Error ? e.message : t("misc.demo.deleteFailed"),
        kind: "error",
      });
    } finally {
      setDeletingName(null);
    }
  }

  useEffect(() => {
    Promise.all([
      listFixtures(),
      getFixtureStatus().catch(() => ({
        active_fixture: null,
        has_snapshot: false,
      })),
    ])
      .then(([fx, st]) => {
        setFixtures(fx);
        setStatus(st);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function refreshStatus() {
    try {
      setStatus(await getFixtureStatus());
    } catch {
      // tolerate transient failures — UI state stays as last known
    }
  }

  async function handleLoad(name: string) {
    setLoadingFixture(name);
    try {
      const result: FixtureLoadResult = await loadFixture(name);
      const mem = result.memory_seeded;
      const memTotal =
        (mem.decisions ?? 0) +
        (mem.initiatives ?? 0) +
        (mem.advice_given ?? 0);
      setToast({
        message: t("misc.demo.loaded", { name: result.display_name, chunks: result.docs_indexed, memory: memTotal }),
        kind: "success",
      });
      await refreshStatus();
    } catch (e: unknown) {
      setToast({
        message: e instanceof Error ? e.message : t("misc.demo.loadFailed"),
        kind: "error",
      });
    } finally {
      setLoadingFixture(null);
    }
  }

  async function handleSnapshot() {
    setBusy(true);
    try {
      const r = await snapshotCurrentState();
      setToast({
        message: t("misc.demo.snapshotSaved", { people: r.people_snapshotted, departments: r.departments_snapshotted, docs: r.docs_snapshotted }),
        kind: "success",
      });
      await refreshStatus();
    } catch (e: unknown) {
      setToast({
        message: e instanceof Error ? e.message : t("misc.demo.snapshotFailed"),
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleUnload() {
    setBusy(true);
    try {
      const r = await unloadFixture();
      setToast({
        message: t("misc.demo.restored", { chunks: r.docs_indexed, people: r.people_seeded }),
        kind: "success",
      });
      await refreshStatus();
    } catch (e: unknown) {
      setToast({
        message: e instanceof Error ? e.message : t("misc.demo.unloadFailed"),
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    try {
      const r = await resetAllState();
      setToast({
        message: t("misc.demo.resetComplete", { departments: r.departments_seeded }),
        kind: "success",
      });
      setResetOpen(false);
      setResetConfirmText("");
      await refreshStatus();
    } catch (e: unknown) {
      setToast({
        message: e instanceof Error ? e.message : t("misc.demo.resetFailed"),
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full bg-surface">
      <div className="border-b border-line px-6 py-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-fg">{t("misc.demo.title")}</h1>
          <p className="text-xs text-fg-muted mt-1">
            {t("misc.demo.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="shrink-0 text-xs font-medium px-3 py-2 rounded-lg border border-indigo-500/30 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 transition-colors cursor-pointer"
        >
          {t("misc.demo.createWithAi")}
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium border max-w-md text-center ${
            toast.kind === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-red-500/10 border-red-500/30 text-red-300"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Create-with-AI modal */}
      {createOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-line bg-surface-elevated p-5 shadow-xl">
            {!draft ? (
              <>
                <h2 className="text-sm font-semibold text-fg">
                  {t("misc.demo.createTitle")}
                </h2>
                <p className="text-xs text-fg-muted mt-1 leading-relaxed">
                  {t("misc.demo.createBody")}
                </p>
                <textarea
                  autoFocus
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={generating}
                  placeholder={t("misc.demo.createPlaceholder")}
                  className="mt-3 w-full text-xs rounded-lg border border-line bg-surface-input text-fg placeholder:text-fg-subtle px-3 py-2 focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                />
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeCreate}
                    disabled={generating}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-line bg-surface-overlay text-fg-muted hover:text-fg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={generating || !description.trim()}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {generating ? (
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        {t("misc.demo.generating")}
                      </span>
                    ) : (
                      t("misc.demo.generate")
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-sm font-semibold text-fg">{t("misc.demo.reviewTitle")}</h2>
                <p className="text-xs text-fg-muted mt-1">
                  {t("misc.demo.reviewBody")}
                </p>
                <label className="block text-[11px] text-fg-muted mt-3 mb-1">
                  {t("misc.demo.companyName")}
                </label>
                <input
                  type="text"
                  value={draft.bundle.profile.name}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      bundle: {
                        ...draft.bundle,
                        profile: { ...draft.bundle.profile, name: e.target.value },
                      },
                    })
                  }
                  className="w-full text-xs rounded-lg border border-line bg-surface-input text-fg px-3 py-2 focus:outline-none focus:border-indigo-500/50"
                />
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-line bg-surface-overlay px-3 py-2">
                    <span className="text-fg-muted">{t("misc.demo.industryLabel")}</span>
                    <span className="text-fg">{draft.bundle.profile.industry || "—"}</span>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-overlay px-3 py-2">
                    <span className="text-fg-muted">{t("misc.demo.stageLabel")}</span>
                    <span className="text-fg">{draft.bundle.profile.stage || "—"}</span>
                  </div>
                </div>
                <div className="mt-3 text-xs text-fg-muted">
                  {tRich("misc.demo.countPeople", { n: <span className="text-fg font-medium">{draft.bundle.people.length}</span> })}
                  {" · "}
                  {tRich("misc.demo.countDepartments", { n: <span className="text-fg font-medium">{draft.bundle.departments.length}</span> })}
                  {" · "}
                  {tRich("misc.demo.countDocs", { n: <span className="text-fg font-medium">{draft.bundle.docs.length}</span> })}
                </div>
                <div className="mt-2 text-xs text-fg-muted">
                  {tRich("misc.demo.countDecisions", { n: <span className="text-fg font-medium">{draft.bundle.memory.decisions?.length ?? 0}</span> })}
                  {" · "}
                  {tRich("misc.demo.countInitiatives", { n: <span className="text-fg font-medium">{draft.bundle.memory.initiatives?.length ?? 0}</span> })}
                  {" · "}
                  {tRich("misc.demo.countAlerts", { n: <span className="text-fg font-medium">{draft.bundle.memory.alerts?.length ?? 0}</span> })}
                </div>
                <div className="mt-3 rounded-lg border border-line bg-surface-overlay px-3 py-2 text-xs">
                  <p className="text-fg-muted mb-1">{t("misc.demo.team")}</p>
                  <ul className="space-y-0.5">
                    {draft.bundle.people.map((p) => (
                      <li key={p.full_name} className="text-fg truncate">
                        {p.full_name}
                        {p.role ? <span className="text-fg-muted"> — {p.role}</span> : null}
                        {p.is_principal ? (
                          <span className="text-indigo-300">{t("misc.demo.principalSuffix")}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    disabled={saving}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-line bg-surface-overlay text-fg-muted hover:text-fg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {t("misc.demo.editPrompt")}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveDraft(false)}
                      disabled={saving || !draft.bundle.profile.name.trim()}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-line bg-surface-overlay text-fg hover:bg-surface-input transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {saving ? t("common.saving") : t("common.save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveDraft(true)}
                      disabled={saving || !draft.bundle.profile.name.trim()}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t("misc.demo.saveAndLoad")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="px-6 py-6 max-w-4xl mx-auto">
        {loading && (
          <p className="text-sm text-fg-muted">{t("misc.demo.loadingFixtures")}</p>
        )}
        {error && (
          <p className="text-sm text-red-400">
            {t("misc.demo.loadError", { error })}
          </p>
        )}

        {/* Active-fixture banner */}
        {!loading && status.active_fixture && (
          <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center gap-3 flex-wrap">
            <div className="text-xs text-amber-200 flex-1 min-w-0">
              <span className="font-medium">{t("misc.demo.activeLabel")}</span>{" "}
              <span className="font-mono text-amber-100">{status.active_fixture}</span>
              {!status.has_snapshot && (
                <span className="block text-amber-300/80 mt-1">
                  {t("misc.demo.noSnapshotActive")}
                </span>
              )}
              {status.has_snapshot && (
                <span className="block text-amber-300/80 mt-1">
                  {t("misc.demo.snapshotDisabled")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {status.has_snapshot && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleUnload()}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? t("misc.demo.working") : t("misc.demo.unload")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Snapshot CTA when no fixture is active */}
        {!loading && !status.active_fixture && !error && fixtures.length > 0 && (
          <div className="mb-5 rounded-xl border border-line bg-surface-elevated px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-fg-muted flex-1 basis-56">
              {status.has_snapshot ? (
                <>{t("misc.demo.snapshotExists")}</>
              ) : (
                <>{t("misc.demo.noSnapshot")}</>
              )}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSnapshot()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-line bg-surface-overlay text-fg hover:bg-surface-input transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? t("misc.demo.working") : t("misc.demo.snapshot")}
            </button>
          </div>
        )}

        {!loading && !error && fixtures.length === 0 && (
          <p className="text-sm text-fg-muted">
            {tRich("misc.demo.noFixtures", {
              dir: (
                <code className="text-xs bg-surface-overlay px-1 py-0.5 rounded">
                  fixtures/companies/
                </code>
              ),
            })}
          </p>
        )}

        {!loading && fixtures.length > 0 && (
          <>
            <p className="text-xs text-fg-muted mb-4">
              {tp("misc.demo.available", fixtures.length)}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {fixtures.map((fx) => {
                const isActive = status.active_fixture === fx.name;
                const isLoading = loadingFixture === fx.name;
                return (
                  <div
                    key={fx.name}
                    className={`rounded-xl border p-4 flex flex-col gap-3 transition-colors ${
                      isActive
                        ? "border-indigo-500/40 bg-indigo-500/5"
                        : "border-line bg-surface-elevated"
                    }`}
                  >
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-sm font-semibold text-fg truncate">
                            {fx.display_name}
                          </h2>
                          {isActive && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              {t("misc.demo.active")}
                            </span>
                          )}
                          {fx.source === "generated" && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">
                              AI
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-fg-muted mt-0.5 truncate">
                          {fx.industry}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {stageBadge(fx.stage)}
                        {fx.source === "generated" && (
                          <button
                            type="button"
                            title={t("misc.demo.deleteTitle")}
                            disabled={deletingName === fx.name || isActive}
                            onClick={() => void handleDelete(fx.name)}
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded-md border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {deletingName === fx.name ? "…" : t("common.delete")}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Mission */}
                    {fx.mission && (
                      <p className="text-xs text-fg-muted line-clamp-2 leading-relaxed">
                        {fx.mission}
                      </p>
                    )}

                    {/* Stats row */}
                    <div className="flex items-center gap-4 text-xs text-fg-muted">
                      <span>
                        {tRich("misc.demo.statArr", {
                          n: <span className="text-fg font-medium">{formatARR(fx.arr)}</span>,
                        })}
                      </span>
                      {fx.headcount && (
                        <span>
                          {tRich("misc.demo.countPeople", {
                            n: <span className="text-fg font-medium">{fx.headcount}</span>,
                          })}
                        </span>
                      )}
                      <span>
                        {tRich("misc.demo.countDocs", {
                          n: <span className="text-fg font-medium">{fx.doc_count}</span>,
                        })}
                      </span>
                    </div>

                    {/* Org snapshot — departments + leadership */}
                    {(fx.departments.length > 0 || fx.people.length > 0) && (
                      <div className="border-t border-line/60 pt-3 flex flex-col gap-3">
                        {fx.departments.length > 0 && (
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle mb-1.5">
                              {t("misc.demo.departmentsHeading", { n: fx.departments.length })}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {fx.departments.slice(0, 6).map((d) => (
                                <span
                                  key={d.title}
                                  title={d.head ? t("misc.demo.ledBy", { title: d.title, head: d.head }) : d.title}
                                  className="text-[10px] leading-none px-1.5 py-1 rounded-md bg-surface-overlay border border-line text-fg-muted"
                                >
                                  {d.title}
                                </span>
                              ))}
                              {fx.departments.length > 6 && (
                                <span className="text-[10px] leading-none px-1.5 py-1 text-fg-subtle">
                                  {t("misc.demo.more", { n: fx.departments.length - 6 })}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {fx.people.length > 0 && (
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle mb-1.5">
                              {t("misc.demo.leadershipHeading", { n: fx.people.length })}
                            </p>
                            <ul className="flex flex-col gap-1">
                              {fx.people.slice(0, 5).map((p) => (
                                <li
                                  key={p.name}
                                  className="flex items-baseline gap-1.5 text-[11px] min-w-0"
                                >
                                  <span className="text-fg font-medium whitespace-nowrap">
                                    {p.name}
                                  </span>
                                  {p.is_principal && (
                                    <span className="text-[9px] uppercase tracking-wide px-1 py-px rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 whitespace-nowrap">
                                      {t("misc.demo.principal")}
                                    </span>
                                  )}
                                  {p.role && (
                                    <span className="text-fg-subtle truncate">
                                      {p.role}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Load button */}
                    <button
                      type="button"
                      disabled={isLoading || loadingFixture !== null}
                      onClick={() => void handleLoad(fx.name)}
                      className={`w-full mt-auto px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer border ${
                        isActive
                          ? "bg-indigo-500/20 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30"
                          : "bg-surface-overlay border-line text-fg hover:bg-surface-input"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {isLoading ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                          {t("common.loading")}
                        </span>
                      ) : isActive ? (
                        t("misc.demo.reload")
                      ) : (
                        t("misc.demo.load")
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            {status.active_fixture && (
              <div className="mt-6 flex items-center gap-3">
                <p className="text-xs text-fg-muted">
                  {t("misc.demo.contextLoaded")}
                </p>
                <Link
                  href="/"
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors cursor-pointer whitespace-nowrap"
                >
                  {t("misc.demo.openChat")}
                </Link>
              </div>
            )}

            {/* Danger zone — reset everything */}
            <div className="mt-10 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-red-300">
                    {t("misc.demo.dangerTitle")}
                  </h3>
                  <p className="text-xs text-fg-muted mt-1 leading-relaxed">
                    {tRich("misc.demo.dangerBody", { and: <em>{t("misc.demo.dangerAnd")}</em> })}
                  </p>
                </div>
                {!resetOpen && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setResetOpen(true)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {t("misc.demo.resetEverything")}
                  </button>
                )}
              </div>

              {resetOpen && (
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <label
                    htmlFor="reset-confirm-input"
                    className="text-xs text-fg-muted whitespace-nowrap"
                  >
                    {tRich("misc.demo.typeToConfirm", {
                      token: <code className="font-mono text-red-300">{RESET_CONFIRM_TOKEN}</code>,
                    })}
                  </label>
                  <input
                    id="reset-confirm-input"
                    type="text"
                    autoFocus
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    disabled={busy}
                    placeholder={RESET_CONFIRM_TOKEN}
                    className="text-xs font-mono px-2 py-1.5 rounded-md border border-line bg-surface-input text-fg placeholder:text-fg-subtle focus:outline-none focus:border-red-500/50 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    disabled={
                      busy || resetConfirmText !== RESET_CONFIRM_TOKEN
                    }
                    onClick={() => void handleReset()}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/20 text-red-200 hover:bg-red-500/30 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {busy ? t("misc.demo.resetting") : t("misc.demo.confirmReset")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setResetOpen(false);
                      setResetConfirmText("");
                    }}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-line bg-surface-overlay text-fg-muted hover:text-fg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
