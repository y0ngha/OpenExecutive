"""Fixed text sent to people (notices, reminders, held blocks, nudge cards,
held-write questions, citations, the weekly review) follows OE_LANGUAGE, and
dates in it are local.

English is the default (OE_LANGUAGE unset); the ``korean`` fixture switches
the deployment to Korean, and the strings come from catalogs/ko.json.
"""
from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from openexecutive.memory import workspace_settings

SEOUL = ZoneInfo("Asia/Seoul")


@pytest.fixture
def korean(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OE_LANGUAGE", "ko")


@pytest.fixture
def seoul(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workspace_settings, "get_user_timezone", lambda *a, **k: SEOUL)


# --------------------------------------------------------------------------- #
# utils.i18n.dates
# --------------------------------------------------------------------------- #

def test_clock_and_day_parts() -> None:
    from openexecutive.utils.i18n.dates import clock, day_parts

    at = datetime(2026, 10, 16, 21, 5)
    assert clock(at) == "9:05 pm" and clock(at.replace(hour=0)) == "12:05 am"
    assert day_parts(at) == {"weekday": "Fri", "day": "16", "month": "Oct"}
    assert day_parts(at, long=True)["weekday"] == "Friday"


def test_clock_and_day_parts_in_korean(korean: None) -> None:
    from openexecutive.utils.i18n.dates import clock, day_parts

    at = datetime(2026, 10, 16, 9, 5)
    assert clock(at) == "오전 9:05" and clock(at.replace(hour=13)) == "오후 1:05"
    assert day_parts(at) == {"weekday": "금", "day": "16", "month": "10월"}


# --------------------------------------------------------------------------- #
# Notices and reminders
# --------------------------------------------------------------------------- #

def test_assignment_notice_in_korean(korean: None, seoul: None) -> None:
    from openexecutive.attunement.assignment_notice import notice_text

    text = notice_text(assigner_name="Sara", task="send the quote",
                       due_at="2026-10-16T17:00:00+00:00")
    assert text == (
        "Sara 님이 이 일을 맡아 달라고 했어요: `send the quote`. "
        "기한은 10월 17일 토요일까지예요. 끝나면, 또는 할 수 없으면 여기로 답장해 주세요."
    )


def test_reminder_message_uses_the_local_date(seoul: None) -> None:
    from openexecutive.delegation.reminders import message

    # 16:00 UTC on the 15th is already the 16th in Seoul.
    assert message("call Bo", "2026-10-15T16:00:00+00:00") == "Reminder you set on Oct 16: call Bo"
    assert message("call Bo", "nope") == "Reminder you set: call Bo"


def test_reminder_message_in_korean(korean: None, seoul: None) -> None:
    from openexecutive.delegation.reminders import message

    assert message("call Bo", "2026-10-15T16:00:00+00:00") == "10월 16일에 설정한 리마인더예요: call Bo"


def test_history_reminder_in_both_languages(monkeypatch: pytest.MonkeyPatch) -> None:
    from openexecutive.memory.history_reminders import reminder_text

    day = datetime(2026, 10, 16).date()
    assert reminder_text(1, day).startswith(
        "From your notes: one thing you said you'd do by email is due today (Fri 16 Oct)."
    )
    assert "2 things you said you'd do by email are due today" in reminder_text(2, day)
    monkeypatch.setenv("OE_LANGUAGE", "ko")
    assert reminder_text(2, day).startswith(
        "메모 확인: 이메일로 하겠다고 한 일 2건이 오늘(10월 16일(금)) 마감이에요."
    )


# --------------------------------------------------------------------------- #
# Nudge engine
# --------------------------------------------------------------------------- #

def test_nudge_intent_times_are_local_and_english() -> None:
    from openexecutive.scheduler import nudge_engine as ne

    at = datetime(2026, 10, 16, 3, 0, tzinfo=UTC)
    assert ne._local_when(at, SEOUL) == "Fri Oct 16, 12:00 (Asia/Seoul)"
    assert ne._local_date("2026-10-15T16:00:00+00:00", SEOUL) == "2026-10-16"
    assert ne._local_date("garbage-in-here", SEOUL) == "garbage-in"


def test_stalled_intent_names_the_recipients_local_time(monkeypatch: pytest.MonkeyPatch) -> None:
    from openexecutive.scheduler import nudge_engine as ne
    from openexecutive.workflows import persistence

    now = datetime(2026, 10, 16, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(persistence, "list_awaiting_runs", lambda **_: [{
        "run_id": "r1", "awaiting_person_id": 7, "title": "Close",
        "awaiting_until": "2026-10-16T03:00:00+00:00", "updated_at": "2026-10-14T00:00:00+00:00",
    }])
    monkeypatch.setattr(ne, "_recipient_zone", lambda pid, db_path=None: SEOUL)
    out = ne._select_stalled_workflow_candidates(now, lead_hours=24, min_quiet_hours=24, cooldown_hours=24)
    assert "times out at Fri Oct 16, 12:00 (Asia/Seoul)" in out[0].intent_text
    assert "+00:00" not in out[0].intent_text


def test_initiative_card_in_korean(korean: None) -> None:
    from openexecutive.utils.i18n import tr

    body = tr("nudge.initiative.body", "x", title="Launch", since="2026-10-12")
    assert "직접 연락이 닿지 않아서 브리핑에 남겨 둬요." in body and "Launch" in body


# --------------------------------------------------------------------------- #
# Held writes (workflows.action_step)
# --------------------------------------------------------------------------- #

def _held() -> list:
    from openexecutive.workflows.action_step import HeldCall

    return [HeldCall(tool="append_rows", targets=[])]


def test_held_question_in_both_languages(monkeypatch: pytest.MonkeyPatch) -> None:
    from openexecutive.workflows.action_step import _format_output, held_question

    english = held_question("File bills", _held())
    assert english.startswith("The workflow “File bills” wants to write somewhere")
    assert "- a new target (via append_rows)" in english and "Reply yes" in english
    assert "**Actions taken**" in _format_output("ok", [])
    monkeypatch.setenv("OE_LANGUAGE", "ko")
    korean = held_question("File bills", _held())
    assert korean.startswith("“File bills” 워크플로가 처음 쓰는 곳에 기록하려고 해요:")
    assert "- 새 대상 (append_rows 사용)" in korean and "'예'라고 답해 주세요" in korean
    out = _format_output("", [])
    assert "**실행한 작업**" in out and "사용한 도구가 없어요." in out


# --------------------------------------------------------------------------- #
# Citations footer (briefing.grounding)
# --------------------------------------------------------------------------- #

def test_sources_header_and_split(korean: None) -> None:
    from openexecutive.briefing.grounding import SOURCES_HEADER, _split_sources, sources_header

    assert sources_header() == "**출처**"
    for header in (sources_header(), SOURCES_HEADER):
        text = f"Body line\n\n{header}\n- [1] a — b"
        body, sep, footer = _split_sources(text)
        assert body == "Body line" and sep == "\n\n" + header and footer == "\n- [1] a — b"
    assert _split_sources("no footer") == ("no footer", "", "")


def test_sources_header_is_english_by_default() -> None:
    from openexecutive.briefing.grounding import SOURCES_HEADER, sources_header

    assert sources_header() == SOURCES_HEADER == "**Sources**"


# --------------------------------------------------------------------------- #
# Weekly review
# --------------------------------------------------------------------------- #

def _render(**over: object) -> str:
    from openexecutive.workflows.weekly_review import _AreaReview, _render_sections

    decision = SimpleNamespace(id=4, timestamp="2026-10-15T16:30:00+00:00", summary="Hire Bo")
    kwargs: dict = {
        "areas": [_AreaReview(title="Sales", goals=[{
            "key_result": "ARR", "status": "at_risk", "was": "on_track",
            "target": "$1M", "current": "$0.6M", "rationale": "",
        }])],
        "due": [{"due_date": "2026-10-16", "state": "today", "description": "Send deck"}],
        "quiet": [], "week": [decision], "revisit": [decision], "noun": "area",
    }
    kwargs.update(over)
    return _render_sections(**kwargs)


def test_weekly_review_dates_are_local(seoul: None) -> None:
    body = _render()
    assert "## Goals by area" in body and "at risk (was on track); target $1M, now $0.6M." in body
    assert "- 2026-10-16 — Hire Bo" in body
    assert "- [decision 4] decided 2026-10-16 — Hire Bo" in body
    assert "- due today (2026-10-16): Send deck" in body


def test_weekly_review_in_korean(korean: None, seoul: None) -> None:
    body = _render()
    assert "## 영역별 목표" in body and "위험 (이전: 순조로움); 목표 $1M, 현재 $0.6M." in body
    assert "## 마감이 다가온 약속" in body and "- 오늘 마감 (2026-10-16): Send deck" in body
    assert "## 이번 주 결정" in body and "- [decision 4] 2026-10-16 결정 — Hire Bo" in body


def test_summarize_review_reads_korean_and_english(korean: None) -> None:
    from openexecutive.workflows.weekly_review import summarize_review

    ko = "# 주간 리뷰 — 10월 둘째 주\n\n## 영역별 목표\n\n## 다음 주 우선순위 3가지\n\n1. A\n2. B\n"
    assert summarize_review(ko) == {"period": "10월 둘째 주", "top_three": ["A", "B"], "excerpt": ""}
    en = "# Weekly review — Week of Sep 21\n\n## Goals by area\n\n## Next week's top 3\n\n1. C\n"
    assert summarize_review(en) == {"period": "Week of Sep 21", "top_three": ["C"], "excerpt": ""}
