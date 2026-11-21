/**
 * Quick "written paper" test: one call that creates a complete, published
 * Manual Upload Exam from a title, a live window, a duration, the batches and
 * the question paper PDF — no wizard.
 *
 * The test is built the same way the slide-level create form builds one (a
 * placeholder question "Upload your answer sheet." carrying every mark, MANUAL
 * evaluation, the paper attached in the instructions) so everything downstream
 * already works on it: the learner downloads the paper and uploads a sheet, the
 * teacher grades by hand, and "Enable AI checking" on the Submissions tab swaps
 * the placeholder for the questions read from the paper.
 *
 * The answer key and the marking scheme are NOT put in the instructions —
 * learners would see them. They only go to the paper read.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    PRIVATE_ADD_QUESTIONS,
    PUBLISH_ASSESSMENT_URL,
    STEP1_ASSESSMENT_URL,
    STEP2_ASSESSMENT_URL,
    STEP3_ASSESSMENT_URL,
} from '@/constants/urls';

export const OFFLINE_EXAM_TYPE = 'MANUAL_UPLOAD_EXAM';

/**
 * The placeholder's exact text. assessment_service recognises a test that holds
 * only this question as "not AI-checkable yet" — it must not change.
 */
export const PLACEHOLDER_QUESTION_TEXT = 'Upload your answer sheet.';

export interface UploadedPdf {
    url: string;
    name: string;
}

export interface OfflineTestInput {
    name: string;
    /** The teacher's own instructions (HTML, may be empty). */
    descriptionHtml: string;
    /** The question paper learners download. */
    paper: UploadedPdf;
    /** The standard "download the paper, then start" note, already translated. */
    noteHtml: string;
    startIso: string;
    endIso: string;
    durationMinutes: number;
    /** Marks of the placeholder question — the test's total until the paper is read. */
    totalMarks: number;
    /** package_session ids the test is assigned to. */
    batchIds: string[];
}

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/**
 * The paper as the editor's attachment chip writes it (`<a data-attachment>`), so
 * the learner page lifts it into its viewer and `findPdfAttachments` finds it.
 */
export const paperAttachmentHtml = (paper: UploadedPdf): string => {
    const name = escapeHtml(paper.name || 'question-paper.pdf');
    const href = escapeHtml(paper.url);
    return (
        `<a data-attachment="true" href="${href}" target="_blank" rel="noopener noreferrer" ` +
        `name="${name}" type="application/pdf"><span>${name}</span></a>`
    );
};

/** Instructions = the teacher's text, the paper, then the standard note. */
export const buildOfflineInstructionsHtml = (
    input: Pick<OfflineTestInput, 'descriptionHtml' | 'paper' | 'noteHtml'>
): string => `${input.descriptionHtml || ''}${paperAttachmentHtml(input.paper)}${input.noteHtml}`;

const NOTIFY_STUDENT_OFF = {
    when_assessment_created: false,
    show_leaderboard: false,
    before_assessment_goes_live: 0,
    when_assessment_live: false,
    when_assessment_report_generated: false,
};

const NOTIFY_PARENT_OFF = {
    when_assessment_created: false,
    before_assessment_goes_live: 0,
    show_leaderboard: false,
    when_assessment_live: false,
    when_student_appears: false,
    when_student_finishes_test: false,
    when_assessment_report_generated: false,
};

