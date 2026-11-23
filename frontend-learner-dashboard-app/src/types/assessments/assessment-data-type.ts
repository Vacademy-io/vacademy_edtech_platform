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

interface RegistrationFormField {
  id: string;
  fieldName: string;
  fieldKey: string;
  commaSeparatedOptions: string;
  status: string;
  isMandatory: boolean;
  fieldType: string;
  createdAt: string;
  updatedAt: string;
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

export interface SavedData {
  instructions: Instructions;
  reattempt_consent: boolean;
  evaluation_type: string;
  assessment_id: string;
  assessment_visibility: string;
  expected_participants: string | null;
  duration_distribution: "ASSESSMENT" | "QUESTION" | "SECTION";
  omr_mode: string | null;
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
  [key: string]: "REQUIRED" | "OPTIONAL" | "";
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
interface Option {
  option_id: string; // UUID
  option_name: string;
}

interface Question {
  question_id: string; // UUID
  question_name: string;
  student_response_options: Option[];
  correct_options: Option[];
  explanation_id: string; // UUID
  explanation: string;
  mark: number;
  time_taken_in_seconds: number;
  answer_status: string;
  question_type: string;
  evaluator_feedback?: string | null;
}

interface AllSections {
  [sectionId: string]: Question[]; // Dynamic section ID as key
}

interface QuestionOverallDetailDTO {
  completionTimeInSeconds: number;
  totalCorrectMarks: number;
  totalIncorrectMarks: number;
  rank: number;
  achievedMarks: number;
  percentile: number;
  wrongAttempt: number;
  skippedCount: number;
  totalPartialMarks: number;
  startTime: string; // ISO date string
  subjectId: string; // UUID
  attemptId: string; // UUID
  correctAttempt: number;
  partialCorrectAttempt: number;
  userId: string; // UUID
}

export interface Report {
  assessment_id: string;
  attempt_id: string;
  assessment_name: string;
  assessment_status: string;
  attempt_date: string;
  subject_id: string;
  duration_in_seconds: number;
  total_marks: number;
  evaluation_type: string;
  start_time: string;
  end_time: string;
  sections: AllSections;
  play_mode: string;
  report_release_status: string;
  // Set by the server only for a RELEASED attempt whose marks a teacher changed
  // after release (learner "Revised" tag). Absent on older servers.
  result_revised_at?: string | null;
}
export interface ParsedHistoryState {
  report?: Report;
  evaluationType?: string;
}
export interface AssessmentTestReport {
  all_sections: AllSections;
  // The checked/annotated copy the evaluator produced.
  evaluated_file_id: string;
  // The learner's own submitted answer sheet (attempt_data "fileId").
  response_file_id?: string | null;
  // A result report uploaded by the institute (offline data entry). When set it
  // replaces the platform-generated report on download.
  report_file_id?: string | null;
  question_overall_detail_dto: QuestionOverallDetailDTO;
  // When a teacher changed a mark after release (only sent once released).
  result_revised_at?: string | null;
}
export interface TestReportDialogProps {
  testReport: AssessmentTestReport | null;
  examType: string | undefined;
  assessmentDetails: StepData[];
  evaluationType: string;
}

export interface ConvertedCustomField {
  name: string;
  type: string;
  default_value: string;
  description: string;
  is_mandatory: boolean;
  key: string;
  comma_separated_options: string;
}

// Assuming customFields is an object where keys are strings and values are the custom field details
export type CustomFields = {
  type: string;
  name: string;
  oldKey: boolean;
  isRequired: boolean;
  options?: { id: number; value: string }[];
  default_value?: string;
  description?: string;
  key?: string;
  is_mandatory?: boolean;
}[];

export type Steps = StepData[];
