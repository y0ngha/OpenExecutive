// The review queue's per-domain bulk actions (approve what's queued, or start
// or stop curating a domain), worked out the way the server would act on them.
// Kept apart from ReviewQueue so `npm test` can check it
// (scripts/reviewBulk.test.mjs).

import { t } from "../i18n/index.ts";

export interface BulkPendingItem {
  domain: string;
  trusted_default?: boolean;
  reviewed_at?: string | null;
}

export type BulkActionKind = "approve" | "curate-start" | "curate-stop";

export interface BulkAction {
  kind: BulkActionKind;
  domain: string;
  /** Items the action touches. */
  count: number;
  label: string;
  /** Longer explanation, for a hint under the menu. */
  detail: string;
}

/** The actions available for one domain. `pending` must be the unfiltered
 * pending list and `trustedDefaults` the shipped-and-unreviewed count per
 * domain, so a status filter on the list can't hide an action. */
export function domainBulkActions(
  domain: string,
  pending: BulkPendingItem[],
  trustedDefaults: Record<string, number>,
): BulkAction[] {
  const actions: BulkAction[] = [];
  const pendingInDomain = pending.filter((i) => i.domain === domain);
  if (pendingInDomain.length > 0) {
    actions.push({
      kind: "approve",
      domain,
      count: pendingInDomain.length,
      label: t("lib.bulk.approveLabel", { domain, n: pendingInDomain.length }),
      detail: t("lib.bulk.approveDetail", { domain, n: pendingInDomain.length }),
    });
  }
  // "Stop curating" reverses queue_for_curation, whose selector is
  // `trusted_default = 1 AND reviewed_at IS NULL`. Mirror BOTH: a user's own
  // upload is pending with no timestamp too, and counting it would offer an
  // action that does nothing.
  const untouchedPending = pendingInDomain.filter(
    (i) => i.trusted_default && i.reviewed_at == null,
  ).length;
  const defaults = trustedDefaults[domain] ?? 0;
  if (untouchedPending > 0) {
    actions.push({
      kind: "curate-stop",
      domain,
      count: untouchedPending,
      label: t("lib.bulk.stopLabel", { domain }),
      detail: t("lib.bulk.stopDetail", { domain, n: untouchedPending }),
    });
  } else if (defaults > 0) {
    actions.push({
      kind: "curate-start",
      domain,
      count: defaults,
      label: t("lib.bulk.startLabel", { domain, n: defaults }),
      detail: t("lib.bulk.startDetail", { domain, n: defaults }),
    });
  }
  return actions;
}
