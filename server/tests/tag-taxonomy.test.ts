import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveTagTaxonomyCategory,
  TAG_TAXONOMY_VALUES,
} from "../../shared/tag-taxonomy";

test("frequent tags map into entity taxonomy buckets", () => {
  assert.equal(resolveTagTaxonomyCategory("Bitcoin"), "assets");
  assert.equal(resolveTagTaxonomyCategory("BTC"), "assets");
  assert.equal(resolveTagTaxonomyCategory("Obama"), "people");
  assert.equal(resolveTagTaxonomyCategory("Coinbase"), "organizations");
  assert.equal(resolveTagTaxonomyCategory("China"), "geography");
  assert.equal(resolveTagTaxonomyCategory("SEC"), "regulation");
  assert.equal(resolveTagTaxonomyCategory("Ethereum"), "assets");
  assert.equal(resolveTagTaxonomyCategory("Silk Road"), "crime");
  assert.equal(resolveTagTaxonomyCategory("Totally Unknown Tag"), "uncategorized");
});

test("taxonomy has seven parent buckets", () => {
  assert.equal(TAG_TAXONOMY_VALUES.length, 7);
});
