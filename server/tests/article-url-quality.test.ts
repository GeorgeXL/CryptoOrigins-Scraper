import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isGenericPublisherLandingUrl,
  isSpecificArticleUrl,
} from "../../shared/article-url-quality";

test("isGenericPublisherLandingUrl flags site roots and section homepages", () => {
  assert.equal(isGenericPublisherLandingUrl("https://www.reuters.com/"), true);
  assert.equal(isGenericPublisherLandingUrl("https://www.bloomberg.com/businessweek"), true);
  assert.equal(isGenericPublisherLandingUrl("https://www.bbc.com/news"), true);
});

test("isGenericPublisherLandingUrl accepts article slugs", () => {
  assert.equal(
    isGenericPublisherLandingUrl(
      "https://www.forbes.com/sites/timworstall/2013/01/05/is-using-bitcoin-the-way-to-play-online-poker-in-the-us/",
    ),
    false,
  );
  assert.equal(
    isGenericPublisherLandingUrl(
      "https://www.state.gov/joint-press-availability-with-secretary-of-the-treasury-timothy-geithner/",
    ),
    false,
  );
  assert.equal(
    isGenericPublisherLandingUrl("https://www.coindesk.com/chris-larsen-ripple-is-http-for-money/"),
    false,
  );
});

test("isSpecificArticleUrl is the inverse for non-empty URLs", () => {
  assert.equal(isSpecificArticleUrl("https://www.reuters.com/"), false);
  assert.equal(isSpecificArticleUrl("https://www.reuters.com/world/us/example-story-2024-01-01/"), true);
});
