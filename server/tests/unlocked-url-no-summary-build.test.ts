import assert from "node:assert/strict";
import { test } from "node:test";

import { buildUnlockedUrlNoSummaryEntries } from "../../shared/unlocked-url-no-summary-build";
import { isGenericPublisherLandingUrl } from "../../shared/article-url-quality";

test("buildUnlockedUrlNoSummaryEntries returns unlocked rows with URL and empty summary", () => {
  const entries = buildUnlockedUrlNoSummaryEntries([
    { date: "2012-01-29", summary: "", topArticleId: "https://example.com/a", isLocked: false },
    { date: "2012-02-05", summary: "Has summary", topArticleId: "https://example.com/b", isLocked: false },
    { date: "2012-02-07", summary: "", topArticleId: "", isLocked: false },
    { date: "2012-02-14", summary: "", topArticleId: "https://example.com/c", isLocked: true },
    { date: "2012-02-18", summary: "  ", topArticleId: "https://example.com/d", isLocked: false },
    { date: "2009-10-09", summary: "", topArticleId: "https://www.reuters.com/", isLocked: false },
    { date: "2009-05-06", summary: "", topArticleId: "https://www.bloomberg.com/businessweek", isLocked: false },
  ]);

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.date, "2012-01-29");
  assert.equal(entries[0]?.topArticleUrl, "https://example.com/a");
  assert.equal(entries[1]?.date, "2012-02-18");
  assert.ok(!entries.some((e) => e.date === "2009-10-09"));
  assert.ok(isGenericPublisherLandingUrl("https://www.reuters.com/"));
});
