import { describe, expect, it } from 'vitest';
import type { Slide } from '../../../../-hooks/use-slides';
import {
    CODE_EDITOR_CONFIG,
    SLIDE_TEXT_MAX,
    TOPIC_MAX,
    buildHtmlVideoSlidePayload,
    buildLmsVideoRequest,
    createInitialFormState,
    durationUpperMinutes,
    effectiveOrientation,
    effectiveRecap,
    effectiveWorkedExample,
    getSourceSlideOptions,
    isWorkedExampleForced,
    isDurationAllowed,
    isQualityAllowed,
    selectFormat,
    summariseEstimate,
    topicFromChapterName,
    validateFormat,
    validateWhatToTeach,
} from '../ai-video-form';
import type { LmsVideoPolicy } from '@/services/lms-ai-video';

const slide = (over: Partial<Slide>): Slide => ({
    id: 'id',
    source_id: '',
    source_type: 'DOCUMENT',
    title: 'Slide',
    image_file_id: '',
    description: '',
    status: 'PUBLISHED',
    slide_order: 0,
    is_loaded: true,
    new_slide: false,
    ...over,
});

const policy = (over: Partial<LmsVideoPolicy> = {}): LmsVideoPolicy => ({
    enabled: true,
    allowed_qualities: ['standard', 'premium', 'ultra'],
    teacher_allowed: true,
    max_minutes_per_video: 8,
    monthly_credit_cap: null,
    max_concurrent: 3,
    ...over,
});

describe('topicFromChapterName', () => {
    it('prefills from the chapter name but never from the "default" placeholder', () => {
        expect(topicFromChapterName('  Photosynthesis ')).toBe('Photosynthesis');
        expect(topicFromChapterName('DEFAULT')).toBe('');
        expect(topicFromChapterName(undefined)).toBe('');
        expect(topicFromChapterName('x'.repeat(TOPIC_MAX + 20))).toHaveLength(TOPIC_MAX);
    });
});

describe('selectFormat', () => {
    it('applies the format length until the teacher picks one', () => {
        const start = createInitialFormState('Cells');
        const quick = selectFormat(start, 'revision_short');
        expect(quick.duration).toBe('1-2 minutes');
        expect(effectiveOrientation(quick)).toBe('portrait');

        const touched = { ...quick, duration: '5-8 minutes' as const, durationTouched: true };
        expect(selectFormat(touched, 'lesson_teacher').duration).toBe('5-8 minutes');
    });
});

describe('validation', () => {
    it('requires a topic and caps lengths', () => {
        const s = createInitialFormState('');
        expect(validateWhatToTeach(s)).toEqual({ topic: 'required' });
        expect(validateWhatToTeach({ ...s, topic: '   ' })).toEqual({ topic: 'required' });
        expect(validateWhatToTeach({ ...s, topic: 'Cells', notes: 'n'.repeat(8001) })).toEqual({
            notes: 'tooLong',
        });
        expect(validateWhatToTeach({ ...s, topic: 'Cells' })).toEqual({});
    });

    it('requires a teacher only for the lesson-with-teacher format', () => {
        const s = createInitialFormState('Cells');
        expect(validateFormat(s)).toBe('teacherRequired');
        expect(validateFormat(selectFormat(s, 'problem_walkthrough'))).toBeNull();
        expect(validateFormat({ ...s, teacher: { avatar_id: 'avatar-123456' } })).toBeNull();
    });
});

describe('buildLmsVideoRequest', () => {
    it('maps the form to the server contract, trimming blanks to null', () => {
        const s = {
            ...createInitialFormState('Photosynthesis'),
            objectives: '  ',
            audience: ' Class 8 ',
            teacher: { avatar_id: 'avatar-123456', name: 'Asha' },
            layout: 'bubble' as const,
            sourceSlideIds: ['s1'],
            referenceFiles: [{ url: 'https://x/a.pdf', name: 'a.pdf', type: 'pdf' as const }],
        };
        const req = buildLmsVideoRequest(s, {
            chapter_id: 'ch1',
            chapter_name: 'Photosynthesis',
            module_id: '',
        });
        expect(req).toMatchObject({
            topic: 'Photosynthesis',
            objectives: null,
            audience: 'Class 8',
            notes: null,
            language: 'English',
            format: 'lesson_teacher',
            duration: '2-3 minutes',
            quality: 'standard',
            orientation: null,
            teacher: { avatar_id: 'avatar-123456', name: 'Asha' },
            layout: 'bubble',
            voice_gender: 'female',
            include_worked_example: null,
            include_recap: null,
            captions_enabled: true,
            background_music_enabled: null,
            source_slide_ids: ['s1'],
            reference_files: [{ url: 'https://x/a.pdf', name: 'a.pdf', type: 'pdf' }],
            context: { chapter_id: 'ch1', chapter_name: 'Photosynthesis' },
        });
    });

    it('drops the teacher and lesson toggles for formats that have none', () => {
        const s = {
            ...createInitialFormState('Cells'),
            teacher: { avatar_id: 'avatar-123456' },
            includeRecap: false,
        };
        const story = buildLmsVideoRequest(selectFormat(s, 'storybook'));
        expect(story.teacher).toBeNull();
        expect(story.layout).toBeNull();
        expect(story.include_recap).toBeNull();
        expect(story.context).toBeNull();

        const lesson = buildLmsVideoRequest(s);
        expect(lesson.include_recap).toBe(false);
    });
});

