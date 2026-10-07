"use client";

// A roster request on the briefing: someone not on the People list wrote in,
// was told their message arrived, and is held until the principal says who
// they are. Answered here (never through chat): "Add them" opens a side
// panel to add them as a new person or say they are someone already on the
// list; Ignore is in the card's ⋯ menu. Their held messages are answered
// once they are added.

import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import OverflowMenu from "@/components/ui/OverflowMenu";
import SidePanel from "@/components/ui/SidePanel";
import { t, tp } from "@/i18n/index.ts";
import {
  approveRosterRequest,
  declineRosterRequest,
  listPeople,
  type Person,
  type PersonKind,
  type RosterRequestCard as RosterRequest,
} from "@/lib/api";

// Brand names; "email" is translated where it is read.
const CHANNEL_LABEL: Record<string, string> = {
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
};

type Mode = "new" | "link";

export default function RosterRequestCard({
  request,
  onResolved,
  emphasized = false,
}: {
  request: RosterRequest;
  // Called once the request is answered, so the briefing can drop the card.
  onResolved: () => void;
  emphasized?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(request.suggested_person_id != null ? "link" : "new");
  const [name, setName] = useState(request.display_name);
  // No default for a stranger: the principal says team or contact. A sender
  // on the company's own domain is pre-filled as a teammate.
  const [kind, setKind] = useState<PersonKind | "">(request.suggested_kind ?? "");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [linkId, setLinkId] = useState<number | "">(request.suggested_person_id ?? "");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The answer (add new / link to someone listed) is given in a side panel.
  const [panelOpen, setPanelOpen] = useState(false);

  const channel =
    request.channel === "email" ? t("briefing.roster.email") : (CHANNEL_LABEL[request.channel] ?? request.channel);
  const isChat = request.channel !== "email";

  // The picker's list, fetched the first time "someone already on the list"
  // is chosen.
  useEffect(() => {
    if (mode !== "link" || people !== null) return;
    let live = true;
    listPeople({ includeContacts: true })
      .then((list) => live && setPeople(list))
      .catch(() => live && setPeople([]));
    return () => {
      live = false;
    };
  }, [mode, people]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const canAdd = mode === "new" ? name.trim() !== "" && kind !== "" : linkId !== "";

  function approve() {
    if (!canAdd) return;
    void run(() =>
      mode === "new"
        ? approveRosterRequest(request.id, { full_name: name.trim(), kind: kind as PersonKind })
        : approveRosterRequest(request.id, {
            link_person_id: Number(linkId),
            replace_channel_id: replace,
          }),
    );
  }

  const ignore = () => void run(() => declineRosterRequest(request.id));
  const title = request.display_name
    ? t("briefing.roster.whoIs", { name: request.display_name })
    : t("briefing.roster.someoneNew");
  const fieldClass =
    "min-h-[44px] rounded-xl border border-line bg-surface px-3 text-[15px] text-fg focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50";

  return (
    <div
      className={`rounded-2xl border bg-surface-elevated p-4 sm:p-5 ${
        emphasized ? "border-accent/60 ring-1 ring-accent/25 shadow-sm" : "border-line"
      }`}
    >
      <div className="text-base sm:text-[17px] font-semibold leading-snug text-fg break-words">{title}</div>
      <div className="mt-1 text-sm text-fg-muted break-all">
        {channel} · {request.channel_ref}
        {request.profile_email ? ` · ${request.profile_email}` : ""}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-lg bg-surface-overlay px-2 py-0.5 text-[13px] font-medium text-fg-muted">
          {t("briefing.roster.waitingCount", { n: request.message_count })}
        </span>
        {request.on_company_domain && (
          <span className="inline-flex items-center rounded-lg bg-emerald-500/15 px-2 py-0.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-300">
            {t("briefing.roster.yourDomain")}
          </span>
        )}
      </div>
      {error && !panelOpen && <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setPanelOpen(true)} disabled={busy}>
          {t("briefing.roster.addThem")}
        </Button>
        <OverflowMenu
          label={t("briefing.roster.moreActions")}
          items={[
            {
              label: t("briefing.roster.existing"),
              onSelect: () => {
                setMode("link");
                setPanelOpen(true);
              },
              disabled: busy,
            },
            { label: t("briefing.roster.ignore"), onSelect: ignore, disabled: busy },
          ]}
        />
      </div>

      {/* Who they are — add as new or link to someone on the list — is
          answered in a side panel, with what they wrote. */}
      <SidePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={title}
        subtitle={`${channel} · ${request.channel_ref}`}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={ignore} disabled={busy}>
              {t("briefing.roster.ignore")}
            </Button>
            <Button variant="primary" onClick={approve} disabled={busy || !canAdd}>
              {mode === "new" ? t("briefing.roster.addThem") : t("briefing.roster.thatsThem")}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm leading-relaxed text-fg-muted">
          {t("briefing.roster.notListed")}{" "}
          {request.ack_sent ? t("briefing.roster.ackSent") : t("briefing.roster.notAnswered")}{" "}
          {tp("briefing.roster.onceAdded", request.message_count)}
        </p>

        {request.previews.length > 0 && (
          <div className="mb-4 space-y-1.5 rounded-xl border border-line bg-surface/40 px-3.5 py-2.5">
            {request.previews.slice(0, 3).map((line, i) => (
              <p key={i} className="text-sm text-fg-muted whitespace-pre-wrap break-words">
                {line}
              </p>
            ))}
          </div>
        )}

        <div className="mb-4 flex flex-col gap-2" role="radiogroup" aria-label={t("briefing.roster.whoTheyAre")}>
          <label className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-line px-3 text-[15px] text-fg">
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} disabled={busy} />
            {t("briefing.roster.addNew")}
          </label>
          <label className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-line px-3 text-[15px] text-fg">
            <input type="radio" checked={mode === "link"} onChange={() => setMode("link")} disabled={busy} />
            {t("briefing.roster.existing")}
          </label>
        </div>

        {mode === "new" ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("briefing.roster.theirName")}
              aria-label={t("briefing.roster.theirName")}
              maxLength={200}
              disabled={busy}
              className={fieldClass}
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as PersonKind | "")}
              disabled={busy}
              aria-label={t("briefing.roster.teamOrContactLabel")}
              className={fieldClass}
            >
              <option value="">{t("briefing.roster.teamOrContact")}</option>
              <option value="team">{t("briefing.roster.kindTeam")}</option>
              <option value="contact">{t("briefing.roster.kindContact")}</option>
            </select>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <select
              value={linkId}
              onChange={(e) => setLinkId(e.target.value === "" ? "" : Number(e.target.value))}
              disabled={busy || people === null}
              aria-label={t("briefing.roster.whoTheyAre")}
              className={fieldClass}
            >
              <option value="">{people === null ? t("common.loading") : t("briefing.roster.choose")}</option>
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                  {p.kind === "contact" ? t("briefing.roster.contactSuffix") : ""}
                </option>
              ))}
            </select>
            {isChat && (
              <label className="flex min-h-[44px] items-center gap-2 text-sm text-fg-muted">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                  disabled={busy}
                />
                {t("briefing.roster.replaceAccount", { channel })}
              </label>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{error}</p>}
      </SidePanel>
    </div>
  );
}
