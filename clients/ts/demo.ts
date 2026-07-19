/**
 * Typed demo client — spawns the server over stdio and exercises all six
 * tools, mirroring `scripts/demo_client.py` but through the typed wrapper.
 *
 * Run:  npm run demo         (from clients/ts/)
 *       ACE_MCP_PYTHON=C:/Python314/python.exe npm run demo   (Windows)
 */
import { AceCatalogClient, isToolError } from "./src/index.js";

function show(title: string, payload: unknown): void {
  console.log(`\n=== ${title} ` + "=".repeat(Math.max(0, 60 - title.length)));
  console.log(JSON.stringify(payload, null, 2).slice(0, 1100));
}

async function main(): Promise<void> {
  const client = new AceCatalogClient();
  await client.connect();
  try {
    show("tools/list", await client.listToolNames());

    const stats = await client.qbankStats();
    show("qbank_stats", stats);

    const courses = await client.searchCourses({ subject: "maths" });
    show(
      "searchCourses({ subject: 'maths' }) → ids",
      courses.map((c) => c.id),
    );

    const course = await client.getCourse("amc-foundation");
    show("getCourse('amc-foundation')", course);

    const found = await client.searchQuestions({ topic: "geometry", difficulty: "hard" });
    show("searchQuestions({ topic: 'geometry', difficulty: 'hard' })", found);

    const firstId = found[0]?.id ?? "SAMPLE-GE-002";
    const nudged = await client.getQuestion(firstId, 1);
    show(`getQuestion('${firstId}', hintLevel=1) — nudge only`, nudged);
    // The typed boundary lets us assert the pedagogy invariant in-line:
    if (!isToolError(nudged) && nudged.solution !== undefined) {
      throw new Error("pedagogy breach: solution leaked at hint_level 1");
    }

    show("getPricingInfo (redirect-volatile)", await client.getPricingInfo());
  } finally {
    await client.close();
  }
  console.log("\nAll six tools exercised OK (typed TypeScript client).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
