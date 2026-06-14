import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CLEANUP_BATCH_SIZE,
  MAX_CONCURRENT_BATCH_WORKERS,
  MAX_CONCURRENT_LEAF_WORKERS,
  WORKERS_PER_LEAF,
  batchAgentLabel,
  batchDisplayIndex,
  batchKey,
  batchLogFile,
  batchLogPrefix,
  batchStateFile,
  buildRowVerifyFingerprint,
  buildRoundRobinPendingBatches,
  batchDatesEqual,
  computeLeafBatches,
  computeLeafWorkerSlice,
  emptyCleanupStats,
  isBatchSpawnedOrActive,
  isLeafSpawnedOrActive,
  isLeafWorkerRunning,
  isProcessRunning,
  leafAgentLabel,
  leafCleanupAgentLabel,
  leafDisplayName,
  leafLogFile,
  leafLogPrefix,
  leafSlug,
  leafStateFile,
  prioritizePendingLeafWorkers,
  workerAgentLabel,
  workerStateFile,
  parseCleanupLeafFromArgv,
  saveBatchState,
  splitIntoBatches,
  type CoordinatorState,
  type LeafBatchPlan,
  type PendingLeafWorker,
} from "../scripts/perplexity-cleanup-shared";

test("processFlaggedRow does not pre-skip flagged rows by unchanged fingerprint", () => {
  const sharedPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../scripts/perplexity-cleanup-shared.ts",
  );
  const source = fs.readFileSync(sharedPath, "utf8");
  assert.equal(
    source.includes("skip — unchanged since last cleanup (no agents / Perplexity)"),
    false,
    "flagged no/uncertain rows must always run the agent path; post-agent fingerprint skip is sufficient",
  );
});

test("buildRowVerifyFingerprint is stable and sensitive to verify inputs", () => {
  const base = {
    summary: "  Bitcoin hits a new high  ",
    topArticleId: "article-1",
    topicCategories: ["Bitcoin price & cycles", "DeFi"],
    tagsVersion2: ["Coinbase", "ETF"],
  };

  const fingerprint = buildRowVerifyFingerprint(base);
  assert.equal(fingerprint, buildRowVerifyFingerprint({ ...base }));
  assert.equal(
    fingerprint,
    buildRowVerifyFingerprint({
      ...base,
      topicCategories: ["DeFi", "Bitcoin price & cycles"],
    }),
  );
  assert.equal(
    fingerprint,
    buildRowVerifyFingerprint({ ...base, tagsVersion2: ["ETF", "Coinbase"] }),
  );

  assert.notEqual(
    fingerprint,
    buildRowVerifyFingerprint({ ...base, summary: "Bitcoin reaches a new all-time high" }),
  );
  assert.notEqual(
    fingerprint,
    buildRowVerifyFingerprint({ ...base, topArticleId: "article-2" }),
  );
  assert.notEqual(
    fingerprint,
    buildRowVerifyFingerprint({ ...base, topicCategories: ["Bitcoin mining"] }),
  );
  assert.notEqual(
    fingerprint,
    buildRowVerifyFingerprint({ ...base, tagsVersion2: ["Coinbase"] }),
  );

  const parsed = JSON.parse(fingerprint) as {
    summary: string;
    topArticleId: string | null;
    topics: string[];
    tags: string[];
  };
  assert.equal(parsed.summary, "Bitcoin hits a new high");
  assert.equal(parsed.topArticleId, "article-1");
  assert.deepEqual(parsed.topics, ["bitcoin price & cycles", "defi"]);
  assert.deepEqual(parsed.tags, ["Coinbase", "ETF"]);
});

test("leafSlug normalises hierarchy leaf names", () => {
  assert.equal(leafSlug("Protocol & upgrades"), "protocol-and-upgrades");
  assert.equal(leafSlug("Early Bitcoin history"), "early-bitcoin-history");
  assert.equal(leafSlug("  DeFi  "), "defi");
});

test("leaf identity helpers use display name", () => {
  assert.equal(leafDisplayName("  Protocol & upgrades  "), "Protocol & upgrades");
  assert.equal(leafLogPrefix("Early Bitcoin history"), "[LEAF: Early Bitcoin history]");
  assert.equal(leafAgentLabel("DeFi"), "AGENT DeFi");
  assert.equal(leafCleanupAgentLabel("DeFi"), "AGENT DeFi · CLEANUP");
});

test("leaf paths use slug", () => {
  assert.match(leafLogFile("Protocol & upgrades"), /cleanup-protocol-and-upgrades\.log$/);
  assert.match(leafStateFile("Protocol & upgrades"), /cleanup-leaf-protocol-and-upgrades\.json$/);
});

test("batch identity helpers use 1-based display index", () => {
  assert.equal(batchDisplayIndex(0), 1);
  assert.equal(batchDisplayIndex(18), 19);
  assert.equal(batchLogPrefix("Protocol & upgrades", 2, 19), "[LEAF: Protocol & upgrades · batch 3/19]");
  assert.equal(batchAgentLabel("Bitcoin adoption", 0, 28), "AGENT Bitcoin adoption · batch 1/28");
});

