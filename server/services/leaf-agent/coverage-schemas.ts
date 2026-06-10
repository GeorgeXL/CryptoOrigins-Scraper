import { z } from "zod";

const canonicalEventLabel = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().slice(0, 160) : value),
  z.string().min(3).max(160),
);

export const canonicalDatesSchema = z.object({
  storyline_leaf: z.string(),
  canonical_dates: z.array(
    z.object({
      date: z.string(),
      event: canonicalEventLabel,
      importance: z.enum(["landmark", "major", "notable"]),
    }),
  ),
  notes: z.string().optional(),
});

export type CanonicalDatesResponse = z.infer<typeof canonicalDatesSchema>;
export type ValidCanonicalDate = CanonicalDatesResponse["canonical_dates"][number] & {
  date: `${number}-${number}-${number}`;
};

export type SkippedCanonicalDate = CanonicalDatesResponse["canonical_dates"][number];
