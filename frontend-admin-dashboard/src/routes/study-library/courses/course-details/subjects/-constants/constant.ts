import type { TFunction } from 'i18next';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const NAMESPACE = 'studyLibraryCourseDetailsConstant';

export enum TabType {
    OUTLINE = 'OUTLINE',
    CONTENT_STRUCTURE = 'CONTENT_STRUCTURE',
    STUDENT = 'STUDENT',
    TEACHERS = 'TEACHERS',
    ASSESSMENT = 'ASSESSMENT',
    QUIZ_RESULTS = 'QUIZ_RESULTS',
    LIVE_SESSION = 'LIVE_SESSION',
    PLANNING = 'PLANNING',
    ACTIVITY = 'ACTIVITY',
    /** Daily engagement: scheduled tasks on the learner home page for this batch. */
    ENGAGEMENT = 'ENGAGEMENT',
    PULSE = 'PULSE',
    REPORTS = 'REPORTS',
    CERTIFICATES = 'CERTIFICATES',
    DOWNLOADS = 'DOWNLOADS',
    SETTINGS = 'SETTINGS',
    DISCUSSION = 'DISCUSSION',
    // Live AI Tutor: per-course teaching-mode settings, compile status, plan preview.
    TUTOR_MODE = 'TUTOR_MODE',
    // Course knowledge: what the student AI can answer from (coverage, Make course AI-ready).
    AI_KNOWLEDGE = 'AI_KNOWLEDGE',
    // ASSIGNMENT = 'ASSIGNMENT',
    // GRADING = 'GRADING',
    // ANNOUNCEMENT = 'ANNOUNCEMENT',
}
/**
 * English fallback labels, used only when no `t` (i18next TFunction) is
 * available to the caller. Prefer `buildTabs(t)` from a component.
 */
export const tabs = [
    { label: 'Outline', value: 'OUTLINE' },
    { label: 'Content Structure', value: 'CONTENT_STRUCTURE' },
    { label: `${getTerminology(RoleTerms.Learner, SystemTerms.Learner)}`, value: 'STUDENT' },
    { label: `${getTerminology(RoleTerms.Teacher, SystemTerms.Teacher)}`, value: 'TEACHERS' },
    { label: 'Assessment', value: 'ASSESSMENT' },
    { label: 'Quiz Results', value: 'QUIZ_RESULTS' },
    {
        label: `${getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession)}s`,
        value: 'LIVE_SESSION',
    },
    { label: 'Planning', value: 'PLANNING' },
    { label: 'Activity', value: 'ACTIVITY' },
    { label: 'Engagement', value: 'ENGAGEMENT' },
    { label: 'Pulse', value: 'PULSE' },
    { label: 'Reports', value: 'REPORTS' },
    { label: 'Certificates', value: 'CERTIFICATES' },
    { label: 'Downloads', value: 'DOWNLOADS' },
    { label: 'Settings', value: 'SETTINGS' },
    { label: 'Discussion', value: 'DISCUSSION' },
    { label: 'Tutor Mode', value: 'TUTOR_MODE' },
    { label: 'AI Knowledge', value: 'AI_KNOWLEDGE' },
    // { label: 'Assignment ', value: 'ASSIGNMENT' },
    // { label: 'Grading ', value: 'GRADING' },
    // { label: 'Announcements ', value: 'ANNOUNCEMENT' },
];

/**
 * Translated course-details tab labels. Terminology-driven labels (Student/
 * Teacher/Live Session) keep using `getTerminology` — those are institute
 * naming-settings overrides, not plain i18n strings — everything else routes
 * through `t()`.
 */
export function buildTabs(t: TFunction): { label: string; value: string }[] {
    return [
        { label: t(`${NAMESPACE}:tabs.outline`), value: 'OUTLINE' },
        { label: t(`${NAMESPACE}:tabs.contentStructure`), value: 'CONTENT_STRUCTURE' },
        { label: `${getTerminology(RoleTerms.Learner, SystemTerms.Learner)}`, value: 'STUDENT' },
        { label: `${getTerminology(RoleTerms.Teacher, SystemTerms.Teacher)}`, value: 'TEACHERS' },
        { label: t(`${NAMESPACE}:tabs.assessment`), value: 'ASSESSMENT' },
        { label: t(`${NAMESPACE}:tabs.quizResults`), value: 'QUIZ_RESULTS' },
        {
            label: `${getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession)}s`,
            value: 'LIVE_SESSION',
        },
        { label: t(`${NAMESPACE}:tabs.planning`), value: 'PLANNING' },
        { label: t(`${NAMESPACE}:tabs.activity`), value: 'ACTIVITY' },
        { label: t(`${NAMESPACE}:tabs.engagement`), value: 'ENGAGEMENT' },
        { label: t(`${NAMESPACE}:tabs.pulse`), value: 'PULSE' },
        { label: t(`${NAMESPACE}:tabs.reports`), value: 'REPORTS' },
        { label: t(`${NAMESPACE}:tabs.certificates`), value: 'CERTIFICATES' },
        { label: t(`${NAMESPACE}:tabs.downloads`), value: 'DOWNLOADS' },
        { label: t(`${NAMESPACE}:tabs.settings`), value: 'SETTINGS' },
        { label: t(`${NAMESPACE}:tabs.discussion`), value: 'DISCUSSION' },
        { label: t(`${NAMESPACE}:tabs.tutorMode`), value: 'TUTOR_MODE' },
        { label: t(`${NAMESPACE}:tabs.aiKnowledge`), value: 'AI_KNOWLEDGE' },
    ];
}

// Re-exported so existing course-details imports keep working; the list itself
// lives in constants/ because the settings UIs need it too.
export { DEFAULT_HIDDEN_COURSE_DETAILS_TABS } from '@/constants/display-settings/course-details-tabs';