/** Create, assign and publish the test. Resolves with its id; throws on any failed step. */
export const createOfflineTest = async (
    input: OfflineTestInput,
    instituteId: string | undefined
): Promise<string> => {
    const type = OFFLINE_EXAM_TYPE;
    const durationMin = Math.max(1, Math.round(input.durationMinutes) || 1);
    const marks = Math.max(1, Math.round(input.totalMarks) || 1);

    // Question first: if it cannot be created, no half-made test is left in DRAFT.
    const questionRes = await authenticatedAxiosInstance({
        method: 'POST',
        url: PRIVATE_ADD_QUESTIONS,
        data: {
            questions: [
                {
                    question_type: 'LONG_ANSWER',
                    text: { type: 'HTML', content: PLACEHOLDER_QUESTION_TEXT },
                    auto_evaluation_json:
                        '{"type":"LONG_ANSWER","data":{"answer":{"type":"HTML","content":""}}}',
                    explanation_text: { type: 'HTML', content: '' },
                },
            ],
        },
    });
    const questionId: string | undefined = questionRes?.data?.questions?.[0]?.id;
    if (!questionId) throw new Error('Could not create the question');

    // Step 1 — basic info: MANUAL evaluation, PDF answer sheets (as the wizard
    // sets them for a Manual Upload Exam). AI checking stays off until the paper
    // has been read and reviewed (adopt-questions switches it on).
    const step1Res = await authenticatedAxiosInstance({
        method: 'POST',
        url: STEP1_ASSESSMENT_URL,
        params: { assessmentId: null, instituteId, type },
        data: {
            status: 'INCOMPLETE',
            assessment_type: 'ASSESSMENT',
            test_creation: {
                assessment_name: input.name.trim(),
                subject_id: '',
                assessment_instructions_html: buildOfflineInstructionsHtml(input),
            },
            test_boundation: { start_date: input.startIso, end_date: input.endIso },
            assessment_preview_time: 0,
            default_reattempt_count: 1,
            switch_sections: true,
            evaluation_type: 'MANUAL',
            submission_type: 'PDF',
            result_type: 'MANUAL',
            raise_reattempt_request: false,
            raise_time_increase_request: false,
            ai_evaluation_enabled: false,
        },
    });
    const assessmentId: string | undefined = step1Res?.data?.assessment_id;
    if (!assessmentId) throw new Error('Could not create the assessment');

    // Step 2 — one section with the placeholder and the duration.
    await authenticatedAxiosInstance({
        method: 'POST',
        url: STEP2_ASSESSMENT_URL,
        params: { assessmentId, instituteId, type },
        data: {
            test_duration: {
                entire_test_duration: durationMin,
                distribution_duration: 'ASSESSMENT',
            },
            added_sections: [
                {
                    section_name: 'Section 1',
                    section_id: '',
                    section_description_html: '',
                    section_duration: durationMin,
                    section_order: 1,
                    total_marks: marks,
                    cutoff_marks: 0,
                    problem_randomization: false,
                    question_and_marking: [
                        {
                            question_id: questionId,
                            marking_json: JSON.stringify({
                                type: 'LONG_ANSWER',
                                data: {
                                    totalMark: String(marks),
                                    negativeMark: '0',
                                    negativeMarkingPercentage: '',
                                },
                            }),
                            question_duration_in_min: 0,
                            question_order: 1,
                            evaluation_criteria_json: null,
                            criteria_template_id: null,
                            is_added: true,
                            is_deleted: false,
                            is_updated: false,
                        },
                    ],
                },
            ],
            updated_sections: [],
            deleted_sections: [],
        },
    });

    // Step 3 — closed test for the chosen batches.
    await authenticatedAxiosInstance({
        method: 'POST',
        url: STEP3_ASSESSMENT_URL,
        params: { assessmentId, instituteId, type },
        data: {
            closed_test: true,
            open_test_details: {},
            added_pre_register_batches_details: input.batchIds,
            deleted_pre_register_batches_details: [],
            added_pre_register_students_details: [],
            deleted_pre_register_students_details: [],
            updated_join_link: '',
            notify_student: NOTIFY_STUDENT_OFF,
            notify_parent: NOTIFY_PARENT_OFF,
        },
    });

    await authenticatedAxiosInstance({
        method: 'POST',
        url: PUBLISH_ASSESSMENT_URL,
        params: { assessmentId, instituteId, type },
        data: {},
    });

    return assessmentId;
};

/** Where the test's Submissions tab lives — the alert, the toast and the redirect all go here. */
export const offlineTestSubmissionsPath = (assessmentId: string): string =>
    `/assessment/assessment-list/assessment-details/${assessmentId}/${OFFLINE_EXAM_TYPE}/PRIVATE/submissions`;
