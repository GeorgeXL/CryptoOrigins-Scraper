# Editorial agent — target architecture (vs today)

Honest map of what you are building, how the system works now, where it lies, and where it must go. Use this with [`EDITORIAL_AGENT_STEPS.md`](./EDITORIAL_AGENT_STEPS.md) for step-by-step detail.

---

## 1. Product in one picture

You are not building “an AI that fills a database.” You are building a **published timeline** where every day is a trustworthy card on the homepage.

```mermaid
flowchart TB
  subgraph Reader["Reader experience"]
    HP[Homepage calendar]
    TL[Timeline by date]
    BYT[Browse by topic / storyline]
    BYG[Browse by tag / entity]
  end

  subgraph DayRecord["One day = one record"]
    D[Calendar date]
    E[Winning event / article]
    S[Summary 100–110 chars]
    Tg[Entity tags]
    Tp[One topic leaf]
  end

  subgraph Trust["Trust layer"]
    H[Human approval gate]
    W[Write once — approved-writer]
  end

  HP --> TL
  TL --> DayRecord
  BYT --> Tp
  BYG --> Tg
  DayRecord --> Trust
  Trust --> DayRecord
```

| Layer | Question it answers | If wrong… |
|-------|---------------------|-----------|
| **Date** | Did this happen *on this day*? | Timeline lies |
| **Event** | Is this the most important thing that day? | Wrong story on the slot |
| **Summary** | What happened, in one tight line? | Reader confusion |
| **Tags** | *Who / what* was involved? | Entity pages break |
| **Topic** | *What kind of story* is this? | Storyline browse breaks |
| **Approval** | Did a human sign off? | No trust |

---

## 2. The day record — fields and rules

| Field | DB / code | Hard rule | Who should decide (target) | Who decides (today) |
|-------|-----------|-----------|----------------------------|---------------------|
| `date` | `historical_news_analyses.date` | ISO day key | Calendar + canonical rules | Regex (Pizza Day) + optional LLM date agent |
| `top_article_id` | `top_article_id` | Real URL/id, not placeholder | Article Discovery Agent | LLM on empty days; existing row otherwise |
| `summary` | `summary` | 100–110 chars, active voice, no date tokens | Summary Agent + retry | LLM generates; pipeline validates |
| `tags_version2` | JSON array | Concrete entities, grounded in summary | Tag Agent + grounding rules | Entity extractor + `proposals.ts` rules |
| `topic_categories` | JSON array | **Exactly one** `TOPIC_HIERARCHY` leaf | **Topic Agent (LLM) + hierarchy guard** | **Regex map + you + validator stub** |
| `is_orphan` | flag | Cleared only after summary approval | Human summary gate | Mostly correct |
| `is_flagged` | flag | Manual issue marker | Human | Human |

```mermaid
erDiagram
  DAY ||--o{ TAG : "tags_version2"
  DAY ||--|| TOPIC : "one leaf only"
  DAY ||--|| ARTICLE : "top_article_id"
  DAY {
    string date PK
    string summary
    string top_article_id
    json topic_categories
    json tags_version2
    bool is_orphan
    bool is_flagged
  }
  TOPIC {
    string leaf "from TOPIC_HIERARCHY"
    string group "Bitcoin | Markets | Macro..."
  }
  TAG {
    string name "entity only"
  }
```

---

## 3. Triage — how a day enters the pipeline

**LLM today:** No. Pure rules in `triage.ts`.

```mermaid
flowchart TD
  Start([Run agent for date range]) --> Load[Load DB row]
  Load --> HasRow{Row exists?}
  HasRow -->|No| MD[missing_day]
  HasRow -->|Yes| Checks{Quality checks}
  Checks -->|All pass| OK[existing_ok]
  Checks -->|Issues + usable source| ENC[existing_needs_correction]
  Checks -->|No source / bad summary| ED[empty_day]

  MD --> PathEmpty[SourceFinder path]
  ED --> PathEmpty
  ENC --> PathV3{V3 flag on?}
  OK --> PathV3
  PathV3 -->|Yes| V3[V3 short checks]
  PathV3 -->|No| Legacy[Legacy agent chain]
```

| Route | Meaning | Typical problems |
|-------|---------|------------------|
| `missing_day` | No `historical_news_analyses` row | Date never analyzed |
| `empty_day` | Row exists, no usable event/summary | Needs article search + summary |
| `existing_needs_correction` | Row exists, fails quality/topic/tag rules | Correction queue |
| `existing_ok` | Passes triage | May still fail duplicate/date on deeper check |

