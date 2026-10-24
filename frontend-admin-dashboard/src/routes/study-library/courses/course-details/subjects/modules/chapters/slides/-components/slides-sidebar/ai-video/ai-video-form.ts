/**
 * Pure state + mapping helpers for the "Add Slide → AI Video" dialog.
 *
 * Kept free of React so the request/payload mapping is unit-tested
 * (__tests__/ai-video-form.test.ts). The server owns the mapping from
 * `format` to the video pipeline; this file only decides what the dialog
 * shows and what it sends.
 */
import * as z from 'zod';
import type { HtmlVideoSlideCreatePayload, Slide } from '../../../-hooks/use-slides';
import type {
    LmsVideoContext,
    LmsVideoDuration,
    LmsVideoEstimate,
    LmsVideoFormat,
    LmsVideoLayout,
    LmsVideoOrientation,
    LmsVideoPolicy,
    LmsVideoQuality,
    LmsVideoReferenceFile,
    LmsVideoRequest,
    LmsVideoTeacher,
    LmsVideoVoiceGender,
} from '@/services/lms-ai-video';

// ── limits (match the server's LmsVideoRequest) ─────────────────────────────

export const TOPIC_MAX = 500;
export const OBJECTIVES_MAX = 2000;
export const AUDIENCE_MAX = 200;
export const NOTES_MAX = 8000;
export const SUBJECT_MAX = 80;
/** admin_core slide.title / description are varchar(255). */
export const SLIDE_TEXT_MAX = 250;
export const MAX_REFERENCE_FILES = 3;

// ── formats ──────────────────────────────────────────────────────────────────

/** Whether the format shows the teacher picker, and if picking one is required. */
export type TeacherMode = 'required' | 'optional' | 'hidden';

export interface AiVideoFormatOption {
    value: LmsVideoFormat;
    teacher: TeacherMode;
    /** Lesson formats take the worked-example / recap switches. */
    lesson: boolean;
    /** Length picked for the teacher when they choose this format (until they pick their own). */
    defaultDuration: LmsVideoDuration;
    /** Shown as the "Auto" orientation; the server applies the same default. */
    defaultOrientation: LmsVideoOrientation;
}

export const AI_VIDEO_FORMATS: AiVideoFormatOption[] = [
    {
        value: 'lesson_teacher',
        teacher: 'required',
        lesson: true,
        defaultDuration: '2-3 minutes',
        defaultOrientation: 'landscape',
    },
    {
        value: 'board_explainer',
        teacher: 'hidden',
        lesson: true,
        defaultDuration: '2-3 minutes',
        defaultOrientation: 'landscape',
    },
    {
        value: 'problem_walkthrough',
        teacher: 'optional',
        lesson: true,
        defaultDuration: '2-3 minutes',
        defaultOrientation: 'landscape',
    },
    {
        value: 'quick_concept',
        teacher: 'hidden',
        lesson: true,
        defaultDuration: '1-2 minutes',
        defaultOrientation: 'landscape',
    },
    {
        value: 'revision_short',
        teacher: 'hidden',
        lesson: true,
        defaultDuration: '1-2 minutes',
        defaultOrientation: 'portrait',
    },
    {
        value: 'storybook',
        teacher: 'hidden',
        lesson: false,
        defaultDuration: '2-3 minutes',
        defaultOrientation: 'landscape',
    },
    {
        value: 'conversation',
        teacher: 'hidden',
        lesson: false,
        defaultDuration: '2-3 minutes',
        defaultOrientation: 'landscape',
    },
    {
        value: 'code_lesson',
        teacher: 'hidden',
        lesson: true,
        defaultDuration: '2-3 minutes',
        defaultOrientation: 'landscape',
    },
];

export const getFormatOption = (format: LmsVideoFormat): AiVideoFormatOption =>
    AI_VIDEO_FORMATS.find((f) => f.value === format) ?? AI_VIDEO_FORMATS[0]!;

export const DURATIONS: LmsVideoDuration[] = [
    '1-2 minutes',
    '2-3 minutes',
    '3-5 minutes',
    '5-8 minutes',
];

