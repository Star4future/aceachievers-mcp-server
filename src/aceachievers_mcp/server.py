"""Ace Achievers MCP server.

Exposes the course catalog and a question-bank sample to any MCP client
(Claude Desktop, Claude Code, etc.) over stdio.

Design note — redirect-volatile pricing:
    Prices and enrolment windows change on the live site, so this server
    never stores them. Volatile facts are *redirected* to their live
    source (get_pricing_info); stable facts (course structure, topics,
    question content) are served from the bundled snapshot. This is the
    same knowledge split that keeps the production chat assistant's
    answers from going stale.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

try:  # package mode (pip install -e / python -m)
    from . import private_bank
except ImportError:  # run as a loose file: python src/aceachievers_mcp/server.py
    import private_bank  # type: ignore[no-redef]

DATA_DIR = Path(__file__).parent / "data"
PRICING_URL = "https://aceachievers.com.au/pricing.html"

mcp = FastMCP(
    "aceachievers-catalog",
    instructions=(
        "Course catalog and question-bank tools for Ace Achievers "
        "(Australian K-12 competition maths / science / informatics platform). "
        "Never quote prices from memory - always call get_pricing_info."
    ),
)


def _load(name: str) -> dict:
    with open(DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def _questions() -> list[dict[str, Any]]:
    """Question source: the private bank when configured, else the bundled sample."""
    if private_bank.is_configured():
        records = private_bank.load_questions()
        if records:
            return records
    return _load("sample_questions.json")["questions"]


# ── catalog tools ────────────────────────────────────────────────────

def _search_courses(
    subject: str | None = None,
    year_level: int | None = None,
    course_type: str | None = None,
) -> list[dict[str, Any]]:
    courses = _load("courses.json")["courses"]
    out = []
    for c in courses:
        if subject and c["subject"] != subject.lower().strip():
            continue
        if year_level is not None and year_level not in c.get("year_levels", []):
            continue
        if course_type and course_type.lower().strip() not in c["course_type"]:
            continue
        out.append(c)
    return out


@mcp.tool()
def search_courses(
    subject: str | None = None,
    year_level: int | None = None,
    course_type: str | None = None,
) -> list[dict[str, Any]]:
    """Search the course catalog.

    Args:
        subject: "maths", "science" or "computer-science".
        year_level: student year level (5-12); matches courses covering it.
        course_type: substring filter — "foundation", "advanced", "mock",
            "bundle" or "acceleration".

    Returns matching courses (no prices — see get_pricing_info).
    """
    return _search_courses(subject, year_level, course_type)


def _get_course(course_id: str) -> dict[str, Any]:
    courses = {c["id"]: c for c in _load("courses.json")["courses"]}
    if course_id not in courses:
        return {
            "error": f"Unknown course_id '{course_id}'",
            "known_ids": sorted(courses.keys()),
        }
    course = dict(courses[course_id])
    course["pricing"] = {
        "policy": "redirect-volatile — prices are never stored in this dataset",
        "live_source": PRICING_URL,
    }
    return course


@mcp.tool()
def get_course(course_id: str) -> dict[str, Any]:
    """Get one course by id (e.g. "amc-foundation").

    Includes structure, target band and free-tier info. Pricing is
    deliberately redirected to the live source rather than stored.
    """
    return _get_course(course_id)


# ── question-bank tools ──────────────────────────────────────────────

def _search_questions(
    topic: str | None = None,
    difficulty: str | None = None,
) -> list[dict[str, Any]]:
    out = []
    for q in _questions():
        if topic and topic.lower().strip() not in q["topic"]:
            continue
        if difficulty and q["difficulty"] != difficulty.lower().strip():
            continue
        # listing view: question text only, no spoilers
        out.append({k: q[k] for k in ("id", "subject", "topic", "difficulty", "question")})
    return out


@mcp.tool()
def search_questions(
    topic: str | None = None,
    difficulty: str | None = None,
) -> list[dict[str, Any]]:
    """Search practice questions (sample set bundled with this repo).

    Args:
        topic: substring filter — "number-theory", "geometry", "counting",
            "algebra", "rates".
        difficulty: "easy", "medium" or "hard".

    Returns question stems only; fetch hints/solutions via get_question.
    """
    return _search_questions(topic, difficulty)


def _get_question(question_id: str, hint_level: int = 0) -> dict[str, Any]:
    qs = {q["id"]: q for q in _questions()}
    if question_id not in qs:
        return {
            "error": f"Unknown question_id '{question_id}'",
            "known_ids": sorted(qs.keys()),
        }
    q = qs[question_id]
    out = {k: q[k] for k in ("id", "subject", "topic", "difficulty", "question")}
    # Tiered reveal mirrors the production hint pedagogy: never hand the
    # solution to a student who asked for a nudge. Private-bank records may
    # carry no authored hints — reveal only what exists.
    level = max(0, min(3, int(hint_level)))
    if level >= 1 and "hint_1" in q:
        out["hint_1"] = q["hint_1"]
    if level >= 2 and "hint_2" in q:
        out["hint_2"] = q["hint_2"]
    if level >= 3:
        if "solution" in q:
            out["solution"] = q["solution"]
        if "answer" in q:
            out["answer"] = q["answer"]
    return out


@mcp.tool()
def get_question(question_id: str, hint_level: int = 0) -> dict[str, Any]:
    """Fetch one question with tiered hint reveal.

    Args:
        question_id: e.g. "SAMPLE-NT-001".
        hint_level: 0 = question only, 1 = + nudge, 2 = + approach,
            3 = + full solution and answer.
    """
    return _get_question(question_id, hint_level)


# ── corpus stats ─────────────────────────────────────────────────────

def _qbank_stats() -> dict[str, Any]:
    qs = _questions()

    def count_by(key: str) -> dict[str, int]:
        acc: dict[str, int] = {}
        for q in qs:
            k = str(q.get(key) or "unknown")
            acc[k] = acc.get(k, 0) + 1
        return dict(sorted(acc.items(), key=lambda kv: -kv[1]))

    return {
        "data_source": (
            "private bank (QBANK_PATHS / QBANK_DIR)"
            if private_bank.is_configured()
            else "bundled sample set"
        ),
        "total_questions": len(qs),
        "by_subject": count_by("subject"),
        "by_difficulty": count_by("difficulty"),
        "top_topics": dict(list(count_by("topic").items())[:12]),
    }


@mcp.tool()
def qbank_stats() -> dict[str, Any]:
    """Corpus overview: data source and counts by subject / difficulty / topic.

    Serves the bundled sample by default; when QBANK_PATHS or QBANK_DIR is
    set, the same tools run against the private production bank instead.
    """
    return _qbank_stats()


# ── pricing (redirect-volatile) ──────────────────────────────────────

def _get_pricing_info() -> dict[str, Any]:
    return {
        "policy": (
            "redirect-volatile: prices, discounts and enrolment windows "
            "change on the live site, so this server never caches them. "
            "Quote structure and content from the catalog; quote money "
            "only from the live source below."
        ),
        "live_source": PRICING_URL,
        "stable_facts": [
            "Every course offers its first lessons free with no credit card",
            "All prices on the live page are AUD and include GST",
        ],
    }


@mcp.tool()
def get_pricing_info() -> dict[str, Any]:
    """How to answer pricing questions: returns the live pricing source.

    Prices are deliberately not stored in this dataset (redirect-volatile
    design) — always send users to the live page for money amounts.
    """
    return _get_pricing_info()


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
