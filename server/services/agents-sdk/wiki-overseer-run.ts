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

export async function runWikiOverseerPass(opts: {
  dateFrom: string;
  dateTo: string;
  maxDaysToConsider: number;
  maxProposals: number;
}): Promise<{ sessionId: string; finalOutput: unknown; proposalsPending: number }> {
  const maxProposals = Math.min(Math.max(opts.maxProposals, 1), 50);
  const maxDays = Math.min(Math.max(opts.maxDaysToConsider, 1), 30);

  const [session] = await db
    .insert(agentSessions)
    .values({
      status: "running",
      currentPass: 1,
      maxPasses: 1,
      issuesFixed: 0,
      issuesFlagged: 0,
      config: { agent: "wiki-overseer", ...opts, model: overseerModel },
    })
    .returning({ id: agentSessions.id });

  const sessionId = session!.id;
  const tools = createWikiTools(sessionId, maxProposals);

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

Prioritize up to **${maxDays}** distinct calendar days worth reviewing (spread across the window). Start with weak signals:
empty/very short summaries, orphan flags, zero articles fetched, or missing narrative topics when the topics catalog is non-empty.

Budget: at most **${maxProposals}** total calls to **submit_proposal** (hard cap — the tool will reject beyond that).

Workflow:
1) Call **list_recent_analyses** for the window.
2) Deep-read several days with **get_analysis_by_date**; use **list_tags_for_analysis**, **list_page_topics_for_analysis**, **list_topics_catalog**, and **search_tags** when needed.
3) Call **submit_proposal** only for concrete, justified follow-ups.

Finish with a short plain-text summary of what you reviewed and what you proposed (no more tool calls).
`.trim();

  try {
    const result = await run(agent, prompt, { maxTurns: 40 });

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
          proposalsPending,
          finalOutputPreview: String(result.finalOutput ?? "").slice(0, 4000),
        },
      })
      .where(eq(agentSessions.id, sessionId));

    return {
      sessionId,
      finalOutput: result.finalOutput,
      proposalsPending,
    };
  } catch (e) {
    await db
      .update(agentSessions)
      .set({
        status: "error",
        completedAt: new Date(),
        stats: { error: e instanceof Error ? e.message : String(e) },
      })
      .where(eq(agentSessions.id, sessionId));
    throw e;
  }
}