/** Longest minute count a duration choice can reach ("3-5 minutes" → 5). */
export const durationUpperMinutes = (duration: LmsVideoDuration): number => {
    const match = duration.match(/(\d+)\s*-\s*(\d+)/);
    return match ? Number(match[2]) : Number.parseInt(duration, 10) || 0;
};

export const QUALITIES: LmsVideoQuality[] = ['standard', 'premium', 'ultra'];

/** Layout thumbnails offered once a teacher is picked. */
export const TEACHER_LAYOUTS: LmsVideoLayout[] = ['corner', 'bubble', 'side', 'presenter', 'board'];

export const DEFAULT_LANGUAGE = 'English';

// ── form state ───────────────────────────────────────────────────────────────

export interface AiVideoFormState {
    // Step 1 — what to teach
    topic: string;
    objectives: string;
    audience: string;
    language: string;
    notes: string;
    sourceSlideIds: string[];
    referenceFiles: LmsVideoReferenceFile[];
    // Step 2 — format
    format: LmsVideoFormat;
    teacher: LmsVideoTeacher | null;
    layout: LmsVideoLayout;
    voiceGender: LmsVideoVoiceGender;
    duration: LmsVideoDuration;
    /** The teacher picked a length themselves — format changes stop overriding it. */
    durationTouched: boolean;
    quality: LmsVideoQuality;
    // Advanced — null means "the format's default"
    includeWorkedExample: boolean | null;
    includeRecap: boolean | null;
    subject: string;
    captionsEnabled: boolean;
    orientation: LmsVideoOrientation | 'auto';
    backgroundMusic: boolean | null;
}

/** "default" is the placeholder name of a course's only chapter — not a topic. */
export const topicFromChapterName = (chapterName?: string | null): string => {
    const name = (chapterName || '').trim();
    if (!name || name.toLowerCase() === 'default') return '';
    return name.slice(0, TOPIC_MAX);
};

export const createInitialFormState = (chapterName?: string | null): AiVideoFormState => ({
    topic: topicFromChapterName(chapterName),
    objectives: '',
    audience: '',
    language: DEFAULT_LANGUAGE,
    notes: '',
    sourceSlideIds: [],
    referenceFiles: [],
    format: 'lesson_teacher',
    teacher: null,
    layout: 'corner',
    voiceGender: 'female',
    duration: '2-3 minutes',
    durationTouched: false,
    quality: 'standard',
    includeWorkedExample: null,
    includeRecap: null,
    subject: '',
    captionsEnabled: true,
    orientation: 'auto',
    backgroundMusic: null,
});

/** Switch format. The picked teacher is kept (so going back restores it) but only sent when the format shows one. */
export const selectFormat = (state: AiVideoFormState, format: LmsVideoFormat): AiVideoFormState => {
    const option = getFormatOption(format);
    return {
        ...state,
        format,
        duration: state.durationTouched ? state.duration : option.defaultDuration,
    };
};

/** The teacher the request will carry for the current format (null when the format has none). */
export const effectiveTeacher = (state: AiVideoFormState): LmsVideoTeacher | null =>
    getFormatOption(state.format).teacher === 'hidden' ? null : state.teacher;

/**
 * What the server does with include_worked_example / include_recap when the
 * request leaves them null, per lesson format. MIRRORS the backend's FORMATS
 * table (ai_service/app/routers/lms_video.py: FormatSpec.worked_example /
 * force_worked_example / recap) — change both together.
 * `workedExampleForced`: the server always includes one (the switch is locked on).
 */
export const LESSON_FORMAT_DEFAULTS: Record<
    LmsVideoFormat,
    { workedExample: boolean; workedExampleForced: boolean; recap: boolean }
> = {
    lesson_teacher: { workedExample: true, workedExampleForced: false, recap: true },
    board_explainer: { workedExample: true, workedExampleForced: false, recap: true },
    problem_walkthrough: { workedExample: true, workedExampleForced: true, recap: true },
    quick_concept: { workedExample: false, workedExampleForced: false, recap: true },
    revision_short: { workedExample: false, workedExampleForced: false, recap: true },
    storybook: { workedExample: false, workedExampleForced: false, recap: false },
    conversation: { workedExample: false, workedExampleForced: false, recap: false },
    code_lesson: { workedExample: true, workedExampleForced: false, recap: true },
};

