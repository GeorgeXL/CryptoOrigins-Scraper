import { describe, expect, it } from "vitest";

import {
  analysisHasStorylineTopic,
  analysisEligibleForDayLock,
  isStorylineTopicEligible,
  storylineTopicBlockReason,
} from "../../shared/storyline-topic-eligibility";

describe("storyline-topic-eligibility", () => {
  it("blocks no and uncertain google checks", () => {
    expect(isStorylineTopicEligible("yes")).toBe(true);
    expect(isStorylineTopicEligible("no")).toBe(false);
    expect(isStorylineTopicEligible("uncertain")).toBe(false);
    expect(isStorylineTopicEligible(null)).toBe(false);
    expect(isStorylineTopicEligible(undefined)).toBe(false);
  });

  it("returns human-readable block reasons", () => {
    expect(storylineTopicBlockReason("no")).toMatch(/did not happen/);
    expect(storylineTopicBlockReason("uncertain")).toMatch(/uncertain/);
    expect(storylineTopicBlockReason("yes")).toBeNull();
  });

  it("detects non-empty topic_categories payloads", () => {
    expect(analysisHasStorylineTopic([])).toBe(false);
    expect(analysisHasStorylineTopic(["Exchanges"])).toBe(true);
    expect(analysisHasStorylineTopic([{ label: "Exchanges" }])).toBe(true);
  });

  it("requires a topic before a day can be locked", () => {
    expect(analysisEligibleForDayLock([])).toBe(false);
    expect(analysisEligibleForDayLock(["Exchanges"])).toBe(true);
  });
});