**Triage failure signals (examples):**

| Signal | Trigger |
|--------|---------|
| Summary weak | Not 100–110 chars, empty, or “Analysis failed.” |
| No winner | Invalid/missing `top_article_id` |
| Taxonomy missing | No tags and no topics |
| Topic invalid | 0, 2+, legacy placeholder, or not in hierarchy |
| Orphan / flagged | Row flags set |
| Low confidence | Stored score &lt; 60 |

---

## 4. Two pipelines today (the “two jokes”)

When `EDITORIAL_PIPELINE_V3_GATED_FETCH=1` (env flag), **existing days** take a different path than **empty days**. That split is a major source of confusion.

### 4a. V3 path (existing days)

```mermaid
sequenceDiagram
  participant Run as Pipeline run
  participant V3 as V3 checks
  participant Prop as proposals.ts
  participant Rules as storyline-taxonomy
  participant Q as Human queue
  participant W as approved-writer

  Run->>V3: 1. Canonical date (regex)
  alt Pizza Day mismatch
    V3->>Q: Calendar decision card
  end
  Run->>V3: 2. Duplicate neighbors (Jaccard + tags)
  alt Strong overlap
    V3->>Q: Duplicate decision card
  end
  Run->>Prop: 3. buildCorrectionProposals
  Prop->>Rules: rankTopicCandidatesFromSummary
  alt Manual proposals
    Prop->>Q: Correction card (Add/Remove/chips)
  end
  Note over Rules: No LLM — regex + keywords
  Q->>W: Operator approves
```

| V3 step | Intelligence type | What it “knows” |
|---------|-------------------|-----------------|
| Canonical date | **Hardcoded regex** | Only rules in `CANONICAL_DATE_RULES` (≈ Pizza Day) |
| Duplicate | **Statistics** | ±56 days, shared tags/topics, summary token Jaccard |
| Proposals | **Rules** | Grounding, tag conflicts, topic rank, summary length |
| Auto-apply | **Safe subset** | Drops/merges with no ambiguity |

### 4b. Legacy agent chain (empty / missing / V3 off)

```mermaid
flowchart LR
  NM[NewsManager<br/>route only] --> SF[SourceFinder<br/>LLM via newsAnalyzer]
  SF --> RC[RelevanceChecker<br/>rules]
  RC --> VF[Verification<br/>reads old verdicts]
  VF --> TM[TopicManager<br/>validator ONLY]
  TM --> TG[TagManager<br/>coverage check]
  TG --> SM[SummaryAgent<br/>validator ONLY]
  SM --> DC[DuplicateChecker<br/>Jaccard]
  DC --> DT[DateConsistency<br/>regex + LLM]
  DT --> TC[TagConsistency<br/>web2/web3]
  TC --> FE[FinalEditor<br/>gate]
  FE --> Q[Human queue]
```

**Critical naming lie:**

```mermaid
flowchart LR
  subgraph Name["What the name implies"]
    A[TopicManagerAgent<br/>manages / assigns topics]
  end
  subgraph Reality["What the code does"]
    B[TopicValidator<br/>is leaf count = 1?<br/>is leaf in hierarchy?]
  end
  Name -.->|misleading| Reality
```

---

## 5. Topic assignment — today vs target (the spine)

Topics are how users browse **storylines**. This is the biggest gap between your spec and production.

### 5a. Today — three systems, none is a Topic Agent

```mermaid
flowchart TB
  subgraph S1["System A — legacy analyzer"]
    NA[news-analyzer LLM] --> TC1["topicCategories: free strings<br/>historical, adoption..."]
  end
  subgraph S2["System B — rule engine"]
    SUM[Summary text] --> ST[storyline-taxonomy.ts]
    ST --> PAT[Regex patterns]
    ST --> KW[Keyword scores]
    PAT --> OUT[0–3 leaf suggestions]
    KW --> OUT
  end
  subgraph S3["System C — validator"]
    ROW[Stored topic] --> TV[topic-validation.ts]
    TV --> OK{valid single leaf?}
  end
  OUT --> Q[Human picks in queue]
  TC1 --> ROW
  OK -->|fail| Prop[Correction proposal]
  Prop --> Q
```

| Stage | LLM? | Input | Output | Example failure |
|-------|------|-------|--------|-----------------|
| Legacy analyze | Yes | Articles | Random category strings | `economic` on G20 day |
| `rankTopicCandidatesFromSummary` | No | Summary + tags | 0–3 hierarchy leaves | G20 → 2 macro options ✓ |
| Same rules | No | USPS summary | **Empty** — no labor pattern | 2009-08-26 |
| `TopicManagerAgent` | No | Stored topic | Pass/fail only | Does not fix `Soft forks` on USPS |
| Human | You | Full hierarchy dropdown | Final leaf | Works but slow |

