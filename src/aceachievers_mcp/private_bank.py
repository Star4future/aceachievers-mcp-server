"""Private question-bank loading (env-configured).

The bundled ``sample_questions.json`` keeps this repo self-contained and
free of licensed past-paper content. The production deployment points the
*same tools* at the real, private bank via environment variables:

    QBANK_PATHS   ";"-separated list of JSON bank files
    QBANK_DIR     a directory scanned for ``*.json`` bank files

Bank files may use ``{"problems": [...]}`` or ``{"questions": [...]}`` and
either of the two production schemas — the AMC maths shape (numeric
``difficulty`` 1-5, ``category``/``subcategory``) or the science-olympiad
shape (``discipline``/``topic``/``subtopic``). Records are normalised onto
the bundled sample shape, so every tool works unchanged against either
data source. Private data never enters this repository.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

# numeric (1-5) → bundled difficulty labels
_DIFFICULTY = {1: "easy", 2: "easy", 3: "medium", 4: "hard", 5: "hard"}


def _slug(value: Any) -> str:
    return str(value).strip().lower().replace(" & ", "-").replace(" ", "-").replace("/", "-")


def is_configured() -> bool:
    """True when either QBANK_PATHS or QBANK_DIR points at private data."""
    return bool(os.getenv("QBANK_PATHS", "").strip() or os.getenv("QBANK_DIR", "").strip())


def _bank_files() -> list[Path]:
    paths = os.getenv("QBANK_PATHS", "").strip()
    if paths:
        return [Path(p.strip()) for p in paths.split(";") if p.strip() and Path(p.strip()).exists()]
    qdir = os.getenv("QBANK_DIR", "").strip()
    if qdir and Path(qdir).is_dir():
        return sorted(Path(qdir).glob("*.json"))
    return []


def _normalise(raw: dict[str, Any], bank: str) -> dict[str, Any] | None:
    """Map one heterogeneous bank record onto the bundled sample shape."""
    question = raw.get("question_text") or raw.get("problem_text")
    qid = raw.get("id")
    if not qid or not question:
        return None

    difficulty = raw.get("difficulty")
    if isinstance(difficulty, (int, float)):
        difficulty = _DIFFICULTY.get(int(difficulty), "medium")
    else:
        difficulty = str(difficulty or "medium").lower()

    record: dict[str, Any] = {
        "id": str(qid),
        "subject": "science" if raw.get("discipline") else "maths",
        "topic": _slug(raw.get("topic") or raw.get("category") or "general"),
        "difficulty": difficulty,
        "question": question,
        # provenance extras (harmless additions to the full view)
        "bank": bank,
        "year": raw.get("year"),
        "level": raw.get("level"),
    }

    solution = raw.get("solution_brief") or raw.get("answer_explanation")
    if solution:
        record["solution"] = solution
    answer = raw.get("answer_value", raw.get("answer"))
    if answer is not None:
        record["answer"] = str(answer)
    # real banks carry no tiered hints — get_question degrades gracefully
    return record


def load_questions() -> list[dict[str, Any]]:
    """All normalised records from the configured private bank ([] if none)."""
    out: list[dict[str, Any]] = []
    for fp in _bank_files():
        try:
            doc = json.load(open(fp, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        rows = doc.get("problems") or doc.get("questions") or [] if isinstance(doc, dict) else doc
        for raw in rows:
            if isinstance(raw, dict):
                rec = _normalise(raw, bank=fp.stem)
                if rec:
                    out.append(rec)
    return out
