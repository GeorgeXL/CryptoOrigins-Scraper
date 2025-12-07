# Test Plan: Auto Sorting Button

## Overview
This document outlines the test plan for the "Auto Sorting" button in the Tag Manager component. The button uses AI to automatically categorize tags into the correct taxonomy structure.

## Button Location
- **Component**: `TagManager.tsx`
- **Location**: Quality Check section - "Tags without path" area
- **Button Text**: "Auto Sorting" (previously "Auto Tagging")
- **Variant**: `outline`
- **Size**: `sm` (small)

## Implementation Details

### Frontend (`TagManager.tsx` + `useAutoTagging.ts`)
- **Hook**: `useAutoTagging()` - manages button state
- **State**: `isCategorizing` - tracks loading state
- **Handler**: `startAutoTagging()` - async function
- **API Endpoint**: `POST /api/tags/ai-categorize/start`
- **Toast Notifications**: Success and error messages

### Backend (`server/routes/tags.ts`)
- **Endpoint**: `POST /api/tags/ai-categorize/start`
- **Logic**: 
  - Gets all unique tags from `tags_version2` column
  - Processes tags in background (8 concurrent)
  - Uses `categorizeTagWithContext()` with Gemini
  - Creates/updates tags in database
  - Links tags to analyses
  - Updates usage counts
- **Response**: `{ success: true, total: number, message: string }`

### Taxonomy Service (`server/services/tag-categorizer.ts`)
- **Function**: `categorizeTagWithContext()`
- **Provider**: Gemini (default)
- **Model**: `gemini-2.0-flash`
- **Taxonomy Source**: `getTaxonomyStructure()` - uses `TAXONOMY_TREE` from `shared/taxonomy.ts`
- **Validation**: Zod schema validates category keys and subcategory paths

## Taxonomy Verification ✅

### Test Results
All taxonomy tests passed:
- ✅ **11 main categories** correctly defined
- ✅ **84 subcategories** all valid
- ✅ **Correct geography key**: "markets-geography" (NOT "geography-markets")
- ✅ **No invalid keys** found
- ✅ **All category mappings** correct
- ✅ **All subcategory paths** valid

### Valid Category Keys
1. `bitcoin` - Bitcoin-related
2. `money-economics` - Cryptocurrencies, stablecoins, DeFi tokens
3. `technology` - Blockchain concepts, technical standards
4. `organizations` - Companies, exchanges, institutions
5. `people` - Individuals, government officials
6. `regulation-law` - Regulatory bodies, laws
7. `markets-geography` - ✅ **CORRECT** - Countries, cities, regions
8. `education-community` - Development organizations, forums
9. `crime-security` - Crimes, scams, security
10. `topics` - Themes and topics
11. `miscellaneous` - Uncategorized

### Critical Rules Enforced
- ✅ **"markets-geography"** is the correct key (explicitly checked in prompt)
- ❌ **"geography-markets"** is WRONG (explicitly warned against)
- ✅ People names → `people` category (5.x)
- ✅ Organizations → `organizations` category (4.x)
- ✅ Technical standards → `technology` category (3.5)
- ✅ Countries/cities → `markets-geography` category (7.x)

## Test Cases

### 1. Button Visibility
- [ ] Button only appears when `qualityCheck.tagsWithoutPath.length > 0`
- [ ] Button is hidden when all tags have paths
- [ ] Badge shows correct count of tags without paths

### 2. Button Appearance
- [ ] Button has outline variant styling
- [ ] Button shows OpenAI icon when not loading
- [ ] Button shows Loader2 spinner when `isCategorizing` is true
- [ ] Button text is "Auto Sorting"

### 3. Button Functionality
- [ ] Clicking button calls `startAutoTagging()`
- [ ] Button shows loading state immediately
- [ ] API request is sent to `/api/tags/ai-categorize/start`
- [ ] Success toast appears: "Auto Sorting started"
- [ ] Error toast appears if request fails
- [ ] Button re-enables after completion

### 4. API Endpoint Testing
- [ ] Endpoint returns 200 status on success
- [ ] Endpoint returns correct JSON structure
- [ ] Endpoint prevents duplicate runs (409 if already running)
- [ ] Endpoint processes tags in background
- [ ] Endpoint uses correct taxonomy structure
- [ ] Endpoint validates category keys