export const isWorkedExampleForced = (state: AiVideoFormState): boolean =>
    LESSON_FORMAT_DEFAULTS[state.format].workedExampleForced;

export const effectiveWorkedExample = (state: AiVideoFormState): boolean =>
    isWorkedExampleForced(state) ||
    (state.includeWorkedExample ?? LESSON_FORMAT_DEFAULTS[state.format].workedExample);

export const effectiveRecap = (state: AiVideoFormState): boolean =>
    state.includeRecap ?? LESSON_FORMAT_DEFAULTS[state.format].recap;

export const effectiveOrientation = (state: AiVideoFormState): LmsVideoOrientation =>
    state.orientation === 'auto'
        ? getFormatOption(state.format).defaultOrientation
        : state.orientation;

// ── validation ───────────────────────────────────────────────────────────────

export type FieldError = 'required' | 'tooLong';
export type WhatToTeachField = 'topic' | 'objectives' | 'audience' | 'notes';

const whatToTeachSchema = z.object({
    topic: z.string().trim().min(1, 'required').max(TOPIC_MAX, 'tooLong'),
    objectives: z.string().max(OBJECTIVES_MAX, 'tooLong'),
    audience: z.string().max(AUDIENCE_MAX, 'tooLong'),
    notes: z.string().max(NOTES_MAX, 'tooLong'),
});

/** Inline errors for step 1, keyed by field; empty when the step is valid. */
export const validateWhatToTeach = (
    state: AiVideoFormState
): Partial<Record<WhatToTeachField, FieldError>> => {
    const result = whatToTeachSchema.safeParse(state);
    if (result.success) return {};
    const errors: Partial<Record<WhatToTeachField, FieldError>> = {};
    for (const issue of result.error.issues) {
        const field = issue.path[0] as WhatToTeachField;
        if (!errors[field]) errors[field] = issue.message as FieldError;
    }
    return errors;
};

export type FormatError = 'teacherRequired' | 'subjectTooLong';

export const validateFormat = (state: AiVideoFormState): FormatError | null => {
    if (getFormatOption(state.format).teacher === 'required' && !state.teacher) {
        return 'teacherRequired';
    }
    if (state.subject.length > SUBJECT_MAX) return 'subjectTooLong';
    return null;
};

// ── policy (from the last /estimate) ────────────────────────────────────────

export const isQualityAllowed = (
    quality: LmsVideoQuality,
    policy: LmsVideoPolicy | null | undefined
): boolean => !policy || policy.allowed_qualities.includes(quality);

export const isDurationAllowed = (
    duration: LmsVideoDuration,
    policy: LmsVideoPolicy | null | undefined
): boolean => !policy || durationUpperMinutes(duration) <= policy.max_minutes_per_video;

// ── request ──────────────────────────────────────────────────────────────────

const blankToNull = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const compactContext = (context: LmsVideoContext | undefined): LmsVideoContext | null => {
    if (!context) return null;
    const entries = Object.entries(context).filter(
        ([, v]) => typeof v === 'string' && v.trim() !== ''
    );
    return entries.length ? (Object.fromEntries(entries) as LmsVideoContext) : null;
};

export const buildLmsVideoRequest = (
    state: AiVideoFormState,
    context?: LmsVideoContext
): LmsVideoRequest => {
    const option = getFormatOption(state.format);
    const teacher = effectiveTeacher(state);
    return {
        topic: state.topic.trim(),
        objectives: blankToNull(state.objectives),
        audience: blankToNull(state.audience),
        notes: blankToNull(state.notes),
        language: state.language.trim() || DEFAULT_LANGUAGE,
        format: state.format,
        duration: state.duration,
        quality: state.quality,
        orientation: state.orientation === 'auto' ? null : state.orientation,
        teacher,
        layout: teacher ? state.layout : null,
        voice_gender: state.voiceGender,
        include_worked_example: option.lesson ? state.includeWorkedExample : null,
        include_recap: option.lesson ? state.includeRecap : null,
        subject: blankToNull(state.subject),
        captions_enabled: state.captionsEnabled,
        background_music_enabled: state.backgroundMusic,
        source_slide_ids: [...state.sourceSlideIds],
        reference_files: state.referenceFiles.map((f) => ({ ...f })),
        context: compactContext(context),
    };
};

