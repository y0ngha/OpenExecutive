"""Text checks that hold for Korean (and other caseless scripts) as well as
English.

The quote and claim validators were written for English: a name is a
capitalised word, a word's stem is its first letters, a short quote is a few
characters, and a line break ends a sentence. Korean has no capitals, glues
particles and endings onto the stem, packs a word into two or three
syllables, and is often wrapped mid-sentence. These helpers carry the few
rules that let the same checks read it; English text gets exactly the old
behaviour.
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable

# A word in a script without capitals (Korean, Japanese, Chinese, Thai…)
# can't be told apart from a name, so every one of them is checked. Korean
# glues particles and endings onto the stem ("지출이" said, "지출은" written;
# "나가는거야" said, "나간다" written), so such a word counts as said when,
# after at most one trailing particle or ending is taken off each side, the
# two stems are the same (``_match``). A stem is never matched on a prefix:
# 박지훈 is not 박진영, 현대차 is not 현대건설.
_PARTICLES = (
    "이라고", "에게서", "라고", "에서", "에게", "께서", "으로", "이랑", "까지", "부터",
    "보다", "처럼", "이나", "은", "는", "이", "가", "을", "를", "의", "에", "께", "도",
    "만", "로", "와", "과", "랑", "나", "요", "야",
)
_ENDINGS = (
    "입니다", "이에요", "이다", "는거야", "거야", "어요", "아요", "해요", "지만", "니다", "다", "지", "고", "면", "서", "때",
)
_SUFFIXES = sorted({*_PARTICLES, *_ENDINGS}, key=len, reverse=True)
_ENDING_SET = frozenset(_ENDINGS)

# When BOTH words lose their last syllable, that syllable may be a name's
# own: 손하나 / 손하은, 전민지 / 전민서, 문지은 / 문지나 differ only there.
# So a both-sides match takes off only a suffix of two or more syllables,
# or a single one no common given name ends in. 은 and 이 also qualify
# after a closed syllable (지출은 / 지출이 — 출 ends in ㄹ), the only place
# the particle takes that form; a name such as 하은 or 지은 opens it. 나,
# 지, 서 and 랑 end too many names ever to qualify, so 지출 says nothing
# about 지출나 and a pair like 수단이지 / 수단이다 is refused: the
# trade-off is a few refused paraphrases for never mistaking one name for
# another. Both stems must keep two syllables (하나 / 하은 → 하).
_BOTH_SIDES_SINGLE = frozenset("는을를도만의에께로와과가다고면때요야")
_AFTER_CLOSED_ONLY = frozenset("은이")
_HANGUL_FIRST, _HANGUL_LAST = 0xAC00, 0xD7A3
_JONGSEONG_COUNT = 28


def caseless(word: str) -> bool:
    """Whether ``word`` has no cased letter (Hangul, CJK, digits…)."""
    return not any(c.isupper() or c.islower() for c in word)


def _stems(word: str) -> list[tuple[str, str]]:
    """``word`` as it stands (suffix ""), then with each trailing particle or
    ending that fits taken off when something is left ("아니다" is 아니 + 다
    as well as 아 + 니다), each with the suffix that came off."""
    out = [(word, "")]
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) > len(suffix):
            out.append((word[: -len(suffix)], suffix))
    return out


def _hangul(ch: str) -> bool:
    return _HANGUL_FIRST <= ord(ch) <= _HANGUL_LAST


def _open_syllable(ch: str) -> str:
    """A Hangul syllable without its final consonant (간 → 가)."""
    if not _hangul(ch):
        return ch
    o = ord(ch)
    return chr(o - (o - _HANGUL_FIRST) % _JONGSEONG_COUNT)


def _closed(ch: str) -> bool:
    return _hangul(ch) and _open_syllable(ch) != ch


def _loose_key(stem: str) -> str:
    return stem[:-1] + _open_syllable(stem[-1])


def _both_sides_ok(stem: str, suffix: str) -> bool:
    if len(stem) < 2:
        return False
    if len(suffix) >= 2 or suffix in _BOTH_SIDES_SINGLE:
        return True
    return suffix in _AFTER_CLOSED_ONLY and _closed(stem[-1])


def _match(a: tuple[str, str], b: tuple[str, str]) -> bool:
    """Whether two (stem, suffix) forms are the same word.

    Equal stems, at most one of them shortened — or both, under
    ``_both_sides_ok``. When one side lost a verb ending, the stems may also
    differ in the final consonant of the last syllable, the one a verb
    changes as it inflects (나간다 / 나가는거야, 수단일 / 수단이지); a name
    with a particle never gets that allowance, so 김민준에게 is not 김민주."""
    (x, sx), (y, sy) = a, b
    if sx and sy and not (_both_sides_ok(x, sx) and _both_sides_ok(y, sy)):
        return False
    if x == y:
        return True
    if len(x) != len(y) or len(x) < 2 or not (sx in _ENDING_SET or sy in _ENDING_SET):
        return False
    return x[:-1] == y[:-1] and _open_syllable(x[-1]) == _open_syllable(y[-1])


class SaidIndex:
    """The caseless words of what someone said, indexed by stem once so each
    ``said_caseless`` lookup costs only the word's own few stems."""

    def __init__(self, said: Iterable[str]) -> None:
        self._by_key: dict[str, list[tuple[str, str]]] = {}
        for s in set(said):
            if not s or not caseless(s):
                continue
            for form in _stems(s):
                self._by_key.setdefault(_loose_key(form[0]), []).append(form)

    def has(self, word: str) -> bool:
        return any(
            _match(m, t)
            for m in _stems(word)
            for t in self._by_key.get(_loose_key(m[0]), ())
        )


