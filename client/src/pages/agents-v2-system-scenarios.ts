/**
 * System graph demo — ordered step playlists.
 *
 * - **`story(a, b, c)`** — each segment runs after the previous one (read top → bottom).
 * - **`humanGate(...)`** — the fixed 3-beat slice: orchestrator → review → options overlay → orchestrator.
 *
 * **Branching model (what the scenarios encode):**
 * - **Default day:** `ENTRY` → `SANITY_PASS` → `NEWS_PASS` → `TAXONOMY_RUN` → `PERSIST` (`CORE_CLEAN`).
 * - **Empty / weak primary:** news first (`SCENARIO_NEWS_EMPTY_FIRST`), human, re-news → `RESANITY_AFTER_NEWS`
 *   → taxonomy (no pre-pass sanity in that demo path).
 * - **Evidence fingerprint changed** (second news pass, or primary swap from review): `RESANITY_AFTER_NEWS`
 *   always before taxonomy.
 * - **Taxonomy BLOCK, fix in place:** `SCENARIO_TAXONOMY_*` (human → re-dispatch taxonomy only).
 * - **Taxonomy BLOCK, wrong article:** `SCENARIO_TAXONOMY_NEWS_SWAP` — human chooses swap → full `NEWS_PASS`
 *   → `RESANITY_AFTER_NEWS` → `TAXONOMY_RUN`.
 */
import type { ScenarioDef, Step } from "@/pages/agents-v2-system-types";
import { HUMAN_RETURN } from "@/pages/agents-v2-system-types";

/** Concatenate segments in strict playback order (each argument is a `Step[]`). */
export function story(...segments: ReadonlyArray<Step>[]): Step[] {
  const out: Step[] = [];
  for (const seg of segments) {
    for (const step of seg) out.push(step);
  }
  return out;
}

/** Standard human review slice: open review → show options (popup in graph) → structured return. */
export function humanGate(o: {
  toReviewCaption: string;
  /** Shown as the caption on the step that carries `humanOptions` (overlay body uses the options list). */
  optionsCaption?: string;
  humanOptions: string[];
  returnCaption: string;
}): Step[] {
  return [
    {
      edge: "orch-review",
      direction: "forward",
      lineTone: "human",
      caption: o.toReviewCaption,
      focus: "review",
    },
    {
      edge: null,
      caption: o.optionsCaption ?? "Human options",
      focus: "review",
      humanOptions: o.humanOptions,
    },
    {
      edge: "orch-review",
      direction: "reverse",
      lineTone: HUMAN_RETURN,
      caption: o.returnCaption,
      focus: "orchestrator",
    },
  ];
}

const STEPS_RECONCILE_BEATS: Step[] = [
  {
    edge: null,
    sustainEdge: "orch-taxonomy",
    sustainTone: "dispatch",
    caption: "Taxonomy · tags vs evidence (per tag)",
    focus: "taxonomy",
    checkRun: { agent: "taxonomy", key: "tags" },
  },
  {
    edge: null,
    sustainEdge: "orch-taxonomy",
    sustainTone: "dispatch",
    caption: "Taxonomy · topics vs evidence + neighbor collision scan",
    focus: "taxonomy",
    checkRun: { agent: "taxonomy", key: "topics" },
  },
  {
    edge: null,
    sustainEdge: "orch-taxonomy",
    sustainTone: "dispatch",
    caption: "Taxonomy · joint reconciliation (tags ↔ topics ↔ summary ↔ URL)",
    focus: "taxonomy",
    checkRun: { agent: "taxonomy", key: "reconcile" },
  },
];

const SANITY_MICRO: Step[] = [
  {
    edge: null,
    sustainEdge: "orch-sanity",
    sustainTone: "dispatch",
    caption: "Sanity · length bands & word budget vs house style",
    focus: "sanity",
    checkRun: { agent: "sanity", key: "length" },
  },
  {
    edge: null,
    sustainEdge: "orch-sanity",
    sustainTone: "dispatch",
    caption: "Sanity · structure / sections / headline shape",
    focus: "sanity",
    checkRun: { agent: "sanity", key: "structure" },
  },
  {
    edge: null,
    sustainEdge: "orch-sanity",
    sustainTone: "dispatch",
    caption: "Sanity · objective plausibility (could this have happened on this date?)",
    focus: "sanity",
    checkRun: { agent: "sanity", key: "plausibility" },
  },
  {
    edge: null,
    sustainEdge: "orch-sanity",
    sustainTone: "dispatch",
    caption: "Sanity · calendar anchor vs corpus window & holiday logic",
    focus: "sanity",
    checkRun: { agent: "sanity", key: "calendar" },
  },
];

