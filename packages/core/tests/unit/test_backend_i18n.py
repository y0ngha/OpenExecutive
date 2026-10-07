"""Fixed text the API shows as-is follows OE_LANGUAGE=KOREAN.

The English side is covered by each surface's own tests; these check the
Korean comes back, and that the Korean tables stay in step with the English.
"""
from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openexecutive.api import setup_checks
from openexecutive.api.routes import chat as chat_route
from openexecutive.config import Settings
from openexecutive.memory.company_profile import CompanyProfile
from openexecutive.orchestrator import activity_labels as al


@pytest.fixture
def korean(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OE_LANGUAGE", "KOREAN")


@pytest.fixture(autouse=True)
def _reset_prompt_cache() -> Iterator[None]:
    chat_route._suggested_prompts_cache.clear()
    yield
    chat_route._suggested_prompts_cache.clear()


def test_chat_fallback_is_korean(korean: None, monkeypatch: pytest.MonkeyPatch) -> None:
    from openexecutive.memory import session_store
    from openexecutive.onboarding import profile_builder

    monkeypatch.setattr(profile_builder, "load_or_create_profile", lambda: CompanyProfile())
    monkeypatch.setattr(session_store, "list_sessions", lambda _pid: [])
    monkeypatch.setattr(chat_route, "_resolve_caller_person_id", lambda _req: 1)
    app = FastAPI()
    app.include_router(chat_route.router)

    with TestClient(app) as client:
        body = client.get("/chat/suggested-prompts").json()

    assert body["prompts"] == chat_route._FALLBACK_PROMPTS_KO
    assert body["subtitle"] == chat_route._FALLBACK_SUBTITLE_KO
    assert len(chat_route._FALLBACK_PROMPTS_KO) == len(chat_route._FALLBACK_PROMPTS)


def test_activity_labels_are_korean(korean: None) -> None:
    specialist = al.summarize_activity([{"id": "t", "name": "consult_specialist", "input": {}}])
    unknown = al.summarize_activity([{"id": "t", "name": "some_future_tool", "input": {}}])
    mcp = al.summarize_activity([{"id": "t", "name": "call_tool", "input": {"name": "jira_search"}}])

    assert specialist is not None and specialist["label"] == "전문가와 상의하는 중…"
    # Must match the UI's own placeholder (lib.api.fallbackActivity).
    assert unknown is not None and unknown["label"] == "작업 중…"
    assert al.fallback_activity()["label"] == "작업 중…"
    assert mcp is not None and mcp["label"] == "jira_search 사용 중…"


def test_korean_activity_labels_cover_every_tool() -> None:
    assert set(al._LABELS_KO) == set(al._LABELS)
    assert all(label.endswith("…") for label in al._LABELS_KO.values())


def test_setup_check_is_korean(korean: None) -> None:
    settings = Settings(EXEC_EMAIL_ADDRESS="nobody")  # type: ignore[call-arg]
    snap = setup_checks.Snapshot(
        settings=settings,
        now=datetime(2026, 9, 25, 12, 0, tzinfo=UTC),
        local_login=False,
        people=[],
        principal=None,
        last_inbound={},
    )

    check = setup_checks.check_exec_email(snap)

    assert check.state == "error"
    assert check.label == "Executive의 이메일 주소"
    assert check.summary == "EXEC_EMAIL_ADDRESS가 이메일 주소가 아니에요."
    assert check.fix is not None and "앱을 다시 시작하세요" in check.fix


def test_korean_setup_labels_cover_every_check() -> None:
    assert list(setup_checks._LABELS_KO) == list(setup_checks.LABELS)


def test_status_tables_stay_in_step() -> None:
    from openexecutive.briefing import brief_state
    from openexecutive.delegation import gmail, inbox

    assert set(gmail._STATUS_MESSAGES_KO) == set(gmail.STATUS_MESSAGES)
    assert set(inbox._STATUS_MESSAGES_KO) == set(inbox.STATUS_MESSAGES)
    assert set(brief_state._DELIVERY_PROBLEMS_KO) == set(brief_state.DELIVERY_PROBLEMS)


def test_english_is_unchanged_by_default() -> None:
    assert al.fallback_activity()["label"] == al.FALLBACK_LABEL
    from openexecutive.delegation.gmail import STATUS_MESSAGES, status_message

    assert status_message("error") == STATUS_MESSAGES["error"]
