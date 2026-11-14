export interface DoubtAssignee {
    id: string;
    source_id: string;
    source: string;
    status: string;
}

export type DoubtStatusKind = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export interface DoubtLearnerStatus {
    key: string;
    label: string;
    kind: DoubtStatusKind;
}

export interface DoubtType {
    id?: string;
    user_id: string;
    name: string;
    source: 'video' | string;
    source_id: string;
    /** Configurable query type key (DOUBT, TECHNICAL, PAYMENT, ...). Absent ⇒ DOUBT. */
    type?: string;
    /** Owning institute — required for GENERAL queries (no batch). */
    institute_id?: string;
    /** Guest contact (logged-out queries — user_id is null/empty for these). */
    guest_name?: string;
    guest_email?: string;
    raised_time: string; // ISO 8601 timestamp
    resolved_time: string | null; // ISO 8601 timestamp
    content_position: string; // Format: HH:MM:SS
    content_type: string;
    html_text: string;
    // Backend only ever emits ACTIVE | RESOLVED | DELETED; non-RESOLVED renders as "Pending" in UI.
    status: 'ACTIVE' | 'RESOLVED' | 'DELETED';
    /**
     * Configurable workflow status key (PENDING / RESOLVED built in; IN_PROGRESS etc. from
     * settings). Response: always set on top-level doubts. Request: set to move the doubt; the
     * backend derives `status` from the status's kind.
     */
    workflow_status?: string;
    /** Request only: a note for the activity trail (attached to a status change when one happens). */
    remark?: string;
    /** Response only: the learner-facing label/kind for the current status. */
    learner_status?: DoubtLearnerStatus;
    parent_id: string | null;
    parent_level: number;
    doubt_assignee_request_user_ids: string[];
    all_doubt_assignee: DoubtAssignee[];
    delete_assignee_request: string[];
    excluded_assignee_user_ids?: string[];
}

export interface StudentDetailsType {
    address_line: string;
    city: string;
    created_at: string; // ISO timestamp
    date_of_birth: string | null; // Can be null
    email: string;
    expiry_date: string; // ISO timestamp
    face_file_id: string | null;
    father_name: string;
    full_name: string;
    gender: string;
    id: string;
    institute_enrollment_id: string;
    institute_id: string;
    linked_institute_name: string;
    mobile_number: string;
    mother_name: string;
    package_session_id: string;
    parents_email: string;
    parents_mobile_number: string;
    parents_to_mother_email: string | null;
    parents_to_mother_mobile_number: string | null;
    pin_code: string;
    region: string | null;
    session_expiry_days: number | null;
    status: string;
    updated_at: string; // ISO timestamp
    user_id: string;
    username: string;
}
