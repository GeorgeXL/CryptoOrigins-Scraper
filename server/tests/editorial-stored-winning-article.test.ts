import assert from "node:assert/strict";
import test from "node:test";
import { resolveStoredWinningArticle } from "../services/editorial-pipeline/run";

const sampleArticle = {
  id: "abc-123",
  title: "Litecoin hits new high",
  url: "https://example.com/litecoin-high",
  publishedDate: "2018-03-08",
  text: "Litecoin reached a new price high on exchanges.",
};

test("resolveStoredWinningArticle finds article in tiered arrays by id", () => {
  const out = resolveStoredWinningArticle({
    topArticleId: "abc-123",
    tieredArticles: { crypto: [sampleArticle] },
    analyzedArticles: null,
  });
  assert.ok(out);
  assert.equal(out?.tier, "crypto");
  assert.equal(out?.article.title, sampleArticle.title);
});

test("resolveStoredWinningArticle finds article in analyzedArticles by url", () => {
  const out = resolveStoredWinningArticle({
    topArticleId: "https://example.com/litecoin-high",
    tieredArticles: { bitcoin: [] },
    analyzedArticles: [{ ...sampleArticle, tier: "crypto" }],
    winningTier: "bitcoin",
  });
  assert.ok(out);
  assert.equal(out?.tier, "crypto");
});

test("resolveStoredWinningArticle returns null when winning article is orphaned", () => {
  const out = resolveStoredWinningArticle({
    topArticleId: "missing-url-or-id",
    tieredArticles: { bitcoin: [sampleArticle] },
    analyzedArticles: [],
  });
  assert.equal(out, null);
});