describe('buildHtmlVideoSlidePayload', () => {
    it('builds the admin_core HTML_VIDEO create payload', () => {
        const payload = buildHtmlVideoSlidePayload({
            slideId: 'slide-1',
            htmlVideoSlideId: 'hv-1',
            videoId: 'vid-1',
            topic: ` ${'T'.repeat(300)} `,
            objectives: '',
            slideOrder: 4,
            codeEditor: false,
        });
        expect(payload).toEqual({
            id: 'slide-1',
            title: 'T'.repeat(SLIDE_TEXT_MAX),
            description: null,
            slide_order: 4,
            source_type: 'HTML_VIDEO',
            html_video_slide: {
                id: 'hv-1',
                url: 'vid-1',
                ai_gen_video_id: 'vid-1',
                video_length_in_millis: 0,
            },
            status: 'DRAFT',
            new_slide: true,
            notify: false,
        });
    });

    it('adds the code editor config only for code lessons', () => {
        const payload = buildHtmlVideoSlidePayload({
            slideId: 's',
            htmlVideoSlideId: 'h',
            videoId: 'v',
            topic: 'Loops',
            objectives: 'Write a for loop',
            slideOrder: 0,
            codeEditor: true,
        });
        expect(payload.description).toBe('Write a for loop');
        expect(JSON.parse(payload.html_video_slide.code_editor_config!)).toEqual(
            CODE_EDITOR_CONFIG
        );
    });
});

describe('getSourceSlideOptions', () => {
    it('offers published PDFs, documents, videos and AI videos; counts drafts', () => {
        const items = [
            slide({ id: 'pdf', document_slide: { type: 'PDF' } as Slide['document_slide'] }),
            slide({
                id: 'doc',
                status: 'UNSYNC',
                document_slide: { type: 'HTML' } as Slide['document_slide'],
            }),
            slide({ id: 'code', document_slide: { type: 'CODE' } as Slide['document_slide'] }),
            slide({ id: 'vid', source_type: 'VIDEO' }),
            slide({ id: 'ai', source_type: 'HTML_VIDEO' }),
            slide({ id: 'quiz', source_type: 'QUIZ' }),
            slide({ id: 'draft', source_type: 'VIDEO', status: 'DRAFT' }),
        ];
        const { options, draftCount } = getSourceSlideOptions(items);
        expect(options.map((o) => [o.id, o.kind])).toEqual([
            ['pdf', 'pdf'],
            ['doc', 'document'],
            ['vid', 'video'],
            ['ai', 'ai_video'],
        ]);
        expect(draftCount).toBe(1);
    });
});

describe('policy helpers', () => {
    it('reads the upper bound of a duration range', () => {
        expect(durationUpperMinutes('3-5 minutes')).toBe(5);
        expect(isDurationAllowed('5-8 minutes', policy({ max_minutes_per_video: 5 }))).toBe(false);
        expect(isDurationAllowed('3-5 minutes', policy({ max_minutes_per_video: 5 }))).toBe(true);
        expect(isDurationAllowed('5-8 minutes', null)).toBe(true);
    });

    it('checks qualities against the policy when one is known', () => {
        expect(isQualityAllowed('ultra', policy({ allowed_qualities: ['standard'] }))).toBe(false);
        expect(isQualityAllowed('ultra', null)).toBe(true);
    });
});

describe('summariseEstimate', () => {
    it('rounds credits and collapses equal bounds', () => {
        expect(
            summariseEstimate({
                expected_credits: 14.62,
                low_credits: 11.2,
                high_credits: 19.8,
                rows: [],
            })
        ).toEqual({ low: 11, high: 20, expected: 15, isRange: true });
        expect(
            summariseEstimate({ expected_credits: 3.24, low_credits: 0, high_credits: 0, rows: [] })
        ).toEqual({ low: 3.2, high: 3.2, expected: 3.2, isRange: false });
    });
});

describe('lesson switch defaults (mirror ai_service lms_video.FORMATS)', () => {
    it('shows the server default per format while the value is unset', () => {
        const base = createInitialFormState();
        const at = (format: Parameters<typeof selectFormat>[1]) => selectFormat(base, format);
        expect(effectiveWorkedExample(at('lesson_teacher'))).toBe(true);
        expect(effectiveWorkedExample(at('quick_concept'))).toBe(false);
        expect(effectiveWorkedExample(at('revision_short'))).toBe(false);
        expect(effectiveRecap(at('quick_concept'))).toBe(true);
        expect(effectiveRecap(at('revision_short'))).toBe(true);
    });

    it('locks the worked example on for problem walkthroughs', () => {
        const state = {
            ...selectFormat(createInitialFormState(), 'problem_walkthrough'),
            includeWorkedExample: false,
        };
        expect(isWorkedExampleForced(state)).toBe(true);
        expect(effectiveWorkedExample(state)).toBe(true);
    });

    it('an explicit choice wins over the default', () => {
        const state = {
            ...selectFormat(createInitialFormState(), 'quick_concept'),
            includeWorkedExample: true,
        };
        expect(effectiveWorkedExample(state)).toBe(true);
    });
});
