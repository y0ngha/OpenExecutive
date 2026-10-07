// One namespace file per area of the UI; each area keys its text `<namespace>.…`.
import common from "./en/common.ts";
import lib from "./en/lib.ts";
import jobs from "./en/jobs.ts";
import settings from "./en/settings.ts";
import people from "./en/people.ts";
import audit from "./en/audit.ts";
import briefing from "./en/briefing.ts";
import chat from "./en/chat.ts";
import misc from "./en/misc.ts";

const messages = {
  ...common,
  ...lib,
  ...jobs,
  ...settings,
  ...people,
  ...audit,
  ...briefing,
  ...chat,
  ...misc,
};

export default messages;
