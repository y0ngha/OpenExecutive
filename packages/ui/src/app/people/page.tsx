"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { useAskOEFormContext } from "@/components/askoe/AskOEContext";
import { TeamModeOffer } from "@/components/people/TeamModeOffer";
import Button from "@/components/ui/Button";
import SectionTabs, { sectionPanelProps } from "@/components/ui/SectionTabs";
import SidePanel from "@/components/ui/SidePanel";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { t, tp, type MessageKey } from "@/i18n/index.ts";
import {
  createPerson,
  getPeopleViewer,
  listPeople,
  type PageFormField,
  type Person,
  type PersonKind,
} from "@/lib/api";
import {
  defaultKindForTab,
  defaultPeopleTab,
  effectiveKind,
  hiddenTeamCount,
  isContact,
  peopleForTab,
  personCardStatus,
  shouldOfferTeamMode,
  tabsFor,
  type PeopleTab,
} from "@/lib/peopleKinds";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Labels and hints are dictionary keys, looked up where they render.
const ALL_SCOPES: { value: string; label: MessageKey; hint: MessageKey }[] = [
  { value: "spend_lt_2k", label: "people.scope.spendLt2k", hint: "people.scope.spendLt2kHint" },
  { value: "spend_lt_10k", label: "people.scope.spendLt10k", hint: "people.scope.spendLt10kHint" },
  { value: "spend_gt_10k", label: "people.scope.spendGt10k", hint: "people.scope.spendGt10kHint" },
  { value: "hiring_signoff", label: "people.scope.hiring", hint: "people.scope.hiringHint" },
  { value: "vendor_onboarding", label: "people.scope.vendors", hint: "people.scope.vendorsHint" },
  { value: "customer_credit", label: "people.scope.credit", hint: "people.scope.creditHint" },
  { value: "legal_sign", label: "people.scope.legal", hint: "people.scope.legalHint" },
  { value: "board_comms", label: "people.scope.board", hint: "people.scope.boardHint" },
  { value: "meeting_scheduling", label: "people.scope.meetings", hint: "people.scope.meetingsHint" },
  { value: "wildcard", label: "people.scope.wildcard", hint: "people.scope.wildcardHint" },
];

const CHANNELS = ["any", "slack", "discord", "telegram", "email"];
const KINDS: PersonKind[] = ["team", "contact"];

// ---------------------------------------------------------------------------
// PersonCard — name, role, channel and one status. Approval scopes are on
// the person's own page.
// ---------------------------------------------------------------------------

const TONE_DOT = { ok: "bg-emerald-500", warn: "bg-amber-500", muted: "bg-fg-subtle" } as const;

function channelLabel(channel: string): string {
  return channel === "any" ? t("people.person.anyChannel") : channel.charAt(0).toUpperCase() + channel.slice(1);
}

// The raw channel values as the select shows them; brand names stay as-is.
function channelOption(channel: string): string {
  if (channel === "any") return t("people.channel.any");
  if (channel === "email") return t("people.channel.email");
  return channel;
}