### 5b. Target — Topic Agent as specified

From `TEST_JAN_2026_EDITORIAL_SCENARIOS.md` §8:

```mermaid
flowchart TB
  IN[Approved summary + source snippet + current topic] --> LLM[Topic Agent LLM]
  HIER[Full TOPIC_HIERARCHY in prompt] --> LLM
  NEIGH[Nearby days / duplicate context] --> LLM
  LLM --> JSON{Structured output}
  JSON --> H{confidence}
  H -->|high| ONE[1 recommended leaf + reason]
  H -->|medium| MULTI[2–3 ranked leaves + reasons each]
  H -->|low| NONE[no fit — wrong event or new leaf proposal]
  ONE --> GUARD[Deterministic guards]
  MULTI --> GUARD
  NONE --> GUARD
  GUARD -->|pass| Q[Human queue — opt-in apply]
  GUARD -->|fail| REJECT[Force human or re-pick event]
  Q --> W[approved-writer]
```

**Target JSON contract:**

| Field | Purpose |
|-------|---------|
| `recommended_topic` | Primary leaf (must ∈ hierarchy) |
| `alternates` | Up to 2 more leaves |
| `confidence` | high / medium / low |
| `reason` | Plain English tied to summary |
| `duplicate_risk` | low / medium / high |
| `human_review_required` | Always true for changes |

**Rules after LLM (guards, not brain):**

| Guard | Blocks |
|-------|--------|
| `invalidTopicReasons` | 0 topics, 2+ topics, legacy placeholders, unknown leaves |
| `storedTopicConflictsWithSummary` | Bitcoin topic with no Bitcoin in summary |
| Duplicate agent | Same storyline on nearby date |

---

## 6. Full agent roster — spec vs today vs target

| Agent (name in UI/logs) | Intended role | Today | Target | LLM target? |
|-------------------------|---------------|-------|--------|-------------|
| **NewsManager** | Orchestrate triage + handoffs | Routes + optional run blurb | Same + honest step plan | Optional narrative only |
| **MilestoneAgent** | Calendar milestone gaps | Rule scan | Same | No |
| **SourceFinder / Article Discovery** | Find + rank date-accurate events | LLM article pick + search | Ranked list + reasons + duplicate risk | **Yes** |
| **RelevanceChecker** | Crypto/Bitcoin relevance class | Summary length + article id | Full relevance taxonomy from spec | **Yes** (classify) |
| **VerificationAgent** | Fact-check signals | Reads stored verdicts | Active verification on demand | **Yes** (optional) |
| **SummaryAgent** | Own 100–110 char summary | **Validates only** | Generate + retry + escalate | **Yes** |
| **Tag Agent** | Propose tag add/remove | Extractor + proposals | Spec §7 with reasons | **Yes** + rules |
| **Topic Agent** | Assign storyline leaf | **Missing** — regex + validator | Spec §8 | **Yes** + guards |
| **Duplicate Agent** | Semantic duplicate detection | Jaccard + tag overlap | Spec §9 semantic check | **Mixed** |
| **Date Agent** | Calendar fit | Pizza regex; LLM in legacy only | All canonical rules + LLM | **Mixed** |
| **TopicManager** *(misnamed)* | — | Validator only | **Rename → TopicValidator** | No |
| **FinalEditor / Human gate** | Present diffs, collect approval | Improving UI | Spec §10 display format | No (presentation) |
| **approved-writer** | Apply approved deltas only | **Works** | Same | No |

### Capability maturity (0–3)

| Capability | Today | Target |
|------------|:-----:|:------:|
| Event discovery | 2 | 3 |
| Summary generation | 2 | 3 |
| Tag proposals | 2 | 3 |
| **Topic assignment** | **0–1** | **3** |
| Duplicate detection | 1 | 3 |
| Date / canonical | 1 | 3 |
| Human UX | 2 | 3 |
| Write integrity | 3 | 3 |

*0 = missing, 1 = brittle rules, 2 = usable with human, 3 = spec-complete*

---

## 7. Human review — state machine

Everything meaningful should land as **one understandable card**.

