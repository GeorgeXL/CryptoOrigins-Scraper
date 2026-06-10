import { z } from "zod";

import { normalizeOptionalSourceUrl } from "./coverage-constants";

const canonicalEventLabel = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().slice(0, 160) : value),
  z.string().min(3).max(160),
);

const canonicalSourceUrl = z.preprocess(
  (value) => normalizeOptionalSourceUrl(value),
  z.string().min(8).optional(),
);

export const canonicalDatesSchema = z.object({
  storyline_leaf: z.string(),
  canonical_dates: z.array(
    z.object({
      date: z.string(),
      event: canonicalEventLabel,
      importance: z.enum(["landmark", "major", "notable"]),
      source_url: canonicalSourceUrl.optional(),
      sourceUrl: canonicalSourceUrl.optional(),
    }),
  ),
  notes: z.string().optional(),
});

export const sourceLinksSchema = z.object({
  source_links: z.array(
    z.object({
      date: z.string(),
      source_url: canonicalSourceUrl.optional(),
      sourceUrl: canonicalSourceUrl.optional(),
    }),
  ),
});

export type CanonicalDatesResponse = z.infer<typeof canonicalDatesSchema>;
export type SourceLinksResponse = z.infer<typeof sourceLinksSchema>;
export type ValidCanonicalDate = Omit<
  CanonicalDatesResponse["canonical_dates"][number],
  "source_url" | "sourceUrl"
> & {
  date: `${number}-${number}-${number}`;
  sourceUrl?: string;
};

export type SkippedCanonicalDate = CanonicalDatesResponse["canonical_dates"][number];
