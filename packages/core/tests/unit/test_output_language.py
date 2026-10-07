import pytest
from pydantic import ValidationError

from openexecutive.config import get_settings
from openexecutive.providers.output_language import apply_output_language

CACHED = {"type": "text", "text": "persona", "cache_control": {"type": "ephemeral"}}


def test_english_leaves_the_request_untouched(monkeypatch):
    monkeypatch.delenv("OE_LANGUAGE", raising=False)
    kwargs = {"system": [CACHED], "messages": []}
    assert apply_output_language(kwargs) is kwargs


def test_korean_appends_one_fixed_block_after_the_cached_ones(monkeypatch):
    monkeypatch.setenv("OE_LANGUAGE", "KOREAN")
    kwargs = {"system": [CACHED], "messages": []}
    out = apply_output_language(kwargs)
    assert out["system"][0] is CACHED
    assert len(out["system"]) == 2
    assert "Korean" in out["system"][1]["text"]
    assert "cache_control" not in out["system"][1]
    # Same bytes every call, so the cached prefix stays stable.
    assert apply_output_language(kwargs)["system"] == out["system"]
    # The caller's dict is not mutated (a retry must not stack blocks).
    assert kwargs["system"] == [CACHED]


@pytest.mark.parametrize("system", [None, "", "plain prompt"])
def test_korean_handles_missing_and_string_system(monkeypatch, system):
    monkeypatch.setenv("OE_LANGUAGE", "korean ")
    kwargs = {"messages": []} if system is None else {"system": system, "messages": []}
    blocks = apply_output_language(kwargs)["system"]
    assert "Korean" in blocks[-1]["text"]
    assert len(blocks) == (2 if system else 1)
    if system:
        assert blocks[0] == {"type": "text", "text": system}


def test_unknown_language_fails_at_startup(monkeypatch):
    monkeypatch.setenv("OE_LANGUAGE", "FRENCH")
    with pytest.raises(ValidationError):
        get_settings()


def test_localized_follows_oe_language(monkeypatch):
    from openexecutive.utils.i18n import localized

    monkeypatch.delenv("OE_LANGUAGE", raising=False)
    assert localized("Working…", "작업 중…") == "Working…"
    monkeypatch.setenv("OE_LANGUAGE", "KOREAN")
    assert localized("Working…", "작업 중…") == "작업 중…"
