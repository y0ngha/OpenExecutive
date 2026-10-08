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


def test_language_codes_and_old_names_both_work(monkeypatch):
    monkeypatch.setenv("OE_LANGUAGE", "ko")
    assert get_settings().oe_language == "ko"
    monkeypatch.setenv("OE_LANGUAGE", "KOREAN")
    assert get_settings().oe_language == "ko"
    monkeypatch.setenv("OE_LANGUAGE", "ENGLISH")
    assert get_settings().oe_language == "en"
    monkeypatch.setenv("OE_LANGUAGE", "")
    assert get_settings().oe_language == "en"


def test_every_language_but_english_gets_the_template_with_its_name():
    from openexecutive.providers.output_language import instruction
    from openexecutive.utils.i18n import DEFAULT_LANGUAGE, LANGUAGES

    assert instruction(DEFAULT_LANGUAGE) is None
    assert instruction("xx") is None
    for code, name in LANGUAGES.items():
        if code != DEFAULT_LANGUAGE:
            text = instruction(code)
            assert text is not None and f"natural {name}" in text
            # Specialists and searches read English (see internal_call).
            assert "question for a specialist" in text and "mail" in text


async def test_internal_calls_get_no_block(monkeypatch):
    import asyncio

    from openexecutive.providers.output_language import internal_call

    monkeypatch.setenv("OE_LANGUAGE", "ko")
    kwargs = {"system": [CACHED], "messages": []}
    with internal_call():
        assert apply_output_language(kwargs) is kwargs

        # A task started inside the block (route_parallel's gather) inherits it.
        async def child():
            return apply_output_language(kwargs)

        assert await asyncio.gather(child()) == [kwargs]
    # Outside it again, person-facing calls get the block.
    assert len(apply_output_language(kwargs)["system"]) == 2

