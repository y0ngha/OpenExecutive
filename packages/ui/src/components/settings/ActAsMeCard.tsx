"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import Icon from "@/components/Icon";
import AdvancedFold from "@/components/settings/AdvancedFold";
import SettingsCard from "@/components/settings/SettingsCard";
import Switch from "@/components/Switch";
import Button from "@/components/ui/Button";
import { t, tp, type MessageKey } from "@/i18n/index.ts";
import {
  checkInboxNow,
  describeVoiceProfile,
  getDelegation,
  getVoiceProfile,
  learnVoiceProfile,
  refreshVoiceSignature,
  resetVoiceProfile,
  setDelegationEnabled,
  setDelegationTeam,
  setInboxWatch,
  updateVoiceProfile,
  type DelegationSettings,
  type DelegationTeam,
  type DescribedVoice,
  type InboxWatch,
  type VoiceProfile,
} from "@/lib/api";
import { formatAgo } from "@/lib/setupStatus";
import { addPhrase, markNew, STYLE_PHRASES, styleSentences } from "@/lib/voiceStyle";

// Settings → Act as me: let the Executive draft email AS you, in your own
// Gmail Drafts, when you ask it to — and, with Draft replies to my inbox on,
// for mail that needs you, which it sends when you tap Send on Today (or on
// its own, under Handle it for me).
// Backed by GET/PUT /delegation, /delegation/inbox and /delegation/voice.
// Not offered to anyone who can't have it (the owner can, and team members
// once the owner lets them: PUT /delegation/team) or on a backend without
// it: the hub then shows no tile, and this page says so.
//
// The page body: the mailbox, Write drafts as me and Draft replies to my
// inbox up front; How I write and Let team members use it under Advanced.

export function ACT_AS_ME_INTRO(): string {
  return t("settings.actAsMe.intro");
}

const LENGTHS = ["short", "medium", "long"] as const;
const FORMALITIES = ["casual", "neutral", "formal"] as const;
// The audiences a greeting is learned for (delegation/voice.py AUDIENCES) and
// its per-line limit (GREETING_MAX_CHARS).
const AUDIENCES = ["team", "contact", "other"] as const;
const AUDIENCE_LABEL: Record<string, MessageKey> = {
  team: "settings.voiceStyle.audience.team",
  contact: "settings.voiceStyle.audience.contact",
  other: "settings.voiceStyle.audience.other",
};
const OPTION_LABEL: Record<(typeof LENGTHS)[number] | (typeof FORMALITIES)[number], MessageKey> = {
  short: "settings.voiceStyle.length.short",
  medium: "settings.voiceStyle.length.medium",
  long: "settings.voiceStyle.length.long",
  casual: "settings.voiceStyle.formality.casual",
  neutral: "settings.voiceStyle.formality.neutral",
  formal: "settings.voiceStyle.formality.formal",
};
const GREETING_MAX_CHARS = 60;
// The longest description POST /delegation/voice/describe takes
// (delegation/voice.py DESCRIPTION_MAX_CHARS).
const DESCRIPTION_MAX_CHARS = 2000;
// While Check now runs, how often the card looks again, and for how long.
const CHECK_POLL_MS = 3000;
const MAX_CHECK_POLLS = 40;

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// The greetings as the form edits them: one per audience, "" for none.
function greetingFields(p: VoiceProfile): Record<string, string> {
  return Object.fromEntries(AUDIENCES.map((a) => [a, p.greetings[a] ?? ""]));
}

