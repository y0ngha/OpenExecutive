"""Fixed text the API shows as-is follows OE_LANGUAGE=ko.

The English side is covered by each surface's own tests; these check the
Korean comes back from the catalog (utils/i18n/catalogs/ko.json), and
tests/unit/test_i18n_catalogs.py checks the catalog against the code.
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
from openexecutive.utils import i18n


@pytest.fixture
def korean(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OE_LANGUAGE", "ko")


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

    assert body["prompts"] == [
        "이번 분기 우선순위는 어떻게 정리됐나요?",
        "제가 미루고 있는 결정에 팀 의견을 모아 주세요.",
        "이사회 보고서를 보내기 전에 같이 검토해요.",
        "지난번 이후로 무엇이 바뀌었나요?",
    ]
    assert body["subtitle"] == (
        "지난번에 하던 일을 이어서 해요. 다시 볼 결정, 마무리할 초안, 함께할 사람이 있어요."
    )


def test_activity_labels_are_korean(korean: None) -> None:
    specialist = al.summarize_activity([{"id": "t", "name": "consult_specialist", "input": {}}])
    unknown = al.summarize_activity([{"id": "t", "name": "some_future_tool", "input": {}}])
    mcp = al.summarize_activity([{"id": "t", "name": "call_tool", "input": {"name": "jira_search"}}])

    assert specialist is not None and specialist["label"] == "전문가와 상의하는 중…"
    # Must match the UI's own placeholder (lib.api.fallbackActivity).
    assert unknown is not None and unknown["label"] == "작업 중…"
    assert al.fallback_activity()["label"] == "작업 중…"
    assert mcp is not None and mcp["label"] == "jira_search 사용 중…"


def test_korean_activity_labels_cover_every_tool(korean: None) -> None:
    catalog = i18n.catalog("ko")
    assert {f"activity.{name}" for name in al._LABELS} <= set(catalog)
    assert all(al._label(name).endswith("…") for name in al._LABELS)


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


def test_korean_setup_labels_cover_every_check(korean: None) -> None:
    # Names that read the same in Korean (Slack, Discord, ...) fall back to English.
    same = {"slack", "discord", "telegram", "google_chat"}
    catalog = i18n.catalog("ko")
    assert {f"setup.label.{c}" for c in setup_checks.LABELS} - set(catalog) == {
        f"setup.label.{c}" for c in same
    }
    assert setup_checks._label("memory") == "장기 메모리(Honcho)"


def test_status_tables_are_korean(korean: None) -> None:
    from openexecutive.briefing import brief_state
    from openexecutive.delegation import gmail, inbox

    catalog = i18n.catalog("ko")
    assert {f"delegation.gmail.status.{s}" for s in gmail.STATUS_MESSAGES} <= set(catalog)
    assert {f"delegation.inbox.status.{s}" for s in inbox.STATUS_MESSAGES} <= set(catalog)
    assert {f"brief.delivery_problem.{r}" for r in brief_state.DELIVERY_PROBLEMS} <= set(catalog)
    assert {f"brief.delivery_fix.{r}" for r in brief_state.DELIVERY_PROBLEMS} <= set(catalog)

    assert gmail.status_message("connected") == "연결됐어요."
    assert inbox.status_message("off") == "꺼져 있어요."
    assert inbox.status_message("no_such_status") == "켜져 있어요."
    assert brief_state.delivery_problem("send_failed") == (
        "보내는 방법이 모두 실패했어요",
        "어느 연결을 손봐야 하는지 설정 상태 페이지에서 확인할 수 있어요.",
    )
    assert brief_state.brief_name("principal_brief_morning") == "아침 브리핑"
    assert brief_state.channel_phrase("slack_dm") == "Slack으로"


def test_setup_ago_and_lists_are_korean(korean: None) -> None:
    assert setup_checks._ago(30) == "방금 전"
    assert setup_checks._ago(60) == "1분 전"
    assert setup_checks._ago(5 * 60) == "5분 전"
    assert setup_checks._ago(3 * 3600) == "3시간 전"
    assert setup_checks._join_and(["아침 브리핑 08:00", "저녁 요약 18:00"]) == (
        "아침 브리핑 08:00, 저녁 요약 18:00"
    )


def test_setup_ago_and_lists_in_english() -> None:
    assert setup_checks._ago(30) == "less than a minute ago"
    assert setup_checks._ago(60) == "1 minute ago"
    assert setup_checks._ago(5 * 60) == "5 minutes ago"
    assert setup_checks._ago(3 * 3600) == "3 hours ago"
    assert setup_checks._join_and(["a", "b", "c"]) == "a and b and c"


def test_onboarding_text_is_korean(korean: None) -> None:
    from openexecutive.onboarding import interview as iv

    assert iv.opening_prompt().startswith("회사에 대해 알려 주세요.")
    assert iv.unusable_message() == "설정 도우미가 쓸 수 있는 응답을 주지 않았어요."
    draft = iv.CompanyDraft.model_validate({"profile": {"name": ""}, "people": [], "departments": []})
    errors = iv.validate_draft(draft)
    assert errors[0].safe == "회사 이름이 필요해요."
    # The model still gets English in the repair turn.
    assert errors[0].detail == "profile.name is required"


def test_english_is_unchanged_by_default() -> None:
    assert al.fallback_activity()["label"] == al.FALLBACK_LABEL
    from openexecutive.delegation.gmail import STATUS_MESSAGES, status_message

    assert status_message("error") == STATUS_MESSAGES["error"]
