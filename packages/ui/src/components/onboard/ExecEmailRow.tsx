"use client";

import Link from "next/link";
import { t } from "@/i18n/index.ts";
import { FIRST_RUN_LINKS } from "@/lib/firstRun";

// The last setup screen's line about the Executive's own email: an account
// just for it, which it reads, sends and keeps a calendar as. Its own file so
// a deployment that gives every Executive an address can say that instead.
export default function ExecEmailRow() {
  return (
    <li className="flex items-baseline gap-3 border-b border-line py-3 last:border-0">
      <span aria-hidden className="w-5 flex-shrink-0 text-center">
        ✉
      </span>
      <p className="min-w-0 text-[15px] text-fg-muted leading-snug">
        <span className="font-semibold text-fg">{t("chat.done.execEmailTitle")}</span> {t("chat.done.execEmailBody")}{" "}
        <Link href={FIRST_RUN_LINKS.execMailbox} className="font-semibold text-accent hover:underline">
          {t("chat.done.execEmailLink")}
        </Link>
      </p>
    </li>
  );
}
