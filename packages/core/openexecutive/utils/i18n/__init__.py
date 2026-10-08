"""Fixed text the API sends for people to read, in the deployment's language.

Model output follows the language through providers/output_language.py; this
covers the strings written in code — fallbacks, status labels, setup-check
advice — that reach the web UI as they are. Prompts, logs, error codes and
anything a client compares stay in English.

Each message has an id and its English text at the call site::

    tr("setup.ai_model.rejected", "Anthropic turned down the key in {var}.", var=name)

Other languages live in ``catalogs/<code>.json`` (id -> text, same ``{name}``
placeholders). A message a catalog lacks shows in English, so adding a
language is adding its code to ``LANGUAGES`` and a catalog file, and an
English-only change never has to touch a catalog. ``tests/unit/test_i18n_catalogs.py``
checks every catalog against the ids in the code.

Call ``tr`` where the text is used, not in a module-level constant, so the
language is read at request time.
"""
from __future__ import annotations

import json
import re
from collections.abc import Iterator, KeysView
from functools import cache
from pathlib import Path
from typing import Any

# Supported languages: code -> English name. The code is what OE_LANGUAGE
# takes, what <html lang> and date formatting use, and the catalog's file
# name; the name is what the output-language instruction asks the model for.
# The UI keeps the same list in packages/ui/src/i18n/languages.ts.
LANGUAGES: dict[str, str] = {"en": "English", "ko": "Korean"}
DEFAULT_LANGUAGE = "en"

_CATALOG_DIR = Path(__file__).parent / "catalogs"
_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def normalize_language(value: object) -> str | None:
    """The language code ``value`` names, or None when it names none.

    Takes a code (``ko``, ``ko-KR``) or an English name (``KOREAN``), in any
    case, so the values OE_LANGUAGE took before codes keep working.
    """
    if not isinstance(value, str):
        return None
    text = value.strip().lower()
    if text in LANGUAGES:
        return text
    base = text.split("-", 1)[0].split("_", 1)[0]
    if base in LANGUAGES:
        return base
    for code, name in LANGUAGES.items():
        if text == name.lower():
            return code
    return None


def current_language() -> str:
    """The language fixed text is shown in: the deployment's OE_LANGUAGE."""
    from openexecutive.config import get_settings

    return get_settings().oe_language


def language_name(code: str) -> str:
    """English name of a supported language code."""
    return LANGUAGES[code]


@cache
def catalog(code: str) -> dict[str, str]:
    """Messages for ``code`` (empty for English or a language with no file)."""
    path = _CATALOG_DIR / f"{code}.json"
    if code == DEFAULT_LANGUAGE or not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {str(k): str(v) for k, v in data.items()}


def fill(text: str, values: dict[str, Any]) -> str:
    """``text`` with each ``{name}`` that ``values`` has replaced.

    A plain substitution rather than ``str.format``, so a literal brace in a
    message (a JSON example) needs no escaping.
    """
    if not values:
        return text
    return _PLACEHOLDER.sub(
        lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), text
    )


def tr(message_id: str, english: str, /, **values: Any) -> str:
    """``message_id`` in the current language, else ``english``, filled.

    ``english`` must be a string literal (a test reads it from the source to
    check the catalogs); pass anything that varies as a placeholder value.
    """
    text = catalog(current_language()).get(message_id, english)
    return fill(text, values)


class MessageTable:
    """Fixed messages keyed by a value the code compares (a tool name, a
    status): ``table[key]`` is message ``<prefix>.<key>`` in the current
    language, else its English.

    Build it with a dict literal of string literals, so the catalog test can
    read the ids and their English from the source.
    """

    def __init__(self, prefix: str, english: dict[str, str]) -> None:
        self.prefix = prefix
        self.english = english

    def __getitem__(self, key: str) -> str:
        return tr(f"{self.prefix}.{key}", self.english[key])

    def __contains__(self, key: object) -> bool:
        return key in self.english

    def __iter__(self) -> Iterator[str]:
        return iter(self.english)

    def __len__(self) -> int:
        return len(self.english)

    def keys(self) -> KeysView[str]:
        return self.english.keys()

    def get(self, key: str, default: str | None = None) -> str | None:
        return self[key] if key in self.english else default
