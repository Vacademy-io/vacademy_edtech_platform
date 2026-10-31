import type { ProctoringConfigWire } from './proctoring';
export interface Instructions {
    id: string;
    type: string;
    content: string;
}

interface AccessControl {
    batch_ids: string[] | null;
    roles: string[] | null;
    user_ids: string[];
}
export interface RegistrationFormField {
    id: string;
    field_name: string;
    field_key: string;
    comma_separated_options: string;
    status: string;
    is_mandatory: boolean;
    field_type: string;
    created_at: string;
    updated_at: string;
    field_order: number;
    /** Per-field settings as a JSON string (help text, default value, ...). */
    config?: string | null;
}

interface PreBatchRegistration {
    id: string;
    batchId: string;
    instituteId: string;
    registrationTime: string;
    status: string;
    createdAt: string;
    updatedAt: string;
}

interface AssessmentNotification {
    id: string;
    participant_when_assessment_created: boolean;
    participant_show_leaderboard: boolean;
    participant_before_assessment_goes_live: number;
    participant_when_assessment_live: boolean;
    parent_when_assessment_created: boolean;
    parent_show_leaderboard: boolean;
    parent_before_assessment_goes_live: number;
    parent_when_assessment_live: boolean;
    when_student_appears: boolean;
    when_student_finishes_test: boolean;
    participant_when_assessment_report_generated: boolean;
    parent_when_assessment_report_generated: boolean;
    created_at: string; // ISO date string
    updated_at: string; // ISO date string
}

export interface SavedData {
    instructions: Instructions;
    reattempt_consent: boolean;
    evaluation_type: string;
    assessment_id: string;
    assessment_visibility: string;
    expected_participants: string | null;
    duration_distribution: 'ASSESSMENT' | 'QUESTION' | 'SECTION';
    /** OMR sheet (pen & paper) mode; the backend sends a Boolean (null on older assessments). */
    omr_mode: boolean | null;
    boundation_end_date: string;
    assessment_url: string;
    duration: number;
    boundation_start_date: string;
    can_switch_section: boolean;
    add_time_consent: boolean;
    submission_type: string;
    subject_selection: string;
    assessment_mode: string;
    name: string;
    reattempt_count: number | null;
    assessment_preview: number;
    sections?: Section[];
    creation_access: AccessControl;
    report_and_submission_access: AccessControl;
    live_assessment_access: AccessControl;
    evaluation_access: AccessControl;
    pre_user_registrations: number;
    registration_form_fields: RegistrationFormField[];
    registration_open_date: string | null;
    pre_batch_registrations: PreBatchRegistration[];
    registration_close_date: string | null;
    notifications: AssessmentNotification;
    /** Effective proctoring config (V48). Absent/NONE on older assessments. */
    proctoring_config?: ProctoringConfigWire | null;
}

export interface Section {
    id: string;
    name: string;
    description: {
        id: string;
        type: string;
        content: string;
    } | null;
    section_type: string | null;
    duration: number;
    total_marks: number;
    cutoff_marks: number;
    section_order: number;
    problem_randomization: boolean | null | string;
    partial_marking: boolean | null;
    created_at: string; // ISO date string
    updated_at: string; // ISO date string
}

export interface SectionsResponse {
    sections: Section[];
}

interface StepKey {
    [key: string]: 'REQUIRED' | 'OPTIONAL' | '';
}

interface DefaultValue {
    key: string;
    value: string;
    value_id: string | null;
    send_value_id: boolean;
}

interface FieldOption {
    key: string;
    value: string;
    value_id: string | null;
    send_value_id: boolean;
}

interface StepData {
    step_name: string;
    status: string;
    institute_id: string | null;
    type: string;
    saved_data: SavedData;
    step_keys: StepKey[];
    default_values?: Record<string, DefaultValue>;
    field_options?: Record<string, FieldOption[]>;
}

export interface ConvertedCustomField {
    id: string;
    name: string;
    type: string;
    default_value: string;
    description: string;
    is_mandatory: boolean;
    key: string;
    comma_separated_options: string;
    /** Per-field settings as a JSON string (help text, default value, ...). */
    config?: string;
    /**
     * Maps to RegistrationFieldDto.orderField. Optional on purpose: omitting it
     * lets the server keep the stored field_order. Sending 0 for a legacy row
     * with a NULL order would jump it to the top of the public form.
     */
    order_field?: number;
}

export interface CustomFieldStep3 {
    id: string;
    type: string;
    name: string;
    oldKey: boolean;
    isRequired: boolean;
    options?: { id: string; value: string }[];
    default_value?: string;
    description?: string;
    key: string;
    is_mandatory?: boolean;
    /** Per-field settings as a JSON string (help text, default value, ...). */
    config?: string;
    /** Position in the registration form; kept in sync by updateFieldOrders on drag. */
    order?: number;
}

// Assuming customFields is an object where keys are strings and values are the custom field details
export type CustomFields = {
    id: string;
    type: string;
    name: string;
    oldKey: boolean;
    isRequired: boolean;
    options?: { id: string; value: string }[];
    default_value?: string;
    description?: string;
    /** Per-field settings as a JSON string (help text, default value, ...). */
    config?: string;
    key?: string;
    is_mandatory?: boolean;
    order: number;
}[];

export interface Step3StudentDetailInterface {
    username: string;
    user_id: string;
    email: string;
    full_name: string;
    mobile_number: string;
    guardian_email: string;
    guardian_mobile_number: string;
    file_id: string;
    reattempt_count: number;
}

export interface NotificationStep3 {
    when_assessment_created: boolean;
    show_leaderboard?: boolean;
    before_assessment_goes_live: {
        checked: boolean;
        value: string; // Assuming value is a string that needs to be converted to a number
    };
    when_assessment_live: boolean;
    when_assessment_report_generated: boolean;
}

export type Steps = StepData[];
