import assert from "node:assert/strict";
import test from "node:test";

import { reviewPackageSchema, articleCandidateSchema, isArticlePickPackage } from "../services/editorial-pipeline/review-package";
import { evaluateCandidateStorySanity } from "../services/editorial-pipeline/source-finder-v2";

test("articleCandidateSchema accepts a fully-formed Exa candidate", () => {
  const c = articleCandidateSchema.parse({
    id: "abc-123",
    title: "Bitcoin reaches new high",
    url: "https://example.com/btc",
    publishedDate: "2025-01-15T10:00:00.000Z",
    tier: "bitcoin",
    source: "example.com",
    summary: "Bitcoin hit a new all-time high...",
    rank: 0,
    publishedDateOffsetDays: 0,
    calendarSanityOk: true,
    calendarSanityNotes: [],
  });
  assert.equal(c.tier, "bitcoin");
  assert.equal(c.calendarSanityOk, true);
});

test("reviewPackageSchema accepts an awaiting_article_pick payload", () => {
  const parsed = reviewPackageSchema.parse({
    phase: "awaiting_article_pick",
    scenario: "empty_day",
    triage: {
      date: "2012-11-24",
      analysisId: "00000000-0000-0000-0000-000000000000",
      route: "empty_day",
      reasons: ["Day flagged empty in triage"],
      requiredAgents: ["SourceFinderAgent"],
      confidence: 0.6,
    },
    candidates: [],
    hasCandidates: false,
    note: "No Exa results — confirm empty or rerun",
  });
  assert.equal(parsed.phase, "awaiting_article_pick");
});

test("isArticlePickPackage guards correctly", () => {
  assert.equal(isArticlePickPackage({ phase: "awaiting_article_pick", candidates: [] }), true);
  assert.equal(isArticlePickPackage({ phase: "other" }), false);
  assert.equal(isArticlePickPackage(null), false);
  assert.equal(isArticlePickPackage("string"), false);
});

test("isArticlePickPackage infers article pick when phase omitted but payload matches", () => {
  const pkg = {
    scenario: "missing_day" as const,
    triage: {
      date: "2025-01-01",
      analysisId: null,
      route: "missing_day" as const,
      reasons: ["No row"],
      requiredAgents: ["SourceFinderAgent"],
      confidence: 0.5,
    },
    candidates: [
      {
        id: "c1",
        title: "Story",
        url: "https://example.com/a",
        tier: "bitcoin" as const,
        rank: 0,
        publishedDateOffsetDays: 0,
        calendarSanityOk: true,
        calendarSanityNotes: [],
      },
    ],
    hasCandidates: true,
  };
  assert.equal(isArticlePickPackage(pkg), true);
});

test("articleCandidateSchema accepts optional relevance fields", () => {
  const c = articleCandidateSchema.parse({
    id: "abc-456",
    title: "Bitcoin hits ATH",
    url: "https://example.com/ath",
    publishedDate: "2025-03-14T00:00:00.000Z",
    tier: "bitcoin",
    rank: 0,
    publishedDateOffsetDays: 0,
    calendarSanityOk: true,
    calendarSanityNotes: [],
    relevanceScore: 0.87,
    recommended: true,
    relevanceNotes: ["tier=bitcoin (+0.32)", "rank #1 (+0.15)"],
  });
  assert.equal(c.recommended, true);
  assert.equal(c.relevanceScore, 0.87);
  assert.equal(c.relevanceNotes?.length, 2);
});

test("articleCandidateSchema works without relevance fields (backwards-compat)", () => {
  const c = articleCandidateSchema.parse({
    id: "abc-789",
    title: "Title",
    url: "https://example.com/legacy",
    publishedDate: null,
    tier: "macro",
    rank: 3,
    publishedDateOffsetDays: null,
    calendarSanityOk: true,
    calendarSanityNotes: [],
  });
  assert.equal(c.recommended, undefined);
  assert.equal(c.relevanceScore, undefined);
});


test("evaluateCandidateStorySanity blocks anniversary roundup headlines with extra noise", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2026-01-03",
    title: "First Bitcoin Block Mined by Satoshi 17 Years Ago, Coinbase Shares Epic Tweet — TradingView News",
    summary: "A retrospective genesis-block article mixed with a secondary Coinbase tweet angle.",
    text: "First Bitcoin Block Mined by Satoshi 17 Years Ago, Coinbase Shares Epic Tweet — TradingView News",
  });

  assert.equal(result.ok, false);
  assert.ok(result.notes.some((n) => /anniversary headline is mixed/i.test(n)));
});

test("evaluateCandidateStorySanity allows a clean canonical anniversary headline", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2026-01-03",
    title: "The Bitcoin genesis block has been created for 17 years",
    summary: "A clean anniversary note about Bitcoin Genesis Day.",
    text: "The Bitcoin genesis block has been created for 17 years.",
  });

  assert.equal(result.ok, true);
});


test("evaluateCandidateStorySanity blocks bare halving explainer titles", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2022-03-02",
    title: "The Bitcoin Halving",
    summary: "A generic explainer about the halving.",
    text: "The Bitcoin Halving",
  });

  assert.equal(result.ok, false);
  assert.ok(result.notes.some((n) => /bare topic\/profile headline/i.test(n) || /explainer/i.test(n)));
});

test("evaluateCandidateStorySanity blocks advice-style bitcoin mining titles", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2022-03-02",
    title: "Important Factors to Consider For Your Bitcoin Mining Home Base",
    summary: "Advice for choosing a home base for Bitcoin mining.",
    text: "Important factors to consider for your Bitcoin mining home base.",
  });

  assert.equal(result.ok, false);
  assert.ok(result.notes.some((n) => /advice\/how-to framing/i.test(n)));
});

test("evaluateCandidateStorySanity blocks recurring house-format market headlines", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2022-03-03",
    title: "First Mover Americas: Fed Hikes Could Drive Bitcoin Adoption in Emerging Markets",
    summary: "A recurring market-format headline speculates on adoption.",
    text: "First Mover Americas discusses how Fed hikes could drive Bitcoin adoption in emerging markets.",
  });

  assert.equal(result.ok, false);
  assert.ok(result.notes.some((n) => /recurring house format|prediction\/speculation/i.test(n)));
});
