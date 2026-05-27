/**
 * Smoke test for the v3 gated article-pick flow.
 *
 * Without hitting Exa or OpenAI, this validates:
 *   1. The article-pick package schema + type guard.
 *   2. `determineApprovedAction` correctly routes to "article_pick".
 *   3. Calendar sanity flags mismatches (e.g. Pizza Day text on the wrong date).
 *
 * Usage: `npx tsx server/scripts/smoke-editorial-article-pick.ts`
 *
 * Add `--with-writer` to also exercise the real DB writer + OpenAI summary on a
 * disposable date. SKIP THAT in production.
 */

import { reviewPackageSchema, isArticlePickPackage } from "../services/editorial-pipeline/review-package";
import { determineApprovedAction } from "../services/editorial-pipeline/approved-writer";
import { detectCanonicalDateMismatch } from "../services/editorial-pipeline/tools";

function logCheck(label: string, ok: boolean, extra?: unknown) {
  const symbol = ok ? "✅" : "❌";
  if (extra !== undefined) {
    console.log(`${symbol} ${label}`, extra);
  } else {
    console.log(`${symbol} ${label}`);
  }
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log("\n=== Editorial v3 gated article-pick smoke ===\n");

  const samplePackage = {
    phase: "awaiting_article_pick" as const,
    scenario: "empty_day" as const,
    triage: {
      date: "2012-11-24",
      analysisId: "9d6f7c12-2b3e-4a55-9c66-2f0b5e7c1abc",
      route: "empty_day" as const,
      reasons: ["Day flagged empty in triage"],
      requiredAgents: ["SourceFinderAgent" as const],
      confidence: 0.6,
    },
    candidates: [
      {
        id: "art-1",
        title: "Bitcoin block reward halves",
        url: "https://example.com/btc-halving-2012",
        publishedDate: "2012-11-28T12:00:00.000Z",
        tier: "bitcoin" as const,
        source: "example.com",
        summary: "First halving event reduces block reward to 25 BTC.",
        rank: 0,
        publishedDateOffsetDays: 4,
        calendarSanityOk: false,
        calendarSanityNotes: ["Article published 4 day(s) after target date"],
      },
      {
        id: "art-2",
        title: "Laszlo's pizza purchase explained",
        url: "https://example.com/pizza-day-feature",
        publishedDate: "2012-11-24T08:00:00.000Z",
        tier: "bitcoin" as const,
        source: "example.com",
        summary: "Bitcoin Pizza Day retrospective.",
        rank: 1,
        publishedDateOffsetDays: 0,
        calendarSanityOk: false,
        calendarSanityNotes: [
          "Looks like bitcoin-pizza-day (canonical date 2010-05-22): Article mentions Bitcoin Pizza Day…",
        ],
      },
    ],
    hasCandidates: true,
    note: "Exa returned candidates for this day. Pick the winning article.",
  };

  const parsed = reviewPackageSchema.safeParse(samplePackage);
  logCheck("package parses via reviewPackageSchema", parsed.success, parsed.success ? undefined : parsed.error.flatten());

  logCheck("isArticlePickPackage guard accepts the package", isArticlePickPackage(samplePackage));

  const action = determineApprovedAction(samplePackage);
  logCheck(
    "determineApprovedAction → article_pick",
    action.ok === true && action.action?.kind === "article_pick" && action.action.date === "2012-11-24",
    action,
  );

  const pizzaMismatch = detectCanonicalDateMismatch(
    "Laszlo Hanyecz buys two pizzas for 10,000 BTC, marking Bitcoin Pizza Day.",
    "2012-11-24",
  );
  logCheck(
    "calendar sanity catches Pizza Day on wrong date",
    pizzaMismatch !== null && pizzaMismatch?.expectedDate === "2010-05-22",
    pizzaMismatch,
  );

  const correctDay = detectCanonicalDateMismatch(
    "Laszlo Hanyecz buys two pizzas for 10,000 BTC, marking Bitcoin Pizza Day.",
    "2010-05-22",
  );
  logCheck("calendar sanity passes Pizza Day on canonical date", correctDay === null, correctDay);

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Smoke crashed:", e);
  process.exit(1);
});
