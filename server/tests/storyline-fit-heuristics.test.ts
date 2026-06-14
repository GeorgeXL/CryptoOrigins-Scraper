import assert from "node:assert/strict";
import test from "node:test";

import { evaluateStorylineFitHeuristic } from "../../shared/storyline-fit-heuristics";

test("Inflation leaf rejects crypto-led headlines", () => {
  const crypto = evaluateStorylineFitHeuristic(
    "Inflation",
    "Bitcoin hovers in a tight range as traders brace for inflation data that could spark a sharp move soon",
  );
  assert.equal(crypto.conflict, true);
  assert.equal(crypto.suggestedLeaf, "Bitcoin price & cycles");

  const btcEther = evaluateStorylineFitHeuristic(
    "Inflation",
    "Bitcoin and Ether fall as stocks slide, with Germany inflation hitting records",
  );
  assert.equal(btcEther.conflict, true);
});

test("Inflation leaf accepts pure macro inflation stories", () => {
  const venezuela = evaluateStorylineFitHeuristic(
    "Inflation",
    "Venezuela's bolivar plunges 60% on the black market, driving cash shortages and worsening inflation rates",
  );
  assert.equal(venezuela.conflict, false);

  const china = evaluateStorylineFitHeuristic(
    "Inflation",
    "China's inflation cools as consumer prices slow, giving policymakers room to ease credit restrictions",
  );
  assert.equal(china.conflict, false);
});

test("Inflation leaf rejects fiscal headlines without inflation data", () => {
  const uk = evaluateStorylineFitHeuristic(
    "Inflation",
    "Mervyn King warns UK deficit uncertainty constrains policy and urges structural cuts to lift savings",
  );
  assert.equal(uk.conflict, true);
  assert.equal(uk.suggestedLeaf, "Debt crises");
});
