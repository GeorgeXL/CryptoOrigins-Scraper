import assert from "node:assert/strict";
import { test } from "node:test";

import {
  datesWithPendingAgentQueue,
  formatPendingAgentQueueSkipLabel,
  type PendingAgentQueueItem,
} from "./pendingAgentQueue";

const sampleItem = (label: string): PendingAgentQueueItem => ({
  id: "id-1",
  phase: "awaiting_article_pick",
  queue: "agents",
  label,
  priority: 80,
  createdAt: null,
});

test("datesWithPendingAgentQueue returns only dates with queue rows", () => {
  const byDate = {
    "2009-04-24": [sampleItem("Article pick")],
    "2009-04-25": [],
  };
  const pending = datesWithPendingAgentQueue(["2009-04-24", "2009-04-25", "2009-04-26"], byDate);
  assert.equal(pending.size, 1);
  assert.ok(pending.has("2009-04-24"));
});

test("formatPendingAgentQueueSkipLabel includes primary queue label", () => {
  const text = formatPendingAgentQueueSkipLabel([
    sampleItem("Correction approval"),
    sampleItem("Article pick"),
  ]);
  assert.match(text, /Skipped — already pending in Agents/);
  assert.match(text, /Correction approval/);
  assert.match(text, /\+1 more/);
});