def said_caseless(word: str, said: Iterable[str] | SaidIndex) -> bool:
    """Whether the caseless ``word`` is a caseless word in ``said`` with a
    different particle or ending (``_match``). A single character is a
    particle or a function word. Pass a ``SaidIndex`` when checking many
    words against the same text."""
    if len(word) <= 1:
        return True
    index = said if isinstance(said, SaidIndex) else SaidIndex(said)
    return index.has(word)


# One Hangul syllable or CJK character carries about as much as two or three
# Latin letters ("월 매출 3억" is "monthly revenue 300M"), so a length floor
# sized for English counts each as this many.
WIDE_CHAR_WEIGHT = 2.5


def spoken_forms(spoken: str) -> tuple[str, ...]:
    """``spoken`` normalized for a quote match, twice: as the commitment
    check reads it (a line break is a sentence end) and with each line break
    read as a space, so a quote of a sentence the speaker wrapped onto two
    lines ("...소싱할때\\n나가는거야") still matches."""
    from openexecutive.memory.episodic import _normalize_for_quote_match

    return (
        _normalize_for_quote_match(spoken),
        _normalize_for_quote_match(spoken.replace("\n", " ")),
    )


def quote_in(quote: str, spoken: str) -> bool:
    """Whether ``quote`` appears in ``spoken`` (whitespace, case and smart
    punctuation aside), reading a line break either as a sentence end or as
    a space."""
    from openexecutive.memory.episodic import _normalize_for_quote_match

    nq = _normalize_for_quote_match(quote.strip())
    return bool(nq) and any(nq in form for form in spoken_forms(spoken))


def _wide(ch: str) -> bool:
    o = ord(ch)
    return (
        0xAC00 <= o <= 0xD7A3  # Hangul syllables
        or 0x1100 <= o <= 0x11FF or 0x3130 <= o <= 0x318F  # Hangul jamo
        or 0x3040 <= o <= 0x30FF  # Hiragana, Katakana
        or 0x3400 <= o <= 0x4DBF or 0x4E00 <= o <= 0x9FFF  # CJK ideographs
        or 0xF900 <= o <= 0xFAFF
    )


def weighted_len(text: str) -> float:
    """``len(text)`` with each Hangul / kana / CJK character counted as
    ``WIDE_CHAR_WEIGHT``; plain ASCII text gets its plain length."""
    return sum(WIDE_CHAR_WEIGHT if _wide(ch) else 1.0 for ch in text)


def has_caseless_letters(text: str) -> bool:
    """Whether ``text`` holds a letter of a script without capitals."""
    return any(ch.isalpha() and not (ch.isupper() or ch.islower()) for ch in text)


# --------------------------------------------------------------------------- #
# Look-alike letters
# --------------------------------------------------------------------------- #

# English words in a deny-list are bounded by Latin letters, not ``\b``:
# Hangul is a word character, so ``\b`` would let a glued particle hide the
# word ("forward하세요"). Any other letter is refused (``lookalike_letters``).
# Latin here is ASCII plus the accented letters of Latin-1 and Latin
# Extended-A (é, ñ, ü); small capitals, IPA and other "LATIN" look-alikes
# (ᴀ, ꜱ, ɑ) are not.
_LATIN_LETTERS = "A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u017f"
_LATIN_RE = re.compile(f"[{_LATIN_LETTERS}]")
LATIN_START = rf"(?<![{_LATIN_LETTERS}])"
LATIN_END = rf"(?![{_LATIN_LETTERS}])"


def hangul_name_pattern(name: str) -> str:
    """A regex for a Hangul name anywhere, whatever glues on before it (a
    title: "팀장김민수") or after it (a particle: "김민수에게")."""
    return re.escape(name)


def lookalike_letters(text: str) -> bool:
    """Whether ``text`` holds a character that could disguise a Latin word:
    a letter other than Latin (above) or a whole Hangul syllable — Cyrillic
    "а" in "аpprove", a Greek capital, a jamo "ㅣ" for "l", a fullwidth,
    small-capital or IPA letter (ᴀ, ꜱ, ɑ), Han and kana ("送金", "承認して",
    which no deny pattern reads) — or a combining mark ("se\u034fnd"), a
    letter-like number ("appr〇ve") or a digit other than 0-9. A Latin word
    with a Korean particle ("PDF로") passes."""
    for ch in text:
        cat = unicodedata.category(ch)
        if cat in ("Mn", "Mc", "Me", "Nl") or (cat == "Nd" and not "0" <= ch <= "9"):
            return True
        if not ch.isalpha() or _hangul(ch) or _LATIN_RE.match(ch):
            continue
        return True
    return False