const NEWS_MICRO: Step[] = [
  {
    edge: null,
    sustainEdge: "orch-news",
    sustainTone: "dispatch",
    caption: "News · corpus query + candidate URL ranking",
    focus: "news",
    checkRun: { agent: "news", key: "corpus" },
  },
  {
    edge: null,
    sustainEdge: "orch-news",
    sustainTone: "dispatch",
    caption: "News · host allowlist + TLS / reputation signals",
    focus: "news",
    checkRun: { agent: "news", key: "hosts" },
  },
  {
    edge: null,
    sustainEdge: "orch-news",
    sustainTone: "dispatch",
    caption: "News · recency vs story half-life for this desk",
    focus: "news",
    checkRun: { agent: "news", key: "recency" },
  },
  {
    edge: null,
    sustainEdge: "orch-news",
    sustainTone: "dispatch",
    caption: "News · corroboration / second-source rule where required",
    focus: "news",
    checkRun: { agent: "news", key: "corroboration" },
  },
  {
    edge: null,
    sustainEdge: "orch-news",
    sustainTone: "dispatch",
    caption: "News · empty-day & weak-primary probes (thresholded)",
    focus: "news",
    checkRun: { agent: "news", key: "emptyWeak" },
  },
];

const ENTRY: Step[] = [
  {
    edge: null,
    caption: "Date + draft slice loaded at orchestrator (implicit ingest)",
    focus: "orchestrator",
  },
];

const SANITY_PASS: Step[] = [
  {
    edge: "orch-sanity",
    direction: "forward",
    caption: "Orchestrator → day & draft sanity agent",
    focus: "sanity",
    checkReset: "sanity",
  },
  ...SANITY_MICRO,
  {
    edge: "orch-sanity",
    direction: "reverse",
    lineTone: "ok",
    caption: "PASS — sanity agent: all sub-checks green",
    focus: "orchestrator",
    checkPassAll: "sanity",
  },
];

const NEWS_PASS: Step[] = [
  {
    edge: "orch-news",
    direction: "forward",
    caption: "Orchestrator → news & evidence agent",
    focus: "news",
    checkReset: "news",
  },
  ...NEWS_MICRO,
  {
    edge: "orch-news",
    direction: "reverse",
    lineTone: "ok",
    caption: "PASS — primary URL + evidence table accepted",
    focus: "orchestrator",
    checkPassAll: "news",
  },
];

const TAXONOMY_RUN: Step[] = [
  {
    edge: "orch-taxonomy",
    direction: "forward",
    caption: "Orchestrator → taxonomy agent (tags + topics together)",
    focus: "taxonomy",
    checkReset: "taxonomy",
  },
  ...STEPS_RECONCILE_BEATS,
  {
    edge: "orch-taxonomy",
    direction: "reverse",
    lineTone: "ok",
    caption: "PASS — taxonomy + reconciliation clean",
    focus: "orchestrator",
    checkPassAll: "taxonomy",
  },
];

const PERSIST: Step[] = [
  {
    edge: null,
    caption: "Orchestrator persists slice — no further human gate",
    focus: "orchestrator",
  },
];

/** When URLs/quotes change, draft+date must pass sanity again before topics/tags finalization. */
const RESANITY_AFTER_NEWS: Step[] = [
  {
    edge: null,
    caption:
      "Orchestrator: evidence fingerprint changed — re-run sanity before taxonomy (policy)",
    focus: "orchestrator",
  },
  {
    edge: "orch-sanity",
    direction: "forward",
    caption: "Re-dispatch sanity agent on updated evidence bundle",
    focus: "sanity",
    checkReset: "sanity",
  },
  ...SANITY_MICRO,
  {
    edge: "orch-sanity",
    direction: "reverse",
    lineTone: "ok",
    caption: "PASS — length / plausibility / anchors still OK after new sources",
    focus: "orchestrator",
    checkPassAll: "sanity",
  },
];

const CORE_CLEAN = story(ENTRY, SANITY_PASS, NEWS_PASS, TAXONOMY_RUN, PERSIST);

