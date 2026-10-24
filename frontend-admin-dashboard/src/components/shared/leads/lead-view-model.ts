/**
 * lead-view-model — the single normalization layer for the leads redesign.
 *
 * The two leads surfaces (Recent Leads and the campaign Lead List) carry
 * different raw row shapes (`RecentLeadDetail` vs `CampaignUserTable`). Every
 * presentational component in `components/shared/leads/` consumes the neutral
 * `LeadCardVM` defined here instead, so the card / list / board look identical
 * regardless of where the row came from.
 *
 * This module also owns the row → `StudentTable` mappers used to open the shared
 * StudentSidebar. They previously lived inline in each page; centralizing them
 * here keeps the side-view behaviour consistent and lets both pages import a
 * single source of truth. NOTE: this file performs NO network calls.
 */

import { format } from 'date-fns';
import type { RecentLeadDetail } from '@/routes/audience-manager/list/-services/get-recent-leads';
import type { CampaignUserTable } from '@/routes/audience-manager/list/-components/campaign-users/campaign-users-columns';
import type { StudentTable } from '@/types/student-table-types';

/** Neutral, source-agnostic shape every lead card/row/board cell renders from. */
export interface LeadCardVM {
    /** Stable React key — response id, falling back to user id. */
    key: string;
    /** Linked user id (for profile/notes lookup + dialogs). Null when unlinked. */
    userId: string | null;
    name: string;
    email: string;
    phone: string;
    audience: string;
    /** The audience's campaign type — the channel the lead came in through ('-' when unset). */
    campaignType: string;
    /** Latest UTM campaign this lead was tagged with ('-' when untagged). */
    utmCampaign: string;
    /** utm_source for the same row — shown as the campaign cell's tooltip. */
    utmSource?: string;
    /** Human-readable submitted date, already formatted for display ('-' when unknown). */
    submittedDisplay: string;
    /** Raw ISO submitted timestamp (when available) for relative-time + sorting. */
    submittedIso?: string;
    /** Audience response id — the key the custom-status mutation writes against. */
    responseId?: string;
    /** Current custom pipeline status (key or label); drives the editable status chip. */
    leadStatus?: string | null;
    /** This enquiry repeats an existing lead (audience_response.is_duplicate). */
    isDuplicate?: boolean | null;
    /** Live duplicate enquiries that repeat this lead (recent-leads list only). */
    duplicateCount?: number | null;
    /** Has an open priority follow-up (opened for a reattempt); the Follow-ups page lists it first. */
    followUpPriority?: boolean | null;
    // ── TAT / follow-up SLA (visual only; computed on the backend) ───────────
    tatOverdue?: boolean | null;
    tatDueSoon?: boolean | null;
    followUpOverdue?: boolean | null;
    /** Lead is Lost / Converted: off the SLA clock, so the SLA cells never say Pending / Overdue. */
    slaClosed?: boolean | null;
    /** ISO deadline to first reach out (admin override, else working-hours aware). */
    tatDueAt?: string | null;
    /** True when an admin set tatDueAt by hand. */
    tatDueOverridden?: boolean | null;
    /** First counsellor activity timestamp — drives the "Reach out in" cell.
     *  When set, the cell shows the actual contact time ("✓ Contacted · 2:28 PM");
     *  when null, the cell shows Pending / Overdue based on tatDueAt. */
    firstResponseAt?: string | null;
    /** ISO deadline for the next follow-up (last action + followUpSlaHours). */
    followUpDueAt?: string | null;
    /** Maps this lead to the partial StudentTable the side view consumes. */
    toStudent: () => StudentTable;
}

/** Format a raw ISO timestamp the way the leads tables do; '-' on missing/invalid. */
export const formatSubmitted = (iso: string | undefined | null): string => {
    if (!iso) return '-';
    // Backend serialises Timestamps as bare ISO strings without a TZ marker;
    // treat them as UTC and convert to the browser's local timezone.
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(iso);
    const normalized = hasTimezone ? iso : `${iso.replace(' ', 'T')}Z`;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? iso : format(d, 'MMM d, yyyy h:mm a');
};

// ── Display helpers (mirror the originals from both pages) ────────────────────

// A lead's OWN identity lives on its auth user. The `parent_*` columns are the
// parent/guardian's contact — a separate person — and are editable as such from the
// CRM, so they must never stand in for the lead's own name/email/phone: doing so
// would print the guardian's number in the lead's Phone column. Every path that
// populates `parent_mobile` (enquiry, walk-in, inbound call) also puts that same
// number on the auth user, so nothing is lost by reading the auth user alone.
export const recentLeadName = (lead: RecentLeadDetail) =>
    lead.user?.full_name || lead.user?.email || lead.user?.mobile_number || 'Unknown lead';
export const recentLeadEmail = (lead: RecentLeadDetail) => lead.user?.email || '-';
// Prefer the linked user's number, else the phone the lead submitted (parent_mobile).
// Many imported/ad leads have only parent_mobile populated — without this fallback the
// phone shows '-', which hides the whole phone cell AND the row's Call / AI-call buttons
// (both live behind `showPhone` in lead-table).
export const recentLeadPhone = (lead: RecentLeadDetail) =>
    lead.user?.mobile_number || lead.parent_mobile || '-';
