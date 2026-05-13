import { Agent, run } from "@openai/agents";
import { count, eq } from "drizzle-orm";
import { db } from "../../db";
import { agentDecisions, agentSessions } from "@shared/schema";
import { WIKI_OVERSEER_INSTRUCTIONS } from "./wiki-brief";
import { createWikiTools } from "./wiki-tools";

const overseerModel =
  process.env.WIKI_OVERSEER_MODEL?.trim() ||
  process.env.AGENT_OPENAI_MODEL?.trim() ||
  "gpt-4o-mini";

const runningControllers = new Map<string, AbortController>();

type OverseerOpts = {
  dateFrom: string;
  dateTo: string;
  maxDaysToConsider: number;
  maxProposals: number;
};

function clampOverseerOpts(opts: OverseerOpts): Required<OverseerOpts> {
  return {
    ...opts,
    maxProposals: Math.min(Math.max(opts.maxProposals, 1), 50),
    maxDaysToConsider: Math.min(Math.max(opts.maxDaysToConsider, 1), 30),
  };
}

function isAbortLikeError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /abort|cancel/i.test(msg);
}

async function createWikiOverseerSession(opts: Required<OverseerOpts>): Promise<string> {
  const [session] = await db
    .insert(agentSessions)
    .values({
      status: "running",
      currentPass: 1,
      maxPasses: 1,
      issuesFixed: 0,
      issuesFlagged: 0,
      config: { agent: "wiki-overseer", ...opts, model: overseerModel },
      stats: {
        phase: "initializing",
        startedAtIso: new Date().toISOString(),
      },
    })
    .returning({ id: agentSessions.id });

  return session!.id;
}

async function executeWikiOverseerSession(opts: Required<OverseerOpts> & { sessionId: string; signal?: AbortSignal }): Promise<{
  sessionId: string;
  finalOutput: unknown;
  proposalsPending: number;
  stopped: boolean;
}> {
  const { sessionId, signal } = opts;

  const tools = createWikiTools(sessionId, opts.maxProposals);

  const agent = new Agent({
    name: "Wiki Overseer",
    instructions: WIKI_OVERSEER_INSTRUCTIONS,
    model: overseerModel,
    tools,
    modelSettings: {
      temperature: 0.15,
    },
  });

  const prompt = `
Scope window: **${opts.dateFrom}** through **${opts.dateTo}**.

Prioritize up to **${opts.maxDaysToConsider}** distinct calendar days worth reviewing (spread across the window). Start with weak signals:
empty/very short summaries, orphan flags, zero articles fetched, or missing narrative topics when the topics catalog is non-empty.

Budget: at most **${opts.maxProposals}** total calls to **submit_proposal** (hard cap — the tool will reject beyond that).

Workflow:
1) Call **list_recent_analyses** for the window.
2) Deep-read several days with **get_analysis_by_date**; use **list_tags_for_analysis**, **list_page_topics_for_analysis**, **list_topics_catalog**, and **search_tags** when needed.
3) Call **submit_proposal** only for concrete, justified follow-ups.

Finish with a short plain-text summary of what you reviewed and what you proposed (no more tool calls).
`.trim();

  try {
    await db
      .update(agentSessions)
      .set({
        stats: {
          phase: "running",
          lastHeartbeatIso: new Date().toISOString(),
        },
      })
      .where(eq(agentSessions.id, sessionId));

    const result = await run(agent, prompt, { maxTurns: 40, signal });

    const [cntRow] = await db
      .select({ c: count() })
      .from(agentDecisions)
      .where(eq(agentDecisions.sessionId, sessionId));

    const proposalsPending = Number(cntRow?.c ?? 0);

    await db
      .update(agentSessions)
      .set({
        status: "completed",
        completedAt: new Date(),
        issuesFlagged: proposalsPending,
        stats: {
          phase: "completed",
          proposalsPending,
          finalOutputPreview: String(result.finalOutput ?? "").slice(0, 4000),
          lastHeartbeatIso: new Date().toISOString(),
        },
      })
      .where(eq(agentSessions.id, sessionId));

    return {
      sessionId,
      finalOutput: result.finalOutput,
      proposalsPending,
      stopped: false,
    };
  } catch (e) {
    if (isAbortLikeError(e)) {
      const [cntRow] = await db
        .select({ c: count() })
        .from(agentDecisions)
        .where(eq(agentDecisions.sessionId, sessionId));
      const proposalsPending = Number(cntRow?.c ?? 0);
      await db
        .update(agentSessions)
        .set({
          status: "stopped",
          completedAt: new Date(),
          issuesFlagged: proposalsPending,
          stats: {
            phase: "stopped",
            proposalsPending,
            stopReason: "Aborted by user request",
            lastHeartbeatIso: new Date().toISOString(),
          },
        })
        .where(eq(agentSessions.id, sessionId));
      return {
        sessionId,
        finalOutput: null,
        proposalsPending,
        stopped: true,
      };
    }

    await db
      .update(agentSessions)
      .set({
        status: "error",
        completedAt: new Date(),
        stats: {
          phase: "error",
          error: e instanceof Error ? e.message : String(e),
          lastHeartbeatIso: new Date().toISOString(),
        },
      })
      .where(eq(agentSessions.id, sessionId));
    throw e;
  }
}

export async function startWikiOverseerPass(opts: OverseerOpts): Promise<{ sessionId: string }> {
  const normalized = clampOverseerOpts(opts);
  const sessionId = await createWikiOverseerSession(normalized);
  const controller = new AbortController();
  runningControllers.set(sessionId, controller);

  void executeWikiOverseerSession({
    sessionId,
    ...normalized,
    signal: controller.signal,
  })
    .catch((err) => {
      console.error("Wiki Overseer background run failed", { sessionId, err });
    })
    .finally(() => {
      runningControllers.delete(sessionId);
    });

  return { sessionId };
}

export function stopWikiOverseerPass(sessionId: string): boolean {
  const controller = runningControllers.get(sessionId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isWikiOverseerPassRunning(sessionId: string): boolean {
  return runningControllers.has(sessionId);
}

export async function runWikiOverseerPass(opts: OverseerOpts): Promise<{ sessionId: string; finalOutput: unknown; proposalsPending: number }> {
  const normalized = clampOverseerOpts(opts);
  const sessionId = await createWikiOverseerSession(normalized);
  const out = await executeWikiOverseerSession({ sessionId, ...normalized });
  return { sessionId: out.sessionId, finalOutput: out.finalOutput, proposalsPending: out.proposalsPending };
}
