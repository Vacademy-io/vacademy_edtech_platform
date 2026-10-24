import type { DashboardWidgetId } from '@/types/display-settings';

// Each role gets a curated default widget bundle. Admins can still override via
// display settings (isWidgetVisible); this config only seeds the role-shaped
// defaults so a fresh role doesn't inherit the full admin dashboard.
//
// The values here are the *recommended* set. The runtime intersects this with
// display-settings visibility before rendering, so admin-side overrides win.

export type RoleBundleKey = string;

export interface RoleBundle {
    showQuickActions: boolean;
    showKpiBand: boolean;
    showFinanceSummary: boolean;
    // Widget ids that should be visible for this role *unless* explicitly hidden
    // in display settings. Use this to drive the FreshInstituteEmptyState and
    // future role-aware composition.
    recommendedWidgets: DashboardWidgetId[];
}

const ADMIN_BUNDLE: RoleBundle = {
    showQuickActions: true,
    showKpiBand: true,
    showFinanceSummary: true,
    recommendedWidgets: [
        'pendingActions',
        'recentTransactions',
        'subOrgOverview',
        'recentNotifications',
        'dailyActivityTrend',
        'enrollLearners',
        'learningCenter',
        'assessmentCenter',
        'roleTypeUsers',
        'liveClasses',
        'unresolvedDoubts',
        'instituteOverview',
        'aiFeaturesCard',
    ],
};

const TEACHER_BUNDLE: RoleBundle = {
    showQuickActions: true,
    showKpiBand: true,
    showFinanceSummary: false,
    recommendedWidgets: [
        'pendingActions',
        'myCourses',
        'liveClasses',
        'unresolvedDoubts',
        'aiFeaturesCard',
    ],
};

const COURSE_CREATOR_BUNDLE: RoleBundle = {
    showQuickActions: true,
    showKpiBand: false,
    showFinanceSummary: false,
    recommendedWidgets: ['pendingActions', 'myCourses', 'aiFeaturesCard'],
};

const ASSESSMENT_CREATOR_BUNDLE: RoleBundle = {
    showQuickActions: true,
    showKpiBand: false,
    showFinanceSummary: false,
    recommendedWidgets: ['pendingActions', 'assessmentCenter', 'aiFeaturesCard'],
};

const EVALUATOR_BUNDLE: RoleBundle = {
    showQuickActions: true,
    showKpiBand: false,
    showFinanceSummary: false,
    recommendedWidgets: ['pendingActions'],
};

const ROLE_TO_BUNDLE: Record<string, RoleBundle> = {
    ADMIN: ADMIN_BUNDLE,
    TEACHER: TEACHER_BUNDLE,
    // The backend role is 'CONTENT CREATOR' (see the role count / team pages); the old
    // 'COURSE CREATOR' key never matched, so content creators fell through to the fallback.
    'CONTENT CREATOR': COURSE_CREATOR_BUNDLE,
    'ASSESSMENT CREATOR': ASSESSMENT_CREATOR_BUNDLE,
    EVALUATOR: EVALUATOR_BUNDLE,
};

/**
 * ADMIN always wins if present in the role list. Anything else that isn't a known role —
 * custom roles ("Counsellor", "Operations"), or no roles at all — gets the least-privileged
 * staff bundle (TEACHER_BUNDLE), never the admin one: the admin bundle is what turns on the
 * finance snapshot. Pass the CURRENT institute's roles.
 *
 * TEACHER_BUNDLE still keeps quick actions and the KPI band "on"; both decide their own
 * content from the roles (quickActionsForRoles / KpiBand render nothing for a role they
 * don't know), so this fallback hides nothing a custom role could actually see before.
 */
export const bundleForRoles = (roles: string[]): RoleBundle => {
    if (!roles?.length) return TEACHER_BUNDLE;
    if (roles.includes('ADMIN')) return ADMIN_BUNDLE;
    for (const r of roles) {
        const bundle = ROLE_TO_BUNDLE[r];
        if (bundle) return bundle;
    }
    return TEACHER_BUNDLE;
};