function PersonCard({ person, today }: { person: Person; today: string }) {
  const contact = isContact(person);
  const status = personCardStatus(person, today);
  return (
    <Link
      href={`/people/${person.id}`}
      className="flex items-start gap-4 rounded-2xl border border-line bg-surface-elevated hover:bg-surface-hover hover:border-line-strong transition-colors p-5 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <div className="w-11 h-11 rounded-full bg-accent/10 text-accent flex items-center justify-center flex-shrink-0 text-base font-semibold">
        {person.full_name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-semibold text-fg group-hover:text-accent transition-colors truncate">
            {person.full_name}
          </span>
          {person.is_principal && (
            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-accent/10 text-accent">
              {t("people.person.principal")}
            </span>
          )}
        </div>
        <div className="text-[15px] text-fg-muted mt-0.5 truncate">{person.role || "—"}</div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
          {!contact && <span>{channelLabel(person.preferred_channel)}</span>}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONE_DOT[status.tone]}`} />
            {status.label}
          </span>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Add Person modal
// ---------------------------------------------------------------------------

interface AddPersonModalProps {
  initialKind: PersonKind;
  /** Contacts are the principal's alone: nobody else is offered the choice. */
  canAddContacts: boolean;
  onCreated: (p: Person) => void;
  onClose: () => void;
}

const BLANK_FORM = {
  full_name: "",
  role: "",
  kind: "team" as PersonKind,
  is_principal: false,
  email: "",
  slack_user_id: "",
  telegram_chat_id: "",
  discord_user_id: "",
  preferred_channel: "any",
  response_sla_hours: "24",
  authority_scope: [] as string[],
};

const INPUT_CLS =
  "w-full h-11 px-3 rounded-xl bg-surface-input/60 border border-line text-[15px] text-fg placeholder-fg-subtle focus:outline-none focus:border-accent";
const LABEL_CLS = "text-sm text-fg-muted flex flex-col gap-1.5";
const HINT_CLS = "text-[13px] text-fg-subtle mt-1";

function DisclosureSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-line pt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center justify-between w-full min-h-11 py-2 text-[15px] font-medium text-fg hover:text-accent transition-colors"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-fg-subtle text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="pt-2 pb-1 space-y-4">{children}</div>}
    </div>
  );
}

// The approval scopes as toggles, each with what it routes to the person.
function ScopePicker({ selected, onToggle }: { selected: string[]; onToggle: (value: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {ALL_SCOPES.map(({ value, label, hint }) => {
        const active = selected.includes(value);
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(value)}
            className={`px-3.5 py-2.5 rounded-xl border text-left transition-colors ${
              active
                ? "bg-accent/10 border-accent/60 text-fg"
                : "bg-surface-elevated border-line text-fg-muted hover:border-line-strong"
            }`}
          >
            <div className="text-[15px] font-medium">{t(label)}</div>
            <div className="text-[13px] leading-snug mt-0.5 text-fg-muted">{t(hint)}</div>
          </button>
        );
      })}
    </div>
  );
}

const SCOPE_VALUES = ALL_SCOPES.map((s) => s.value);

function AddPersonModal({ initialKind, canAddContacts, onCreated, onClose }: AddPersonModalProps) {
  const [form, setForm] = useState({ ...BLANK_FORM, kind: canAddContacts ? initialKind : "team" });
  const kind = effectiveKind(form.kind, form.is_principal);
  const contact = kind === "contact";
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showContact, setShowContact] = useState(false);
  const [showAuthority, setShowAuthority] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // After the panel has taken focus on open, so it remembers the button
    // that opened it (and returns focus there on close).
    const id = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Registered with Ask OE for the modal's lifetime — closing the modal
  // unregisters automatically (the hook's cleanup runs on unmount).
  const { suggestedCls, clearSuggested } = useAskOEFormContext({
    formId: "add_person",
    title: "Add person",
    description:
      "Adds a human the Executive coordinates with — a team member (can sign in, approve and be chased) or a contact (someone outside the team the Executive emails only when you ask). Authority scopes determine which proposals route to a team member for approval.",
    getFields: (): PageFormField[] => [
      { name: "full_name", label: "Full name", type: "text", value: form.full_name, required: true },
      ...(canAddContacts
        ? [{
            name: "kind",
            label: "Team member or contact",
            type: "select" as const,
            options: KINDS,
            value: form.kind,
            description: "team: works with you. contact: a client, contractor or advisor outside the team, private to you.",
          }]
        : []),
      { name: "role", label: contact ? "Role and company" : "Role", type: "text", value: form.role },
      {
        name: "is_principal",
        label: "This is me — Primary",
        type: "boolean",
        value: form.is_principal,
        description: "Marks the person as the primary decision-maker. Only for the user themselves.",
      },
      { name: "preferred_channel", label: "Preferred channel", type: "select", options: CHANNELS, value: form.preferred_channel },
      { name: "response_sla_hours", label: "Expected reply within (hours)", type: "number", value: Number(form.response_sla_hours) || 24 },
      { name: "email", label: "Email", type: "text", value: form.email },
      { name: "slack_user_id", label: "Slack user ID", type: "text", value: form.slack_user_id },
      { name: "discord_user_id", label: "Discord user ID", type: "text", value: form.discord_user_id },
      { name: "telegram_chat_id", label: "Telegram chat ID", type: "text", value: form.telegram_chat_id },
      {
        name: "authority_scope",
        label: "Approval authority",
        type: "json",
        value: form.authority_scope,
        description: `JSON array of scope tokens, each one of: ${SCOPE_VALUES.join(", ")}.`,
      },
    ],
    applyPatch: (values) => {
      const prior = { form, showContact, showAuthority };
      const applied: string[] = [];
      const skipped: string[] = [];
      const next = { ...form };
      for (const [key, raw] of Object.entries(values)) {
        switch (key) {
          case "full_name":
          case "role":
          case "email":
          case "slack_user_id":
          case "discord_user_id":
          case "telegram_chat_id":
            if (typeof raw !== "string") skipped.push(key);
            else { next[key] = raw; applied.push(key); }
            break;
          case "is_principal":
            if (typeof raw !== "boolean") skipped.push(key);
            else { next.is_principal = raw; applied.push(key); }
            break;
          case "kind":
            if (canAddContacts && (raw === "team" || raw === "contact")) { next.kind = raw; applied.push(key); }
            else skipped.push(key);
            break;
          case "preferred_channel":
            if (typeof raw === "string" && CHANNELS.includes(raw)) {
              next.preferred_channel = raw;
              applied.push(key);
            } else skipped.push(key);
            break;
          case "response_sla_hours": {
            const n = Number(raw);
            if (Number.isFinite(n) && n >= 1) {
              next.response_sla_hours = String(Math.round(n));
              applied.push(key);
            } else skipped.push(key);
            break;
          }
          case "authority_scope": {
            const arr = Array.isArray(raw)
              ? raw.filter((s): s is string => typeof s === "string" && SCOPE_VALUES.includes(s))
              : null;
            // Empty after filtering means no proposed scope was recognized —
            // skip rather than silently wiping every existing scope.
            if (arr !== null && arr.length > 0) { next.authority_scope = arr; applied.push(key); }
            else skipped.push(key);
            break;
          }
          default:
            skipped.push(key);
        }
      }
      setForm(next);
      // Open the disclosures so the suggested values are visible to review.
      if (applied.some((k) => ["slack_user_id", "discord_user_id", "telegram_chat_id", "preferred_channel", "response_sla_hours"].includes(k))) {
        setShowContact(true);
      }
      if (applied.includes("authority_scope")) setShowAuthority(true);
      return {
        applied,
        skipped,
        undo: () => {
          setForm(prior.form);
          setShowContact(prior.showContact);
          setShowAuthority(prior.showAuthority);
        },
      };
    },
  });

  function toggleScope(val: string) {
    setForm((f) => ({
      ...f,
      authority_scope: f.authority_scope.includes(val)
        ? f.authority_scope.filter((s) => s !== val)
        : [...f.authority_scope, val],
    }));
  }

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      const person = await createPerson({
        full_name: form.full_name.trim(),
        role: form.role.trim(),
        kind,
        is_principal: form.is_principal,
        email: form.email.trim() || null,
        slack_user_id: form.slack_user_id.trim() || null,
        telegram_chat_id: form.telegram_chat_id.trim() || null,
        discord_user_id: form.discord_user_id.trim() || null,
        preferred_channel: form.preferred_channel,
        response_sla_hours: Number(form.response_sla_hours) || 24,
        // A contact approves nothing; don't send scopes picked before switching.
        authority_scope: contact ? [] : form.authority_scope,
      });
      onCreated(person);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("people.dept.createFailed"));
    } finally {
      setSaving(false);
    }
  }

  const title = contact ? t("people.list.addContact") : t("people.list.addPerson");
  return (
    <SidePanel
      open
      onClose={saving ? () => {} : onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={saving || !form.full_name.trim()}
            onClick={submit}
            className="flex-1"
          >
            {saving ? t("people.dept.creating") : title}
          </Button>
          <Button disabled={saving} onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
        <div className="space-y-4">
          {canAddContacts && !form.is_principal && (
            <div role="radiogroup" aria-label={t("people.add.kindGroup")} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={form.kind === k}
                  onClick={() => { setForm((f) => ({ ...f, kind: k })); clearSuggested("kind"); }}
                  className={`px-4 py-3 rounded-xl border text-left transition-colors ${
                    form.kind === k
                      ? "bg-accent/10 border-accent/60 text-fg"
                      : "bg-surface-elevated border-line text-fg-muted hover:border-line-strong"
                  } ${suggestedCls("kind")}`}
                >
                  <div className="text-[15px] font-semibold">{k === "team" ? t("people.add.teamMember") : t("people.add.contact")}</div>
                  <div className="text-sm leading-snug mt-1 text-fg-muted">
                    {k === "team"
                      ? t("people.add.teamMemberHint")
                      : t("people.add.contactHint")}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Always-visible: the 10-second path */}
          <label className={LABEL_CLS}>
            {t("people.add.fullNameRequired")}
            <input
              ref={nameRef}
              value={form.full_name}
              onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, full_name: v })); clearSuggested("full_name"); }}
              className={`${INPUT_CLS} ${suggestedCls("full_name")}`}
              placeholder={t("people.add.namePlaceholder")}
            />
          </label>

          <label className={LABEL_CLS}>
            {contact ? t("people.add.roleAndCompany") : t("people.add.role")}
            <input
              value={form.role}
              onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, role: v })); clearSuggested("role"); }}
              className={`${INPUT_CLS} ${suggestedCls("role")}`}
              placeholder={contact ? t("people.add.contactRolePlaceholder") : t("people.add.rolePlaceholder")}
            />
          </label>

          <label className={LABEL_CLS}>
            {t("people.add.email")}
            <input
              type="email"
              value={form.email}
              onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, email: v })); clearSuggested("email"); }}
              className={`${INPUT_CLS} ${suggestedCls("email")}`}
              placeholder={contact ? "jordan@acme.example" : "sarah@example.com"}
            />
          </label>

          {!contact && (
          <label className="flex items-start gap-3 cursor-pointer select-none rounded-xl border border-line px-4 py-3">
            <input
              type="checkbox"
              checked={form.is_principal}
              onChange={(e) => {
                const checked = e.target.checked;
                setForm((f) => ({ ...f, is_principal: checked }));
                if (checked) setShowAuthority(true);
              }}
              className="mt-0.5 w-5 h-5 rounded accent-indigo-500 flex-shrink-0"
            />
            <span>
              <span className="block text-[15px] font-medium text-fg">{t("people.add.thisIsMe")}</span>
              <span className="block text-sm text-fg-muted">{t("people.add.thisIsMeHint")}</span>
            </span>
          </label>
          )}

          {/* Contact & routing */}
          <DisclosureSection
            label={contact ? t("people.add.chatIds") : t("people.add.contactRouting")}
            open={showContact}
            onToggle={() => setShowContact((v) => !v)}
          >
            {!contact && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLS}>
                  {t("people.add.preferredChannel")}
                  <select
                    value={form.preferred_channel}
                    onChange={(e) => setForm((f) => ({ ...f, preferred_channel: e.target.value }))}
                    className={INPUT_CLS}
                  >
                    {CHANNELS.map((c) => (
                      <option key={c} value={c}>{channelOption(c)}</option>
                    ))}
                  </select>
                </label>
                <p className={HINT_CLS}>
                  {t("people.add.sentVia", {
                    channel: form.preferred_channel === "any" ? t("people.add.anyAvailableChannel") : form.preferred_channel,
                  })}
                </p>
              </div>
              <div>
                <label className={LABEL_CLS}>
                  {t("people.add.expectedReply")}
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={form.response_sla_hours}
                      onChange={(e) => setForm((f) => ({ ...f, response_sla_hours: e.target.value }))}
                      className={`${INPUT_CLS} flex-1 min-w-0`}
                    />
                    <span className="text-sm text-fg-muted flex-shrink-0">{t("people.add.hours")}</span>
                  </div>
                </label>
                <p className={HINT_CLS}>
                  {t("people.add.overdueHint", { n: form.response_sla_hours || 24 })}
                </p>
              </div>
            </div>
            )}

            <label className={LABEL_CLS}>
              {t("people.add.slackUserId")}
              <input
                value={form.slack_user_id}
                onChange={(e) => setForm((f) => ({ ...f, slack_user_id: e.target.value }))}
                className={INPUT_CLS}
                placeholder="U01ABC123"
              />
            </label>

            <label className={LABEL_CLS}>
              {t("people.add.discordUserId")}
              <input
                value={form.discord_user_id}
                onChange={(e) => setForm((f) => ({ ...f, discord_user_id: e.target.value }))}
                className={INPUT_CLS}
                placeholder="123456789012345678"
              />
              <span className={HINT_CLS}>
                {t("people.add.discordHint")}
              </span>
            </label>

            <label className={LABEL_CLS}>
              {t("people.dept.telegramChatId")}
              <input
                value={form.telegram_chat_id}
                onChange={(e) => setForm((f) => ({ ...f, telegram_chat_id: e.target.value }))}
                className={INPUT_CLS}
                placeholder="123456789"
              />
            </label>
          </DisclosureSection>

          {/* Approval authority — a contact approves nothing */}
          {!contact && (
          <DisclosureSection
            label={t("people.add.approvalAuthority")}
            open={showAuthority}
            onToggle={() => setShowAuthority((v) => !v)}
          >
            <div className="text-sm text-fg-muted">{t("people.add.whatApproves")}</div>
            <ScopePicker selected={form.authority_scope} onToggle={toggleScope} />
          </DisclosureSection>
          )}

        </div>

        {err && <p className="text-sm text-rose-500 mt-4">{err}</p>}
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TAB_COPY: Record<PeopleTab, { label: MessageKey; blurb: MessageKey; empty: MessageKey; add: MessageKey }> = {
  team: {
    label: "people.list.team",
    blurb: "people.list.teamBlurb",
    empty: "people.list.teamEmpty",
    add: "people.list.addPerson",
  },
  contacts: {
    label: "people.list.contacts",
    blurb: "people.list.contactsBlurb",
    empty: "people.list.contactsEmpty",
    add: "people.list.addContact",
  },
};

export default function PeoplePage() {
  const { mode, loading: workspaceLoading } = useWorkspace();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [tab, setTab] = useState<PeopleTab | null>(null);
  const [offerFor, setOfferFor] = useState<string | null>(null);
  // Contacts are private to the principal. Until the viewer is known (or if
  // the check fails) nobody is offered them; the API enforces it regardless.
  const [viewerIsPrincipal, setViewerIsPrincipal] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(true);

  const tabs = tabsFor(viewerIsPrincipal);
  // Open on the mode's default tab once the mode is known; a tab the user
  // picked is kept from then on (and never one this viewer is not offered).
  const activeTab: PeopleTab =
    tab !== null && tabs.includes(tab) ? tab : defaultPeopleTab(mode, viewerIsPrincipal);

  function refresh() {
    setLoading(true);
    listPeople({ includeContacts: true })
      .then(setPeople)
      .catch((e) => setError(e instanceof Error ? e.message : t("people.dept.loadFailed")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
    getPeopleViewer()
      .then((v) => setViewerIsPrincipal(v.is_principal))
      .catch(() => setViewerIsPrincipal(false))
      .finally(() => setViewerLoading(false));
  }, []);

  const shown = peopleForTab(people, activeTab, mode);
  const hidden = activeTab === "team" ? hiddenTeamCount(people, mode) : 0;
  const copy = TAB_COPY[activeTab];
  const tabsId = useId();
  // Local date (YYYY-MM-DD) for "on leave until", sampled once per mount.
  const [today] = useState(() => new Date().toLocaleDateString("en-CA"));

  return (
    <div className="flex flex-col h-full bg-surface">
      {showAdd && (
        <AddPersonModal
          initialKind={defaultKindForTab(activeTab)}
          canAddContacts={viewerIsPrincipal}
          onCreated={(p) => {
            setPeople((prev) => [...prev, p]);
            setShowAdd(false);
            // Show the new row where it lives.
            setTab(isContact(p) ? "contacts" : "team");
            if (shouldOfferTeamMode(mode, p.kind ?? "team", p.is_principal)) setOfferFor(p.full_name);
          }}
          onClose={() => setShowAdd(false)}
        />
      )}
      {offerFor && <TeamModeOffer name={offerFor} onDone={() => setOfferFor(null)} />}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg">{t("people.list.title")}</h1>
              <p className="text-[15px] text-fg-muted mt-2 max-w-2xl">{t(copy.blurb)}</p>
            </div>
            <Button variant="primary" onClick={() => setShowAdd(true)} className="flex-shrink-0 self-start">
              {t(copy.add)}
            </Button>
          </div>

          {tabs.length > 1 && (
            <div className="mb-6">
              <SectionTabs
                idBase={tabsId}
                label={t("people.list.tabsLabel")}
                active={activeTab}
                onChange={setTab}
                disabled={(workspaceLoading || viewerLoading) && tab === null}
                tabs={tabs.map((id) => ({
                  id,
                  label: t(TAB_COPY[id].label),
                  count: loading ? undefined : peopleForTab(people, id, mode).length,
                }))}
              />
            </div>
          )}

          <div {...(tabs.length > 1 ? sectionPanelProps(tabsId, activeTab) : {})}>
          {loading && <p className="text-fg-muted text-[15px]">{t("common.loading")}</p>}
          {error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[15px] mb-4">
              {error}
            </div>
          )}
          {!loading && !error && shown.length === 0 && (
            <div className="rounded-2xl border border-line bg-surface-elevated p-10 text-center">
              <p className="text-fg-muted text-[15px] mb-5">{t(copy.empty)}</p>
              <Button variant="primary" onClick={() => setShowAdd(true)}>
                {activeTab === "contacts" ? t("people.list.addFirstContact") : t("people.list.addFirstPerson")}
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {shown.map((person) => (
              <PersonCard key={person.id} person={person} today={today} />
            ))}
          </div>

          {hidden > 0 && (
            <p className="text-sm text-fg-muted mt-5">
              {tp("people.list.hiddenTeam", hidden)}
            </p>
          )}
          </div>
        </div>
      </main>
    </div>
  );
}
