import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isValidRarity,
  normalizeRarity,
  parseRarityModelOutput,
  rarityIsInvalid,
  rarityIsMissing,
  RARITY_VALUES,
} from "../../shared/rarity";

test("RARITY_VALUES has five labels", () => {
  assert.equal(RARITY_VALUES.length, 5);
});

test("parseRarityModelOutput accepts single word only", () => {
  assert.equal(parseRarityModelOutput("landmark"), "landmark");
  assert.equal(parseRarityModelOutput("Landmark.\n"), "landmark");
  assert.equal(parseRarityModelOutput("artifact extra words"), "artifact");
  assert.equal(parseRarityModelOutput("unknown"), null);
});

test("rarity missing vs invalid", () => {
  assert.equal(rarityIsMissing(null), true);
  assert.equal(rarityIsMissing(""), true);
  assert.equal(rarityIsInvalid("artifact"), false);
  assert.equal(rarityIsInvalid("bogus"), true);
  assert.equal(isValidRarity(normalizeRarity("INFAMOUS")), true);
});
