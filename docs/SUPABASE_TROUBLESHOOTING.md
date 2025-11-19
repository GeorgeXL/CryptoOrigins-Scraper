# Supabase Connection & Query Troubleshooting Guide

This document outlines common issues encountered when connecting to Supabase from the frontend and how to resolve them.

---

## Table of Contents
1. [Environment Variables Setup](#environment-variables-setup)
2. [Common Query Issues](#common-query-issues)
3. [Row Limit & Batching](#row-limit--batching)
4. [Column Name Mismatches](#column-name-mismatches)
5. [JSONB Array Filtering](#jsonb-array-filtering)
6. [Client-Side vs Server-Side Filtering](#client-side-vs-server-side-filtering)
7. [Best Practices](#best-practices)

---

## 1. Environment Variables Setup

### Issue
Frontend components couldn't connect to Supabase because environment variables weren't properly configured.

### Solution
Create a shared Supabase client utility at `client/src/lib/supabase.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";

const env = import.meta.env as Record<string, string | undefined>;

const supabaseUrl =
  env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  env.VITE_SUPABASE_ANON_KEY ??
  env.SUPABASE_ANON_KEY ??
  env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
      })
    : null;
```

### Key Points
- **Vite requires `VITE_` prefix** for environment variables to be exposed to the client
- Fallback to non-prefixed names (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) for flexibility
- Always check if `supabase` is `null` before using it
- Use `persistSession: false` for stateless queries (no authentication needed)

### Environment File Location
- For Vite projects, create `client/.env` (NOT root `.env`)
- Required variables:
  ```
  VITE_SUPABASE_URL=https://your-project.supabase.co
  VITE_SUPABASE_ANON_KEY=your-anon-key-here
  ```

---

## 2. Common Query Issues

### Issue: "Column does not exist" Error

**Example Error:**
```
column historical_news_analyses.tier does not exist
```

### Root Cause
The query was trying to select columns that don't exist in the database schema.

### Solution
Always verify column names match the actual database schema:

```typescript
// ❌ WRONG - Using non-existent columns
.select("date, summary, tags, tier, url, source_url")

// ✅ CORRECT - Using actual column names
.select("date, summary, tags, tier_used, is_manual_override")
```

### How to Check Column Names
Use the Supabase MCP tool or SQL query:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'your_table_name' 
ORDER BY ordinal_position;
```

---

## 3. Row Limit & Batching

### Issue
Supabase has a **default limit of 1,000 rows** per query. If you have more data, only the first 1,000 rows are returned.

### Symptoms
- Incomplete data in the UI
- Missing records
- Counters showing lower numbers than expected

### Solution: Batch Fetching
Fetch data in batches of 1,000 rows at a time:

```typescript
// Fetch all data in batches
let allAnalyses: any[] = [];
let batchStart = 0;
const batchSize = 1000;
let hasMore = true;

while (hasMore) {
  const { data: batch, error } = await supabase
    .from("historical_news_analyses")
    .select("tags, date")
    .range(batchStart, batchStart + batchSize - 1);

  if (error) throw error;

  if (batch && batch.length > 0) {
    allAnalyses = allAnalyses.concat(batch);
    batchStart += batchSize;
    hasMore = batch.length === batchSize;
  } else {
    hasMore = false;
  }
}

console.log(`✅ Fetched ${allAnalyses.length} total records in batches`);
```

### Key Points
- Use `.range(from, to)` to specify the range of rows to fetch
- `from` is inclusive, `to` is inclusive (0-based indexing)
- Continue fetching until `batch.length < batchSize`
- This is essential for catalog/statistics queries that need ALL data

---

## 4. Column Name Mismatches

### Common Mismatches in Our Schema

| ❌ Wrong Name | ✅ Correct Name |
|--------------|----------------|
| `tier` | `tier_used` |
| `url` | (doesn't exist) |
| `source_url` | (doesn't exist) |
| `manual` | `is_manual_override` |

### Prevention
1. Always check the database schema before writing queries
2. Use TypeScript types to catch mismatches at compile time
3. Test queries with small datasets first

---

## 5. JSONB Array Filtering

### Issue
Filtering JSONB arrays (like `tags`) is complex in Supabase/PostgREST.

### Problem Example
Trying to filter for empty arrays or null values:

```typescript
// ❌ DOESN'T WORK - Supabase doesn't support this syntax well
query.or("tags.is.null,tags.eq.[]")
```

### Solution: Client-Side Filtering
For complex JSONB queries, fetch all data and filter on the client:

```typescript
// 1. Fetch all data (or use batching if > 1000 rows)
const { data: analyses, error } = await supabase
  .from("historical_news_analyses")
  .select("date, summary, tags")
  .order("date", { ascending: false });

if (error) throw error;

// 2. Filter client-side
const untaggedAnalyses = analyses.filter(analysis => 
  !analysis.tags || analysis.tags.length === 0
);

// 3. Apply pagination after filtering
const paginatedResults = untaggedAnalyses.slice(
  (currentPage - 1) * pageSize,
  currentPage * pageSize
);
```

### When to Use Client-Side Filtering
- ✅ Filtering by JSONB array contents
- ✅ Complex multi-condition filters
- ✅ When total dataset is < 10,000 rows
- ❌ When dataset is very large (> 50,000 rows) - use server-side filtering or indexing

### Server-Side JSONB Filtering (When Possible)
For simple JSONB queries, you can use PostgREST operators:

```typescript
// Check if JSONB array contains a specific object
query.contains("tags", [{ category: "Cryptocurrency", name: "Bitcoin" }])

// Check if JSONB is null
query.is("tags", null)
```

**Note:** Complex `OR` conditions with JSONB arrays are not well-supported. Use client-side filtering instead.

---

## 6. Client-Side vs Server-Side Filtering

### Decision Matrix

| Scenario | Approach | Reason |
|----------|----------|--------|
| Simple equality filters | Server-side | Faster, less data transfer |
| Text search | Server-side | Use `.ilike()` or `.textSearch()` |
| JSONB array filtering | Client-side | Limited PostgREST support |
| Multiple OR conditions | Client-side | Complex query syntax |
| Dataset < 10K rows | Client-side OK | Manageable in memory |
| Dataset > 50K rows | Server-side required | Too much data to fetch |

### Example: Mixed Approach

```typescript
// 1. Apply simple filters server-side
let query = supabase
  .from("historical_news_analyses")
  .select("*")
  .gte("date", "2024-01-01")  // Server-side date filter
  .order("date", { ascending: false });

// 2. Fetch data (with batching if needed)
const { data, error } = await query;

// 3. Apply complex filters client-side
const filtered = data.filter(item => {
  // Complex JSONB logic
  const hasBitcoinTag = item.tags?.some(tag => 
    tag.category === "Cryptocurrency" && tag.name === "Bitcoin"
  );
  return hasBitcoinTag;
});

// 4. Paginate after filtering
const paginated = filtered.slice(
  (page - 1) * pageSize,
  page * pageSize
);
```

---

## 7. Best Practices

### ✅ DO

1. **Always check if supabase client is initialized**
   ```typescript
   if (!supabase) throw new Error("Supabase not configured");
   ```

2. **Use batching for large datasets**
   ```typescript
   // Fetch in batches of 1,000
   .range(batchStart, batchStart + 999)
   ```

3. **Handle errors gracefully**
   ```typescript
   const { data, error } = await supabase.from("table").select("*");
   if (error) {
     console.error("Query failed:", error.message);
     throw error;
   }
   ```

4. **Use exact column names from schema**
   ```typescript
   // Verify with: SELECT column_name FROM information_schema.columns
   .select("date, summary, tier_used")
   ```

5. **Add console logging for debugging**
   ```typescript
   console.log("📊 Query result:", {
     count: data?.length,
     firstItem: data?.[0]
   });
   ```

6. **Use TypeScript types**
   ```typescript
   interface Analysis {
     date: string;
     summary: string;
     tags: Array<{ category: string; name: string }>;
   }
   
   const { data } = await supabase
     .from("historical_news_analyses")
     .select("*")
     .returns<Analysis[]>();
   ```

### ❌ DON'T

1. **Don't assume column names**
   - Always verify against the actual schema

2. **Don't forget the row limit**
   - Supabase limits to 1,000 rows by default
   - Use batching or `.range()` for more data

3. **Don't use complex JSONB filters server-side**
   - PostgREST has limited JSONB support
   - Use client-side filtering instead

4. **Don't fetch unnecessary columns**
   ```typescript
   // ❌ BAD - Fetches all columns
   .select("*")
   
   // ✅ GOOD - Only fetch what you need
   .select("date, summary, tags")
   ```

5. **Don't ignore error handling**
   ```typescript
   // ❌ BAD
   const { data } = await supabase.from("table").select("*");
   
   // ✅ GOOD
   const { data, error } = await supabase.from("table").select("*");
   if (error) throw error;
   ```

---

## Common Error Messages & Solutions

### Error: "Supabase not configured"
**Solution:** Check environment variables in `client/.env`

### Error: "column X does not exist"
**Solution:** Verify column name against database schema

### Error: "Failed to fetch" or network error
**Solution:** Check Supabase URL and anon key are correct

### Error: Data incomplete (only 1,000 rows)
**Solution:** Implement batching with `.range()`

### Error: "Invalid query" with JSONB filters
**Solution:** Use client-side filtering instead

---

## Quick Reference: Supabase Query Syntax

```typescript
// Basic select
.select("column1, column2")

// Filter
.eq("column", "value")          // Equal
.neq("column", "value")         // Not equal
.gt("column", value)            // Greater than
.gte("column", value)           // Greater than or equal
.lt("column", value)            // Less than
.lte("column", value)           // Less than or equal
.like("column", "%pattern%")    // SQL LIKE
.ilike("column", "%pattern%")   // Case-insensitive LIKE
.is("column", null)             // IS NULL
.in("column", [val1, val2])     // IN array

// Ordering
.order("column", { ascending: false })

// Pagination
.range(from, to)                // Rows from index 'from' to 'to' (inclusive)
.limit(count)                   // Limit to 'count' rows

// Count
.select("*", { count: "exact" })  // Get total count
.select("*", { count: "exact", head: true })  // Count only, no data

// OR conditions
.or("column1.eq.value1,column2.eq.value2")

// JSONB operations
.contains("jsonb_column", { key: "value" })
.containedBy("jsonb_column", { key: "value" })
```

---

## Testing Checklist

When implementing a new Supabase query:

- [ ] Verify column names exist in the database schema
- [ ] Test with a small dataset first (`.limit(10)`)
- [ ] Check if data > 1,000 rows (implement batching if needed)
- [ ] Add error handling (`if (error) throw error`)
- [ ] Add console logging for debugging
- [ ] Test with empty results
- [ ] Test with null values
- [ ] Verify pagination works correctly
- [ ] Check performance (should be < 2 seconds for most queries)

---

## Additional Resources

- [Supabase JavaScript Client Docs](https://supabase.com/docs/reference/javascript/introduction)
- [PostgREST API Reference](https://postgrest.org/en/stable/api.html)
- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)

---

**Last Updated:** November 19, 2024  
**Maintained by:** CryptoOrigins Development Team

