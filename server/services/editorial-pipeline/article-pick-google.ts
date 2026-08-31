/**
 * Google Search grounding helpers for article-pick review items.
 */

import { aiService } from "../ai";
import { canRecommendCandidate, filterEligibleCandidates } from "./article-pick-quality";
import type { ArticleCandidate } from "./review-package";

export async function enrichArticlePickCandidatesWithGoogle(opts: {
  date: string;
  scenario: "empty_day" | "missing_day" | "better_storyline";
  candidates: ArticleCandidate[];
  currentSummary?: string;
}): Promise<{ candidates: ArticleCandidate[]; googleNote: string | null }> {
  const eligible = filterEligibleCandidates(opts.candidates, opts.date);
  const cleared = opts.candidates.map((candidate) => ({ ...candidate, recommended: false }));

  if (eligible.length === 0) {
    return {
      candidates: cleared,
      googleNote:
        "No eligible Bitcoin/crypto candidates in pool — confirm empty or reject to widen search.",
    };
  }

  const gemini = aiService.getProvider("gemini");
  if (!gemini.verifyArticlePick) {
    return { candidates: cleared, googleNote: null };
  }

  try {
    const result = await gemini.verifyArticlePick({
      date: opts.date,
      scenario: opts.scenario,
      currentSummary: opts.currentSummary,
      candidates: eligible.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        publishedDate: candidate.publishedDate ?? null,
        tier: candidate.tier,
        summary: candidate.summary,
      })),
    });

    if (!result.pickId) {
      return {
        candidates: cleared,
        googleNote: "Google Search found no reliable match in the candidate pool — pick manually or reject.",
      };
    }

    const pick = cleared.find((candidate) => candidate.id === result.pickId);
    if (!pick || !canRecommendCandidate(pick, opts.date)) {
      return {
        candidates: cleared,
        googleNote: "Google suggested a pick but it failed quality gates — review manually or confirm empty.",
      };
    }

    pick.recommended = true;
    pick.relevanceNotes = ["Google Search suggested pick", ...(pick.relevanceNotes ?? [])];

    return {
      candidates: cleared,
      googleNote: `Google suggested: ${pick.title}`,
    };
  } catch (error) {
    console.warn(`[article-pick-google] ${opts.date}: verifyArticlePick failed:`, error);
    return { candidates: cleared, googleNote: null };
  }
}
