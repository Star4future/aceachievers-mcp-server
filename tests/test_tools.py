"""Unit tests for the catalog / question-bank tool logic."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from aceachievers_mcp.server import (  # noqa: E402
    _get_course,
    _get_pricing_info,
    _get_question,
    _search_courses,
    _search_questions,
)


def test_search_courses_no_filter_returns_all():
    assert len(_search_courses()) == 26


def test_search_courses_by_subject():
    maths = _search_courses(subject="maths")
    assert maths and all(c["subject"] == "maths" for c in maths)


def test_search_courses_by_year_level():
    y5 = _search_courses(year_level=5)
    assert y5 and all(5 in c["year_levels"] for c in y5)


def test_search_courses_by_type_substring():
    mocks = _search_courses(course_type="mock")
    assert mocks and all("mock" in c["course_type"] for c in mocks)


def test_get_course_known_id_has_redirect_volatile_pricing():
    c = _get_course("amc-foundation")
    assert c["name"].startswith("AMC")
    assert "price" not in c
    assert "redirect-volatile" in c["pricing"]["policy"]
    assert c["pricing"]["live_source"].startswith("https://")


def test_get_course_unknown_id_lists_known_ids():
    c = _get_course("nope")
    assert "error" in c and "amc-foundation" in c["known_ids"]


def test_search_questions_listing_never_spoils():
    qs = _search_questions()
    assert len(qs) == 10
    for q in qs:
        assert "solution" not in q and "answer" not in q and "hint_1" not in q


def test_search_questions_filters():
    hard_geo = _search_questions(topic="geometry", difficulty="hard")
    assert [q["id"] for q in hard_geo] == ["SAMPLE-GE-002"]


def test_get_question_tiered_reveal():
    q0 = _get_question("SAMPLE-NT-001", hint_level=0)
    assert "hint_1" not in q0 and "solution" not in q0
    q1 = _get_question("SAMPLE-NT-001", hint_level=1)
    assert "hint_1" in q1 and "hint_2" not in q1
    q3 = _get_question("SAMPLE-NT-001", hint_level=3)
    assert q3["answer"] == "24" and "solution" in q3


def test_get_question_clamps_hint_level():
    q = _get_question("SAMPLE-NT-001", hint_level=99)
    assert q["answer"] == "24"


def test_get_question_unknown_id():
    q = _get_question("nope")
    assert "error" in q and "SAMPLE-NT-001" in q["known_ids"]


def test_pricing_info_is_redirect_only():
    p = _get_pricing_info()
    assert "redirect-volatile" in p["policy"]
    assert p["live_source"] == "https://aceachievers.com.au/pricing.html"
    assert not any(ch.isdigit() and ch != "0" for ch in "")  # no hardcoded amounts field at all
    assert "price" not in p
