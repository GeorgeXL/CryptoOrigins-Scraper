/** Detect publisher homepages / section indexes saved instead of article URLs. */

const PUBLISHER_SECTION_LANDINGS = new Set([
  "businessweek",
  "news",
  "world",
  "business",
  "technology",
  "tech",
  "politics",
  "markets",
  "finance",
  "economy",
  "opinion",
  "sports",
  "culture",
  "science",
  "health",
  "us",
  "uk",
  "europe",
  "asia",
  "africa",
  "middleeast",
  "americas",
  "index",
  "home",
  "latest",
  "archive",
  "archives",
  "topics",
  "search",
  "video",
  "videos",
  "podcasts",
  "magazine",
]);

function pathSegments(url: string): string[] {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

/** True when URL is a site root or known section landing page, not a specific article. */
export function isGenericPublisherLandingUrl(url: string | null | undefined): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return true;
  }

  const segments = pathSegments(parsed.toString());
  if (segments.length === 0) return true;

  if (segments.length === 1) {
    const section = segments[0]!.toLowerCase();
    if (PUBLISHER_SECTION_LANDINGS.has(section)) return true;
  }

  return false;
}

/** True when URL looks like a specific article page worth keeping. */
export function isSpecificArticleUrl(url: string | null | undefined): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  return !isGenericPublisherLandingUrl(trimmed);
}
