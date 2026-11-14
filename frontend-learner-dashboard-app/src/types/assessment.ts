import type { ExamInterface } from "./exam-theme";

export type Assessment = {
  assessment_id: string;
  name: string;
  about_id: string | null;
  instruction_id: string;
  play_mode: string;
  evaluation_type: string;
  submission_type: string;
  duration: number;
  assessment_visibility: string;
  status: string;
  registration_close_date: string | null;
  registration_open_date: string | null;
  expected_participants: number | null;
  cover_file_id: string | null;
  bound_start_time: string;
  bound_end_time: string;
  created_at: string;
  updated_at: string;
  recent_attempt_status: string | null;
  recent_attempt_start_date: string | null;
  assessment_attempts: number;
  user_attempts: number | null;
  created_attempts: number | null;
  preview_time: number;
  last_attempt_id: string | null;
  assessment_user_registration_id: string | null;
  can_switch_section: boolean;
  result_type: string | null;
  report_release_status: string | null;
  batch_id?: string;
  package_session_id?: string;
};
export interface QuestionState {
  isAnswered: boolean;
  isVisited: boolean;
  isMarkedForReview: boolean;
  isDisabled: boolean;
}
export enum assessmentTypes {
  LIVE = "LIVE",
  UPCOMING = "UPCOMING",
  PAST = "PAST",
}

export interface AssessmentPreviewData {
  preview_total_time: number;
  can_switch_section: boolean;
  distribution_duration: distribution_duration_types;
  duration: number;
  section_dtos: SectionDto[];
  attempt_id: string;
  assessment_user_registration_id: string;
  /**
   * Exam screen chosen for this assessment (start and resume previews).
   * null or absent = the default screen; see `types/exam-theme.ts`.
   */
  exam_interface?: ExamInterface | null;
}
export enum distribution_duration_types {
  ASSESSMENT = "ASSESSMENT",
  SECTION = "SECTION",
  QUESTION = "QUESTION",
}
export interface SectionDto {
  id: string;
  name: string;
  description: Description;
  section_type: string;
  duration: number;
  total_marks: number;
  cutoff_marks: number;
  section_order: number;
  problem_randomization: string;
  status: string;
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
  question_preview_dto_list: QuestionDto[];
}

export interface Description {
  id: string;
  type: string;
  content: string;
}

export interface QuestionDto {
  question_id: string;
  parent_rich_text: RichText;
  question: RichText;
  section_id: string;
  question_duration: number;
  question_order: number;
  serial_number: number;
  marking_json: string;
  evaluation_json: string;
  question_type: QUESTION_TYPES;
  options: Option[];
  options_with_explanation: OptionWithExplanation[];
}
export enum QUESTION_TYPES {
  MCQS = "MCQS",
  ONE_WORD = "ONE_WORD",
  LONG_ANSWER = "LONG_ANSWER",
  TRUE_FALSE = "TRUE_FALSE",
  MATCH = "MATCH",
  MCQM = "MCQM",
  FILL_IN_THE_BLANK = "FILL_IN_THE_BLANK",
  NUMERIC = "NUMERIC",
  CODING = "CODING",
  /** Spreadsheet & Written Response (docs/CBE_RESPONSE_QUESTION.md). */
  CBE_RESPONSE = "CBE_RESPONSE",
};

export interface RichText {
  id: string;
  type: string;
  content: string;
}

export interface Option {
  id: string;
  preview_id: string;
  question_id: string;
  text: RichText;
  media_id: string;
  option_order: number;
  created_on: string;
  updated_on: string;
}

export interface OptionWithExplanation extends Option {
  explanation_text: RichText;
}

export interface UpdateApiResponse {
  announcements: {
    id: string;
    rich_text_id: string;
    sent_time: string; // Use Date if you plan to convert it
  }[];
  duration: {
    id: string;
    type: string;
    new_max_time: string;
  }[];
  control: string[];
}

