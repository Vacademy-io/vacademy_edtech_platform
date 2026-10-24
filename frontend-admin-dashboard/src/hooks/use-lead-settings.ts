/**
 * useLeadSettings — single source of truth for all lead-system config.
 *
 * Reads LEAD_SETTING from the backend (same key saved by LeadSettings.tsx).
 * All lead UI (score badges, tier filters, sidebar tab, walk-in button) must
 * gate itself behind { enabled } from this hook.
 *
 * Usage:
 *   const { enabled, showScoreInEnquiryTable } = useLeadSettings();
 *   if (!enabled) return null;
 */

import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

// ── Types (mirror LeadSettingsData in LeadSettings.tsx) ──────────────────────

export interface LeadScoringWeights {
    sourceQuality: number;
    profileCompleteness: number;
    recency: number;
    engagement: number;
}

/** A "before SLA breach" reminder window. The backend emits triggerKey once when reached. */
export interface BeforeSlaTrigger {
    beforeMinutes: number;
    triggerKey: string;
    stage?: string;
}

export interface TriggerRef {
    triggerKey: string;
    stage?: string;
}

/**
 * TAT (turnaround-time) reminder config. The backend ONLY emits the configured workflow triggers;
 * delivery (email/WhatsApp/push/in-app), templates and escalation are owned by the workflow engine.
 */
export interface TatReminderConfig {
    enabled: boolean;
    tatHours: number;
    beforeTatTriggers: BeforeSlaTrigger[];
    overdueTrigger: TriggerRef;
    /** Institute role names to notify (passed into the trigger context for the workflow to target). */
    notifyRoles?: string[];
}

/** Follow-up SLA config — clock anchored on the counselor's last action (recurring). */
export interface FollowUpConfig {
    enabled: boolean;
    followUpSlaHours: number;
    beforeFollowUpTrigger: BeforeSlaTrigger;
    overdueTrigger: TriggerRef;
    /** Institute role names to notify (passed into the trigger context for the workflow to target). */
    notifyRoles?: string[];
}

/** Institute-defined lead status / pipeline stage. */
export interface CustomLeadStatus {
    key: string;
    label: string;
    color: string;
    order: number;
}

/** Fallback colour for a brand-new status (status colours are arbitrary user-picked hex). */
export const DEFAULT_STATUS_COLOR = '#3b82f6';

/** Sensible starter pipeline shown until an institute customises its own. */
export const DEFAULT_CUSTOM_LEAD_STATUSES: CustomLeadStatus[] = [
    { key: 'NEW', label: 'New', color: '#3b82f6', order: 1 },
    { key: 'CONTACTED', label: 'Contacted', color: '#06b6d4', order: 2 },
    { key: 'INTERESTED', label: 'Interested', color: '#22c55e', order: 3 },
    { key: 'CALLBACK', label: 'Callback Scheduled', color: '#f59e0b', order: 4 },
    { key: 'DEMO_SCHEDULED', label: 'Demo Scheduled', color: '#8b5cf6', order: 5 },
    { key: 'NOT_INTERESTED', label: 'Not Interested', color: '#ef4444', order: 6 },
    { key: 'CONVERTED', label: 'Converted', color: '#16a34a', order: 7 },
];

export interface LeadSettingsConfig {
    /** Institute-wide master toggle. When false, all lead UI is hidden. */
    enabled: boolean;

    scoringWeights: LeadScoringWeights;

    /** Days before recency score starts decaying. */
    recencyDecayDays: number;

    /** Per-table badge visibility flags. */
    showScoreInEnquiryTable: boolean;
    showScoreInContactsTable: boolean;
    showScoreInStudentsTable: boolean;

    /**
     * When true, the unfiltered "All leads" view (Recent Leads + Lead List) hides
     * converted leads. They stay reachable through the "Enrolled / Converted" option,
     * the institute's CONVERTED status and the Lead Board. Off by default.
     */
    hideConvertedInAllLeads: boolean;
    /**
     * Whether the built-in "Enrolled / Converted" option is offered in the Lead Status
     * filter. It is NOT a lead_status row — it filters on conversion_status, which is why
     * it needs its own flag rather than the per-status show_in_filter toggle. Institutes
     * that keep their own CONVERTED status see two near-identical options without this.
     */
    showConvertedFilterOption: boolean;
    /**
     * Keep LOST leads out of every Follow-ups bucket (Today, Upcoming, Overdue, All and
     * Completed). ON by default - an institute that wants them back switches it off in
     * Lead Settings. A sidebar route that names its own statuses still wins.
     */
    hideLostInFollowUps: boolean;

