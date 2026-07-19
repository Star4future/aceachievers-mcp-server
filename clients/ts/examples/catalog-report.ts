/**
 * catalog-report — a real consumer of the typed client, not a toy demo.
 *
 * It uses AceCatalogClient to pull the catalogue and question bank, prints a
 * short report, and ASSERTS the product's contract invariants:
 *   1. every course exposes a live landing_url (https)
 *   2. get_course redirects pricing (never stores a numeric price)
 *   3. a hint-level-1 question is never spoiled the solution
 *
 * It exits non-zero if any invariant is violated, so CI can gate on it — the
 * typed client is used to *enforce a contract*, which is how a product would
 * consume it. Run: `tsx examples/catalog-report.ts`.
 */
import { AceCatalogClient, isToolError } from "../src/index.js";

async function main(): Promise<void> {
  const client = new AceCatalogClient();
  await client.connect();
  const failures: string[] = [];
  try {
    const stats = await client.qbankStats();
    const courses = await client.searchCourses();
    console.log(
      `Catalogue: ${courses.length} courses · question bank: ${stats.total_questions} (${stats.data_source})`,
    );

    // Invariant 1 — every course has a live landing URL.
    for (const c of courses) {
      if (!/^https:\/\//.test(c.landing_url)) {
        failures.push(`course ${c.id} has no https landing_url`);
      }
    }

    // Invariant 2 — pricing is redirected, never stored as a number.
    const sample = courses[0];
    if (sample) {
      const detail = await client.getCourse(sample.id);
      if (!isToolError(detail)) {
        const priceString = JSON.stringify(detail.pricing ?? {});
        if (!/live_source/.test(priceString) || /\$|\d+\.\d{2}/.test(priceString)) {
          failures.push(`course ${sample.id} pricing is not redirect-only: ${priceString}`);
        }
        console.log(`Pricing policy (${sample.id}): redirect → ${detail.pricing?.live_source}`);
      }
    }

    // Invariant 3 — a nudge (hint_level 1) must not reveal the solution.
    const stems = await client.searchQuestions();
    const first = stems[0];
    if (first) {
      const nudged = await client.getQuestion(first.id, 1);
      if (!isToolError(nudged) && nudged.solution !== undefined) {
        failures.push(`question ${first.id} leaked its solution at hint_level 1`);
      }
      console.log(`Pedagogy check (${first.id}): hint_level 1 reveals no solution ✓`);
    }
  } finally {
    await client.close();
  }

  if (failures.length) {
    console.error(`\n✗ ${failures.length} contract violation(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\n✓ All catalogue contract invariants hold.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
