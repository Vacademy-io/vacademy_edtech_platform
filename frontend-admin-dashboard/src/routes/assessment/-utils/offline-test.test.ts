import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({ default: http }));
vi.mock('@/constants/urls', () => ({
    PRIVATE_ADD_QUESTIONS: '/questions',
    STEP1_ASSESSMENT_URL: '/step1',
    STEP2_ASSESSMENT_URL: '/step2',
    STEP3_ASSESSMENT_URL: '/step3',
    PUBLISH_ASSESSMENT_URL: '/publish',
    // Read at import time by the paper-digitise service.
    AI_SERVICE_BASE_URL: '',
    BASE_URL: '',
}));

const {
    OFFLINE_EXAM_TYPE,
    PLACEHOLDER_QUESTION_TEXT,
    buildOfflineInstructionsHtml,
    createOfflineTest,
    offlineTestSubmissionsPath,
    paperAttachmentHtml,
} = await import('./offline-test');
const { findPdfAttachments } = await import('@/services/paper-digitise');

const input = {
    name: '  Class 9 Maths  ',
    descriptionHtml: '<p>Use blue ink.</p>',
    paper: { url: 'https://cdn.example.com/p/Maths Paper.pdf', name: 'Maths "Final".pdf' },
    noteHtml: '<p>note</p>',
    startIso: '2026-11-10T04:30:00.000Z',
    endIso: '2026-11-10T08:30:00.000Z',
    durationMinutes: 20,
    totalMarks: 80,
    batchIds: ['ps-1', 'ps-2'],
};

const callTo = (url: string) => http.mock.calls.map((c) => c[0]).find((c) => c.url === url);

describe('offline test instructions', () => {
    it('attaches the paper the way the editor does, so the paper reader finds it', () => {
        const html = buildOfflineInstructionsHtml(input);
        expect(html.startsWith('<p>Use blue ink.</p>')).toBe(true);
        expect(html.endsWith('<p>note</p>')).toBe(true);
        const found = findPdfAttachments(html);
        expect(found).toHaveLength(1);
        expect(found[0]!.url).toBe(input.paper.url);
    });

    it('escapes the file name and the link', () => {
        const html = paperAttachmentHtml({
            url: 'https://x/a.pdf?a=1&b="2"',
            name: '<b>x</b>.pdf',
        });
        expect(html).toContain('data-attachment="true"');
        expect(html).toContain('href="https://x/a.pdf?a=1&amp;b=&quot;2&quot;"');
        expect(html).not.toContain('<b>');
    });
});

describe('createOfflineTest', () => {
    beforeEach(() => {
        http.mockReset();
        http.mockImplementation(async (config: { url: string }) => {
            if (config.url === '/questions') return { data: { questions: [{ id: 'q-1' }] } };
            if (config.url === '/step1') return { data: { assessment_id: 'a-1' } };
            return { data: {} };
        });
    });

    it('creates the placeholder, the manual-upload test, assigns the batches and publishes', async () => {
        await expect(createOfflineTest(input, 'inst-1')).resolves.toBe('a-1');
        expect(http.mock.calls.map((c) => c[0].url)).toEqual([
            '/questions',
            '/step1',
            '/step2',
            '/step3',
            '/publish',
        ]);

        const question = callTo('/questions').data.questions[0];
        expect(question.text.content).toBe(PLACEHOLDER_QUESTION_TEXT);
        expect(question.question_type).toBe('LONG_ANSWER');

        const step1 = callTo('/step1');
        expect(step1.params).toEqual({
            assessmentId: null,
            instituteId: 'inst-1',
            type: OFFLINE_EXAM_TYPE,
        });
        expect(step1.data.test_creation.assessment_name).toBe('Class 9 Maths');
        expect(step1.data.test_boundation).toEqual({
            start_date: input.startIso,
            end_date: input.endIso,
        });
        expect(step1.data).toMatchObject({
            evaluation_type: 'MANUAL',
            result_type: 'MANUAL',
            submission_type: 'PDF',
            ai_evaluation_enabled: false,
            default_reattempt_count: 1,
        });

        const section = callTo('/step2').data.added_sections[0];
        expect(callTo('/step2').data.test_duration.entire_test_duration).toBe(20);
        expect(section.total_marks).toBe(80);
        expect(section.question_and_marking).toHaveLength(1);
        expect(JSON.parse(section.question_and_marking[0].marking_json).data.totalMark).toBe('80');

        const step3 = callTo('/step3');
        expect(step3.data.closed_test).toBe(true);
        expect(step3.data.added_pre_register_batches_details).toEqual(['ps-1', 'ps-2']);
        expect(callTo('/publish').params.assessmentId).toBe('a-1');
    });

    it('keeps the answer key and marking scheme out of what students see', async () => {
        await createOfflineTest(input, 'inst-1');
        const html: string = callTo('/step1').data.test_creation.assessment_instructions_html;
        expect(findPdfAttachments(html).map((a) => a.url)).toEqual([input.paper.url]);
    });

    it('creates nothing else when the question cannot be created', async () => {
        http.mockImplementation(async () => ({ data: {} }));
        await expect(createOfflineTest(input, 'inst-1')).rejects.toThrow(
            'Could not create the question'
        );
        expect(http).toHaveBeenCalledTimes(1);
    });

    it('stops when step 1 returns no id', async () => {
        http.mockImplementation(async (config: { url: string }) =>
            config.url === '/questions' ? { data: { questions: [{ id: 'q-1' }] } } : { data: {} }
        );
        await expect(createOfflineTest(input, 'inst-1')).rejects.toThrow(
            'Could not create the assessment'
        );
        expect(http).toHaveBeenCalledTimes(2);
    });

    it('points the alert and the redirect at the Submissions tab', () => {
        expect(offlineTestSubmissionsPath('a-1')).toBe(
            '/assessment/assessment-list/assessment-details/a-1/MANUAL_UPLOAD_EXAM/PRIVATE/submissions'
        );
    });
});