export default function ActAsMeCard() {
  const [settings, setSettings] = useState<DelegationSettings | null>(null);
  const [state, setState] = useState<"loading" | "hidden" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await getDelegation(signal);
      if (!next) {
        setState("hidden");
        return;
      }
      setSettings(next);
      setState("ready");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // While an inbox check runs, look again every few seconds until it's done.
  // A failed look keeps the card as it is and tries again; after
  // MAX_CHECK_POLLS it stops waiting and offers Check now again.
  const checking = settings?.inbox?.checking ?? false;
  const polls = useRef(0);
  const [pollTick, setPollTick] = useState(0);
  const [stoppedWaiting, setStoppedWaiting] = useState(false);
  useEffect(() => {
    if (!checking) {
      polls.current = 0;
      return;
    }
    if (polls.current >= MAX_CHECK_POLLS) {
      setStoppedWaiting(true);
      return;
    }
    const timer = setTimeout(() => {
      polls.current += 1;
      getDelegation()
        .then((next) => {
          if (next) setSettings(next);
        })
        .catch(() => { /* keep the card; the next look may work */ })
        .finally(() => setPollTick((n) => n + 1));
    }, CHECK_POLL_MS);
    return () => clearTimeout(timer);
  }, [checking, pollTick]);

  if (state === "loading") return <p className="text-[15px] text-fg-muted">{t("common.loading")}</p>;
  if (state === "hidden") {
    return (
      <SettingsCard>
        <p className="text-[15px] text-fg-muted leading-relaxed">
          {t("settings.actAsMe.notAvailable")}
        </p>
      </SettingsCard>
    );
  }
  if (state === "error" || !settings) {
    return (
      <SettingsCard>
        <p className="text-[15px] text-fg-muted">{t("settings.history.loadFailed")}</p>
      </SettingsCard>
    );
  }

  const connected = settings.gmail.status === "connected";
  const outlook = settings.gmail.provider === "microsoft";
  const mailbox = outlook ? "Outlook" : "Gmail";
  const on = settings.enabled;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setSettings(await setDelegationEnabled(!on));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.lead.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const recheck = async () => {
    setBusy(true);
    setError(null);
    await load();
    setBusy(false);
  };

  const pre =
    "mt-2 whitespace-pre-wrap break-all rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg font-mono";
  return (
    <>
      <SettingsCard
        title={connected ? t("settings.actAsMe.yourMailboxNamed", { mailbox }) : t("settings.actAsMe.yourMailbox")}
        description={connected ? t("settings.actAsMe.connectedTo", { email: String(settings.gmail.email) }) : settings.gmail.message}
        action={
          connected ? (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-fg">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
              {t("settings.actAsMe.connected")}
            </span>
          ) : undefined
        }
      >
        {!connected && (
          <div className="space-y-3">
            {settings.gmail.status === "not_configured" && (
              <div>
                <p className="text-sm text-fg-muted leading-relaxed">
                  {t("settings.actAsMe.gmailConnectHelp")}
                </p>
                <pre className={pre}>{settings.gmail.connect_command}</pre>
                {settings.gmail.outlook_connect_command && (
                  <>
                    <p className="mt-3 text-sm text-fg-muted leading-relaxed">
                      {t("settings.actAsMe.outlookConnectHelp")}
                    </p>
                    <pre className={pre}>{settings.gmail.outlook_connect_command}</pre>
                  </>
                )}
              </div>
            )}
            <Button variant="primary" onClick={() => void recheck()} disabled={busy}>
              {busy ? t("settings.status.checking") : t("settings.status.checkAgain")}
            </Button>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("settings.actAsMe.writeDraftsTitle")}
        titleId="act-as-me-label"
        description={
          on
            ? t("settings.actAsMe.writeDraftsOn", { mailbox })
            : connected
              ? t("settings.actAsMe.writeDraftsOff")
              : t("settings.actAsMe.connectFirst")
        }
        action={
          <Switch
            checked={on}
            onChange={() => void toggle()}
            disabled={busy || (!on && !connected)}
            labelledBy="act-as-me-label"
          />
        }
      >
        {error && <p className="text-sm text-red-500">{error}</p>}
      </SettingsCard>

      {settings.inbox && (
        <InboxSection
          inbox={stoppedWaiting ? { ...settings.inbox, checking: false } : settings.inbox}
          actAsMeOn={on}
          handleItOn={!!settings.handle_it?.enabled}
          onSettings={setSettings}
          onInbox={(inbox) => {
            setStoppedWaiting(false);
            polls.current = 0;
            setSettings((prev) => (prev ? { ...prev, inbox } : prev));
          }}
        />
      )}

      <AdvancedFold
        id="act-as-me-advanced"
        summary={settings.team ? t("settings.actAsMe.advancedSummaryTeam") : t("settings.voiceStyle.title")}
      >
        <VoiceSection connected={connected} outlook={outlook} />
        {settings.team && <TeamSection team={settings.team} onSettings={setSettings} />}
      </AdvancedFold>
    </>
  );
}

// The owner's "Let team members use Act as me" (PUT /delegation/team), shown
// only to the owner and only where the install allows it. Each member
// connects their own Gmail and turns it on for themselves; the owner sees
// counts only, never their mail, drafts or reply cards.
function TeamSection({
  team,
  onSettings,
}: {
  team: DelegationTeam;
  onSettings: (next: DelegationSettings) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      onSettings(await setDelegationTeam(!team.enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.lead.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      title={t("settings.actAsMe.teamTitle")}
      titleId="act-as-me-team-label"
      description={team.enabled ? t("settings.actAsMe.teamOn") : t("settings.actAsMe.teamOff")}
      action={
        <Switch
          checked={team.enabled}
          onChange={() => void toggle()}
          disabled={busy}
          labelledBy="act-as-me-team-label"
        />
      }
    >
      {team.enabled && team.members.length > 0 && (
        <ul className="divide-y divide-line">
          {team.members.map((m) => (
            <li key={m.person_id} className="py-2 text-sm text-fg-muted">
              <span className="font-medium text-fg">{m.name}</span>
              {tp("settings.actAsMe.teamUsage", m.drafts_30d, { sent: m.sent_30d })}
              {m.inbox ? t("settings.actAsMe.teamInbox") : "."}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </SettingsCard>
  );
}

// "Draft replies to my inbox" (PUT /delegation/inbox; Check now is POST
// /delegation/inbox/check). Needs Act as me on; the replies wait on Today.
function InboxSection({
  inbox,
  actAsMeOn,
  handleItOn,
  onSettings,
  onInbox,
}: {
  inbox: InboxWatch;
  actAsMeOn: boolean;
  handleItOn: boolean;
  onSettings: (next: DelegationSettings) => void;
  onInbox: (next: InboxWatch) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = inbox.enabled;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      onSettings(await setInboxWatch(!on));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.lead.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const checkNow = async () => {
    setBusy(true);
    setError(null);
    try {
      onInbox(await checkInboxNow());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.actAsMe.checkInboxFailed"));
    } finally {
      setBusy(false);
    }
  };

  const last = inbox.last_poll_at && !inbox.checking ? t("settings.actAsMe.lastChecked", { ago: formatAgo(inbox.last_poll_at) }) : "";
  return (
    <SettingsCard
      title={t("settings.actAsMe.inboxTitle")}
      titleId="act-as-me-inbox-label"
      description={
        on
          ? handleItOn
            ? t("settings.actAsMe.inboxOnHandleIt")
            : t("settings.actAsMe.inboxOn")
          : actAsMeOn
            ? t("settings.actAsMe.inboxOff")
            : t("settings.actAsMe.inboxNeedsDrafts")
      }
      action={
        <Switch
          checked={on}
          onChange={() => void toggle()}
          disabled={busy || (!on && !actAsMeOn)}
          labelledBy="act-as-me-inbox-label"
        />
      }
    >
      {on && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-sm text-fg-muted">
            {inbox.message}
            {last}
          </span>
          <Button size="sm" onClick={() => void checkNow()} disabled={busy || inbox.checking}>
            {inbox.checking ? t("settings.status.checking") : t("settings.actAsMe.checkNow")}
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </SettingsCard>
  );
}

// "How I write": the style drafts written as you follow, shown as a few plain
// sentences. Two ways to set it: describe it in your own words (a model turns
// that into the style, shown with what's new marked and a sample reply,
// saved only with Save), or learn it from your sent mail. The fields sit
// behind "Fine-tune details", and stay open while an edit is unsaved.
function VoiceSection({ connected, outlook = false }: { connected: boolean; outlook?: boolean }) {
  const [mode, setMode] = useState<"view" | "describe" | "review">("view");
  const [description, setDescription] = useState("");
  const [proposed, setProposed] = useState<DescribedVoice | null>(null);
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [greetings, setGreetings] = useState<Record<string, string>>({});
  const [habits, setHabits] = useState("");
  const [avoid, setAvoid] = useState("");
  const [signOff, setSignOff] = useState("");
  const [length, setLength] = useState("");
  const [formality, setFormality] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const adopt = useCallback((p: VoiceProfile) => {
    setProfile(p);
    setGreetings(greetingFields(p));
    setHabits(p.habits.join("\n"));
    setAvoid(p.avoid.join("\n"));
    setSignOff(p.sign_off);
    setLength(p.length);
    setFormality(p.formality);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getVoiceProfile(controller.signal)
      .then(adopt)
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        setLoadFailed(true);
      });
    return () => controller.abort();
  }, [adopt]);

  if (loadFailed) {
    return (
      <SettingsCard title={t("settings.voiceStyle.title")}>
        <p className="text-sm text-fg-muted">{t("settings.voiceStyle.loadFailed")}</p>
      </SettingsCard>
    );
  }
  if (!profile) return null;

  // keepEdits (lock, signature, examples): a field you've changed and not
  // saved keeps your text; every other field takes the new value, which may
  // come from a change made elsewhere.
  const run = async (action: () => Promise<VoiceProfile>, keepEdits = false) => {
    const before = profile;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await action();
      if (!keepEdits) {
        adopt(next);
        return;
      }
      const keep = (saved: string, fresh: string) => (typed: string) => (typed === saved ? fresh : typed);
      setProfile(next);
      setHabits(keep(before.habits.join("\n"), next.habits.join("\n")));
      setAvoid(keep(before.avoid.join("\n"), next.avoid.join("\n")));
      setSignOff(keep(before.sign_off, next.sign_off));
      setLength(keep(before.length, next.length));
      setFormality(keep(before.formality, next.formality));
      const [was, now] = [greetingFields(before), greetingFields(next)];
      setGreetings((typed) =>
        Object.fromEntries(AUDIENCES.map((a) => [a, keep(was[a], now[a])(typed[a] ?? "")])),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.voiceStyle.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const writeStyle = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setProposed(await describeVoiceProfile(description));
      setMode("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.voiceStyle.writeFailed"));
    } finally {
      setBusy(false);
    }
  };

  const saveProposed = async () => {
    if (!proposed) return;
    await run(() =>
      updateVoiceProfile({
        greetings: proposed.greetings,
        sign_off: proposed.sign_off,
        length: proposed.length,
        formality: proposed.formality,
        habits: proposed.habits,
        avoid: proposed.avoid,
      }),
    );
    setMode("view");
    setProposed(null);
    setDescription("");
    setNotice(t("settings.voiceStyle.savedNotice"));
  };

  const takeGmailSignature = () =>
    void run(async () => {
      const next = await refreshVoiceSignature();
      if (!next.signature) {
        setNotice(
          profile.signature
            ? t("settings.voiceStyle.noSignatureNow")
            : t("settings.voiceStyle.noSignature"),
        );
      }
      return next;
    }, true);

  const learned = profile.learned_at !== null;
  const sentences = styleSentences(profile);
  const hasStyle = sentences.length > 0;
  const savedGreetings = greetingFields(profile);
  const dirty =
    AUDIENCES.some((a) => greetings[a] !== savedGreetings[a]) ||
    habits !== profile.habits.join("\n") ||
    avoid !== profile.avoid.join("\n") ||
    signOff !== profile.sign_off ||
    length !== profile.length ||
    formality !== profile.formality;
  const linkButton =
    "min-h-touch text-sm font-medium text-accent hover:underline disabled:opacity-50 disabled:no-underline";
  const field =
    "rounded-xl border border-line bg-surface px-3 text-[15px] text-fg focus:outline-none focus:border-line-strong";
  const showForm = editing || dirty;
  const source =
    profile.updated_by === "learn"
      ? t("settings.voiceStyle.sourceLearned", { n: profile.sample_count })
      : learned
        ? t("settings.voiceStyle.sourceLearnedChanged")
        : t("settings.voiceStyle.sourceYou");
  const feedback = (
    <>
      {notice && <p className="mt-2 text-sm text-fg-muted">{notice}</p>}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </>
  );

  if (mode === "describe") {
    return (
      <SettingsCard
        title={t("settings.voiceStyle.describeTitle")}
        description={hasStyle ? t("settings.voiceStyle.describeChange") : t("settings.voiceStyle.describeNew")}
      >
        <label htmlFor="voice-description" className="text-sm font-medium text-fg">
          {t("settings.voiceStyle.ownWords")}
        </label>
        <GrowingTextarea
          id="voice-description"
          value={description}
          onChange={setDescription}
          minRows={5}
          maxLength={DESCRIPTION_MAX_CHARS}
          placeholder={t("settings.voiceStyle.describePlaceholder")}
        />
        <div className="mt-3 flex flex-wrap gap-2" aria-label={t("settings.voiceStyle.addPhrase")}>
          {STYLE_PHRASES.map((phrase) => (
            <button
              key={phrase}
              type="button"
              onClick={() => setDescription((d) => addPhrase(d, phrase))}
              className="min-h-touch rounded-full border border-line bg-surface-overlay px-3 text-sm font-medium text-fg hover:bg-surface-hover"
            >
              <span className="text-accent">+</span> {phrase}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy || !description.trim()} onClick={() => void writeStyle()}>
            {busy ? t("settings.voiceStyle.writing") : t("settings.voiceStyle.write")}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setMode("view")}>
            {t("common.cancel")}
          </Button>
        </div>
        <p className="mt-2 text-[13px] text-fg-subtle">{t("settings.voiceStyle.nothingUntilSave")}</p>
        {feedback}
      </SettingsCard>
    );
  }

  if (mode === "review" && proposed) {
    return (
      <SettingsCard title={t("settings.voiceStyle.reviewTitle")} description={t("settings.voiceStyle.reviewDescription")}>
        <ul className="space-y-2">
          {markNew(profile, proposed).map(({ text, isNew }) => (
            <StyleLine key={text} text={text} isNew={isNew} />
          ))}
        </ul>
        {proposed.sample_reply && (
          <div className="mt-5 text-sm">
            <div className="font-medium text-fg">{t("settings.voiceStyle.sampleReply")}</div>
            <div className="mt-2 whitespace-pre-wrap break-words border-l-2 border-accent pl-3 leading-relaxed text-fg">
              {proposed.sample_reply}
            </div>
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button variant="primary" disabled={busy} onClick={() => void saveProposed()}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
          <Button disabled={busy} onClick={() => setMode("describe")}>
            {t("settings.voiceStyle.changeIt")}
          </Button>
        </div>
        {feedback}
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title={t("settings.voiceStyle.title")}
      description={hasStyle ? t("settings.voiceStyle.followsThis") : t("settings.voiceStyle.empty")}
    >
      {hasStyle && (
        <div className="mb-4 rounded-2xl border border-line bg-surface px-4 py-3">
          <ul className="space-y-2">
            {sentences.map((text) => (
              <StyleLine key={text} text={text} />
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-fg-subtle">
            {source}
            {profile.locked ? t("settings.voiceStyle.lockedNote") : ""}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            setError(null);
            setNotice(null);
            setMode("describe");
          }}
        >
          {t("settings.voiceStyle.describeButton")}
        </Button>
        {!profile.locked && (
          <Button disabled={busy || !connected} onClick={() => void run(learnVoiceProfile)}>
            {busy ? t("settings.voiceStyle.working") : learned ? t("settings.voiceStyle.learnAgain") : t("settings.voiceStyle.learn")}
          </Button>
        )}
      </div>
      {!dirty && (
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-expanded={showForm}
          aria-controls="voice-editor"
          className="mt-4 flex w-full min-h-touch items-center justify-between gap-3 border-t border-line pt-3 text-left text-sm"
        >
          <span className="font-medium text-accent">{showForm ? t("settings.voiceStyle.doneFineTuning") : t("settings.voiceStyle.fineTune")}</span>
          <span className="flex items-center gap-1 text-fg-subtle">
            <span className="hidden sm:inline">{t("settings.voiceStyle.fineTuneHint")}</span>
            <Icon
              name="chevron-right"
              size="w-4 h-4"
              className={`transition-transform ${showForm ? "rotate-90" : ""}`}
            />
          </span>
        </button>
      )}

      {showForm && (
        <div id="voice-editor" className="mt-5 space-y-5">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-fg-muted">
              {t("settings.voiceStyle.length")}
              <select value={length} onChange={(e) => setLength(e.target.value)} className={`${field} h-10`}>
                <option value="">—</option>
                {LENGTHS.map((l) => (
                  <option key={l} value={l}>
                    {t(OPTION_LABEL[l])}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-fg-muted">
              {t("settings.voiceStyle.tone")}
              <select
                value={formality}
                onChange={(e) => setFormality(e.target.value)}
                className={`${field} h-10`}
              >
                <option value="">—</option>
                {FORMALITIES.map((f) => (
                  <option key={f} value={f}>
                    {t(OPTION_LABEL[f])}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-fg">{t("settings.voiceStyle.greeting")}</legend>
            <p className="text-[13px] text-fg-subtle leading-relaxed">
              {t("settings.voiceStyle.greetingHelp")}
            </p>
            <div className="mt-2 space-y-2">
              {AUDIENCES.map((audience) => (
                <label
                  key={audience}
                  className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3 text-sm text-fg-muted"
                >
                  <span className="sm:w-36 flex-shrink-0">{t(AUDIENCE_LABEL[audience])}</span>
                  <input
                    type="text"
                    value={greetings[audience] ?? ""}
                    onChange={(e) => setGreetings((g) => ({ ...g, [audience]: e.target.value }))}
                    placeholder={t("settings.voiceStyle.notSet")}
                    maxLength={GREETING_MAX_CHARS}
                    className={`${field} h-10 min-w-0 flex-1`}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm font-medium text-fg">
            {t("settings.voiceStyle.signOff")}
            <GrowingTextarea value={signOff} onChange={setSignOff} minRows={2} />
          </label>
          <label className="block text-sm font-medium text-fg">
            {t("settings.voiceStyle.habits")}
            <GrowingTextarea value={habits} onChange={setHabits} minRows={3} />
          </label>
          <label className="block text-sm font-medium text-fg">
            {t("settings.voiceStyle.never")}
            <GrowingTextarea value={avoid} onChange={setAvoid} minRows={2} />
          </label>

          <div className="text-sm text-fg-muted">
            <div className="font-medium text-fg">{t("settings.voiceStyle.signature")}</div>
            {profile.signature ? (
              <>
                <p className="mt-0.5 leading-relaxed">
                  {outlook
                    ? t("settings.voiceStyle.signatureOutlook")
                    : t("settings.voiceStyle.signatureGmail")}
                </p>
                <div className="mt-2 whitespace-pre-wrap break-words border-l-2 border-line pl-3 leading-relaxed text-fg">
                  {profile.signature}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4">
                  {!outlook && (
                    <button
                      type="button"
                      disabled={busy || !connected}
                      onClick={takeGmailSignature}
                      className={linkButton}
                    >
                      {t("settings.voiceStyle.refreshGmail")}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => updateVoiceProfile({ clear_signature: true }), true)}
                    className={linkButton}
                  >
                    {t("settings.voiceStyle.dontAddSignature")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-0.5 leading-relaxed">
                  {outlook
                    ? t("settings.voiceStyle.noSignatureOutlook")
                    : t("settings.voiceStyle.noSignatureAdded")}
                </p>
                {!outlook && (
                  <button
                    type="button"
                    disabled={busy || !connected}
                    onClick={takeGmailSignature}
                    className={linkButton}
                  >
                    {t("settings.voiceStyle.addGmailSignature")}
                  </button>
                )}
              </>
            )}
          </div>

          {profile.exemplars.length > 0 && (
            <div className="text-sm text-fg-muted">
              <div className="font-medium text-fg">{t("settings.voiceStyle.examples")}</div>
              <p className="mt-0.5 leading-relaxed">
                {t("settings.voiceStyle.examplesHelp")}
              </p>
              <ul className="mt-2 space-y-2">
                {profile.exemplars.map((example, i) => (
                  <li
                    key={i}
                    className="whitespace-pre-wrap break-words border-l-2 border-line pl-3 leading-relaxed text-fg"
                  >
                    {example}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => updateVoiceProfile({ clear_exemplars: true }), true)}
                className={linkButton}
              >
                {t("settings.voiceStyle.removeExamples")}
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button
              variant="primary"
              disabled={busy || !dirty}
              onClick={() =>
                void run(() =>
                  updateVoiceProfile({
                    greetings: Object.fromEntries(
                      AUDIENCES.map((a) => [a, (greetings[a] ?? "").trim()]).filter(([, g]) => g),
                    ),
                    habits: lines(habits),
                    avoid: lines(avoid),
                    sign_off: signOff,
                    length,
                    formality,
                  }),
                )
              }
            >
              {t("settings.voiceStyle.saveChanges")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void run(() => updateVoiceProfile({ locked: !profile.locked }), true)}
            >
              {profile.locked ? t("settings.voiceStyle.unlock") : t("settings.voiceStyle.lock")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void run(resetVoiceProfile)}>
              {t("settings.voiceStyle.reset")}
            </Button>
          </div>
        </div>
      )}
      {feedback}
    </SettingsCard>
  );
}

// One sentence of the style, marked when a described style adds it.
function StyleLine({ text, isNew = false }: { text: string; isNew?: boolean }) {
  return (
    <li className="flex items-baseline gap-2.5 text-[15px] leading-relaxed text-fg">
      <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 -translate-y-0.5 rounded-full bg-accent" />
      <span className="min-w-0 flex-1">{text}</span>
      {isNew && (
        <span className="flex-shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
          {t("settings.voiceStyle.new")}
        </span>
      )}
    </li>
  );
}

// A textarea as tall as its text, so every line shows without an inner
// scrollbar; it refits when the text changes (typed or loaded) and when the
// window's width does.
function GrowingTextarea({
  id,
  value,
  onChange,
  minRows,
  maxLength,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  minRows: number;
  maxLength?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight leaves out the border, which border-box sizing counts.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, []);
  useLayoutEffect(fit, [fit, value]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return (
    <textarea
      ref={ref}
      id={id}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={minRows}
      className="mt-1.5 block w-full resize-none overflow-hidden rounded-xl border border-line bg-surface px-3 py-2 text-[15px] font-normal leading-relaxed text-fg focus:outline-none focus:border-line-strong"
    />
  );
}