/** Full “news → taxonomy → persist” tail used after sanity is already clean. */
const AFTER_NEWS_PASS_THEN_TAXONOMY = story(NEWS_PASS, TAXONOMY_RUN, PERSIST);

const ORCH_SECOND_NEWS_PASS_NOTE: Step[] = [
  {
    edge: null,
    caption: "Orchestrator: new URLs or quotes merged — second news pass",
    focus: "orchestrator",
  },
];

const NEWS_PASS_REFRESH_CAPTIONS: Step[] = NEWS_PASS.map((s, i) =>
  i === 0 ? { ...s, caption: "Re-dispatch news agent (refresh crawl / merge bundle)" } : s,
);

/** Second news pass (e.g. refresh) then mandatory re-sanity, then taxonomy. */
const SCENARIO_SOURCES_REFRESH = story(
  ENTRY,
  SANITY_PASS,
  NEWS_PASS,
  ORCH_SECOND_NEWS_PASS_NOTE,
  NEWS_PASS_REFRESH_CAPTIONS,
  RESANITY_AFTER_NEWS,
  TAXONOMY_RUN,
  PERSIST,
);

const NEWS_DISPATCH_THEN_MICRO_THROUGH_CORROBORATE: Step[] = story(
  NEWS_PASS.slice(0, 1),
  NEWS_MICRO.slice(0, 3),
);

const NEWS_BLOCK_EMPTY_WEAK: Step[] = [
  ...NEWS_DISPATCH_THEN_MICRO_THROUGH_CORROBORATE,
  {
    edge: "orch-news",
    direction: "reverse",
    lineTone: "fail",
    caption: "BLOCK — empty or weak primary (AWAITING_SOURCE / WEAK_PRIMARY)",
    focus: "orchestrator",
    checkFail: { agent: "news", key: "emptyWeak" },
  },
];

const NEWS_PASS_REDISPATCH_AFTER_HUMAN: Step[] = NEWS_PASS.map((s, i) =>
  i === 0
    ? { ...s, caption: "Re-dispatch news & evidence agent with locked / new constraints" }
    : s,
);

/**
 * Empty / weak-primary path: orchestrator dispatches **news first** (no “load day” caption, no pre-pass
 * sanity in this demo). After human + re-news, **sanity** still runs before taxonomy (policy).
 */
const SCENARIO_NEWS_EMPTY_FIRST = story(
  NEWS_BLOCK_EMPTY_WEAK,
  humanGate({
    toReviewCaption: "Orchestrator → review (human): resolve sources",
    optionsCaption: "Human review — pick one path (or combine)",
    humanOptions: [
      "Pick a different primary URL from ranked candidates",
      "Ask the news agent to re-search with a narrowed query",
      "Mark day as legitimately sparse / no-publish (policy)",
      "Abort slice and return to calendar",
    ],
    returnCaption: "Human decision → orchestrator (structured payload)",
  }),
  NEWS_PASS_REDISPATCH_AFTER_HUMAN,
  RESANITY_AFTER_NEWS,
  TAXONOMY_RUN,
  PERSIST,
);

const SCENARIO_NEWS_WEAK = story(
  ENTRY,
  SANITY_PASS,
  NEWS_PASS.slice(0, 1),
  NEWS_MICRO.slice(0, 4),
  [
    {
      edge: "orch-news",
      direction: "reverse",
      lineTone: "fail",
      caption: "BLOCK — primary below quality bar (WEAK_PRIMARY)",
      focus: "orchestrator",
      checkFail: { agent: "news", key: "hosts" },
    },
  ],
  humanGate({
    toReviewCaption: "Orchestrator → review: upgrade primary or waive with rationale",
    humanOptions: [
      "Select stronger URL from agent shortlist",
      "Paste an allowed URL + one-line justification",
      "Waive with editor rationale (audited)",
      "Send back to news agent with new keywords",
    ],
    returnCaption: "Decision recorded → orchestrator",
  }),
  NEWS_PASS.map((s, i) =>
    i === 0 ? { ...s, caption: "Re-dispatch news agent after human input" } : s,
  ),
  RESANITY_AFTER_NEWS,
  TAXONOMY_RUN,
  PERSIST,
);

const NEWS_PASS_REBUILD_EVIDENCE: Step[] = NEWS_PASS.map((s, i) =>
  i === 0 ? { ...s, caption: "Re-dispatch news agent to rebuild evidence table" } : s,
);

