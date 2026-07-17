"""Demo client: spawn the server over stdio and exercise all six tools.

Run:  python scripts/demo_client.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]


def show(title: str, payload) -> None:
    print(f"\n=== {title} " + "=" * max(0, 62 - len(title)))
    print(json.dumps(payload, indent=2, ensure_ascii=False)[:1100])


def payload(result):
    """MCP returns list results as one content block per item — rejoin them."""
    texts = [c.text for c in result.content]
    if len(texts) == 1:
        return json.loads(texts[0])
    return [json.loads(t) for t in texts]


async def main() -> None:
    env = {**os.environ, "PYTHONPATH": str(ROOT / "src")}
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "aceachievers_mcp.server"],
        cwd=str(ROOT),
        env=env,
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools = await session.list_tools()
            show("tools/list", [t.name for t in tools.tools])

            r = await session.call_tool("qbank_stats", {})
            show("qbank_stats", payload(r))

            r = await session.call_tool("search_courses", {"subject": "maths"})
            courses = payload(r)
            courses = courses if isinstance(courses, list) else [courses]
            show("search_courses(subject='maths') → ids", [c["id"] for c in courses])

            r = await session.call_tool("get_course", {"course_id": "amc-foundation"})
            show("get_course('amc-foundation')", payload(r))

            r = await session.call_tool(
                "search_questions", {"topic": "geometry", "difficulty": "hard"}
            )
            found = payload(r)
            found = found if isinstance(found, list) else [found]
            show("search_questions(topic='geometry', difficulty='hard')", found)

            first = found[0]["id"] if found else "SAMPLE-GE-002"
            r = await session.call_tool("get_question", {"question_id": first, "hint_level": 1})
            show(f"get_question('{first}', hint_level=1) — nudge only", payload(r))

            r = await session.call_tool("get_pricing_info", {})
            show("get_pricing_info (redirect-volatile)", payload(r))

    print("\nAll six tools exercised OK.")


if __name__ == "__main__":
    asyncio.run(main())