export const recentLeadAudience = (lead: RecentLeadDetail) =>
    lead.campaign_name || lead.source_audience_name || '-';
export const recentLeadCampaignType = (lead: RecentLeadDetail) => lead.campaign_type || '-';
export const recentLeadUtmCampaign = (lead: RecentLeadDetail) => lead.utm_campaign || '-';

// Truncate a display name for table/card views (full name is preserved in
// the `title` tooltip and in CSV exports — only the on-screen label is cut).
export const truncateName = (name: string, max = 30) =>
    name.length > max ? `${name.slice(0, max).trimEnd()}…` : name;

// ── Row → StudentTable mappers (moved from the two pages) ─────────────────────

/**
 * Map a recent-lead row to a partial StudentTable so the shared StudentSidebar
 * can render its tabs for this respondent. Only fields available from the lead
 * payload are populated; the rest are safe defaults. `_response_fields` +
 * `_audience_campaign_name` are stashed for the side view's LeadFormResponseCard.
 */
export const mapRecentLeadToStudent = (lead: RecentLeadDetail): StudentTable => {
    const u = lead.user ?? {};
    const userId = u.id || lead.user_id || lead.response_id || '';

    const responseFields: Array<{
        id: string;
        name: string;
        type: string;
        rawValue: string | null;
    }> = [];
    const cfv = lead.custom_field_values ?? {};
    const meta = lead.custom_field_metadata ?? {};
    Object.entries(cfv).forEach(([fieldId, rawVal]) => {
        const value = rawVal == null ? null : String(rawVal);
        if (value === null || value === '') return;
        const m = meta[fieldId] ?? {};
        const name = m.fieldName ?? m.field_name ?? fieldId;
        const type = m.fieldType ?? m.field_type ?? 'textfield';
        responseFields.push({ id: fieldId, name, type, rawValue: value });
    });

    const result: StudentTable = {
        id: userId,
        user_id: userId,
        // The lead's own identity — auth user only. See recentLeadName above: the
        // parent_* columns belong to the guardian and are surfaced separately below.
        full_name: u.full_name || '',
        email: u.email || '',
        username: null,
        mobile_number: u.mobile_number || '',
        gender: '',
        region: null,
        city: '',
        date_of_birth: '',
        created_at: '',
        address_line: '',
        attendance_percent: 0,
        referral_count: 0,
        pin_code: '',
        // Guardian rows — a lead's guardian lives on audience_response.parent_*.
        // Surfaced here so the Overview shows them and EditLeadDetails round-trips.
        fathers_name: lead.parent_name || '',
        mothers_name: '',
        father_mobile_number: lead.parent_mobile || '',
        father_email: lead.parent_email || '',
        mother_mobile_number: '',
        mother_email: '',
        linked_institute_name: null,
        updated_at: '',
        package_session_id: '',
        institute_enrollment_id: '',
        status: 'INACTIVE',
        session_expiry_days: 0,
        institute_id: '',
        expiry_date: 0,
        face_file_id: null,
        parents_email: '',
        parents_mobile_number: '',
        parents_to_mother_email: '',
        parents_to_mother_mobile_number: '',
        destination_package_session_id: '',
        enroll_invite_id: '',
        payment_status: '',
        custom_fields: {},
    };
    (result as unknown as Record<string, unknown>)._response_fields = responseFields;
    (result as unknown as Record<string, unknown>)._audience_campaign_name =
        lead.campaign_name ?? lead.source_audience_name ?? null;
    (result as unknown as Record<string, unknown>)._audience_campaign_type =
        lead.campaign_type ?? null;
    (result as unknown as Record<string, unknown>)._utm_campaign = lead.utm_campaign ?? null;
    (result as unknown as Record<string, unknown>)._utm_source = lead.utm_source ?? null;
    (result as unknown as Record<string, unknown>)._response_id = lead.response_id ?? null;
    return result;
};

/**
 * Map a campaign Lead List row to a partial StudentTable. Underscore-prefixed
 * extras (`_response_fields`, `_audience_campaign_name`, `_response_id`) are
 * attached for the LeadFormResponseCard to read from the side view —
 * `_response_id` in particular drives the click-to-call action on the phone
 * row (the backend looks up the lead's phone via that id).
 */
