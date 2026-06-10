export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeOptionalSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function readCanonicalSourceUrl(row: Record<string, unknown>): string | undefined {
  return normalizeOptionalSourceUrl(row.sourceUrl ?? row.source_url);
}
