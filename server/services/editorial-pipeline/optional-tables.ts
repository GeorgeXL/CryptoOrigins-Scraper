/**
 * Production DB may omit legacy tables (manual_news_entries, canonical_milestones).
 * Soft-skip those queries so the editorial pipeline can still run.
 */

export function isMissingRelationError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  const code = e?.code;
  const message =
    typeof e?.message === "string"
      ? e.message
      : error instanceof Error
        ? error.message
        : String(error);
  return code === "42P01" || /relation ["'].+["'] does not exist/i.test(message);
}

export async function queryIfRelationExists<T>(
  query: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await query();
  } catch (error) {
    if (isMissingRelationError(error)) return fallback;
    throw error;
  }
}
