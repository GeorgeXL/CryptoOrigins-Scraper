import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCalendarReciprocalPair,
  inferCalendarChronologyHint,
  inferReciprocalDuplicateChronology,
  isReciprocalCalendarConflict,
  summaryConflatesMultipleLegislativeTopics,
} from "../services/editorial-pipeline/calendar-conflict";

const SUMMARY_MAR7 =
  "New Hampshire House passes bill protecting Bitcoin businesses and decriminalizes cannabis with 89% support";
const SUMMARY_MAR11 =
  "New Hampshire House passes Bill 436 deregulating Bitcoin making it easier for adoption and exchange operation";

test("2017-03-07 summary conflates cannabis with bitcoin legislation", () => {
  assert.equal(summaryConflatesMultipleLegislativeTopics(SUMMARY_MAR7), true);
  assert.equal(summaryConflatesMultipleLegislativeTopics(SUMMARY_MAR11), false);
});

test("NH bill pair prefers earlier vote date", () => {
  const hint = inferCalendarChronologyHint({
    dateA: "2017-03-07",
    summaryA: SUMMARY_MAR7,
    dateB: "2017-03-11",
    summaryB: SUMMARY_MAR11,
    reciprocalConflict: true,
  });
  assert.ok(hint);
  assert.equal(hint.keepDate, "2017-03-07");
  assert.equal(hint.removeDate, "2017-03-11");
  assert.equal(hint.likelyEventDate, "2017-03-07");
});

test("reciprocal calendar conflict detection", () => {
  assert.equal(
    isReciprocalCalendarConflict(
      { currentDate: "2017-03-07", expectedDate: "2017-03-11" },
      { currentDate: "2017-03-11", expectedDate: "2017-03-07" },
    ),
    true,
  );
});

test("buildCalendarReciprocalPair for NH bill queue items", () => {
  const pair = buildCalendarReciprocalPair({
    itemA: {
      id: "a",
      currentDate: "2017-03-07",
      expectedDate: "2017-03-11",
      summary: SUMMARY_MAR7,
      tags: ["Bitcoin"],
      topics: ["regulation", "adoption"],
    },
    itemB: {
      id: "b",
      currentDate: "2017-03-11",
      expectedDate: "2017-03-07",
      summary: SUMMARY_MAR11,
      tags: ["Bitcoin"],
      topics: ["regulation", "adoption"],
    },
  });
  assert.ok(pair);
  assert.equal(pair.pairKey, "2017-03-07::2017-03-11");
  assert.equal(pair.chronology.keepDate, "2017-03-07");
});

test("buildCalendarReciprocalPair for reciprocal duplicate stories (Zug Bitcoin)", () => {
  const pair = buildCalendarReciprocalPair({
    itemA: {
      id: "a",
      currentDate: "2016-07-01",
      expectedDate: "2016-07-02",
      summary:
        "Zug becomes the first city to allow Bitcoin payments for public services up to 200 Swiss francs starting July",
      tags: ["Bitcoin"],
      topics: ["adoption"],
    },
    itemB: {
      id: "b",
      currentDate: "2016-07-02",
      expectedDate: "2016-07-01",
      summary:
        "Zug, Switzerland, accepts Bitcoin for public service payments, leading the way in crypto for local government.",
      tags: ["Bitcoin", "Switzerland"],
      topics: ["adoption", "cryptocurrency"],
    },
  });
  assert.ok(pair);
  assert.equal(pair.pairKey, "2016-07-01::2016-07-02");
  assert.equal(pair.chronology.keepDate, "2016-07-01");
  assert.equal(pair.chronology.reciprocalConflict, true);
});
