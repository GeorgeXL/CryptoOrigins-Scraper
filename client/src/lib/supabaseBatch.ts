import { supabase } from "@/lib/supabase";

const DEFAULT_BATCH_SIZE = 1000;

type OrderSpec = { column: string; ascending?: boolean };

/**
 * Fetch all rows from a Supabase table, working around the default 1,000-row cap.
 */
export async function fetchAllSupabaseRows<T>(
  table: string,
  select: string,
  opts?: { batchSize?: number; orderBy?: OrderSpec },
): Promise<T[]> {
  if (!supabase) return [];

  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  const all: T[] = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select(select).range(from, from + batchSize - 1);
    if (opts?.orderBy) {
      query = query.order(opts.orderBy.column, { ascending: opts.orderBy.ascending ?? true });
    }

    const { data, error } = await query;
    if (error) {
      console.warn(`[fetchAllSupabaseRows] ${table}:`, error.message);
      break;
    }

    const batch = (data ?? []) as T[];
    if (batch.length === 0) break;

    all.push(...batch);
    if (batch.length < batchSize) break;
    from += batchSize;
  }

  return all;
}
