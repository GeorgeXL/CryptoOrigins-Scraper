# Agent Test Setup Guide

This guide explains how to test the Autonomous Curator Agent on test data before running it on production.

## Overview

The test setup creates isolated test tables (`test_*`) with known issues, allowing you to:
1. Verify the agent correctly identifies and fixes issues
2. Test all agent modules safely
3. Validate expectations before production runs

## Quick Start

```bash
# Run the complete test suite
pnpm tsx server/scripts/run-agent-test.ts
```

This will:
1. ✅ Create test tables
2. ✅ Populate test data with known issues
3. ✅ Run the agent in test mode
4. ✅ Verify results match expectations

## Manual Steps

### 1. Create Test Tables

```bash
pnpm tsx server/scripts/create-test-tables.ts
```

Creates:
- `test_historical_news_analyses` - News entries
- `test_tags` - Tags
- `test_pages_and_tags` - Tag associations

### 2. Populate Test Data

```bash
pnpm tsx server/scripts/populate-test-data.ts
```

Populates test tables with:
- ✅ **Duplicate entries** (same date, different summaries)
- ✅ **Invalid tags** (non-Bitcoin/Web3 related: "Cooking Recipes", "Weather", etc.)
- ✅ **Low quality summaries** (too short, vague)
- ✅ **Mis-categorized tags** (wrong category assignments)
- ✅ **Timeline gaps** (missing dates)

### 3. Run Agent in Test Mode

```bash
# Via API
curl -X POST http://localhost:3000/api/agent/start \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "testMode": true,
      "useTestTables": true,
      "maxPasses": 2,
      "maxBudgetUSD": 5
    }
  }'
```

Or use the dashboard with test mode enabled.

### 4. Verify Results

```bash
pnpm tsx server/scripts/verify-test-results.ts
```

Checks:
- ✅ Duplicates merged
- ✅ Invalid tags removed
- ✅ Low quality summaries improved
- ✅ Mis-categorized tags fixed
- ✅ Timeline gaps identified

## Test Data Details

### Test News Entries

| Date | Summary | Tags | Issue Type |
|------|---------|------|------------|
| 2024-01-15 | Bitcoin ATH news | Bitcoin, Price, Institutional Adoption | ✅ Good (baseline) |
| 2024-01-20 | Ethereum upgrade | Ethereum, DeFi, Technology | ✅ Good (baseline) |
| 2024-02-01 | Bitcoin price $55k | Bitcoin, Price | ✅ Good |
| 2024-02-01 | BTC reaches $55k | Bitcoin, Price | ❌ **DUPLICATE** |
| 2024-02-10 | Bitcoin transactions | Bitcoin, Technology, **Cooking Recipes**, **Weather** | ❌ **Invalid tags** |
| 2024-02-15 | Exchange listings | Exchange, Altcoins, **Sports News**, **Movie Reviews** | ❌ **Invalid tags** |
| 2024-02-20 | "Bitcoin went up. People are happy." | Bitcoin, Price | ❌ **Low quality** |
| 2024-02-25 | "Crypto stuff happened. It was important." | Cryptocurrency | ❌ **Low quality** |
| 2024-03-01 | Ethereum DeFi news | Ethereum, DeFi, **Bitcoin** (wrong) | ❌ **Mis-categorized** |
| 2024-03-20 | Bitcoin halving | Bitcoin, Mining, Halving | ✅ Good |

**Timeline Gaps:**
- Missing: 2024-03-05, 2024-03-10, 2024-03-15

## Expected Results

After running the agent, you should see:

### ✅ Validator Module
- Removed tags: "Cooking Recipes", "Weather", "Sports News", "Movie Reviews"
- Kept all Bitcoin/Web3 related tags

### ✅ Deduper Module
- Merged duplicate entries for 2024-02-01
- Only 1 entry remains for that date

### ✅ Quality Improver Module
- Improved summaries for 2024-02-20 and 2024-02-25
- Summaries are longer and more detailed

### ✅ Category Fixer Module
- Fixed mis-categorized tags
- Bitcoin tag removed from Ethereum-only entry (2024-03-01)

### ✅ Gap Filler Module
- Identified missing dates: 2024-03-05, 2024-03-10, 2024-03-15
- Either filled gaps or flagged them for review

## Verification Checklist

After running the agent, verify:

- [ ] Duplicate entries merged (only 1 entry for 2024-02-01)
- [ ] Invalid tags removed from database
- [ ] Invalid tag links removed from pages_and_tags
- [ ] Low quality summaries improved (length > 20 chars)
- [ ] Mis-categorized tags fixed
- [ ] Timeline gaps identified or filled
- [ ] Agent session created with `useTestTables: true`
- [ ] No production data affected

## Test vs Production

| Aspect | Test Mode | Production Mode |
|--------|-----------|-----------------|
| Tables | `test_*` prefix | Production tables |
| Data | Small test dataset | Full database |
| Cost | Limited ($5 max) | Full budget |
| Changes | Isolated | Real data |
| Verification | Automated checks | Manual review |

## Troubleshooting

### Test tables not found
```bash
# Recreate test tables
pnpm tsx server/scripts/create-test-tables.ts
```

### Test data missing
```bash
# Repopulate test data
pnpm tsx server/scripts/populate-test-data.ts
```

### Agent not using test tables
Ensure `useTestTables: true` is in the agent config.

### Verification fails
Check the agent logs and verify each module ran successfully. Some modules may need multiple passes.

## Next Steps

Once tests pass:
1. ✅ Review agent decisions in `agent_decisions` table
2. ✅ Check agent audit log for all actions
3. ✅ Verify cost is within budget
4. ✅ Run on production with confidence!

## Files

- `server/scripts/create-test-tables.ts` - Creates test tables
- `server/scripts/populate-test-data.ts` - Populates test data
- `server/scripts/run-agent-test.ts` - Complete test runner
- `server/scripts/verify-test-results.ts` - Verifies results
- `server/services/curator-agent/utils/table-helper.ts` - Table switching helper





