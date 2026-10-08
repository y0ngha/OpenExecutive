"""Make the model calls whose text reaches a person write in the deployment's
language.

Prompts stay in English. When the language is not English, each request gets
one system block appended after the existing ones, built from one template
and the language's name. The block's text never changes within a process, so
it sits in the cached prefix like any other constant: the cached system
blocks before it still hit, and the rolling message cache sees the same bytes
every turn. English (the default) leaves the request untouched.

Calls whose output only another model or the code reads — a specialist
consulted for the Executive, a YES/NO gate, a classifier, text extraction —
run inside ``internal_call()`` and get no block, so they work in English and
the translation happens once, in the reply a person reads.
"""
from __future__ import annotations

import contextvars
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

_TEMPLATE = (
    "Output language: write everything a person will read (replies, "
    "summaries, briefs, notes, titles, alerts, drafts) in natural {language}, "
    "even though these instructions are in English. When told to answer "
    "with a fixed word, prefix or format (YES/NO, NO|reason, IDENTITY:, "
    "JSON, a label from a list), use it exactly as given, in English. "
    "Keep in their original form: JSON keys, enum and status values, "
    "tool names and fixed tool arguments, identifiers, code, URLs, and "
    "anything you are told to quote verbatim. Write in English what only "
    "other agents read and searches of the built-in knowledge and "
    "playbooks, which are in English: a question for a specialist, a "
    "knowledge or playbook search query. A search of someone's mail, "
    "calendar or files uses the words that would appear there. A message "
    "drafted to someone outside this conversation (an email reply, a note "
    "to a colleague) follows the language of the thread it answers."
)

_internal: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "output_language_internal", default=False
)


@contextmanager
def internal_call() -> Iterator[None]:
    """Model calls made inside this block get no output-language block.

    For a call whose output a person never reads as written. A task started
    inside the block (``asyncio.gather``) inherits it.
    """
    token = _internal.set(True)
    try:
        yield
    finally:
        _internal.reset(token)


def instruction(code: str) -> str | None:
    """The output-language block's text for language ``code`` (None for
    English or an unknown code)."""
    from openexecutive.utils.i18n import DEFAULT_LANGUAGE, LANGUAGES

    if code == DEFAULT_LANGUAGE or code not in LANGUAGES:
        return None
    return _TEMPLATE.format(language=LANGUAGES[code])


def apply_output_language(kwargs: dict[str, Any]) -> dict[str, Any]:
    """``kwargs`` with the output-language block appended to ``system``.

    Returns ``kwargs`` itself when the language is English or the call is
    internal, else a shallow copy: a caller that retries with the same dict
    must not get the block twice.
    """
    from openexecutive.utils.i18n import current_language

    if _internal.get():
        return kwargs
    text = instruction(current_language())
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