    /** TAT / follow-up SLA reminder configuration (trigger-only; engine handles delivery). */
    tatReminder: TatReminderConfig;
    followUp: FollowUpConfig;
    /** The three dropdowns a counsellor fills when logging a follow-up. Off for
     *  every institute until one turns it on and supplies its own wording. */
    followUpFields: FollowUpFieldsConfig;
    /** The "is this number already ours?" lookup. Off, and blank, until configured. */
    leadLookup: LeadLookupConfig;
    customStatuses: CustomLeadStatus[];

    /**
     * Institute-specific display names for the built-in lead attributes, e.g. an
     * Eduzilla-style institute calling Tier "Interest Level" and Lead Status
     * "Action Label". Empty/missing = the default wording. Read through
     * useLeadTerminology() so every surface agrees.
     */
    labels?: LeadTerminologyLabels;
}

/**
 * Student response / follow-up mode / next action — what a counsellor records
 * when they log a follow-up.
 *
 * The options are the institute's own words, not an enum, because every institute
 * runs a different script. Empty list = that one dropdown is not shown, so an
 * institute can enable just the two it cares about.
 */
export interface FollowUpFieldsConfig {
    /** Gates the three dropdowns below. Does NOT gate {@link notesRequired}. */
    enabled: boolean;
    studentResponses: string[];
    followUpModes: string[];
    nextActions: string[];
    /**
     * How warm the lead sounded on this follow-up ("Very Hot" … "Very Cold").
     * Stored on the follow-up itself, separate from the lead's tier, so the
     * history shows how interest moved call by call.
     */
    interestLevels: string[];
    /**
     * Refuse to save a follow-up with an empty note.
     *
     * Independent of {@link enabled}: an institute can insist on a written note
     * without adopting the dropdowns, or the other way round. Off by default —
     * the note has always been optional and turning it on retroactively would
     * block a counsellor mid-task.
     */
    notesRequired: boolean;
    /**
     * Refuse to save a follow-up until every dropdown the institute configured
     * has an answer.
     *
     * Separate from {@link notesRequired} — an institute can demand the
     * structured answers without demanding prose, or the other way round. Off by
     * default: these fields went out optional, and flipping them to mandatory
     * retroactively would block a counsellor mid-call.
     */
    fieldsRequired: boolean;
    /*
     * The three below change how follow-ups behave, so each is off until an
     * institute turns it on — with all three off a follow-up works exactly as it
     * always has. Independent of {@link enabled}, like notesRequired.
     */
    /** Follow-up pop-ups close only from their X / Cancel, not an outside click or Escape. */
    keepPopupsOpen: boolean;
    /** Follow-up history + created dates in the Lead Profile, reminders, Completed tab and Check Lead. */
    showHistory: boolean;
    /** Counsellors can edit a follow-up's note, closing note and interest level, closed ones included. */
    allowEditing: boolean;
    /** Per-lead TAT / SLA / Overdue CSV exports in the Reports Center. */
    reportExports: boolean;
}

/**
 * Lead lookup — what a counsellor may learn about a lead that isn't theirs.
 *
 * A counsellor only sees their own leads, so searching a colleague's lead finds
 * nothing and they call it as a fresh one. This answers for a single exact phone
 * or email instead of widening the list.
 *
 * Every field starts hidden and the institute ticks what it is willing to share.
 * ADMIN-role users are never masked by this — the backend gives them every field,
 * since they aren't scoped out of lead data anywhere else either.
 */
export interface LeadLookupConfig {
    enabled: boolean;
    fields: LeadLookupFields;
    /**
     * Offer "Full name" alongside phone and email as a way to search.
     *
     * Off by default. Phone and email are things the caller already has in front
     * of them; a name is something they can guess, so this is the one mode that
     * could be used to probe other counsellors' leads. Even on, the backend
     * matches the WHOLE name exactly - never a prefix - so it cannot be walked
     * one letter at a time.
     */
    searchByName: boolean;
    /**
     * Which custom field holds the course. Matched by id so a rename doesn't
     * break it. Blank = the course line is simply not shown; there is no sensible
     * guess, and destination_package_session_id is unset at the institutes that
     * collect the course as a form answer.
     */
    courseFieldId: string;
    /** Which custom field holds the branch. Same rules as {@link courseFieldId}. */
    branchFieldId: string;
}

export interface LeadLookupFields {
    name: boolean;
    email: boolean;
    phone: boolean;
    counsellor: boolean;
    source: boolean;
    campaign: boolean;
    status: boolean;
    course: boolean;
    branch: boolean;
    /** Who entered the lead from the admin panel. */
    enquiredBy: boolean;
}

export const LEAD_LOOKUP_FIELD_KEYS: (keyof LeadLookupFields)[] = [
    'name',
    'email',
    'phone',
    'counsellor',
    'source',
    'campaign',
    'status',
    'course',
    'branch',
    'enquiredBy',
];

