export type OperatorSnapshot = {
  shortCircuitOnReject?: boolean;
  shortCircuited?: boolean;
  firstBlocker?: {
    agent: string;
    reason?: string;
    suggestedAction?: string;
  };
  resumeStartsAvailable?: string[];
  executedAgentSteps?: number;
  scheduledAgentSteps?: number;
  partialRun?: { date: string; agents: string[] } | null;
};

export function parseOperatorSnapshot(pkg: unknown): OperatorSnapshot | null {
  if (!pkg || typeof pkg !== "object") return null;
  const o = (pkg as { operatorSnapshot?: unknown }).operatorSnapshot;
  if (!o || typeof o !== "object") return null;
  const snap = o as OperatorSnapshot;
  return snap;
}
