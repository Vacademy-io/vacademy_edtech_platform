/**
 * Whether a login form should offer "Don't have an account? Sign up here".
 *
 * `allowSignup` is the portal's policy from domain routing and wins whenever
 * the backend actually said something. Only when it is unknown do we fall
 * back to the legacy `LEARNER_<id>.allowSignup` mirror in localStorage — and
 * that fallback is web-only in practice: on native, Capacitor Preferences
 * writes to UserDefaults, so localStorage is empty on every install and this
 * link never rendered on any native build until the flag started arriving via
 * domain routing. Unknown institute, unreadable storage or a corrupt mirror all
 * mean "we cannot tell" → hidden, matching the old behaviour; a portal that
 * wants the link always reaches us through the boolean.
 */
export function isSignupLinkVisible(allowSignup?: boolean | null): boolean {
  if (typeof allowSignup === "boolean") return allowSignup;
  try {
    const instituteId = localStorage.getItem("InstituteId") || "";
    if (!instituteId) return false;
    const stored = localStorage.getItem(`LEARNER_${instituteId}`);
    if (!stored) return true;
    const parsed = JSON.parse(stored) as { allowSignup?: boolean | null };
    return parsed?.allowSignup !== false;
  } catch {
    return false;
  }
}