### 5. Taxonomy Usage Verification
- [ ] AI prompt includes full taxonomy structure
- [ ] Prompt explicitly uses "markets-geography" (not "geography-markets")
- [ ] Prompt includes categorization rules
- [ ] Zod schema validates category keys
- [ ] System prompt reinforces correct keys
- [ ] All categorized tags use valid category keys
- [ ] All categorized tags use valid subcategory paths

### 6. Data Processing
- [ ] Tags are fetched from `tags_version2` column
- [ ] Each tag gets sample summaries for context
- [ ] Tags are categorized with Gemini AI
- [ ] Tags are created/updated in database
- [ ] Tags are linked to analyses via `pages_and_tags`
- [ ] Usage counts are updated correctly

### 7. Error Handling
- [ ] Network errors show error toast
- [ ] Server errors show error toast
- [ ] Button re-enables after error
- [ ] No data corruption on error
- [ ] Failed tags are logged but don't stop process

## Manual Testing Steps

1. **Start the development server**:
   ```bash
   pnpm dev
   ```

2. **Navigate to Tag Manager**:
   - Open the application in browser
   - Navigate to the Tag Manager page
   - Open Quality Check section

3. **Check for tags without paths**:
   - Look for the "Tags without path" section
   - Verify the badge shows a count > 0
   - Verify the "Auto Sorting" button is visible

4. **Test the button**:
   - Click the "Auto Sorting" button
   - Observe the button shows loading spinner
   - Verify toast: "Auto Sorting started"
   - Check server logs for categorization progress
   - Wait for processing to complete (may take time)

5. **Verify taxonomy usage**:
   - Check server logs for categorization results
   - Verify category keys are valid (especially "markets-geography")
   - Verify no "geography-markets" keys are used
   - Check that tags are properly categorized

6. **Test edge cases**:
   - If no tags without paths exist, verify button is hidden
   - Test with network disconnected (should show error)
   - Test with server stopped (should show error)
   - Test clicking button while already running (should prevent duplicate)

## Code Verification

### ✅ Verified Code Quality
- [x] Button uses proper loading state management
- [x] Error handling is implemented
- [x] Toast notifications provide user feedback
- [x] Taxonomy structure is correctly defined
- [x] AI prompt uses correct taxonomy
- [x] Validation ensures correct category keys
- [x] Background processing doesn't block UI
- [x] Concurrent processing (8 at a time) for efficiency

### ✅ Taxonomy Verification
- [x] All 11 category keys are valid
- [x] "markets-geography" is used (correct)
- [x] "geography-markets" is not used (correct)
- [x] All 84 subcategories are valid
- [x] Category mapping functions work correctly
- [x] AI prompt explicitly enforces correct keys
- [x] System prompt reinforces taxonomy rules

## Expected Behavior

1. **Before Click**:
   - Button shows "Auto Sorting" with OpenAI icon
   - Badge shows count of tags without paths
   - Button is enabled

2. **During Processing**:
   - Button shows loading spinner
   - Button text remains "Auto Sorting"
   - Button is disabled
   - Toast: "Auto Sorting started"
   - Server logs show categorization progress

3. **After Success**:
   - Processing continues in background
   - Tags are categorized and saved
   - Tags without paths count decreases
   - Button re-enables (can be clicked again if more tags appear)

4. **After Error**:
   - Error toast: "Failed to start auto sorting"
   - Button re-enables
   - No data corruption

## Taxonomy Test Results

```
✅ Test 1: Taxonomy Structure
   Found 11 main categories
   Found 84 subcategories

✅ Test 2: Valid Category Keys
   All taxonomy categories are valid: ✅

✅ Test 3: Geography Category Key
   Has "markets-geography": ✅
   Has "geography-markets": ✅ (correctly absent)

✅ Test 4: Subcategory Path Validation
   Valid paths: 84
   Invalid paths: 0

✅ Test 5: Category Key Mapping
   ✅ 7.1 → markets-geography
   ✅ 4.2 -> 4.2.3 → organizations
   ✅ 5.2 → people
   ✅ 3.5 → technology
   ✅ 1.1 → bitcoin
   Passed: 5/5

✅ Test 6: Common Mistakes Check
   ✅ No common mistakes found

✅ Overall: ALL TESTS PASSED
```

## Notes
- The button starts a background process that may take time
- Processing happens asynchronously (8 tags at a time)
- The taxonomy is correctly enforced in the AI prompt
- Category keys are validated against the taxonomy structure
- The correct key "markets-geography" is explicitly enforced
- The wrong key "geography-markets" is explicitly prevented

