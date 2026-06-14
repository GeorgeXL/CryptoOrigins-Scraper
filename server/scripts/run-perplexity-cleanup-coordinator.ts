/**
 * Coordinator for parallel per-leaf Perplexity cleanup workers.
 *
 * Polls the DB every 60s for leaves where bulk finished (unchecked=0) and still
 * have no/uncertain backlog. Spawns two dedicated workers per leaf (each half
 * of flagged dates). Does not respawn while that worker PID is running.
 *
 * Usage:
 *   npx tsx server/scripts/run-perplexity-cleanup-coordinator.ts
 *   npx tsx server/scripts/run-perplexity-cleanup-coordinator.ts --poll-ms 60000 --apply
 */

import "dotenv/config";
import dotenv from "dotenv";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: path.resolve("client/.env") });

import {
  COORDINATOR_LOG_FILE,
  MAX_CONCURRENT_LEAF_WORKERS,
  WORKERS_PER_LEAF,
  collectPendingLeafWorkers,
  countRunningLeafWorkers,
  createFileLogger,
  ensureBatchDir,
  isLeafWorkerRunning,
  isProcessRunning,
  leafCleanupAgentLabel,
  leafDisplayName,
  leafWorkerKey,
  loadCoordinatorState,
  loadLeafState,
  loadWorkerState,
  prioritizePendingLeafWorkers,
  queryCompletedLeavesWithBacklog,
  saveCoordinatorState,
  shouldPauseCoordinatorCleanup,
  sleep,
  workerAgentLabel,
  workerLogFile,
  type CoordinatorSpawnRecord,
  type CoordinatorState,
  type PendingLeafWorker,
} from "./perplexity-cleanup-shared";

const PROJECT_ROOT = path.resolve(".");
const LEAF_SCRIPT = path.join(PROJECT_ROOT, "server/scripts/run-perplexity-cleanup-leaf.ts");
const POLL_MS_DEFAULT = 60_000;

type Args = {
  pollMs: number;
  apply: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const pollIdx = argv.indexOf("--poll-ms");
  const pollRaw = pollIdx >= 0 ? argv[pollIdx + 1] : undefined;
  const pollMs = pollRaw != null ? Number(pollRaw) : POLL_MS_DEFAULT;
  return {
    pollMs: Number.isFinite(pollMs) && pollMs > 0 ? pollMs : POLL_MS_DEFAULT,
    apply: !argv.includes("--dry-run"),
  };
}

function spawnLeafWorker(
  item: PendingLeafWorker,
  apply: boolean,
): { pid: number } {
  ensureBatchDir();
  const { leaf, workerIndex, workerTotal } = item;
  const label = workerAgentLabel(leaf, workerIndex, workerTotal);
  fs.appendFileSync(
    workerLogFile(leaf, workerIndex),
    `\n--- coordinator spawn ${label} ${new Date().toISOString()} ---\n`,
  );

  const tsxBin = path.join(PROJECT_ROOT, "node_modules/.bin/tsx");
  const runner = fs.existsSync(tsxBin) ? tsxBin : "npx";
  const sharedArgs = [
    "--leaf",
    leaf,
    "--worker-index",
    String(workerIndex),
    "--worker-total",
    String(workerTotal),
    ...(apply ? ["--apply"] : []),
  ];
  const args = runner === tsxBin ? [LEAF_SCRIPT, ...sharedArgs] : ["tsx", LEAF_SCRIPT, ...sharedArgs];

  const child = spawn(runner, args, {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PERPLEXITY_SCRIPT: "1",
      PERPLEXITY_SCRIPT_POOL_SIZE: process.env.PERPLEXITY_SCRIPT_POOL_SIZE ?? "1",
      CLEANUP_LEAF: leafDisplayName(leaf),
      CLEANUP_WORKER: `${workerIndex}/${workerTotal}`,
    },
  });

  child.unref();

  if (!child.pid) {
    throw new Error(`Failed to spawn ${label}`);
  }

  return { pid: child.pid };
}

function workerLabel(record: CoordinatorSpawnRecord): string {
  if (record.workerIndex && record.workerTotal) {
    return workerAgentLabel(record.leaf, record.workerIndex, record.workerTotal);
  }
  return leafCleanupAgentLabel(record.leaf);
}

function loadSpawnRecordState(record: CoordinatorSpawnRecord) {
  if (record.workerIndex != null) {
    return loadWorkerState(record.leaf, record.workerIndex);
  }
  return loadLeafState(record.leaf);
}

function refreshRunningLeaves(state: CoordinatorState, logger: { log: (msg: string) => void }): void {
  for (const [key, record] of Object.entries(state.spawnedLeaves)) {
    if (record.status !== "running") continue;

    const leafState = loadSpawnRecordState(record);
    if (leafState.status === "completed" || leafState.status === "failed") {
      record.status = leafState.status;
      record.completedAt = leafState.finishedAt ?? new Date().toISOString();
      logger.log(
        `WORKER EXIT ${workerLabel(record)} pid=${leafState.pid ?? record.pid} key=${key}`,
      );
      continue;
    }

    const alive =
      leafState.status === "running" && isProcessRunning(leafState.pid ?? record.pid);

    if (alive || isLeafWorkerRunning(record.leaf, record.workerIndex)) continue;

    record.status = "failed";
    record.completedAt = new Date().toISOString();
    logger.log(
      `WORKER EXIT ${workerLabel(record)} pid=${leafState.pid ?? record.pid} key=${key}`,
    );
  }
}

