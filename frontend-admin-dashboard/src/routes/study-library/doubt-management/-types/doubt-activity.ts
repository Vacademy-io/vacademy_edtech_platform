export type DoubtActivityAction =
    | 'CREATED'
    | 'ASSIGNED'
    | 'UNASSIGNED'
    | 'STATUS_CHANGED'
    | 'REMARK';
export type DoubtActivityActorType = 'USER' | 'RULE' | 'SYSTEM';

/** One audit-trail row from GET /doubts/{id}/activity. Staff-only; learners never receive these. */
export interface DoubtActivity {
    id: string;
    doubt_id: string;
    action: DoubtActivityAction;
    actor_type: DoubtActivityActorType;
    /** Who did it (USER rows). */
    actor_user_id?: string | null;
    /** Who was (un)assigned. */
    target_user_id?: string | null;
    /** Previous workflow status key (STATUS_CHANGED). */
    from_value?: string | null;
    /** New status key, or the status a remark was left on. */
    to_value?: string | null;
    /**
     * Routing rule for RULE rows: `TYPE:<type>:<source>[:<role>]`, `DEFAULT:<source>`, `SUB_ORG`,
     * `ADMIN_FALLBACK`; `DEFAULT_EXCLUDED` on an UNASSIGNED row means a default pill was removed.
     */
    rule_source?: string | null;
    remark?: string | null;
    created_at: string;
}
