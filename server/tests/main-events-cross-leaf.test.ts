import assert from "node:assert/strict";
import test from "node:test";

import { buildCrossLeafDuplicateQueue, parseCrossLeafAssignments } from "../../shared/main-events-cross-leaf-build";
import { buildMainEventsReviewQueue } from "../../shared/main-events-review-build";
import { EMPTY_MAIN_EVENTS_VERIFICATION_DATES } from "../../shared/leaf-agent-config";

test("buildCrossLeafDuplicateQueue lists dates on multiple leaves", () => {
  const queue = buildCrossLeafDuplicateQueue({
    cacheRows: [
      {
        leaf: "Halving events",
        canonical: [{ date: "2020-05-11", event: "Third halving", importance: "landmark" }],
      },
      {
        leaf: "Bitcoin price cycles",
        canonical: [{ date: "2020-05-11", event: "Post-halving rally", importance: "major" }],
      },
      {
        leaf: "Early Bitcoin history",
        canonical: [{ date: "2009-01-03", event: "Genesis block", importance: "landmark" }],
      },
    ],
    assignments: new Map(),
    analyses: [],
  });

  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.date, "2020-05-11");
  assert.equal(queue.items[0]?.proposals.length, 2);
});

test("buildCrossLeafDuplicateQueue hides assigned dates", () => {
  const queue = buildCrossLeafDuplicateQueue({
    cacheRows: [
      {
        leaf: "Halving events",
        canonical: [{ date: "2020-05-11", event: "Third halving", importance: "landmark" }],
      },
      {
        leaf: "Bitcoin price cycles",
        canonical: [{ date: "2020-05-11", event: "Post-halving rally", importance: "major" }],
      },
    ],
    assignments: parseCrossLeafAssignments([{ date: "2020-05-11", owner_leaf: "Halving events" }]),
    analyses: [],
  });

  assert.equal(queue.items.length, 0);
  assert.equal(queue.counts.assigned, 1);
});

test("buildMainEventsReviewQueue hides dates assigned to another leaf", () => {
  const queue = buildMainEventsReviewQueue({
    leaf: "Bitcoin price cycles",
    canonical: [{ date: "2020-05-11", event: "Post-halving rally", importance: "major" }],
    analyses: [],
    verification: { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES },
    crossLeafAssignments: parseCrossLeafAssignments([
      { date: "2020-05-11", owner_leaf: "Halving events" },
    ]),
  });

  assert.equal(queue.items.length, 0);
  assert.equal(queue.counts.total, 0);
});

test("buildMainEventsReviewQueue keeps dates assigned to the current leaf", () => {
  const queue = buildMainEventsReviewQueue({
    leaf: "Halving events",
    canonical: [{ date: "2020-05-11", event: "Third halving", importance: "landmark" }],
    analyses: [],
    verification: { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES },
    crossLeafAssignments: parseCrossLeafAssignments([
      { date: "2020-05-11", owner_leaf: "Halving events" },
    ]),
  });

  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.date, "2020-05-11");
});

test("buildCrossLeafDuplicateQueue shows existing row with empty topic tag", () => {
  const queue = buildCrossLeafDuplicateQueue({
    cacheRows: [
      {
        leaf: "Bitcoin regulation",
        canonical: [{ date: "2024-12-30", event: "MiCA applies", importance: "landmark" }],
      },
      {
        leaf: "Stablecoins",
        canonical: [{ date: "2024-12-30", event: "MiCA stablecoin rules", importance: "landmark" }],
      },
    ],
    assignments: new Map(),
    analyses: [
      {
        date: "2024-12-30",
        summary: "Genius Group boosts its Bitcoin Treasury",
        topicCategories: [],
        isLocked: false,
      },
    ],
  });

  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.dbStatus, "untagged");
  assert.match(queue.items[0]?.dbSummary ?? "", /Genius Group/);
  assert.match(queue.items[0]?.dbNote ?? "", /no storyline tag yet/i);
  assert.equal(queue.items[0]?.dbOwnerLeaf, undefined);
});

test("buildCrossLeafDuplicateQueue exposes db owner leaf when tagged on a non-proposal leaf", () => {
  const queue = buildCrossLeafDuplicateQueue({
    cacheRows: [
      {
        leaf: "Bitcoin regulation",
        canonical: [
          {
            date: "2013-03-18",
            event: "FinCEN guidance on virtual currencies",
            importance: "landmark",
          },
        ],
      },
      {
        leaf: "Securities regulation",
        canonical: [
          {
            date: "2013-03-18",
            event: "FinCEN virtual currency guidance",
            importance: "major",
          },
        ],
      },
    ],
    assignments: new Map(),
    analyses: [
      {
        date: "2013-03-18",
        summary: "Bitcoin-Qt v0.8.1 released with improved fee estimation",
        topicCategories: ["Protocol & upgrades"],
        isLocked: false,
      },
    ],
  });

  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.date, "2013-03-18");
  assert.equal(queue.items[0]?.dbStatus, "wrong_leaf");
  assert.equal(queue.items[0]?.dbOwnerLeaf, "Protocol & upgrades");
  assert.match(queue.items[0]?.dbOwnerLeafLabel ?? "", /Protocol & upgrades/i);
  assert.equal(queue.items[0]?.proposals.length, 2);
  assert.equal(
    queue.items[0]?.proposals.some((proposal) => proposal.leaf === "Protocol & upgrades"),
    false,
  );
});

test("buildCrossLeafDuplicateQueue exposes db owner leaf when tagged on a proposal leaf", () => {
  const queue = buildCrossLeafDuplicateQueue({
    cacheRows: [
      {
        leaf: "Halving events",
        canonical: [{ date: "2020-05-11", event: "Third halving", importance: "landmark" }],
      },
      {
        leaf: "Bitcoin price cycles",
        canonical: [{ date: "2020-05-11", event: "Post-halving rally", importance: "major" }],
      },
    ],
    assignments: new Map(),
    analyses: [
      {
        date: "2020-05-11",
        summary: "Bitcoin block reward halved to 6.25 BTC",
        topicCategories: ["Halving events"],
        isLocked: false,
      },
    ],
  });

  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.dbStatus, "in_db");
  assert.equal(queue.items[0]?.dbOwnerLeaf, "Halving events");
});
