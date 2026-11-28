/** Builders for submission-review unit tests (not shipped: only tests import this). */
import type { AttemptMarking, MarkCounts, QuestionRow, ReleaseInfo, SubmissionOutline } from './types';

export const qrow = (over: Partial<QuestionRow> & { key: string }): QuestionRow => {
    const [section_id = 's1', question_id = 'q'] = over.key.split(':');
    return {
        section_id,
        question_id,
        question_order: 1,
        question_number: 1,
        question_type: 'LONG_ANSWER',
        marks: 0,
        max_marks: 10,
        min_marks: 0,
        state: 'NEEDS_MARKING',
        state_stored: false,
        marks_source: null,
        marked_by_kind: 'NONE',
        marked_by: null,
        marked_at: null,
        revision: 0,
        has_feedback: false,
        ai_checking: false,
        ai_failed_reason: null,
        counted: true,
        answer_pages: null,
        changed_after_release: false,
        history_count: 0,
        ...over,
    };
};

export const counts = (over: Partial<MarkCounts> = {}): MarkCounts => ({
    not_answered: 0,
    needs_marking: 0,
    ai_draft: 0,
    marked: 0,
    ai_checking: 0,
    ai_failed: 0,
    not_counted: 0,
    ...over,
});

export const release = (over: Partial<ReleaseInfo> = {}): ReleaseInfo => ({
    status: 'NOT_RELEASED',
    released_at: null,
    token: 'PENDING|0',
    changed_since_release: false,
    unmarked_at_release: 0,
    result_revised_at: null,
    marks_revision: 0,
    notified_revision: 0,
    release_when_marked: false,
    ...over,
});

export const attemptMarking = (over: Partial<AttemptMarking> = {}): AttemptMarking => ({
    marking: 'DONE',
    counts: counts(),
    result: 'NOT_RELEASED',
    released_with_unmarked: 0,
    release_when_marked: false,
    marks_revision: 0,
    notified_revision: 0,
    release_token: 'PENDING|0',
    ...over,
});

export const outline = (over: Partial<SubmissionOutline> = {}): SubmissionOutline => ({
    attempt_id: 'att-1',
    assessment_id: 'asmt-1',
    assessment_name: 'FR Mock 1',
    institute_id: 'inst-1',
    kind: 'ONLINE',
    evaluation_type: 'AUTO',
    result_type: 'MANUAL',
    learner: { user_id: 'u1', name: 'Harsh Mehta', username: 'harsh', email: null },
    attempt_number: 1,
    attempts_total: 1,
    submitted_at: '2026-11-10T08:32:00Z',
    status: 'ENDED',
    result_status: 'PENDING',
    marking: 'NEEDS_MARKING',
    total: 2,
    max_total: 12,
    stored_total: 2,
    total_only: false,
    response_file_id: null,
    evaluated_file_id: null,
    release: release(),
    counts: counts({ needs_marking: 1, marked: 1 }),
    ai_run: null,
    permissions: { can_edit: true, can_edit_after_release: true, can_release: true, can_force_answer_key: false },
    sections: [],
    ...over,
});
