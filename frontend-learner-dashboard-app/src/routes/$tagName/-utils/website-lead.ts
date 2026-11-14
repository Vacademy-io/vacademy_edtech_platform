import axios from "axios";
import { CATALOGUE_LEAD_SUBMIT_URL } from "@/constants/urls";
import { emitLeadCaptured, getStoredUtm } from "./catalogue-tracking";
import { trackUtmAttribution } from "@/lib/utm-attribution";

/**
 * Website lead capture — the one funnel every catalogue capture point
 * (contact form, newsletter box, popup registration) submits through.
 *
 * Uses the hardened `open/v1/audience/lead/submit-catalogue` pipeline: it
 * creates/fetches the auth user, dedupes per person per campaign (reviving
 * soft-deleted leads), saves name-keyed custom fields, scores the lead,
 * pool-assigns a counsellor — and treats every enrichment step as
 * best-effort so a lead is never lost to optional config. With `audienceId`
 * the lead lands in that campaign (the admin-chosen destination); without
 * it, in the auto-provisioned "Course Catalogue Leads" list.
 *
 * HISTORY: contactForm and newsletterSignup previously faked success with no
 * network call at all — every submission on every institute site was
 * silently discarded.
 */

export interface WebsiteLeadPayload {
  instituteId: string;
  /** Destination campaign. Empty → the per-institute auto list. */
  audienceId?: string;
  fullName?: string;
  email: string;
  mobileNumber?: string;
  /** Channel tag shown in the CRM (WEBSITE_FORM, NEWSLETTER, POPUP_FORM…). */
  sourceType: string;
  /** Where on the site it came from, e.g. "book-store:contact-form". */
  sourceId: string;
  /** Extra authored fields, keyed by their label (server maps/creates by name). */
  customFieldValues?: Record<string, string>;
}

export interface WebsiteLeadResult {
  ok: boolean;
  /** True when the server reported this person already submitted — shown as success. */
  duplicate: boolean;
}

export const submitWebsiteLead = async (
  payload: WebsiteLeadPayload
): Promise<WebsiteLeadResult> => {
  // First-touch UTM rides along as name-keyed custom fields, so ad attribution
  // shows up on the lead in the CRM with zero backend changes.
  const utm = getStoredUtm();
  const { data } = await axios.post(CATALOGUE_LEAD_SUBMIT_URL, {
    institute_id: payload.instituteId,
    audience_id: payload.audienceId || undefined,
    full_name: payload.fullName || "",
    email: payload.email,
    mobile_number: payload.mobileNumber || "",
    source_type: payload.sourceType,
    source_id: payload.sourceId,
    custom_field_values: { ...utm, ...(payload.customFieldValues || {}) },
  });
  emitLeadCaptured({
    audienceId: payload.audienceId,
    sourceType: payload.sourceType,
    sourceId: payload.sourceId,
  });
  // Also record the touch against the person, not just as a custom field on
  // the lead: the custom-field copy is human-readable in the CRM but cannot be
  // grouped or counted, so "how many people did this campaign bring?" was
  // unanswerable from it.
  trackUtmAttribution({
    instituteId: payload.instituteId,
    email: payload.email,
    mobileNumber: payload.mobileNumber,
    sourceType: "CATALOGUE",
    sourceId: payload.sourceId,
  });
  // The endpoint returns 200 with either the new response id or a friendly
  // "already submitted" sentence. A repeat submission is a SUCCESS to the
  // visitor (locked product decision), never an error.
  const text = typeof data === "string" ? data : "";
  return { ok: true, duplicate: /already submitted/i.test(text) };
};

/**
 * Client-side spam guard: a honeypot field bots fill and humans never see,
 * plus a minimum time-to-submit (a human cannot read and complete a form in
 * under ~3s). On a spam verdict the caller shows the normal success state —
 * never tell a bot it was caught.
 */
export const SPAM_MIN_MS = 3000;

export const isSpamSubmission = (honeypotValue: string, mountedAt: number): boolean =>
  honeypotValue.trim().length > 0 || Date.now() - mountedAt < SPAM_MIN_MS;
