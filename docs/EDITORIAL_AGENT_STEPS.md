# Editorial agent pipeline — steps, LLM vs rules

Updated for unified pipeline + Summary/Relevance agents.

---

## Unified routing (`unified-pipeline.ts`)

| Route | Default path | Opt-out |
|-------|--------------|---------|
| `existing_ok` / `existing_needs_correction` | Corpus-clean graph | — |
| `empty_day` / `missing_day` | Exa gated fetch → article pick | `EDITORIAL_LEGACY_EMPTY_PATH=1` |

`EDITORIAL_PIPELINE_V3_GATED_FETCH` is no longer required — gated fetch is **default** for empty/missing days.

---

## LLM agents (production)

| Agent | Module |
|-------|--------|
| Topic Agent | `topic-agent.ts` |
| Tag Agent | `tag-agent.ts` |
| **Summary Agent** | `summary-agent.ts` |
| **Relevance Agent** | `relevance-agent.ts` |
| Date Agent | `date-consistency-llm.ts` |
| Duplicate Agent | `duplicate-agent-llm.ts` + Jaccard rules |

**Disable flags:** `TOPIC_AGENT_DISABLED=1`, `TAG_AGENT_DISABLED=1`, `SUMMARY_AGENT_DISABLED=1`, `RELEVANCE_AGENT_DISABLED=1`, `EDITORIAL_V3_DATE_LLM=0`, `EDITORIAL_DUPLICATE_LLM=0`

---

## Existing-day graph

1. Date check (regex + LLM)
2. Duplicate (Jaccard + semantic LLM)
3. **Relevance Agent** → article pick if off-topic/insufficient
4. Storyline heuristics → article pick if better stored candidate
5. Proposals (Topic + Tag + **Summary** agents + rules)
6. Auto-apply high-confidence topic + safe merges
7. Human queue for remainder

---

## Batch scripts

- `dry-run-corpus-clean.ts` — preview; `--apply` for auto-fixes only
- `queue-topic-corrections.ts` — queue topic fixes
- `corpus-metrics-report.ts` — §12 KPI sample
