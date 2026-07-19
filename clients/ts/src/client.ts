/**
 * AceCatalogClient — a typed TypeScript/Node client for the Ace Achievers
 * MCP server, built on the official Model Context Protocol SDK.
 *
 * It spawns the Python server over stdio (the same transport the Python
 * `scripts/demo_client.py` uses) and wraps all six tools behind typed methods.
 * Every tool result is **validated with zod** before it is returned, so callers
 * get a checked `Course[]` / `Question` / `QbankStats` — not an `as`-cast over
 * trusted JSON. This is the client a Node/TypeScript product (the Ace Achievers
 * web stack is TS) would use to consume the server.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

import {
  CourseSchema,
  PricingInfoSchema,
  QbankStatsSchema,
  QuestionSchema,
  QuestionStemSchema,
  ToolErrorSchema,
  type Course,
  type HintLevel,
  type PricingInfo,
  type QbankStats,
  type Question,
  type QuestionStem,
  type SearchCoursesArgs,
  type SearchQuestionsArgs,
  type ToolError,
} from "./types.js";

// clients/ts/src → repo root is three levels up.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

const CourseOrError = z.union([ToolErrorSchema, CourseSchema]);
const QuestionOrError = z.union([ToolErrorSchema, QuestionSchema]);

/** A single text content block as returned by an MCP tool call. */
interface TextBlock {
  type: string;
  text?: string;
}

export interface AceCatalogClientOptions {
  /**
   * Python interpreter to launch the server with. Defaults to
   * `$ACE_MCP_PYTHON` then `"python"`, so a fresh checkout works without
   * editing code (set the env var to a full path on Windows).
   */
  python?: string;
  /** Repo root used as the server's cwd. Defaults to this package's repo. */
  cwd?: string;
  /**
   * Inject a transport instead of spawning the Python server over stdio.
   * Used by the hermetic unit tests (an in-memory transport), so they run in
   * CI without a Python environment. Production callers omit this.
   */
  transport?: Transport;
}

/**
 * FastMCP returns a *list* result as one text block per item, and a scalar
 * result as a single block. Rejoin them the way the Python demo does.
 */
function parseBlocks(content: TextBlock[]): unknown {
  const parsed = content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => JSON.parse(c.text as string));
  if (parsed.length === 1) return parsed[0];
  return parsed;
}

/** Force a tool result into an array (search tools may return 0/1/N items). */
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

/** Validate a parsed result against a schema, with a clear error on mismatch. */
function validate<T>(schema: z.ZodType<T>, value: unknown, ctx: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`MCP result for ${ctx} failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

export class AceCatalogClient {
  private readonly client: Client;
  private readonly transport: Transport;
  private connected = false;

  constructor(opts: AceCatalogClientOptions = {}) {
    const cwd = opts.cwd ?? REPO_ROOT;
    const python = opts.python ?? process.env.ACE_MCP_PYTHON ?? "python";
    this.transport =
      opts.transport ??
      new StdioClientTransport({
        command: python,
        args: ["-m", "aceachievers_mcp.server"],
        cwd,
        env: { ...getDefaultEnvironment(), PYTHONPATH: resolve(cwd, "src") },
        // Server logs request types to stderr. Keep stdout clean by default,
        // but surface stderr when debugging so a crashed server isn't a silent
        // hang.
        stderr: process.env.ACE_MCP_DEBUG ? "inherit" : "ignore",
      });
    this.client = new Client(
      { name: "aceachievers-catalog-ts-client", version: "0.1.0" },
      { capabilities: {} },
    );
  }

  /** Spawn the server and complete the MCP handshake. Idempotent. */
  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      await this.client.connect(this.transport);
    } catch (err) {
      const hint = process.env.ACE_MCP_DEBUG
        ? ""
        : " (set ACE_MCP_DEBUG=1 to see the server's stderr)";
      throw new Error(
        `failed to connect to the MCP server${hint}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    this.connected = true;
  }

  /** Close the session and terminate the server subprocess. */
  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }

  /** Tool names the server advertises, in listing order. */
  async listToolNames(): Promise<string[]> {
    const { tools } = await this.client.listTools();
    return tools.map((t) => t.name);
  }

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.callTool({ name, arguments: args });
    if (result.isError) {
      throw new Error(`MCP tool ${name} returned an error result`);
    }
    return parseBlocks(result.content as TextBlock[]);
  }

  // ── catalogue tools ────────────────────────────────────────────────

  async searchCourses(args: SearchCoursesArgs = {}): Promise<Course[]> {
    const raw = asArray(await this.call("search_courses", { ...args }));
    return validate(z.array(CourseSchema), raw, "search_courses");
  }

  async getCourse(courseId: string): Promise<Course | ToolError> {
    const raw = await this.call("get_course", { course_id: courseId });
    return validate(CourseOrError, raw, "get_course");
  }

  // ── question-bank tools ────────────────────────────────────────────

  async searchQuestions(args: SearchQuestionsArgs = {}): Promise<QuestionStem[]> {
    const raw = asArray(await this.call("search_questions", { ...args }));
    return validate(z.array(QuestionStemSchema), raw, "search_questions");
  }

  async getQuestion(questionId: string, hintLevel: HintLevel = 0): Promise<Question | ToolError> {
    const raw = await this.call("get_question", {
      question_id: questionId,
      hint_level: hintLevel,
    });
    return validate(QuestionOrError, raw, "get_question");
  }

  // ── corpus + pricing ───────────────────────────────────────────────

  async qbankStats(): Promise<QbankStats> {
    return validate(QbankStatsSchema, await this.call("qbank_stats", {}), "qbank_stats");
  }

  async getPricingInfo(): Promise<PricingInfo> {
    return validate(PricingInfoSchema, await this.call("get_pricing_info", {}), "get_pricing_info");
  }
}