```mermaid
stateDiagram-v2
  [*] --> Triage
  Triage --> ArticlePick: empty / missing day
  Triage --> CalendarFix: canonical mismatch
  Triage --> DuplicateFix: strong neighbor overlap
  Triage --> Correction: tag/topic/summary proposals
  Triage --> AutoOk: existing_ok + no issues

  ArticlePick --> SummaryApproval: article chosen
  SummaryApproval --> Live: approved write

  CalendarFix --> Triage: move / keep / delete
  DuplicateFix --> Triage: keep / merge / re-pick
  Correction --> Live: apply selected changes

  AutoOk --> Live: auto-approved note
  Live --> [*]
```

| Queue phase | What you decide | LLM involved in proposal? |
|-------------|-----------------|---------------------------|
| `awaiting_article_pick` | Which article is the event | Summary + tags: yes; topic: rules |
| `awaiting_summary_approval` | Final summary, tags, topics | Same |
| `awaiting_calendar_decision` | Wrong date slot | No (regex triggered) |
| `awaiting_duplicate_decision` | Same story twice | No (stats triggered) |
| `awaiting_correction_approval` | Add/remove tags, topic chips | **No — rules only today** |

---

## 8. Trust boundary — what may write to the DB

```mermaid
flowchart TB
  subgraph Auto["May auto-write (safe)"]
    A1[Drop ungrounded tag]
    A2[Merge redundant tags]
    A3[Clear obvious conflicts when unambiguous]
  end
  subgraph Human["Must human-approve"]
    H1[Set topic leaf]
    H2[Add tags]
    H3[Summary edit / regen]
    H4[Calendar move]
    H5[Duplicate resolution]
    H6[Article pick]
  end
  subgraph Never["Must never silently"]
    N1[Assign topic from regex alone without queue]
    N2[Inherit legacy historical/economic]
    N3[Use article body for topic when summary differs]
  end
  Auto --> DB[(historical_news_analyses)]
  Human --> AW[approved-writer] --> DB
```

---

## 9. Example journeys (why you feel the pain)

### 2009-04-03 — G20 bailout (rules partially work)

| Step | What happens |
|------|----------------|
| Stored topic | `Early Bitcoin history` (wrong) |
| Summary | G20 $1.1T deal — macro, no Bitcoin |
| Rule engine | Flags conflict; suggests `Bailouts and stimulus` + `Global growth and recession` |
| You | Pick one chip → apply |
| Gap | Works **after** rule addition; still no LLM **reason** |

### 2009-08-26 — USPS buyouts (rules fail)

| Step | What happens |
|------|----------------|
| Stored topic | `Soft forks and hard forks` (nonsense) |
| Summary | USPS buyouts — labor/macro |
| Rule engine | **No pattern match** → empty suggestions |
| You | Full hierarchy dropdown — no help |
| Target Topic Agent | Should suggest `Labor market` or `Global growth and recession` with reason — or say “macro day, weak crypto link — confirm relevance” |

```mermaid
flowchart LR
  subgraph Today["Today"]
    T1[Wrong legacy topic] --> T2[Regex miss]
    T2 --> T3[Empty suggestions]
    T3 --> T4[You scroll 80+ leaves]
  end
  subgraph Target["Target"]
    G1[Wrong legacy topic] --> G2[LLM reads summary]
    G2 --> G3[Ranked 2–3 leaves + why]
    G3 --> G4[You tap one chip]
  end
```

---

## 10. Where LLM runs today (actual call sites)

| Call site | File | Used for topics? |
|-----------|------|------------------|
| **Topic Agent** | `topic-agent.ts` | **Yes** — corrections, article pick, summary approval |
| Article + summary analyze | `news-analyzer.ts` | Legacy free strings only |
| Summary generation | `analysis-modes.ts` | No (`topicCategories: []`) |
| Entity tags | `entity-extractor.ts` | No |
| Date consistency verdict | `date-consistency-llm.ts` (+ `executors.ts`, V3 `run.ts`) | No |
| Run narrative | `run.ts` generateManagerNarrative | No |
| Tag v1 categorization | `tag-categorizer.ts` | **Different taxonomy** — not storyline |
| Rules fallback topics | `storyline-taxonomy.ts` | When Topic Agent disabled / no key |

**Env:** `TOPIC_AGENT_DISABLED=1` forces rules fallback. `EDITORIAL_V3_DATE_LLM=0` skips LLM date check on V3 (regex canonical rules still run).

---

## 11. Target unified pipeline (single path)

Replace V3 + legacy + three topic systems with **one graph**:

