import { useEffect, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import { getPublicStudentDisplaySettings } from "@/services/student-display-settings";

export interface SignupAvailability {
  /**
   * Whether a configured "Sign Up" entry point should be honoured.
   *
   * This is NOT an opt-in signal and must never be used to introduce a signup
   * link somewhere one does not already exist. `signup.enabled` cannot carry
   * that meaning: the admin dashboard writes `enabled: true` as part of its
   * default STUDENT_DISPLAY_SETTINGS block, so 20 institutes on prod hold that
   * value byte-identically just from having saved an unrelated setting once.
   * Treating it as intent would switch self-registration on for ~8.7k learners
   * across tenants that only onboard by invite.
   *
   * So it is a veto, not a grant: true unless the institute explicitly set
   * `signup.enabled: false` (3 institutes on prod). What actually grants a
   * signup entry point is an admin hand-adding a Signup button in the
   * catalogue page editor.
   */
  enabled: boolean;
  /**
   * Whether the signup UI has at least one provider it can actually render
   * (Google, GitHub or email OTP). `usernamePassword` is a settings key with
   * no signup implementation behind it, so an institute that enabled only
   * that opens on an empty "Create Your Account" box — Shiksha Nation's
   * config is exactly this. Callers that OFFER a signup entry point should
   * require this as well as `enabled`.
   */
  hasProvider: boolean;
  /** The institute the answer was computed for, once resolved. */
  instituteId: string | null;
  /** False until the institute settings have been read once. */
  resolved: boolean;
}

const INITIAL: SignupAvailability = {
  // Optimistic: the only thing this gate does is HIDE an admin-authored button,
  // so defaulting to visible keeps the header stable while the read is in
  // flight. The three institutes that set `false` see it disappear a beat later.
  enabled: true,
  hasProvider: true,
  instituteId: null,
  resolved: false,
};

/** Domain routing writes InstituteId on mount; give it a moment before giving up. */
const RESOLVE_ATTEMPTS = 6;
const RESOLVE_INTERVAL_MS = 300;

async function resolveInstituteId(): Promise<string | null> {
  for (let attempt = 0; attempt < RESOLVE_ATTEMPTS; attempt++) {
    try {
      const stored = await Preferences.get({ key: "InstituteId" });
      if (stored?.value) return stored.value;
    } catch {
      // Storage unavailable — nothing to wait for.
      return null;
    }
    await new Promise((r) => setTimeout(r, RESOLVE_INTERVAL_MS));
  }
  return null;
}

/**
 * Whether this institute has switched self-signup off.
 *
 * Used only by the catalogue surfaces (header buttons, mobile action bar) to
 * suppress a Signup button an admin authored in the page editor. Reads
 * STUDENT_DISPLAY_SETTINGS through the unauthenticated endpoint, because those
 * surfaces render pre-login — the authenticated reader resolves its institute
 * from the access token and silently returns defaults when there isn't one, so
 * `signup.enabled: false` has never actually taken effect on a public page.
 *
 * Deliberately does NOT consult the legacy `LEARNER_<id>.allowSignup` flag that
 * domain routing writes. The catalogue header has never consulted it, and it is
 * not a trustworthy signal: across prod it is false on 100 rows, null on 11 and
 * true on only 8 — "never configured" rather than "denied". ReadOnRent resolves
 * to `allowSignup: false` on every one of its domains while actively wanting
 * signup, so honouring it here would hide the very button this exists to fix.
 *
 * @param instituteIdOverride pass it when the caller already resolved the
 *        institute (e.g. from `useDomainRouting`) to skip the storage poll.
 */
export function useSignupAvailability(
  instituteIdOverride?: string | null
): SignupAvailability {
  const [state, setState] = useState<SignupAvailability>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const instituteId = instituteIdOverride || (await resolveInstituteId());
      if (cancelled) return;

      if (!instituteId) {
        setState({ ...INITIAL, resolved: true });
        return;
      }

      const settings = await getPublicStudentDisplaySettings(instituteId);
      if (cancelled) return;

      const providers = settings?.signup?.providers;
      setState({
        enabled: settings?.signup?.enabled !== false,
        hasProvider:
          !providers ||
          !!(providers.google || providers.github || providers.emailOtp),
        instituteId,
        resolved: true,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [instituteIdOverride]);

  return state;
}