async function spawnWorkersForBacklog(
  state: CoordinatorState,
  apply: boolean,
  logger: { log: (msg: string) => void },
): Promise<number> {
  if (shouldPauseCoordinatorCleanup()) {
    logger.log("PAUSE cleanup paused (PAUSE_CLEANUP/TRIPLE_PASS_MODE or orchestrator triple-pass active)");
    return 0;
  }

  refreshRunningLeaves(state, logger);

  let pending: Awaited<ReturnType<typeof collectPendingLeafWorkers>>;
  try {
    pending = await collectPendingLeafWorkers(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.log(`ERROR collectPendingLeafWorkers: ${message}`);
    throw error;
  }

  let spawned = 0;
  const runningBefore = countRunningLeafWorkers(state);
  const toSpawn = prioritizePendingLeafWorkers(pending, runningBefore);

  if (toSpawn.length === 0 && pending.length > 0) {
    logger.log(
      `CAP at_capacity active=${runningBefore} max=${MAX_CONCURRENT_LEAF_WORKERS} pending_workers=${pending.length} (waiting for slots; highest-backlog leaves first)`,
    );
  }

  for (const item of toSpawn) {
    if (isLeafWorkerRunning(item.leaf, item.workerIndex)) continue;

    const key = leafWorkerKey(item.leaf, item.workerIndex);
    const { pid } = spawnLeafWorker(item, apply);
    const record: CoordinatorSpawnRecord = {
      leaf: item.leaf,
      slug: key,
      pid,
      spawnedAt: new Date().toISOString(),
      backlogAtSpawn: { uncertain: item.uncertain, no: item.no, total: item.total },
      status: "running",
      workerIndex: item.workerIndex,
      workerTotal: item.workerTotal,
    };

    state.spawnedLeaves[key] = record;
    spawned += 1;

    logger.log(
      `SPAWN ${workerAgentLabel(item.leaf, item.workerIndex, item.workerTotal)} pid=${pid} backlog=${item.total} (uncertain=${item.uncertain} no=${item.no})`,
    );
  }

  saveCoordinatorState(state);

  return spawned;
}

async function main() {
  const args = parseArgs();
  try {
    process.title = "cleanup-coordinator";
  } catch {
    // ignore
  }
  const logger = createFileLogger(COORDINATOR_LOG_FILE);
  const state = loadCoordinatorState();
  state.mode = "per-leaf";
  // Drop stale single-worker spawn records from prior coordinator runs.
  state.spawnedLeaves = Object.fromEntries(
    Object.entries(state.spawnedLeaves ?? {}).filter(([, record]) => {
      if (record.workerIndex == null) return false;
      return record.status === "running" && isLeafWorkerRunning(record.leaf, record.workerIndex);
    }),
  );

  logger.log(`=== Perplexity cleanup coordinator started (${WORKERS_PER_LEAF} worker per leaf) ===`);
  logger.log(
    `Poll interval: ${args.pollMs}ms · mode: ${args.apply ? "apply" : "dry-run"} · ${WORKERS_PER_LEAF} workers per leaf · max ${MAX_CONCURRENT_LEAF_WORKERS} concurrent leaf workers (highest backlog first) · pg pool=${process.env.PERPLEXITY_SCRIPT_POOL_SIZE ?? "1"}/worker · max ~${Math.min(MAX_CONCURRENT_LEAF_WORKERS, WORKERS_PER_LEAF * 12) + 1} concurrent Perplexity calls with bulk@1`,
  );

  const initialSpawned = await spawnWorkersForBacklog(state, args.apply, logger);
  state.lastPollAt = new Date().toISOString();
  saveCoordinatorState(state);

  logger.log(`Initial spawn: ${initialSpawned} cleanup worker(s)`);

  while (true) {
    await sleep(args.pollMs);

    refreshRunningLeaves(state, logger);
    const spawned = await spawnWorkersForBacklog(state, args.apply, logger);
    state.lastPollAt = new Date().toISOString();
    saveCoordinatorState(state);

    if (spawned > 0) {
      logger.log(`Poll spawn: ${spawned} new cleanup worker(s)`);
    } else {
      const active = countRunningLeafWorkers(state);
      const backlogLeaves = await queryCompletedLeavesWithBacklog();
      const totalBacklog = backlogLeaves.reduce((sum, item) => sum + item.total, 0);
      logger.log(
        `Poll: no new spawns · active_workers=${active}/${MAX_CONCURRENT_LEAF_WORKERS} · leaves_with_backlog=${backlogLeaves.length} · total_backlog=${totalBacklog}`,
      );
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const logger = createFileLogger(COORDINATOR_LOG_FILE);
  logger.log(`FATAL: ${message}`);
  console.error("Cleanup coordinator failed:", message);
  process.exit(1);
});