const SCENARIO_NEWS_MISMATCH = story(
  ENTRY,
  SANITY_PASS,
  NEWS_PASS.slice(0, 1),
  NEWS_MICRO,
  [
    {
      edge: "orch-news",
      direction: "reverse",
      lineTone: "fail",
      caption: "BLOCK — summary ⊄ evidence table (EVIDENCE_MISMATCH)",
      focus: "orchestrator",
      checkFail: { agent: "news", key: "corpus" },
    },
  ],
  humanGate({
    toReviewCaption: "Orchestrator → review: align copy with sources",
    humanOptions: [
      "Tighten summary to quoted facts only",
      "Swap primary URL and re-run news agent",
      "Reject publish for this slice",
      "Accept agent-suggested shorter lede",
    ],
    returnCaption: "Edits / URL choice → orchestrator",
  }),
  NEWS_PASS_REBUILD_EVIDENCE,
  RESANITY_AFTER_NEWS,
  TAXONOMY_RUN,
  PERSIST,
);

const SCENARIO_SANITY_LENGTH = story(
  ENTRY,
  SANITY_PASS.slice(0, 1),
  SANITY_MICRO.slice(0, 1),
  [
    {
      edge: "orch-sanity",
      direction: "reverse",
      lineTone: "fail",
      caption: "BLOCK — LENGTH_OUT_OF_BAND (sanity agent)",
      focus: "orchestrator",
      checkFail: { agent: "sanity", key: "length" },
    },
  ],
  humanGate({
    toReviewCaption: "Orchestrator → review: fix length / structure",
    humanOptions: [
      "Edit sections to fit word budget",
      "Split into two calendar slices (if policy allows)",
      "Request shorter regeneration from last checkpoint",
      "Reject slice",
    ],
    returnCaption: "Decision → orchestrator",
  }),
  SANITY_PASS,
  AFTER_NEWS_PASS_THEN_TAXONOMY,
);

const SCENARIO_SANITY_PLAUSIBLE = story(
  ENTRY,
  SANITY_PASS.slice(0, 1),
  SANITY_MICRO.slice(0, 3),
  [
    {
      edge: "orch-sanity",
      direction: "reverse",
      lineTone: "fail",
      caption: "BLOCK — IMPLAUSIBLE_FOR_DATE (timeline vs anchors)",
      focus: "orchestrator",
      checkFail: { agent: "sanity", key: "plausibility" },
    },
  ],
  humanGate({
    toReviewCaption: "Orchestrator → review: plausibility / timeline",
    humanOptions: [
      "Correct factual claim with source citation",
      "Change date anchor if wrong slice was opened",
      "Downgrade hedging language to match evidence",
      "Reject slice",
    ],
    returnCaption: "Decision → orchestrator",
  }),
  SANITY_PASS,
  AFTER_NEWS_PASS_THEN_TAXONOMY,
);

const SCENARIO_SANITY_CALENDAR = story(
  ENTRY,
  SANITY_PASS.slice(0, 1),
  SANITY_MICRO,
  [
    {
      edge: "orch-sanity",
      direction: "reverse",
      lineTone: "fail",
      caption: "BLOCK — DATE_ANCHOR_MISMATCH (sanity agent)",
      focus: "orchestrator",
      checkFail: { agent: "sanity", key: "calendar" },
    },
  ],
  humanGate({
    toReviewCaption: "Orchestrator → review: calendar / window",
    humanOptions: [
      "Pick correct trading / holiday calendar",
      "Adjust corpus window to match intended day",
      "Re-open correct UTC day in admin",
      "Reject slice",
    ],
    returnCaption: "Decision → orchestrator",
  }),
  SANITY_PASS,
  AFTER_NEWS_PASS_THEN_TAXONOMY,
);

