import { mainEventsLeafPromptRules } from "./main-events-leaf-prompts";
import { topicGroupForLeaf } from "./topic-hierarchy";

export type StorylineFitHeuristicResult = {
  conflict: boolean;
  reason?: string;
  suggestedLeaf?: string;
};

const CRYPTO_AS_HEADLINE =
  /^(bitcoin|btc|ethereum|ether|crypto)\b/i;

const CRYPTO_MARKET_MOVE =
  /\b(bitcoin|btc|ethereum|ether|crypto markets?)\b.*\b(hover|hovers|fall|falls|rise|rises|rebound|rebounds|fade|fades|slide|slides|lower|higher|traders?|margin|longs?|shorts?|braces?)\b/i;

const CRYPTO_AND_MACRO_BACKDROP =
  /\b(bitcoin and ether|hotter cpi sends bitcoin|inflation spikes.*bitcoin|bitcoin.*inflation (data|spikes|hedge)|investors focus on stimulus)\b/i;

const PURE_INFLATION_MACRO =
  /\b(inflation|ccpi|consumer prices?|price index|hyperinflation|bolivar.*inflation|inflation (cools|climbs|hits|rate))\b/i;

const MONETARY_POLICY_HEADLINE =
  /\b(monetary policy|interest rates?|tighter policy|rate hike|central bank|qe|taper)\b/i;

const FISCAL_DEFICIT =
  /\b(deficit|fiscal|structural cuts|austerity)\b/i;

function macroLeafExcludesCrypto(leaf: string): boolean {
  const group = topicGroupForLeaf(leaf);
  if (group !== "Macroeconomy") return false;
  const exclude = mainEventsLeafPromptRules(leaf).exclude.toLowerCase();
  return (
    exclude.includes("do not list any bitcoin or cryptocurrency") ||
    exclude.includes("do not list bitcoin or crypto") ||
    exclude.includes("do not list crypto") ||
    exclude.includes("crypto events") ||
    exclude.includes("or crypto.")
  );
}

function cryptoLedSummary(summary: string): boolean {
  const text = summary.trim();
  if (!text) return false;
  if (/\bbitcoin and ether\b/i.test(text)) return true;
  if (CRYPTO_AS_HEADLINE.test(text)) return true;
  if (CRYPTO_MARKET_MOVE.test(text)) return true;
  if (CRYPTO_AND_MACRO_BACKDROP.test(text)) return true;
  if (/\bbitcoin\b/i.test(text) && /\b(inflation hedge|stimulus)\b/i.test(text)) return true;
  return false;
}

/** Deterministic pre/post checks for homepage storyline fit — catches common LLM mistakes. */
export function evaluateStorylineFitHeuristic(
  expectedLeaf: string,
  summary: string,
): StorylineFitHeuristicResult {
  const text = summary.trim();
  if (!text) {
    return { conflict: true, reason: "Summary is empty." };
  }

  const group = topicGroupForLeaf(expectedLeaf);

  if (expectedLeaf === "Inflation") {
    if (cryptoLedSummary(text)) {
      return {
        conflict: true,
        reason: "Headline is a Bitcoin/crypto market move — Inflation excludes cryptocurrency events.",
        suggestedLeaf: "Bitcoin price & cycles",
      };
    }
    if (FISCAL_DEFICIT.test(text) && !PURE_INFLATION_MACRO.test(text)) {
      return {
        conflict: true,
        reason: "Fiscal/deficit story — not an inflation print or shock.",
        suggestedLeaf: "Debt crises",
      };
    }
    if (MONETARY_POLICY_HEADLINE.test(text) && !PURE_INFLATION_MACRO.test(text)) {
      return {
        conflict: true,
        reason: "Policy response headline — use Monetary policy & rates.",
        suggestedLeaf: "Monetary policy & rates",
      };
    }
    return { conflict: false };
  }

  if (group === "Macroeconomy" && macroLeafExcludesCrypto(expectedLeaf) && cryptoLedSummary(text)) {
    return {
      conflict: true,
      reason: "Macro leaf excludes cryptocurrency-led headlines.",
      suggestedLeaf: "Bitcoin price & cycles",
    };
  }

  return { conflict: false };
}
