import type { StepCheckFields } from "@/pages/agents-v2-system-schema";

/** Graph node ids (system graph + scenario `focus`). */
export type NodeId = "orchestrator" | "sanity" | "news" | "taxonomy" | "review";

export type EdgeId = "orch-sanity" | "orch-news" | "orch-taxonomy" | "orch-review";

export type LineTone = "dispatch" | "ok" | "fail" | "human";

/** One playback frame in the Admin Agents V2 system animation. */
export type Step = StepCheckFields & {
  edge: EdgeId | null;
  direction?: "forward" | "reverse";
  lineTone?: LineTone;
  caption: string;
  focus: NodeId;
  sustainEdge?: EdgeId;
  sustainTone?: LineTone;
  humanOptions?: string[];
};

export type ScenarioDef = {
  id: string;
  group: string;
  label: string;
  description: string;
  outcome: string;
  outcomeKind: "ok" | "review" | "block";
  steps: Step[];
};

/** `lineTone` on the review → orchestrator return edge after a human gate (always “success” look). */
export const HUMAN_RETURN: LineTone = "ok";
