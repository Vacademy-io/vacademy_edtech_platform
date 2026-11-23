import { Preferences } from "@capacitor/preferences";

/**
 * Merge-write the per-institute `LEARNER_<instituteId>` record.
 *
 * That record is filled from domain routing (use-domain-routing) and carries the
 * portal's pre-login policy: the privacy-policy / terms-and-conditions URLs the
 * admin set in White Label, the auth toggles, branding. The public form pages
 * (invite enrolment, audience response, enquiry response, sub-org registration)
 * also write to it, but they only know the institute's tab text, icon, font and
 * theme. They used to replace the whole record with `privacyPolicyUrl: null`,
 * `termsAndConditionUrl: null` and every auth flag `null`, so opening any of them
 * erased the URLs domain routing had stored — and every "Privacy Policy" / "Terms"
 * link read afterwards fell back to the built-in Vacademy page instead of the
 * institute's own.
 *
 * A writer therefore passes ONLY the fields it actually knows; everything else
 * already in the record is kept. Same reasoning as `upsertInstituteDetails`.
 */
export const upsertLearnerSettings = async (
  instituteId: string,
  partial: Record<string, unknown>,
): Promise<void> => {
  const key = `LEARNER_${instituteId}`;
  let prev: Record<string, unknown> = {};
  try {
    const existing = await Preferences.get({ key });
    if (existing?.value) {
      const parsed: unknown = JSON.parse(existing.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        prev = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // Unreadable record: nothing worth keeping, start from what we were given.
    prev = {};
  }
  await Preferences.set({ key, value: JSON.stringify({ ...prev, ...partial }) });
};
