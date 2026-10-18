"""Guards for the fixes made after a Korean deployment's briefs were cut off,
mislabelled or missing context (output budgets, local dates, headings code
reads, web search for practical facts)."""
from __future__ import annotations

from datetime import UTC, datetime


def test_web_search_covers_practical_facts_and_search_before_not_knowing() -> None:
    from openexecutive.prompts.executive_persona import WEB_SEARCH_ADDENDUM

    # "어디로?" about a fabric market got "I don't know which building"
    # without a search.
    assert "opening hours" in WEB_SEARCH_ADDENDUM
    assert "search for it first" in WEB_SEARCH_ADDENDUM


def test_reflection_keeps_the_headings_code_reads_in_english() -> None:
    """brief_state reads **Flagged for the brief:** by its English words; a
    translated heading would drop the flags from the morning brief."""
    import inspect

    from openexecutive.providers.output_language import instruction
    from openexecutive.workflows import executive_reflection

    source = inspect.getsource(executive_reflection)
    assert source.count("keep the three headings in English") == 2
    text = instruction("ko")
    assert text is not None and "unless the instructions say a heading stays" in text


def test_insight_times_read_in_the_workspace_timezone(monkeypatch) -> None:
    from zoneinfo import ZoneInfo

    from openexecutive.memory import workspace_settings
    from openexecutive.people import insights

    monkeypatch.setattr(
        workspace_settings, "get_user_timezone", lambda *a, **k: ZoneInfo("Asia/Seoul")
    )
    assert insights._local("2026-10-16T03:00:00+00:00") == "2026-10-16 12:00"


def test_scheduled_today_never_names_a_raw_channel_id(monkeypatch) -> None:
    from openexecutive.memory import workspace_settings
    from openexecutive.workflows.morning_brief import scheduled_today_block

    monkeypatch.setattr(workspace_settings, "get_user_timezone", lambda *a, **k: UTC)
    now = datetime(2026, 10, 16, 8, 0, tzinfo=UTC)
    block = scheduled_today_block(
        {"in_flight": [{"run_at": "2026-10-16T09:00:00+00:00", "intent": "shoot",
                        "target": "U0C7TM2TJMT", "channel": "slack_dm"}]},
        now,
    )
    assert "U0C7TM2TJMT" not in block and "to someone: shoot" in block


def test_briefs_use_the_briefing_model_when_set(monkeypatch) -> None:
    from openexecutive.agents import utility_fast
    from openexecutive.config import get_settings

    monkeypatch.setattr(utility_fast, "get_fast_model", lambda: "fast")
    monkeypatch.delenv("BRIEFING_MODEL", raising=False)
    get_settings.cache_clear() if hasattr(get_settings, "cache_clear") else None
    assert utility_fast.get_briefing_model() == "fast"
    monkeypatch.setenv("BRIEFING_MODEL", "claude-sonnet-5-5")
    get_settings.cache_clear() if hasattr(get_settings, "cache_clear") else None
    assert utility_fast.get_briefing_model() == "claude-sonnet-5-5"


def test_grounding_reads_korean_amounts_and_names() -> None:
    """Korean briefs were checked for nothing: names have no capitals and
    3억 / 1,200만 원 read as "3d"-style tokens."""
    from openexecutive.briefing import grounding as g

    figs = {f.raw: (f.value, f.kind) for f in g.extract_figures("3억 원 투자, 견적 1,200만 원, 반응 30%, 15명")}
    assert figs["3억 원"] == (3e8, "money")
    assert figs["1,200만 원"] == (1.2e7, "money")
    assert figs["30%"][1] == "pct" and figs["15"][0] == 15
    # Dates, times and durations are not figures.
    assert g.extract_figures("10월 16일 8시에 3시간 촬영") == []

    assert g.extract_names("김민수님이 보냈고 박지훈 팀장에게 전달했어요") == ["김민수", "박지훈"]
    assert g.extract_names("대표님, 고객님, 교보문고 대표와 통화") == []

    src = [g.GroundingSource("c0", "ctx", "김민수에게서 견적 1200만원")]
    report = g.check_text("김민수님이 1,200만 원 견적을 보냈어요\n이영희님은 5억 원을 원해요", src, [])
    assert (report.lines[0].names_bad, report.lines[0].figures_bad) == ([], [])
    assert (report.lines[1].names_bad, report.lines[1].figures_bad) == (["이영희"], ["5억 원"])


def test_a_word_before_a_title_is_not_always_a_name() -> None:
    """The 10/17 brief lost "오늘 보정하는 컷에서 대표 후보를 먼저 골라 보면" because
    컷에서 sat before 대표."""
    from openexecutive.briefing import grounding as g

    assert g.extract_names("오늘 보정하는 컷에서 대표 후보를 먼저 골라 보면 어때요?") == []
    assert g.extract_names("회의에서 팀장 의견을 들어요") == []
    assert g.extract_names("박지훈 팀장에게 보내요") == ["박지훈"]
    assert g.extract_names("박지훈 대표님이 답했어요") == ["박지훈"]


def test_the_held_back_note_is_in_the_language(monkeypatch) -> None:
    from openexecutive.briefing import grounding as g

    assert "Left out of your brief" in g.held_back_note(2)
    monkeypatch.setenv("OE_LANGUAGE", "ko")
    assert "1줄을 뺐어요" in g.held_back_note(1)
    assert "3줄을 뺐어요" in g.held_back_note(3)
    assert "보내지 않았어요" in g.held_back_all()


def test_weekly_review_week_label_is_in_the_language(monkeypatch) -> None:
    from openexecutive.memory import workspace_settings
    from openexecutive.workflows.weekly_review import _default_period

    monkeypatch.setattr(workspace_settings, "get_user_timezone", lambda *a, **k: UTC)
    now = datetime(2026, 10, 16, 7, 0, tzinfo=UTC)
    assert _default_period(now) == "Week of Oct 12"
    monkeypatch.setenv("OE_LANGUAGE", "ko")
    assert _default_period(now) == "10월 12일 주"


def test_a_title_needs_a_surname_before_it() -> None:
    """The 10/18 reflection lost a flag: "아직 열려 있으면 대표님 확인이 필요해요"
    read 있으면 as a person."""
    from openexecutive.briefing import grounding as g

    assert g.extract_names("아직 열려 있으면 대표님 확인이 필요해요.") == []
    assert g.extract_names("자료가 없으면 팀장님께 물어봐요") == []
    assert g.extract_names("이번에 대표님이 정해요. 오늘은 대표님 확인") == []
    assert g.extract_names("박지훈 팀장님께 보내요, 최은영 대표와 통화") == ["박지훈", "최은영"]
