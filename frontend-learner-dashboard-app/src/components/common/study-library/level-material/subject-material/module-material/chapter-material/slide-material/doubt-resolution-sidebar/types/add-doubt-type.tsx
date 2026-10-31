export interface DoubtType {
    user_id: string;
    name: string;
    source: 'video' | string;
    source_id: string;
    /** Configurable query type key (DOUBT, TECHNICAL, PAYMENT, ...). Absent ⇒ DOUBT. */
    type?: string;
    /** Owning institute — required for GENERAL queries that have no batch. */
    institute_id?: string;
    raised_time: string; // ISO 8601 timestamp
    resolved_time: string | null; // ISO 8601 timestamp
    content_position: string | null; // Format: HH:MM:SS
    content_type: string;
    html_text: string;
    status: 'ACTIVE' | 'RESOLVED' | 'DELETED';
    /**
     * Read-only, from the server: what the learner should be shown for the doubt's current
     * (institute-configurable) status — a clean label plus its kind. Echoed back untouched on
     * updates; the backend ignores it.
     */
    learner_status?: DoubtLearnerStatus | null;
    /** Read-only echo of the configurable status key; never set it from the learner app. */
    workflow_status?: string | null;
    parent_id: string | null;
    parent_level: number;
    doubt_assignee_request_user_ids: string[];
    batch_id: string;
    id?:string;
  }

  export type DoubtLearnerStatusKind = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

  export interface DoubtLearnerStatus {
    key: string;
    label: string;
    kind: DoubtLearnerStatusKind;
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
  