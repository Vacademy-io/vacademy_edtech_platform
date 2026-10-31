/** B6–B8: CRM actions the engine may propose, and their per-engine settings. */

export type CrmActionType =
    | 'ADD_NOTE'
    | 'CREATE_FOLLOWUP'
    | 'ESCALATE'
    | 'UPDATE_STATUS'
    | 'SCHEDULE_AI_CALL';

/** In the order the backend lists them (EngagementActionTypes.CRM_TYPES). */
export const CRM_ACTION_TYPES: CrmActionType[] = [
    'ADD_NOTE',
    'CREATE_FOLLOWUP',
    'ESCALATE',
    'UPDATE_STATUS',
    'SCHEDULE_AI_CALL',
];

export const isCrmAction = (type?: string | null): type is CrmActionType =>
    !!type && (CRM_ACTION_TYPES as string[]).includes(type);

/** GET/PUT /engines/{id}/actions: one row per action type. */
export interface CrmActionSetting {
    type: CrmActionType;
    allowed: boolean;
    auto: boolean;
    /** Actions of this type a person approved on this engine. */
    approved: number;
    /** Approvals needed before the type may run on its own. */
    threshold: number;
    graduated: boolean;
}

/** A CRM task's variables_json: the brain's fields, and what running it wrote (for undo). */
export interface CrmTaskVariables {
    action?: Record<string, string>;
    result?: Record<string, string>;
    approvedBy?: string;
    approvedByName?: string;
    doneBy?: string;
}

/** GET/PUT /leads/{leadId}/automation. */
export interface LeadAutomation {
    leadId: string;
    doNotAutomate: boolean;
}

/**
 * Where one of the engine's AI calls stands: an inbox task waiting for approval, approved and held
 * for a later time, waiting in the dialer queue, or dialled.
 */
export type UpcomingCallState = 'NEEDS_APPROVAL' | 'SCHEDULED' | 'IN_QUEUE' | 'PLACED';

export interface UpcomingCall {
    actionId: string;
    memberId: string;
    state: UpcomingCallState;
    /** When it is due, its earliest time in the queue (null = as soon as a line is free), or when it was dialled. */
    at?: string | null;
    /** When an approval task or a held call lapses. */
    expiresAt?: string | null;
    rationale?: string | null;
    /** The call's result once placed (COMPLETED, NO_ANSWER, BUSY, FAILED…). */
    callStatus?: string | null;
}

/** GET /engines/{id}/upcoming-calls: the engine page's AI calls card. */
export interface UpcomingCalls {
    /** The AI call channel is on and the engine may propose calls. */
    callingOn: boolean;
    /** The engine is ACTIVE; a paused or draft engine places no call. */
    engineLive: boolean;
    /** AI calls are set to run on their own once graduated. */
    auto: boolean;
    killed: boolean;
    approved: number;
    threshold: number;
    graduated: boolean;
    calls: UpcomingCall[];
    /** The first people, by when the engine next looks at them, whose first touch will be a call. */
    firstCalls: { memberId: string; nextLookAt?: string | null }[];
    firstCallsTotal: number;
}
