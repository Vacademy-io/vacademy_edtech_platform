import { MIGRATE_AUDIENCE_LEADS } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

/**
 * Move leads from one lead list to another.
 *
 * A lead list is an audience; a lead is one audience_response attached to it. Moving updates that
 * attachment, and everything keyed by the response — status history, follow-ups, calls, notes,
 * timeline — travels with it.
 */

/**
 * What a migration acts on.
 * - `RESPONSE`: just the given responses (what a row, or a bulk selection, represents).
 * - `USER`: every lead those people hold in this institute.
 */
export type LeadMigrateScope = 'RESPONSE' | 'USER';

/**
 * How the move should treat the TARGET list's automation.
 *
 * Workflows select leads by list plus a date anchor that is only ever set when a lead is created.
 * That makes this a real choice rather than an implementation detail:
 *
 * - `PRESERVE` (default): keep the anchor. The old list's drip stops and the stale anchor will not
 *   match the new list's windows, so the lead is not messaged. Right for fixing a misrouted form,
 *   archiving to a cold list, or quarantining junk.
 * - `RESET_TO_TARGET`: treat the lead as though it had just been created in the target list: its
 *   "Lead Submitted" workflows fire now (AI calls, instant messages) and its scheduled sequence
 *   runs from day zero. This CALLS AND MESSAGES — it is the re-engagement case.
 */
export type LeadWorkflowAnchor = 'PRESERVE' | 'RESET_TO_TARGET';

/** Why a lead was left where it was. Mirrors the backend's SkipReason. */
export type LeadMigrateSkipReason =
    | 'ALREADY_IN_TARGET_LIST'
    | 'DUPLICATE_USER_IN_TARGET'
    | 'DUPLICATE_IN_TARGET'
    | 'LEAD_CONVERTED'
    | 'OPTED_OUT'
    | 'IN_OPT_OUT_LIST'
    | 'LEAD_DELETED';

export interface LeadMigrateSkipped {
    response_id: string;
    reason: LeadMigrateSkipReason;
    detail?: string;
}

export interface LeadMigrateResult {
    migrated: number;
    skipped: LeadMigrateSkipped[];
}

export interface LeadMigrateParams {
    responseIds: string[];
    targetAudienceId: string;
    instituteId: string;
    scope?: LeadMigrateScope;
    workflowAnchor?: LeadWorkflowAnchor;
    /**
     * Fire the target list's EVENT-driven automations (its "Lead Submitted" workflows — AI
     * calls, instant WhatsApp/email) for each moved lead. `RESET_TO_TARGET` implies this on the
     * backend; the dialog sends it explicitly so the request reads the same as the UI.
     */
    runDestinationAutomations?: boolean;
}

/** Short, human-readable labels for the skip reasons, for the result summary. */
export const MIGRATE_SKIP_LABELS: Record<LeadMigrateSkipReason, string> = {
    ALREADY_IN_TARGET_LIST: 'Already in this list',
    DUPLICATE_USER_IN_TARGET: 'Already has a lead in this list',
    DUPLICATE_IN_TARGET: 'Duplicate under your dedup rule',
    LEAD_CONVERTED: 'Already converted',
    OPTED_OUT: 'Opted out of contact',
    IN_OPT_OUT_LIST: 'In the opt-out list',
    LEAD_DELETED: 'Deleted — restore it first',
};

/**
 * Partial success by design: the response says how many moved and which did not. Merging two
 * lists collides routinely (the same person is in both), so collisions are reported rather than
 * failing the batch.
 */
export const migrateAudienceLeads = async ({
    responseIds,
    targetAudienceId,
    instituteId,
    scope = 'RESPONSE',
    workflowAnchor = 'PRESERVE',
    runDestinationAutomations = false,
}: LeadMigrateParams): Promise<LeadMigrateResult> => {
    if (!responseIds?.length) {
        throw new Error('At least one lead is required to move.');
    }
    if (!targetAudienceId) {
        throw new Error('Pick a lead list to move these leads into.');
    }
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: MIGRATE_AUDIENCE_LEADS,
        data: {
            response_ids: responseIds,
            target_audience_id: targetAudienceId,
            institute_id: instituteId,
            scope,
            workflow_anchor: workflowAnchor,
            run_destination_automations: runDestinationAutomations,
        },
    });
    return {
        migrated: response?.data?.migrated ?? 0,
        skipped: response?.data?.skipped ?? [],
    };
};
