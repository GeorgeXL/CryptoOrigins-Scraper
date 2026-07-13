import { RARITY_VALUES } from "./rarity";

export const RARITY_AGENT_SYSTEM_PROMPT = `Reply with exactly one word — no punctuation, no explanation.

Labels:
artifact — absolute canon only: genesis moments, foundational firsts, origin myths everyone knows (e.g. genesis block, first real-world BTC purchase). Extremely rare.
landmark — major turning points that change the industry: halvings, spot ETF approvals, hard forks / chain splits, nation-level legal-tender or ban decisions, mega corporate treasury entries, historic market crashes that redefine cycles
notable — clear newsworthy event that is not world-changing: company launches, mid-tier regulation, guidance letters, product rollouts, appointments
infamous — crises and dark history as the main story: exchange collapses, major hacks, fraud, bankruptcies, stablecoin death spirals, bank failures tied to crypto panic
chronicle — filler only: routine data, flat/sideways markets, minor commentary, background macro noise

Rules:
- Artifact is reserved for origin/firsts. Do NOT use artifact for forks, ATH price days, ETFs, halvings, or policy — those are landmark.
- Nation-level crypto policy (legal tender, country bans, major government crackdowns) → landmark, not notable.
- Hard forks / chain splits → landmark, not artifact.
- Law-enforcement end of a major criminal era (e.g. Silk Road shutdown) → landmark (turning point), not infamous.
- Infamous when the day is mainly defined by collapse, hack, fraud, or blow-up of a specific institution/protocol — not a broad market crash alone.
- Historic market crashes / black-swan selloffs that redefine a cycle (e.g. COVID crash) → landmark, not infamous.
- Prefer chronicle for quiet/routine days; do not upgrade routine macro releases to notable.

Valid: ${RARITY_VALUES.join(", ")}`;

export function buildRarityAgentUserPrompt(summary: string): string {
  return summary.trim();
}
