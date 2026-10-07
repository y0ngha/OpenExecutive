// One namespace file per area of the UI; each area keys its text `<namespace>.…`.
import common from "./ko/common.ts";
import lib from "./ko/lib.ts";
import jobs from "./ko/jobs.ts";
import settings from "./ko/settings.ts";
import people from "./ko/people.ts";
import audit from "./ko/audit.ts";
import briefing from "./ko/briefing.ts";
import chat from "./ko/chat.ts";
import misc from "./ko/misc.ts";

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
