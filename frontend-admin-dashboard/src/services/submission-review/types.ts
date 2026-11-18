export type MarkState = 'NOT_ANSWERED' | 'NEEDS_MARKING' | 'AI_DRAFT' | 'MARKED';
export type MarkedByKind = 'ANSWER_KEY' | 'KEYWORD' | 'AI' | 'AI_REVIEWED' | 'TEACHER' | 'TEACHER_LEGACY' | 'OMR' | 'OFFLINE' | 'NONE';
export type MarkingStatus = 'NOT_SUBMITTED' | 'NEEDS_MARKING' | 'AI_CHECKING' | 'CHECK_AI' | 'DONE' | 'TOTAL_ONLY';
export type ResultView = 'NOT_RELEASED' | 'RELEASED' | 'RELEASED_CHANGED';
export type SubmissionKind = 'ONLINE' | 'HANDWRITTEN' | 'SCANNED' | 'OMR' | 'OFFLINE' | 'HOMEWORK';
export interface PersonRef { user_id: string; name: string | null }
export interface QuestionRow {
    key: string; section_id: string; question_id: string; question_order: number; question_number: number;
    question_type: string; marks: number; max_marks: number | null; min_marks: number;
    state: MarkState; state_stored: boolean; marks_source: string | null; marked_by_kind: MarkedByKind;
    marked_by: PersonRef | null; marked_at: string | null; revision: number; has_feedback: boolean;
    ai_checking: boolean; ai_failed_reason: string | null; counted: boolean; answer_pages: string | null;
    changed_after_release: boolean; history_count: number;
}
export interface ReleaseInfo {
    status: 'NOT_RELEASED' | 'RELEASED'; released_at: string | null; token: string;
    changed_since_release: boolean; unmarked_at_release: number; result_revised_at: string | null;
    marks_revision: number; notified_revision: number | null; release_when_marked: boolean;
}
export interface MarkCounts { not_answered: number; needs_marking: number; ai_draft: number; marked: number; ai_checking: number; ai_failed: number; not_counted: number }
export interface SubmissionOutline {
    attempt_id: string; assessment_id: string; assessment_name: string; institute_id: string;
    kind: SubmissionKind; evaluation_type: string; result_type: string | null;
    learner: { user_id: string; name: string; username: string | null; email: string | null };
    attempt_number: number; attempts_total: number; submitted_at: string | null; status: string;
    result_status: string | null; marking: MarkingStatus; total: number; max_total: number | null;
    stored_total: number | null; total_only: boolean; response_file_id: string | null; evaluated_file_id: string | null;
    release: ReleaseInfo; counts: MarkCounts;
    ai_run: { process_id: string; status: string; lane: string; questions_completed: number | null; questions_total: number | null; started_at: string | null; error_message: string | null } | null;
    permissions: { can_edit: boolean; can_edit_after_release: boolean; can_release: boolean; can_force_answer_key: boolean };
    sections: { section_id: string; name: string; order: number; total: number; max: number | null; questions: QuestionRow[] }[];
}
export interface CriterionBreakdown { criteria_name: string; marks: number | null; max_marks: number | null; reason: string | null }
export interface QuestionDetail {
    row: QuestionRow; response_json: string | null; auto_evaluation_json: string | null;
    answer: { kind: 'OPTIONS' | 'TEXT' | 'NUMERIC' | 'CODE' | 'CBE' | 'HANDWRITTEN' | 'NONE'; chosen_option_ids: string[]; correct_option_ids: string[]; text: string | null; correct_text: string | null; code: { language: string | null; source: string | null; verdict: string | null } };
    evaluator_feedback: string | null; part_marks: { criterion: string; marks: number; max: number | null }[];
    scheme_points: { name: string; max: number | null; source: 'CBE' | 'AI_BREAKDOWN' }[];
    ai: { process_id: string | null; ai_question_evaluation_id: string | null; status: string | null; marks_awarded: number | null; max_marks: number | null; feedback: string | null; extracted_answer: string | null; criteria_breakdown: CriterionBreakdown[]; rubric_version: number | null; is_edited: boolean; edited_by: string | null; edited_at: string | null; page_ids: string[]; teacher_changed_total: boolean } | null;
    suggestion: null; released_value: null;
}
export interface MarkEventView {
    id: string; created_at: string; event_type: string; section_id: string | null; question_id: string | null;
    old_marks: number | null; new_marks: number | null; max_marks: number | null; old_source: string | null; new_source: string | null;
    old_state: string | null; new_state: string | null; old_feedback: string | null; new_feedback: string | null; reason: string | null;
    actor_type: 'TEACHER' | 'AI' | 'SYSTEM'; actor: PersonRef | null; after_release: boolean; payload: Record<string, unknown> | null;
}
export interface HistoryResponse { events: MarkEventView[]; legacy_logs: { author: PersonRef | null; created_at: string; type: string }[] }
export interface EditMarksRequest {
    marks?: number; part_marks?: { criterion: string; marks: number; max?: number | null }[]; feedback?: string | null;
    reason?: string | null; notify_learner?: boolean; expected_revision: number; expected_release: string;
    preview?: boolean; not_answered?: boolean;
    annotation_edits?: { style: string; target: string; page_id: string; text: string; action: 'EDIT' | 'DELETE'; new_text?: string }[];
}
export interface EditMarksResponse { row: QuestionRow; total_before: number; total_after: number; max_total: number | null; total_recomputed: { stored_total: number; r6_before: number } | null; release: ReleaseInfo; update_queued: boolean; preview: boolean }
export interface QuickMarksItem { section_id: string; question_id: string; marks?: number; feedback?: string | null; not_answered?: boolean; expected_revision?: number }
export interface QuickMarksResponse { rows: QuestionRow[]; changed: number; total_before: number; total_after: number; max_total: number | null; total_recomputed: EditMarksResponse['total_recomputed']; release: ReleaseInfo; update_queued: boolean }
export interface AttemptMarking { marking: MarkingStatus; counts: MarkCounts; result: ResultView; released_with_unmarked: number; release_when_marked: boolean; marks_revision: number; notified_revision: number | null; release_token: string }
export interface MarkingSummary {
    summary: { submitted: number; done: number; needs_marking: number; check_ai: number; ai_checking: number; total_only: number; waiting_release_when_marked: number; released_changed: number; released_with_unmarked: number; needs_marking_attempt_ids: string[]; waiting_attempt_ids: string[] };
    attempts?: Record<string, AttemptMarking>;
}
export interface ReleaseCheck {
    selected: number; ready: { count: number; attempt_ids: string[] }; ai_drafts: { count: number; answers: number; attempt_ids: string[] };
    unmarked: { count: number; answers: number; attempt_ids: string[] }; ai_checking: { count: number; eta_minutes: number | null; attempt_ids: string[] };
    already_released: { count: number; attempt_ids: string[] }; not_submitted: { count: number }; notifications: { learner_result_notifications: boolean };
}
export interface ReleaseBlocker { key: string; section_id: string; question_id: string; question_number: number; question_type: string; state: 'NEEDS_MARKING' | 'AI_FAILED' | 'AI_CHECKING'; reason: string | null }
export interface ApiErrorBody { code: string; message: string; details?: Record<string, unknown> }