export interface LeadTerminologyLabels {
    tier?: string;
    leadStatus?: string;
    /** What this institute calls the audience's channel (default "Campaign type"; many say "Source"). */
    campaignType?: string;
    /** What this institute calls the audience a lead came in through (default "Audience"; I2CAN says "Label"). */
    leadSource?: string;
}

export const LEAD_SETTINGS_DEFAULTS: LeadSettingsConfig = {
    enabled: true,
    scoringWeights: {
        sourceQuality: 25,
        profileCompleteness: 30,
        recency: 25,
        engagement: 20,
    },
    recencyDecayDays: 30,
    showScoreInEnquiryTable: true,
    showScoreInContactsTable: true,
    showScoreInStudentsTable: true,
    hideConvertedInAllLeads: false,
    showConvertedFilterOption: true,
    hideLostInFollowUps: true,
    followUpFields: {
        enabled: false,
        studentResponses: [],
        followUpModes: [],
        nextActions: [],
        interestLevels: [],
        notesRequired: false,
        fieldsRequired: false,
        keepPopupsOpen: false,
        showHistory: false,
        allowEditing: false,
        reportExports: false,
    },
    leadLookup: {
        enabled: false,
        fields: {
            name: false,
            email: false,
            phone: false,
            counsellor: false,
            source: false,
            campaign: false,
            status: false,
            course: false,
            branch: false,
            enquiredBy: false,
        },
        courseFieldId: '',
        branchFieldId: '',
        searchByName: false,
    },
    tatReminder: {
        enabled: false,
        tatHours: 24,
        beforeTatTriggers: [
            { beforeMinutes: 30, triggerKey: 'LEAD_TAT_REMINDER_BEFORE', stage: 'BEFORE_30M' },
        ],
        overdueTrigger: { triggerKey: 'LEAD_TAT_OVERDUE', stage: 'OVERDUE' },
        notifyRoles: [],
    },
    followUp: {
        enabled: false,
        followUpSlaHours: 24,
        beforeFollowUpTrigger: { beforeMinutes: 30, triggerKey: 'FOLLOW_UP_DUE' },
        overdueTrigger: { triggerKey: 'FOLLOW_UP_OVERDUE' },
        notifyRoles: [],
    },
    customStatuses: DEFAULT_CUSTOM_LEAD_STATUSES,
    labels: {},
};

// ── Fetcher ──────────────────────────────────────────────────────────────────

const SETTING_KEY = 'LEAD_SETTING';

/**
 * Pull the saved config out of a `/institute/setting/v1/get` response.
 *
 * The endpoint answers with the SettingDto itself — `{key, name, data}` — so the config lives
 * at `response.data.data`, which is what every other settings hook reads. This hook used to
 * read `response.data.data[SETTING_KEY].data`, a shape the endpoint never returns, so the
 * lookup was always undefined and EVERY institute silently fell back to
 * {@link LEAD_SETTINGS_DEFAULTS}: renamed Tier / Lead-status labels never reached the UI and
 * per-table score visibility was ignored. The nested shape is still tried first so a wrapped
 * payload would keep working.
 */
export function extractLeadSettingData(
    responseBody: unknown
): Partial<LeadSettingsConfig> | undefined {
    if (!responseBody || typeof responseBody !== 'object') return undefined;
    const body = responseBody as Record<string, unknown>;
    const nested = (body.data as Record<string, unknown> | undefined)?.[SETTING_KEY] as
        | { data?: Partial<LeadSettingsConfig> }
        | undefined;
    if (nested?.data && typeof nested.data === 'object') return nested.data;
    const direct = body.data;
    if (direct && typeof direct === 'object') return direct as Partial<LeadSettingsConfig>;
    return undefined;
}

/**
 * Coerce the three option lists to arrays of strings.
 *
 * This subtree gets hand-written into institutes.setting_json when a new institute
 * is onboarded, so a stray null or a string where a list belongs is a live
 * possibility — and `.length` on it would take down every follow-up form and the
 * whole Completed tab, for a config the UI never validated.
 */
export function normaliseFollowUpFields(
    saved: Partial<FollowUpFieldsConfig> | undefined
): FollowUpFieldsConfig {
    const list = (value: unknown): string[] =>
        Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    return {
        enabled: saved?.enabled === true,
        studentResponses: list(saved?.studentResponses),
        followUpModes: list(saved?.followUpModes),
        nextActions: list(saved?.nextActions),
        interestLevels: list(saved?.interestLevels),
        notesRequired: saved?.notesRequired === true,
        fieldsRequired: saved?.fieldsRequired === true,
        keepPopupsOpen: saved?.keepPopupsOpen === true,
        showHistory: saved?.showHistory === true,
        allowEditing: saved?.allowEditing === true,
        reportExports: saved?.reportExports === true,
    };
}

