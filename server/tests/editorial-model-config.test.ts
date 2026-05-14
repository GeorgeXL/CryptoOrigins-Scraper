import assert from "node:assert/strict";
import test from "node:test";
import { getModelForAgent } from "../services/editorial-pipeline/model-config";

test("model config returns default/fallback model", () => {
  const model = getModelForAgent("NewsManager");
  assert.ok(typeof model === "string");
  assert.ok(model.length > 0);
});
