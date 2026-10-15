// The line the People page's "Assign a task" form shows about whether the
// person was told (the `notified` the assign endpoint returns). Kept free of
// React so scripts/assignNotice.test.mjs can import it.

import { t } from "../i18n/index.ts";

export interface AssignNoticeLike {
  status: string;
  channel: string | null;
}

const CHANNEL_NAMES: Record<string, string> = {
  slack_dm: "Slack",
  discord_dm: "Discord",
  telegram: "Telegram",
  email: "email",
};

export function assignNoticeLine(notice: AssignNoticeLike | null | undefined): string {
  const followUp = t("people.assign.followUp");
  if (!notice || notice.status === "skipped") return followUp;
  if (notice.status === "sent") {
    const name = notice.channel ? CHANNEL_NAMES[notice.channel] : undefined;
    const where = name === "email" ? t("people.reach.name.email") : name;
    const told = where ? t("people.assign.toldOn", { where }) : t("people.assign.told");
    return t("people.assign.withFollowUp", { line: told, followUp });
  }
  if (notice.status === "held") {
    return t("people.assign.withFollowUp", { line: t("people.assign.held"), followUp });
  }
  // A teammate assigning isn't told why it waits: that's the person's own setting.
  if (notice.status === "later") {
    return t("people.assign.withFollowUp", { line: t("people.assign.later"), followUp });
  }
  return t("people.assign.withFollowUp", { line: t("people.assign.notReached"), followUp });
}
