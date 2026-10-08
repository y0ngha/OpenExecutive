"""Setup status: one plain-language light per part of an install.

Backs ``GET /setup/status`` (api/routes/setup_status.py), which the UI's
Settings → Setup status page renders next to the sign-in light it works out
itself. Each check answers "is this part working — and if not, what exactly
do I do?" for someone who has never read this code.

Every check keeps three rules:
- No secret in a response or a log line. A probe that carries a token reports
  a status code, a service's short error code or an exception's class name —
  never the exception's text, which can quote the request URL.
- At most one cheap, read-only call per service. Nothing here sends a
  message, spends model tokens or changes state.
- Every call is bounded by ``PROBE_TIMEOUT_S``: a slow service turns amber
  instead of stalling the page.
"""
from __future__ import annotations

import asyncio
import functools
import json
import logging
import os
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal
from urllib.parse import urlsplit

import anthropic
import httpx
from pydantic import BaseModel

from openexecutive.utils.i18n import MessageTable, tr

if TYPE_CHECKING:
    from openexecutive.audit import AuditEvent
    from openexecutive.briefing.brief_state import DeliveryOutcome
    from openexecutive.config import Settings
    from openexecutive.people.models import Person

logger = logging.getLogger(__name__)

State = Literal["ok", "warn", "error", "off"]

PROBE_TIMEOUT_S = 5.0

# The scheduler records every tick. Three missed ticks, and never less than a
# minute and a half, means it has stopped rather than being between ticks.
_SCHEDULER_STALE_TICKS = 3
_SCHEDULER_STALE_FLOOR_S = 90
# Boot work before the first tick (seeding briefs, a rotation reconcile) takes
# seconds; a scheduler with no tick this long after starting is stuck.
_SCHEDULER_STARTUP_GRACE_S = 300
# Telegram reports its last failed delivery until the next one fails. Older
# than this, it says nothing about whether delivery works now. The same
# window applies to a message turned away because its sender wasn't on the
# team list: after a day it is history, not something to fix.
_RECENT_FAILURE_S = 24 * 60 * 60
# Longest service-supplied text (a Telegram error, a Slack workspace name)
# echoed back. The UI renders it as plain text; this only keeps it one line.
_ECHO_MAX_CHARS = 160
_SERVICE_ACCOUNT_KEY_MAX_BYTES = 64 * 1024

# Sample values .env.example ships. One still in place means the file was
# copied and that line never filled in. tests/unit/test_setup_checks.py fails
# if .env.example ships a sample this set doesn't know.
EXAMPLE_VALUES: frozenset[str] = frozenset(
    {"sk-ant-your-key-here", "xoxb-your-bot-token", "xapp-your-app-token"}
)
# RFC 2606 names reserved for examples; no real mailbox lives at them.
_EXAMPLE_EMAIL_DOMAINS = frozenset({"example.com", "example.org", "example.net"})

_TELEGRAM_TOKEN_RE = re.compile(r"\d+:[A-Za-z0-9_-]{30,}")
_SLACK_ERROR_CODE_RE = re.compile(r"[a-z_]{1,40}")
# The sender id in the "Rejected: …" audit summaries the channel adapters
# write when someone off the team list messages the Executive.
_REJECTED_SENDER_RE = re.compile(r"(?:user|chat_id)=([\w.-]{1,64})")


def _offline_fix() -> str:
    return tr("setup.offline_fix", "Check this computer's internet connection, then check again.")


class SetupCheck(BaseModel):
    id: str
    label: str
    state: State
    summary: str
    fix: str | None = None
    # An in-app page that helps with the fix, e.g. "/people".
    link: str | None = None
    # When the channel last received a message (the audit log's ISO time).
    last_activity: str | None = None


# Every check, in display order: what the Executive needs to work at all, then
# the channels people reach it through, then what runs in the background.
_LABEL_TEXT = MessageTable("setup.label", {
    "ai_model": "AI model",
    "company": "Company setup",
    "owner": "Owner",
    "exec_email": "The Executive's email address",
    "api_secret": "API protection",
    "gmail": "Email (Gmail)",
    "your_gmail": "Your own mailbox (Act as me)",
    "slack": "Slack",
    "discord": "Discord",
    "telegram": "Telegram",
    "google_chat": "Google Chat",
    "scheduler": "Daily schedule",
    "brief": "Daily brief",
    "memory": "Long-term memory (Honcho)",
})
LABELS: dict[str, str] = _LABEL_TEXT.english


def _label(check_id: str) -> str:
    return _LABEL_TEXT[check_id]


def _not_set_up() -> str:
    return tr("setup.not_set_up", "Not set up.")


def _result(
    check_id: str,
    state: State,
    summary: str,
    fix: str | None = None,
    *,
    link: str | None = None,
    last_activity: str | None = None,
) -> SetupCheck:
    return SetupCheck(
        id=check_id,
        label=_label(check_id),
        state=state,
        summary=summary,
        fix=fix,
        link=link,
        last_activity=last_activity,
    )


@dataclass(frozen=True)
class Snapshot:
    """What the checks read, gathered once per run."""

    settings: Settings
    now: datetime
    local_login: bool
    people: Sequence[Person]
    principal: Person | None
    # Latest integration_inbound audit row per channel actor.
    last_inbound: dict[str, AuditEvent | None]
    discord_bot: Any = None
    discord_bot_task: asyncio.Task[None] | None = None
    slack_handler: Any = None
    # Whether the Slack listener knows its own user id (auth_test). Without
    # it the bot answers mentions and DMs but not follow-ups in its threads.
    slack_bot_id_resolved: bool = True
    mcp_gateway: Any = None
    # The daily brief: its latest run, whether email can carry it, when each
    # brief next goes out, and the zone the user chose for those times (None:
    # nobody chose one, so UTC).
    brief_delivery: DeliveryOutcome | None = None
    brief_email_ready: bool = False
    brief_next_runs: dict[str, datetime] = field(default_factory=dict)
    brief_zone: str | None = None


