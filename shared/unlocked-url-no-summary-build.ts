import {
  isGenericPublisherLandingUrl,
  isSpecificArticleUrl,
} from "@shared/article-url-quality";

export type UnlockedUrlNoSummaryEntry = {
  date: string;
  summary: string;
  topArticleUrl: string;
};

/** Unlocked days with a saved article URL but no summary yet (e.g. Google API URL-only fills). */
export function buildUnlockedUrlNoSummaryEntries(
  analyses: {
    date: string;
    summary: string | null | undefined;
    topArticleId?: string | null;
    isLocked?: boolean | null;
  }[],
): UnlockedUrlNoSummaryEntry[] {
  return analyses
    .filter((a) => !a.isLocked)
    .filter((a) => isSpecificArticleUrl(a.topArticleId))
    .filter((a) => !a.summary || a.summary.trim() === "")
    .map((a) => ({
      date: a.date,
      summary: a.summary || "",
      topArticleUrl: a.topArticleId!.trim(),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export { isGenericPublisherLandingUrl, isSpecificArticleUrl };
