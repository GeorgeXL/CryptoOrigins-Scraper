# Autonomous Curator Agent - Quick Start Guide

## ⚡ 5-Minute Setup

### Step 1: Apply Database Migration

```bash
# Navigate to your project
cd "/Users/jiriczolko/Desktop/CryptoOrigins - News Scraper"

# Apply the migration (creates agent tables)
# Option A: Using MCP Supabase (if configured)
# Use the MCP tool to apply: supabase/migrations/20251129000000_create_agent_tables.sql

# Option B: Manual SQL (copy contents of migration file and run in Supabase SQL editor)
```

### Step 2: Install Dependencies (if needed)

```bash
pnpm install commander date-fns
# or
npm install commander date-fns
```

### Step 3: Test It!

Run in test mode to verify everything works:

```bash
npx tsx server/scripts/auto-curator.ts test --limit 10
```

Expected output:
```
🚀 Starting Autonomous Curator Agent...

╔══════════════════════════════════════════╗
║  🤖 AUTONOMOUS CURATOR AGENT            ║
╚══════════════════════════════════════════╝

Session ID: abc-123-def-456
Start Time: 2025-11-29T...

🧪 TEST MODE: Skipping full verification

┌────────────────────────────────────────┐
│  MULTI-PASS CLEANUP LOOP               │
└────────────────────────────────────────┘

╔═══════════════════════════════════════╗
║  PASS 1/2                            ║
╚═══════════════════════════════════════╝

🔍 Scanning database for issues...
...
```

### Step 4: Run Full Verification (Optional but Recommended)

Verify all 6,000 news articles:

```bash
npx tsx server/scripts/auto-curator.ts verify-only
```

This will:
- Take ~30-45 minutes
- Cost ~$21
- Give you a comprehensive report of data quality

### Step 5: Run Full Agent (When Ready)

```bash
npx tsx server/scripts/auto-curator.ts run
```

That's it! The agent will:
1. ✅ Verify all 6,000 news with dual AI
2. ✅ Find and merge duplicates (even years apart)
3. ✅ Fill timeline gaps with significant events
4. ✅ Stop automatically when quality ≥95% or converged

## 📊 Monitor Progress

Watch the terminal output for:
- Current pass number
- Issues found/fixed
- Cost tracking
- Quality score
- ETAs

Press **Ctrl+C** anytime to stop safely. Use `resume <session-id>` to continue later.

## 🎯 What Happens?

### Phase 0: Verification (~30-45 min, ~$21)
- Gemini + Perplexity verify each news entry
- Both must agree for "verified" status
- Disagreements flagged for review
- Report shows: verified/flagged/rejected counts

### Multi-Pass Loop (~1-3 hours, ~$7-11)
- **Pass 1**: Scan for duplicates
- **Pass 2**: Merge duplicates → creates gaps
- **Pass 3**: Fill gaps with competitive AI search
- **Pass 4+**: Additional cleanup passes if needed
- Stops when quality ≥95% OR no more improvements

### Safety Features
- Auto-checkpoint every 60 seconds
- Human intervention every 3 passes
- Hard limits on passes/runtime/budget
- Convergence detection
- Stuck detection

## 🆘 Troubleshooting

### "No AI providers available"
Check your `.env` file has API keys:
```
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
PERPLEXITY_API_KEY=...
```

### "Migration not found"
Apply the migration first:
```sql
-- Copy contents of:
-- supabase/migrations/20251129000000_create_agent_tables.sql
-- Run in Supabase SQL editor
```

### "Agent stuck"
- Check logs for specific error
- Try test mode first: `test --limit 10`
- Resume from checkpoint if interrupted

### Want to see code?
All agent code is in:
- `server/services/curator-agent/` - Core system
- `server/scripts/auto-curator.ts` - CLI

## 📚 Full Documentation

See `AGENT_README.md` for complete details, architecture, and advanced usage.

---

**You're all set! Start with test mode, then run full verification, then full agent run.** 🚀





