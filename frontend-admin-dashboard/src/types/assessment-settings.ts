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
 * What happens to uploaded copies in a bulk AI check (web and Evalezy): ASK = the
 * teacher chooses each time (the default); MAP = always matched to the
 * assessment's students; CHECK_ONLY = only checked and returned as a zip, never
 * matched to a student or shown as a submission.
 */
export type StudentMapping = 'ASK' | 'MAP' | 'CHECK_ONLY';

/**
 * Spelling and grammar on AI-checked copies: HIGHLIGHT = each error underlined
 * with its correction and listed in the answer's feedback, no marks deducted.
 */
export type LanguageFeedback = 'HIGHLIGHT' | 'OFF';

/** Ink, handwriting and size of the AI's pen on checked copies (ai_service pen_style.py). */
export type PenInk = 'RED' | 'BLUE' | 'GREEN' | 'BLACK' | 'PURPLE';
export type PenFont = 'KALAM' | 'PATRICK_HAND' | 'ARCHITECTS_DAUGHTER';
export type PenSize = 'SMALL' | 'MEDIUM' | 'LARGE';
export interface PenStyle {
    ink: PenInk;
    font: PenFont;
    size: PenSize;
}
export const DEFAULT_PEN_STYLE: PenStyle = { ink: 'RED', font: 'KALAM', size: 'MEDIUM' };

export interface AiCopyCheckSettings {
    /** The template preselected when copies are sent for AI checking. */
    commentPlacement: CommentPlacement;
    /** The pen every checked copy is drawn with. Absent = the usual red pen. */
    penStyle?: PenStyle;
    /** Marking instructions for the AI, used when an assessment has none of its own. */
    instructions?: string;
    /** Used when an assessment has made no choice of its own. */
    languageFeedback?: LanguageFeedback;
    /** Whether uploaded copies are matched to students. Absent = ASK. */
    studentMapping?: StudentMapping;
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

/** Size of a scanned page in Evalezy: STANDARD keeps uploads light, HIGH helps small handwriting. */
export type EvalezyScanQuality = 'STANDARD' | 'HIGH';

/**
 * Evalezy — the simple copy-check app (evalezy.vacademy.io and the Evalezy mobile
 * app): pick an assessment, scan or upload copies, the AI checks them, download
 * the checked copies as a zip. Same portal and login; these switches are the
 * institute's whole control over it. The AI template, instructions and language
 * feedback come from `aiCopyCheck` like every other copy check.
 */
export interface EvalezySettings {
    /** This institute's admins may use Evalezy. Off = the app shows a "turned off" page. */
    enabled: boolean;
    /** Scan pages with the device camera. */
    allowCamera: boolean;
    /** Pick PDFs and photos from the device. */
    allowUpload: boolean;
    scanQuality: EvalezyScanQuality;
    /** Email the person who sent the copies when the batch is checked. */
    notifyEmail: boolean;
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
    evalezy?: EvalezySettings;
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

/** On by default: Evalezy only reaches features an admin already has in the portal. */
export const DEFAULT_EVALEZY_SETTINGS: EvalezySettings = {
    enabled: true,
    allowCamera: true,
    allowUpload: true,
    scanQuality: 'STANDARD',
    notifyEmail: true,
};

/** Fill in a partially-saved `evalezy` block; unknown values fall back to the default. */
export const mergeEvalezySettings = (
    incoming?: Partial<EvalezySettings> | null
): EvalezySettings => {
    const flag = (value: unknown, fallback: boolean) =>
        typeof value === 'boolean' ? value : fallback;
    return {
        enabled: flag(incoming?.enabled, DEFAULT_EVALEZY_SETTINGS.enabled),
        allowCamera: flag(incoming?.allowCamera, DEFAULT_EVALEZY_SETTINGS.allowCamera),
        allowUpload: flag(incoming?.allowUpload, DEFAULT_EVALEZY_SETTINGS.allowUpload),
        scanQuality: incoming?.scanQuality === 'HIGH' ? 'HIGH' : 'STANDARD',
        notifyEmail: flag(incoming?.notifyEmail, DEFAULT_EVALEZY_SETTINGS.notifyEmail),
    };
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
    evalezy: { ...DEFAULT_EVALEZY_SETTINGS },
};

/** The saved choice, or ASK for anything missing or unknown. */
export const normalizeStudentMapping = (value: unknown): StudentMapping =>
    value === 'MAP' || value === 'CHECK_ONLY' ? value : 'ASK';

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
