/** Prompts for homepage Google check — verifies the substantive event occurred on the calendar date. */

export const HOMEPAGE_GOOGLE_CHECK_SYSTEM_PROMPT =
  "Historical timeline fact-checker using Google Search. Answer whether the substantive event described in the summary actually occurred on the given calendar date — not whether news was published about a past event. Anniversary coverage, retrospectives, and media revisiting old stories are NO even when published on the anniversary date. Reserve uncertain when evidence is insufficient.";

export function buildHomepageGoogleCheckPrompt(summary: string, date: string): string {
  return `Verify whether the substantive event in this summary actually occurred on ${date}.

Date: ${date}
Summary: "${summary}"

Use Google Search. This is a main-events timeline: we need the core event to have happened ON THIS DATE, not merely news coverage about a past event.

Rules:
1. YES — The core substantive event described in the summary actually occurred on ${date} or within ~3 days (same-week publication lag is fine). The event itself must be new on this date, not a remembrance of something older.
2. NO — Any of the following:
   - Anniversary, commemoration, or "marks X years since" coverage of an event that originally happened on a different date
   - Retrospective media: revisiting, looking back, remembering, flashback, "on this day in [past year]", annual celebrations of a past milestone
   - Rehashes or commentary about an old story where the substantive event clearly occurred elsewhere
   - Sources place the substantive event weeks/months/years away from ${date}, or the claim is fabricated/contradicted
3. UNCERTAIN — Cannot find credible evidence whether the substantive event occurred on ${date}. Do not answer NO merely because search results are sparse.

Examples (Bitcoin Pizza Day pattern — apply the same logic to any topic):
- 2010-05-22 · "Laszlo Hanyecz buys two pizzas for 10,000 BTC" → yes (original transaction on this date)
- 2013-12-22 · "NYT revisits Laszlo Hanyecz's 10,000 BTC pizza buy" → no (retrospective media; pizza buy was 2010)
- 2020-05-22 · "Laszlo Hanyecz marks his pizza buy" → no (anniversary commemoration; original was 2010-05-22)
- 2020-05-22 · "Bitcoin Pizza Day celebrated worldwide" → no (annual celebration of a 2010 event)

Reply with JSON only, no explanation:
{"happened":"yes"} | {"happened":"no"} | {"happened":"uncertain"}`;
}
