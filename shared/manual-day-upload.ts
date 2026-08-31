import type { ArticleData, TieredArticles } from "./schema";

export type ManualDayUploadTier = "bitcoin" | "crypto" | "macro";

export type ManualDayUploadEntry = {
  date: string;
  url: string;
  summary: string;
  title?: string;
  tier?: ManualDayUploadTier;
  /** When false (default), skip rows that already have a URL unless replace is true. */
  replace?: boolean;
};

const MONTH_MAP: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

export function parseFlexibleIsoDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;

  const day = match[1]!.padStart(2, "0");
  const month = MONTH_MAP[match[2]!.toLowerCase()];
  const year = match[3]!;
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

export type ParsedManualDayPaste = {
  date: string | null;
  headline: string;
  body: string;
  url: string | null;
  raw: string;
};

/** Parse operator paste: `15 Apr 2009 Headline: body… Source: https://…` */
export function parseManualDayPasteBlock(text: string): ParsedManualDayPaste {
  const raw = text.trim();
  const urlMatch = raw.match(/\bSource:\s*(https?:\/\/\S+)/i);
  const url = urlMatch?.[1]?.replace(/[.,)]+$/, "") ?? null;
  const withoutSource = urlMatch ? raw.slice(0, urlMatch.index).trim() : raw;

  const datePrefix = withoutSource.match(
    /^((\d{4}-\d{2}-\d{2})|(\d{1,2}\s+[A-Za-z]+\s+\d{4}))\s+/,
  );
  let date: string | null = null;
  let rest = withoutSource;
  if (datePrefix) {
    date = parseFlexibleIsoDate(datePrefix[1]!);
    rest = withoutSource.slice(datePrefix[0].length).trim();
  }

  const colonIdx = rest.indexOf(":");
  const headline = colonIdx >= 0 ? rest.slice(0, colonIdx).trim() : rest.trim();
  const body = colonIdx >= 0 ? rest.slice(colonIdx + 1).trim() : "";

  return { date, headline, body, url, raw };
}

export function tieredArticlesForUploadTier(
  tier: ManualDayUploadTier,
  article: ArticleData,
): TieredArticles {
  return {
    bitcoin: tier === "bitcoin" ? [article] : [],
    crypto: tier === "crypto" ? [article] : [],
    macro: tier === "macro" ? [article] : [],
  };
}

export function normalizeManualDayUploadEntries(raw: unknown): ManualDayUploadEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error("Expected a JSON array of entries");
  }

  return raw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Entry ${index + 1} is not an object`);
    }
    const row = item as Record<string, unknown>;
    const date =
      typeof row.date === "string" ? parseFlexibleIsoDate(row.date) ?? row.date.trim() : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    const summary = typeof row.summary === "string" ? row.summary.trim() : "";
    const title = typeof row.title === "string" ? row.title.trim() : undefined;
    const tier = row.tier;
    const replace = row.replace === true;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Entry ${index + 1}: invalid date "${String(row.date)}"`);
    }
    if (!url) throw new Error(`Entry ${index + 1}: url is required`);
    if (!summary) throw new Error(`Entry ${index + 1}: summary is required (100–110 chars)`);

    const normalizedTier: ManualDayUploadTier | undefined =
      tier === "bitcoin" || tier === "crypto" || tier === "macro" ? tier : undefined;

    return {
      date,
      url,
      summary,
      title,
      tier: normalizedTier ?? "macro",
      replace,
    };
  });
}
