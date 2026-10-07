"""Fixed text the API sends for people to read, in OE_LANGUAGE.

Model output follows OE_LANGUAGE through providers/output_language.py; this
covers the strings written in code — fallbacks, status labels, setup-check
advice — that reach the web UI as they are. Prompts, logs, error codes and
anything a client compares stay in English.

Call it where the text is used, not in a module-level constant, so the
setting is read at request time.
"""
from __future__ import annotations


def is_korean() -> bool:
    """Whether OE_LANGUAGE is KOREAN, read now."""
    from openexecutive.config import get_settings

    return get_settings().oe_language == "KOREAN"


def localized(english: str, korean: str) -> str:
    """``korean`` when OE_LANGUAGE is KOREAN, else ``english``."""
    return korean if is_korean() else english