export const mapCampaignRowToStudent = (row: CampaignUserTable): StudentTable => {
    const u = row._user ?? {};
    const customFields: Record<string, string | null> = {};
    const cfv = row._custom_field_values ?? {};
    for (const [k, v] of Object.entries(cfv)) {
        customFields[k] = v == null ? null : String(v);
    }
    const result: StudentTable = {
        id: u.id || row._user_id || row.id,
        user_id: u.id || row._user_id || row.id,
        full_name: (row.full_name as string) || u.full_name || '',
        email: (row.email as string) || u.email || '',
        username: u.username ?? null,
        mobile_number: (row.phone_number as string) || u.mobile_number || '',
        gender: u.gender || '',
        region: u.region ?? null,
        city: u.city || '',
        date_of_birth: u.date_of_birth || '',
        created_at: '',
        address_line: u.address_line || '',
        attendance_percent: 0,
        referral_count: 0,
        pin_code: u.pin_code || '',
        fathers_name: '',
        mothers_name: '',
        father_mobile_number: '',
        father_email: '',
        mother_mobile_number: '',
        mother_email: '',
        linked_institute_name: null,
        updated_at: '',
        package_session_id: '',
        institute_enrollment_id: '',
        status: 'INACTIVE',
        session_expiry_days: 0,
        institute_id: '',
        expiry_date: 0,
        face_file_id: u.face_file_id ?? u.profile_pic_file_id ?? null,
        parents_email: '',
        parents_mobile_number: '',
        parents_to_mother_email: '',
        parents_to_mother_mobile_number: '',
        destination_package_session_id: '',
        enroll_invite_id: '',
        payment_status: '',
        custom_fields: customFields,
    };
    (result as unknown as Record<string, unknown>)._response_fields = row._response_fields;
    (result as unknown as Record<string, unknown>)._audience_campaign_name =
        row._audience_campaign_name;
    (result as unknown as Record<string, unknown>)._audience_campaign_type =
        row._audience_campaign_type;
    (result as unknown as Record<string, unknown>)._utm_campaign = row._utm_campaign;
    (result as unknown as Record<string, unknown>)._utm_source = row._utm_source;
    (result as unknown as Record<string, unknown>)._response_id = row._response_id ?? null;
    return result;
};

// ── Adapters: raw row → LeadCardVM ────────────────────────────────────────────

export const recentLeadToVM = (lead: RecentLeadDetail): LeadCardVM => {
    const userId = lead.user?.id || lead.user_id || '';
    // Deterministic key — falls back to identity + timestamp so re-renders keep
    // the same key (avoids React remounts) without depending on crypto.
    return {
        key:
            lead.response_id ||
            lead.user_id ||
            userId ||
            `${recentLeadEmail(lead)}-${lead.submitted_at_local ?? ''}`,
        userId: userId || null,
        name: recentLeadName(lead),
        email: recentLeadEmail(lead),
        phone: recentLeadPhone(lead),
        audience: recentLeadAudience(lead),
        campaignType: recentLeadCampaignType(lead),
        utmCampaign: recentLeadUtmCampaign(lead),
        utmSource: lead.utm_source ?? undefined,
        submittedDisplay: formatSubmitted(lead.submitted_at_local),
        submittedIso: lead.submitted_at_local,
        responseId: lead.response_id,
        leadStatus: lead.lead_status,
        isDuplicate: lead.is_duplicate,
        duplicateCount: lead.duplicate_count,
        followUpPriority: lead.follow_up_priority,
        tatOverdue: lead.tat_overdue,
        tatDueSoon: lead.tat_due_soon,
        followUpOverdue: lead.follow_up_overdue,
        slaClosed: lead.sla_closed,
        tatDueAt: lead.tat_due_at,
        tatDueOverridden: lead.tat_due_overridden,
        firstResponseAt: lead.first_response_at,
        followUpDueAt: lead.follow_up_due_at,
        toStudent: () => mapRecentLeadToStudent(lead),
    };
};

export const campaignRowToVM = (row: CampaignUserTable): LeadCardVM => {
    const userId = row._user?.id || row._user_id || '';
    const name =
        (row.full_name as string) ||
        row._user?.full_name ||
        (row.email as string) ||
        row._user?.email ||
        (row.phone_number as string) ||
        row._user?.mobile_number ||
        'Unknown lead';
    return {
        key: row.id,
        userId: userId || null,
        name,
        email: (row.email as string) || row._user?.email || '-',
        phone: (row.phone_number as string) || row._user?.mobile_number || '-',
        audience: (row._audience_campaign_name as string) || (row.opted_out_from as string) || '-',
        campaignType: (row._audience_campaign_type as string) || '-',
        utmCampaign: (row._utm_campaign as string) || '-',
        utmSource: (row._utm_source as string) || undefined,
        submittedDisplay: row.submittedAt || '-',
        // `row.submittedAt` is the formatted display string. The raw ISO lives
        // on `_submitted_iso` (set by the campaign-users row transformation);
        // pass that so `new Date(...)` + date-fns `format` work correctly.
        submittedIso: typeof row._submitted_iso === 'string' ? row._submitted_iso : undefined,
        responseId: row._response_id ?? undefined,
        leadStatus: row._lead_status,
        isDuplicate: row._is_duplicate,
        followUpPriority: row._follow_up_priority,
        tatOverdue: row._tat_overdue,
        tatDueSoon: row._tat_due_soon,
        followUpOverdue: row._follow_up_overdue,
        slaClosed: row._sla_closed,
        tatDueAt: row._tat_due_at,
        tatDueOverridden: row._tat_due_overridden,
        firstResponseAt: row._first_response_at,
        followUpDueAt: row._follow_up_due_at,
        toStudent: () => mapCampaignRowToStudent(row),
    };
};
