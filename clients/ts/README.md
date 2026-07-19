# TypeScript client

A typed, **zod-validated** TypeScript / Node client for the Ace Achievers MCP
server, built on the official
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk).

The Python `scripts/demo_client.py` proves the server from Python; this proves it
from the stack the Ace Achievers web product actually runs on (TypeScript). It
spawns the same server over **stdio** and wraps all six tools behind typed
methods, and **validates every tool result at runtime** — so callers receive a
checked `Course[]` / `Question` / `QbankStats`, not an `as`-cast over trusted
JSON.

## Why a TypeScript client exists

The server is Python; the product is TypeScript. A Python-only client means the
website's own runtime cannot consume the server. This client closes that gap:
the same catalogue/question-bank tools become callable from a Node or edge
runtime, with the tool boundary checked by zod at runtime and by the compiler at
build time.

## Layout

```
clients/ts/
├── src/
│   ├── types.ts     zod schemas for the six tools (types inferred from them)
│   ├── client.ts    AceCatalogClient — stdio transport + validated methods
│   └── index.ts     public exports
├── demo.ts          exercises all six tools (mirrors demo_client.py)
├── examples/
│   └── catalog-report.ts   a real consumer: asserts catalogue contract invariants
├── test/
│   ├── unit.test.ts        hermetic — in-memory fake server, NO Python needed
│   └── integration.test.ts spawns the real Python server over stdio
├── package.json
└── tsconfig.json
```

## Run

```bash
cd clients/ts
npm install

npm run test:unit    # hermetic — green on a fresh clone with NO Python
npm test             # unit + integration (integration spawns the real server)

npm run demo         # call every tool through the typed client
npm run report       # run the catalogue contract check (real consumer)
npm run typecheck && npm run lint && npm run format:check
npm run build        # emit dist/ (.js + .d.ts)
```

The client launches the server with `python -m aceachievers_mcp.server`. Set
`ACE_MCP_PYTHON` to select an interpreter (e.g.
`ACE_MCP_PYTHON=C:/Python314/python.exe`); `PYTHONPATH` is handled for you. Set
`ACE_MCP_DEBUG=1` to surface the server's stderr when diagnosing a startup
failure.

> Note: this package is `private` (it lives inside the server repo, it is not
> published to npm). Consume it from source, or `npm run build` and import from
> `dist/`.

## Usage

```ts
import { AceCatalogClient, isToolError } from "./src/index.js";

const client = new AceCatalogClient();
await client.connect();

const courses = await client.searchCourses({ subject: "maths", year_level: 7 });
//    ^? Course[]  — validated, not cast

const q = await client.getQuestion("SAMPLE-NT-001", 1); // nudge only
if (!isToolError(q)) console.log(q.hint_1); // q.solution is undefined at level 1

await client.close();
```

Every result is parsed with zod before it is returned, so a malformed or
unexpected payload throws a clear error instead of silently satisfying the type.
`getQuestion(id, 1)` returns a `Question` whose `solution` is only populated at
`hint_level` 3 — the same tiered-reveal pedagogy the production tutor enforces.
