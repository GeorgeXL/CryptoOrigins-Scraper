export type VerificationBadge = "Manual" | "Verified" | "Not Available";

export function deriveVerificationBadge(input: {
  isManualOverride?: boolean | null;
  googleCheckHappened?: string | null;
}): VerificationBadge {
  if (input.isManualOverride) return "Manual";
  if (input.googleCheckHappened === "yes") return "Verified";
  return "Not Available";
}