def _clip(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= _ECHO_MAX_CHARS else text[: _ECHO_MAX_CHARS - 1] + "…"


def _ago(seconds: float) -> str:
    minutes = int(seconds // 60)
    if minutes < 1:
        return tr("setup.ago.now", "less than a minute ago")
    if minutes == 1:
        return tr("setup.ago.minute.one", "{n} minute ago", n=minutes)
    if minutes < 120:
        return tr("setup.ago.minute.other", "{n} minutes ago", n=minutes)
    return tr("setup.ago.hours", "{n} hours ago", n=minutes // 60)


def _join_and(items: Sequence[str]) -> str:
    """``items`` as one phrase: "a and b" in English."""
    return functools.reduce(lambda a, b: tr("setup.list_and", "{a} and {b}", a=a, b=b), items)


def is_example_email(address: str) -> bool:
    domain = address.rpartition("@")[2].strip().lower()
    return domain in _EXAMPLE_EMAIL_DOMAINS or domain.endswith(".example")


# ---------------------------------------------------------------------------
# AI model, company and the people running it
# ---------------------------------------------------------------------------


async def check_ai_model(snap: Snapshot) -> SetupCheck:
    settings = snap.settings
    key = (settings.anthropic_api_key or "").strip()
    if not key:
        # Settings refuses to load with no provider at all, so one of these is on.
        if settings.openrouter_enabled and settings.local_models_enabled:
            summary = tr(
                "setup.ai_model.using_openrouter_and_local",
                "Using OpenRouter and local models instead of Anthropic. This page doesn't test that "
                "connection.",
            )
        elif settings.openrouter_enabled:
            summary = tr(
                "setup.ai_model.using_openrouter",
                "Using OpenRouter instead of Anthropic. This page doesn't test that connection.",
            )
        else:
            summary = tr(
                "setup.ai_model.using_local",
                "Using local models instead of Anthropic. This page doesn't test that connection.",
            )
        return _result("ai_model", "ok", summary)
    if key in EXAMPLE_VALUES:
        return _result(
            "ai_model",
            "error",
            tr(
                "setup.ai_model.anthropic_api_key_still",
                "ANTHROPIC_API_KEY still has the sample value from .env.example, so the Executive "
                "can't answer.",
            ),
            tr(
                "setup.ai_model.paste_key_console_anthropic",
                "Paste your key from console.anthropic.com over it in the .env file, then restart "
                "the app.",
            ),
        )

    from openexecutive.providers.anthropic_provider import configured_async_client

    client = configured_async_client(timeout=PROBE_TIMEOUT_S).with_options(max_retries=0)
    try:
        # Listing models is free, and it goes through the same key and
        # workspace header every chat turn uses.
        await asyncio.wait_for(client.models.list(limit=1), PROBE_TIMEOUT_S)
    except anthropic.AuthenticationError:
        return _result(
            "ai_model",
            "error",
            tr(
                "setup.ai_model.anthropic_turned_down_key",
                "Anthropic turned down the key in ANTHROPIC_API_KEY.",
            ),
            tr(
                "setup.ai_model.create_new_key_console",
                "Create a new key at console.anthropic.com, paste it into the .env file, then "
                "restart the app.",
            ),
        )
    except (anthropic.BadRequestError, anthropic.PermissionDeniedError) as exc:
        if not settings.anthropic_workspace_id:
            return _result(
                "ai_model",
                "error",
                tr(
                    "setup.ai_model.anthropic_refused_requests_made",
                    "Anthropic refused requests made with this key (HTTP {status_code}).",
                    status_code=exc.status_code,
                ),
                tr(
                    "setup.ai_model.key_created_whole_organisation",
                    "If the key was created for your whole organisation rather than inside a "
                    "workspace, set ANTHROPIC_WORKSPACE_ID in .env to the workspace to use, then "
                    "restart the app.",
                ),
            )
        return _result(
            "ai_model",
            "error",
            tr(
                "setup.ai_model.anthropic_refused_requests_made_2",
                "Anthropic refused requests made with this key and ANTHROPIC_WORKSPACE_ID (HTTP "
                "{status_code}).",
                status_code=exc.status_code,
            ),
            tr(
                "setup.ai_model.check_console_anthropic_com",
                "Check in console.anthropic.com that the key belongs to that workspace, then "
                "restart the app.",
            ),
        )
    except anthropic.RateLimitError:
        return _result(
            "ai_model",
            "warn",
            tr(
                "setup.ai_model.key_works_anthropic_says",
                "The key works, but Anthropic says it is over its rate limit right now.",
            ),
            tr(
                "setup.ai_model.wait_minute_check_again",
                "Wait a minute and check again. If it keeps happening, raise the limit in "
                "console.anthropic.com.",
            ),
        )
    except anthropic.APIStatusError as exc:
        return _result(
            "ai_model",
            "warn",
            tr(
                "setup.ai_model.anthropic_had_problem_answering",
                "Anthropic had a problem answering (HTTP {status_code}). That is usually brief.",
                status_code=exc.status_code,
            ),
            tr("setup.ai_model.check_again_few_minutes", "Check again in a few minutes."),
        )
    except (anthropic.APIConnectionError, TimeoutError):
        return _result(
            "ai_model",
            "warn",
            tr(
                "setup.ai_model.couldn_reach_anthropic_test",
                "Couldn't reach Anthropic to test the key.",
            ),
            _offline_fix(),
        )
    finally:
        await client.close()
    return _result("ai_model", "ok", tr("setup.ai_model.connected", "Connected to Anthropic."))


def check_company(snap: Snapshot) -> SetupCheck:
    from openexecutive.onboarding.profile_builder import load_or_create_profile

    profile = load_or_create_profile(snap.settings.company_profile_path)
    if profile.is_empty():
        return _result(
            "company",
            "warn",
            tr(
                "setup.company.done_executive_know_company",
                "Not done yet: the Executive doesn't know your company.",
            ),
            tr(
                "setup.company.run_setup_interview_describe",
                "Run the setup interview: describe your business, then check what the Executive "
                "drafts.",
            ),
            link="/onboard",
        )
    return _result("company", "ok", tr(
        "setup.company.set_up_for",
        "Set up for {name}.",
        name=_clip(profile.name),
    ))


def check_owner(snap: Snapshot) -> SetupCheck:
    owner = snap.principal
    if owner is None:
        return _result(
            "owner",
            "warn",
            tr(
                "setup.owner.nobody_team_list_marked",
                "Nobody on the team list is marked as the owner.",
            ),
            tr(
                "setup.owner.finish_setup_interview_asks",
                "Finish the setup interview — it asks who the owner is.",
            ),
            link="/onboard",
        )
    if snap.local_login:
        return _result(
            "owner",
            "ok",
            tr(
                "setup.owner.ok_local_login",
                "{full_name} is the owner. Local login signs you in as them.",
                full_name=owner.full_name,
            ),
        )
    if not owner.email:
        return _result(
            "owner",
            "warn",
            tr(
                "setup.owner.owner_email_team_list",
                "{full_name} is the owner, but has no email on the team list, so the app won't "
                "recognise them when they sign in — owner-only actions will be refused.",
                full_name=owner.full_name,
            ),
            tr(
                "setup.owner.signed_them_run_setup",
                "Signed in as them, run the setup interview again: saving it adds the address "
                "they signed in with to their entry.",
            ),
            link="/onboard",
        )
    return _result(
        "owner",
        "ok",
        tr(
            "setup.owner.ok",
            "{full_name} ({email}) is the owner.",
            full_name=owner.full_name,
            email=owner.email,
        ),
    )


def check_exec_email(snap: Snapshot) -> SetupCheck:
    address = snap.settings.exec_email_address.strip()
    fix = tr(
        "setup.exec_email.set_exec_email_address",
        "Set EXEC_EMAIL_ADDRESS in .env to the Gmail address the Executive sends from, then "
        "restart the app.",
    )
    if "@" not in address:
        return _result(
            "exec_email",
            "error",
            tr(
                "setup.exec_email.exec_email_address_email",
                "EXEC_EMAIL_ADDRESS isn't an email address.",
            ),
            fix,
        )
    if is_example_email(address):
        return _result(
            "exec_email",
            "warn",
            tr(
                "setup.exec_email.exec_email_address_still",
                "EXEC_EMAIL_ADDRESS is still the sample address {address}. Chat works without a "
                "real one; email doesn't.",
                address=address,
            ),
            fix,
        )
    return _result(
        "exec_email",
        "ok",
        tr(
            "setup.exec_email.executive_sends_email",
            "The Executive sends email as {address}.",
            address=address,
        ),
    )


def check_api_protection(snap: Snapshot) -> SetupCheck:
    if os.environ.get("BACKEND_SHARED_SECRET", "").strip():
        from openexecutive.api.caller import signing_on

        if signing_on():
            return _result(
                "api_secret",
                "ok",
                tr(
                    "setup.api_protection.only_web_app_use",
                    "Only the web app can use the API, and it signs who is signed in.",
                ),
            )
        return _result(
            "api_secret",
            "warn",
            tr(
                "setup.api_protection.only_web_app_use_2",
                "Only the web app can use the API, but it takes the web app's word for who is "
                "signed in: anyone holding BACKEND_SHARED_SECRET can act as anyone, the owner "
                "included. Until that's fixed, a reply drafted in your inbox can't be sent from "
                "here.",
            ),
            tr(
                "setup.api_protection.run_scripts_make_caller",
                "Run scripts/make-caller-keys.py once, set CALLER_ASSERTION_PRIVATE_KEY on the "
                "web app and CALLER_ASSERTION_PUBLIC_KEYS on the API, then restart both "
                "(docs/auth.md).",
            ),
        )
    if snap.local_login:
        return _result(
            "api_secret",
            "ok",
            tr(
                "setup.api_protection.needed_local_login_api",
                "Not needed: with local login the API only answers requests addressed to this "
                "computer.",
            ),
        )
    return _result(
        "api_secret",
        "warn",
        tr(
            "setup.api_protection.api_shared_secret_anything",
            "The API has no shared secret, so anything that can reach it can use it.",
        ),
        tr(
            "setup.api_protection.fine_own_computer_server",
            "Fine on your own computer. On a server, set BACKEND_SHARED_SECRET to the same random "
            "value for both apps (openssl rand -hex 32), then restart them. Sending drafted "
            "replies from the web app also needs signed sign-ins (docs/auth.md).",
        ),
    )


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------


async def _fetch(
    http: httpx.AsyncClient, method: str, url: str, **kwargs: Any
) -> tuple[int, dict[str, Any]] | None:
    """``(status, JSON object or {})``, or ``None`` when the service couldn't
    be reached. Never raises, and never logs the URL, which can hold a token
    (Telegram's does). httpx's own per-request log line would print it at
    INFO; api.main._configure_logging holds the ``httpx`` logger at WARNING."""
    try:
        response = await asyncio.wait_for(http.request(method, url, **kwargs), PROBE_TIMEOUT_S)
    except (httpx.HTTPError, TimeoutError) as exc:
        logger.info("setup status: %s probe failed (%s)", urlsplit(url).hostname, type(exc).__name__)
        return None
    try:
        body = response.json()
    except ValueError:
        body = {}
    return response.status_code, body if isinstance(body, dict) else {}


@dataclass(frozen=True)
class _Roster:
    """Which Person field a channel matches senders on, and what to call it."""

    field: str
    # Key into _ROSTER_ID_NAMES.
    channel: str


# What each channel's sender id is called on the People page.
_ROSTER_ID_NAMES = MessageTable("setup.roster_id", {
    "slack": "Slack member ID",
    "discord": "Discord user ID",
    "telegram": "Telegram chat ID",
})


def _turned_away_sender(snap: Snapshot, last: AuditEvent | None, roster: _Roster) -> str | None:
    """The sender of a message the channel turned away in the last day, when
    they still aren't on the team list — ``""`` when the audit row doesn't
    name them. ``None`` when there is nothing left to fix."""
    if last is None or not last.summary.startswith("Rejected"):
        return None
    try:
        at = datetime.fromisoformat(last.ts)
    except ValueError:
        return None
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    if (snap.now - at).total_seconds() >= _RECENT_FAILURE_S:
        return None
    match = _REJECTED_SENDER_RE.search(last.summary)
    if match is None:
        return ""
    sender = match.group(1)
    rostered = any(str(getattr(person, roster.field) or "") == sender for person in snap.people)
    return None if rostered else sender


def _channel_ready(
    snap: Snapshot, check_id: str, summary: str, *, actor: str, roster: _Roster | None
) -> SetupCheck:
    """The last word on a channel that is connected: can anyone reach the
    Executive through it? Slack, Discord and Telegram answer only people on
    the team list whose entry carries their id on that service."""
    last = snap.last_inbound.get(actor)
    last_at = last.ts if last is not None else None
    if roster is not None:
        id_name = _ROSTER_ID_NAMES[roster.channel]
        if not any(getattr(person, roster.field) for person in snap.people):
            return _result(
                check_id,
                "warn",
                tr(
                    "setup.channel.nobody_rostered",
                    "{summary} But nobody on the team list has a {id_name}, so every message is ignored.",
                    summary=summary,
                    id_name=id_name,
                ),
                tr(
                    "setup.channel.add_your_id",
                    "Add your {id_name} to your entry on the People page.",
                    id_name=id_name,
                ),
                link="/people",
                last_activity=last_at,
            )
        sender = _turned_away_sender(snap, last, roster)
        if sender is not None:
            if sender:
                ignored = tr(
                    "setup.channel.sender_ignored_named",
                    "{summary} The last message (from {id_name} {sender}) was ignored because its "
                    "sender isn't on the team list.",
                    summary=summary,
                    id_name=id_name,
                    sender=sender,
                )
            else:
                ignored = tr(
                    "setup.channel.sender_ignored",
                    "{summary} The last message was ignored because its sender isn't on the team list.",
                    summary=summary,
                )
            return _result(
                check_id,
                "warn",
                ignored,
                tr(
                    "setup.channel.add_that_id",
                    "If that was you, add that {id_name} to your entry on the People page.",
                    id_name=id_name,
                ),
                link="/people",
                last_activity=last_at,
            )
    return _result(check_id, "ok", summary, last_activity=last_at)


async def check_slack(snap: Snapshot, http: httpx.AsyncClient) -> SetupCheck:
    bot = (snap.settings.slack_bot_token or "").strip()
    app_token = (snap.settings.slack_app_token or "").strip()
    if not bot and not app_token:
        return _result(
            "slack",
            "off",
            _not_set_up(),
            tr(
                "setup.slack.use_slack_add_slack",
                "To use Slack, add SLACK_BOT_TOKEN and SLACK_APP_TOKEN to .env, then restart the "
                "app.",
            ),
        )
    if bot in EXAMPLE_VALUES or app_token in EXAMPLE_VALUES:
        return _result(
            "slack",
            "error",
            tr(
                "setup.slack.slack_still_sample_tokens",
                "Slack still has the sample tokens from .env.example.",
            ),
            tr(
                "setup.slack.put_slack_app_tokens",
                "Put your Slack app's tokens in SLACK_BOT_TOKEN and SLACK_APP_TOKEN, or delete "
                "both lines if you don't use Slack, then restart the app.",
            ),
        )
    if not bot.startswith("xoxb-"):
        return _result(
            "slack",
            "error",
            tr(
                "setup.slack.slack_bot_token_missing",
                "SLACK_BOT_TOKEN is missing or isn't a bot token — those start with xoxb-.",
            ),
            tr(
                "setup.slack.copy_bot_user_oauth",
                "Copy the Bot User OAuth Token from your Slack app's OAuth & Permissions page "
                "into .env, then restart the app.",
            ),
        )
    if app_token and not app_token.startswith("xapp-"):
        return _result(
            "slack",
            "error",
            tr(
                "setup.slack.slack_app_token_app",
                "SLACK_APP_TOKEN isn't an app-level token — those start with xapp-.",
            ),
            tr(
                "setup.slack.create_app_level_token",
                "Create an app-level token with the connections:write scope on your Slack app's "
                "Basic Information page, put it in .env, then restart the app.",
            ),
        )

    probe = await _fetch(
        http, "POST", "https://slack.com/api/auth.test", headers={"Authorization": f"Bearer {bot}"}
    )
    if probe is None:
        return _result(
            "slack",
            "warn",
            tr("setup.slack.couldn_reach_slack_test", "Couldn't reach Slack to test the tokens."),
            _offline_fix(),
        )
    body = probe[1]
    if body.get("ok") is not True:
        code = str(body.get("error", ""))
        return _result(
            "slack",
            "error",
            tr("setup.slack.bot_token_refused_code", "Slack turned down SLACK_BOT_TOKEN ({code}).", code=code)
            if _SLACK_ERROR_CODE_RE.fullmatch(code)
            else tr("setup.slack.bot_token_refused", "Slack turned down SLACK_BOT_TOKEN."),
            tr(
                "setup.slack.copy_bot_user_oauth_2",
                "Copy the Bot User OAuth Token again from your Slack app's settings into .env, "
                "then restart the app.",
            ),
        )
    workspace = _clip(str(body.get("team") or tr(
        "setup.slack.your_workspace",
        "your Slack workspace",
    )))
    if not app_token:
        return _result(
            "slack",
            "warn",
            tr(
                "setup.slack.send_hear_messages_slack",
                "Can send to {workspace}, but won't hear messages: SLACK_APP_TOKEN isn't set.",
                workspace=workspace,
            ),
            tr(
                "setup.slack.turn_socket_mode_slack",
                "Turn on Socket Mode in your Slack app, add its app-level token (starts with "
                "xapp-) to .env, then restart the app.",
            ),
        )
    if snap.slack_handler is None:
        return _result(
            "slack",
            "error",
            tr(
                "setup.slack.tokens_work_slack_listener",
                "The tokens work for {workspace}, but the Slack listener didn't start.",
                workspace=workspace,
            ),
            tr(
                "setup.slack.api_log_says_why",
                "The API log says why — look for \"Failed to start Slack bot\". Fix that, then "
                "restart the app.",
            ),
        )
    try:
        listening = bool(
            await asyncio.wait_for(snap.slack_handler.client.is_connected(), PROBE_TIMEOUT_S)
        )
    except Exception as exc:  # a client state we can't read counts as not listening
        logger.info("setup status: Slack connection check failed (%s)", type(exc).__name__)
        listening = False
    if not listening:
        return _result(
            "slack",
            "warn",
            tr(
                "setup.slack.tokens_work_slack_delivering",
                "The tokens work for {workspace}, but Slack isn't delivering messages to the app "
                "yet.",
                workspace=workspace,
            ),
            tr(
                "setup.slack.lasts_more_minute_check",
                "If this lasts more than a minute, check SLACK_APP_TOKEN and that Socket Mode is "
                "on in your Slack app's settings.",
            ),
        )
    if not snap.slack_bot_id_resolved:
        return _result(
            "slack",
            "warn",
            tr(
                "setup.slack.listening_answer_follow_ups",
                "Listening in {workspace}, but it won't answer follow-ups in its threads unless "
                "they @-mention it: it couldn't look up its own Slack identity.",
                workspace=workspace,
            ),
            tr(
                "setup.slack.tries_again_about_once",
                "It tries again about once a minute while messages arrive. If this doesn't clear, "
                "check the API log for \"auth_test() failed\".",
            ),
        )
    return _channel_ready(
        snap,
        "slack",
        tr("setup.slack.connected", "Connected to {workspace} and listening.", workspace=workspace),
        actor="slack",
        roster=_Roster("slack_user_id", "slack"),
    )


# How a stopped discord.py client names what went wrong (the exception's
# class name), and what to do.
_DISCORD_STOP_KINDS: dict[str, str] = {
    "LoginFailure": "login_failure",
    "PrivilegedIntentsRequired": "privileged_intents_required",
}
_DISCORD_STOP_PROBLEMS = MessageTable("setup.discord.stop_problem", {
    "login_failure": "Discord turned down DISCORD_BOT_TOKEN.",
    "privileged_intents_required": "Discord refused the bot: it needs the Message Content intent.",
})
_DISCORD_STOP_FIXES = MessageTable("setup.discord.stop_fix", {
    "login_failure": (
        "Reset the token on the Bot tab of the Discord developer portal, paste it into .env, "
        "then restart the app."
    ),
    "privileged_intents_required": (
        "Turn on Message Content Intent on the Bot tab of the Discord developer portal, "
        "then restart the app."
    ),
})


def _discord_stop_fix(kind: str) -> tuple[str, str]:
    key = _DISCORD_STOP_KINDS[kind]
    return _DISCORD_STOP_PROBLEMS[key], _DISCORD_STOP_FIXES[key]


async def check_discord(snap: Snapshot, http: httpx.AsyncClient) -> SetupCheck:
    token = (snap.settings.discord_bot_token or "").strip()
    if not token:
        return _result(
            "discord",
            "off",
            _not_set_up(),
            tr(
                "setup.discord.use_discord_add_discord",
                "To use Discord, add DISCORD_BOT_TOKEN and DISCORD_APP_ID to .env, then restart "
                "the app.",
            ),
        )

    bot, task = snap.discord_bot, snap.discord_bot_task
    if task is not None and task.done():
        stopped_by = None if task.cancelled() else task.exception()
        kind = type(stopped_by).__name__ if stopped_by is not None else ""
        if kind in _DISCORD_STOP_KINDS:
            return _result("discord", "error", *_discord_stop_fix(kind))
        return _result(
            "discord",
            "error",
            tr("setup.discord.bot_stopped_kind", "The Discord bot stopped ({kind}).", kind=kind)
            if kind
            else tr("setup.discord.bot_stopped", "The Discord bot stopped."),
            tr(
                "setup.discord.api_log_details_fix",
                "The API log has the details. Fix that, then restart the app.",
            ),
        )
    if bot is None:
        return _result(
            "discord",
            "error",
            tr("setup.discord.discord_bot_start", "The Discord bot didn't start."),
            tr(
                "setup.discord.api_log_says_why",
                "The API log says why — look for \"Discord bot\". Fix that, then restart the app.",
            ),
        )
    if bot.is_ready():
        # discord.py stays "ready" through a dropped connection while it
        # reconnects; only the gateway socket says whether messages arrive.
        name = _clip(str(bot.user)) if bot.user is not None else tr(
            "setup.discord.the_bot",
            "the bot",
        )
        if not getattr(bot.ws, "open", False):
            return _result(
                "discord",
                "warn",
                tr(
                    "setup.discord.signed_connection_discord_dropped",
                    "Signed in as {name}, but the connection to Discord dropped and the bot is "
                    "reconnecting.",
                    name=name,
                ),
                tr(
                    "setup.discord.check_again_minute_stays",
                    "Check again in a minute. If it stays like this, check this computer's "
                    "internet connection and the API log.",
                ),
            )
        return _channel_ready(
            snap,
            "discord",
            tr("setup.discord.connected", "Connected as {name}.", name=name),
            actor="discord",
            roster=_Roster("discord_user_id", "discord"),
        )

    # Still connecting: test the token, so a bad one is named now rather than
    # whenever discord.py gives up.
    probe = await _fetch(
        http, "GET", "https://discord.com/api/v10/users/@me", headers={"Authorization": f"Bot {token}"}
    )
    if probe is None:
        return _result(
            "discord",
            "warn",
            tr(
                "setup.discord.couldn_reach_discord_test",
                "Couldn't reach Discord to test the token.",
            ),
            _offline_fix(),
        )
    if probe[0] == 401:
        return _result("discord", "error", *_discord_stop_fix("LoginFailure"))
    return _result(
        "discord",
        "warn",
        tr("setup.discord.still_connecting_discord", "Still connecting to Discord."),
        tr(
            "setup.discord.check_again_minute_stays_2",
            "Check again in a minute. If it stays like this, restart the app and read the API log.",
        ),
    )


def _telegram_reregister() -> str:
    return tr(
        "setup.telegram.reregister",
        "Set TELEGRAM_WEBHOOK_SECRET, restart the app, and register the webhook again with the same secret "
        "(docs/telegram_setup.md).",
    )


async def check_telegram(snap: Snapshot, http: httpx.AsyncClient) -> SetupCheck:
    settings = snap.settings
    token = (settings.telegram_bot_token or "").strip()
    if not token:
        return _result(
            "telegram",
            "off",
            _not_set_up(),
            tr(
                "setup.telegram.use_telegram_follow_docs",
                "To use Telegram, follow docs/telegram_setup.md.",
            ),
        )
    # Checked before the token goes into a URL, so it can't reshape one.
    if not _TELEGRAM_TOKEN_RE.fullmatch(token):
        return _result(
            "telegram",
            "error",
            tr(
                "setup.telegram.telegram_bot_token_telegram",
                "TELEGRAM_BOT_TOKEN isn't a Telegram bot token — those are digits, a colon, then "
                "letters.",
            ),
            tr(
                "setup.telegram.copy_token_botfather_gave",
                "Copy the token @BotFather gave you into .env, then restart the app.",
            ),
        )
    secret = settings.telegram_webhook_secret
    if secret and not settings.telegram_webhook_secret_valid:
        return _result(
            "telegram",
            "error",
            tr(
                "setup.telegram.telegram_webhook_secret_characters",
                "TELEGRAM_WEBHOOK_SECRET has characters Telegram won't accept, so the app turns "
                "away every message.",
            ),
            tr(
                "setup.telegram.use_1_256_letters",
                "Use 1–256 letters, digits, _ or - (openssl rand -hex 32 makes one), restart the "
                "app, and register the webhook again with it (docs/telegram_setup.md).",
            ),
        )
    if snap.local_login and not secret:
        return _result(
            "telegram",
            "error",
            tr(
                "setup.telegram.local_login_turns_away",
                "Local login turns away Telegram messages unless TELEGRAM_WEBHOOK_SECRET is set.",
            ),
            _telegram_reregister(),
        )

    base = f"https://api.telegram.org/bot{token}"
    me = await _fetch(http, "GET", f"{base}/getMe")
    if me is None:
        return _result(
            "telegram",
            "warn",
            tr(
                "setup.telegram.couldn_reach_telegram_test",
                "Couldn't reach Telegram to test the token.",
            ),
            _offline_fix(),
        )
    if me[1].get("ok") is not True:
        return _result(
            "telegram",
            "error",
            tr(
                "setup.telegram.telegram_turned_down_telegram",
                "Telegram turned down TELEGRAM_BOT_TOKEN.",
            ),
            tr(
                "setup.telegram.ask_botfather_token_again",
                "Ask @BotFather for the token again (/token), paste it into .env, then restart "
                "the app.",
            ),
        )
    me_result = me[1].get("result")
    username = me_result.get("username") if isinstance(me_result, dict) else None
    bot_name = f"@{_clip(str(username))}" if username else tr("setup.telegram.the_bot", "The bot")

    hook = await _fetch(http, "GET", f"{base}/getWebhookInfo")
    if hook is None:
        return _result(
            "telegram",
            "warn",
            tr(
                "setup.telegram.works_telegram_say_where",
                "{bot_name} works, but Telegram didn't say where it delivers messages.",
                bot_name=bot_name,
            ),
            _offline_fix(),
        )
    info = hook[1].get("result")
    if not isinstance(info, dict):
        info = {}
    url = str(info.get("url") or "")
    if not url:
        return _result(
            "telegram",
            "warn",
            tr(
                "setup.telegram.works_telegram_know_where",
                "{bot_name} works, but Telegram doesn't know where to deliver its messages.",
                bot_name=bot_name,
            ),
            tr(
                "setup.telegram.register_app_webhook_telegram",
                "Register this app's /webhook/telegram address with setWebhook — see "
                "docs/telegram_setup.md.",
            ),
        )
    if not urlsplit(url).path.endswith("/webhook/telegram"):
        return _result(
            "telegram",
            "warn",
            tr(
                "setup.telegram.telegram_delivers_messages_address",
                "Telegram delivers {bot_name}'s messages to an address that isn't this app's "
                "/webhook/telegram.",
                bot_name=bot_name,
            ),
            tr(
                "setup.telegram.register_webhook_again_app",
                "Register the webhook again with this app's address — see docs/telegram_setup.md.",
            ),
        )
    error_at = info.get("last_error_date")
    if isinstance(error_at, int) and snap.now.timestamp() - error_at < _RECENT_FAILURE_S:
        reason = _clip(str(info.get("last_error_message") or tr(
            "setup.telegram.no_reason",
            "no reason given",
        )))
        return _result(
            "telegram",
            "warn",
            tr(
                "setup.telegram.telegram_couldn_deliver_last",
                "Telegram couldn't deliver {bot_name}'s last message: {reason}.",
                bot_name=bot_name,
                reason=reason,
            ),
            tr(
                "setup.telegram.401_means_secret_registered",
                "A 401 means the secret registered with setWebhook doesn't match "
                "TELEGRAM_WEBHOOK_SECRET — register the webhook again (docs/telegram_setup.md). "
                "Otherwise, check this app can be reached at that address.",
            ),
        )
    if not secret:
        return _result(
            "telegram",
            "warn",
            tr(
                "setup.telegram.receiving_messages_anyone_who",
                "{bot_name} is receiving messages, but anyone who finds the webhook address can "
                "send fake ones: TELEGRAM_WEBHOOK_SECRET isn't set.",
                bot_name=bot_name,
            ),
            _telegram_reregister(),
        )
    return _channel_ready(
        snap,
        "telegram",
        tr("setup.telegram.receiving", "{bot_name} is receiving messages.", bot_name=bot_name),
        actor="telegram",
        roster=_Roster("telegram_chat_id", "telegram"),
    )


def _readable_service_account(path: str) -> bool:
    try:
        with Path(path).expanduser().open("rb") as handle:
            raw = handle.read(_SERVICE_ACCOUNT_KEY_MAX_BYTES + 1)
        if len(raw) > _SERVICE_ACCOUNT_KEY_MAX_BYTES:
            return False
        key = json.loads(raw)
    except (OSError, ValueError):
        return False
    return isinstance(key, dict) and bool(key.get("client_email"))


def check_google_chat(snap: Snapshot) -> SetupCheck:
    settings = snap.settings
    project = (settings.google_chat_project_number or "").strip()
    key_file = (settings.google_chat_service_account_file or "").strip()
    key_email = (settings.google_chat_service_account_email or "").strip()
    if not (project or key_file or key_email):
        return _result(
            "google_chat",
            "off",
            _not_set_up(),
            tr(
                "setup.google_chat.use_google_chat_follow",
                "To use Google Chat, follow docs/google_chat_setup.md.",
            ),
        )
    if not re.fullmatch(r"[0-9]+", project):
        return _result(
            "google_chat",
            "error",
            tr(
                "setup.google_chat.google_chat_project_number",
                "GOOGLE_CHAT_PROJECT_NUMBER needs your Google Cloud project's number — digits "
                "only, not the project ID.",
            ),
            tr(
                "setup.google_chat.copy_project_number_google",
                "Copy the project number from the Google Cloud console's dashboard into .env, "
                "then restart the app.",
            ),
        )
    if not (key_file or key_email):
        return _result(
            "google_chat",
            "error",
            tr(
                "setup.google_chat.google_chat_service_account",
                "Google Chat has no service account to reply with.",
            ),
            tr(
                "setup.google_chat.set_google_chat_service",
                "Set GOOGLE_CHAT_SERVICE_ACCOUNT_FILE or GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL in "
                ".env — docs/google_chat_setup.md says which — then restart the app.",
            ),
        )
    if key_file and not _readable_service_account(key_file):
        return _result(
            "google_chat",
            "error",
            tr(
                "setup.google_chat.read_service_account_key",
                "Can't read a service-account key from the file GOOGLE_CHAT_SERVICE_ACCOUNT_FILE "
                "names.",
            ),
            tr(
                "setup.google_chat.point_full_path_json",
                "Point it at the full path of the JSON key you downloaded from Google Cloud, then "
                "restart the app.",
            ),
        )
    return _channel_ready(
        snap,
        "google_chat",
        tr(
            "setup.google_chat.set_up_google_chat",
            "Set up. Google Chat delivers messages to this app's /webhook/google-chat address "
            "(this page can't test that part).",
        ),
        actor="google_chat",
        roster=None,
    )


def _google_sign_in_missing() -> str | None:
    """The Google credentials the workspace-mcp child can't sign in without,
    named for the fix, or None. Read from this process's environment because
    that is what the MCP gateway forwards to it."""
    def have(key: str) -> bool:
        return bool(os.environ.get(key, "").strip())

    if (os.environ.get("GWORKSPACE_AUTH_MODE", "").strip() or "oauth") == "service_account":
        if have("GOOGLE_SERVICE_ACCOUNT_KEY_JSON") or have("GOOGLE_SERVICE_ACCOUNT_KEY_FILE"):
            return None
        return "GOOGLE_SERVICE_ACCOUNT_KEY_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_FILE"
    if have("GOOGLE_OAUTH_CLIENT_ID") and have("GOOGLE_OAUTH_CLIENT_SECRET"):
        return None
    return "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET"


def check_gmail(snap: Snapshot) -> SetupCheck:
    from openexecutive.orchestrator.mcp_gateway import configured_server_names

    settings = snap.settings
    servers = configured_server_names(settings.mcp_servers_config_path) if settings.mcp_enabled else []
    if "google_workspace" not in servers:
        return _result(
            "gmail",
            "off",
            tr(
                "setup.gmail.set_up_executive_read",
                "Not set up: the Executive can't read or send email.",
            ),
            tr(
                "setup.gmail.connect_gmail_follow_google",
                "To connect Gmail, follow the Google Workspace steps in .env.example.",
            ),
        )
    if snap.mcp_gateway is None:
        return _result(
            "gmail",
            "error",
            tr(
                "setup.gmail.connection_google_start_email",
                "The connection to Google didn't start, so email is off.",
            ),
            tr(
                "setup.gmail.api_log_says_why",
                "The API log says why — look for \"MCP gateway\". Fix that, then restart the app.",
            ),
        )
    missing = _google_sign_in_missing()
    if missing:
        return _result(
            "gmail",
            "error",
            tr(
                "setup.gmail.google_sign_executive_set",
                "Google can't sign the Executive in: {missing} isn't set.",
                missing=missing,
            ),
            tr(
                "setup.gmail.set_env_google_workspace",
                "Set it in .env (the Google Workspace steps there explain how), then restart the "
                "app.",
            ),
        )
    if snap.last_inbound.get("email") is None:
        summary = tr(
            "setup.gmail.connected_no_email_yet",
            "Connected. The Executive checks {address}'s inbox every {seconds} seconds. No email has "
            "come in yet — if you've sent one, sign Google in once as that address "
            "(scripts/mint-google-token.py).",
            address=settings.exec_email_address,
            seconds=settings.email_poll_interval_seconds,
        )
    else:
        summary = tr(
            "setup.gmail.connected",
            "Connected. The Executive checks {address}'s inbox every {seconds} seconds.",
            address=settings.exec_email_address,
            seconds=settings.email_poll_interval_seconds,
        )
    return _channel_ready(snap, "gmail", summary, actor="email", roster=None)


# The inbox watcher's states worth a look (the rest are routine).
_INBOX_WARN = frozenset({"error", "rate_limited", "backlog_full"})


async def check_your_gmail(snap: Snapshot) -> SetupCheck:
    """The owner's own mailbox (Gmail or Outlook), for Act as me (optional).
    Only a saved credential reaches the mail service: a missing one is
    reported without a call."""
    from openexecutive.delegation.gmail import gmail_status, status_message
    from openexecutive.delegation.inbox import get_watch
    from openexecutive.delegation.inbox import status_message as inbox_status_message
    from openexecutive.delegation.settings import is_enabled

    owner = snap.principal
    if owner is None or not owner.email:
        return _result(
            "your_gmail",
            "off",
            tr(
                "setup.your_gmail.set_up_optional_act",
                "Not set up (optional): Act as me needs an owner with an email on the team list.",
            ),
        )
    on = await asyncio.to_thread(is_enabled, owner.id)
    try:
        status = await asyncio.wait_for(gmail_status(owner.email), PROBE_TIMEOUT_S)
    except TimeoutError:
        return _result(
            "your_gmail",
            "warn",
            tr(
                "setup.your_gmail.timed_out",
                "Your mail service didn't answer within {seconds} seconds.",
                seconds=f"{PROBE_TIMEOUT_S:.0f}",
            ),
            tr("setup.your_gmail.click_check_again_moment", "Click Check again in a moment."),
            link="/settings",
        )
    if status == "connected":
        watch = await asyncio.to_thread(get_watch, owner.id) if on and owner.id is not None else None
        if watch is not None and watch.enabled:
            if watch.status in _INBOX_WARN:
                return _result(
                    "your_gmail",
                    "warn",
                    tr(
                        "setup.your_gmail.inbox_watch_status",
                        "Connected to {email}. Draft replies to my inbox: {status}",
                        email=owner.email,
                        status=inbox_status_message(watch.status),
                    ),
                    link="/settings",
                )
            summary = tr(
                "setup.your_gmail.on_watching",
                "Connected to {email}. Act as me is on: the Executive can draft replies as you, in "
                "your own mailbox. Draft replies to my inbox is on.",
                email=owner.email,
            )
        elif on:
            summary = tr(
                "setup.your_gmail.on",
                "Connected to {email}. Act as me is on: the Executive can draft replies as you, in "
                "your own mailbox.",
                email=owner.email,
            )
        else:
            summary = tr(
                "setup.your_gmail.off",
                "Connected to {email}. Turn Act as me on in Settings to let the Executive draft "
                "replies as you.",
                email=owner.email,
            )
        return _result("your_gmail", "ok", summary, link="/settings")
    if status == "not_configured":
        return _result(
            "your_gmail",
            "warn" if on else "off",
            tr(
                "setup.your_gmail.set_up_optional_executive",
                "Not set up (optional): the Executive can't draft emails as you in your own "
                "mailbox.",
            ),
            tr(
                "setup.your_gmail.signed_yourself_run_scripts",
                "Signed in as yourself, run scripts/connect-own-gmail.py for Gmail or "
                "scripts/connect-own-outlook.py for Outlook (see .env.example → Act as me), then "
                "put the file it writes in DELEGATION_GOOGLE_CREDENTIALS_DIR.",
            ),
            link="/settings",
        )
    if status == "shared_mailbox" and not on:
        # Not a fault while it's off: the owner simply uses the Executive's
        # own address, and Act as me can't be turned on that way.
        return _result(
            "your_gmail",
            "off",
            tr(
                "setup.your_gmail.not_set_up_status",
                "Not set up (optional): {status}",
                status=status_message(status),
            ),
            link="/settings",
        )
    return _result("your_gmail", "error" if on else "warn", status_message(status), link="/settings")


# ---------------------------------------------------------------------------
# What runs in the background
# ---------------------------------------------------------------------------


def check_scheduler(snap: Snapshot) -> SetupCheck:
    from openexecutive.scheduler.pause import get_pause_state
    from openexecutive.scheduler.runner import scheduler_heartbeat

    settings = snap.settings
    if not settings.scheduler_enabled:
        return _result(
            "scheduler",
            "off",
            tr(
                "setup.scheduler.turned_off_briefs_reminders",
                "Turned off, so no briefs, reminders or follow-ups go out.",
            ),
            tr(
                "setup.scheduler.set_scheduler_enabled_true",
                "Set SCHEDULER_ENABLED=true in .env, then restart the app.",
            ),
        )
    # Liveness first: a paused scheduler still ticks, so one that has
    # stopped needs a restart, not the Resume button.
    started_at, last_tick = scheduler_heartbeat()
    restart_fix = tr(
        "setup.scheduler.restart_app_look_api",
        "Restart the app, and look in the API log for lines from \"scheduler\".",
    )
    if started_at is None:
        return _result(
            "scheduler",
            "error",
            tr(
                "setup.scheduler.scheduler_running_briefs_follow",
                "The scheduler isn't running, so briefs and follow-ups won't go out.",
            ),
            restart_fix,
        )
    if last_tick is None:
        waited = (snap.now - started_at).total_seconds()
        if waited < _SCHEDULER_STARTUP_GRACE_S:
            return _result(
                "scheduler",
                "warn",
                tr("setup.scheduler.starting_up", "Starting up."),
                tr("setup.scheduler.check_again_minute", "Check again in a minute."),
            )
        return _result(
            "scheduler",
            "error",
            tr(
                "setup.scheduler.scheduler_started_hasn_finished",
                "The scheduler started {ago} but hasn't finished a check since.",
                ago=_ago(waited),
            ),
            restart_fix,
        )
    ticked_at, outcome = last_tick
    silent_for = (snap.now - ticked_at).total_seconds()
    stale_after = max(
        _SCHEDULER_STALE_TICKS * settings.scheduler_poll_interval_seconds, _SCHEDULER_STALE_FLOOR_S
    )
    if silent_for > stale_after:
        return _result(
            "scheduler",
            "error",
            tr(
                "setup.scheduler.scheduler_stopped_last_check",
                "The scheduler has stopped: its last check was {ago}.",
                ago=_ago(silent_for),
            ),
            restart_fix,
        )
    if outcome == "failed":
        return _result(
            "scheduler",
            "error",
            tr(
                "setup.scheduler.scheduler_last_check_hit",
                "The scheduler's last check hit an error.",
            ),
            tr(
                "setup.scheduler.look_api_log_scheduler",
                "Look in the API log for \"scheduler tick failed\" to see why.",
            ),
        )
    if get_pause_state().paused:
        return _result(
            "scheduler",
            "warn",
            tr(
                "setup.scheduler.paused_briefs_reminders_email",
                "Paused: briefs, reminders and email checks wait until you resume.",
            ),
            tr(
                "setup.scheduler.press_resume_banner_top",
                "Press Resume in the banner at the top of the page.",
            ),
        )
    if outcome == "waiting_for_company":
        return _result(
            "scheduler",
            "warn",
            tr(
                "setup.scheduler.waiting_company_setup_nothing",
                "Waiting for company setup: nothing scheduled runs until the setup interview is "
                "done.",
            ),
            tr("setup.scheduler.finish_setup_interview", "Finish the setup interview."),
            link="/onboard",
        )
    return _result("scheduler", "ok", tr("setup.scheduler.running", "Running."))


# Delivery channel (scheduler.runner.delivery_order) → its light on this page.
_DELIVERY_CHANNEL_CHECKS: dict[str, str] = {
    "email": "gmail",
    "slack_dm": "slack",
    "discord_dm": "discord",
    "telegram": "telegram",
}


def check_brief(snap: Snapshot) -> SetupCheck:
    """When the morning brief and end-of-day digest go out, and where."""
    from zoneinfo import ZoneInfo

    from openexecutive.briefing.brief_state import (
        BRIEF_KINDS,
        brief_name,
        channel_name,
        channel_phrase,
        current_problem,
        delivery_problem,
    )
    from openexecutive.scheduler.runner import delivery_order

    if not snap.settings.scheduler_enabled:
        return _result("brief", "off", tr(
            "setup.brief.scheduler_off",
            "Off, because the scheduler is turned off.",
        ))
    principal = snap.principal
    if principal is None:
        problem, fix = delivery_problem("no_owner")
        return _result("brief", "warn", tr(
            "setup.brief.not_sent",
            "Not sent: {problem}.",
            problem=problem,
        ), fix, link="/people")
    plan = delivery_order(principal, email_ready=snap.brief_email_ready)
    if not plan:
        problem, fix = delivery_problem("no_channel")
        return _result(
            "brief",
            "warn",
            tr("setup.brief.app_only", "Kept in the app only: {problem}.", problem=problem),
            fix,
            link=f"/people/{principal.id}",
        )
    last = snap.brief_delivery
    reason = current_problem(last, has_owner=True, can_deliver=True)
    if last is not None and reason is not None:
        problem, fix = delivery_problem(reason)
        return _result(
            "brief",
            "error",
            tr(
                "setup.brief.last_not_sent",
                "Your last {brief_name} wasn't sent: {problem}.",
                brief_name=brief_name(last.kind),
                problem=problem,
            ),
            fix,
        )
    if last is not None and last.channel and last.channel != plan[0]:
        # It got through, but not on the first channel it tried: that one is
        # broken, and every brief is going by the backup.
        return _result(
            "brief",
            "warn",
            tr(
                "setup.brief.went_by_backup",
                "Your last {brief} went {channel}, because {first} didn't work.",
                brief=brief_name(last.kind),
                channel=channel_phrase(last.channel),
                first=channel_name(plan[0]),
            ),
            tr(
                "setup.brief.see_light",
                'See the "{light}" light on this page.',
                light=_label(_DELIVERY_CHANNEL_CHECKS[plan[0]]),
            ),
        )
    zone = ZoneInfo(snap.brief_zone or "UTC")
    times = [
        tr(
            "setup.brief.time",
            "the {brief} at {time}",
            brief=brief_name(kind),
            time=f"{snap.brief_next_runs[kind].astimezone(zone):%H:%M}",
        )
        for kind in BRIEF_KINDS
        if kind in snap.brief_next_runs
    ]
    channel = channel_phrase(plan[0])
    if snap.brief_zone is None:
        if times:
            summary = tr(
                "setup.brief.sent_utc_at",
                "Sent to you {channel}: {times}, in UTC because no time zone is set.",
                channel=channel,
                times=_join_and(times),
            )
        else:
            summary = tr(
                "setup.brief.sent_utc",
                "Sent to you {channel}, in UTC because no time zone is set.",
                channel=channel,
            )
        return _result(
            "brief",
            "warn",
            summary,
            tr("setup.brief.set_zone", "Set your time zone in Settings."),
            link="/settings",
        )
    if times:
        summary = tr(
            "setup.brief.sent_at",
            "Sent to you {channel}: {times} ({zone}).",
            channel=channel,
            times=_join_and(times),
            zone=snap.brief_zone,
        )
    else:
        summary = tr("setup.brief.sent", "Sent to you {channel} ({zone}).", channel=channel, zone=snap.brief_zone)
    return _result("brief", "ok", summary)


async def check_memory(snap: Snapshot) -> SetupCheck:
    from openexecutive.api.routes.health import honcho_health

    probe = await honcho_health()
    status = probe.get("status")
    if status == "disabled":
        return _result(
            "memory",
            "off",
            tr(
                "setup.memory.off_optional_service_remembers",
                "Off. This optional service remembers people across conversations.",
            ),
            tr(
                "setup.memory.turn_set_honcho_enabled",
                "To turn it on, set HONCHO_ENABLED=true and HONCHO_API_KEY in .env, then restart "
                "the app.",
            ),
        )
    if status == "ok":
        return _result("memory", "ok", tr("setup.memory.connected", "Connected to Honcho."))
    error_type = probe.get("error_type", "unknown error")
    return _result(
        "memory",
        "error",
        tr("setup.memory.reach_honcho", "Can't reach Honcho ({error_type}).", error_type=error_type),
        tr(
            "setup.memory.check_honcho_api_key",
            "Check HONCHO_API_KEY and HONCHO_BASE_URL in .env, then restart the app.",
        ),
    )


# ---------------------------------------------------------------------------
# Running them all
# ---------------------------------------------------------------------------

_INBOUND_ACTORS = ("slack", "discord", "telegram", "google_chat", "email")


def _latest_inbound() -> dict[str, AuditEvent | None]:
    from openexecutive.audit import get_audit_logger

    audit = get_audit_logger()
    latest: dict[str, AuditEvent | None] = {}
    for actor in _INBOUND_ACTORS:
        rows = audit.query(event_type="integration_inbound", actor=actor, limit=1)
        latest[actor] = rows[0] if rows else None
    return latest


def gather_snapshot(settings: Settings, *, local_login: bool, app_state: Any) -> Snapshot:
    """Read everything the checks need. Blocking (SQLite): run it off the loop."""
    from openexecutive.briefing.brief_state import last_delivery_outcome
    from openexecutive.integrations.slack_bot import bot_user_id
    from openexecutive.memory.workspace_settings import get_user_timezone, get_workspace
    from openexecutive.people.store import find_principal_person, list_people
    from openexecutive.scheduler.runner import email_ready, next_brief_runs

    now = datetime.now(UTC)
    zone_chosen = (
        get_workspace().timezone is not None
        or settings.user_timezone.strip() not in ("", "UTC")
    )
    return Snapshot(
        settings=settings,
        now=now,
        local_login=local_login,
        people=list_people(),
        principal=find_principal_person(),
        last_inbound=_latest_inbound(),
        discord_bot=getattr(app_state, "discord_bot", None),
        discord_bot_task=getattr(app_state, "discord_bot_task", None),
        slack_handler=getattr(app_state, "slack_handler", None),
        slack_bot_id_resolved=bot_user_id() is not None,
        mcp_gateway=getattr(app_state, "mcp_gateway", None),
        brief_delivery=last_delivery_outcome(),
        brief_email_ready=email_ready(),
        brief_next_runs=next_brief_runs(now),
        brief_zone=get_user_timezone().key if zone_chosen else None,
    )


def _check_runners(
    snap: Snapshot, http: httpx.AsyncClient
) -> dict[str, Callable[[], Awaitable[SetupCheck]]]:
    def off_loop(check: Callable[[Snapshot], SetupCheck]) -> Callable[[], Awaitable[SetupCheck]]:
        # The synchronous checks read files and SQLite.
        return lambda: asyncio.to_thread(check, snap)

    return {
        "ai_model": lambda: check_ai_model(snap),
        "company": off_loop(check_company),
        "owner": off_loop(check_owner),
        "exec_email": off_loop(check_exec_email),
        "api_secret": off_loop(check_api_protection),
        "gmail": off_loop(check_gmail),
        "your_gmail": lambda: check_your_gmail(snap),
        "slack": lambda: check_slack(snap, http),
        "discord": lambda: check_discord(snap, http),
        "telegram": lambda: check_telegram(snap, http),
        "google_chat": off_loop(check_google_chat),
        "scheduler": off_loop(check_scheduler),
        "brief": off_loop(check_brief),
        "memory": lambda: check_memory(snap),
    }


async def run_checks(snap: Snapshot, http: httpx.AsyncClient) -> list[SetupCheck]:
    """Every check at once, in ``LABELS`` order. A check that crashes turns
    red on its own instead of taking the page down."""
    runners = _check_runners(snap, http)

    async def guarded(check_id: str) -> SetupCheck:
        try:
            return await runners[check_id]()
        except Exception as exc:
            logger.warning("setup status: the %s check crashed (%s)", check_id, type(exc).__name__)
            return _result(
                check_id,
                "error",
                tr("setup.check_failed", "This check couldn't run."),
                tr(
                    "setup.check_failed_fix",
                    "The API log has the details — look for \"setup status\".",
                ),
            )

    return list(await asyncio.gather(*(guarded(check_id) for check_id in LABELS)))