const SCENARIO_TAXONOMY_TAGS = story(
  ENTRY,
  SANITY_PASS,
  NEWS_PASS,
  [
    {
      edge: "orch-taxonomy",
      direction: "forward",
      caption: "Orchestrator → taxonomy agent",
      focus: "taxonomy",
      checkReset: "taxonomy",
    },
    STEPS_RECONCILE_BEATS[0],
  ],
  [
    {
      edge: "orch-taxonomy",
      direction: "reverse",
      lineTone: "fail",
      caption: "BLOCK — UNGROUNDED_TAG (taxonomy agent)",
      focus: "orchestrator",
      checkFail: { agent: "taxonomy", key: "tags" },
    },
  ],
  humanGate({
    toReviewCaption: "Orchestrator → review: tags",
    humanOptions: [
      "Remove tags not in evidence quotes",
      "Add tags from suggestion list",
      "Alias map override (with audit note)",
      "Defer to editor chief (escalation token)",
    ],
    returnCaption: "Tag edits committed → orchestrator",
  }),
  [
    {
      edge: "orch-taxonomy",
      direction: "forward",
      caption: "Re-dispatch taxonomy agent (full reconciliation)",
      focus: "taxonomy",
      checkReset: "taxonomy",
    },
  ],
  STEPS_RECONCILE_BEATS,
  [
    {
      edge: "orch-taxonomy",
      direction: "reverse",
      lineTone: "ok",
      caption: "PASS — reconciliation after human",
      focus: "orchestrator",
      checkPassAll: "taxonomy",
    },
  ],
  PERSIST,
);

const SCENARIO_TAXONOMY_TOPICS = story(
  ENTRY,
  SANITY_PASS,
  NEWS_PASS,
  [
    {
      edge: "orch-taxonomy",
      direction: "forward",
      caption: "Orchestrator → taxonomy agent",
      focus: "taxonomy",
      checkReset: "taxonomy",
    },
    STEPS_RECONCILE_BEATS[0],
    STEPS_RECONCILE_BEATS[1],
  ],
  [
    {
      edge: "orch-taxonomy",
      direction: "reverse",
      lineTone: "fail",
      caption: "BLOCK — TOPIC_NEIGHBOR_CLASH (taxonomy agent)",
      focus: "orchestrator",
      checkFail: { agent: "taxonomy", key: "topics" },
    },
  ],
  humanGate({
    toReviewCaption: "Orchestrator → review: topics",
    humanOptions: [
      "Merge topic with neighbor slice",
      "Rename topic to non-colliding label",
      "Drop topic if single-day noise",
      "Split article into two topics (policy)",
    ],
    returnCaption: "Topic edits → orchestrator",
  }),
  [
    {
      edge: "orch-taxonomy",
      direction: "forward",
      caption: "Re-dispatch taxonomy agent",
      focus: "taxonomy",
      checkReset: "taxonomy",
    },
  ],
  STEPS_RECONCILE_BEATS,
  [
    {
      edge: "orch-taxonomy",
      direction: "reverse",
      lineTone: "ok",
      caption: "PASS — topics + neighbors aligned",
      focus: "orchestrator",
      checkPassAll: "taxonomy",
    },
  ],
  PERSIST,
);

const SCENARIO_TAXONOMY_RECONCILE = story(
  ENTRY,
  SANITY_PASS,
  NEWS_PASS,
  [
    {
      edge: "orch-taxonomy",
      direction: "forward",
      caption: "Orchestrator → taxonomy agent",
      focus: "taxonomy",
      checkReset: "taxonomy",
    },
  ],
  STEPS_RECONCILE_BEATS,
  [
    {
      edge: "orch-taxonomy",
      direction: "reverse",
      lineTone: "fail",
      caption: "BLOCK — RECONCILE_FAIL (tags ↔ topics ↔ summary still clash)",
      focus: "orchestrator",
      checkFail: { agent: "taxonomy", key: "reconcile" },
    },
  ],
  humanGate({
    toReviewCaption: "Orchestrator → review: joint fix",
    humanOptions: [
      "Edit summary line that forces illegal tag",
      "Remove topic that implies tag not in evidence",
      "Accept agent unified diff",
      "Reject publish",
    ],
    returnCaption: "Joint edits → orchestrator",
  }),
  [
    {
      edge: "orch-taxonomy",
      direction: "forward",
      caption: "Re-dispatch taxonomy agent",
      focus: "taxonomy",
      checkReset: "taxonomy",
    },
  ],
  STEPS_RECONCILE_BEATS,
  [
    {
      edge: "orch-taxonomy",
      direction: "reverse",
      lineTone: "ok",
      caption: "PASS — reconciliation closed",
      focus: "orchestrator",
      checkPassAll: "taxonomy",
    },
  ],
  PERSIST,
);

