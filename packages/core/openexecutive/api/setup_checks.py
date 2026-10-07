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

from openexecutive.utils.i18n import is_korean
from openexecutive.utils.i18n import localized as _t

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

_OFFLINE_FIX = "Check this computer's internet connection, then check again."
_RESTART = "then restart the app."
_RESTART_KO = "앱을 다시 시작하세요."


def _offline_fix() -> str:
    return _t(_OFFLINE_FIX, "이 컴퓨터의 인터넷 연결을 확인한 뒤 다시 점검하세요.")


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
LABELS: dict[str, str] = {
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
}
# LABELS in Korean (OE_LANGUAGE=KOREAN). Same keys.
_LABELS_KO: dict[str, str] = {
    "ai_model": "AI 모델",
    "company": "회사 설정",
    "owner": "소유자",
    "exec_email": "Executive의 이메일 주소",
    "api_secret": "API 보호",
    "gmail": "이메일(Gmail)",
    "your_gmail": "내 메일함(나 대신 작성)",
    "slack": "Slack",
    "discord": "Discord",
    "telegram": "Telegram",
    "google_chat": "Google Chat",
    "scheduler": "일일 일정",
    "brief": "일일 브리핑",
    "memory": "장기 메모리(Honcho)",
}


def _label(check_id: str) -> str:
    return (_LABELS_KO if is_korean() else LABELS)[check_id]


