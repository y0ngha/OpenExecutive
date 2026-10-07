"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ARTIFACT_EXTENSIONS,
  ArtifactDetail,
  archiveArtifact,
  artifactDownloadUrl,
  deleteArtifact,
  getArtifact,
  restoreArtifact,
} from "@/lib/api";
import ArtifactViewer from "@/components/ArtifactViewer";
import Button, { buttonClass } from "@/components/ui/Button";
import OverflowMenu from "@/components/ui/OverflowMenu";
import { displayLocale, t } from "@/i18n/index.ts";
import { tRich } from "@/i18n/rich.tsx";

// Seed for "Revise in chat": opens a fresh chat with the id pre-filled so the
// Executive can get_artifact → draft_artifact(supersedes=…).
function reviseHref(art: ArtifactDetail): string {
  const draft = t("audit.artifact.reviseDraft", { id: art.id, title: art.title });
  return `/?new=1&draft=${encodeURIComponent(draft)}`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(displayLocale());
}

export default function ArtifactDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ? decodeURIComponent(params.id) : undefined;
  const [art, setArt] = useState<ArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getArtifact(id)
      .then(setArt)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const handleCopy = useCallback(async () => {
    if (!art?.body) return;
    try {
      await navigator.clipboard.writeText(art.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard API may be unavailable
    }
  }, [art]);

  const handleToggleArchive = useCallback(async () => {
    if (!art) return;
    const archiving = !art.archived_at;
    setBusy(true);
    try {
      if (archiving) await archiveArtifact(art.id);
      else await restoreArtifact(art.id);
      // Reflect new state locally (timestamp is illustrative — the list is the
      // source of truth on next load).
      setArt({ ...art, archived_at: archiving ? new Date().toISOString() : null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [art]);

  // Downloads come from the API; an <a download> keeps the page in place.
  const download = useCallback((url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!art) return;
    if (
      !confirm(
        t("audit.artifacts.confirmDelete", { title: art.title })
      )
    )
      return;
    setBusy(true);
    try {
      await deleteArtifact(art.id);
      router.push("/artifacts");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [art, router]);

  if (error) {
    return (
      <div className="flex flex-col h-full bg-surface text-fg items-center justify-center">
        <div className="text-sm text-red-400 mb-4">{t("audit.errorPrefix", { error })}</div>
        <Link href="/artifacts" className="text-sm text-fg-muted hover:text-fg">
          {t("audit.artifact.backToDocuments")}
        </Link>
      </div>
    );
  }

  if (!art) {
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
          <Link href="/artifacts" className="text-sm text-fg-muted hover:text-fg">
            {t("audit.artifact.documentsCrumb")}
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-2 break-words">
                {art.title}
              </h1>
              <div className="text-sm text-fg-muted">
                {t("audit.artifact.meta", {
                  format: art.format_label,
                  source: art.source_label,
                  time: formatTimestamp(art.created_at),
                })}
                {art.archived_at && t("audit.artifact.archivedSuffix")}
              </div>
              {art.supersedes_id && (
                <div className="text-sm text-fg-muted mt-1">
                  {tRich("audit.artifact.replaces", {
                    link: (
                      <Link
                        href={`/artifacts/${encodeURIComponent(art.supersedes_id)}`}
                        className="text-accent hover:underline"
                      >
                        {t("audit.artifact.earlierVersion")}
                      </Link>
                    ),
                  })}
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Link href={reviseHref(art)} className={buttonClass("primary", "md")}>
                {t("audit.artifact.reviseInChat")}
              </Link>
              <Button onClick={handleCopy}>{copied ? t("audit.artifact.copiedBang") : t("common.copy")}</Button>
              {art.downloads.length > 0 && (
                <OverflowMenu
                  trigger={t("audit.artifact.download")}
                  label={t("audit.artifact.download")}
                  items={art.downloads.map((target, i) => ({
                    label: t("audit.artifact.downloadAs", { ext: String(ARTIFACT_EXTENSIONS[target]) }),
                    onSelect: () =>
                      download(artifactDownloadUrl(art.id, i === 0 ? undefined : target)),
                  }))}
                />
              )}
              <OverflowMenu
                label={t("audit.artifact.moreActions")}
                items={[
                  {
                    label: art.archived_at ? t("audit.artifacts.restore") : t("audit.artifacts.archive"),
                    disabled: busy,
                    onSelect: () => void handleToggleArchive(),
                  },
                  {
                    label: t("audit.artifacts.deletePermanently"),
                    danger: true,
                    disabled: busy,
                    onSelect: () => void handleDelete(),
                  },
                ]}
              />
            </div>
          </div>

          {art.rationale && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-5 py-4">
              <div className="text-sm font-semibold text-amber-600 dark:text-amber-300 mb-1">
                {t("audit.artifact.whyWorth")}
              </div>
              <div className="text-[15px] text-fg">{art.rationale}</div>
            </div>
          )}

          <ArtifactViewer
            format={art.format}
            body={art.body}
            title={art.title}
            externalUrl={art.external_url}
            linkLabel={art.link_label}
          />
        </div>
      </main>
    </div>
  );
}
