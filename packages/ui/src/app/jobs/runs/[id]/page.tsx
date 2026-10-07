"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  GateState,
  TERMINAL_RUN_STATUSES,
  WorkflowRunDetail,
  decideWorkflowRun,
  getWorkflowRun,
  artifactDownloadUrl,
} from "@/lib/api";
import Button from "@/components/ui/Button";
import OverflowMenu from "@/components/ui/OverflowMenu";
import { runStatusLabel, runStatusTextColor } from "@/lib/runStatus";
import { t, tp, displayLocale, type MessageKey } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";

// A paused run is resumed by a background worker, so this page has to notice
// a change it did not cause. Poll quickly at first — an approval that just
// landed finishes in seconds — then back off, because a run can legitimately
// sit awaiting a person for days and polling that every 3s for 48h is waste.
const POLL_FAST_MS = 3000;
const POLL_SLOW_MS = 10000;
const POLL_BACKOFF_AFTER_MS = 2 * 60 * 1000;

function parseGateState(raw: string | null | undefined): GateState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as GateState)
      : null;
  } catch {
    return null;
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(displayLocale());
}

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params?.id;
  const [run, setRun] = useState<WorkflowRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Scoped to THIS run, not to the component: the App Router can keep the
    // same instance across a navigation between two run ids, and a mount-time
    // ref would hand the next run the previous one's elapsed clock — starting
    // a seconds-old run straight onto the slow cadence.
    const startedAt = Date.now();

    function schedule() {
      const elapsed = Date.now() - startedAt;
      timer = setTimeout(
        poll,
        elapsed > POLL_BACKOFF_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS
      );
    }

    async function poll() {
      try {
        const next = await getWorkflowRun(runId!);
        if (cancelled) return;
        setRun(next);
        setError(null); // a previous blip is over
        if (TERMINAL_RUN_STATUSES.has(next.status)) return; // nothing more to see
        schedule();
      } catch (e) {
        if (cancelled) return;
        // Keep any run already on screen — a transient fetch failure should not
        // replace a rendered artifact with an error page — and KEEP POLLING.
        // Returning here instead would stop the page updating for good after a
        // single blip, on a run that is still moving.
        setError(e instanceof Error ? e.message : String(e));
        schedule();
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  const handleCopy = useCallback(async () => {
    if (!run?.artifact) return;
    try {
      await navigator.clipboard.writeText(run.artifact);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard API may be unavailable
    }
  }, [run]);

  // The .docx comes from the API; an <a download> keeps the page in place.
  const handleDownloadDocx = useCallback(() => {
    if (!run) return;
    const a = document.createElement("a");
    a.href = artifactDownloadUrl(`run:${run.run_id}`, "docx");
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [run]);

  const handleDownload = useCallback(() => {
    if (!run?.artifact) return;
    const blob = new Blob([run.artifact], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.workflow_name}-${run.run_id.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [run]);

  // Only take over the whole page when there is nothing to show. Once a run has
  // loaded, a failed poll is a transient blip: keep the artifact on screen and
  // report the problem inline (below), or the page would flip to an error view
  // and lose everything the reader was looking at.
  if (error && !run) {
    return (
      <div className="flex flex-col h-full bg-surface text-fg items-center justify-center">
        <div className="text-sm text-red-400 mb-4">{t("jobs.list.error", { error })}</div>
        <Link href="/jobs" className="text-sm text-fg-muted hover:text-fg">
          {t("jobs.common.backToWorkflows")}
        </Link>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex flex-col h-full bg-surface text-fg-muted items-center justify-center text-sm">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface text-fg">
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <Link href="/jobs?tab=runs" className="text-sm text-fg-muted hover:text-fg">
            {t("jobs.run.backToRuns")}
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-2">
                {run.title}
              </h1>
              <div className="text-sm text-fg-muted">
                {tRich("jobs.run.meta", {
                  name: run.workflow_name,
                  when: formatTimestamp(run.created_at),
                  status: <StatusPill status={run.status} />,
                })}
              </div>
            </div>
            {run.artifact && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button variant="primary" onClick={handleCopy}>
                  {copied ? t("jobs.run.copied") : t("common.copy")}
                </Button>
                <OverflowMenu
                  trigger={t("jobs.run.download")}
                  label={t("jobs.run.download")}
                  items={[
                    { label: t("jobs.run.downloadMd"), onSelect: handleDownload },
                    { label: t("jobs.run.downloadDocx"), onSelect: handleDownloadDocx },
                  ]}
                />
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-300">
              {t("jobs.run.refreshFailed", { error })}
            </div>
          )}

          {run.status === "running" && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
              {t("jobs.run.inProgress")}
            </div>
          )}

          {run.status === "awaiting_human" && (
            // Keyed on the question, so a later sign-off in the same run starts
            // with fresh buttons rather than the previous answer.
            <AwaitingPanel key={`${run.awaiting_until ?? ""}:${run.state_json ?? ""}`} run={run} />
          )}

          {run.status === "resolved" && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-4 py-3 text-sm text-indigo-300">
              {t("jobs.run.resolved")}
            </div>
          )}

          {run.status === "timed_out" && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              <div className="font-medium mb-1">{t("jobs.run.timedOutTitle")}</div>
              <div className="text-xs">
                {t("jobs.run.timedOutBody")}
              </div>
            </div>
          )}

          {run.status === "error" && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              <div className="font-medium mb-1">{t("jobs.run.failed")}</div>
              <div className="text-xs">{run.error}</div>
            </div>
          )}

          {run.artifact && (
            <article className="prose prose-invert max-w-none rounded-2xl border border-line bg-surface-elevated p-5 sm:p-8
              prose-headings:text-fg prose-headings:font-semibold
              prose-p:text-fg prose-p:leading-relaxed
              prose-strong:text-fg
              prose-code:text-accent prose-code:bg-surface-overlay prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
              prose-pre:bg-surface-overlay prose-pre:border prose-pre:border-line-strong
              prose-blockquote:border-line-strong prose-blockquote:text-fg-muted
              prose-ul:text-fg prose-ol:text-fg
              prose-li:marker:text-fg-muted
              prose-hr:border-line-strong
              prose-a:text-accent prose-a:no-underline hover:prose-a:underline
              prose-table:text-fg prose-th:text-fg prose-th:border-line-strong prose-td:border-line-strong">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ node: _node, ...props }) => (
                    <a {...props} rel="noopener noreferrer nofollow" target="_blank" />
                  ),
                }}
              >
                {run.artifact}
              </ReactMarkdown>
            </article>
          )}

          <details className="rounded-2xl border border-line bg-surface-elevated px-5 py-3 text-sm">
            <summary className="flex min-h-10 items-center text-[15px] font-medium text-fg-muted cursor-pointer">
              {t("jobs.run.inputs")}
            </summary>
            <pre className="mt-3 text-xs text-fg whitespace-pre-wrap font-mono">
              {JSON.stringify(run.inputs, null, 2)}
            </pre>
          </details>
        </div>
      </main>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`${runStatusTextColor(status)} font-medium`}>
      {runStatusLabel(status)}
    </span>
  );
}

