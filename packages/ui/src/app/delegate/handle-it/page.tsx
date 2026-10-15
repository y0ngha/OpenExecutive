"use client";

import DelegatePage from "@/components/delegate/DelegatePage";
import HandleItCard, { useDelegation } from "@/components/settings/HandleItCard";
import SettingsCard from "@/components/settings/SettingsCard";
import { t } from "@/i18n/index.ts";

// Delegate → Handle it for me: the replies and follow-ups it sent as you on
// its own, from your own mailbox, and where the dial on Act as me is. It builds on Act as me (its inbox drafts),
// so someone who can't have Act as me is told so here.
export default function HandleItPage() {
  const load = useDelegation();
  return (
    <DelegatePage feature="handle_it" description={t("settings.handleItPage.description")}>
      {load.state === "hidden" ? (
        <SettingsCard>
          <p className="text-[15px] text-fg-muted leading-relaxed">{t("settings.handleItPage.unavailable")}</p>
        </SettingsCard>
      ) : (
        <HandleItCard load={load} />
      )}
    </DelegatePage>
  );
}
