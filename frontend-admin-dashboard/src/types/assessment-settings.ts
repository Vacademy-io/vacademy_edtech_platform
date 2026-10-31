export interface ReportBrandingSettings {
    primary_color: string;
    secondary_color: string;
    show_letterhead: boolean;
    letterhead_file_id: string | null;
    show_logo_in_header: boolean;
    logo_file_id: string | null;
    show_watermark: boolean;
    watermark_text: string;
    watermark_opacity: number;
    footer_text: string;
    header_html: string;
    footer_html: string;
}

/**
 * Role-wise control over who receives assessment result / evaluation
 * notifications (result-release + re-evaluation emails, and learner reports).
 * `roles` maps a role key (uppercased: ADMIN / TEACHER / STUDENT / LEARNER /
 * EVALUATOR / a custom role name) to whether that role receives the notification.
 * A role absent from the map falls back to the default: STUDENT/LEARNER = on,
 * every other role (incl. ADMIN) = off.
 */
export interface ResultNotificationSettings {
    version: number;
    roles: Record<string, boolean>;
}

/**
 * Calculator offered inside the live test.
 * - `basic`     — four-function keypad (arithmetic only).
 * - `scientific` — JEE/NEET-style: trig and inverse trig, log/ln, powers and
 *   roots, factorial, π/e and a DEG/RAD toggle. Still a plain on-screen
 *   calculator — no programmability, no stored formulas.
 */
export type ExamCalculatorMode = 'basic' | 'scientific';

/**
 * How the live-test surface behaves for learners. Read by the learner app
 * (frontend-learner-dashboard-app) when it renders the exam shell, so an
 * institute can turn exam tools on/off without a release.
 */
export interface ExamExperienceSettings {
    calculator: {
        enabled: boolean;
        mode: ExamCalculatorMode;
    };
    scratchpad: {
        enabled: boolean;
    };
    questionPalette: {
        enabled: boolean;
        defaultView: 'grid' | 'list';
    };
    /** Marks / negative-marks chips on each question. */
    showMarkingScheme: boolean;
    mobile: {
        /**
         * Hide app chrome (chatbot launcher, floating helpers) while a learner is
         * inside a live test on a phone, leaving only the assessment safe zone.
         */
        hideAppNavigation: boolean;
    };
}

/**
 * AI copy checking template: INSIDE = the teacher's remarks written on the
 * copy (the usual checked copy); OUTSIDE = marks on the copy, remarks in a
 * "Teacher comments" panel beside it.
 */
export type CommentPlacement = 'INSIDE' | 'OUTSIDE';

/**
 * Spelling and grammar on AI-checked copies: HIGHLIGHT = each error underlined
 * with its correction and listed in the answer's feedback, no marks deducted.
 */
export type LanguageFeedback = 'HIGHLIGHT' | 'OFF';

export interface AiCopyCheckSettings {
    /** The template preselected when copies are sent for AI checking. */
    commentPlacement: CommentPlacement;
    /** Marking instructions for the AI, used when an assessment has none of its own. */
    instructions?: string;
    /** Used when an assessment has made no choice of its own. */
    languageFeedback?: LanguageFeedback;
}

/** How the AI checks one assessment's copies, kept on the assessment (snake_case, as sent). */
export interface CopyCheckConfig {
    subject?: string | null;
    level?: string | null;
    instructions?: string | null;
    language_feedback?: LanguageFeedback | null;
}

/**
 * Assessment folders: group assessments (e.g. an "English" folder) on the admin list
 * and show them to learners as folder cards. Off = the flat list, as before.
 * Read by the learner app too, so keep the shape in sync there.
 */
export interface AssessmentFolderSettings {
    enabled: boolean;
}

export interface AssessmentSettingsData {
    offlineEntry: {
        enabled: boolean;
    };
    assessmentFolders?: AssessmentFolderSettings;
    reportBranding: ReportBrandingSettings;
    resultNotifications: ResultNotificationSettings;
    examExperience: ExamExperienceSettings;
    aiCopyCheck?: AiCopyCheckSettings;
}

/** Default: STUDENT/LEARNER receive results; every other role (incl. ADMIN) does not. */
export const defaultReceivesResultNotification = (roleKey: string): boolean => {
    const key = (roleKey || '').toUpperCase();
    return key === 'STUDENT' || key === 'LEARNER';
};

export interface AssessmentSettingsRequest {
    setting_name: string;
    setting_data: AssessmentSettingsData;
}

export interface AssessmentSettingsResponse {
    data: AssessmentSettingsData;
}

export const DEFAULT_REPORT_BRANDING: ReportBrandingSettings = {
    primary_color: '#FF6B35',
    secondary_color: '#6C5CE7',
    show_letterhead: false,
    letterhead_file_id: null,
    show_logo_in_header: true,
    logo_file_id: null,
    show_watermark: false,
    watermark_text: '',
    watermark_opacity: 0.05,
    footer_text:
        'This report is auto-generated. For queries, contact your institute administrator.',
    header_html: '',
    footer_html: '',
};

/**
 * Defaults match the behaviour learners already had before these toggles
 * existed, except the calculator — which is off until an institute opts in,
 * because a calculator in a no-calculator exam is a fairness problem.
 */
export const DEFAULT_EXAM_EXPERIENCE: ExamExperienceSettings = {
    calculator: { enabled: false, mode: 'scientific' },
    scratchpad: { enabled: false },
    questionPalette: { enabled: true, defaultView: 'grid' },
    showMarkingScheme: true,
    mobile: { hideAppNavigation: true },
};

export const DEFAULT_ASSESSMENT_SETTINGS: AssessmentSettingsData = {
    offlineEntry: {
        enabled: false,
    },
    reportBranding: { ...DEFAULT_REPORT_BRANDING },
    // Empty map => backend applies per-role defaults (STUDENT on, everything else off).
    resultNotifications: { version: 1, roles: {} },
    examExperience: {
        ...DEFAULT_EXAM_EXPERIENCE,
        calculator: { ...DEFAULT_EXAM_EXPERIENCE.calculator },
        scratchpad: { ...DEFAULT_EXAM_EXPERIENCE.scratchpad },
        questionPalette: { ...DEFAULT_EXAM_EXPERIENCE.questionPalette },
        mobile: { ...DEFAULT_EXAM_EXPERIENCE.mobile },
    },
    aiCopyCheck: { commentPlacement: 'INSIDE' },
    assessmentFolders: { enabled: false },
};

/** The saved template, or INSIDE for anything missing or unknown. */
export const normalizeCommentPlacement = (value: unknown): CommentPlacement =>
    value === 'OUTSIDE' ? 'OUTSIDE' : 'INSIDE';

/** Fill in any missing branch of a partially-saved `examExperience` object. */
export const mergeExamExperience = (
    incoming?: Partial<ExamExperienceSettings> | null
): ExamExperienceSettings => ({
    calculator: {
        ...DEFAULT_EXAM_EXPERIENCE.calculator,
        ...incoming?.calculator,
    },
    scratchpad: {
        ...DEFAULT_EXAM_EXPERIENCE.scratchpad,
        ...incoming?.scratchpad,
    },
    questionPalette: {
        ...DEFAULT_EXAM_EXPERIENCE.questionPalette,
        ...incoming?.questionPalette,
    },
    showMarkingScheme: incoming?.showMarkingScheme ?? DEFAULT_EXAM_EXPERIENCE.showMarkingScheme,
    mobile: {
        ...DEFAULT_EXAM_EXPERIENCE.mobile,
        ...incoming?.mobile,
    },
});