const SCENARIO_DUP_NEIGHBOR = story(
  ENTRY,
  SANITY_PASS,
  NEWS_PASS,
  [
    {
      edge: "orch-taxonomy",
      direction: "forward",
      caption: "Orchestrator → taxonomy agent",
      focus: "taxonomy",
      checkReset: "taxonomy",
    },
    {
      edge: null,
      sustainEdge: "orch-taxonomy",
      sustainTone: "dispatch",
      caption: "Taxonomy · duplicate / neighbor headline fingerprint",
      focus: "taxonomy",
      checkRun: { agent: "taxonomy", key: "dup" },
    },
  ],
  STEPS_RECONCILE_BEATS.slice(1),
  [
    {
      edge: "orch-taxonomy",
      direction: "reverse",
      lineTone: "fail",
      caption: "BLOCK — DUP_NEIGHBOR_HEADLINE",
      focus: "orchestrator",
      checkFail: { agent: "taxonomy", key: "dup" },
    },
  ],
  humanGate({
    toReviewCaption: "Orchestrator → review: duplicate decision",
    humanOptions: [
      "Merge with neighbor day (keep stronger URL)",
      "Keep separate with distinct lede (min edit)",
      "Mark false duplicate after manual read",
      "Reject one of the slices",
    ],
    returnCaption: "Duplicate decision → orchestrator",
  }),
  [
    {
      edge: "orch-taxonomy",
      direction: "forward",
      caption: "Re-dispatch taxonomy agent",
      focus: "taxonomy",
      checkReset: "taxonomy",
    },
  ],
  STEPS_RECONCILE_BEATS,
  [
    {
      edge: "orch-taxonomy",
      direction: "reverse",
      lineTone: "ok",
      caption: "PASS",
      focus: "orchestrator",
      checkPassAll: "taxonomy",
    },
  ],
  PERSIST,
);

/** Full news pass after human chose a different primary / wider search from a taxonomy review gate. */
const NEWS_PASS_POST_ARTICLE_SWAP: Step[] = NEWS_PASS.map((s, i) =>
  i === 0
    ? {
        ...s,
        caption:
          "Orchestrator → news & evidence agent (new primary / re-ranked URLs after taxonomy signal)",
      }
    : s,
);

/**
 * Tags BLOCK because the **current primary cannot support the draft’s tags** (wrong-slice signal).
 * Human may fix tags only (`SCENARIO_TAXONOMY_TAGS`) — here they **swap primary**: full **news** pass,
 * mandatory **sanity** (`RESANITY_AFTER_NEWS`), then **taxonomy** again.
 */
const SCENARIO_TAXONOMY_NEWS_SWAP = story(
  ENTRY,
  SANITY_PASS,
  NEWS_PASS,
  [
    {
      edge: "orch-taxonomy",
      direction: "forward",
      caption: "Orchestrator → taxonomy agent",
      focus: "taxonomy",
      checkReset: "taxonomy",
    },
    STEPS_RECONCILE_BEATS[0],
  ],
  [
    {
      edge: "orch-taxonomy",
      direction: "reverse",
      lineTone: "fail",
      caption:
        "BLOCK — UNGROUNDED_TAG (tags unsupported by primary quotes — likely wrong article for this slice)",
      focus: "orchestrator",
      checkFail: { agent: "taxonomy", key: "tags" },
    },
  ],
  humanGate({
    toReviewCaption: "Orchestrator → review: tags vs evidence (reopen news?)",
    optionsCaption: "Human options — in-place tag edit vs swap primary",
    humanOptions: [
      "Swap primary URL / re-run news & evidence, then mandatory sanity + taxonomy",
      "Remove tags not supported by current primary quotes",
      "Add quotes to evidence table only (keep primary)",
      "Escalate to editor chief",
    ],
    returnCaption: "Swap-primary path chosen → orchestrator",
  }),
  NEWS_PASS_POST_ARTICLE_SWAP,
  RESANITY_AFTER_NEWS,
  TAXONOMY_RUN,
  PERSIST,
);

