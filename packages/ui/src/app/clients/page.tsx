"use client";

import { useCallback, useEffect, useId, useState } from "react";

import Link from "next/link";

import Button, { buttonClass } from "@/components/ui/Button";
import OverflowMenu from "@/components/ui/OverflowMenu";
import SectionTabs, { sectionPanelProps } from "@/components/ui/SectionTabs";
import SidePanel from "@/components/ui/SidePanel";
import { displayLocale, t, tp } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";
import {
  activateClient,
  type ClientCockpitCard,
  type ClientDraftResult,
  type ClientMetaPatch,
  type ClientsStatus,
  createClient,
  createClientFromDraft,
  deleteClient,
  generateClientDraft,
  getClientsCockpit,
  listClients,
  saveActiveClient,
  updateClientMeta,
} from "@/lib/api";
import { clientCountsSummary, renewalBadge } from "@/lib/practice";

// Client-company switcher for fractional / multi-client use. One client is
// live at a time; switching saves the current client back to its slot and
// restores the target. Single-company installs see only the intro + create
// form — nothing about the default experience changes until a client exists.

const INPUT_CLS =
  "w-full px-3 rounded-xl bg-surface-input/60 border border-line text-[15px] text-fg placeholder-fg-subtle focus:outline-none focus:border-accent";
const FIELD_CLS = `${INPUT_CLS} h-11`;
const LABEL_CLS = "text-sm text-fg-muted flex flex-col gap-1.5";

