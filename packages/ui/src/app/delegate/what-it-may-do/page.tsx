"use client";

import WhatItMayDoView from "@/components/delegate/WhatItMayDo";
import { t } from "@/i18n/index.ts";

// Delegate → What it may do: everything that goes out without asking, who it
// goes out as, and the setting that allows it. Read-only; each row links to
// the tab where its setting lives.
export default function WhatItMayDoPage() {
  return (
    <main className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-16">
        <h1 className="text-2xl sm:text-3xl tracking-tight">{t("settings.mayDo.title")}</h1>
        <p className="mt-3 text-[15px] text-fg-muted leading-relaxed">{t("settings.mayDo.description")}</p>
        <div className="mt-6">
          <WhatItMayDoView />
        </div>
      </div>
    </main>
  );
}
