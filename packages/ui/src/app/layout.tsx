import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Noto_Sans_KR } from "next/font/google";
import { connection } from "next/server";
import AuthProvider from "@/components/AuthProvider";
import { ExecutiveStatusProvider } from "@/components/executive/ExecutiveStatusContext";
import { SessionsProvider } from "@/components/sessions/SessionsContext";
import AppShell from "@/components/shell/AppShell";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceContext";
import { locale, t, type Locale } from "@/i18n/index.ts";
import "./globals.css";

// Geist, self-hosted by next/font at build time: no request to Google from
// the browser, and no layout shift while it loads.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
// The brand face: the Hoiv Executive name and feature names (FeatureName).
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-display",
  display: "swap",
});
// Faces for scripts Geist lacks, per locale: the sans stack falls back to
// --font-script (tailwind.config.ts) for the glyphs Geist doesn't have. Only
// the deployment's locale gets its class, so an English page never loads
// them; within one, the browser fetches only the slices a page uses.
const notoSansKr = Noto_Sans_KR({
  variable: "--font-script",
  display: "swap",
  preload: false,
});
const SCRIPT_FONTS: Partial<Record<Locale, string>> = { ko: notoSansKr.variable };

// A function, not a constant, so the text is looked up per request.
export function generateMetadata(): Metadata {
  return {
    title: t("lib.meta.title"),
    description: t("lib.meta.description"),
  };
}

// `viewport-fit=cover` lets the page reach under the iPhone notch and home
// indicator; the mobile bottom bar pads itself by the safe-area inset so its
// buttons stay clear of the indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Render every page per request, so OE_LANGUAGE is read when the server
  // runs, not frozen into prebuilt HTML at `next build` (a Docker image is
  // built once and run with either language).
  await connection();
  return (
    <html
      lang={locale()}
      className={`h-full ${geist.variable} ${bricolage.variable} ${SCRIPT_FONTS[locale()] ?? ""}`}
    >
      <body className="h-full antialiased bg-surface text-fg">
        <AuthProvider>
          <SessionsProvider>
            <ExecutiveStatusProvider>
              <WorkspaceProvider>
                <AppShell>{children}</AppShell>
              </WorkspaceProvider>
            </ExecutiveStatusProvider>
          </SessionsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