// base64url-encode a prefill payload for the /jobs/{name} runner page
// (mirrors decodePrefill there).
function encodePrefill(payload: Record<string, string>): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function ClientsPage() {
  const [status, setStatus] = useState<ClientsStatus>({
    active: null,
    fixture_active: null,
    clients: [],
  });
  const [loading, setLoading] = useState(true);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [name, setName] = useState("");
  const [source, setSource] = useState<"current" | "blank">("current");
  const [creating, setCreating] = useState(false);
  // The "New client" panel and which of its two ways is showing.
  const [createOpen, setCreateOpen] = useState(false);
  const [createWay, setCreateWay] = useState<"company" | "notes">("company");
  const createTabsId = useId();

  // Engagement-intake (AI draft) flow.
  const [notes, setNotes] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<ClientDraftResult | null>(null);
  const [draftName, setDraftName] = useState("");
  const [creatingDraft, setCreatingDraft] = useState(false);

  // Practice cockpit (multi-client only) + per-slot engagement metadata edit.
  const [cockpit, setCockpit] = useState<ClientCockpitCard[]>([]);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [metaForm, setMetaForm] = useState<ClientMetaPatch>({});
  const [savingMeta, setSavingMeta] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await listClients();
      setStatus(next);
      if (next.clients.length >= 2) {
        try {
          setCockpit((await getClientsCockpit()).clients);
        } catch {
          setCockpit([]);
        }
      } else {
        setCockpit([]);
      }
    } catch {
      setToast({ message: t("people.clients.loadFailed"), kind: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await createClient(name.trim(), source);
      setToast({
        message: created.active
          ? t("people.clients.createdActive", { name: created.display_name })
          : t("people.clients.createdInactive", { name: created.display_name }),
        kind: "success",
      });
      setName("");
      setCreateOpen(false);
      await refresh();
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : t("people.dept.createFailed"), kind: "error" });
    } finally {
      setCreating(false);
    }
  }

  function openMetaEditor(slug: string) {
    const c = status.clients.find((x) => x.slug === slug) as
      | (Record<string, unknown> & { slug: string })
      | undefined;
    setMetaForm({
      role: (c?.role as string) ?? "",
      status: (c?.status as string) ?? "active",
      renewal_date: (c?.renewal_date as string) ?? "",
      retainer: (c?.retainer as string) ?? "",
      primary_contact: (c?.primary_contact as string) ?? "",
      notes: (c?.notes as string) ?? "",
    });
    setEditingSlug(slug);
  }

  async function handleSaveMeta() {
    if (!editingSlug) return;
    setSavingMeta(true);
    try {
      // Drop empty strings so we never overwrite with blanks unintentionally.
      const patch = Object.fromEntries(
        Object.entries(metaForm).filter(([, v]) => v !== "" && v !== undefined),
      ) as ClientMetaPatch;
      await updateClientMeta(editingSlug, patch);
      setToast({ message: t("people.clients.detailsSaved"), kind: "success" });
      setEditingSlug(null);
      await refresh();
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : t("people.dept.saveFailed"), kind: "error" });
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleGenerateDraft() {
    if (!notes.trim() && attachments.length === 0) return;
    setGenerating(true);
    try {
      const result = await generateClientDraft(notes.trim(), attachments);
      setDraft(result);
      setDraftName(result.display_name);
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : t("people.clients.draftFailed"), kind: "error" });
    } finally {
      setGenerating(false);
    }
  }

  async function handleCreateFromDraft(activate: boolean) {
    if (!draft) return;
    setCreatingDraft(true);
    try {
      const displayName = draftName.trim() || draft.display_name;
      const bundle = { ...draft.bundle, profile: { ...draft.bundle.profile, name: displayName } };
      const created = await createClientFromDraft(displayName, bundle, notes.trim());
      if (activate) {
        await activateClient(created.slug);
        setToast({ message: t("people.clients.createdActivated", { name: displayName }), kind: "success" });
      } else {
        setToast({
          message: t("people.clients.createdStartEngagement", { name: displayName }),
          kind: "success",
        });
      }
      setDraft(null);
      setNotes("");
      setAttachments([]);
      setCreateOpen(false);
      await refresh();
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : t("people.dept.createFailed"), kind: "error" });
    } finally {
      setCreatingDraft(false);
    }
  }

  async function handleActivate(slug: string) {
    setBusySlug(slug);
    try {
      const result = await activateClient(slug);
      setToast({
        message: result.mcp_config_changed
          ? t("people.clients.switchedMcp", { slug })
          : t("people.clients.switched", { slug }),
        kind: "success",
      });
      await refresh();
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : t("people.clients.switchFailed"), kind: "error" });
    } finally {
      setBusySlug(null);
    }
  }

  async function handleSave() {
    setBusySlug(status.active);
    try {
      const result = await saveActiveClient();
      setToast({ message: t("people.clients.savedSlot", { slug: result.slug }), kind: "success" });
      await refresh();
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : t("people.dept.saveFailed"), kind: "error" });
    } finally {
      setBusySlug(null);
    }
  }

  async function handleDelete(slug: string) {
    setBusySlug(slug);
    try {
      await deleteClient(slug);
      setToast({ message: t("people.clients.deleted", { slug }), kind: "success" });
      await refresh();
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : t("people.dept.deleteFailed"), kind: "error" });
    } finally {
      setBusySlug(null);
    }
  }

  const editingClient = status.clients.find((c) => c.slug === editingSlug) ?? null;
  const fixtureActive = !!status.fixture_active;

  return (
    <main className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg">{t("people.clients.title")}</h1>
            <p className="mt-2 text-[15px] text-fg-muted">
              {t("people.clients.intro")}
            </p>
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)} className="flex-shrink-0 self-start">
            {t("people.clients.newClient")}
          </Button>
        </div>

        {toast && (
          <div
            role="status"
            className={`mt-5 rounded-xl border px-4 py-3 text-[15px] ${
              toast.kind === "success"
                ? "border-line bg-surface-elevated text-fg"
                : "border-red-500/40 bg-red-500/10 text-red-500"
            }`}
          >
            {toast.message}
          </div>
        )}

        {status.rotation_in_progress && (
          <div className="mt-5 rounded-xl border border-line bg-surface-elevated px-4 py-3 text-[15px] text-fg-muted">
            {t("people.clients.rotation")}
          </div>
        )}

        {status.fixture_active && (
          <div className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[15px] text-amber-700 dark:text-amber-400">
            {tRich("people.clients.fixtureActive", { name: <strong>{status.fixture_active}</strong> })}
          </div>
        )}

        {/* Practice cockpit — only in multi-client mode (2+ slots) */}
        {cockpit.length >= 2 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-fg">{t("people.clients.cockpit")}</h2>
            <p className="mt-1 text-[15px] text-fg-muted">
              {t("people.clients.cockpitIntro")}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {cockpit.map((c) => (
                <div
                  key={`cockpit-${c.slug}`}
                  className={`rounded-2xl border p-4 ${
                    c.is_active ? "border-line-strong bg-surface-overlay" : "border-line bg-surface-elevated"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[15px] font-semibold text-fg truncate">
                      {c.display_name}
                      {c.role ? (
                        <span className="text-fg-muted font-normal"> · {c.role}</span>
                      ) : null}
                    </div>
                    {c.is_active ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                        {t("people.clients.active")}
                      </span>
                    ) : (
                      (() => {
                        const badge = renewalBadge(c.days_to_renewal);
                        return badge ? (
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ${
                              badge.urgent
                                ? "border-red-500/40 bg-red-500/10 text-red-500"
                                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            }`}
                          >
                            {badge.label}
                          </span>
                        ) : null;
                      })()
                    )}
                  </div>
                  <div className="mt-1.5 text-sm text-fg-muted">
                    {clientCountsSummary(c)}
                  </div>
                  {c.has_state && (
                    <div className="mt-3">
                      <Link
                        href={`/jobs/engagement_value_report?prefill=${encodePrefill({ client_slug: c.slug })}`}
                        className={buttonClass("secondary", "sm")}
                      >
                        {t("people.clients.valueReport")}
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* List */}
        {loading ? (
          <p className="mt-8 text-[15px] text-fg-muted">{t("people.clients.loading")}</p>
        ) : status.clients.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-line bg-surface-elevated p-8 text-center">
            <p className="text-[15px] text-fg-muted">
              {t("people.clients.empty")}
            </p>
          </div>
        ) : (
          <section className="mt-8">
            {cockpit.length >= 2 && <h2 className="text-lg font-semibold text-fg mb-3">{t("people.clients.all")}</h2>}
            <div className="space-y-3">
            {status.clients.map((c) => {
              const isActive = c.slug === status.active;
              const busy = busySlug === c.slug;
              return (
                <div
                  key={c.slug}
                  className={`rounded-2xl border p-5 ${
                    isActive
                      ? "border-line-strong bg-surface-overlay"
                      : "border-line bg-surface-elevated"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-fg truncate">
                          {c.display_name}
                        </h3>
                        {isActive && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            {t("people.clients.active")}
                          </span>
                        )}
                        {c.has_mcp_config && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-line text-fg-muted">
                            {t("people.clients.mcpTools")}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-fg-muted">
                        {[c.role, c.status, c.industry, c.stage]
                          .filter(Boolean)
                          .join(" · ") || c.slug}
                        {" · "}
                        {tp("people.clients.docCount", c.doc_count)}
                        {c.saved_at
                          ? t("people.clients.savedAt", { date: new Date(c.saved_at).toLocaleString(displayLocale()) })
                          : t("people.clients.neverSaved")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isActive ? (
                        <Button
                          onClick={() => void handleSave()}
                          disabled={busy || fixtureActive}
                        >
                          {busy ? t("common.saving") : t("people.clients.saveNow")}
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          onClick={() => void handleActivate(c.slug)}
                          disabled={busy || fixtureActive}
                        >
                          {busy ? t("people.teamMode.switching") : t("people.clients.activate")}
                        </Button>
                      )}
                      <OverflowMenu
                        label={t("people.dept.moreActions", { title: c.display_name })}
                        items={[
                          { label: t("people.clients.engagementDetails"), onSelect: () => openMetaEditor(c.slug) },
                          ...(isActive
                            ? []
                            : [{
                                label: t("people.clients.delete"),
                                danger: true,
                                disabled: busy,
                                onSelect: () => {
                                  if (window.confirm(t("people.clients.deleteConfirm", { name: c.display_name }))) {
                                    void handleDelete(c.slug);
                                  }
                                },
                              }]),
                        ]}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </section>
        )}

        <p className="mt-8 text-sm text-fg-muted leading-relaxed">
          {t("people.clients.footer")}
        </p>
      </div>

      {/* New client: from a company, or drafted from intake notes */}
      <SidePanel
        open={createOpen}
        onClose={() => {
          if (!creating && !generating && !creatingDraft) setCreateOpen(false);
        }}
        title={t("people.clients.newClient")}
        width="lg"
      >
        {toast?.kind === "error" && (
          <div role="alert" className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-[15px] text-red-500">
            {toast.message}
          </div>
        )}
        <div className="mb-5">
          <SectionTabs
            idBase={createTabsId}
            label={t("people.clients.howToCreate")}
            tabs={[
              { id: "company", label: t("people.clients.fromCompany") },
              { id: "notes", label: t("people.clients.fromNotes") },
            ]}
            active={createWay}
            onChange={setCreateWay}
          />
        </div>
        <div {...sectionPanelProps(createTabsId, createWay)}>
          {createWay === "company" ? (
            <div className="space-y-4">
              <label className={LABEL_CLS}>
                {t("people.clients.companyName")}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim() && !creating && !fixtureActive) void handleCreate();
                  }}
                  placeholder={t("people.clients.companyName")}
                  className={FIELD_CLS}
                />
              </label>
              <label className={LABEL_CLS}>
                {t("people.clients.startFrom")}
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as "current" | "blank")}
                  className={FIELD_CLS}
                >
                  <option value="current">{t("people.clients.fromCurrent")}</option>
                  <option value="blank">{t("people.clients.blank")}</option>
                </select>
              </label>
              <p className="text-sm text-fg-muted">
                {source === "current"
                  ? t("people.clients.fromCurrentHint")
                  : t("people.clients.blankHint")}
              </p>
              <Button
                variant="primary"
                onClick={() => void handleCreate()}
                disabled={creating || !name.trim() || fixtureActive}
              >
                {creating ? t("people.dept.creating") : t("people.dept.create")}
              </Button>
            </div>
          ) : (
            <div>
              <p className="text-[15px] text-fg-muted">
                {t("people.clients.notesIntro")}
              </p>

              {!draft ? (
                <>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={7}
                    aria-label={t("people.clients.intakeNotes")}
                    placeholder={t("people.clients.notesPlaceholder")}
                    className={`mt-4 ${INPUT_CLS} py-2.5`}
                  />

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className={`${buttonClass("secondary", "md")} cursor-pointer focus-within:ring-2 focus-within:ring-accent/60`}>
                      {t("people.clients.attachFiles")}
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.docx,.doc,.xlsx,.xlsm,.csv,.md,.txt"
                        className="sr-only"
                        onChange={(e) => {
                          const picked = Array.from(e.target.files ?? []);
                          if (picked.length) setAttachments((prev) => [...prev, ...picked]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <span className="text-sm text-fg-muted">
                      {t("people.clients.fileTypes")}
                    </span>
                  </div>

                  {attachments.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {attachments.map((f, i) => (
                        <li
                          key={`${f.name}-${i}`}
                          className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface pl-4 pr-1 py-1 text-sm text-fg"
                        >
                          <span className="truncate">{f.name}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setAttachments((prev) => prev.filter((_, j) => j !== i))
                            }
                            aria-label={t("people.clients.removeFile", { name: f.name })}
                            className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg text-lg text-fg-muted hover:text-fg hover:bg-surface-overlay"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <Button
                    variant="primary"
                    onClick={() => void handleGenerateDraft()}
                    disabled={
                      generating ||
                      (!notes.trim() && attachments.length === 0) ||
                      fixtureActive
                    }
                    className="mt-4"
                  >
                    {generating ? t("people.clients.drafting") : t("people.clients.draftClient")}
                  </Button>
                </>
              ) : (
                <div className="mt-4">
                  <label className={LABEL_CLS}>
                    {t("people.clients.clientName")}
                    <input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      className={FIELD_CLS}
                    />
                  </label>
                  <p className="mt-2 text-sm text-fg-muted">
                    {t("people.clients.draftCounts", {
                      people: draft.bundle.people.length,
                      departments: draft.bundle.departments.length,
                      docs: draft.bundle.docs.length,
                    })}
                  </p>
                  {draft.bundle.people.length > 0 && (
                    <p className="mt-2 text-sm text-fg-muted">
                      {t("people.clients.roster")}{" "}
                      {draft.bundle.people
                        .map((p) => `${p.full_name}${p.is_principal ? t("people.clients.principalSuffix") : ""}`)
                        .join(", ")}
                    </p>
                  )}
                  {draft.bundle.docs.length > 0 && (
                    <p className="mt-1 text-sm text-fg-muted">
                      {t("people.clients.docs", { list: draft.bundle.docs.map((d) => d.filename).join(", ") })}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      onClick={() => void handleCreateFromDraft(true)}
                      disabled={creatingDraft || !draftName.trim()}
                    >
                      {creatingDraft ? t("people.dept.creating") : t("people.clients.createActivate")}
                    </Button>
                    <Button
                      onClick={() => void handleCreateFromDraft(false)}
                      disabled={creatingDraft || !draftName.trim()}
                    >
                      {creatingDraft ? t("people.dept.creating") : t("people.clients.createClient")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setDraft(null)}
                      disabled={creatingDraft}
                    >
                      {t("people.clients.editNotes")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </SidePanel>

      {/* Engagement details for one client */}
      <SidePanel
        open={editingClient !== null}
        onClose={() => {
          if (!savingMeta) setEditingSlug(null);
        }}
        title={t("people.clients.engagementDetails")}
        subtitle={editingClient?.display_name}
        footer={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void handleSaveMeta()} disabled={savingMeta} className="flex-1 sm:flex-none">
              {savingMeta ? t("common.saving") : t("people.clients.saveDetails")}
            </Button>
            <Button onClick={() => setEditingSlug(null)} disabled={savingMeta}>
              {t("common.cancel")}
            </Button>
          </div>
        }
      >
        {toast?.kind === "error" && (
          <div role="alert" className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-[15px] text-red-500">
            {toast.message}
          </div>
        )}
        <div className="space-y-4">
          <label className={LABEL_CLS}>
            {t("people.clients.yourRole")}
            <input
              value={metaForm.role ?? ""}
              onChange={(e) => setMetaForm({ ...metaForm, role: e.target.value })}
              placeholder={t("people.clients.yourRolePlaceholder")}
              className={FIELD_CLS}
            />
          </label>
          <label className={LABEL_CLS}>
            {t("people.clients.status")}
            <select
              value={metaForm.status ?? "active"}
              onChange={(e) => setMetaForm({ ...metaForm, status: e.target.value })}
              className={FIELD_CLS}
            >
              <option value="active">{t("people.clients.active")}</option>
              <option value="paused">{t("people.clients.paused")}</option>
              <option value="winding_down">{t("people.clients.windingDown")}</option>
              <option value="completed">{t("people.clients.completed")}</option>
            </select>
          </label>
          <label className={LABEL_CLS}>
            {t("people.clients.renewal")}
            <input
              type="date"
              value={metaForm.renewal_date ?? ""}
              onChange={(e) =>
                setMetaForm({ ...metaForm, renewal_date: e.target.value })
              }
              className={FIELD_CLS}
            />
          </label>
          <label className={LABEL_CLS}>
            {t("people.clients.retainer")}
            <input
              value={metaForm.retainer ?? ""}
              onChange={(e) => setMetaForm({ ...metaForm, retainer: e.target.value })}
              placeholder={t("people.clients.retainerPlaceholder")}
              className={FIELD_CLS}
            />
          </label>
          <label className={LABEL_CLS}>
            {t("people.clients.primaryContact")}
            <input
              value={metaForm.primary_contact ?? ""}
              onChange={(e) =>
                setMetaForm({ ...metaForm, primary_contact: e.target.value })
              }
              placeholder={t("people.clients.primaryContact")}
              className={FIELD_CLS}
            />
          </label>
          <label className={LABEL_CLS}>
            {t("people.clients.notes")}
            <input
              value={metaForm.notes ?? ""}
              onChange={(e) => setMetaForm({ ...metaForm, notes: e.target.value })}
              placeholder={t("people.clients.notes")}
              className={FIELD_CLS}
            />
          </label>
        </div>
      </SidePanel>
    </main>
  );
}
