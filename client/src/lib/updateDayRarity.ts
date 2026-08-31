import type { Rarity } from "@shared/rarity";

/** Update a day's collector rarity via the API (Supabase anon RLS cannot update analyses). */
export async function updateDayRarity(date: string, rarity: Rarity | null): Promise<Rarity | null> {
  const res = await fetch(`/api/analysis/date/${encodeURIComponent(date)}/rarity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rarity }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Failed to update rarity");
  }

  return typeof payload.rarity === "string" ? (payload.rarity as Rarity) : null;
}
