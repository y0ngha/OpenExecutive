// Settings → Setup status (/settings/status): the shape of the API's
// GET /setup/status answer, and the one light this app works out itself —
// sign-in, whose settings live here rather than in the API.
//
// No imports, so `npm test` can exercise this under
// `node --experimental-strip-types` (see scripts/setupStatus.test.mjs).

import { t, tp } from "../i18n/index.ts";

export type SetupState = "ok" | "warn" | "error" | "off";

/** One light. Mirrors `SetupCheck` in packages/core/openexecutive/api/setup_checks.py. */
export interface SetupCheck {
  id: string;
  label: string;
  state: SetupState;
  summary: string;
  fix: string | null;
  /** An in-app page that helps with the fix, e.g. "/people". */
  link: string | null;
  /** When the channel last received a message (ISO time). */
  last_activity: string | null;
}

export interface SetupStatus {
  checked_at: string;
  checks: SetupCheck[];
}

export interface SignInEnv {
  localLogin: boolean;
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  /** AUTH_OIDC_ISSUER / _ID / _SECRET — SSO sign-in (lib/oidc.ts). */
  oidcIssuer: string | undefined;
  oidcClientId: string | undefined;
  oidcClientSecret: string | undefined;
  /** lib/oidc.ts issuerAllowed(AUTH_OIDC_ISSUER): https, or this machine. */
  oidcIssuerAllowed: boolean;
  /** AUTH_OIDC_TRUST_UNVERIFIED_EMAIL, read as lib/oidc.ts reads it. */
  oidcTrustUnverifiedEmail: boolean;
  /** ALLOWED_EMAILS, parsed the way sign-in parses it. */
  allowedEmails: ReadonlySet<string>;
  authUrl: string | undefined;
  publicDeployment: boolean;
}

// RFC 2606 names reserved for examples — the same set as
// _EXAMPLE_EMAIL_DOMAINS in api/setup_checks.py, and
// scripts/setupStatus.test.mjs fails if the two ever disagree.
export const EXAMPLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "example.com",
  "example.org",
  "example.net",
]);

export function isExampleEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
  return EXAMPLE_EMAIL_DOMAINS.has(domain) || domain.endsWith(".example");
}

export function signInCheck(env: SignInEnv): SetupCheck {
  const check = (state: SetupState, summary: string, fix: string | null = null): SetupCheck => ({
    id: "sign_in",
    label: t("lib.setup.signIn"),
    state,
    summary,
    fix,
    link: null,
    last_activity: null,
  });

  if (env.localLogin) {
    return check("ok", t("lib.setup.localLogin"));
  }
  const googleStarted = Boolean(env.googleClientId?.trim() || env.googleClientSecret?.trim());
  const google = Boolean(env.googleClientId?.trim() && env.googleClientSecret?.trim());
  const oidcStarted = Boolean(env.oidcIssuer?.trim() || env.oidcClientId?.trim() || env.oidcClientSecret?.trim());
  const oidc = Boolean(env.oidcIssuer?.trim() && env.oidcClientId?.trim() && env.oidcClientSecret?.trim());
  if (oidcStarted && !oidc) {
    return check(
      "error",
      t("lib.setup.oidcPartial"),
      t("lib.setup.oidcPartialFix"),
    );
  }
  if (oidc && !env.oidcIssuerAllowed) {
    return check(
      "error",
      t("lib.setup.oidcHttp"),
      t("lib.setup.oidcHttpFix"),
    );
  }
  // With nothing set up at all, Google is what the sign-in page offers.
  if ((googleStarted || !oidc) && !google) {
    return check(
      "error",
      t("lib.setup.googlePartial"),
      t("lib.setup.googlePartialFix"),
    );
  }
  const samples = [...env.allowedEmails].filter(isExampleEmail);
  if (samples.length > 0) {
    return check(
      "warn",
      t("lib.setup.sampleEmails", { emails: samples.join(", ") }),
      t("lib.setup.sampleEmailsFix"),
    );
  }
  if (env.publicDeployment && !env.authUrl?.trim()) {
    return check(
      "warn",
      t("lib.setup.noAuthUrl"),
      t("lib.setup.noAuthUrlFix"),
    );
  }
  if (oidc && env.oidcTrustUnverifiedEmail) {
    return check(
      "warn",
      t("lib.setup.unverified"),
      t("lib.setup.unverifiedFix"),
    );
  }
  const method = t(google && oidc ? "lib.setup.methodBoth" : oidc ? "lib.setup.methodSso" : "lib.setup.methodGoogle");
  const listed = env.allowedEmails.size;
  return check(
    "ok",
    listed > 0
      ? tp("lib.setup.okListed", listed, { method })
      : t("lib.setup.okTeam", { method }),
  );
}

// Worst first, so what needs fixing is at the top of the page.
const STATE_RANK: Record<SetupState, number> = { error: 0, warn: 1, ok: 2, off: 3 };

/** The lights in the order the page shows them: worst first, and otherwise
 * in the order they arrived. */
export function sortChecks(checks: readonly SetupCheck[]): SetupCheck[] {
  return checks
    .map((check, index) => ({ check, index }))
    .sort((a, b) => STATE_RANK[a.check.state] - STATE_RANK[b.check.state] || a.index - b.index)
    .map(({ check }) => check);
}

/** "5 minutes ago" — how long before `now` an ISO time was. */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return t("lib.ago.unknown");
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return t("lib.ago.lessThanMinute");
  if (minutes < 60) return tp("lib.ago.minutes", minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return tp("lib.ago.hours", hours);
  return t("lib.ago.days", { n: Math.floor(hours / 24) });
}

/** Only an in-app path is ever rendered as a link. */
export function safeInAppLink(link: string | null): string | null {
  return link && /^\/(?!\/)[\w\-/]*$/.test(link) ? link : null;
}
