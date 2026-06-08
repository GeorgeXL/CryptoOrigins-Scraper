import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSummaryQuality,
  isEditorialSummaryWeak,
  isValidPipelineTopArticleId,
  summaryOmitsNamedOrganization,
  summaryNeedsBetterArticleSource,
  isGenericMarketingSummary,
  isBlogPaginationWinner,
  isRoundupMultiStorySummary,
  summaryDisallowedSymbol,
  findSummaryDisallowedSymbols,
  normalizeEditorialSummaryText,
  coerceEditorialSummaryLength,
  summaryHasTrailingPunctuation,
  findImproperProperNouns,
} from "../services/editorial-pipeline/editorial-quality";
import { evaluateRelevanceWithAgent, relevanceRequiresArticlePick } from "../services/editorial-pipeline/relevance-agent";

test("isEditorialSummaryWeak treats short and failure placeholders as weak", () => {
  assert.equal(isEditorialSummaryWeak(null), true);
  assert.equal(isEditorialSummaryWeak(""), true);
  assert.equal(isEditorialSummaryWeak("Analysis failed"), true);
  assert.equal(isEditorialSummaryWeak("x".repeat(99)), true);
  assert.equal(isEditorialSummaryWeak("x".repeat(100)), false);
  assert.equal(isEditorialSummaryWeak("x".repeat(110)), false);
  assert.equal(isEditorialSummaryWeak("x".repeat(111)), true);
});

test("isValidPipelineTopArticleId rejects empty, none, and no-news placeholders", () => {
  assert.equal(isValidPipelineTopArticleId(null), false);
  assert.equal(isValidPipelineTopArticleId("none"), false);
  assert.equal(isValidPipelineTopArticleId("no-news-123"), false);
  assert.equal(isValidPipelineTopArticleId("https://example.com/article"), true);
});

test("summaryOmitsNamedOrganization flags vague firm summaries when article names the company", () => {
  const summary =
    "U.K. firm trademarks bitcoin for clothing and drinks, sparking confusion but leaving the currency alone";
  const snippet =
    "A.B.C. IP Holdings Ltd trademarks the word bitcoin for clothing and drinks in the UK, leaving the currency itself untouched";
  assert.equal(summaryOmitsNamedOrganization(summary, snippet), true);
  assert.equal(summaryOmitsNamedOrganization(summary, summary), false);
});

test("2018-05-18 CEX.IO blog page is flagged as junk winner", () => {
  const summary =
    "CEX.IO's blog offers updates on crypto news, user verification, app features, and simplified purchases";
  const topArticleId = "https://blog.cex.io/page/55";
  assert.equal(isGenericMarketingSummary(summary), true);
  assert.equal(isBlogPaginationWinner(topArticleId), true);
  assert.equal(summaryNeedsBetterArticleSource(summary, topArticleId), true);
});

test("relevance rules path triggers article pick for 2018-05-18 junk winner", async () => {
  const summary =
    "CEX.IO's blog offers updates on crypto news, user verification, app features, and simplified purchases";
  const out = await evaluateRelevanceWithAgent({
    date: "2018-05-18",
    summary,
    topArticleId: "https://blog.cex.io/page/55",
  });
  assert.equal(out.source, "rules");
  assert.equal(out.classification, "insufficient");
  assert.equal(relevanceRequiresArticlePick(out), true);
});

test("2019-08-18 roundup summary is weak and needs article re-pick", () => {
  const summary =
    "NZ legalizes crypto salaries; China builds two-layer digital currency; AWS expands blockchain tools, fast";
  assert.equal(summaryDisallowedSymbol(summary), "semicolon");
  assert.equal(isRoundupMultiStorySummary(summary), true);
  assert.equal(isEditorialSummaryWeak(summary), true);
  const issue = evaluateSummaryQuality(summary);
  assert.equal(issue?.code, "disallowed_symbols");
  assert.equal(summaryNeedsBetterArticleSource(summary, "https://example.com/roundup"), true);
});

test("summaryDisallowedSymbol flags pipe, dash, slash, ampersand, and quotes", () => {
  assert.deepEqual(
    findSummaryDisallowedSymbols("Bitcoin hits highs | Ethereum follows with strong gains across markets today for traders"),
    ["pipe"],
  );
  assert.equal(summaryDisallowedSymbol("Bitcoin hits highs — markets rally worldwide today with strong momentum from traders pushing prices higher"), "em-dash");
  assert.equal(summaryDisallowedSymbol("Bitcoin rises / Ethereum falls as markets split on macro outlook today with mixed sentiment"), "slash");
  assert.equal(summaryDisallowedSymbol("Coinbase & Binance expand services as Bitcoin adoption grows worldwide with strong institutional demand today"), "ampersand");
  assert.equal(summaryDisallowedSymbol('"Bitcoin" hits new highs as markets rally worldwide today with strong momentum from traders pushing prices higher'), "quote");
});

test("summaryDisallowedSymbol flags comma-and list phrasing", () => {
  assert.deepEqual(
    findSummaryDisallowedSymbols(
      "Bitcoin rises above $1,000, and Ethereum follows on strong Asian demand across markets today",
    ),
    ["comma and"],
  );
  assert.equal(
    summaryDisallowedSymbol("Bitcoin rises above $1,000 on strong demand across Asian markets today with momentum"),
    null,
  );
  assert.equal(
    summaryDisallowedSymbol("Bitcoin hits $7,000 and $8,000 as markets rally worldwide today with strong momentum"),
    null,
  );
  assert.equal(
    summaryDisallowedSymbol("Bitcoin rises, reaching $1,021 driven by yuan devaluation and strong Asian demand today"),
    null,
  );
});

test("relevance rules path triggers article pick for 2019-08-18 roundup summary", async () => {
  const summary =
    "NZ legalizes crypto salaries; China builds two-layer digital currency; AWS expands blockchain tools, fast";
  const out = await evaluateRelevanceWithAgent({
    date: "2019-08-18",
    summary,
    topArticleId: "https://example.com/crypto-daily",
  });
  assert.equal(out.source, "rules");
  assert.equal(out.classification, "insufficient");
  assert.equal(relevanceRequiresArticlePick(out), true);
});

test("normalizeEditorialSummaryText strips trailing period and capitalizes Bitcoin", () => {
  const raw =
    "bitcoin reaches new highs as markets rally with strong momentum from traders worldwide pushing prices higher today.";
  const out = normalizeEditorialSummaryText(raw);
  assert.equal(summaryHasTrailingPunctuation(out), false);
  assert.match(out, /\bBitcoin\b/);
  assert.equal(findImproperProperNouns(out).length, 0);
});

test("evaluateSummaryQuality rejects trailing full stop and lowercase bitcoin", () => {
  const withPeriod =
    "Bitcoin reaches new highs as markets rally with strong momentum from traders worldwide pushing prices higher.";
  assert.equal(evaluateSummaryQuality(withPeriod)?.code, "trailing_punctuation");

  const lowercase =
    "bitcoin reaches new highs as markets rally with strong momentum from traders worldwide pushing prices higher";
  assert.equal(evaluateSummaryQuality(lowercase)?.code, "improper_capitalization");
});

test("coerceEditorialSummaryLength trims slightly overlong summaries to 100-110", () => {
  const raw =
    "Bitcoin wallet providers announce coordinated security upgrades after researchers disclose vulnerabilities affecting";
  assert.ok(raw.length > 110 && raw.length <= 120);
  const coerced = coerceEditorialSummaryLength(raw);
  assert.ok(coerced);
  assert.ok(coerced.length >= 100 && coerced.length <= 110);
});
