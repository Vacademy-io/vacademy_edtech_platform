import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    PRIVATE_ADD_QUESTIONS,
    PUBLISH_ASSESSMENT_URL,
    STEP1_ASSESSMENT_URL,
    STEP2_ASSESSMENT_URL,
    STEP3_ASSESSMENT_URL,
} from '@/constants/urls';

/** Long enough that a paper checked for weeks never closes on the teacher. */
const OPEN_UNTIL = '9999-12-31T23:59:59.999Z';
const DURATION_MIN = 60;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The paper as the instructions carry it: the same `<a data-attachment>` the
 * editor writes, typed as a PDF so the paper read finds it whatever the URL
 * looks like.
 */
export const paperAttachmentHtml = (url: string, fileName: string): string => {
    const name = escapeHtml(/\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`);
    return `<p><a data-attachment="true" href="${escapeHtml(url)}" name="${name}" type="application/pdf" target="_blank" rel="noopener noreferrer">${name}</a></p>`;
};

/**
 * Create a test for checking answer copies, the way the slide form creates an
 * offline test: one "Upload your answer sheet." placeholder carrying the
 * paper's marks, the paper attached in the instructions, MANUAL evaluation,
 * published at once. AI checking is switched on afterwards by the paper read
 * and its review ("Enable AI checking"), which swaps in the real questions.
 *
 * The question is created first: if that fails, no half-made test is left in
 * DRAFT. Returns the new assessment id.
 */
export const createCopyCheckAssessment = async (input: {
    instituteId: string;
    name: string;
    totalMarks: number;
    paperUrl: string;
    paperName: string;
}): Promise<string> => {
    const type = 'EXAM';
    const marks = Math.max(1, Math.round(input.totalMarks));

    const questionRes = await authenticatedAxiosInstance({
        method: 'POST',
        url: PRIVATE_ADD_QUESTIONS,
        data: {
            questions: [
                {
                    question_type: 'LONG_ANSWER',
                    text: { type: 'HTML', content: 'Upload your answer sheet.' },
                    auto_evaluation_json:
                        '{"type":"LONG_ANSWER","data":{"answer":{"type":"HTML","content":""}}}',
                    explanation_text: { type: 'HTML', content: '' },
                },
            ],
        },
    });
    const questionId: string | undefined = questionRes?.data?.questions?.[0]?.id;
    if (!questionId) throw new Error('Could not create the question');

    const step1 = await authenticatedAxiosInstance({
        method: 'POST',
        url: STEP1_ASSESSMENT_URL,
        params: { assessmentId: null, instituteId: input.instituteId, type },
        data: {
            status: 'INCOMPLETE',
            assessment_type: 'ASSESSMENT',
            test_creation: {
                assessment_name: input.name,
                subject_id: '',
                assessment_instructions_html: paperAttachmentHtml(input.paperUrl, input.paperName),
            },
            test_boundation: { start_date: new Date().toISOString(), end_date: OPEN_UNTIL },
            assessment_preview_time: 0,
            default_reattempt_count: 0,
            switch_sections: true,
            evaluation_type: 'MANUAL',
            submission_type: '',
            result_type: 'MANUAL',
            raise_reattempt_request: false,
            raise_time_increase_request: false,
            // Switched on by adopt-questions once the read has been reviewed.
            ai_evaluation_enabled: false,
        },
    });
    const assessmentId: string | undefined = step1?.data?.assessment_id;
    if (!assessmentId) throw new Error('Could not create the assessment');

    await authenticatedAxiosInstance({
        method: 'POST',
        url: STEP2_ASSESSMENT_URL,
        params: { assessmentId, instituteId: input.instituteId, type },
        data: {
            test_duration: {
                entire_test_duration: DURATION_MIN,
                distribution_duration: 'ASSESSMENT',
            },
            added_sections: [
                {
                    section_name: 'Section 1',
                    section_id: '',
                    section_description_html: '',
                    section_duration: DURATION_MIN,
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

    // Closed test with nobody registered: copies come in through Evalezy, not learners.
    await authenticatedAxiosInstance({
        method: 'POST',
        url: STEP3_ASSESSMENT_URL,
        params: { assessmentId, instituteId: input.instituteId, type },
        data: {
            closed_test: true,
            open_test_details: {},
            added_pre_register_batches_details: [],
            deleted_pre_register_batches_details: [],
            added_pre_register_students_details: [],
            deleted_pre_register_students_details: [],
            updated_join_link: '',
            notify_student: {
                when_assessment_created: false,
                show_leaderboard: false,
                before_assessment_goes_live: 0,
                when_assessment_live: false,
                when_assessment_report_generated: false,
            },
            notify_parent: {
                when_assessment_created: false,
                before_assessment_goes_live: 0,
                show_leaderboard: false,
                when_assessment_live: false,
                when_student_appears: false,
                when_student_finishes_test: false,
                when_assessment_report_generated: false,
            },
        },
    });

    await authenticatedAxiosInstance({
        method: 'POST',
        url: PUBLISH_ASSESSMENT_URL,
        params: { assessmentId, instituteId: input.instituteId, type },
        data: {},
    });
    return assessmentId;
};
