"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button, { buttonClass } from "@/components/ui/Button";
import OverflowMenu from "@/components/ui/OverflowMenu";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  SKILL_CATEGORIES,
  approveSkillDraft,
  createSkill,
  deleteSkill,
  discardSkillDraft,
  getSkill,
  getSkillDraft,
  listSkillDrafts,
  listSkills,
  restoreSkill,
  searchSkills,
  updateSkill,
  type SkillDeleteOutcome,
  type SkillDraft,
  type SkillDetail,
  type SkillInput,
  type SkillMeta,
  type SkillSearchHit,
} from "@/lib/api";
import { t, displayLocale, type MessageKey } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";
import { domainLabel } from "@/components/knowledge/SourceTree";

// Playbooks are the UI name for the backend's "skills": how the Executive
// does a piece of work. Workflows (the other tabs) are the runnable jobs.

const NAME_RE = /^[a-zA-Z0-9_-]+$/;

const DELETE_NOTICE: Record<SkillDeleteOutcome, (name: string) => string> = {
  deleted: (n) => t("jobs.playbooks.noticeDeleted", { name: n }),
  reverted: (n) => t("jobs.playbooks.noticeReverted", { name: n }),
  hidden: (n) => t("jobs.playbooks.noticeHidden", { name: n }),
};

interface EditorState {
  /** Remounts the form, so "+ New playbook" always starts blank. */
  id: number;
  mode: "create" | "edit";
  /** Editing a built-in: saving creates this company's customized copy. */
  customizing: boolean;
  initial: SkillInput;
  /** Editing a chat draft: a successful save also clears that version of it. */
  fromDraft?: { name: string; id: string };
}

const DRAFT_ACTION_LABEL: Record<SkillDraft["action"], MessageKey> = {
  create: "jobs.playbooks.draftActionCreate",
  update: "jobs.playbooks.draftActionUpdate",
  delete: "jobs.playbooks.draftActionDelete",
};

function draftInput(d: SkillDraft): SkillInput {
  return {
    name: d.name,
    category: d.category,
    description: d.description,
    when_to_use: d.when_to_use,
    body: d.body,
  };
}

const EMPTY_INPUT: SkillInput = {
  name: "",
  category: "general",
  description: "",
  when_to_use: "",
  body: "",
};

function toInput(s: SkillDetail): SkillInput {
  return {
    name: s.name,
    category: s.category,
    description: s.description,
    when_to_use: s.when_to_use,
    body: s.body,
  };
}

function groupByCategory(items: SkillMeta[]): Record<string, SkillMeta[]> {
  return items.reduce<Record<string, SkillMeta[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});
}

/** "The MBR workflow" / "The Board prep and MBR workflows", or "" when none follow it. */
function workflowList(skill: SkillMeta): string {
  const titles = skill.used_by.map((w) => w.title);
  if (titles.length === 0) return "";
  if (titles.length === 1) return t("jobs.playbooks.workflowListOne", { title: titles[0] });
  return t("jobs.playbooks.workflowListMany", {
    titles: titles.slice(0, -1).join(", "),
    last: titles[titles.length - 1],
  });
}

function tryInChatHref(name: string): string {
  const draft = t("jobs.playbooks.tryInChatDraft", { name });
  return `/?new=1&draft=${encodeURIComponent(draft)}`;
}