```mermaid
flowchart TD
  T[Triage] --> E{Event exists?}
  E -->|No| AD[Article Discovery LLM]
  AD --> SM[Summary Agent LLM]
  E -->|Yes| SM2[Validate or regen summary]
  SM --> TG[Tag Agent LLM]
  SM2 --> TG
  TG --> TP[Topic Agent LLM]
  TP --> G[Deterministic guards]
  G --> DUP[Duplicate check mixed]
  G --> DAT[Date check mixed]
  DUP --> Q[Human queue]
  DAT --> Q
  G --> Q
  Q --> W[approved-writer]
  W --> P[Published day]
```

| Phase | LLM | Rules | Human |
|-------|:---:|:-----:|:-----:|
| Discover event | ✓ | date filters | pick if low confidence |
| Summary | ✓ | 100–110 enforcement | edit if fail |
| Tags | ✓ | entity allowlist | add/remove opt-in |
| **Topics** | **✓** | hierarchy membership | pick among ranked |
| Duplicate / date | partial | thresholds | calendar/dupe cards |
| Write | — | schema validation | already approved |

---

## 12. “Not a joke anymore” — measurable done criteria

| Metric | Today (estimate) | Target |
|--------|------------------|--------|
| Days with useful topic suggestion (chip or single rec) | ~40–60% on correction queue | **≥80%** |
| Legacy placeholder topics silently “valid” | Many old rows | **0** |
| Queue items with plain “why” from model | Rare (rule rationale only) | **100%** of topic changes |
| Steps logged as “Agent completed” with no logic | Common (validators) | **0** — rename or merge |
| Operator opens full topic dropdown | Often on macro/labor | **&lt;20%** of corrections |
| Topic assigned without human on meaningful change | Should not happen | **Never** |

---

## 13. Build roadmap (dependency graph)

```mermaid
flowchart TD
  P1[1. Ship Topic Agent LLM<br/>summary + hierarchy + JSON] --> P2[2. Wire into proposals.ts<br/>replace regex as primary]
  P1 --> P3[3. Article pick + summary approval<br/>use Topic Agent not inferTopicProposal]
  P2 --> P4[4. Bulk backfill queue<br/>legacy/wrong topics]
  P5[5. Rename validators<br/>TopicManager → TopicValidator] --> P6[6. Merge V3 + legacy<br/>one pipeline graph]
  P7[7. Semantic duplicate + date LLM<br/>on V3 path] --> P6
  P4 --> P8[8. Metrics dashboard<br/>§12 KPIs]
  P6 --> P8
```

| Priority | Work | Status |
|:--------:|------|--------|
| **P0** | Topic Agent LLM | **Shipped** |
| **P1** | Deterministic guards | **Shipped** |
| **P2** | Unified existing-day pipeline | **Shipped** — all `existing_*` routes use corpus-clean graph |
| **P3** | `TopicValidatorAgent` naming | **Shipped** — `TopicManagerAgent` kept as legacy alias |
| **P4** | Bulk backfill | **Shipped** — `queue-topic-corrections.ts`, `dry-run-corpus-clean.ts --apply` |
| **P5** | Date + semantic duplicate on existing path | **Shipped** — `date-consistency-llm.ts`, `duplicate-agent-llm.ts` |
| **P6** | Tag Agent LLM | **Shipped** — `tag-agent.ts` in proposals |
| **P7** | §12 metrics | **Shipped** — `corpus-metrics.ts`, `corpus-metrics-report.ts` |
| Open | Metrics dashboard UI, Verification on demand, legacy chain removal | Future |

---

## 14. Honest summary

| Statement | True? |
|-----------|-------|
| You want a publishable Bitcoin/crypto history product | ✓ |
| Topics are the browse spine | ✓ |
| Human must approve meaningful writes | ✓ |
| Current pipeline is mostly validators + regex | ✓ (legacy path); V3 corrections use Topic Agent |
| Topic Agent from your spec is **not shipped** | **No** — v1 shipped (`topic-agent.ts`, wired in proposals + approved-writer) |
| Recent “improvements” = better rules + UI, not LLM topics | **Partially outdated** — rules + UI remain; LLM topics now primary when enabled |
| Calling that full agent intelligence was misleading | ✓ for pre-P0; post-P0 topic step is real LLM with human gate |

**North star:** `understand event → recommend bucket with proof → you approve → write once`

**Not north star:** `more regex → pretend TopicManager assigned it`

**Still open:** unified pipeline, Tag/Relevance LLM agents, semantic duplicate on V3, validator renaming, §12 metrics.

Until those ship, the system is an **editorial queue with real topic LLM + good gates** — not yet the full multi-agent product you designed.
