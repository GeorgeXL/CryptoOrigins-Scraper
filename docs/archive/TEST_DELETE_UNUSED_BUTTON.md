# Test Plan: Delete Unused Tags Button

## Overview
This document outlines the test plan for the "Delete Unused" button in the Tag Manager component.

## Button Location
- **Component**: `TagManager.tsx`
- **Location**: Quality Check section - "Unused tags" area
- **Button Text**: "Delete Unused"
- **Variant**: `destructive` (red background with white text)
- **Size**: `sm` (small)

## Implementation Details

### Frontend (`TagManager.tsx`)
- **State**: `isDeletingUnused` - tracks loading state
- **Handler**: `handleDeleteUnusedTags()` - async function
- **API Endpoint**: `POST /api/tags/delete-unused`
- **Toast Notifications**: Success and error messages
- **Data Refresh**: Invalidates React Query cache after deletion

### Backend (`server/routes/tags.ts`)
- **Endpoint**: `POST /api/tags/delete-unused`
- **Logic**: Deletes all tags where `usage_count = 0`
- **Response**: `{ success: true, deletedCount: number, message: string }`
- **Cache Invalidation**: Clears multiple tag-related caches

## Test Cases

### 1. Button Visibility
- [ ] Button only appears when `qualityCheck.unusedTags.length > 0`
- [ ] Button is hidden when there are no unused tags
- [ ] Badge shows correct count of unused tags

### 2. Button Appearance
- [ ] Button has red background (`variant="destructive"`)
- [ ] Button text is white (verified in `button.tsx`)
- [ ] Button shows Trash icon when not loading
- [ ] Button shows Loader2 spinner when `isDeletingUnused` is true
- [ ] Button is disabled during deletion (`disabled={isDeletingUnused}`)

### 3. Button Functionality
- [ ] Clicking button calls `handleDeleteUnusedTags()`
- [ ] Button is disabled immediately on click
- [ ] Loading spinner appears during deletion
- [ ] API request is sent to `/api/tags/delete-unused`
- [ ] Success toast appears with correct deleted count
- [ ] Error toast appears if deletion fails
- [ ] Button re-enables after completion (success or error)

### 4. API Endpoint Testing
- [ ] Endpoint returns 200 status on success
- [ ] Endpoint returns correct JSON structure
- [ ] Endpoint handles case when no unused tags exist (returns deletedCount: 0)
- [ ] Endpoint actually deletes tags with `usage_count = 0`
- [ ] Endpoint invalidates caches correctly

### 5. Data Refresh
- [ ] Tag list refreshes after successful deletion
- [ ] Quality check data refreshes after deletion
- [ ] Unused tags count updates to 0 after deletion
- [ ] Button disappears after all unused tags are deleted

### 6. Error Handling
- [ ] Network errors show error toast
- [ ] Server errors show error toast
- [ ] Button re-enables after error
- [ ] No data is lost on error

## Manual Testing Steps

1. **Start the development server**:
   ```bash
   pnpm dev
   ```

2. **Navigate to Tag Manager**:
   - Open the application in browser
   - Navigate to the Tag Manager page

3. **Check for unused tags**:
   - Look for the "Unused tags" section in Quality Check
   - Verify the badge shows a count > 0
   - Verify the "Delete Unused" button is visible

4. **Test the button**:
   - Click the "Delete Unused" button
   - Observe the button shows loading spinner
   - Wait for the operation to complete
   - Verify success toast appears with correct count
   - Verify unused tags list is now empty
   - Verify button disappears

5. **Test edge cases**:
   - If no unused tags exist, verify button is hidden
   - Test with network disconnected (should show error)
   - Test with server stopped (should show error)

## Code Verification

### ✅ Verified Code Quality
- [x] Button uses proper loading state management
- [x] Error handling is implemented
- [x] Toast notifications provide user feedback
- [x] Cache invalidation ensures data freshness
- [x] Button styling uses white text on red background
- [x] Button is properly disabled during operation

## Expected Behavior

1. **Before Click**:
   - Button shows "Delete Unused" with Trash icon
   - Badge shows count of unused tags
   - Button is enabled

2. **During Deletion**:
   - Button shows loading spinner
   - Button text remains "Delete Unused"
   - Button is disabled
   - No other UI changes

3. **After Success**:
   - Success toast: "Unused tags deleted" with count
   - Unused tags list is empty
   - Badge count is 0
   - Button disappears
   - Tag list refreshes

4. **After Error**:
   - Error toast: "Failed to delete unused tags"
   - Button re-enables
   - Unused tags remain unchanged
   - No data loss

## Notes
- The button only appears when there are unused tags to delete
- The deletion is permanent and cannot be undone
- The operation deletes all tags with `usage_count = 0`
- Cache invalidation ensures UI stays in sync with database

