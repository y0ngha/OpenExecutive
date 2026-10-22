"""The Korean-aware helpers the quote and claim validators share."""
from __future__ import annotations

import pytest

from openexecutive.utils.korean_text import (
    lookalike_letters,
    quote_in,
    said_caseless,
    weighted_len,
)


@pytest.mark.parametrize(("word", "said"), [
    ("나간다", "나가는거야"), ("수단일", "수단이지"), ("지출은", "지출도"),
    ("우선순위나", "우선순위"), ("자체는", "자체가"), ("아니다", "아니야"),
    ("김민수에게", "김민수"), ("소싱할", "소싱할때"), ("김민지가", "김민지"),
    # 하다 / 되다 on a noun, a stem inside a compound, a weekday, grammar words.
    ("신청을", "신청했어"), ("신청", "신청했어"), ("결정되며", "결정되고"),
    ("준비", "준비시간이"), ("목은", "목에"), ("있다", "제안해줘"), ("않는다", "제안해줘"),
])
def test_particles_and_endings_aside_a_word_is_said(word: str, said: str) -> None:
    assert said_caseless(word, [said])


@pytest.mark.parametrize(("word", "said"), [
    ("박지훈", "박진영"), ("이재용", "이재명"), ("김민수", "김미영"), ("현대차", "현대건설"),
    ("김민준", "김민주"), ("김민준에게", "김민주"), ("김민지", "김민서"), ("교보문고", "교보"),
    # A name whose last syllable looks like a particle or an ending.
    ("손하나", "손하은"), ("고하나", "고하은"), ("전민지", "전민서"), ("문지은", "문지나"),
    ("하나", "하은"), ("손하나가", "손하은"),
    # Inside a said word only with a suffix a both-sides match takes off.
    ("손하나", "손하은이"), ("문지은", "문지나가"), ("하나", "하은이"),
])
def test_a_different_name_is_not_said(word: str, said: str) -> None:
    assert not said_caseless(word, [said])


def test_the_claim_check_refuses_a_look_alike_name() -> None:
    from types import SimpleNamespace

    from openexecutive.orchestrator import fact_tools

    session = SimpleNamespace()
    pin = SimpleNamespace(speaker_text="박진영 대표가 이재명 건을 맡아")
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("openexecutive.delegation.settings.turn_delegation", lambda s: pin)
        missing = fact_tools._unsaid_claim_words("담당은 박지훈 대표와 이재용 건이다", session)
    assert "박지훈" in missing and "이재용" in missing


@pytest.mark.parametrize(("text", "spoof"), [
    ("аpprove", True), ("常に承認", True), ("送金은", True), ("ㅣ", True), ("ｓend", True),
    ("ᴀpprove", True), ("ꜱend", True), ("ɑpprove", True), ("appr〇ve", True),
    ("se\u034fnd", True), ("se\u0301nd", True), ("café 정리", False),
    ("PDF로 정리", False), ("답변은 짧게", False), ("Keep it short", False),
])
def test_lookalike_letters(text: str, spoof: bool) -> None:
    assert lookalike_letters(text) is spoof


def test_quote_and_length() -> None:
    assert quote_in("소싱할때 나가는거야", "재료나 소싱할때\n나가는거야")
    assert weighted_len("abc") == 3 and weighted_len("월 매출") == 8.5


def test_the_claim_check_refuses_a_name_one_syllable_off() -> None:
    from types import SimpleNamespace

    from openexecutive.orchestrator import fact_tools

    pin = SimpleNamespace(speaker_text="손하은 연락처 저장해줘")
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("openexecutive.delegation.settings.turn_delegation", lambda s: pin)
        assert fact_tools._unsaid_claim_words("담당자는 손하나", SimpleNamespace()) == ["손하나"]
        assert fact_tools._unsaid_claim_words("담당자는 손하은이다", SimpleNamespace()) == []


def test_an_index_answers_like_the_plain_list() -> None:
    from openexecutive.utils.korean_text import SaidIndex

    said = ["지출도", "나가는거야", "손하은"]
    index = SaidIndex(said)
    for word in ("지출은", "나간다", "손하나", "손하은에게"):
        assert said_caseless(word, index) == said_caseless(word, said)