test("batch paths use slug and 1-based log index", () => {
  assert.equal(batchKey("Protocol & upgrades", 2), "protocol-and-upgrades-batch-2");
  assert.match(batchLogFile("Protocol & upgrades", 3), /cleanup-protocol-and-upgrades-batch-3\.log$/);
  assert.match(batchStateFile("Protocol & upgrades", 2), /cleanup-batch-protocol-and-upgrades-2\.json$/);
});

test("splitIntoBatches chunks items", () => {
  const dates = Array.from({ length: 25 }, (_, i) => `2020-01-${String(i + 1).padStart(2, "0")}`);
  assert.deepEqual(
    splitIntoBatches(dates, 10).map((b) => b.length),
    [10, 10, 5],
  );
  assert.deepEqual(splitIntoBatches([], 10), []);
  assert.deepEqual(splitIntoBatches(["a"], 10), [["a"]]);
});

test("computeLeafBatches assigns stable 0-based indices and totals", () => {
  const dates = Array.from({ length: 23 }, (_, i) => `2024-03-${String(i + 1).padStart(2, "0")}`);
  const plans = computeLeafBatches(dates, 10);

  assert.equal(plans.length, 3);
  assert.equal(plans[0]?.batchIndex, 0);
  assert.equal(plans[0]?.batchTotal, 3);
  assert.equal(plans[0]?.dates.length, 10);
  assert.equal(plans[2]?.batchIndex, 2);
  assert.equal(plans[2]?.dates.length, 3);
  assert.deepEqual(plans.flatMap((p) => p.dates), dates);
});

test("computeLeafBatches uses CLEANUP_BATCH_SIZE by default", () => {
  const dates = Array.from({ length: CLEANUP_BATCH_SIZE * 2 + 1 }, (_, i) => `d${i}`);
  const plans = computeLeafBatches(dates);
  assert.equal(plans.length, 3);
  assert.equal(plans[0]?.dates.length, CLEANUP_BATCH_SIZE);
});

test("concurrency constants are sensible", () => {
  assert.equal(CLEANUP_BATCH_SIZE, 10);
  assert.equal(WORKERS_PER_LEAF, 1);
  assert.ok(MAX_CONCURRENT_BATCH_WORKERS >= 10);
  assert.ok(MAX_CONCURRENT_BATCH_WORKERS <= 30);
  assert.ok(MAX_CONCURRENT_LEAF_WORKERS >= 6);
  assert.ok(MAX_CONCURRENT_LEAF_WORKERS <= 20);
});

test("prioritizePendingLeafWorkers caps workers and keeps leaf pairs intact", () => {
  const pending: PendingLeafWorker[] = [
    { leaf: "Small leaf", uncertain: 1, no: 0, total: 1, workerIndex: 1, workerTotal: 2 },
    { leaf: "Small leaf", uncertain: 1, no: 0, total: 1, workerIndex: 2, workerTotal: 2 },
    { leaf: "Big leaf", uncertain: 20, no: 10, total: 30, workerIndex: 1, workerTotal: 2 },
    { leaf: "Big leaf", uncertain: 20, no: 10, total: 30, workerIndex: 2, workerTotal: 2 },
    { leaf: "Mid leaf", uncertain: 5, no: 5, total: 10, workerIndex: 1, workerTotal: 2 },
    { leaf: "Mid leaf", uncertain: 5, no: 5, total: 10, workerIndex: 2, workerTotal: 2 },
  ];

  const picked = prioritizePendingLeafWorkers(pending, 0, 4);
  assert.equal(picked.length, 4);
  assert.deepEqual(
    picked.map((item) => `${item.leaf}#${item.workerIndex}`),
    ["Big leaf#1", "Big leaf#2", "Mid leaf#1", "Mid leaf#2"],
  );

  const capped = prioritizePendingLeafWorkers(pending, 15, 16);
  assert.equal(capped.length, 0);
});

test("computeLeafWorkerSlice splits flagged dates across workers", () => {
  const dates = Array.from({ length: 10 }, (_, i) => `2020-01-${String(i + 1).padStart(2, "0")}`);
  const w1 = computeLeafWorkerSlice(dates, 1, 2);
  const w2 = computeLeafWorkerSlice(dates, 2, 2);
  assert.equal(w1.length, 5);
  assert.equal(w2.length, 5);
  assert.deepEqual([...w1, ...w2], dates);
});

test("worker identity helpers use 1-based display index", () => {
  assert.equal(workerAgentLabel("Protocol & upgrades", 1, 2), "AGENT Protocol & upgrades · worker 1/2");
  assert.match(workerStateFile("Protocol & upgrades", 2), /cleanup-leaf-protocol-and-upgrades-w2\.json$/);
});

test("isProcessRunning returns false for invalid pid", () => {
  assert.equal(isProcessRunning(0), false);
  assert.equal(isProcessRunning(-1), false);
  assert.equal(isProcessRunning(999_999_999), false);
});

test("isLeafWorkerRunning is false when no state file", () => {
  assert.equal(isLeafWorkerRunning("__nonexistent_leaf__"), false);
});

