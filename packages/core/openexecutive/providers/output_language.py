"""Make every model call write for people in the language OE_LANGUAGE names.

Prompts stay in English. When OE_LANGUAGE is KOREAN, each request gets one
fixed system block appended after the existing ones. The block's text never
changes within a process, so it sits in the cached prefix like any other
constant: the cached system blocks before it still hit, and the rolling
message cache sees the same bytes every turn. ENGLISH (the default) leaves
the request untouched.
"""
from __future__ import annotations

from typing import Any

_INSTRUCTIONS = {
    "KOREAN": (
        "Output language: write everything a person will read (replies, "
        "summaries, briefs, notes, titles, alerts, drafts) in natural Korean, "
        "even though these instructions are in English. When told to answer "
        "with a fixed word, prefix or format (YES/NO, NO|reason, IDENTITY:, "
        "JSON, a label from a list), use it exactly as given, in English. "
        "Keep in their original form: JSON keys, enum and status values, "
        "tool names and fixed tool arguments, identifiers, code, URLs, and "
        "anything you are told to quote verbatim. A message drafted to someone outside this "
        "conversation (an email reply, a note to a colleague) follows the "
        "language of the thread it answers."
    ),
}


def apply_output_language(kwargs: dict[str, Any]) -> dict[str, Any]:
    """``kwargs`` with the output-language block appended to ``system``.

    Returns ``kwargs`` itself when the language is English, else a shallow
    copy: a caller that retries with the same dict must not get the block
    twice.
    """
    from openexecutive.config import get_settings

    text = _INSTRUCTIONS.get(get_settings().oe_language)
    if text is None:
        return kwargs
    block = {"type": "text", "text": text}
    system = kwargs.get("system")
    if not system:
        blocks: list[Any] = [block]
    elif isinstance(system, str):
        blocks = [{"type": "text", "text": system}, block]
    else:
        blocks = [*system, block]
    return {**kwargs, "system": blocks}
