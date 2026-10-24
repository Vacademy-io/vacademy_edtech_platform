import { getSidebarItemsData } from '@/components/common/layout-container/sidebar/utils';
import type { SidebarItemsType } from '@/types/layout-container/layout-container-types';
import type {
    DisplaySettingsData,
    SidebarTabConfig,
    DashboardWidgetConfig,
} from '@/types/display-settings';
import { DEFAULT_ASSESSMENT_ACTION_SETTINGS } from '@/types/display-settings';

// Built-in tabs are seeded WITHOUT a `label` — see the note on
// mapSidebarToConfig in admin-defaults.ts. A seeded name would be read back as a
// user customization and freeze the nav at whatever wording was current when the
// config was saved.
function mapSidebarToTeacherConfig(menu: SidebarItemsType[]): SidebarTabConfig[] {
    return menu
        .filter((item) => item.id !== 'settings') // settings tab must be hidden for teacher
        .map((item, index) => ({
            id: item.id,
            route: item.to,
            order: index + 1,
            // By default, show everything except tabs which are inherently admin-only filtered elsewhere;
            // allow the settings engine to toggle visibility later
            visible:
                item.id !== 'manage-institute' &&
                item.id !== 'user-tags' &&
                item.id !== 'manage-payments' &&
                item.id !== 'membership-expiry' &&
                item.id !== 'membership-stats' &&
                item.id !== 'membership-stats' &&
                item.id !== 'manage-contacts' &&
                item.id !== 'admissions' &&
                item.id !== 'fee-management' &&
                item.id !== 'membership-management' &&
                item.id !== 'automations' &&
                item.id !== 'manage-contacts' &&
                item.id !== 'admin-activity-logs' &&
                // Live activity ships hidden for teachers too -- this is what makes
                // the toggle genuinely per-role rather than institute-wide.
                item.id !== 'live-activity' &&
                // Access Passes ship hidden for every role; opt in via Display Settings.
                item.id !== 'access-passes' &&
                // AI Course/Program Creator ships hidden; admins opt in via Display Settings.
                item.id !== 'ai-copilot-tab'
                    ? true
                    : false,
            subTabs:
                item.subItems?.map((sub, subIndex) => {
                    const subId = sub.subItemId || sub.subItem || `${item.id}-${subIndex + 1}`;
                    return {
                        id: subId,
                        route: sub.subItemLink || '#',
                        order: subIndex + 1,
                        // Sub-org teams + manage-institute-suborgs + notification hub
                        // are hidden by default for teachers — opt-in via settings.
                        // adminOnly sub-items too: the sidebar shows them to a
                        // non-admin role exactly when this says visible.
                        visible:
                            !sub.adminOnly &&
                            subId !== 'suborg-teams' &&
                            subId !== 'manage-institute-suborgs' &&
                            subId !== 'notification-hub',
                    };
                }) || [],
        }));
}

function defaultDashboardWidgetsTeacher(): DashboardWidgetConfig[] {
    // Same priority ordering as admin defaults (kept in sync deliberately) so
    // the Settings UI looks consistent across roles. ON by default = the
    // teacher's operational set. OFF by default = admin/finance widgets that
    // make no sense for a teacher (admins can still toggle them on).
    const teacherOn = new Set<DashboardWidgetConfig['id']>([
        'assistantLaunchBar',
        'quickActions',
        'kpiBand',
        'pendingActions',
        'unresolvedDoubts',
        'recentNotifications',
        'liveClasses',
        'learningCenter',
        'assessmentCenter',
        'myCourses',
        'aiFeaturesCard',
        // Self-hides unless the viewer is a sub-org admin, so default it ON for
        // every role — a sub-org admin resolving to teacher/custom settings
        // should still get it without an admin flipping a hidden default.
        'subOrgSelfStats',
        'subOrgRevenueTrends',
        'subOrgSeatCourses',
        'subOrgActivityDues',
    ]);

    const orderedIds: DashboardWidgetConfig['id'][] = [
        // 0. Integration health — first on the page. Hidden for teachers (absent from
        //    teacherOn): integration health is an admin concern.
        'lmsConnectionHealth',
        // 1. Navigation shortcuts
        'assistantLaunchBar',
        'quickActions',
        // 2. KPIs
        'kpiBand',
        // 3. Tasks
        'pendingActions',
        // 4. Operational health (finance)
        'financeSummary',
        'revenueTrends',
        'recentTransactions',
        'subOrgOverview',
        'subOrgSelfStats',
        'subOrgRevenueTrends',
        'subOrgGeography',
        'vleAnalytics',
        'topVles',
        'subOrgSeatCourses',
        'subOrgActivityDues',
        // 5. Engagement signals
        'unresolvedDoubts',
        'recentNotifications',
        'dailyActivityTrend',
        'userActivitySummary',
        'realTimeActiveUsers',
        'currentlyActiveUsers',
        // 6. LMS operations
        'lmsConnectionHealth',
        'liveClasses',
        'enrollLearners',
        'learningCenter',
        'assessmentCenter',
        'myCourses',
        // 7. Reference data
        'roleTypeUsers',
        'instituteOverview',
        // 8. Promotional
        'aiFeaturesCard',
    ];
    return orderedIds.map((id, idx) => ({
        id,
        order: idx + 1,
        visible: teacherOn.has(id),
    }));
}

