"""The message catalogs (utils/i18n/catalogs/<code>.json) match the code.

Every ``tr("id", "English", ...)`` call and ``MessageTable("prefix", {...})``
in openexecutive/ is read from the source: ids must be literal, one id means
one English text, and a catalog may only hold ids the code uses, with the
same placeholders as the English. A catalog may lack ids — those show in
English — so an English-only change never fails here.
"""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest

from openexecutive.utils import i18n

_PKG = Path(i18n.__file__).resolve().parents[2]
_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def _literal(node: ast.AST) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def _callee(node: ast.Call) -> str | None:
    f = node.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return None


def _messages() -> tuple[dict[str, str], list[str]]:
    """id -> English for every message in the code, and any problems."""
    found: dict[str, str] = {}
    problems: list[str] = []

    def add(where: str, mid: str, english: str) -> None:
        if found.get(mid, english) != english:
            problems.append(f"{where}: id {mid!r} has two English texts")
        found[mid] = english

    for path in sorted(_PKG.rglob("*.py")):
        if "i18n" in path.parts and path.name == "__init__.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        rel = path.relative_to(_PKG.parent)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = _callee(node)
            where = f"{rel}:{node.lineno}"
            if name in ("tr", "_tr") and len(node.args) >= 2:
                mid, english = _literal(node.args[0]), _literal(node.args[1])
                if mid is None or english is None:
                    problems.append(f"{where}: tr() needs a literal id and English text")
                    continue
                add(where, mid, english)
            elif name == "MessageTable" and len(node.args) == 2:
                prefix, table = _literal(node.args[0]), node.args[1]
                if prefix is None or not isinstance(table, ast.Dict):
                    problems.append(f"{where}: MessageTable needs a literal prefix and dict")
                    continue
                for k, v in zip(table.keys, table.values, strict=True):
                    key = _literal(k) if k is not None else None
                    english = _literal(v)
                    if key is None or english is None:
                        problems.append(f"{where}: MessageTable entries must be string literals")
                        continue
                    add(where, f"{prefix}.{key}", english)
    return found, problems


def _names(text: str) -> set[str]:
    return set(_PLACEHOLDER.findall(text))


def test_messages_in_the_code_are_well_formed() -> None:
    found, problems = _messages()
    assert not problems, "\n".join(problems)
    assert found, "no tr() calls found — is the scan pointed at the package?"


def test_supported_languages_have_codes_and_names() -> None:
    assert i18n.DEFAULT_LANGUAGE in i18n.LANGUAGES
    for code, name in i18n.LANGUAGES.items():
        assert re.fullmatch(r"[a-z]{2,3}", code), code
        assert name and name[0].isupper()


_CATALOGS = sorted((Path(i18n.__file__).parent / "catalogs").glob("*.json"))


def test_every_catalog_is_a_supported_language() -> None:
    for path in _CATALOGS:
        assert path.stem in i18n.LANGUAGES and path.stem != i18n.DEFAULT_LANGUAGE, path.name


@pytest.mark.parametrize("path", _CATALOGS, ids=lambda p: p.stem)
def test_catalog_matches_the_code(path: Path) -> None:
    found, _ = _messages()
    data = json.loads(path.read_text(encoding="utf-8"))
    unknown = sorted(set(data) - set(found))
    assert not unknown, f"{path.name} has ids the code no longer uses: {unknown}"
    for mid, text in data.items():
        assert isinstance(text, str) and text.strip(), f"{path.name} {mid} is blank"
        assert _names(text) == _names(found[mid]), f"{path.name} {mid} placeholders differ"


def test_tr_falls_back_to_english_and_fills(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(i18n, "catalog", lambda code: {"x.hi": "안녕 {name}"} if code == "ko" else {})
    monkeypatch.setattr(i18n, "current_language", lambda: "ko")
    assert i18n.tr("x.hi", "Hi {name}", name="A") == "안녕 A"
    assert i18n.tr("x.missing", "Plain {a} {b}", a=1) == "Plain 1 {b}"
    monkeypatch.setattr(i18n, "current_language", lambda: "en")
    assert i18n.tr("x.hi", "Hi {name}", name="A") == "Hi A"


def test_message_table(monkeypatch: pytest.MonkeyPatch) -> None:
    table = i18n.MessageTable("x.status", {"ok": "Fine", "bad": "Broken"})
    monkeypatch.setattr(i18n, "catalog", lambda code: {"x.status.ok": "좋음"})
    monkeypatch.setattr(i18n, "current_language", lambda: "ko")
    assert table["ok"] == "좋음" and table["bad"] == "Broken"
    assert "ok" in table and list(table) == ["ok", "bad"]
    assert table.get("nope") is None


@pytest.mark.parametrize(
    ("value", "code"),
    [("ko", "ko"), ("KOREAN", "ko"), (" korean ", "ko"), ("ko-KR", "ko"), ("ENGLISH", "en"),
     ("en", "en"), ("fr", None), ("", None), (None, None)],
)
def test_normalize_language(value: object, code: str | None) -> None:
    assert i18n.normalize_language(value) == code
