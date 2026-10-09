import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GOOGLE_SIGN_IN, LOCAL_LOGIN, OIDC, auth, sessionStillAllowed, signIn } from "@/auth";
import { LOCAL_LOGIN_PROVIDER_ID } from "@/lib/localLogin";
import { OIDC_PROVIDER_ID } from "@/lib/oidc";
import BrandMark from "@/components/BrandMark";
import { t } from "@/i18n/index.ts";

type SearchParams = Promise<{ callbackUrl?: string; error?: string }>;

// Only same-origin paths allowed — a leading `/` followed by anything other
// than another `/` (which would be protocol-relative, e.g. `//evil.com`).
function safeCallbackUrl(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const { callbackUrl, error } = await searchParams;
  const safeDest = safeCallbackUrl(callbackUrl);

  // If already signed in, bounce straight to the destination — but only with a
  // session the middleware still accepts. A revoked one would be sent straight
  // back here, forever.
  const session = await auth();
  if (session && (await sessionStillAllowed(session, (await headers()).get("host")))) {
    redirect(safeDest);
  }

  const errorMessage = error ? describeError(error) : null;
  const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID?.trim());
  const buttonClass =
    "w-full rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 transition";

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface/60 p-8 shadow-xl">
        <h1 className="flex items-center gap-2.5 font-display text-2xl font-extrabold tracking-tight text-fg">
          <BrandMark size="sm" />
          Hoiv Executive
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          {LOCAL_LOGIN
            ? t("lib.signin.localIntro")
            : t("lib.signin.intro")}
        </p>

        {errorMessage && (
          <p className="mt-4 rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {errorMessage}
          </p>
        )}

        {LOCAL_LOGIN ? (
          <>
            <form
              action={async () => {
                "use server";
                try {
                  await signIn(LOCAL_LOGIN_PROVIDER_ID, { redirectTo: safeDest });
                } catch (err) {
                  // A refused sign-in throws; success throws Next's redirect, which must pass through.
                  if (err instanceof AuthError) {
                    redirect(
                      `/signin?error=${encodeURIComponent(err.type)}&callbackUrl=${encodeURIComponent(safeDest)}`,
                    );
                  }
                  throw err;
                }
              }}
              className="mt-6"
            >
              <button
                type="submit"
                className="w-full rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 transition"
              >
                {t("lib.signin.open")}
              </button>
            </form>
            <p className="mt-4 text-xs text-fg-subtle">
              {t("lib.signin.localHint")}
            </p>
          </>
        ) : (
          <>
            {OIDC && (
              <form
                action={async () => {
                  "use server";
                  await signIn(OIDC_PROVIDER_ID, { redirectTo: safeDest });
                }}
                className="mt-6"
              >
                <button type="submit" className={buttonClass}>
                  {t("lib.signin.withProvider", { name: OIDC.name })}
                </button>
              </form>
            )}
            {/* Google's button only when Google sign-in is set up: without
                AUTH_GOOGLE_ID it would lead to an error page. */}
            {GOOGLE_SIGN_IN && googleConfigured && (
              <form
                action={async () => {
                  "use server";
                  await signIn("google", { redirectTo: safeDest });
                }}
                className={OIDC ? "mt-3" : "mt-6"}
              >
                <button type="submit" className={buttonClass}>
                  {t("lib.signin.withGoogle")}
                </button>
              </form>
            )}
            {!googleConfigured && !OIDC && (
              <div className="mt-6 rounded-xl border border-line bg-surface-elevated px-4 py-3">
                <p className="text-sm font-medium text-fg">{t("lib.signin.notSetUpTitle")}</p>
                <p className="mt-1 text-sm text-fg-muted">
                  {t("lib.signin.notSetUpBody")}
                </p>
                <p className="mt-2 text-xs text-fg-muted">{t("lib.signin.notSetUpSelf")}</p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function describeError(code: string): string {
  switch (code) {
    case "AccessDenied":
      return t("lib.signin.errorAccessDenied");
    case "CredentialsSignin":
      return t("lib.signin.errorCredentials");
    case "Configuration":
      return t("lib.signin.errorConfiguration");
    default:
      return t("lib.signin.errorDefault");
  }
}