// What the question's delivery state means for the reader. The distinction
// matters: a suppressed or failed send means nobody has actually been asked,
// and saying "waiting on them" would be untrue.
const DELIVERY_NOTES: Record<string, MessageKey> = {
  sent: "jobs.run.deliverySent",
  self: "jobs.run.deliverySelf",
  suppressed: "jobs.run.deliverySuppressed",
  alerted: "jobs.run.deliveryAlerted",
  failed: "jobs.run.deliveryFailed",
};

function AwaitingPanel({ run }: { run: WorkflowRunDetail }) {
  const gate = parseGateState(run.state_json);
  const [answer, setAnswer] = useState<"approve" | "reject" | null>(null);
  const [sending, setSending] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  // Yes/no requests can be answered here; written replies still go via chat.
  const canAnswer = (gate?.expected_reply_shape ?? "approve_reject") === "approve_reject";

  async function decide(decision: "approve" | "reject") {
    setSending(true);
    setAnswerError(null);
    try {
      await decideWorkflowRun(run.run_id, decision);
      setAnswer(decision);
    } catch (e) {
      setAnswerError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }
  const delivery = gate?.delivery;
  const undelivered = delivery !== undefined && delivery !== "sent" && delivery !== "self";
  const deadline = run.awaiting_until
    ? new Date(run.awaiting_until).toLocaleString(displayLocale())
    : null;
  const done = run.resume_progress?.completed_step_ids.length ?? 0;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300 space-y-2">
      <div className="font-medium">
        {run.awaiting_person_id
          ? t("jobs.run.waitingFrom", { id: run.awaiting_person_id })
          : t("jobs.list.waitingSignOff")}
      </div>
      {gate?.question && (
        <div className="text-fg text-sm whitespace-pre-wrap break-words">
          &ldquo;{gate.question}&rdquo;
        </div>
      )}
      {canAnswer && !answer && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" onClick={() => void decide("approve")} disabled={sending}>
            {t("common.approve")}
          </Button>
          <Button onClick={() => void decide("reject")} disabled={sending}>
            {t("jobs.run.decline")}
          </Button>
          <span className="text-sm text-fg-muted">{t("jobs.run.orReplyInChat")}</span>
        </div>
      )}
      {answer && (
        <div className="text-xs text-fg">
          {answer === "approve" ? t("jobs.run.answeredApproved") : t("jobs.run.answeredDeclined")}
        </div>
      )}
      {answerError && <div className="text-xs text-red-300">{answerError}</div>}
      <div className="text-xs space-y-1">
        {deadline && <div>{t("jobs.run.deadline", { when: deadline })}</div>}
        {delivery && (
          <div className={undelivered ? "text-red-300" : undefined}>
            {DELIVERY_NOTES[delivery] ? t(DELIVERY_NOTES[delivery]) : t("jobs.run.deliveryOther", { delivery })}
          </div>
        )}
        {run.resume_progress ? (
          <div>
            {tp("jobs.run.stepsFinished", done)}
          </div>
        ) : (
          <div>
            {t("jobs.run.stopsAtSignOff")}
          </div>
        )}
      </div>
    </div>
  );
}
