/**
 * useLeadDedupSettings — reads the institute lead-uniqueness config subtree
 * persisted at LEAD_SETTING.data.dedup:
 *
 *   { "enabled": false, "field": "EMAIL", "scope": "CAMPAIGN", "audienceIds": [],
 *     "action": "REJECT",
 *     "repeatLead": { "counsellorMode": "SAME_AS_PREVIOUS", "specificCounsellorId": null,
 *                     "specificCounsellorName": null, "statusMode": "KEEP_EXISTING",
 *                     "samePersonByPhone": false, "blockOwnedManualAdd": false,
 *                     "blockOpenLeadManualAdd": false, "alsoMatchEmail": false,
 *                     "reattempt": { "markDuplicate": false, "journeyEntry": false,
 *                                    "notifyOwner": false, "showBadge": false,
 *                                    "followUp": false, "tier": null,
 *                                    "duplicateOpenOnly": true } } }
 *
 * Mirrors the backend defaults in
 * admin_core_service/.../features/audience/service/LeadDedupSettingService.java.
 *
 * Read-only: the Settings card (LeadDedupSettings.tsx) owns the write path and
 * read-modify-writes the WHOLE LEAD_SETTING data object so sibling keys
 * (enabled, scoringWeights, reports, workbench, …) are never clobbered.
 */
import { useQuery } from '@tanstack/react-query';
import { fetchLeadSettingRawData } from '@/hooks/use-lead-report-settings';

export type LeadDedupField = 'EMAIL' | 'PHONE';
/** SELECTED = a specific admin-chosen set of lead lists (audienceIds). */
export type LeadDedupScope = 'CAMPAIGN' | 'SELECTED' | 'INSTITUTE';
/** What happens when a duplicate is found. */
export type LeadDedupAction = 'REJECT' | 'ALLOW_REASSIGN';
/** Counsellor handling for a repeat lead, only read when action === 'ALLOW_REASSIGN'. */
export type RepeatLeadCounsellorMode = 'NONE' | 'SAME_AS_PREVIOUS' | 'SPECIFIC' | 'ROUND_ROBIN';
/**
 * Status handling for a repeat lead, only read when action === 'ALLOW_REASSIGN'.
 * RESET_CLOSED_TO_NEW resets only when the earlier lead is converted or discarded.
 */
export type RepeatLeadStatusMode = 'KEEP_EXISTING' | 'RESET_TO_NEW' | 'RESET_CLOSED_TO_NEW';

/** What a repeat enquiry leaves behind; every switch is off unless set. */
export interface ReattemptSettings {
    /** Flag the new enquiry as a duplicate of the lead it repeats. */
    markDuplicate: boolean;
    /** Write a "Reattempt" entry in that lead's journey. */
    journeyEntry: boolean;
    /** Ring the bell of the lead's counsellor. */
    notifyOwner: boolean;
    /** Show a "Duplicate" badge next to the lead name in lead tables. */
    showBadge: boolean;
    /** Open a priority follow-up for the lead's counsellor; the Follow-ups page lists it first. */
    followUp: boolean;
    /** Institute tier key (Interest Level) to set on the lead, e.g. VERY_HOT; null = keep. */
    tier: string | null;
    /** markDuplicate only while the earlier lead is open (not converted / LOST). Default on. */
    duplicateOpenOnly: boolean;
    /**
     * Duplicates show only on the Duplicate Leads tab; the other lead lists show the lead
     * once, badged. Off = lists unchanged. A route's own duplicates= still wins.
     */
    duplicatesTabOnly: boolean;
}

/** Raw shape persisted at LEAD_SETTING.data.dedup.repeatLead (backend contract). */
export interface RepeatLeadSettingsSubtree {
    counsellorMode?: RepeatLeadCounsellorMode;
    specificCounsellorId?: string | null;
    specificCounsellorName?: string | null;
    statusMode?: RepeatLeadStatusMode;
    samePersonByPhone?: boolean;
    blockOwnedManualAdd?: boolean;
    blockOpenLeadManualAdd?: boolean;
    alsoMatchEmail?: boolean;
    reattempt?: Partial<ReattemptSettings>;
}

export interface RepeatLeadSettings {
    counsellorMode: RepeatLeadCounsellorMode;
    /** Only meaningful when counsellorMode === 'SPECIFIC'. */
    specificCounsellorId: string | null;
    specificCounsellorName: string | null;
    statusMode: RepeatLeadStatusMode;
    /** Match by phone only: a repeat with a new email joins the person who already holds the phone. */
    samePersonByPhone: boolean;
    /** Match by phone only: a counsellor cannot add by hand a phone another counsellor owns. */
    blockOwnedManualAdd: boolean;
    /** A counsellor cannot add by hand a lead that is still open (not converted / discarded). */
    blockOpenLeadManualAdd: boolean;
    /** Match by phone only: an enquiry with a new phone is still a repeat when its email matches a lead. */
    alsoMatchEmail: boolean;
    reattempt: ReattemptSettings;
}

/** Raw shape persisted at LEAD_SETTING.data.dedup (backend contract). */
export interface LeadDedupSettingsSubtree {
    enabled?: boolean;
    field?: LeadDedupField;
    scope?: LeadDedupScope;
    audienceIds?: string[];
    action?: LeadDedupAction;
    repeatLead?: RepeatLeadSettingsSubtree;
}

