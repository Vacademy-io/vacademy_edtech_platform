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
