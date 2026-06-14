/** Google Check values that must not carry a storyline topic assignment. */
export const GOOGLE_CHECK_BLOCKS_STORYLINE_TOPIC = new Set(["no", "uncertain"]);

export type GoogleCheckHappened = "yes" | "no" | "uncertain" | null | undefined;

export function storylineTopicBlockReason(
  googleCheckHappened: GoogleCheckHappened,
): string | null {
  if (googleCheckHappened === "no") return "google_check=no (event did not happen)";
  if (googleCheckHappened === "uncertain") return "google_check=uncertain";
  return null;
}

/** Only google_check=yes rows may keep or receive storyline topics. */
export function isStorylineTopicEligible(googleCheckHappened: GoogleCheckHappened): boolean {
  return googleCheckHappened === "yes";
}

export function analysisHasStorylineTopic(raw: unknown): boolean {
  if (!Array.isArray(raw) || raw.length === 0) return false;
  for (const x of raw) {
    if (typeof x === "string" && x.trim()) return true;
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const label =
        typeof o.label === "string"
          ? o.label
          : typeof o.name === "string"
            ? o.name
            : typeof o.slug === "string"
              ? o.slug
              : "";
      if (label.trim()) return true;
    }
  }
  return false;
}

/** Storyline days without a topic must stay unlocked. */
export function analysisEligibleForDayLock(topicCategories: unknown): boolean {
  return analysisHasStorylineTopic(topicCategories);
}
