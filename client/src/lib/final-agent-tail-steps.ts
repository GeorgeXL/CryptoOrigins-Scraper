import type { LogLine } from "@/lib/pipelineActivityLog";
import { supabase } from "@/lib/supabase";
import { RARITY_LABELS, type Rarity } from "@shared/rarity";

export function googleCheckLabel(happened: "yes" | "no" | "uncertain"): string {
  if (happened === "yes") return "Happened";
  if (happened === "no") return "Didn't happen";
  return "Uncertain";
}

async function loadDaySummary(date: string): Promise<string | null> {
  if (supabase) {
    const { data } = await supabase
      .from("historical_news_analyses")
      .select("summary")
      .eq("date", date)
      .maybeSingle();
    const summary = typeof data?.summary === "string" ? data.summary.trim() : "";
    if (summary) return summary;
  }

  const response = await fetch(`/api/analysis/date/${date}`);
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const summary =
    typeof payload?.analysis?.summary === "string"
      ? payload.analysis.summary
      : typeof payload?.summary === "string"
        ? payload.summary
        : "";
  return summary.trim() || null;
}

export async function runGoogleCheckForDay(opts: {
  date: string;
  topicLeaf?: string | null;
}): Promise<{ happened: "yes" | "no" | "uncertain" }> {
  const summary = await loadDaySummary(opts.date);
  if (!summary) {
    throw new Error("No summary available for Google Check");
  }

  const GOOGLE_CHECK_CLIENT_TIMEOUT_MS = 90_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_CHECK_CLIENT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("/api/analysis/google-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: opts.date,
        summary,
        topicLeaf: opts.topicLeaf ?? null,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Google Check timed out after 90s — the verify API may be retrying a failing provider");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      typeof payload?.error === "string" ? payload.error : response.statusText || "Google Check failed",
    );
  }

  const result = await response.json();
  if (result?.happened !== "yes" && result?.happened !== "no" && result?.happened !== "uncertain") {
    throw new Error("Google Check returned no verdict");
  }
  return { happened: result.happened };
}

export async function assignRarityForDay(
  date: string,
): Promise<{ rarity: Rarity | null; skippedReason?: string }> {
  const response = await fetch("/api/quality-check/bulk-assign-rarity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dates: [date] }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      typeof payload?.error === "string" ? payload.error : response.statusText || "Rarity assignment failed",
    );
  }

  const result = (await response.json()) as {
    total?: number;
    results?: Record<string, { rarity?: string | null; error?: string }>;
  };

  if (!result.total) {
    return {
      rarity: null,
      skippedReason: "day not locked (needs storyline topic + Google Check yes)",
    };
  }

  const row = result.results?.[date];
  const rarity = row?.rarity && row.rarity in RARITY_LABELS ? (row.rarity as Rarity) : null;
  if (rarity) return { rarity };
  throw new Error(row?.error || "no rarity label returned");
}

/** Google Check → rarity with the same step labels as the single-day final agent dialog. */
export async function runFinalAgentTailSteps(opts: {
  date: string;
  topicLeaf?: string | null;
  runId: string;
  onLine: (line: LogLine) => void;
}): Promise<void> {
  const { date, topicLeaf, runId, onLine } = opts;
  const googleLineId = `${runId}-google-check`;
  const rarityLineId = `${runId}-rarity`;

  onLine({ id: googleLineId, text: "Running Google Check…", status: "pending" });

  let googleHappened: "yes" | "no" | "uncertain" | null = null;
  try {
    const result = await runGoogleCheckForDay({ date, topicLeaf });
    googleHappened = result.happened;
    onLine({
      id: googleLineId,
      text: "Google Check complete —",
      emphasis: googleCheckLabel(result.happened),
      status: "approved",
    });
  } catch (error) {
    onLine({
      id: googleLineId,
      text: `Google Check failed — ${error instanceof Error ? error.message : "Google Check failed"}`,
      status: "rejected",
    });
    return;
  }

  if (googleHappened === "yes") {
    onLine({ id: rarityLineId, text: "Assigning rarity…", status: "pending" });
    try {
      const rarityResult = await assignRarityForDay(date);
      if (rarityResult.rarity) {
        onLine({
          id: rarityLineId,
          text: "Rarity assigned —",
          emphasis: RARITY_LABELS[rarityResult.rarity],
          status: "approved",
        });
      } else {
        onLine({
          id: rarityLineId,
          text: `Rarity skipped — ${rarityResult.skippedReason ?? "not eligible"}`,
          status: "review",
        });
      }
    } catch (error) {
      onLine({
        id: rarityLineId,
        text: `Rarity failed — ${error instanceof Error ? error.message : "Rarity assignment failed"}`,
        status: "rejected",
      });
    }
  } else if (googleHappened) {
    onLine({
      id: rarityLineId,
      text: "Rarity skipped — Google Check did not pass",
      status: "review",
    });
  }
}
