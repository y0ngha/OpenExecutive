import type { ReviewStatus } from "@/lib/api";
import { t, type MessageKey } from "@/i18n/index.ts";

// Shared by the review queue and the Knowledge base file view so both label a
// file's review state the same way.

const STATUS_LABELS: Record<ReviewStatus, MessageKey> = {
  pending: "misc.reviewStatus.pending",
  approved: "misc.reviewStatus.approved",
  rejected: "misc.reviewStatus.rejected",
  needs_revision: "misc.reviewStatus.needsRevision",
};

// Status is a coloured dot plus a word.
const STATUS_DOT: Record<ReviewStatus, string> = {
  pending: "bg-amber-500",
  approved: "bg-emerald-500",
  rejected: "bg-red-500",
  needs_revision: "bg-violet-500",
};

const TRUSTED_DEFAULT_DOT = "bg-fg-subtle";

export default function ReviewStatusPill({
  status,
  reviewedAt,
  trustedDefault,
}: {
  status: ReviewStatus;
  reviewedAt?: string | null;
  trustedDefault?: boolean;
}) {
  // Provenance comes from the server, never inferred: a user's own upload can
  // also sit approved-with-no-timestamp, and labelling it "Ships with Open
  // Executive" would be a lie about where the content came from.
  const trusted = trustedDefault === true && status === "approved" && reviewedAt == null;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted"
      title={
        trusted
          ? t("misc.reviewStatus.trustedTitle")
          : undefined
      }
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${trusted ? TRUSTED_DEFAULT_DOT : STATUS_DOT[status]}`}
      />
      {trusted ? t("misc.reviewStatus.default") : t(STATUS_LABELS[status])}
    </span>
  );
}
