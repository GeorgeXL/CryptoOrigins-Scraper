import assert from "node:assert/strict";
import test from "node:test";

import {
  canRecommendCandidate,
  exaArticleRejectionReason,
  filterEligibleCandidates,
  isBlockedArticlePickUrl,
} from "../services/editorial-pipeline/article-pick-quality";

test("blocks dailybail and philanthropy junk domains", () => {
  assert.equal(isBlockedArticlePickUrl("https://dailybail.com/foo"), true);
  assert.equal(isBlockedArticlePickUrl("https://philanthropy.com/article"), true);
  assert.equal(isBlockedArticlePickUrl("https://www.reuters.com/markets"), false);
});

test("rejects off-topic exa results for bitcoin tier", () => {
  const reason = exaArticleRejectionReason(
    {
      id: "x",
      title: "Crafting a Plan for Social Innovation",
      url: "https://philanthropy.com/plan",
      publishedDate: "2009-02-12",
      text: "",
      summary: "Nonprofit strategy column",
      score: 1,
    },
    "bitcoin",
    "2009-02-12",
  );
  assert.ok(reason);
});

test("genesis era does not recommend macro-only bailout blog", () => {
  const candidates = filterEligibleCandidates(
    [
      {
        id: "1",
        title: "Bank Bailout Congressional Video: House Rep. Brad Sherman Will Make You Smile",
        url: "https://dailybail.com/bailout",
        tier: "bitcoin" as const,
        summary: "Bailout commentary",
      },
    ],
    "2009-02-12",
  );
  assert.equal(candidates.length, 0);

  const blocked = {
    id: "2",
    title: "Federal Reserve Statistical Release H.3",
    url: "https://www.federalreserve.gov/releases/h3/",
    tier: "macro" as const,
    summary: "Federal Reserve balance sheet statistics",
    calendarSanityOk: true,
  };
  assert.equal(canRecommendCandidate(blocked, "2009-02-12"), false);
});