/**
 * Coerce the lookup config. Same reason as {@link normaliseFollowUpFields}: this
 * is hand-written into institutes.setting_json during onboarding, and a missing
 * `fields` object would make every `fields.name` read throw.
 */
export function normaliseLeadLookup(
    saved: Partial<LeadLookupConfig> | undefined
): LeadLookupConfig {
    const savedFields = (saved?.fields ?? {}) as Partial<LeadLookupFields>;
    const fields = {} as LeadLookupFields;
    for (const key of LEAD_LOOKUP_FIELD_KEYS) {
        // Only a real boolean true shares a field — a stray "true" string must not.
        fields[key] = savedFields[key] === true;
    }
    return {
        enabled: saved?.enabled === true,
        fields,
        courseFieldId: typeof saved?.courseFieldId === 'string' ? saved.courseFieldId : '',
        branchFieldId: typeof saved?.branchFieldId === 'string' ? saved.branchFieldId : '',
        searchByName: saved?.searchByName === true,
    };
}

/** Merge saved config over the defaults, keeping nested groups whole. */
export function mergeLeadSettings(
    saved: Partial<LeadSettingsConfig> | undefined
): LeadSettingsConfig {
    if (!saved) return LEAD_SETTINGS_DEFAULTS;
    return {
        ...LEAD_SETTINGS_DEFAULTS,
        ...saved,
        // Nested groups are spread so a partially-saved blob can't drop a weight or a flag.
        scoringWeights: {
            ...LEAD_SETTINGS_DEFAULTS.scoringWeights,
            ...(saved.scoringWeights ?? {}),
        },
        tatReminder: { ...LEAD_SETTINGS_DEFAULTS.tatReminder, ...(saved.tatReminder ?? {}) },
        followUp: { ...LEAD_SETTINGS_DEFAULTS.followUp, ...(saved.followUp ?? {}) },
        // On unless explicitly switched off - a blob saved before this flag existed has no key.
        hideLostInFollowUps: saved.hideLostInFollowUps !== false,
        followUpFields: normaliseFollowUpFields(saved.followUpFields),
        leadLookup: normaliseLeadLookup(saved.leadLookup),
        labels: { ...(LEAD_SETTINGS_DEFAULTS.labels ?? {}), ...(saved.labels ?? {}) },
    };
}

async function fetchLeadSettings(): Promise<LeadSettingsConfig> {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return LEAD_SETTINGS_DEFAULTS;
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: GET_INSITITUTE_SETTINGS,
            params: { instituteId, settingKey: SETTING_KEY },
        });
        return mergeLeadSettings(extractLeadSettingData(response.data));
    } catch {
        return LEAD_SETTINGS_DEFAULTS;
    }
}

/** status_key of the system "Lost" status. Seeded for every institute; only the label varies. */
export const LOST_STATUS_KEY = 'LOST';

/**
 * The lead-status filter a Follow-ups request should carry.
 *
 * The sidebar route's own `status` comes first. With `hideLost` on, LOST is added to an
 * exclude list (or becomes one when the route names nothing); a route that INCLUDES
 * specific statuses is left alone, since it already decides what shows - including a
 * route that asks for LOST on purpose.
 */
export function followUpStatusFilter(
    routeStatusKeys: string,
    routeExcludes: boolean,
    hideLost: boolean
): { leadStatusId?: string; leadStatusExcludeId?: string } {
    if (routeStatusKeys && !routeExcludes) return { leadStatusId: routeStatusKeys };
    const keys = routeStatusKeys ? routeStatusKeys.split(',') : [];
    if (hideLost && !keys.includes(LOST_STATUS_KEY)) keys.push(LOST_STATUS_KEY);
    return keys.length ? { leadStatusExcludeId: keys.join(',') } : {};
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the institute's lead settings config.
 * Falls back to safe defaults on error or missing setting so callers never
 * need to handle undefined.
 *
 * @param options.skip  Set to true in contexts where lead settings are irrelevant
 *                      (e.g. learner portal). Skips the network request.
 */
export function useLeadSettings(options?: { skip?: boolean }): LeadSettingsConfig & {
    isLoading: boolean;
} {
    const { data, isLoading } = useQuery({
        queryKey: ['lead-settings-config'],
        queryFn: fetchLeadSettings,
        staleTime: 5 * 60 * 1000, // 5 minutes — settings change rarely
        gcTime: 10 * 60 * 1000,
        enabled: !options?.skip,
    });

    return {
        ...(data ?? LEAD_SETTINGS_DEFAULTS),
        isLoading,
    };
}
