/** Optional shared secret for agent HTTP routes (set `ADMIN_AGENT_SECRET` on the server). */
export function requireAgentSecret(req: { headers: Record<string, string | string[] | undefined> }): void {
  const secret = process.env.ADMIN_AGENT_SECRET?.trim();
  if (!secret) return;
  const sent = req.headers["x-admin-agent-secret"];
  const value = Array.isArray(sent) ? sent[0] : sent;
  if (value !== secret) {
    const err = new Error("Unauthorized: invalid X-Admin-Agent-Secret") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
}
