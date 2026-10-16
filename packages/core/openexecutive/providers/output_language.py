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
    "even though these instructions are in English. That includes the "
    "section headings and labels the instructions spell out for a message "
    "(**Top call**, **Needs you**, Move today:): write each in {language}, "
    "keeping its place and formatting. When told to answer "
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

# How to write in a language, beyond picking it: added after the template for
# the languages listed here. Condensed from a Korean editing guide (no-ai-slop)
# for what the Executive writes to people: plain words, the point first, no
# filler. Like the template, it is a constant, so the cached prefix still hits.
_STYLE: dict[str, str] = {
    "ko": (
        "Writing style for Korean, for everything a person reads. Never change "
        "a fact, number, name, condition, owner, date or degree of certainty to "
        "make a sentence read better.\n"
        "- Lead with the answer, decision or ask, then only the context needed "
        "to act on it. Stop when the job is done: no recap, closing slogan or "
        "sales line.\n"
        "- Use familiar, precise words. Drop inflated adjectives (혁신적인, "
        "획기적인, 체계적인, 다양한, 실질적인) unless the sentence says what they "
        "mean, and officialese (당사, 금번, 상기, 제고). Keep established terms, "
        "product names and the English technical words the reader uses; don't "
        "mix in English where plain Korean works.\n"
        "- Let verbs carry the action: 검토했어요, not 검토를 진행했어요; 파일이 "
        "있어요, not 파일을 가지고 있는 상태예요. Untangle stacked ~의 / ~에 대한 / "
        "~에 있어서 / ~을 통해, avoid double passives (보여집니다 → 보입니다), and "
        "never honor things (5만 원이세요 → 5만 원이에요).\n"
        "- Split a sentence when its conditions hide who does what; keep clear "
        "long sentences as they are.\n"
        "- No empty framing or emphasis: 결론부터 말하자면, 시사하는 바가 큽니다, "
        "단순한 X를 넘어 Y, 'X가 아닙니다. Y입니다' that only restates. Keep a "
        "contrast that corrects a likely misunderstanding, and give the real "
        "reason instead of saying something is important.\n"
        "- Don't open sentence after sentence with 또한, 한편, 따라서; keep a "
        "connective when it shows cause, contrast or order.\n"
        "- Keep the conversation's register (polite 해요체 by default). Don't "
        "add slang, jokes or made-up anecdotes to sound friendly.\n"
        "- In plans and requests, say who does what and by when. Keep real "
        "uncertainty (~일 수 있어요) and open items (미정) as they are.\n"
        "- Format for chat: a short list only when it is easier to scan, no "
        "decorative bold, and commas, parentheses or a new sentence instead of "
        "dashes in the middle of a Korean sentence."
    ),
}

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
    text = _TEMPLATE.format(language=LANGUAGES[code])
    style = _STYLE.get(code)
    return f"{text}\n\n{style}" if style else text


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
