# Ace Achievers MCP Server

> An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server exposing the
> [Ace Achievers](https://aceachievers.com.au) course catalog and question-bank tools to any
> MCP client — Claude Desktop, Claude Code, or your own agent.

[![CI](https://github.com/Star4future/aceachievers-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/Star4future/aceachievers-mcp-server/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)]()
[![MCP](https://img.shields.io/badge/Protocol-MCP-6B4FBB)]()
[![MIT](https://img.shields.io/badge/License-MIT-yellow)]()

## What this is

MCP is the open standard that lets an LLM agent call typed tools over a common wire protocol
(JSON-RPC over stdio or HTTP) — write the server once, and any MCP-capable client can use it.
This server packages the product-data tools I built for an Australian K-12 competition-learning
platform, so an agent can answer *"which course fits a Year 7 student new to competition maths?"*
against live catalog data instead of guessing.

## Tools

| Tool | What it does |
|------|--------------|
| `search_courses(subject?, year_level?, course_type?)` | Filter the 26-course catalog (maths / science / computer-science, Years 5–12) |
| `get_course(course_id)` | One course in full — structure, target band, free-tier info |
| `search_questions(topic?, difficulty?)` | Search the question bank — returns stems only, never spoilers |
| `get_question(question_id, hint_level)` | Tiered reveal: 0 = question, 1 = nudge, 2 = approach, 3 = full solution |
| `get_pricing_info()` | The redirect-volatile pricing contract (see design notes) |

## Quick start

```bash
git clone https://github.com/Star4future/aceachievers-mcp-server
cd aceachievers-mcp-server
pip install -e ".[dev]"
pytest                      # 12 tests
aceachievers-mcp            # runs the stdio server
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aceachievers": {
      "command": "aceachievers-mcp"
    }
  }
}
```

Then ask Claude: *"Find a hard geometry question and give me a nudge, not the answer."*

## Design notes

**Redirect-volatile pricing.** Prices and enrolment windows change on the live site, so this
server refuses to store them: `get_pricing_info` returns the live source instead of numbers.
Stable facts (course structure, topics, question content) are served from the bundled snapshot.
This is the same volatile/stable knowledge split that let the platform's production chat
assistant absorb a 3× catalog expansion with zero pricing-logic rewrites — the bot can't go
stale on facts it never stored.

**Tiered hint reveal.** `get_question` mirrors the production RAG tutor's pedagogy: a student
who asks for a nudge must not receive the answer, so hints unlock level by level and the
listing view never includes solutions. The guardrail lives server-side — the client can't
accidentally spoil.

**Sample data.** The bundled question set is original material written for this demo in the
production bank's format. The production deployment points these same tools at the private
store (2,500+ taxonomically classified problems, extracted from PDFs via a Vision-API
pipeline); licensed past-paper content is not redistributed here.

## Layout

```
src/aceachievers_mcp/
├── server.py          # FastMCP server: 5 tools, pure logic separated for testing
└── data/
    ├── courses.json           # 26-course catalog snapshot (no prices — by design)
    └── sample_questions.json  # 10 original questions with 3-tier hints
tests/test_tools.py    # 13 unit tests
```

## License

MIT — see [LICENSE](LICENSE).
