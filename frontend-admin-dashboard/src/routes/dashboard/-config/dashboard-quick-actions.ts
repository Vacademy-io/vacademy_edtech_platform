import type { TFunction } from 'i18next';
import {
    UserPlus,
    Plus,
    Megaphone,
    ChartPie,
    CalendarPlus,
    Receipt,
    GraduationCap,
    BookOpen,
} from '@phosphor-icons/react';

export interface QuickAction {
    id: string;
    label: string;
    icon: typeof UserPlus;
    to: string;
    search?: Record<string, string>;
}

const buildAdminActions = (t: TFunction): QuickAction[] => [
    {
        id: 'add-student',
        label: t('dashboardQuickActions:actions.addStudent'),
        icon: UserPlus,
        to: '/manage-students/students-list',
        search: { action: 'enroll' },
    },
    {
        id: 'new-batch',
        label: t('dashboardQuickActions:actions.newBatch'),
        icon: Plus,
        to: '/manage-institute/batches',
    },
    {
        id: 'announce',
        label: t('dashboardQuickActions:actions.announcement'),
        icon: Megaphone,
        to: '/announcement/create',
    },
    {
        id: 'collect-payment',
        label: t('dashboardQuickActions:actions.payments'),
        icon: Receipt,
        to: '/manage-payments',
    },
    {
        id: 'reports',
        label: t('dashboardQuickActions:actions.reports'),
        icon: ChartPie,
        to: '/study-library/reports',
    },
];

const buildTeacherActions = (t: TFunction): QuickAction[] => [
    {
        id: 'todays-classes',
        label: t('dashboardQuickActions:actions.todaysClasses'),
        icon: CalendarPlus,
        to: '/study-library/live-session',
    },
    {
        id: 'my-courses',
        label: t('dashboardQuickActions:actions.myCourses'),
        icon: BookOpen,
        to: '/study-library/courses',
    },
    {
        id: 'reports',
        label: t('dashboardQuickActions:actions.reports'),
        icon: ChartPie,
        to: '/study-library/reports',
    },
];

const buildCourseCreatorActions = (t: TFunction): QuickAction[] => [
    {
        id: 'my-courses',
        label: t('dashboardQuickActions:actions.myCourses'),
        icon: BookOpen,
        to: '/study-library/courses',
    },
    {
        id: 'new-course',
        label: t('dashboardQuickActions:actions.newCourse'),
        icon: Plus,
        to: '/study-library/courses',
    },
];

const buildAssessmentCreatorActions = (t: TFunction): QuickAction[] => [
    {
        id: 'assessments',
        label: t('dashboardQuickActions:actions.assessments'),
        icon: GraduationCap,
        to: '/assessment',
    },
    {
        id: 'reports',
        label: t('dashboardQuickActions:actions.reports'),
        icon: ChartPie,
        to: '/study-library/reports',
    },
];

const buildEvaluatorActions = (t: TFunction): QuickAction[] => [
    {
        id: 'evaluations',
        label: t('dashboardQuickActions:actions.evaluations'),
        icon: GraduationCap,
        to: '/evaluation',
    },
];

export const quickActionsForRoles = (roles: string[], t: TFunction): QuickAction[] => {
    if (!roles?.length) return [];
    // Match against the backend role names in the token (current institute's roles).
    // The course-authoring role is 'CONTENT CREATOR' — there is no 'COURSE CREATOR' role.
    const roleToActions: Record<string, () => QuickAction[]> = {
        ADMIN: () => buildAdminActions(t),
        TEACHER: () => buildTeacherActions(t),
        'CONTENT CREATOR': () => buildCourseCreatorActions(t),
        'ASSESSMENT CREATOR': () => buildAssessmentCreatorActions(t),
        EVALUATOR: () => buildEvaluatorActions(t),
    };
    // ADMIN wins if present (broadest action set).
    if (roles.includes('ADMIN')) return buildAdminActions(t);
    // Otherwise, take the first matched role's set.
    for (const r of roles) {
        const build = roleToActions[r];
        if (build) return build();
    }
    return [];
};