// ── slide payload ────────────────────────────────────────────────────────────

/** Code lessons open beside an editor; same shape the AI course builder writes. */
export const CODE_EDITOR_CONFIG = {
    enabled: true,
    layout: 'split-right',
    language: 'python',
    initial_code: '',
    theme: 'dark',
} as const;

export const buildHtmlVideoSlidePayload = ({
    slideId,
    htmlVideoSlideId,
    videoId,
    topic,
    objectives,
    slideOrder,
    codeEditor,
}: {
    slideId: string;
    htmlVideoSlideId: string;
    videoId: string;
    topic: string;
    objectives?: string | null;
    slideOrder: number;
    codeEditor: boolean;
}): HtmlVideoSlideCreatePayload => {
    const description = (objectives || '').trim().slice(0, SLIDE_TEXT_MAX);
    return {
        id: slideId,
        title: topic.trim().slice(0, SLIDE_TEXT_MAX),
        description: description || null,
        slide_order: slideOrder,
        source_type: 'HTML_VIDEO',
        html_video_slide: {
            id: htmlVideoSlideId,
            url: videoId,
            ai_gen_video_id: videoId,
            video_length_in_millis: 0,
            ...(codeEditor ? { code_editor_config: JSON.stringify(CODE_EDITOR_CONFIG) } : {}),
        },
        status: 'DRAFT',
        new_slide: true,
        notify: false,
    };
};

// ── sources ──────────────────────────────────────────────────────────────────

export type SourceSlideKind = 'pdf' | 'document' | 'video' | 'ai_video';

export interface SourceSlideOption {
    id: string;
    title: string;
    kind: SourceSlideKind;
}

/** The server reads only published slides (UNSYNC = published, edited since). */
const USABLE_STATUSES = new Set(['PUBLISHED', 'UNSYNC']);

const sourceKindOf = (slide: Slide): SourceSlideKind | null => {
    const type = (slide.source_type || '').toUpperCase();
    if (type === 'VIDEO') return 'video';
    if (type === 'HTML_VIDEO') return 'ai_video';
    if (type === 'DOCUMENT') {
        const docType = (slide.document_slide?.type || '').toUpperCase();
        if (docType === 'PDF') return 'pdf';
        if (docType === 'DOC' || docType === 'HTML') return 'document';
    }
    return null;
};

/**
 * This chapter's slides the video can be grounded on — PDFs, documents,
 * videos and earlier AI videos. Drafts are counted, not offered: the server
 * skips them.
 */
export const getSourceSlideOptions = (
    items: Slide[] | null | undefined
): { options: SourceSlideOption[]; draftCount: number } => {
    const options: SourceSlideOption[] = [];
    let draftCount = 0;
    for (const slide of items || []) {
        const kind = sourceKindOf(slide);
        if (!kind) continue;
        const status = (slide.status || '').toUpperCase();
        if (USABLE_STATUSES.has(status)) {
            options.push({ id: slide.id, title: slide.title || '', kind });
        } else if (status === 'DRAFT') {
            draftCount += 1;
        }
    }
    return { options, draftCount };
};

// ── estimate display ─────────────────────────────────────────────────────────

const roundCredits = (value: number | null | undefined): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
};

/** Credits rounded for display; low/high collapse to one figure when they match. */
export const summariseEstimate = (
    estimate: LmsVideoEstimate
): { low: number; high: number; expected: number; isRange: boolean } => {
    const expected = roundCredits(estimate.expected_credits);
    const low = roundCredits(estimate.low_credits) || expected;
    const high = roundCredits(estimate.high_credits) || expected;
    return { low, high, expected, isRange: low !== high };
};
