/**
 * Typed contracts for the Ace Achievers MCP server's six tools — as zod
 * schemas, with the TypeScript types inferred from them (single source of
 * truth). The client validates every tool result against these at runtime, so
 * "typed" means *validated*, not a bare `as` cast over trusted JSON.
 *
 * Shapes mirror `src/aceachievers_mcp/server.py`. Catalogue/question records
 * use `.passthrough()` so the server can add descriptive fields without
 * breaking clients, while the fields we depend on stay checked.
 */
import { z } from "zod";

/** Difficulty band carried by every question record. */
export const DifficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

/** Subjects the catalogue is organised by. */
export type Subject = "maths" | "science" | "computer-science";

/** Redirect-volatile pricing pointer — the server never stores money amounts. */
export const PricingRedirectSchema = z.object({
  policy: z.string(),
  live_source: z.string(),
});
export type PricingRedirect = z.infer<typeof PricingRedirectSchema>;

/**
 * A catalogue course as served by `search_courses` / `get_course`.
 *
 * The catalogue is heterogeneous: lesson-based courses carry `lessons` /
 * `free_lessons`, while mock/bundle products carry `mocks` / `free_mocks` (or
 * neither). Only the fields present on *every* course are required; the rest
 * are optional, and `.passthrough()` keeps any future fields.
 */
export const CourseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    subject: z.string(),
    year_levels: z.array(z.number()),
    course_type: z.string(),
    landing_url: z.string(),
    best_for: z.string(),
    // Lesson-based courses:
    lessons: z.number().optional(),
    free_lessons: z.number().optional(),
    // Mock/bundle products:
    mocks: z.number().optional(),
    free_mocks: z.number().optional(),
    // Present only on get_course — prices are redirected, never stored.
    pricing: PricingRedirectSchema.optional(),
  })
  .passthrough();
export type Course = z.infer<typeof CourseSchema>;

/** Listing view of a question — stem only, no hints or answer (no spoilers). */
export const QuestionStemSchema = z
  .object({
    id: z.string(),
    subject: z.string(),
    topic: z.string(),
    difficulty: DifficultySchema,
    question: z.string(),
  })
  .passthrough();
export type QuestionStem = z.infer<typeof QuestionStemSchema>;

/**
 * A question fetched via `get_question`. Hints/solution appear progressively
 * with `hint_level` (tiered reveal) and only if the record authored them.
 */
export const QuestionSchema = QuestionStemSchema.extend({
  hint_1: z.string().optional(),
  hint_2: z.string().optional(),
  solution: z.string().optional(),
  answer: z.string().optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

/** Corpus overview returned by `qbank_stats`. */
export const QbankStatsSchema = z.object({
  data_source: z.string(),
  total_questions: z.number(),
  by_subject: z.record(z.string(), z.number()),
  by_difficulty: z.record(z.string(), z.number()),
  top_topics: z.record(z.string(), z.number()),
});
export type QbankStats = z.infer<typeof QbankStatsSchema>;

/** Pricing guidance returned by `get_pricing_info` (redirect-volatile). */
export const PricingInfoSchema = z.object({
  policy: z.string(),
  live_source: z.string(),
  stable_facts: z.array(z.string()),
});
export type PricingInfo = z.infer<typeof PricingInfoSchema>;

/** Shape a tool returns when it is handed an unknown id. */
export const ToolErrorSchema = z.object({
  error: z.string(),
  known_ids: z.array(z.string()),
});
export type ToolError = z.infer<typeof ToolErrorSchema>;

/** Type guard: did a lookup tool hand back an error envelope? */
export function isToolError(x: unknown): x is ToolError {
  return ToolErrorSchema.safeParse(x).success;
}

// ── Tool argument contracts ──────────────────────────────────────────

export interface SearchCoursesArgs {
  subject?: Subject | string;
  year_level?: number;
  course_type?: string;
}

export interface SearchQuestionsArgs {
  topic?: string;
  difficulty?: Difficulty;
}

/** 0 = question only · 1 = + nudge · 2 = + approach · 3 = + full solution. */
export type HintLevel = 0 | 1 | 2 | 3;

/** The exact set of tools this server exposes, in listing order. */
export const TOOL_NAMES = [
  "search_courses",
  "get_course",
  "search_questions",
  "get_question",
  "qbank_stats",
  "get_pricing_info",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
