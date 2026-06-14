import { isDayLocked, setDayLocked } from "../day-lock";

export type VerificationLockAction = "locked" | "unlocked" | "pending";

export type VerificationLockOutcome = {
  date: string;
  action: VerificationLockAction;
  reason: string;
};

export type VerificationLockStats = {
  locked: number;
  unlocked: number;
  pending: number;
  lockActions: VerificationLockOutcome[];
};

export function lockActionFromVerdict(opts: {
  correlated: boolean;
  confidence: "high" | "medium" | "low";
}): VerificationLockAction {
  if (opts.confidence === "low") return "pending";
  return opts.correlated ? "locked" : "unlocked";
}

/** Persisted on main_events_check_cache.verification_dates vs the cached Gemini list. */
export function verificationStatusFromVerdict(opts: {
  correlated: boolean;
  confidence: "high" | "medium" | "low";
}): "matched" | "pending" {
  if (opts.confidence === "low") return "pending";
  return opts.correlated ? "matched" : "pending";
}

/** Manual Accept/Reject and auto-accept lock days via shared/main-events-verification-lock.ts. */

export async function applyVerificationLockPolicy(
  date: string,
  action: VerificationLockAction,
  reason: string,
): Promise<{ outcome: VerificationLockOutcome; changed: boolean }> {
  const base = { date, action, reason };

  if (action === "pending") {
    return { outcome: base, changed: false };
  }

  const currentlyLocked = await isDayLocked(date);
  if (action === "locked") {
    if (currentlyLocked) return { outcome: base, changed: false };
    await setDayLocked(date, true);
    return { outcome: base, changed: true };
  }

  if (!currentlyLocked) return { outcome: base, changed: false };
  await setDayLocked(date, false);
  return { outcome: base, changed: true };
}

export function emptyLockStats(): VerificationLockStats {
  return { locked: 0, unlocked: 0, pending: 0, lockActions: [] };
}

export async function recordVerificationLock(
  stats: VerificationLockStats,
  date: string,
  action: VerificationLockAction,
  reason: string,
  applyLockPolicy: boolean,
): Promise<void> {
  stats.lockActions.push({ date, action, reason });

  if (action === "pending") {
    stats.pending += 1;
    return;
  }

  if (!applyLockPolicy) return;

  const { changed } = await applyVerificationLockPolicy(date, action, reason);
  if (!changed) return;

  if (action === "locked") stats.locked += 1;
  if (action === "unlocked") stats.unlocked += 1;
}
