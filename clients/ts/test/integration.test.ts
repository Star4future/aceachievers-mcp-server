/**
 * Smoke tests for the typed TypeScript MCP client.
 *
 * These are integration tests: they spawn the real Python server over stdio and
 * exercise it through the typed wrapper, so a green run proves the whole path —
 * transport, protocol, typing, and the server's pedagogy invariant — end to end.
 *
 * Requires Python with the server package importable (PYTHONPATH=src, handled by
 * the client). Point at a specific interpreter with ACE_MCP_PYTHON if `python`
 * is not on PATH (e.g. ACE_MCP_PYTHON=C:/Python314/python.exe).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AceCatalogClient, TOOL_NAMES, isToolError } from "../src/index.js";

const client = new AceCatalogClient();

beforeAll(async () => {
  await client.connect();
}, 30_000);

afterAll(async () => {
  await client.close();
});

describe("AceCatalogClient", () => {
  it("advertises exactly the six expected tools", async () => {
    const names = await client.listToolNames();
    expect(names.sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("returns typed corpus stats from qbank_stats", async () => {
    const stats = await client.qbankStats();
    expect(stats.total_questions).toBeGreaterThan(0);
    expect(Object.keys(stats.by_subject)).toContain("maths");
    // by_difficulty is a typed Record<string, number>, not opaque JSON:
    const total = Object.values(stats.by_difficulty).reduce((a, b) => a + b, 0);
    expect(total).toBe(stats.total_questions);
  });

  it("filters courses and redirects pricing instead of storing it", async () => {
    const maths = await client.searchCourses({ subject: "maths" });
    expect(maths.length).toBeGreaterThan(0);
    expect(maths.every((c) => c.subject === "maths")).toBe(true);

    const course = await client.getCourse("amc-foundation");
    expect(isToolError(course)).toBe(false);
    if (!isToolError(course)) {
      expect(course.landing_url).toMatch(/^https?:\/\//);
      // Redirect-volatile: money is never stored, only pointed at.
      expect(course.pricing?.live_source).toContain("aceachievers.com.au");
    }
  });

  it("enforces tiered hint reveal (a nudge never spoils the solution)", async () => {
    const nudge = await client.getQuestion("SAMPLE-NT-001", 1);
    expect(isToolError(nudge)).toBe(false);
    if (!isToolError(nudge)) {
      expect(nudge.hint_1).toBeDefined();
      expect(nudge.solution).toBeUndefined();
      expect(nudge.answer).toBeUndefined();
    }

    const full = await client.getQuestion("SAMPLE-NT-001", 3);
    if (!isToolError(full)) {
      expect(full.solution).toBeDefined();
      expect(full.answer).toBeDefined();
    }
  });
});
