# Editorial pipeline — January 2025 acceptance test

**Purpose:** Manual + automated checklist for a small January 2025 window when validating the cleaning agent (pipeline v2/v3).

**Last DB snapshot (run `npx tsx server/scripts/triage-jan-2025-sample.ts` to refresh):**

| Corpus fact | Value |
|-------------|--------|
| `historical_news_analyses` date range | `1995-10-24` → **`2024-12-31`** |
| Rows in `2025-01-01` … `2025-01-10` | **0** |
| Last populated day before gap | `2024-12-31` (summary ~108 chars, articles fetched, valid `top_article_id`) |

So January 2025 is not “dirty data” — it is a **coverage gap**: every day in this window is **`missing_day`** until the scraper or pipeline creates rows.

---

## Test window (4 days)

| Date | Why include it |
|------|----------------|
| **2025-01-01** | Calendar boundary (New Year). Often year-in-review / low fresh news; good test for “truly empty” vs “missed scrape”. |
| **2025-01-03** | Ordinary weekday in the gap — typical “build from scratch” case. |
| **2025-01-06** | First Monday of 2025 — US markets back; more likely Exa returns macro/crypto candidates if anything exists. |
| **2025-01-10** | Mid-window Friday — checks ordering/priority when batching multiple `missing_day` items. |

**Run config**

```text
dateFrom: 2025-01-01
dateTo:   2025-01-10
maxDaysToConsider: 10
```

**Pre-flight (no pipeline run):**

```bash
npx tsx server/scripts/triage-jan-2025-sample.ts
```

Expect: all four dates above (and any other day in range) → `route: missing_day`, `analysisId: null`, reason `"No analysis exists for this day"`.

---

## Problem statement (what is wrong today)

For each test date:

1. **No `historical_news_analyses` row** — the Bitcoin Wikipedia calendar has a hole after `2024-12-31`.
2. **No summary, tags, topics, or `pages_and_tags` links** for that calendar date.
3. **Downstream product impact** — day page missing or stale; timeline continuity broken at the year boundary.

This is different from **`existing_needs_correction`** (row exists but weak summary / bad tags). Do not expect correction proposals until a row exists.

**Boundary contrast:** `2024-12-31` in production is a healthy **`existing_ok`** day (short check chain only). The failure mode flips on **`2025-01-01`**, not gradually.

---

## Expected agent behaviour

Two modes depend on **`EDITORIAL_PIPELINE_V3_GATED_FETCH`** (must be `1` for the behaviour you designed in Agents V2).

### A. V3 gated fetch (`EDITORIAL_PIPELINE_V3_GATED_FETCH=1`) — **recommended for this test**

Per day (`missing_day`):

| Step | Agent / phase | Expected outcome |
|------|----------------|------------------|
| 1 | **Triage (NewsManager)** | `missing_day`, full chain listed in evidence but **not all executed**. |
| 2 | **SourceFinderAgent** (v3 fetch-only) | Calls Exa / hierarchical search; **does not** write summary yet. |
| 2a | If candidates found | Step `completed`; queue → **`awaiting_article_pick`** with ranked `ArticleCandidate[]` (tier, calendar sanity, relevance). |
| 2b | If zero candidates | Step `rejected`; queue still **`awaiting_article_pick`** with `hasCandidates: false`; operator must confirm “no news” or reject and widen search. |
| 3 | **Human** | Pick winning URL (or confirm empty day). **Pipeline pauses** — no DuplicateChecker / DateConsistency / TagConsistency / FinalEditor until after pick. |
| 4 | **After approve pick** | Writer creates/updates row, generates summary + tags + topics → queue → **`awaiting_summary_approval`**. |
| 5 | **Human** | Approve summary (100–110 chars), tags, topics — or edit and re-approve. |
| 6 | **After summary approve** | Deterministic checks: duplicate neighbors, date consistency, tag grounding → either **auto path** or **`awaiting_correction_approval` / calendar / duplicate** packages. |
| 7 | **Terminal** | Day has persisted row, valid `top_article_id`, summary in target band, taxonomy present. |

**V2 mental model mapping**

| V2 agent | What happens on `missing_day` |
|----------|------------------------------|
| **News** | Source discovery + article pick gate (no silent summarize). |
| **Sanity** | Calendar notes on candidates; full sanity pass **after** pick when text exists. |
| **Taxonomy** | Only after summary approval (tags/topics generation + consistency). |
| **Orchestrator** | Stops at human gates; no full 10-agent chain in one shot. |