export interface LeadDedupSettings {
    enabled: boolean;
    field: LeadDedupField;
    scope: LeadDedupScope;
    /** Only meaningful when scope === 'SELECTED'. */
    audienceIds: string[];
    action: LeadDedupAction;
    /** Only meaningful when action === 'ALLOW_REASSIGN'. */
    repeatLead: RepeatLeadSettings;
}

export const REATTEMPT_SETTINGS_DEFAULTS: ReattemptSettings = {
    markDuplicate: false,
    journeyEntry: false,
    notifyOwner: false,
    showBadge: false,
    followUp: false,
    tier: null,
    duplicateOpenOnly: true,
    duplicatesTabOnly: false,
};

export const REPEAT_LEAD_SETTINGS_DEFAULTS: RepeatLeadSettings = {
    counsellorMode: 'SAME_AS_PREVIOUS',
    specificCounsellorId: null,
    specificCounsellorName: null,
    statusMode: 'KEEP_EXISTING',
    samePersonByPhone: false,
    blockOwnedManualAdd: false,
    blockOpenLeadManualAdd: false,
    alsoMatchEmail: false,
    reattempt: REATTEMPT_SETTINGS_DEFAULTS,
};

export const LEAD_DEDUP_SETTINGS_DEFAULTS: LeadDedupSettings = {
    enabled: false,
    field: 'EMAIL',
    scope: 'CAMPAIGN',
    audienceIds: [],
    action: 'REJECT',
    repeatLead: REPEAT_LEAD_SETTINGS_DEFAULTS,
};

export const LEAD_DEDUP_SETTINGS_QUERY_KEY = ['lead-dedup-settings'];

const COUNSELLOR_MODES: RepeatLeadCounsellorMode[] = ['NONE', 'SAME_AS_PREVIOUS', 'SPECIFIC', 'ROUND_ROBIN'];

function withRepeatLeadDefaults(subtree: RepeatLeadSettingsSubtree | undefined): RepeatLeadSettings {
    const counsellorMode =
        subtree?.counsellorMode && COUNSELLOR_MODES.includes(subtree.counsellorMode)
            ? subtree.counsellorMode
            : REPEAT_LEAD_SETTINGS_DEFAULTS.counsellorMode;
    return {
        counsellorMode,
        specificCounsellorId: subtree?.specificCounsellorId ?? null,
        specificCounsellorName: subtree?.specificCounsellorName ?? null,
        statusMode:
            subtree?.statusMode === 'RESET_TO_NEW' || subtree?.statusMode === 'RESET_CLOSED_TO_NEW'
                ? subtree.statusMode
                : 'KEEP_EXISTING',
        samePersonByPhone: subtree?.samePersonByPhone === true,
        blockOwnedManualAdd: subtree?.blockOwnedManualAdd === true,
        blockOpenLeadManualAdd: subtree?.blockOpenLeadManualAdd === true,
        alsoMatchEmail: subtree?.alsoMatchEmail === true,
        reattempt: {
            markDuplicate: subtree?.reattempt?.markDuplicate === true,
            journeyEntry: subtree?.reattempt?.journeyEntry === true,
            notifyOwner: subtree?.reattempt?.notifyOwner === true,
            showBadge: subtree?.reattempt?.showBadge === true,
            followUp: subtree?.reattempt?.followUp === true,
            tier:
                typeof subtree?.reattempt?.tier === 'string' && subtree.reattempt.tier.trim()
                    ? subtree.reattempt.tier.trim()
                    : null,
            duplicateOpenOnly: subtree?.reattempt?.duplicateOpenOnly !== false,
            duplicatesTabOnly: subtree?.reattempt?.duplicatesTabOnly === true,
        },
    };
}

function withDefaults(subtree: LeadDedupSettingsSubtree | undefined): LeadDedupSettings {
    const scope: LeadDedupScope =
        subtree?.scope === 'INSTITUTE' || subtree?.scope === 'SELECTED'
            ? subtree.scope
            : LEAD_DEDUP_SETTINGS_DEFAULTS.scope;
    const audienceIds = subtree?.audienceIds;
    return {
        enabled: subtree?.enabled ?? LEAD_DEDUP_SETTINGS_DEFAULTS.enabled,
        field: subtree?.field === 'PHONE' ? 'PHONE' : LEAD_DEDUP_SETTINGS_DEFAULTS.field,
        scope,
        audienceIds: Array.isArray(audienceIds) ? audienceIds : [],
        action: subtree?.action === 'ALLOW_REASSIGN' ? 'ALLOW_REASSIGN' : 'REJECT',
        repeatLead: withRepeatLeadDefaults(subtree?.repeatLead),
    };
}

export async function fetchLeadDedupSettings(): Promise<LeadDedupSettings> {
    try {
        const raw = await fetchLeadSettingRawData();
        return withDefaults(raw['dedup'] as LeadDedupSettingsSubtree | undefined);
    } catch {
        return LEAD_DEDUP_SETTINGS_DEFAULTS;
    }
}

/**
 * Returns the institute's lead-dedup settings, falling back to disabled
 * defaults on error / missing config so callers never handle undefined.
 */
export function useLeadDedupSettings(options?: { skip?: boolean }): {
    settings: LeadDedupSettings;
    isLoading: boolean;
} {
    const { data, isLoading } = useQuery({
        queryKey: LEAD_DEDUP_SETTINGS_QUERY_KEY,
        queryFn: fetchLeadDedupSettings,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        enabled: !options?.skip,
    });
    return { settings: data ?? LEAD_DEDUP_SETTINGS_DEFAULTS, isLoading };
}