// Everything except `sidebar`, which is built per call below — see the matching
// note in admin-defaults.ts.
const TEACHER_DEFAULTS_BASE: Omit<DisplaySettingsData, 'sidebar'> = {
    dashboard: {
        widgets: defaultDashboardWidgetsTeacher(),
    },
    coursePage: {
        viewInviteLinks: true,
        viewShortInviteLinks: false,
        viewCourseConfiguration: true,
        viewCourseOverviewItem: true,
        viewContentNumbering: true,
        allowViewSlidesInReadOnly: true,
        directEditPublishedCourse: false,
        requireCourseApproval: true,
        canEditCourseStructure: false,
        canDeleteCourseStructure: false,
        showBulkUpload: false,
        showAddSubject: true,
        showAddModule: true,
        showAddChapter: true,
        showAddSlide: true,
        showLearnerProgressReport: true,
    },
    courseList: {
        tabs: [
            { id: 'AllCourses', order: 1, visible: true },
            { id: 'AuthoredCourses', order: 2, visible: true },
            { id: 'CourseInReview', order: 3, visible: true },
            { id: 'CourseApproval', order: 4, visible: false },
        ],
        defaultTab: 'AuthoredCourses',
    },
    courseDetails: {
        tabs: [
            { id: 'OUTLINE', order: 1, visible: true },
            { id: 'CONTENT_STRUCTURE', order: 2, visible: true },
            { id: 'LEARNER', order: 3, visible: true },
            { id: 'TEACHER', order: 4, visible: true },
            { id: 'ASSESSMENT', order: 5, visible: true },
            // Quiz Results sits next to Assessment: both answer "how did they do",
            // one for exams and one for the quiz slides inside the course.
            // Ordered 5.5 so it slots between Assessment (5) and whatever a role has
            // at 6, WITHOUT renumbering the tabs after it. Renumbering looked tidier
            // but collides: 92 of the 94 institutes with a saved courseDetails config
            // already store a tab at order 6 (32x LIVE_SESSION, 60x PLANNING), and
            // saved values win the merge — so a shared order is what would actually
            // ship. Two tabs on the same order make the Display Settings up/down
            // arrows a dead click, because swapOrder swaps the two order VALUES and
            // swapping equal numbers changes nothing.
            { id: 'QUIZ_RESULTS', order: 5.5, visible: true },
            { id: 'LIVE_SESSION', order: 6, visible: false },
            { id: 'PLANNING', order: 7, visible: false },
            { id: 'ACTIVITY', order: 8, visible: false },
            { id: 'PULSE', order: 9, visible: true },
            { id: 'REPORTS', order: 10, visible: true },
            { id: 'CERTIFICATES', order: 11, visible: false },
            // See admin-defaults: DOWNLOADS must exist in the defaults or a
            // saved `visible: false` is stripped by mergeArrayById.
            { id: 'DOWNLOADS', order: 12, visible: true },
            { id: 'SETTINGS', order: 13, visible: false },
            // Live AI Tutor (2026-09): 13.5 slots it after Settings without renumbering
            // tabs institutes have already saved orders for (same trick as QUIZ_RESULTS).
            { id: 'TUTOR_MODE', order: 13.5, visible: true },
            // Course knowledge (2026-10): rendered only when the platform has made the
            // feature available to the institute (course-knowledge GET /status).
            { id: 'AI_KNOWLEDGE', order: 13.6, visible: true },
        ],
        defaultTab: 'CONTENT_STRUCTURE',
    },
    permissions: {
        canViewInstituteDetails: false,
        canEditInstituteDetails: false,
        canViewProfileDetails: true,
        canEditProfileDetails: false,
    },
    ui: {
        showSupportButton: true,
        showSidebar: true,
        showAiCredits: false,
        // Hidden by default for non-admin roles (custom roles inherit these
        // defaults too); enable per role from Display Settings → UI Options.
        showAssistDock: false,
        // Status link defaults visible for every role. The Settings gear is
        // admin-only by default; non-admin roles (teacher/custom) must be
        // opted in per role from Display Settings, since it surfaces a path
        // into the full settings page.
        showStatus: true,
        showSettings: false,
    },
    contentTypes: {
        pdf: true,
        video: { enabled: true, showInVideoQuestion: true },
        codeEditor: true,
        document: true,
        question: true,
        quiz: true,
        assignment: true,
        jupyterNotebook: true,
        scratch: true,
        ppt: true,
        audio: true,
        scorm: true,
        assessment: true,
    },
    slideView: {
        showCopyTo: true,
        showMoveTo: true,
        showDelete: true,
        showAddVideoQuestion: true,
        showConvertToSplitScreen: true,
    },
    authoredCoursesCard: {
        showCopyToEdit: false,
        showDelete: false,
    },
    courseListCard: {
        showEnrolledStudentCount: false,
    },
    assessmentPage: { ...DEFAULT_ASSESSMENT_ACTION_SETTINGS },
    // Off for teachers and custom roles (which share these defaults) — an admin
    // grants it per role from Display Settings.
    liveClassActions: {
        allowDeletePastSessions: false,
    },
    // Off for every role — an institute opts a role in from Display Settings.
    leadActions: {
        showAddLead: false,
    },
    courseCreation: {
        showCreateCourseWithAI: false,
        requirePackageSelectionForNewChapter: true,
        showAdvancedSettings: true,
        limitToSingleLevel: false,
    },
    studentSideView: {
        overviewTab: true,
        testTab: true,
        progressTab: true,
        coursesTab: true,
        notificationTab: false,
        // Off by default: resending sends a real message to a learner, so it is
        // opt-in for this role even where the Notifications tab is enabled.
        allowResendMessage: false,
        membershipTab: false,
        paymentHistoryTab: true,
        userTaggingTab: false,
        badgesTab: true,
        fileTab: false,
        portalAccessTab: false,
        reportsTab: false,
        enrollDerollTab: false,
        enquiryTab: false,
        applicationTab: false,
        leadTab: false,
        fullHistoryTab: false,
        workflowsTab: false,
        parentTab: false,
        onboardingTab: false,
        tabOrders: {
            overview: 1,
            courses: 2,
            learningProgress: 3,
            testRecord: 4,
            notifications: 5,
            membership: 6,
            paymentHistory: 7,
            userTagging: 8,
            badges: 9,
            files: 10,
            portalAccess: 11,
            reports: 12,
            enrollDeroll: 13,
            enquiry: 14,
            application: 15,
            lead: 16,
            fullHistory: 17,
            parent: 18,
            workflows: 19,
        },
        defaultTab: 'overview',
    },
    learnerManagement: {
        allowPortalAccess: true,
        allowViewPassword: true,
        allowSendResetPasswordMail: true,
        showApprovalToggle: false,
        // Opt-in: changing credentials signs the learner out of their session.
        allowEditCredentials: false,
        allowDeletePayments: false,
        canApplyDiscounts: false,
    },
    studentManagementActions: {
        showEnrollButton: true,
        showInviteButton: true,
        customButtons: [],
    },
    subOrganizations: {
        // Off by default. When an admin turns this on for a teacher / custom role
        // the user reaches the module but only ever sees the channel partners
        // assigned to them (enforced server-side).
        moduleEnabled: false,
        // No channel partners granted at role level by default.
        assignedSubOrgIds: [],
        // Read-only out of the box; admins opt each write capability in per role.
        permissions: {
            canCreate: false,
            canEditConfig: false,
            canManageTeam: false,
            canViewFinance: true,
            canManageFinance: false,
            canExport: true,
        },
    },
    leadsFilterCustomFields: [],
    postLoginRedirectRoute: '/dashboard',
};

/**
 * Default teacher display settings. See getDefaultAdminDisplaySettings() for why
 * this must not be cached at module scope.
 */
export function getDefaultTeacherDisplaySettings(): DisplaySettingsData {
    return {
        ...TEACHER_DEFAULTS_BASE,
        sidebar: mapSidebarToTeacherConfig(getSidebarItemsData()),
    };
}