test("isLeafSpawnedOrActive is false when no worker or state", () => {
  const state: CoordinatorState = { mode: "per-leaf", spawnedLeaves: {} };
  assert.equal(isLeafSpawnedOrActive(state, "__nonexistent_leaf__"), false);
});

test("parseCleanupLeafFromArgv excludes batch and worker flags from leaf name", () => {
  assert.equal(
    parseCleanupLeafFromArgv("Bitcoin adoption --dates 2012-01-01 --batch-index 2 --apply"),
    "Bitcoin adoption",
  );
  assert.equal(
    parseCleanupLeafFromArgv("Protocol & upgrades --worker-index 2 --worker-total 2 --apply"),
    "Protocol & upgrades",
  );
  assert.equal(parseCleanupLeafFromArgv("Protocol & upgrades --apply"), "Protocol & upgrades");
});

test("batchDatesEqual compares ordered date lists", () => {
  assert.equal(batchDatesEqual(["2020-01-01", "2020-01-02"], ["2020-01-01", "2020-01-02"]), true);
  assert.equal(batchDatesEqual(["2020-01-01"], ["2020-01-02"]), false);
  assert.equal(batchDatesEqual(["2020-01-01", "2020-01-02"], ["2020-01-02", "2020-01-01"]), false);
});

test("buildRoundRobinPendingBatches gives each leaf one batch before any second batch", () => {
  const plan = (leaf: string, batchIndex: number, batchTotal: number): LeafBatchPlan => ({
    batchIndex,
    batchTotal,
    dates: [`${leaf}-${batchIndex}`],
  });
  const queues = [
    { leaf: "Bitcoin adoption", plans: [plan("a", 0, 3), plan("a", 1, 3), plan("a", 2, 3)], backlogTotal: 30 },
    { leaf: "Bitcoin mining", plans: [plan("m", 0, 2), plan("m", 1, 2)], backlogTotal: 20 },
    { leaf: "Protocol & upgrades", plans: [plan("p", 0, 2), plan("p", 1, 2)], backlogTotal: 15 },
  ];

  const pending = buildRoundRobinPendingBatches(queues);
  const first9 = pending.slice(0, 9).map((item) => `${item.leaf}#${item.plan.batchIndex}`);

  assert.deepEqual(first9.slice(0, 3), [
    "Bitcoin adoption#0",
    "Bitcoin mining#0",
    "Protocol & upgrades#0",
  ]);
  assert.deepEqual(first9.slice(3, 6), [
    "Bitcoin adoption#1",
    "Bitcoin mining#1",
    "Protocol & upgrades#1",
  ]);
});

test("buildRoundRobinPendingBatches respects MAX_CONCURRENT spread across many leaves", () => {
  const plan = (batchIndex: number): LeafBatchPlan => ({
    batchIndex,
    batchTotal: 5,
    dates: [`d${batchIndex}`],
  });
  const leaves = [
    "Bitcoin adoption",
    "Bitcoin mining",
    "Protocol & upgrades",
    "Wallets & self-custody",
    "Scaling and Layer 2",
    "Debt crises",
    "Early Bitcoin history",
    "NFTs and gaming",
    "Halving events",
    "Stablecoins",
    "DeFi",
    "Cross-chain and bridges",
  ];
  const queues = leaves.map((leaf) => ({
    leaf,
    plans: [plan(0), plan(1), plan(2)],
    backlogTotal: 10,
  }));

  const pending = buildRoundRobinPendingBatches(queues).slice(0, MAX_CONCURRENT_BATCH_WORKERS);
  const uniqueLeaves = new Set(pending.map((item) => item.leaf));
  assert.equal(uniqueLeaves.size, leaves.length);
  assert.equal(pending.length, MAX_CONCURRENT_BATCH_WORKERS);
});

test("isBatchSpawnedOrActive does not block completed batches for retry", () => {
  const leaf = "Bitcoin adoption";
  const batchIndex = 0;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-batch-test-"));
  const priorBatchDir = process.env.PERPLEXITY_BATCH_DIR;
  process.env.PERPLEXITY_BATCH_DIR = tmpDir;

  try {
    saveBatchState({
      leaf,
      batchIndex,
      batchTotal: 3,
      dates: ["2012-01-01"],
      status: "completed",
      stats: emptyCleanupStats(),
      finishedAt: new Date().toISOString(),
    });

    const state: CoordinatorState = {
      mode: "batch",
      spawnedLeaves: {},
      spawnedBatches: {
        [batchKey(leaf, batchIndex)]: {
          leaf,
          slug: leafSlug(leaf),
          batchIndex,
          batchTotal: 3,
          batchKey: batchKey(leaf, batchIndex),
          dates: ["2012-01-01"],
          pid: 999_999_999,
          spawnedAt: new Date().toISOString(),
          status: "completed",
          completedAt: new Date().toISOString(),
        },
      },
    };

    assert.equal(isBatchSpawnedOrActive(state, leaf, batchIndex), false);
  } finally {
    if (priorBatchDir == null) {
      delete process.env.PERPLEXITY_BATCH_DIR;
    } else {
      process.env.PERPLEXITY_BATCH_DIR = priorBatchDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
