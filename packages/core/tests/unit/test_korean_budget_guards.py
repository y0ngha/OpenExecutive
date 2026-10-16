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
