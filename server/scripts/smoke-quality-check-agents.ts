/**
 * Smoke test: quality-check bulk agent config + optional live pipeline start per tab.
 *
 * Usage:
 *   npx tsx server/scripts/smoke-quality-check-agents.ts
 *   npx tsx server/scripts/smoke-quality-check-agents.ts --live
 */

import "dotenv/config";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { startEditorialPipelineRun } from "../services/editorial-pipeline/run";
import { storage } from "../storage";
import { historicalNewsAnalyses } from "@shared/schema";
import {
  QUALITY_CHECK_AGENT_TAB_IDS,
  getQualityCheckAgentAction,
  resolveQualityCheckRunWindows,
  type QualityCheckDateInput,
} from "../../shared/quality-check-agent-actions";

function logCheck(label: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "✅" : "❌"} ${label}`, extra ?? "");
  if (!ok) process.exitCode = 1;
}

async function sampleRowForTab(tabId: string): Promise<QualityCheckDateInput | null> {
  const analyses = await storage.getAllAnalyses();
  if (tabId === "empty-summary") {
    const row = analyses.find((a) => !a.summary?.trim());
    return row ? { date: row.date } : { date: "2009-01-03" };
  }
  if (tabId === "untagged") {
    const row = analyses.find((a) => !a.tagsVersion2?.length);
    return row ? { date: row.date } : null;
  }
  if (tabId === "flagged") {
    const [row] = await db
      .select({ date: historicalNewsAnalyses.date })
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.isFlagged, true))
      .limit(1);
    return row ? { date: row.date } : null;
  }
  if (tabId === "missing-months") {
    return { date: "2010-01-01", year: 2010, month: 1 };
  }

  const row = analyses.find((a) => a.summary?.trim());
  return row ? { date: row.date } : { date: "2010-05-22" };
}

async function main() {
  const live = process.argv.includes("--live");
  console.log(`\n=== Quality-check agent smoke (${live ? "live" : "config"}) ===\n`);

  for (const tabId of QUALITY_CHECK_AGENT_TAB_IDS) {
    const action = getQualityCheckAgentAction(tabId);
    logCheck(`${tabId} has action`, !!action, action?.buttonLabel);

    const sample = await sampleRowForTab(tabId);
    logCheck(`${tabId} sample row`, !!sample, sample?.date);
    if (!action || !sample) continue;

    if (action.kind === "remove-periods") {
      logCheck(`${tabId} deterministic kind`, action.kind === "remove-periods");
      if (live) {
        const analysis = await storage.getAnalysisByDate(sample.date);
        if (analysis?.summary?.trim().endsWith(".")) {
          await storage.updateAnalysis(sample.date, { summary: analysis.summary.trim().slice(0, -1) });
          logCheck(`${tabId} live period strip`, true, sample.date);
        } else {
          logCheck(`${tabId} live period strip skipped`, true, "no trailing period on sample");
        }
      }
      continue;
    }

    const windows = resolveQualityCheckRunWindows(tabId, [sample], new Set([sample.date]));
    logCheck(`${tabId} resolves pipeline window`, windows.length > 0, windows[0]);

    if (!live) continue;
    if (!action.checkScopes?.length) {
      logCheck(`${tabId} live pipeline`, false, "missing scopes");
      continue;
    }

    const window = windows[0]!;
    const started = Date.now();
    try {
      const out = await startEditorialPipelineRun({
        dateFrom: window.dateFrom,
        dateTo: window.dateTo,
        maxDaysToConsider: 1,
        requestedBy: "smoke-quality-check-agents",
        checkScopes: action.checkScopes,
      });
      logCheck(`${tabId} live pipeline started`, !!out.runId, `${out.runId} · ${Date.now() - started}ms`);
    } catch (error) {
      logCheck(`${tabId} live pipeline started`, false, error instanceof Error ? error.message : error);
    }
  }

  console.log("\nDone.");
}

main().catch((error) => {
  console.error("Smoke crashed:", error);
  process.exit(1);
});
