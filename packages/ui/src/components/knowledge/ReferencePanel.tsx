"use client";

import { useEffect, useState } from "react";
import {
  listExternalSources,
  peekExternalSource,
  type ExternalPeekChunk,
  type ExternalSourceInfo,
} from "@/lib/api";
import { buttonClass } from "@/components/ui/Button";
import { displayLocale, t, tp } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";

export default function ReferencePanel() {
  const [sources, setSources] = useState<ExternalSourceInfo[] | null>(null);
  const [totalChunks, setTotalChunks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [peeking, setPeeking] = useState<string | null>(null);
  const [peekChunks, setPeekChunks] = useState<ExternalPeekChunk[]>([]);
  const [peekError, setPeekError] = useState<string | null>(null);

  useEffect(() => {
    listExternalSources()
      .then((data) => {
        setSources(data.sources);
        setTotalChunks(data.total_chunks);
      })
      .catch(() => setError(t("audit.reference.loadFailed")));
  }, []);

  async function handlePeek(id: string) {
    setPeeking(id);
    setPeekChunks([]);
    setPeekError(null);
    try {
      const data = await peekExternalSource(id, 5);
      setPeekChunks(data.chunks);
      if (data.chunks.length === 0) {
        setPeekError(t("audit.reference.noChunks"));
      }
    } catch {
      setPeekError(t("audit.reference.loadChunksFailed"));
    }
  }

  if (error) {
    return (
      <div className="text-sm text-red-500 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
        {error}
      </div>
    );
  }
  if (sources === null) {
    return <p className="text-sm text-fg-muted">{t("common.loading")}</p>;
  }

  const ingested = sources.filter((s) => s.is_ingested);
  const pending = sources.filter((s) => !s.is_ingested);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[15px] text-fg-muted max-w-2xl">
          {tRich("audit.reference.intro", {
            file: <code className="text-fg">knowledge/sources.yaml</code>,
            command: <code className="text-fg">openexecutive ingest-oer</code>,
          })}
        </p>
        <p className="text-sm text-fg-muted mt-2">
          {t("audit.reference.summary", {
            ingested: ingested.length,
            pending: pending.length,
            chunks: totalChunks.toLocaleString(displayLocale()),
          })}
        </p>
      </div>

      <div className="space-y-3">
        {sources.map((src) => (
          <SourceCard
            key={src.id}
            source={src}
            isExpanded={peeking === src.id}
            chunks={peeking === src.id ? peekChunks : []}
            peekError={peeking === src.id ? peekError : null}
            onPeek={() => handlePeek(src.id)}
            onCollapse={() => {
              setPeeking(null);
              setPeekChunks([]);
              setPeekError(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SourceCard({
  source,
  isExpanded,
  chunks,
  peekError,
  onPeek,
  onCollapse,
}: {
  source: ExternalSourceInfo;
  isExpanded: boolean;
  chunks: ExternalPeekChunk[];
  peekError: string | null;
  onPeek: () => void;
  onCollapse: () => void;
}) {
  const fetchedLabel = source.last_fetched_at
    ? new Date(source.last_fetched_at * 1000).toLocaleString(displayLocale())
    : t("audit.reference.never");

  return (
    <div className="rounded-2xl bg-surface-elevated border border-line overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-base text-fg font-semibold">{source.title}</p>
            <span
              className="inline-flex items-center gap-1.5 text-sm text-fg-muted"
            >
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${source.is_ingested ? "bg-emerald-500" : "bg-fg-subtle"}`}
              />
              {source.is_ingested ? t("audit.reference.ingested") : t("audit.reference.pending")}
            </span>
            <span className="text-sm text-fg-subtle">
              {t("audit.reference.phase", { phase: source.phase })}
            </span>
          </div>
          <p className="text-sm text-fg-muted mt-1">
            {source.publisher} · {source.license} ·{" "}
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg-muted hover:text-fg underline-offset-2 hover:underline"
            >
              {t("audit.reference.sourceLink")}
            </a>
          </p>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {source.domains.map((d) => (
              <span
                key={d}
                className="text-xs text-fg-muted bg-surface-overlay border border-line px-2 py-0.5 rounded-lg"
              >
                {d}
              </span>
            ))}
          </div>
          <p className="text-sm text-fg-muted mt-2">
            {t("audit.reference.stats", {
              chunks: source.chunks.toLocaleString(displayLocale()),
              files: tp("audit.reference.files", source.files),
              fetched: fetchedLabel,
            })}
          </p>
        </div>
        <button
          onClick={isExpanded ? onCollapse : onPeek}
          disabled={!source.is_ingested}
          className={buttonClass("secondary", "sm", "!h-10 flex-shrink-0")}
        >
          {isExpanded ? t("audit.reference.hide") : t("audit.reference.peek")}
        </button>
      </div>
      {isExpanded && (
        <div className="border-t border-line px-4 py-3 sm:px-5 space-y-2 bg-surface-overlay/40">
          {peekError && <p className="text-sm text-fg-muted">{peekError}</p>}
          {chunks.map((c) => (
            <div
              key={`${c.filename}-${c.chunk_index}-${c.domain}`}
              className="text-sm text-fg bg-surface-elevated border border-line rounded-xl px-3.5 py-2.5"
            >
              <p className="text-xs text-fg-muted mb-1">
                {t("audit.reference.chunkMeta", {
                  domain: c.domain,
                  filename: c.filename,
                  index: c.chunk_index,
                })}
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">
                {c.text.length > 600 ? c.text.slice(0, 600) + "…" : c.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
