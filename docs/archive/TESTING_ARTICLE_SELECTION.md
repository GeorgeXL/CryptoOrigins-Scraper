# Testing Article Selection Dialog

This guide explains how to test all three scenarios of the article selection flow.

## Scenarios

1. **Single Match (Auto-Continue)**: When exactly 1 article matches between Gemini and Perplexity
   - ✅ Should auto-continue with summarization
   - ✅ VeriBadge: `Verified`
   - ✅ No dialog shown

2. **Multiple Matches (User Selection)**: When >1 articles match
   - ✅ Should show dialog with intersection articles
   - ✅ OpenAI's suggestion highlighted with yellow border
   - ✅ User can confirm OpenAI's choice or select different
   - ✅ VeriBadge: `Verified`

3. **No Matches (Orphan)**: When 0 articles match
   - ✅ Should show dialog with ALL articles from all tiers
   - ✅ User must manually select one article
   - ✅ VeriBadge: `Orphan`

## Testing Methods

### Method 1: Via Frontend (Recommended)

1. **Start the server** (if not running):
   ```bash
   npm run dev
   ```

2. **Open the frontend**: http://localhost:3000

3. **Navigate to a date**:
   - Go to `/day/YYYY-MM-DD` (e.g., `/day/2024-01-15`)

4. **Click "Analyse Day"** from the dropdown menu

5. **Observe the behavior**:
   - If single match: Analysis completes automatically, VeriBadge shows "Verified"
   - If multiple matches: Dialog appears with matching articles, OpenAI's choice highlighted
   - If no matches: Dialog appears with all articles, VeriBadge shows "Orphan"

6. **Test the dialog** (if shown):
   - Browse articles by tier (Bitcoin/Crypto/Macro tabs)
   - Select an article (click on it)
   - Click "Confirm Selection"
   - Wait for summary generation
   - Verify VeriBadge is set correctly

### Method 2: Via Test Script

Run the test script to see which scenario occurs for a specific date:

```bash
# Test a specific date
npx tsx server/scripts/test-article-selection.ts 2024-01-15
```

The script will:
- Run the analysis
- Show which scenario occurred
- Display statistics (Gemini/Perplexity selections, intersection, etc.)
- Provide next steps

### Method 3: Direct API Testing

#### Test 1: Trigger Analysis
```bash
curl -X POST http://localhost:3000/api/analysis/date/2024-01-15 \
  -H "Content-Type: application/json" \
  -d '{
    "forceReanalysis": true,
    "aiProvider": "openai"
  }'
```

**Expected Response (if selection needed):**
```json
{
  "requiresSelection": true,
  "selectionMode": "multiple" | "orphan",
  "tieredArticles": { "bitcoin": [...], "crypto": [...], "macro": [...] },
  "geminiSelectedIds": [...],
  "perplexitySelectedIds": [...],
  "intersectionIds": [...],
  "openaiSuggestedId": "..."
}
```

#### Test 2: Confirm Selection
```bash
curl -X POST http://localhost:3000/api/analysis/date/2024-01-15/confirm-selection \
  -H "Content-Type: application/json" \
  -d '{
    "articleId": "article-id-here",
    "selectionMode": "multiple"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "summary": "...",
  "topArticleId": "...",
  "winningTier": "bitcoin",
  "isOrphan": false,
  "veriBadge": "Verified"
}
```

## Test Cases

### Test Case 1: Single Match
**Goal**: Verify auto-continue works

1. Find a date with exactly 1 matching article
2. Run analysis
3. ✅ Should complete without dialog
4. ✅ VeriBadge should be "Verified"
5. ✅ Summary should be generated

### Test Case 2: Multiple Matches
**Goal**: Verify dialog shows with OpenAI suggestion

1. Find a date with multiple matching articles
2. Run analysis
3. ✅ Dialog should appear
4. ✅ Only intersection articles shown
5. ✅ OpenAI's suggestion has yellow border
6. ✅ User can select different article
7. ✅ Confirm button works
8. ✅ VeriBadge should be "Verified"

### Test Case 3: No Matches (Orphan)
**Goal**: Verify orphan mode works

1. Find a date with no matching articles
2. Run analysis
3. ✅ Dialog should appear
4. ✅ ALL articles from all tiers shown
5. ✅ User can select any article
6. ✅ Confirm button works
7. ✅ VeriBadge should be "Orphan"

### Test Case 4: Dialog UI
**Goal**: Verify dialog UI elements

1. Open dialog (any mode)
2. ✅ Dark theme applied
3. ✅ Tabs work (Bitcoin/Crypto/Macro)
4. ✅ Badges show correctly (Gemini/Perplexity/Both Agreed/OpenAI Suggested)
5. ✅ Article selection works (click to select)
6. ✅ Selected article has green border
7. ✅ External link works
8. ✅ Cancel button closes dialog
9. ✅ Confirm button disabled when no selection

## Finding Test Dates

To find dates that trigger different scenarios, you can:

1. **Check existing analyses** in the database for dates with:
   - `is_orphan = true` → Likely orphan scenario
   - `perplexity_approved = true AND gemini_approved = true` → Likely verified scenario

2. **Use the test script** on different dates to see which scenario occurs

3. **Check logs** when running analysis to see intersection counts

## Troubleshooting

### Dialog doesn't appear
- Check browser console for errors
- Verify API response has `requiresSelection: true`
- Check that `selectionData` state is set correctly

### Selection doesn't work
- Check network tab for API calls
- Verify `/api/analysis/date/:date/confirm-selection` endpoint
- Check server logs for errors

### VeriBadge not updating
- Verify database trigger is working
- Check that `isOrphan`, `geminiApproved`, `perplexityApproved` are set correctly
- Run migration if needed: `supabase migration up`

## Expected Behavior Summary

| Scenario | Intersection | Dialog? | VeriBadge | Auto-Continue? |
|----------|-------------|---------|-----------|----------------|
| Single Match | = 1 | ❌ No | Verified | ✅ Yes |
| Multiple Matches | > 1 | ✅ Yes | Verified | ❌ No (user selects) |
| No Matches | = 0 | ✅ Yes | Orphan | ❌ No (user selects) |

