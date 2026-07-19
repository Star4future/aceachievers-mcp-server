/**
 * Hermetic unit tests — NO Python required.
 *
 * These wire the AceCatalogClient to an in-memory fake MCP server, so they run
 * anywhere (a fresh `npm ci && npm run test:unit` is green with no interpreter
 * on PATH). They exercise the parts that don't need the real server: FastMCP
 * multi-block rejoin, the ToolError path, tiered-hint reveal, and — crucially —
 * that zod validation *rejects* a malformed tool result instead of passing it
 * through as a bare cast.
 */
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { AceCatalogClient, TOOL_NAMES, isToolError } from "../src/index.js";

const COURSES = [
  {
    id: "amc-foundation",
    name: "AMC Y7-8 Foundation Course",
    subject: "maths",
    year_levels: [7, 8],
    course_type: "competition-foundation",
    lessons: 10,
    free_lessons: 3,
    landing_url: "https://aceachievers.com.au/amc-foundation.html",
    best_for: "New to the AMC",
  },
  {
    id: "sci-olympiad",
    name: "Science Olympiad Foundation",
    subject: "science",
    year_levels: [9, 10],
    course_type: "competition-foundation",
    lessons: 12,
    free_lessons: 2,
    landing_url: "https://aceachievers.com.au/sci-olympiad.html",
    best_for: "Building science-olympiad fundamentals",
  },
];

const QUESTION = {
  id: "SAMPLE-NT-001",
  subject: "maths",
  topic: "number-theory",
  difficulty: "easy",
  question: "Smallest positive integer divisible by both 6 and 8?",
  hint_1: "Not 48 — look for something smaller.",
  hint_2: "List multiples of 8 and stop at the first that 6 divides.",
  solution: "LCM(6,8)=24.",
  answer: "24",
};

function block(obj: unknown) {
  return { type: "text" as const, text: JSON.stringify(obj) };
}

/**
 * A fake server mirroring the six real tools. Search tools return ONE block
 * per item (FastMCP's list behaviour) so the client's rejoin logic is tested.
 */
function makeFakeServer(): Server {
  const server = new Server(
    { name: "fake-aceachievers", version: "0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_NAMES.map((name) => ({
      name,
      description: name,
      inputSchema: { type: "object" as const },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const a = args as Record<string, unknown>;

    if (name === "search_courses") {
      const hits = COURSES.filter((c) => !a.subject || c.subject === a.subject);
      return { content: hits.length ? hits.map(block) : [block([])] };
    }
    if (name === "get_course") {
      if (a.course_id === "__bad__") {
        // structurally invalid course (missing required fields) — for the
        // validation-rejection test.
        return { content: [block({ id: "x", subject: "maths" })] };
      }
      const course = COURSES.find((c) => c.id === a.course_id);
      if (!course) {
        return {
          content: [
            block({
              error: `Unknown course_id '${a.course_id}'`,
              known_ids: COURSES.map((c) => c.id),
            }),
          ],
        };
      }
      return {
        content: [
          block({
            ...course,
            pricing: {
              policy: "redirect-volatile — prices are never stored",
              live_source: "https://aceachievers.com.au/pricing.html",
            },
          }),
        ],
      };
    }
    if (name === "search_questions") {
      const ok =
        (!a.topic || QUESTION.topic.includes(String(a.topic))) &&
        (!a.difficulty || QUESTION.difficulty === a.difficulty);
      const stem = ok
        ? [
            {
              id: QUESTION.id,
              subject: QUESTION.subject,
              topic: QUESTION.topic,
              difficulty: QUESTION.difficulty,
              question: QUESTION.question,
            },
          ]
        : [];
      return { content: stem.length ? stem.map(block) : [block([])] };
    }
    if (name === "get_question") {
      if (a.question_id !== QUESTION.id) {
        return { content: [block({ error: "Unknown question_id", known_ids: [QUESTION.id] })] };
      }
      const level = Math.max(0, Math.min(3, Number(a.hint_level ?? 0)));
      const out: Record<string, unknown> = {
        id: QUESTION.id,
        subject: QUESTION.subject,
        topic: QUESTION.topic,
        difficulty: QUESTION.difficulty,
        question: QUESTION.question,
      };
      if (level >= 1) out.hint_1 = QUESTION.hint_1;
      if (level >= 2) out.hint_2 = QUESTION.hint_2;
      if (level >= 3) {
        out.solution = QUESTION.solution;
        out.answer = QUESTION.answer;
      }
      return { content: [block(out)] };
    }
    if (name === "qbank_stats") {
      return {
        content: [
          block({
            data_source: "fake sample",
            total_questions: 1,
            by_subject: { maths: 1 },
            by_difficulty: { easy: 1 },
            top_topics: { "number-theory": 1 },
          }),
        ],
      };
    }
    if (name === "get_pricing_info") {
      return {
        content: [
          block({
            policy: "redirect-volatile",
            live_source: "https://aceachievers.com.au/pricing.html",
            stable_facts: ["First lessons free"],
          }),
        ],
      };
    }
    return { content: [block({ error: `unknown tool ${name}` })], isError: true };
  });

  return server;
}

async function connectedClient(): Promise<{ client: AceCatalogClient; server: Server }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = makeFakeServer();
  await server.connect(serverTransport);
  const client = new AceCatalogClient({ transport: clientTransport });
  await client.connect();
  return { client, server };
}

let active: { client: AceCatalogClient; server: Server } | null = null;
afterEach(async () => {
  if (active) {
    await active.client.close();
    active = null;
  }
});

describe("AceCatalogClient (hermetic, in-memory server)", () => {
  it("lists exactly the six tools", async () => {
    active = await connectedClient();
    expect((await active.client.listToolNames()).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("rejoins multi-block list results and filters by subject", async () => {
    active = await connectedClient();
    const maths = await active.client.searchCourses({ subject: "maths" });
    expect(maths.length).toBe(1);
    expect(maths[0]?.subject).toBe("maths");
    const all = await active.client.searchCourses();
    expect(all.length).toBe(2); // proves N blocks were rejoined into N courses
  });

  it("returns a typed course, and a ToolError for an unknown id", async () => {
    active = await connectedClient();
    const ok = await active.client.getCourse("amc-foundation");
    expect(isToolError(ok)).toBe(false);
    if (!isToolError(ok)) expect(ok.pricing?.live_source).toContain("aceachievers.com.au");

    const missing = await active.client.getCourse("nope");
    expect(isToolError(missing)).toBe(true);
    if (isToolError(missing)) expect(missing.known_ids).toContain("amc-foundation");
  });

  it("enforces tiered hint reveal through the typed client", async () => {
    active = await connectedClient();
    const nudge = await active.client.getQuestion("SAMPLE-NT-001", 1);
    if (!isToolError(nudge)) {
      expect(nudge.hint_1).toBeDefined();
      expect(nudge.solution).toBeUndefined();
    }
    const full = await active.client.getQuestion("SAMPLE-NT-001", 3);
    if (!isToolError(full)) {
      expect(full.solution).toBeDefined();
      expect(full.answer).toBe("24");
    }
  });

  it("REJECTS a malformed tool result at runtime (zod, not a bare cast)", async () => {
    active = await connectedClient();
    await expect(active.client.getCourse("__bad__")).rejects.toThrow(/validation/);
  });
});
