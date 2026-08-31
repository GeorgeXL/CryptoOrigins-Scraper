import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeManualDayUploadEntries,
  parseFlexibleIsoDate,
  parseManualDayPasteBlock,
} from "./manual-day-upload";

test("parseFlexibleIsoDate accepts ISO and 15 Apr 2009", () => {
  assert.equal(parseFlexibleIsoDate("2009-04-15"), "2009-04-15");
  assert.equal(parseFlexibleIsoDate("15 Apr 2009"), "2009-04-15");
  assert.equal(parseFlexibleIsoDate("11 April 2009"), "2009-04-11");
});

test("parseManualDayPasteBlock extracts date, headline, body and source url", () => {
  const parsed = parseManualDayPasteBlock(
    "15 Apr 2009 U.S. Treasury Report: Geithner released the semi-annual report. Source: https://home.treasury.gov/news/press-releases/tg90",
  );
  assert.equal(parsed.date, "2009-04-15");
  assert.equal(parsed.headline, "U.S. Treasury Report");
  assert.match(parsed.body, /Geithner released/);
  assert.equal(parsed.url, "https://home.treasury.gov/news/press-releases/tg90");
});

test("normalizeManualDayUploadEntries validates batch shape", () => {
  const rows = normalizeManualDayUploadEntries([
    {
      date: "17 Apr 2009",
      url: "https://en.wikipedia.org/wiki/Portal:Current_events/2009_April_17",
      summary: "Fifth Summit of the Americas opens in Port-of-Spain as leaders seek trade recovery and regional crisis relief",
      tier: "macro",
    },
  ]);
  assert.equal(rows[0]?.date, "2009-04-17");
  assert.equal(rows[0]?.tier, "macro");
});
