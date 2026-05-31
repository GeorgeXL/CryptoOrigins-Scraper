import type { PipelineRunDetail } from "@/lib/editorial-pipeline";
import type { EdgeId, LineTone, NodeId, Step } from "@/pages/agents-v2-system-types";

const HUMAN_RETURN: LineTone = "ok";

function agentFocus(agentName: string): NodeId {
  switch (agentName) {
    case "NewsManager":
    case "FinalEditorAgent":
      return "orchestrator";
    case "MilestoneAgent":
    case "DateConsistencyAgent":
    case "SummaryAgent":
      return "sanity";
    case "SourceFinderAgent":
    case "RelevanceCheckerAgent":
    case "VerificationAgent":
      return "news";
    case "TopicValidatorAgent":
    case "TopicManagerAgent":
    case "TagManagerAgent":
    case "TopicApplierAgent":
    case "TagApplierAgent":
    case "DuplicateCheckerAgent":
    case "TagConsistencyAgent":
      return "taxonomy";
    default:
      return "orchestrator";
  }
}

function agentEdge(agentName: string): EdgeId {
  const focus = agentFocus(agentName);
  if (focus === "sanity") return "orch-sanity";
  if (focus === "news") return "orch-news";
  if (focus === "taxonomy") return "orch-taxonomy";
  return "orch-review";
}

function statusTone(status: string): LineTone {
  if (status === "rejected" || status === "error") return "fail";
  if (status === "completed" || status === "skipped" || status === "approved") return "ok";
  return "dispatch";
}

function humanLabel(agentName: string): string {
  return agentName.replace(/Agent$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Map backend `pipeline_steps` into system-graph playback frames. */
export function pipelineStepsToGraphSteps(
  steps: PipelineRunDetail["steps"],
  opts?: { dateLabel?: string },
): Step[] {
  const out: Step[] = [];
  const dateLabel = opts?.dateLabel ?? "";

  if (steps.length === 0) {
    out.push({
      edge: null,
      caption: dateLabel ? `Waiting for steps · ${dateLabel}` : "Waiting for pipeline steps…",
      focus: "orchestrator",
    });
    return out;
  }

  for (const s of steps) {
    const focus = agentFocus(s.agentName);
    const edge = agentEdge(s.agentName);
    const tone = statusTone(s.status);
    const reason = s.rejectionReason?.trim();
    const caption = reason ?
        `${humanLabel(s.agentName)} · ${s.status} — ${reason.slice(0, 72)}`
      : `${humanLabel(s.agentName)} · ${s.status}`;

    if (s.agentName === "NewsManager") {
      out.push({
        edge: null,
        caption: dateLabel ? `Triage · ${dateLabel}` : caption,
        focus: "orchestrator",
        lineTone: tone,
      });
      continue;
    }

    out.push({
      edge,
      direction: "forward",
      lineTone: tone,
      caption,
      focus,
    });

    if (tone === "fail") {
      out.push({
        edge: "orch-review",
        direction: "forward",
        lineTone: "human",
        caption: "Pipeline blocked — human review queue",
        focus: "review",
        humanOptions: [
          "Open Queue tab to approve or reject",
          reason ? `Blocker: ${reason.slice(0, 60)}` : "Inspect review package",
        ],
      });
      out.push({
        edge: "orch-review",
        direction: "reverse",
        lineTone: HUMAN_RETURN,
        caption: "Resume when operator resolves",
        focus: "orchestrator",
      });
    }
  }

  const last = steps[steps.length - 1];
  if (last && (last.status === "completed" || last.status === "skipped" || last.status === "approved")) {
    out.push({
      edge: null,
      caption: "Run slice complete",
      focus: "orchestrator",
      lineTone: "ok",
    });
  }

  return out;
}