### B. Legacy chain (`EDITORIAL_PIPELINE_V3_GATED_FETCH` unset or `0`)

Per day:

| Step | Expected |
|------|----------|
| Triage | `missing_day` |
| Chain runs | MilestoneAgent → SourceFinderAgent (**full** `analyzeNewsForDate`) → RelevanceChecker (**article + summary checkpoint**) → Verification → Summary → Duplicate → Date → Tag → Final |
| Risk | May auto-write weak summary, burn tokens, or reject late at FinalEditor; **not** the staged UX from Agents V2. |

Use legacy mode only to compare behaviour; **do not** treat it as the target product test.

---

## Per-date expectations (operator view)

### 2025-01-01

- **Likely Exa signal:** Mixed — many outlets publish “2024 in review” on Dec 31–Jan 1; published dates may be **±1–2 days** off → watch **`calendarSanityOk: false`** on candidates.
- **Agent should:** Surface candidates with calendar warnings; **not** auto-assign Dec 31 recap to Jan 1 without human OK.
- **If truly no story:** Operator confirms empty; row may stay absent or marked empty per product policy.

### 2025-01-03

- **Likely Exa signal:** Normal weekday crypto/macro news if coverage exists.
- **Agent should:** Return tier-ranked list; recommend highest `relevanceScore` bitcoin-tier URL when present.
- **After pick:** Summary must mention the **actual** story for Jan 3, not a neighbor day.

### 2025-01-06

- **Likely Exa signal:** Higher chance of market-moving pieces (Monday effect).
- **Agent should:** Same as 01-03; duplicate checker should run **after** summary exists and flag overlap with **2024-12-30 … 2025-01-05** neighbors if taxonomy+text match.

### 2025-01-10

- **Batch behaviour:** All four days triage as `missing_day` with priority **95**; processor order follows `prioritizeTriage` (all same route — FIFO by date in range).
- **Agent should:** Four separate queue rows (one per day), each at **`awaiting_article_pick`** after a V3 run — not one merged package.

---

## Pass / fail criteria

| # | Criterion |
|---|-----------|
| P1 | Shadow triage: all test dates `missing_day`, no `analysisId`. |
| P2 | V3 run: **no** summary written before human article pick. |
| P3 | Queue package `phase === "awaiting_article_pick"` and `scenario === "missing_day"`. |
| P4 | After pick + summary approve: row exists for date; `top_article_id` is real URL (not `none` / `no-news-*`). |
| P5 | Summary length **100–110** chars (or operator explicitly overrides with documented reason). |
| P6 | `tags_version2` + `topic_categories` non-empty; tag grounding drops hallucinated tags. |
| P7 | No auto-approve on first pass (missing days always **pending** until human acts). |
| P8 | `2024-12-31` unchanged by this run (no accidental writes to boundary day). |

| # | Fail examples |
|---|----------------|
| F1 | Pipeline runs full legacy chain and writes summary without human pick (V3 off). |
| F2 | `existing_ok` triage on a Jan 2025 date while DB still has zero rows. |
| F3 | Article pick approves URL whose `publishedDate` is >2 days off with no human acknowledgment. |
| F4 | Summary approved at 85 chars or 150 chars without gate error. |
| F5 | Tags include entities not in article text (e.g. wrong country/person). |

---

## How to run the live test

1. Set env: `EDITORIAL_PIPELINE_ENABLED=1`, `EDITORIAL_PIPELINE_V3_GATED_FETCH=1`, `OPENAI_API_KEY`, Exa/search keys as for production.
2. `POST /api/agent/pipeline/run` with body `{ "dateFrom": "2025-01-01", "dateTo": "2025-01-10", "maxDaysToConsider": 10 }`.
3. Open **Admin → Human review** (or Agents V2 once wired): expect up to 10 **`awaiting_article_pick`** items.
4. Process **2025-01-01** and **2025-01-03** end-to-end first (boundary + normal).
5. Re-run `triage-jan-2025-sample.ts`: completed days should show `existing_ok` or `existing_needs_correction`, not `missing_day`.

**Optional shadow-only (no writes, no Exa):**

`GET /api/agent/pipeline/shadow-validate?dateFrom=2025-01-01&dateTo=2025-01-10`

---

## Automated test in repo

`server/tests/editorial-jan-2025-fixture.test.ts` — offline triage expectations for this window (no DB required for triage assertions).

Refresh script: `server/scripts/triage-jan-2025-sample.ts`.
