import assert from "node:assert/strict";
import test from "node:test";

import {
  DayResearchResult,
  RESEARCH_TIER_ORDER,
  evaluateResearchAcceptance,
  isBlockedSourceUrl,
  isRecognizedMediaUrl,
  pickBestCitationUrl,
  researchSignificantEventForDate,
  runResearchWaterfall,
  validateEventDateClaim,
} from "../services/homepage-checks/perplexity-day-research";

function tierHit(
  tier: "bitcoin" | "crypto" | "macro",
  title: string,
  url: string,
): DayResearchResult {
  return {
    found: true,
    tier,
    eventTitle: title,
    sourceUrl: url,
    sourceTitle: "Example News",
    eventSnippet: `${title} happened on the target date.`,
    confidence: "high",
    reasoning: `${tier} tier match`,
    citations: [url],
  };
}

function tierMiss(tier: "bitcoin" | "crypto" | "macro", reason: string): DayResearchResult {
  return {
    found: false,
    tier: null,
    eventTitle: null,
    sourceUrl: null,
    sourceTitle: null,
    eventSnippet: null,
    confidence: "low",
    reasoning: reason,
    citations: [],
  };
}

test("pickBestCitationUrl prefers recognised media and rejects weak hosts", () => {
  const url = pickBestCitationUrl([
    "http://insecure.example.com/a",
    "https://www.youtube.com/watch?v=abc",
    "https://en.wikipedia.org/wiki/Bitcoin",
    "https://random.blog/post",
    "https://www.reuters.com/world/foo",
  ]);
  assert.equal(url, "https://www.reuters.com/world/foo");

  assert.equal(pickBestCitationUrl(["http://example.com"]), null);
  assert.equal(pickBestCitationUrl([]), null);
  assert.equal(pickBestCitationUrl(["https://www.youtube.com/watch?v=abc"]), null);
  assert.equal(isBlockedSourceUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isRecognizedMediaUrl("https://www.nytimes.com/2020/world.html"), true);
  assert.equal(isRecognizedMediaUrl("https://random.blog/post"), false);
});

test("validateEventDateClaim requires exact calendar match", () => {
  assert.equal(validateEventDateClaim("2010-05-22", "2010-05-22"), null);
  assert.match(validateEventDateClaim("2010-05-21", "2010-05-22") ?? "", /does not match/);
  assert.match(validateEventDateClaim(null, "2010-05-22") ?? "", /missing eventDate/);
});

test("evaluateResearchAcceptance rejects weak copy and non-media citations", () => {
  const bad = evaluateResearchAcceptance({
    targetDate: "2009-03-08",
    found: true,
    confidence: "high",
    eventDate: "2009-03-08",
    eventTitle: "No Bitcoin event verified",
    eventSnippet: "Portal lists Bitcoin notes but no event is verified",
    sourceUrl: "https://www.nytimes.com/example",
  });
  assert.equal(bad.accepted, false);
  assert.match(bad.reasons.join(" "), /evergreen|self-contradicting/i);
});

test("waterfall stops at bitcoin hit", async () => {
  const calls: string[] = [];
  const result = await runResearchWaterfall("2017-12-17", undefined, async (tier) => {
    calls.push(tier);
    if (tier === "bitcoin") {
      return tierHit("bitcoin", "CME launches Bitcoin futures", "https://www.reuters.com/cme-bitcoin");
    }
    return tierHit("crypto", "Should not run", "https://example.com/nope");
  });

  assert.deepEqual(calls, ["bitcoin"]);
  assert.equal(result.found, true);
  assert.equal(result.tier, "bitcoin");
  assert.match(result.eventTitle ?? "", /CME/i);
});

test("waterfall falls through bitcoin miss to crypto hit", async () => {
  const calls: string[] = [];
  const result = await runResearchWaterfall("2018-06-15", undefined, async (tier) => {
    calls.push(tier);
    if (tier === "bitcoin") return tierMiss("bitcoin", "no bitcoin event");
    if (tier === "crypto") {
      return tierHit("crypto", "SEC calls tokens securities", "https://www.coindesk.com/sec-tokens");
    }
    return tierMiss("macro", "should not reach");
  });

  assert.deepEqual(calls, ["bitcoin", "crypto"]);
  assert.equal(result.tier, "crypto");
  assert.equal(result.found, true);
});

test("waterfall falls through bitcoin and crypto to macro hit", async () => {
  const calls: string[] = [];
  const result = await runResearchWaterfall("2008-09-15", undefined, async (tier) => {
    calls.push(tier);
    if (tier === "bitcoin") return tierMiss("bitcoin", "no bitcoin");
    if (tier === "crypto") return tierMiss("crypto", "no crypto");
    return tierHit("macro", "Lehman Brothers files for bankruptcy", "https://www.nytimes.com/lehman");
  });

  assert.deepEqual(calls, RESEARCH_TIER_ORDER);
  assert.equal(result.tier, "macro");
  assert.match(result.eventTitle ?? "", /Lehman/i);
});

test("waterfall returns not found when all tiers miss", async () => {
  const calls: string[] = [];
  const result = await runResearchWaterfall("1990-01-01", undefined, async (tier) => {
    calls.push(tier);
    return tierMiss(tier, `no ${tier} event`);
  });

  assert.deepEqual(calls, RESEARCH_TIER_ORDER);
  assert.equal(result.found, false);
  assert.equal(result.tier, null);
  assert.match(result.reasoning, /bitcoin/i);
  assert.match(result.reasoning, /macro/i);
});

test("waterfall continues when tier finds event without https source", async () => {
  const calls: string[] = [];
  const result = await runResearchWaterfall("2015-01-05", undefined, async (tier) => {
    calls.push(tier);
    if (tier === "bitcoin") {
      return {
        ...tierHit("bitcoin", "Event without URL", "https://example.com"),
        sourceUrl: null,
        found: true,
      };
    }
    return tierHit("crypto", "Ethereum frontier launch", "https://www.coindesk.com/eth-frontier");
  });

  assert.deepEqual(calls, ["bitcoin", "crypto"]);
  assert.equal(result.tier, "crypto");
  assert.equal(result.found, true);
});

test("researchSignificantEventForDate uses injectable fetch for tier parsing", async () => {
  const originalKey = process.env.PERPLEXITY_API_KEY;
  process.env.PERPLEXITY_API_KEY = "test-key";

  const fetchMock: typeof fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                found: true,
                eventDate: "2010-05-22",
                eventTitle: "Bitcoin Pizza Day transaction",
                sourceUrl: "https://bitcointalk.org/pizza",
                sourceTitle: "Bitcointalk",
                eventSnippet: "Laszlo Hanyecz trades 10,000 BTC for two pizzas on this date.",
                confidence: "high",
                reasoning: "Contemporaneous reporting confirms the pizza transaction on 2010-05-22.",
              }),
            },
          },
        ],
        citations: ["https://www.reuters.com/bitcoin-pizza", "https://random.example.com/long/path"],
      }),
    }) as Response;

  try {
    const result = await researchSignificantEventForDate(
      "2010-05-22",
      undefined,
      { fetch: fetchMock, apiKey: "test-key" },
    );

    assert.equal(result.found, true);
    assert.equal(result.tier, "bitcoin");
    assert.equal(result.sourceUrl, "https://www.reuters.com/bitcoin-pizza");
  } finally {
    if (originalKey === undefined) delete process.env.PERPLEXITY_API_KEY;
    else process.env.PERPLEXITY_API_KEY = originalKey;
  }
});