export const SCENARIOS: ScenarioDef[] = [
  {
    id: "gen-clean",
    group: "General",
    label: "Clean day → persisted",
    description:
      "A day already has a date-accurate event, valid 100-110 character summary, grounded tags, and homepage storyline links. It can persist without human intervention.",
    outcome: "Clean",
    outcomeKind: "ok" as const,
    steps: CORE_CLEAN,
  },
  {
    id: "gen-sources-refresh",
    group: "General",
    label: "Article chosen → summary approval",
    description:
      "After the human picks an article, the agent generates the summary, proposes concrete tags and homepage storylines, then queues final approval.",
    outcome: "Summary approval",
    outcomeKind: "ok" as const,
    steps: SCENARIO_SOURCES_REFRESH,
  },
  {
    id: "san-length",
    group: "Intake & date sanity",
    label: "Summary length → human edit",
    description: "Summary outside 100-110 characters blocks approval. Human edits or reruns before the day can be marked clean.",
    outcome: "Resolved then persisted",
    outcomeKind: "review" as const,
    steps: SCENARIO_SANITY_LENGTH,
  },
  {
    id: "san-plausible",
    group: "Intake & date sanity",
    label: "Date plausibility → human",
    description: "The event may not objectively belong to the target date, so the human chooses whether to keep, move, reject, or replace it.",
    outcome: "Resolved then persisted",
    outcomeKind: "review" as const,
    steps: SCENARIO_SANITY_PLAUSIBLE,
  },
  {
    id: "san-calendar",
    group: "Intake & date sanity",
    label: "Retrospective article → blocked",
    description: "An article may mention an older Bitcoin event without that event happening on the target date. The system blocks this for review.",
    outcome: "Resolved then persisted",
    outcomeKind: "review" as const,
    steps: SCENARIO_SANITY_CALENDAR,
  },
  {
    id: "news-empty",
    group: "Source selection",
    label: "Missing day → article pick",
    description:
      "No valid day exists. The system uses stored candidates or fetches, recommends the best candidate, and asks the human to pick or mark empty.",
    outcome: "Human pick",
    outcomeKind: "review" as const,
    steps: SCENARIO_NEWS_EMPTY_FIRST,
  },
  {
    id: "news-weak",
    group: "Source selection",
    label: "Weak selected article → replacement",
    description: "The current article is too weak or generic, so the system offers stronger already-fetched candidates before regenerating summary/tags/storylines.",
    outcome: "Resolved then persisted",
    outcomeKind: "review" as const,
    steps: SCENARIO_NEWS_WEAK,
  },
  {
    id: "news-mismatch",
    group: "Source selection",
    label: "Evergreen explainer → blocked",
    description: "A generic explainer, such as a future halving article, cannot pass as the event for the date. The human must choose a better event.",
    outcome: "Resolved then persisted",
    outcomeKind: "block" as const,
    steps: SCENARIO_NEWS_MISMATCH,
  },
  {
    id: "tax-tags",
    group: "Summary + taxonomy",
    label: "Tags not grounded → human",
    description:
      "Tags must be concrete entities grounded in the summary/article. Abstract tags and random fragments are proposed for removal.",
    outcome: "Resolved then persisted",
    outcomeKind: "block" as const,
    steps: SCENARIO_TAXONOMY_TAGS,
  },
  {
    id: "tax-tags-news-resanity",
    group: "Summary + taxonomy",
    label: "Bad tags → swap article",
    description:
      "If the tags are wrong because the chosen article is wrong, the human can return to source selection and pick a better candidate.",
    outcome: "Resolved then persisted",
    outcomeKind: "review" as const,
    steps: SCENARIO_TAXONOMY_NEWS_SWAP,
  },
  {
    id: "tax-topics",
    group: "Summary + taxonomy",
    label: "Homepage storyline → human",
    description: "The agent maps to existing homepage storylines, or proposes a missing granular child such as Bitcoin → Halving events.",
    outcome: "Resolved then persisted",
    outcomeKind: "block" as const,
    steps: SCENARIO_TAXONOMY_TOPICS,
  },
  {
    id: "tax-reconcile",
    group: "Summary + taxonomy",
    label: "Summary ↔ tags ↔ storyline mismatch",
    description: "If the summary, tags, storyline, and article do not describe the same event, the human sees a single combined fix.",
    outcome: "Resolved then persisted",
    outcomeKind: "block" as const,
    steps: SCENARIO_TAXONOMY_RECONCILE,
  },
  {
    id: "tax-dup",
    group: "Summary + taxonomy",
    label: "Duplicate storyline → pick another",
    description: "Duplicate or near-identical storylines are shown side by side; accepting one should resolve the group or send the date back to candidate selection.",
    outcome: "Resolved then persisted",
    outcomeKind: "block" as const,
    steps: SCENARIO_DUP_NEIGHBOR,
  },
];

export const SCENARIO_IDS = new Set(SCENARIOS.map((s) => s.id));