export default function PlaybooksBrowser({
  onCountChange,
  initialPlaybook,
  initialDraft,
}: {
  onCountChange?: (count: number) => void;
  /** Playbook to open on mount (from a `?playbook=` link). */
  initialPlaybook?: string;
  /** Chat draft to open on mount (from a `?draft=` link). */
  initialDraft?: string;
}) {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<SkillDetail | null>(null);
  const [drafts, setDrafts] = useState<SkillDraft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<SkillDraft | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SkillSearchHit[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  // The query behind the shown results (null = no results shown). A ref, so
  // a mutation that finishes later refreshes the search the user has *now*,
  // not the one captured when it started.
  const submittedQueryRef = useRef<string | null>(null);
  const [editorSeq, setEditorSeq] = useState(0);

  function openEditor(state: Omit<EditorState, "id">) {
    const id = editorSeq + 1;
    setEditorSeq(id);
    setEditor({ ...state, id });
  }

  const load = useCallback(async () => {
    try {
      const [data, pending] = await Promise.all([
        listSkills(showHidden),
        // The review strip is optional; never fail the tab over it.
        listSkillDrafts().catch(() => null),
      ]);
      setSkills(data);
      if (pending) {
        setDrafts(pending);
        // Drop an open draft that was approved, discarded or replaced.
        setSelectedDraft((cur) =>
          cur && pending.some((d) => d.name === cur.name && d.id === cur.id) ? cur : null
        );
      }
      onCountChange?.(data.filter((s) => !s.hidden).length);
    } catch {
      setError(t("jobs.playbooks.loadFailed"));
    }
  }, [showHidden, onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  const openedInitialRef = useRef(false);
  useEffect(() => {
    if (!initialPlaybook || openedInitialRef.current) return;
    openedInitialRef.current = true;
    void select(initialPlaybook);
    // select() only reads setters; runs once, for the link's playbook.
  }, [initialPlaybook]);

  const openedDraftRef = useRef(false);
  useEffect(() => {
    if (!initialDraft || openedDraftRef.current) return;
    openedDraftRef.current = true;
    void selectDraft(initialDraft);
  }, [initialDraft]);

  // Last selection wins: a slow response for an earlier click is dropped.
  const selectSeqRef = useRef(0);

  async function selectDraft(name: string) {
    const seq = ++selectSeqRef.current;
    setError(null);
    setNotice(null);
    setEditor(null);
    setSelected(null);
    try {
      const draft = await getSkillDraft(name);
      if (seq === selectSeqRef.current) setSelectedDraft(draft);
    } catch (e) {
      if (seq !== selectSeqRef.current) return;
      setSelectedDraft(null);
      setError(
        e instanceof Error
          ? t("jobs.playbooks.draftLoadError", { error: e.message })
          : t("jobs.playbooks.draftLoadFailed")
      );
    }
  }

  function handleApproveDraft(draft: SkillDraft) {
    if (
      draft.action === "delete" &&
      !confirm(t("jobs.playbooks.confirmDeleteDraft", { name: draft.name }))
    )
      return;
    void run(async () => {
      const result = await approveSkillDraft(draft.name, draft.id);
      setSelectedDraft(null);
      setSelected(result.skill);
      setNotice(
        draft.action === "delete"
          ? t("jobs.playbooks.noticeDeleted", { name: draft.name })
          : draft.action === "create"
            ? t("jobs.playbooks.noticeAdded", { name: draft.name })
            : t("jobs.playbooks.noticeApplied", { name: draft.name })
      );
    });
  }

  function handleDiscardDraft(draft: SkillDraft) {
    void run(async () => {
      await discardSkillDraft(draft.name, draft.id);
      setSelectedDraft(null);
      setNotice(t("jobs.playbooks.noticeDiscarded", { name: draft.name }));
    });
  }

  async function select(name: string) {
    const seq = ++selectSeqRef.current;
    setError(null);
    setNotice(null);
    setEditor(null);
    setSelectedDraft(null);
    try {
      const skill = await getSkill(name);
      if (seq === selectSeqRef.current) setSelected(skill);
    } catch (e) {
      if (seq !== selectSeqRef.current) return;
      setError(e instanceof Error ? e.message : t("jobs.playbooks.loadOneFailed"));
    }
  }

  /** Run a mutation, then reload the list (and any search) even if it failed. */
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jobs.playbooks.genericError"));
    } finally {
      await load();
      const q = submittedQueryRef.current;
      if (q) {
        const hits = await searchSkills(q, 10).catch(() => []);
        if (submittedQueryRef.current === q) setSearchHits(hits);
      }
      setBusy(false);
    }
  }

  function handleDelete(skill: SkillDetail) {
    const workflows = workflowList(skill);
    // A custom workflow re-checks its playbook on every save.
    const resave = skill.used_by.some((w) => w.is_custom)
      ? t("jobs.playbooks.confirmResave")
      : "";
    const prompt = skill.customized
      ? t("jobs.playbooks.confirmRevert", { name: skill.name }) +
        (workflows ? t("jobs.playbooks.confirmRevertFollowers", { workflows }) : "")
      : skill.source === "builtin"
        ? t("jobs.playbooks.confirmHide", { name: skill.name }) +
          (workflows ? t("jobs.playbooks.confirmHideFollowers", { workflows }) : "") +
          resave
        : t("jobs.playbooks.confirmDelete", { name: skill.name }) +
          (workflows ? t("jobs.playbooks.confirmDeleteFollowers", { workflows }) : "") +
          resave;
    if (!confirm(prompt)) return;
    void run(async () => {
      const outcome = await deleteSkill(skill.name);
      setNotice(DELETE_NOTICE[outcome](skill.name));
      if (outcome === "reverted") setSelected(await getSkill(skill.name));
      else if (outcome === "hidden" && showHidden) setSelected(await getSkill(skill.name));
      else setSelected(null);
    });
  }

  function handleRestore(skill: SkillDetail) {
    void run(async () => {
      setSelected(await restoreSkill(skill.name));
      setNotice(t("jobs.playbooks.noticeRestored", { name: skill.name }));
    });
  }

  function handleSave(input: SkillInput) {
    if (!editor) return;
    const { mode, customizing, fromDraft } = editor;
    void run(async () => {
      const saved = mode === "create" ? await createSkill(input) : await updateSkill(input);
      // The save already succeeded; if the draft is gone or was replaced by
      // a newer proposal, leave that alone rather than report an error.
      if (fromDraft) await discardSkillDraft(fromDraft.name, fromDraft.id).catch(() => undefined);
      setEditor(null);
      setSelectedDraft(null);
      setSelected(saved);
      setNotice(
        customizing
          ? t("jobs.playbooks.noticeSavedCustom", { name: saved.name })
          : t("jobs.playbooks.noticeSaved", { name: saved.name })
      );
    });
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    submittedQueryRef.current = q || null;
    if (!q) {
      setSearchHits(null);
      return;
    }
    setIsSearching(true);
    setError(null);
    try {
      const hits = await searchSkills(q, 10);
      if (submittedQueryRef.current === q) setSearchHits(hits);
    } catch {
      setError(t("jobs.playbooks.searchFailed"));
    } finally {
      setIsSearching(false);
    }
  }

  const yours = skills.filter((s) => s.source === "company" && !s.customized);
  const builtin = skills.filter(
    (s) => (s.source === "builtin" && !s.hidden) || s.customized
  );
  const hidden = skills.filter((s) => s.hidden);

  return (
    <div>
      <p className="mb-5 text-[15px] text-fg-muted max-w-3xl">
        {tRich("jobs.playbooks.intro", {
          how: <span className="text-fg">{t("jobs.playbooks.introHow")}</span>,
        })}
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form onSubmit={handleSearch} className="flex flex-1 min-w-0 basis-full sm:basis-auto gap-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("jobs.playbooks.searchPlaceholder")}
            aria-label={t("jobs.playbooks.searchAria")}
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-elevated px-4 text-[15px] text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <Button type="submit" disabled={isSearching}>
            {isSearching ? t("jobs.common.searching") : t("common.search")}
          </Button>
          {searchHits !== null && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearchQuery("");
                setSearchHits(null);
                submittedQueryRef.current = null;
              }}
            >
              {t("jobs.playbooks.clear")}
            </Button>
          )}
        </form>
        <Button
          variant="primary"
          className="shrink-0"
          onClick={() => {
            setSelected(null);
            setNotice(null);
            openEditor({ mode: "create", customizing: false, initial: EMPTY_INPUT });
          }}
        >
          {t("jobs.playbooks.newButton")}
        </Button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5">
          {notice}
        </p>
      )}

      <div className="flex flex-col md:flex-row gap-6">
        <div className="md:w-64 flex-shrink-0 space-y-5">
          {searchHits !== null ? (
            <div>
              <SectionLabel>{t("jobs.playbooks.results")}</SectionLabel>
              {searchHits.length === 0 ? (
                <p className="text-xs text-fg-subtle px-1">{t("jobs.playbooks.noMatches")}</p>
              ) : (
                searchHits.map((hit) => (
                  <ListButton
                    key={`${hit.source}::${hit.name}`}
                    active={selected?.name === hit.name}
                    onClick={() => select(hit.name)}
                  >
                    <span className="truncate">{hit.name}</span>
                    <span className="text-[10px] text-fg-subtle flex-shrink-0">
                      {hit.score.toFixed(2)}
                    </span>
                  </ListButton>
                ))
              )}
            </div>
          ) : (
            <>
              {drafts.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                  <SectionLabel>{t("jobs.playbooks.toReview", { n: drafts.length })}</SectionLabel>
                  <p className="text-[11px] text-fg-subtle px-1 mb-1">
                    {t("jobs.playbooks.toReviewHint")}
                  </p>
                  {drafts.map((d) => (
                    <ListButton
                      key={d.name}
                      active={selectedDraft?.name === d.name}
                      onClick={() => selectDraft(d.name)}
                    >
                      <span className="truncate">{d.name}</span>
                      <span className="text-[10px] text-amber-400 flex-shrink-0">
                        {t(DRAFT_ACTION_LABEL[d.action])}
                      </span>
                    </ListButton>
                  ))}
                </div>
              )}
              <PlaybookSection
                title={t("jobs.playbooks.yours")}
                items={yours}
                selectedName={selected?.name}
                onSelect={select}
                emptyMessage={t("jobs.playbooks.yoursEmpty")}
              />
              <PlaybookSection
                title={t("jobs.playbooks.builtin")}
                items={builtin}
                selectedName={selected?.name}
                onSelect={select}
              />
              {showHidden && (
                <PlaybookSection
                  title={t("jobs.playbooks.hidden")}
                  items={hidden}
                  selectedName={selected?.name}
                  onSelect={select}
                  emptyMessage={t("jobs.playbooks.hiddenEmpty")}
                />
              )}
              <label className="flex min-h-10 items-center gap-2 px-1 text-sm text-fg-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />
                {t("jobs.playbooks.showHidden")}
              </label>
            </>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {editor ? (
            <PlaybookEditor
              key={editor.id}
              editor={editor}
              busy={busy}
              onCancel={() => setEditor(null)}
              onSave={handleSave}
            />
          ) : selectedDraft ? (
            <DraftView
              draft={selectedDraft}
              busy={busy}
              onApprove={() => handleApproveDraft(selectedDraft)}
              onDiscard={() => handleDiscardDraft(selectedDraft)}
              onEdit={() =>
                openEditor({
                  mode: selectedDraft.action === "create" ? "create" : "edit",
                  customizing: false,
                  initial: draftInput(selectedDraft),
                  fromDraft: { name: selectedDraft.name, id: selectedDraft.id },
                })
              }
            />
          ) : selected ? (
            <PlaybookView
              skill={selected}
              busy={busy}
              onEdit={() =>
                openEditor({
                  mode: "edit",
                  customizing: selected.source === "builtin",
                  initial: toInput(selected),
                })
              }
              onDelete={() => handleDelete(selected)}
              onRestore={() => handleRestore(selected)}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-fg-subtle text-sm">
              {t("jobs.playbooks.selectPrompt")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest mb-1.5 px-1">
      {children}
    </p>
  );
}

function ListButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full min-h-10 text-left px-3 py-2 rounded-xl text-[15px] transition-colors flex items-center justify-between gap-2 ${
        active
          ? "bg-accent/10 text-accent font-medium"
          : "text-fg-muted hover:text-fg hover:bg-surface-overlay"
      }`}
    >
      {children}
    </button>
  );
}

function PlaybookSection({
  title,
  items,
  selectedName,
  onSelect,
  emptyMessage,
}: {
  title: string;
  items: SkillMeta[];
  selectedName: string | undefined;
  onSelect: (name: string) => void;
  emptyMessage?: string;
}) {
  const grouped = groupByCategory(items);
  const categories = Object.keys(grouped).sort();
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      {categories.length === 0 ? (
        <p className="text-xs text-fg-subtle px-1">{emptyMessage ?? t("common.none")}</p>
      ) : (
        categories.map((cat) => (
          <div key={cat} className="mb-3">
            <p className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider mb-0.5 px-1">
              {domainLabel(cat)}
            </p>
            {grouped[cat].map((s) => (
              <ListButton
                key={s.name}
                active={selectedName === s.name}
                onClick={() => onSelect(s.name)}
              >
                <span className="truncate">{s.name}</span>
                {s.customized && (
                  <span className="text-[10px] text-indigo-400 flex-shrink-0">{t("jobs.playbooks.edited")}</span>
                )}
              </ListButton>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function sourceLabel(skill: SkillMeta): string {
  if (skill.hidden) return t("jobs.playbooks.sourceHidden");
  if (skill.customized) return t("jobs.playbooks.sourceCustomized");
  return skill.source === "builtin" ? t("jobs.playbooks.sourceBuiltin") : t("jobs.playbooks.sourceYours");
}

function PlaybookView({
  skill,
  busy,
  onEdit,
  onDelete,
  onRestore,
}: {
  skill: SkillDetail;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const deleteLabel = skill.customized
    ? t("jobs.playbooks.revertToBuiltin")
    : skill.source === "builtin"
      ? t("jobs.playbooks.hide")
      : t("common.delete");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">
              {domainLabel(skill.category)}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-fg-subtle px-2 py-0.5 border border-line rounded">
              {sourceLabel(skill)}
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-fg mt-1 break-words">{skill.name}</h2>
          <p className="text-[15px] text-fg-muted mt-1">{skill.description}</p>
          <p className="text-sm text-fg-muted italic mt-1">{t("jobs.playbooks.whenToUseLine", { text: skill.when_to_use })}</p>
          {skill.used_by.length > 0 && (
            <p className="text-sm text-fg-muted mt-1">
              {tRich(
                skill.used_by.length === 1
                  ? "jobs.playbooks.followedByOne"
                  : "jobs.playbooks.followedByOther",
                {
                  links: skill.used_by.map((w, i) => (
                    <span key={w.name}>
                      {i > 0 && ", "}
                      <Link href={`/jobs/${encodeURIComponent(w.name)}`} className="text-indigo-400 hover:underline">
                        {w.title}
                      </Link>
                    </span>
                  )),
                  custom: skill.source === "builtin" ? t("jobs.playbooks.orCustomCopy") : "",
                }
              )}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {skill.hidden ? (
            <Button variant="primary" disabled={busy} onClick={onRestore}>
              {t("jobs.playbooks.restore")}
            </Button>
          ) : (
            <>
              <Button variant="primary" disabled={busy} onClick={onEdit}>
                {skill.source === "builtin" ? t("jobs.playbooks.customize") : t("common.edit")}
              </Button>
              <Link href={tryInChatHref(skill.name)} className={buttonClass("secondary", "md")}>
                {t("jobs.playbooks.tryInChat")}
              </Link>
              <OverflowMenu
                label={t("jobs.playbooks.moreFor", { name: skill.name })}
                items={[{ label: deleteLabel, danger: true, disabled: busy, onSelect: onDelete }]}
              />
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-line-strong bg-surface-elevated px-6 py-5 max-h-[520px] overflow-y-auto prose prose-invert prose-sm max-w-none
        prose-p:text-fg prose-p:leading-relaxed
        prose-headings:text-fg prose-headings:font-semibold
        prose-strong:text-fg prose-strong:font-semibold
        prose-code:text-accent prose-code:bg-surface-overlay prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-surface-overlay prose-pre:border prose-pre:border-line-strong
        prose-blockquote:border-line-strong prose-blockquote:text-fg-muted
        prose-ul:text-fg prose-ol:text-fg
        prose-li:marker:text-fg-muted
        prose-hr:border-line-strong
        prose-a:text-accent prose-a:no-underline hover:prose-a:underline
        prose-table:text-fg prose-th:text-fg prose-th:border-line-strong prose-td:border-line-strong">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{skill.body}</ReactMarkdown>
      </div>
    </div>
  );
}

const MARKDOWN_BOX =
  "rounded-xl border border-line-strong bg-surface-elevated px-6 py-5 max-h-[420px] overflow-y-auto prose prose-invert prose-sm max-w-none prose-p:text-fg prose-headings:text-fg prose-strong:text-fg prose-ul:text-fg prose-ol:text-fg prose-li:marker:text-fg-muted prose-code:text-accent prose-a:text-accent";

function DraftView({
  draft,
  busy,
  onApprove,
  onDiscard,
  onEdit,
}: {
  draft: SkillDraft;
  busy: boolean;
  onApprove: () => void;
  onDiscard: () => void;
  onEdit: () => void;
}) {
  const heading =
    draft.action === "create"
      ? t("jobs.playbooks.newPlaybook")
      : draft.action === "update"
        ? t("jobs.playbooks.headingUpdate")
        : t("jobs.playbooks.headingDelete");
  const followers = draft.followers;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-amber-400 px-2 py-0.5 border border-amber-500/30 rounded">
            {t("jobs.playbooks.proposedBy", { heading })}
          </span>
          <h2 className="text-xl font-bold tracking-tight text-fg mt-2 break-words">{draft.name}</h2>
          {draft.action !== "delete" && (
            <>
              <p className="text-[15px] text-fg-muted mt-1">{draft.description}</p>
              <p className="text-sm text-fg-muted italic mt-1">
                {t("jobs.playbooks.whenToUseCategory", { text: draft.when_to_use, category: domainLabel(draft.category) })}
              </p>
            </>
          )}
          <p className="text-xs text-fg-subtle mt-1">
            {t("jobs.playbooks.proposedAt", {
              when: new Date(draft.proposed_at).toLocaleString(displayLocale()),
            })}
          </p>
          {followers.length > 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-300 mt-1">
              {t(
                followers.length === 1
                  ? "jobs.playbooks.draftFollowersOne"
                  : "jobs.playbooks.draftFollowersOther",
                { titles: followers.map((w) => w.title).join(", ") }
              )}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy} onClick={onApprove}>
            {draft.action === "delete" ? t("jobs.playbooks.approveDelete") : t("common.approve")}
          </Button>
          {draft.action !== "delete" && (
            <Button disabled={busy} onClick={onEdit}>
              {t("jobs.playbooks.editThenSave")}
            </Button>
          )}
          <OverflowMenu
            label={t("jobs.playbooks.moreFor", { name: draft.name })}
            items={[{ label: t("jobs.playbooks.discardProposal"), danger: true, disabled: busy, onSelect: onDiscard }]}
          />
        </div>
      </div>

      {draft.action !== "delete" && (
        <div className={MARKDOWN_BOX}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.body}</ReactMarkdown>
        </div>
      )}
      {draft.current && (
        <details open={draft.action === "delete"} className="text-sm">
          <summary className="cursor-pointer text-xs text-fg-muted">
            {draft.action === "delete" ? t("jobs.playbooks.wouldDelete") : t("jobs.playbooks.currentVersion")}
          </summary>
          <div className={`${MARKDOWN_BOX} mt-2`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.current.body}</ReactMarkdown>
          </div>
        </details>
      )}
    </div>
  );
}

function PlaybookEditor({
  editor,
  busy,
  onCancel,
  onSave,
}: {
  editor: EditorState;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: SkillInput) => void;
}) {
  const [form, setForm] = useState<SkillInput>(editor.initial);
  const set = (k: keyof SkillInput) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const nameOk = NAME_RE.test(form.name);
  const complete =
    nameOk &&
    form.description.trim() !== "" &&
    form.when_to_use.trim() !== "" &&
    form.body.trim() !== "";

  const input =
    "w-full rounded-xl border border-line bg-surface-elevated px-3.5 py-2.5 text-[15px] text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40";

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete) onSave(form);
      }}
    >
      <h2 className="text-xl font-bold tracking-tight text-fg">
        {editor.mode === "create"
          ? t("jobs.playbooks.newPlaybook")
          : editor.customizing
            ? t("jobs.playbooks.customizeTitle", { name: form.name })
            : t("jobs.playbooks.editTitle", { name: form.name })}
      </h2>
      {editor.customizing && (
        <p className="text-xs text-fg-muted">
          {t("jobs.playbooks.customizeHint")}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t("jobs.playbooks.fieldName")} hint={t("jobs.playbooks.fieldNameHint")}>
          <input
            value={form.name}
            disabled={editor.mode === "edit"}
            onChange={(e) => set("name")(e.target.value.trim())}
            placeholder="monthly-revenue-review"
            className={`${input} disabled:opacity-60`}
          />
          {form.name !== "" && !nameOk && (
            <span className="text-[11px] text-red-400">{t("jobs.playbooks.fieldNameInvalid")}</span>
          )}
        </Field>
        <Field label={t("jobs.playbooks.fieldCategory")}>
          <select
            value={form.category}
            onChange={(e) => set("category")(e.target.value)}
            className={input}
          >
            {SKILL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {domainLabel(c)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t("jobs.playbooks.fieldDescription")} hint={t("jobs.playbooks.fieldDescriptionHint")}>
        <input
          value={form.description}
          onChange={(e) => set("description")(e.target.value)}
          className={input}
        />
      </Field>
      <Field
        label={t("jobs.playbooks.fieldWhenToUse")}
        hint={t("jobs.playbooks.fieldWhenToUseHint")}
      >
        <input
          value={form.when_to_use}
          onChange={(e) => set("when_to_use")(e.target.value)}
          className={input}
        />
      </Field>
      <Field label={t("jobs.playbooks.fieldSteps")} hint={t("jobs.playbooks.fieldStepsHint")}>
        <textarea
          value={form.body}
          onChange={(e) => set("body")(e.target.value)}
          rows={18}
          className={`${input} font-mono text-xs leading-relaxed`}
        />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!complete || busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}
