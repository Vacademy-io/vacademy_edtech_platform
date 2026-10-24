import type { DashboardWidgetId } from '@/types/display-settings';

// Human-readable labels for dashboard widget IDs. Shown in
// Settings → Display Settings → Dashboard Widgets. Anything missing falls
// back to the raw id (still legible camelCase, just unfriendly).
//
// Keep this in sync with DashboardWidgetId. Adding a new widget? Add it to
// the union, both default lists (admin / teacher), AND this map.
export const DASHBOARD_WIDGET_LABELS: Record<DashboardWidgetId, string> = {
    assistantLaunchBar: 'Assistant composer (dashboard)',
    quickActions: 'Quick Actions strip',
    kpiBand: 'KPI band',
    pendingActions: 'Pending Actions inbox',
    financeSummary: 'Finance snapshot',
    recentTransactions: 'Recent transactions',
    recentNotifications: 'Recent notifications',
    realTimeActiveUsers: 'Real-time active users',
    currentlyActiveUsers: 'Currently active users',
    userActivitySummary: "Today's activity summary",
    dailyActivityTrend: 'Daily activity trend',
    enrollLearners: 'Enroll learners panel',
    learningCenter: 'Learning center panel',
    assessmentCenter: 'Assessment center panel',
    roleTypeUsers: 'Role type users',
    myCourses: 'My courses (non-admin)',
    unresolvedDoubts: 'Unresolved doubts',
    liveClasses: 'Live classes',
    aiFeaturesCard: 'AI features card',
    instituteOverview: 'Institute overview',
    subOrgOverview: 'Sub-org overview',
    subOrgSelfStats: 'My sub-org stats (sub-org admin)',
    subOrgGeography: 'Sub-orgs by location (state/city/pincode)',
    revenueTrends: 'Amount collected (time filter)',
    subOrgRevenueTrends: 'My sub-org amount collected (sub-org admin)',
    vleAnalytics: 'Sub-org insights (plans / seats / growth)',
    topVles: 'Top sub-orgs (by seats used)',
    subOrgSeatCourses: 'My learners & courses (sub-org admin)',
    subOrgActivityDues: 'My plan & dues (sub-org admin)',
    mentorshipStats: 'Mentorship stats',
    lmsConnectionHealth: 'LMS connection health',
};

export const widgetLabel = (id: DashboardWidgetId): string =>
    DASHBOARD_WIDGET_LABELS[id] || id;