def _not_set_up() -> str:
    return _t("Not set up.", "설정되지 않았어요.")


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
    if is_korean():
        if minutes < 1:
            return "방금 전"
        return f"{minutes}분 전" if minutes < 120 else f"{minutes // 60}시간 전"
    if minutes < 1:
        return "less than a minute ago"
    if minutes < 120:
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    return f"{minutes // 60} hours ago"


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
        using = " and ".join(
            name
            for name, on in (
                ("OpenRouter", settings.openrouter_enabled),
                ("local models", settings.local_models_enabled),
            )
            if on
        )
        using_ko = ", ".join(
            name
            for name, on in (("OpenRouter", settings.openrouter_enabled), ("로컬 모델", settings.local_models_enabled))
            if on
        )
        return _result(
            "ai_model",
            "ok",
            _t(
                f"Using {using} instead of Anthropic. This page doesn't test that connection.",
                f"Anthropic 대신 {using_ko} 사용 중이에요. 이 페이지는 그 연결을 점검하지 않아요.",
            ),
        )
    if key in EXAMPLE_VALUES:
        return _result(
            "ai_model",
            "error",
            _t(
                "ANTHROPIC_API_KEY still has the sample value from .env.example, so the Executive can't answer.",
                "ANTHROPIC_API_KEY가 아직 .env.example의 샘플 값이라 Executive가 답할 수 없어요.",
            ),
            _t(
                f"Paste your key from console.anthropic.com over it in the .env file, {_RESTART}",
                f".env 파일에서 그 값을 console.anthropic.com의 키로 바꾸고 {_RESTART_KO}",
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
            _t(
                "Anthropic turned down the key in ANTHROPIC_API_KEY.",
                "Anthropic이 ANTHROPIC_API_KEY의 키를 거부했어요.",
            ),
            _t(
                f"Create a new key at console.anthropic.com, paste it into the .env file, {_RESTART}",
                f"console.anthropic.com에서 새 키를 만들어 .env 파일에 붙여 넣고 {_RESTART_KO}",
            ),
        )
    except (anthropic.BadRequestError, anthropic.PermissionDeniedError) as exc:
        if not settings.anthropic_workspace_id:
            return _result(
                "ai_model",
                "error",
                _t(
                    f"Anthropic refused requests made with this key (HTTP {exc.status_code}).",
                    f"Anthropic이 이 키로 보낸 요청을 거부했어요(HTTP {exc.status_code}).",
                ),
                _t(
                    "If the key was created for your whole organisation rather than inside a workspace, set "
                    f"ANTHROPIC_WORKSPACE_ID in .env to the workspace to use, {_RESTART}",
                    "워크스페이스 안이 아니라 조직 전체용으로 만든 키라면 .env의 ANTHROPIC_WORKSPACE_ID를 "
                    f"쓸 워크스페이스로 설정하고 {_RESTART_KO}",
                ),
            )
        return _result(
            "ai_model",
            "error",
            _t(
                "Anthropic refused requests made with this key and ANTHROPIC_WORKSPACE_ID "
                f"(HTTP {exc.status_code}).",
                f"Anthropic이 이 키와 ANTHROPIC_WORKSPACE_ID로 보낸 요청을 거부했어요(HTTP {exc.status_code}).",
            ),
            _t(
                f"Check in console.anthropic.com that the key belongs to that workspace, {_RESTART}",
                f"console.anthropic.com에서 키가 그 워크스페이스에 속하는지 확인하고 {_RESTART_KO}",
            ),
        )
    except anthropic.RateLimitError:
        return _result(
            "ai_model",
            "warn",
            _t(
                "The key works, but Anthropic says it is over its rate limit right now.",
                "키는 작동하지만 지금은 Anthropic 사용량 한도를 넘었어요.",
            ),
            _t(
                "Wait a minute and check again. If it keeps happening, raise the limit in console.anthropic.com.",
                "1분 뒤 다시 점검하세요. 계속 그렇다면 console.anthropic.com에서 한도를 올리세요.",
            ),
        )
    except anthropic.APIStatusError as exc:
        return _result(
            "ai_model",
            "warn",
            _t(
                f"Anthropic had a problem answering (HTTP {exc.status_code}). That is usually brief.",
                f"Anthropic 응답에 문제가 있었어요(HTTP {exc.status_code}). 보통 금방 풀려요.",
            ),
            _t("Check again in a few minutes.", "몇 분 뒤 다시 점검하세요."),
        )
    except (anthropic.APIConnectionError, TimeoutError):
        return _result(
            "ai_model",
            "warn",
            _t("Couldn't reach Anthropic to test the key.", "Anthropic에 연결하지 못해 키를 점검하지 못했어요."),
            _offline_fix(),
        )
    finally:
        await client.close()
    return _result("ai_model", "ok", _t("Connected to Anthropic.", "Anthropic에 연결됐어요."))


def check_company(snap: Snapshot) -> SetupCheck:
    from openexecutive.onboarding.profile_builder import load_or_create_profile

    profile = load_or_create_profile(snap.settings.company_profile_path)
    if profile.is_empty():
        return _result(
            "company",
            "warn",
            _t(
                "Not done yet: the Executive doesn't know your company.",
                "아직 설정 전이에요. Executive가 회사에 대해 몰라요.",
            ),
            _t(
                "Run the setup interview: describe your business, then check what the Executive drafts.",
                "설정 인터뷰를 진행하세요. 하는 일을 설명하고, Executive가 쓴 초안을 확인하면 돼요.",
            ),
            link="/onboard",
        )
    return _result("company", "ok", _t(f"Set up for {_clip(profile.name)}.", f"{_clip(profile.name)} 회사 정보가 설정됐어요."))


def check_owner(snap: Snapshot) -> SetupCheck:
    owner = snap.principal
    if owner is None:
        return _result(
            "owner",
            "warn",
            _t(
                "Nobody on the team list is marked as the owner.",
                "팀 목록에 소유자로 표시된 사람이 없어요.",
            ),
            _t(
                "Finish the setup interview — it asks who the owner is.",
                "설정 인터뷰를 마치세요. 인터뷰에서 소유자가 누구인지 물어요.",
            ),
            link="/onboard",
        )
    if snap.local_login:
        return _result(
            "owner",
            "ok",
            _t(
                f"{owner.full_name} is the owner. Local login signs you in as them.",
                f"{owner.full_name} 님이 소유자예요. 로컬 로그인을 하면 이 사람으로 로그인돼요.",
            ),
        )
    if not owner.email:
        return _result(
            "owner",
            "warn",
            _t(
                f"{owner.full_name} is the owner, but has no email on the team list, so the app won't recognise "
                "them when they sign in — owner-only actions will be refused.",
                f"{owner.full_name} 님이 소유자지만 팀 목록에 이메일이 없어서 로그인해도 앱이 알아보지 못해요. "
                "소유자만 할 수 있는 작업은 거부돼요.",
            ),
            _t(
                "Signed in as them, run the setup interview again: saving it adds the address they "
                "signed in with to their entry.",
                "그 사람으로 로그인해서 설정 인터뷰를 다시 진행하세요. 저장하면 로그인한 주소가 "
                "그 사람의 정보에 추가돼요.",
            ),
            link="/onboard",
        )
    return _result(
        "owner",
        "ok",
        _t(f"{owner.full_name} ({owner.email}) is the owner.", f"{owner.full_name}({owner.email}) 님이 소유자예요."),
    )


def check_exec_email(snap: Snapshot) -> SetupCheck:
    address = snap.settings.exec_email_address.strip()
    fix = _t(
        f"Set EXEC_EMAIL_ADDRESS in .env to the Gmail address the Executive sends from, {_RESTART}",
        f".env의 EXEC_EMAIL_ADDRESS를 Executive가 메일을 보낼 Gmail 주소로 설정하고 {_RESTART_KO}",
    )
    if "@" not in address:
        return _result(
            "exec_email",
            "error",
            _t("EXEC_EMAIL_ADDRESS isn't an email address.", "EXEC_EMAIL_ADDRESS가 이메일 주소가 아니에요."),
            fix,
        )
    if is_example_email(address):
        return _result(
            "exec_email",
            "warn",
            _t(
                f"EXEC_EMAIL_ADDRESS is still the sample address {address}. Chat works without a real "
                "one; email doesn't.",
                f"EXEC_EMAIL_ADDRESS가 아직 샘플 주소({address})예요. 채팅은 실제 주소 없이도 되지만 "
                "이메일은 안 돼요.",
            ),
            fix,
        )
    return _result(
        "exec_email",
        "ok",
        _t(f"The Executive sends email as {address}.", f"Executive는 {address} 주소로 이메일을 보내요."),
    )


def check_api_protection(snap: Snapshot) -> SetupCheck:
    if os.environ.get("BACKEND_SHARED_SECRET", "").strip():
        from openexecutive.api.caller import signing_on

        if signing_on():
            return _result(
                "api_secret",
                "ok",
                _t(
                    "Only the web app can use the API, and it signs who is signed in.",
                    "웹 앱만 API를 쓸 수 있고, 누가 로그인했는지 서명해서 보내요.",
                ),
            )
        return _result(
            "api_secret",
            "warn",
            _t(
                "Only the web app can use the API, but it takes the web app's word for who is "
                "signed in: anyone holding BACKEND_SHARED_SECRET can act as anyone, the owner "
                "included. Until that's fixed, a reply drafted in your inbox can't be sent from here.",
                "웹 앱만 API를 쓸 수 있지만, 누가 로그인했는지는 웹 앱이 알려 주는 대로 믿어요. "
                "BACKEND_SHARED_SECRET을 가진 사람은 소유자를 포함해 누구로든 행세할 수 있어요. "
                "이 문제를 고치기 전에는 받은편지함에 쓴 답장 초안을 여기서 보낼 수 없어요.",
            ),
            _t(
                "Run scripts/make-caller-keys.py once, set CALLER_ASSERTION_PRIVATE_KEY on the web "
                "app and CALLER_ASSERTION_PUBLIC_KEYS on the API, then restart both (docs/auth.md).",
                "scripts/make-caller-keys.py를 한 번 실행하고, 웹 앱에는 CALLER_ASSERTION_PRIVATE_KEY를, "
                "API에는 CALLER_ASSERTION_PUBLIC_KEYS를 설정한 뒤 둘 다 다시 시작하세요(docs/auth.md).",
            ),
        )
    if snap.local_login:
        return _result(
            "api_secret",
            "ok",
            _t(
                "Not needed: with local login the API only answers requests addressed to this computer.",
                "필요 없어요. 로컬 로그인에서는 API가 이 컴퓨터로 온 요청에만 응답해요.",
            ),
        )
    return _result(
        "api_secret",
        "warn",
        _t(
            "The API has no shared secret, so anything that can reach it can use it.",
            "API에 공유 비밀 값이 없어서 접근할 수 있는 누구나 API를 쓸 수 있어요.",
        ),
        _t(
            "Fine on your own computer. On a server, set BACKEND_SHARED_SECRET to the same random value for both "
            "apps (openssl rand -hex 32), then restart them. Sending drafted replies from the web app also "
            "needs signed sign-ins (docs/auth.md).",
            "내 컴퓨터에서는 괜찮아요. 서버에서는 두 앱의 BACKEND_SHARED_SECRET을 같은 임의 값"
            "(openssl rand -hex 32)으로 설정하고 다시 시작하세요. 웹 앱에서 답장 초안을 보내려면 "
            "서명된 로그인도 필요해요(docs/auth.md).",
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
    id_name: str
    id_name_ko: str = ""


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
        id_ko = roster.id_name_ko or roster.id_name
        if not any(getattr(person, roster.field) for person in snap.people):
            return _result(
                check_id,
                "warn",
                _t(
                    f"{summary} But nobody on the team list has a {roster.id_name}, so every message is ignored.",
                    f"{summary} 하지만 팀 목록에 {id_ko}가 있는 사람이 없어서 모든 메시지를 무시해요.",
                ),
                _t(
                    f"Add your {roster.id_name} to your entry on the People page.",
                    f"구성원 페이지에서 내 정보에 {id_ko}를 추가하세요.",
                ),
                link="/people",
                last_activity=last_at,
            )
        sender = _turned_away_sender(snap, last, roster)
        if sender is not None:
            named = f" (from {roster.id_name} {sender})" if sender else ""
            named_ko = f"({id_ko} {sender})" if sender else ""
            return _result(
                check_id,
                "warn",
                _t(
                    f"{summary} The last message{named} was ignored because its sender isn't on the team list.",
                    f"{summary} 마지막 메시지{named_ko}는 보낸 사람이 팀 목록에 없어서 무시했어요.",
                ),
                _t(
                    f"If that was you, add that {roster.id_name} to your entry on the People page.",
                    f"본인이 보낸 거라면 구성원 페이지에서 내 정보에 그 {id_ko}를 추가하세요.",
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
            _t(
                f"To use Slack, add SLACK_BOT_TOKEN and SLACK_APP_TOKEN to .env, {_RESTART}",
                f"Slack을 쓰려면 .env에 SLACK_BOT_TOKEN과 SLACK_APP_TOKEN을 추가하고 {_RESTART_KO}",
            ),
        )
    if bot in EXAMPLE_VALUES or app_token in EXAMPLE_VALUES:
        return _result(
            "slack",
            "error",
            _t(
                "Slack still has the sample tokens from .env.example.",
                "Slack 토큰이 아직 .env.example의 샘플 값이에요.",
            ),
            _t(
                "Put your Slack app's tokens in SLACK_BOT_TOKEN and SLACK_APP_TOKEN, or delete both lines if you "
                f"don't use Slack, {_RESTART}",
                "SLACK_BOT_TOKEN과 SLACK_APP_TOKEN에 Slack 앱의 토큰을 넣거나, Slack을 쓰지 않는다면 두 줄을 "
                f"지우고 {_RESTART_KO}",
            ),
        )
    if not bot.startswith("xoxb-"):
        return _result(
            "slack",
            "error",
            _t(
                "SLACK_BOT_TOKEN is missing or isn't a bot token — those start with xoxb-.",
                "SLACK_BOT_TOKEN이 없거나 봇 토큰이 아니에요. 봇 토큰은 xoxb-로 시작해요.",
            ),
            _t(
                "Copy the Bot User OAuth Token from your Slack app's OAuth & Permissions page into .env, "
                f"{_RESTART}",
                "Slack 앱의 OAuth & Permissions 페이지에서 Bot User OAuth Token을 .env에 복사하고 "
                f"{_RESTART_KO}",
            ),
        )
    if app_token and not app_token.startswith("xapp-"):
        return _result(
            "slack",
            "error",
            _t(
                "SLACK_APP_TOKEN isn't an app-level token — those start with xapp-.",
                "SLACK_APP_TOKEN이 앱 수준 토큰이 아니에요. 앱 수준 토큰은 xapp-로 시작해요.",
            ),
            _t(
                "Create an app-level token with the connections:write scope on your Slack app's Basic "
                f"Information page, put it in .env, {_RESTART}",
                "Slack 앱의 Basic Information 페이지에서 connections:write 범위로 앱 수준 토큰을 만들어 "
                f".env에 넣고 {_RESTART_KO}",
            ),
        )

    probe = await _fetch(
        http, "POST", "https://slack.com/api/auth.test", headers={"Authorization": f"Bearer {bot}"}
    )
    if probe is None:
        return _result(
            "slack",
            "warn",
            _t("Couldn't reach Slack to test the tokens.", "Slack에 연결하지 못해 토큰을 점검하지 못했어요."),
            _offline_fix(),
        )
    body = probe[1]
    if body.get("ok") is not True:
        code = str(body.get("error", ""))
        shown = f" ({code})" if _SLACK_ERROR_CODE_RE.fullmatch(code) else ""
        return _result(
            "slack",
            "error",
            _t(f"Slack turned down SLACK_BOT_TOKEN{shown}.", f"Slack이 SLACK_BOT_TOKEN을 거부했어요{shown}."),
            _t(
                f"Copy the Bot User OAuth Token again from your Slack app's settings into .env, {_RESTART}",
                f"Slack 앱 설정에서 Bot User OAuth Token을 다시 .env에 복사하고 {_RESTART_KO}",
            ),
        )
    workspace = _clip(str(body.get("team") or _t("your Slack workspace", "Slack 워크스페이스")))
    if not app_token:
        return _result(
            "slack",
            "warn",
            _t(
                f"Can send to {workspace}, but won't hear messages: SLACK_APP_TOKEN isn't set.",
                f"{workspace}에 보낼 수는 있지만 메시지를 받지 못해요. SLACK_APP_TOKEN이 설정되지 않았어요.",
            ),
            _t(
                "Turn on Socket Mode in your Slack app, add its app-level token (starts with xapp-) to .env, "
                f"{_RESTART}",
                "Slack 앱에서 Socket Mode를 켜고, 앱 수준 토큰(xapp-로 시작)을 .env에 추가하고 "
                f"{_RESTART_KO}",
            ),
        )
    if snap.slack_handler is None:
        return _result(
            "slack",
            "error",
            _t(
                f"The tokens work for {workspace}, but the Slack listener didn't start.",
                f"{workspace}에서 토큰은 작동하지만 Slack 리스너가 시작되지 않았어요.",
            ),
            _t(
                f'The API log says why — look for "Failed to start Slack bot". Fix that, {_RESTART}',
                'API 로그에서 "Failed to start Slack bot"을 찾으면 이유가 나와요. 그 문제를 고치고 '
                f"{_RESTART_KO}",
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
            _t(
                f"The tokens work for {workspace}, but Slack isn't delivering messages to the app yet.",
                f"{workspace}에서 토큰은 작동하지만 Slack이 아직 앱으로 메시지를 전달하지 않아요.",
            ),
            _t(
                "If this lasts more than a minute, check SLACK_APP_TOKEN and that Socket Mode is on in "
                "your Slack app's settings.",
                "1분 넘게 계속되면 SLACK_APP_TOKEN과 Slack 앱 설정의 Socket Mode가 켜져 있는지 확인하세요.",
            ),
        )
    if not snap.slack_bot_id_resolved:
        return _result(
            "slack",
            "warn",
            _t(
                f"Listening in {workspace}, but it won't answer follow-ups in its threads unless they "
                "@-mention it: it couldn't look up its own Slack identity.",
                f"{workspace}에서 메시지를 받고 있지만, 자기 Slack 계정 정보를 찾지 못해서 스레드의 후속 "
                "메시지에는 @멘션이 있어야 답해요.",
            ),
            _t(
                "It tries again about once a minute while messages arrive. If this doesn't clear, check the "
                "API log for \"auth_test() failed\".",
                "메시지가 오는 동안 1분에 한 번쯤 다시 시도해요. 계속 이 상태라면 API 로그에서 "
                "\"auth_test() failed\"를 확인하세요.",
            ),
        )
    return _channel_ready(
        snap,
        "slack",
        _t(f"Connected to {workspace} and listening.", f"{workspace}에 연결돼 메시지를 받고 있어요."),
        actor="slack",
        roster=_Roster("slack_user_id", "Slack member ID", "Slack 멤버 ID"),
    )


# How a stopped discord.py client names what went wrong, and what to do.
_DISCORD_STOP_FIXES_KO: dict[str, tuple[str, str]] = {
    "LoginFailure": (
        "Discord가 DISCORD_BOT_TOKEN을 거부했어요.",
        f"Discord 개발자 포털의 Bot 탭에서 토큰을 재설정해 .env에 붙여 넣고 {_RESTART_KO}",
    ),
    "PrivilegedIntentsRequired": (
        "Discord가 봇을 거부했어요. Message Content 인텐트가 필요해요.",
        f"Discord 개발자 포털의 Bot 탭에서 Message Content Intent를 켜고 {_RESTART_KO}",
    ),
}


def _discord_stop_fix(kind: str) -> tuple[str, str]:
    return (_DISCORD_STOP_FIXES_KO if is_korean() else _DISCORD_STOP_FIXES)[kind]


_DISCORD_STOP_FIXES: dict[str, tuple[str, str]] = {
    "LoginFailure": (
        "Discord turned down DISCORD_BOT_TOKEN.",
        f"Reset the token on the Bot tab of the Discord developer portal, paste it into .env, {_RESTART}",
    ),
    "PrivilegedIntentsRequired": (
        "Discord refused the bot: it needs the Message Content intent.",
        f"Turn on Message Content Intent on the Bot tab of the Discord developer portal, {_RESTART}",
    ),
}


async def check_discord(snap: Snapshot, http: httpx.AsyncClient) -> SetupCheck:
    token = (snap.settings.discord_bot_token or "").strip()
    if not token:
        return _result(
            "discord",
            "off",
            _not_set_up(),
            _t(
                f"To use Discord, add DISCORD_BOT_TOKEN and DISCORD_APP_ID to .env, {_RESTART}",
                f"Discord를 쓰려면 .env에 DISCORD_BOT_TOKEN과 DISCORD_APP_ID를 추가하고 {_RESTART_KO}",
            ),
        )

    bot, task = snap.discord_bot, snap.discord_bot_task
    if task is not None and task.done():
        stopped_by = None if task.cancelled() else task.exception()
        kind = type(stopped_by).__name__ if stopped_by is not None else ""
        if kind in _DISCORD_STOP_FIXES:
            return _result("discord", "error", *_discord_stop_fix(kind))
        return _result(
            "discord",
            "error",
            _t(
                f"The Discord bot stopped{f' ({kind})' if kind else ''}.",
                f"Discord 봇이 멈췄어요{f'({kind})' if kind else ''}.",
            ),
            _t(
                f"The API log has the details. Fix that, {_RESTART}",
                f"자세한 내용은 API 로그에 있어요. 그 문제를 고치고 {_RESTART_KO}",
            ),
        )
    if bot is None:
        return _result(
            "discord",
            "error",
            _t("The Discord bot didn't start.", "Discord 봇이 시작되지 않았어요."),
            _t(
                f'The API log says why — look for "Discord bot". Fix that, {_RESTART}',
                f'API 로그에서 "Discord bot"을 찾으면 이유가 나와요. 그 문제를 고치고 {_RESTART_KO}',
            ),
        )
    if bot.is_ready():
        # discord.py stays "ready" through a dropped connection while it
        # reconnects; only the gateway socket says whether messages arrive.
        name = _clip(str(bot.user)) if bot.user is not None else _t("the bot", "봇")
        if not getattr(bot.ws, "open", False):
            return _result(
                "discord",
                "warn",
                _t(
                    f"Signed in as {name}, but the connection to Discord dropped and the bot is "
                    "reconnecting.",
                    f"{name} 계정으로 로그인했지만 Discord 연결이 끊겨 봇이 다시 연결하는 중이에요.",
                ),
                _t(
                    "Check again in a minute. If it stays like this, check this computer's internet connection "
                    "and the API log.",
                    "1분 뒤 다시 점검하세요. 계속 이 상태라면 이 컴퓨터의 인터넷 연결과 API 로그를 확인하세요.",
                ),
            )
        return _channel_ready(
            snap,
            "discord",
            _t(f"Connected as {name}.", f"{name} 계정으로 연결됐어요."),
            actor="discord",
            roster=_Roster("discord_user_id", "Discord user ID", "Discord 사용자 ID"),
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
            _t("Couldn't reach Discord to test the token.", "Discord에 연결하지 못해 토큰을 점검하지 못했어요."),
            _offline_fix(),
        )
    if probe[0] == 401:
        return _result("discord", "error", *_discord_stop_fix("LoginFailure"))
    return _result(
        "discord",
        "warn",
        _t("Still connecting to Discord.", "아직 Discord에 연결하는 중이에요."),
        _t(
            "Check again in a minute. If it stays like this, restart the app and read the API log.",
            "1분 뒤 다시 점검하세요. 계속 이 상태라면 앱을 다시 시작하고 API 로그를 확인하세요.",
        ),
    )


_TELEGRAM_REREGISTER = (
    "Set TELEGRAM_WEBHOOK_SECRET, restart the app, and register the webhook again with the same secret "
    "(docs/telegram_setup.md)."
)


def _telegram_reregister() -> str:
    return _t(
        _TELEGRAM_REREGISTER,
        "TELEGRAM_WEBHOOK_SECRET을 설정하고 앱을 다시 시작한 뒤, 같은 비밀 값으로 웹훅을 다시 등록하세요"
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
            _t(
                "To use Telegram, follow docs/telegram_setup.md.",
                "Telegram을 쓰려면 docs/telegram_setup.md를 따라 하세요.",
            ),
        )
    # Checked before the token goes into a URL, so it can't reshape one.
    if not _TELEGRAM_TOKEN_RE.fullmatch(token):
        return _result(
            "telegram",
            "error",
            _t(
                "TELEGRAM_BOT_TOKEN isn't a Telegram bot token — those are digits, a colon, then letters.",
                "TELEGRAM_BOT_TOKEN이 Telegram 봇 토큰이 아니에요. 봇 토큰은 숫자, 콜론, 문자 순서예요.",
            ),
            _t(
                f"Copy the token @BotFather gave you into .env, {_RESTART}",
                f"@BotFather가 준 토큰을 .env에 복사하고 {_RESTART_KO}",
            ),
        )
    secret = settings.telegram_webhook_secret
    if secret and not settings.telegram_webhook_secret_valid:
        return _result(
            "telegram",
            "error",
            _t(
                "TELEGRAM_WEBHOOK_SECRET has characters Telegram won't accept, so the app turns "
                "away every message.",
                "TELEGRAM_WEBHOOK_SECRET에 Telegram이 받지 않는 문자가 있어서 앱이 모든 메시지를 거부해요.",
            ),
            _t(
                "Use 1–256 letters, digits, _ or - (openssl rand -hex 32 makes one), restart the app, "
                "and register the webhook again with it (docs/telegram_setup.md).",
                "문자, 숫자, _, -로 1–256자를 쓰고(openssl rand -hex 32로 만들 수 있어요), 앱을 다시 시작한 뒤 "
                "그 값으로 웹훅을 다시 등록하세요(docs/telegram_setup.md).",
            ),
        )
    if snap.local_login and not secret:
        return _result(
            "telegram",
            "error",
            _t(
                "Local login turns away Telegram messages unless TELEGRAM_WEBHOOK_SECRET is set.",
                "로컬 로그인에서는 TELEGRAM_WEBHOOK_SECRET이 설정돼 있어야 Telegram 메시지를 받아요.",
            ),
            _telegram_reregister(),
        )

    base = f"https://api.telegram.org/bot{token}"
    me = await _fetch(http, "GET", f"{base}/getMe")
    if me is None:
        return _result(
            "telegram",
            "warn",
            _t("Couldn't reach Telegram to test the token.", "Telegram에 연결하지 못해 토큰을 점검하지 못했어요."),
            _offline_fix(),
        )
    if me[1].get("ok") is not True:
        return _result(
            "telegram",
            "error",
            _t("Telegram turned down TELEGRAM_BOT_TOKEN.", "Telegram이 TELEGRAM_BOT_TOKEN을 거부했어요."),
            _t(
                f"Ask @BotFather for the token again (/token), paste it into .env, {_RESTART}",
                f"@BotFather에게 토큰을 다시 받아(/token) .env에 붙여 넣고 {_RESTART_KO}",
            ),
        )
    me_result = me[1].get("result")
    username = me_result.get("username") if isinstance(me_result, dict) else None
    bot_name = f"@{_clip(str(username))}" if username else _t("The bot", "봇")

    hook = await _fetch(http, "GET", f"{base}/getWebhookInfo")
    if hook is None:
        return _result(
            "telegram",
            "warn",
            _t(
                f"{bot_name} works, but Telegram didn't say where it delivers messages.",
                f"{bot_name}의 토큰은 작동하지만 Telegram이 메시지를 어디로 전달하는지 알려 주지 않았어요.",
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
            _t(
                f"{bot_name} works, but Telegram doesn't know where to deliver its messages.",
                f"{bot_name}의 토큰은 작동하지만 Telegram이 메시지를 어디로 전달할지 몰라요.",
            ),
            _t(
                "Register this app's /webhook/telegram address with setWebhook — see docs/telegram_setup.md.",
                "setWebhook으로 이 앱의 /webhook/telegram 주소를 등록하세요. docs/telegram_setup.md를 참고하세요.",
            ),
        )
    if not urlsplit(url).path.endswith("/webhook/telegram"):
        return _result(
            "telegram",
            "warn",
            _t(
                f"Telegram delivers {bot_name}'s messages to an address that isn't this app's /webhook/telegram.",
                f"Telegram이 {bot_name}의 메시지를 이 앱의 /webhook/telegram이 아닌 주소로 전달해요.",
            ),
            _t(
                "Register the webhook again with this app's address — see docs/telegram_setup.md.",
                "이 앱의 주소로 웹훅을 다시 등록하세요. docs/telegram_setup.md를 참고하세요.",
            ),
        )
    error_at = info.get("last_error_date")
    if isinstance(error_at, int) and snap.now.timestamp() - error_at < _RECENT_FAILURE_S:
        reason = _clip(str(info.get("last_error_message") or _t("no reason given", "이유 없음")))
        return _result(
            "telegram",
            "warn",
            _t(
                f"Telegram couldn't deliver {bot_name}'s last message: {reason}.",
                f"Telegram이 {bot_name}의 마지막 메시지를 전달하지 못했어요: {reason}.",
            ),
            _t(
                "A 401 means the secret registered with setWebhook doesn't match "
                "TELEGRAM_WEBHOOK_SECRET — register the webhook again (docs/telegram_setup.md). "
                "Otherwise, check this app can be reached at that address.",
                "401이면 setWebhook에 등록한 비밀 값이 TELEGRAM_WEBHOOK_SECRET과 달라요. 웹훅을 다시 "
                "등록하세요(docs/telegram_setup.md). 그 밖의 경우에는 그 주소로 이 앱에 접속되는지 확인하세요.",
            ),
        )
    if not secret:
        return _result(
            "telegram",
            "warn",
            _t(
                f"{bot_name} is receiving messages, but anyone who finds the webhook address can send fake ones: "
                "TELEGRAM_WEBHOOK_SECRET isn't set.",
                f"{bot_name}의 메시지 수신은 정상이지만 TELEGRAM_WEBHOOK_SECRET이 설정되지 않아서, 웹훅 주소를 "
                "아는 사람은 누구나 가짜 메시지를 보낼 수 있어요.",
            ),
            _telegram_reregister(),
        )
    return _channel_ready(
        snap,
        "telegram",
        _t(f"{bot_name} is receiving messages.", f"{bot_name}의 메시지 수신이 정상이에요."),
        actor="telegram",
        roster=_Roster("telegram_chat_id", "Telegram chat ID", "Telegram 채팅 ID"),
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
            _t(
                "To use Google Chat, follow docs/google_chat_setup.md.",
                "Google Chat을 쓰려면 docs/google_chat_setup.md를 따라 하세요.",
            ),
        )
    if not re.fullmatch(r"[0-9]+", project):
        return _result(
            "google_chat",
            "error",
            _t(
                "GOOGLE_CHAT_PROJECT_NUMBER needs your Google Cloud project's number — digits only, "
                "not the project ID.",
                "GOOGLE_CHAT_PROJECT_NUMBER에는 프로젝트 ID가 아니라 Google Cloud 프로젝트 번호(숫자만)가 "
                "들어가야 해요.",
            ),
            _t(
                f"Copy the project number from the Google Cloud console's dashboard into .env, {_RESTART}",
                f"Google Cloud 콘솔 대시보드에서 프로젝트 번호를 .env에 복사하고 {_RESTART_KO}",
            ),
        )
    if not (key_file or key_email):
        return _result(
            "google_chat",
            "error",
            _t(
                "Google Chat has no service account to reply with.",
                "Google Chat에서 답장할 서비스 계정이 없어요.",
            ),
            _t(
                "Set GOOGLE_CHAT_SERVICE_ACCOUNT_FILE or GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL in .env — "
                f"docs/google_chat_setup.md says which — {_RESTART}",
                ".env에 GOOGLE_CHAT_SERVICE_ACCOUNT_FILE이나 GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL을 설정하고"
                f"(어느 쪽인지는 docs/google_chat_setup.md에 나와요) {_RESTART_KO}",
            ),
        )
    if key_file and not _readable_service_account(key_file):
        return _result(
            "google_chat",
            "error",
            _t(
                "Can't read a service-account key from the file GOOGLE_CHAT_SERVICE_ACCOUNT_FILE names.",
                "GOOGLE_CHAT_SERVICE_ACCOUNT_FILE이 가리키는 파일에서 서비스 계정 키를 읽을 수 없어요.",
            ),
            _t(
                f"Point it at the full path of the JSON key you downloaded from Google Cloud, {_RESTART}",
                f"Google Cloud에서 내려받은 JSON 키의 전체 경로로 설정하고 {_RESTART_KO}",
            ),
        )
    return _channel_ready(
        snap,
        "google_chat",
        _t(
            "Set up. Google Chat delivers messages to this app's /webhook/google-chat address "
            "(this page can't test that part).",
            "설정됐어요. Google Chat은 이 앱의 /webhook/google-chat 주소로 메시지를 전달해요"
            "(이 부분은 이 페이지에서 점검할 수 없어요).",
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
            _t(
                "Not set up: the Executive can't read or send email.",
                "설정되지 않았어요. Executive가 이메일을 읽거나 보낼 수 없어요.",
            ),
            _t(
                "To connect Gmail, follow the Google Workspace steps in .env.example.",
                "Gmail을 연결하려면 .env.example의 Google Workspace 단계를 따라 하세요.",
            ),
        )
    if snap.mcp_gateway is None:
        return _result(
            "gmail",
            "error",
            _t(
                "The connection to Google didn't start, so email is off.",
                "Google 연결이 시작되지 않아서 이메일이 꺼져 있어요.",
            ),
            _t(
                f'The API log says why — look for "MCP gateway". Fix that, {_RESTART}',
                f'API 로그에서 "MCP gateway"를 찾으면 이유가 나와요. 그 문제를 고치고 {_RESTART_KO}',
            ),
        )
    missing = _google_sign_in_missing()
    if missing:
        return _result(
            "gmail",
            "error",
            _t(
                f"Google can't sign the Executive in: {missing} isn't set.",
                f"Google에 Executive로 로그인할 수 없어요. 설정되지 않은 값: {missing}.",
            ),
            _t(
                f"Set it in .env (the Google Workspace steps there explain how), {_RESTART}",
                f".env에 설정하고(방법은 그 안의 Google Workspace 단계에 나와요) {_RESTART_KO}",
            ),
        )
    summary = _t(
        f"Connected. The Executive checks {settings.exec_email_address}'s inbox every "
        f"{settings.email_poll_interval_seconds} seconds.",
        f"연결됐어요. Executive가 {settings.exec_email_address}의 받은편지함을 "
        f"{settings.email_poll_interval_seconds}초마다 확인해요.",
    )
    if snap.last_inbound.get("email") is None:
        summary += _t(
            " No email has come in yet — if you've sent one, sign Google in once as that address "
            "(scripts/mint-google-token.py).",
            " 아직 들어온 이메일이 없어요. 이미 보냈다면 그 주소로 Google에 한 번 로그인하세요"
            "(scripts/mint-google-token.py).",
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
            _t(
                "Not set up (optional): Act as me needs an owner with an email on the team list.",
                "설정되지 않았어요(선택 사항). 나 대신 작성을 쓰려면 팀 목록에 이메일이 있는 소유자가 필요해요.",
            ),
        )
    on = await asyncio.to_thread(is_enabled, owner.id)
    try:
        status = await asyncio.wait_for(gmail_status(owner.email), PROBE_TIMEOUT_S)
    except TimeoutError:
        return _result(
            "your_gmail",
            "warn",
            _t(
                f"Your mail service didn't answer within {PROBE_TIMEOUT_S:.0f} seconds.",
                f"메일 서비스가 {PROBE_TIMEOUT_S:.0f}초 안에 응답하지 않았어요.",
            ),
            _t("Click Check again in a moment.", "잠시 후 다시 점검을 누르세요."),
            link="/settings",
        )
    if status == "connected":
        if on:
            summary = _t(
                f"Connected to {owner.email}. "
                "Act as me is on: the Executive can draft replies as you, in your own mailbox.",
                f"{owner.email}에 연결됐어요. 나 대신 작성이 켜져 있어서 Executive가 내 메일함에 "
                "나 대신 답장 초안을 쓸 수 있어요.",
            )
        else:
            summary = _t(
                f"Connected to {owner.email}. "
                "Turn Act as me on in Settings to let the Executive draft replies as you.",
                f"{owner.email}에 연결됐어요. Executive가 나 대신 답장 초안을 쓰게 하려면 설정에서 "
                "나 대신 작성을 켜세요.",
            )
        watch = await asyncio.to_thread(get_watch, owner.id) if on and owner.id is not None else None
        if watch is not None and watch.enabled:
            if watch.status in _INBOX_WARN:
                return _result(
                    "your_gmail",
                    "warn",
                    _t(
                        f"Connected to {owner.email}. Draft replies to my inbox: ",
                        f"{owner.email}에 연결됐어요. 받은편지함 답장 초안 쓰기: ",
                    )
                    + inbox_status_message(watch.status),
                    link="/settings",
                )
            summary += _t(" Draft replies to my inbox is on.", " 받은편지함 답장 초안 쓰기가 켜져 있어요.")
        return _result("your_gmail", "ok", summary, link="/settings")
    if status == "not_configured":
        return _result(
            "your_gmail",
            "warn" if on else "off",
            _t(
                "Not set up (optional): the Executive can't draft emails as you in your own mailbox.",
                "설정되지 않았어요(선택 사항). Executive가 내 메일함에 나 대신 이메일 초안을 쓸 수 없어요.",
            ),
            _t(
                "Signed in as yourself, run scripts/connect-own-gmail.py for Gmail or "
                "scripts/connect-own-outlook.py for Outlook (see .env.example → Act as me), then "
                "put the file it writes in DELEGATION_GOOGLE_CREDENTIALS_DIR.",
                "본인 계정으로 로그인한 상태에서 Gmail은 scripts/connect-own-gmail.py, Outlook은 "
                "scripts/connect-own-outlook.py를 실행하고(.env.example → Act as me 참고), 만들어진 파일을 "
                "DELEGATION_GOOGLE_CREDENTIALS_DIR에 넣으세요.",
            ),
            link="/settings",
        )
    if status == "shared_mailbox" and not on:
        # Not a fault while it's off: the owner simply uses the Executive's
        # own address, and Act as me can't be turned on that way.
        return _result(
            "your_gmail",
            "off",
            _t("Not set up (optional): ", "설정되지 않았어요(선택 사항). ") + status_message(status),
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
            _t(
                "Turned off, so no briefs, reminders or follow-ups go out.",
                "꺼져 있어서 브리핑, 리마인드, 후속 조치가 나가지 않아요.",
            ),
            _t(
                f"Set SCHEDULER_ENABLED=true in .env, {_RESTART}",
                f".env에 SCHEDULER_ENABLED=true를 설정하고 {_RESTART_KO}",
            ),
        )
    # Liveness first: a paused scheduler still ticks, so one that has
    # stopped needs a restart, not the Resume button.
    started_at, last_tick = scheduler_heartbeat()
    restart_fix = _t(
        'Restart the app, and look in the API log for lines from "scheduler".',
        '앱을 다시 시작하고 API 로그에서 "scheduler"가 남긴 줄을 확인하세요.',
    )
    if started_at is None:
        return _result(
            "scheduler",
            "error",
            _t(
                "The scheduler isn't running, so briefs and follow-ups won't go out.",
                "스케줄러가 실행 중이 아니라서 브리핑과 후속 조치가 나가지 않아요.",
            ),
            restart_fix,
        )
    if last_tick is None:
        waited = (snap.now - started_at).total_seconds()
        if waited < _SCHEDULER_STARTUP_GRACE_S:
            return _result(
                "scheduler",
                "warn",
                _t("Starting up.", "시작하는 중이에요."),
                _t("Check again in a minute.", "1분 뒤 다시 점검하세요."),
            )
        return _result(
            "scheduler",
            "error",
            _t(
                f"The scheduler started {_ago(waited)} but hasn't finished a check since.",
                f"스케줄러가 {_ago(waited)}에 시작했지만 그 뒤로 점검을 한 번도 끝내지 못했어요.",
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
            _t(
                f"The scheduler has stopped: its last check was {_ago(silent_for)}.",
                f"스케줄러가 멈췄어요. 마지막 점검: {_ago(silent_for)}.",
            ),
            restart_fix,
        )
    if outcome == "failed":
        return _result(
            "scheduler",
            "error",
            _t("The scheduler's last check hit an error.", "스케줄러의 마지막 점검에서 오류가 났어요."),
            _t(
                'Look in the API log for "scheduler tick failed" to see why.',
                'API 로그에서 "scheduler tick failed"를 찾으면 이유를 알 수 있어요.',
            ),
        )
    if get_pause_state().paused:
        return _result(
            "scheduler",
            "warn",
            _t(
                "Paused: briefs, reminders and email checks wait until you resume.",
                "일시 중지됐어요. 재개할 때까지 브리핑, 리마인드, 이메일 확인이 멈춰 있어요.",
            ),
            _t(
                "Press Resume in the banner at the top of the page.",
                "페이지 위쪽 배너에서 재개를 누르세요.",
            ),
        )
    if outcome == "waiting_for_company":
        return _result(
            "scheduler",
            "warn",
            _t(
                "Waiting for company setup: nothing scheduled runs until the setup interview is done.",
                "회사 설정을 기다리는 중이에요. 설정 인터뷰를 마칠 때까지 예약된 일이 실행되지 않아요.",
            ),
            _t("Finish the setup interview.", "설정 인터뷰를 마치세요."),
            link="/onboard",
        )
    return _result("scheduler", "ok", _t("Running.", "실행 중이에요."))


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
        CHANNEL_NAMES,
        brief_name,
        channel_phrase,
        current_problem,
        delivery_problem,
    )
    from openexecutive.scheduler.runner import delivery_order

    if not snap.settings.scheduler_enabled:
        return _result("brief", "off", _t("Off, because the scheduler is turned off.", "스케줄러가 꺼져 있어서 보내지 않아요."))
    principal = snap.principal
    if principal is None:
        problem, fix = delivery_problem("no_owner")
        return _result("brief", "warn", _t(f"Not sent: {problem}.", f"보내지 않았어요. {problem}."), fix, link="/people")
    plan = delivery_order(principal, email_ready=snap.brief_email_ready)
    if not plan:
        problem, fix = delivery_problem("no_channel")
        return _result(
            "brief",
            "warn",
            _t(f"Kept in the app only: {problem}.", f"앱에만 보관해요. {problem}."),
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
            _t(
                f"Your last {brief_name(last.kind)} wasn't sent: {problem}.",
                f"지난 {brief_name(last.kind)} 발송에 실패했어요. {problem}.",
            ),
            fix,
        )
    if last is not None and last.channel and last.channel != plan[0]:
        # It got through, but not on the first channel it tried: that one is
        # broken, and every brief is going by the backup.
        first = CHANNEL_NAMES[plan[0]]
        return _result(
            "brief",
            "warn",
            _t(
                f"Your last {brief_name(last.kind)} went {channel_phrase(last.channel)}, "
                f"because {first} didn't work.",
                f"{_label(_DELIVERY_CHANNEL_CHECKS[plan[0]])} 연결이 작동하지 않아서 지난 {brief_name(last.kind)} 발송은 "
                f"{channel_phrase(last.channel)} 대신 보냈어요.",
            ),
            _t(
                f'See the "{LABELS[_DELIVERY_CHANNEL_CHECKS[plan[0]]]}" light on this page.',
                f"이 페이지의 '{_label(_DELIVERY_CHANNEL_CHECKS[plan[0]])}' 항목을 확인하세요.",
            ),
        )
    zone = ZoneInfo(snap.brief_zone or "UTC")
    if is_korean():
        times_ko = [
            f"{brief_name(kind)} {snap.brief_next_runs[kind].astimezone(zone):%H:%M}"
            for kind in BRIEF_KINDS
            if kind in snap.brief_next_runs
        ]
        when_ko = f"({', '.join(times_ko)})" if times_ko else ""
        if snap.brief_zone is None:
            return _result(
                "brief",
                "warn",
                f"{channel_phrase(plan[0])} 보내요{when_ko}. 시간대가 설정되지 않아 UTC 기준이에요.",
                "설정에서 시간대를 지정하세요.",
                link="/settings",
            )
        return _result("brief", "ok", f"{channel_phrase(plan[0])} 보내요{when_ko}. 시간대: {snap.brief_zone}.")
    times = [
        f"the {brief_name(kind)} at {snap.brief_next_runs[kind].astimezone(zone):%H:%M}"
        for kind in BRIEF_KINDS
        if kind in snap.brief_next_runs
    ]
    when = f": {' and '.join(times)}" if times else ""
    if snap.brief_zone is None:
        return _result(
            "brief",
            "warn",
            f"Sent to you {channel_phrase(plan[0])}{when}, in UTC because no time zone is set.",
            "Set your time zone in Settings.",
            link="/settings",
        )
    return _result("brief", "ok", f"Sent to you {channel_phrase(plan[0])}{when} ({snap.brief_zone}).")


async def check_memory(snap: Snapshot) -> SetupCheck:
    from openexecutive.api.routes.health import honcho_health

    probe = await honcho_health()
    status = probe.get("status")
    if status == "disabled":
        return _result(
            "memory",
            "off",
            _t(
                "Off. This optional service remembers people across conversations.",
                "꺼져 있어요. 대화가 바뀌어도 사람을 기억하게 해 주는 선택 서비스예요.",
            ),
            _t(
                f"To turn it on, set HONCHO_ENABLED=true and HONCHO_API_KEY in .env, {_RESTART}",
                f"켜려면 .env에 HONCHO_ENABLED=true와 HONCHO_API_KEY를 설정하고 {_RESTART_KO}",
            ),
        )
    if status == "ok":
        return _result("memory", "ok", _t("Connected to Honcho.", "Honcho에 연결됐어요."))
    error_type = probe.get("error_type", "unknown error")
    return _result(
        "memory",
        "error",
        _t(f"Can't reach Honcho ({error_type}).", f"Honcho에 연결할 수 없어요({error_type})."),
        _t(
            f"Check HONCHO_API_KEY and HONCHO_BASE_URL in .env, {_RESTART}",
            f".env의 HONCHO_API_KEY와 HONCHO_BASE_URL을 확인하고 {_RESTART_KO}",
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
                _t("This check couldn't run.", "이 항목을 점검하지 못했어요."),
                _t(
                    'The API log has the details — look for "setup status".',
                    'API 로그에서 "setup status"를 찾으면 자세한 내용이 나와요.',
                ),
            )

    return list(await asyncio.gather(*(guarded(check_id) for check_id in LABELS)))
