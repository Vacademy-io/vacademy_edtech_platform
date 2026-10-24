import {
    LEARNER_TOUR_KEYS,
    type StudentDisplaySettingsData,
    type StudentSidebarTabConfig,
    type StudentDashboardWidgetConfig,
} from '@/types/student-display-settings';

function defaultSidebarTabs(): StudentSidebarTabConfig[] {
    return [
        { id: 'dashboard', order: 1, visible: true },
        {
            id: 'learning-center',
            order: 2,
            visible: true,
            subTabs: [
                { id: 'study-library', route: '/study-library', order: 1, visible: true },
                { id: 'attendance', route: '/learning-centre/attendance', order: 2, visible: true },
                { id: 'live-classes', route: '/study-library/live-class', order: 3, visible: true },
            ],
        },
        {
            id: 'homework',
            order: 3,
            // Hidden from learners by default; admins can enable it in Student Display settings.
            visible: false,
            subTabs: [
                { id: 'homework-list', route: '/homework/list', order: 1, visible: true },
                { id: 'homework-reports', route: '/homework/reports', order: 2, visible: true },
            ],
        },
        {
            id: 'assessment-center',
            order: 4,
            visible: true,
            subTabs: [
                { id: 'assessment-list', route: '/assessment/list', order: 1, visible: true },
                { id: 'assessment-reports', route: '/assessment/reports', order: 2, visible: true },
            ],
        },
        {
            id: 'planning',
            order: 5,
            // Hidden from learners by default; admins can enable it in Student Display settings.
            visible: false,
            subTabs: [
                { id: 'planning-logs', route: '/planning/planning-logs', order: 1, visible: true },
                { id: 'activity-logs', route: '/planning/activity-logs', order: 2, visible: true },
            ],
        },
        // Hidden from learners by default; admins can enable it in Student Display settings.
        { id: 'referral', order: 6, visible: false },
        { id: 'attendance', order: 7, visible: true },
    ];
}

function defaultDashboardWidgets(): StudentDashboardWidgetConfig[] {
    // MUST stay identical (ids, order AND default visibility) to the learner
    // app's defaultDashboardWidgets. These defaults get PERSISTED on the first
    // save from this screen, so any divergence silently reshuffles or re-shows
    // widgets the moment an admin opens settings and hits Save.
    const defaults: Array<Omit<StudentDashboardWidgetConfig, 'order'>> = [
        // Hero band, above the columns — its order is cosmetic (the hero is not
        // part of the ordered main/rail columns), it leads the list because
        // that is where it renders.
        { id: 'gettingStarted', visible: true },
        { id: 'continueLearning', visible: true },
        { id: 'coursesStat', visible: true },
        { id: 'liveClasses', visible: true },
        { id: 'evaluationStat', visible: true },
        { id: 'learningAnalytics', visible: true },
        { id: 'myMembership', visible: true },
        { id: 'myBooks', visible: true },
        // Opt-in: off unless an institute turns it on.
        { id: 'myOrders', visible: false },
        { id: 'upcomingLiveClasses', visible: true },
        { id: 'myMentors', visible: true },
        { id: 'thisWeekAttendance', visible: true },
        { id: 'gamification', visible: true },
        { id: 'exploreMemberships', visible: true },
        { id: 'exploreBooks', visible: true },
        // Declared LAST on purpose — see FRACTIONAL_ORDERS below.
        { id: 'enrolledCourses', visible: true },
        // On by default. It self-hides for any institute with no app link on
        // its domain-routing row, so the only institutes it reaches are the
        // ones that actually ship an app. Note this means those institutes
        // advertise the downloads twice until they turn `sidebar.appLinks` off.
        { id: 'getApp', visible: true },
        // Today's teacher-scheduled tasks. Declared last and given a fractional
        // order, like enrolledCourses above. Renders nothing without a plan.
        { id: 'todayTasks', visible: true },
    ];
    // Widgets added after this list shipped cannot simply be spliced in: order
    // comes from the array index, and an institute that saved earlier already
    // holds orders 1..15. Inserting mid-list would renumber the defaults and
    // hand the new widget an order a saved widget occupies — and moveWidget
    // reorders by SWAPPING two rows' order values, so a tie leaves both rows'
    // arrows permanently inert and onSave writes the duplicate back.
    //
    // So the new id is declared last (every pre-existing widget keeps its exact
    // original order) and given a FRACTIONAL order instead: 2.5 sorts between
    // continueLearning (2) and coursesStat (3), which is where the widget
    // belongs, and can never equal an integer order a saved institute holds.
    // Swapping preserves the set of orders, so reordering cannot create a
    // duplicate either.
    // getApp is a rail widget. 12.5 puts it last in the rail — after
    // upcomingLiveClasses (10), myMentors (11) and thisWeekAttendance (12) —
    // without colliding with gamification (13) in the main column.
    // todayTasks sits in whichever column the learner's screen width picks (the
    // rail at lg and up, else the main column right under the hero). 0.5 sorts
    // it first in both, ahead of every order a saved institute can hold (the
    // lowest ever written is 1), so it also leads this settings list.
    const FRACTIONAL_ORDERS: Record<string, number> = {
        enrolledCourses: 2.5,
        getApp: 12.5,
        todayTasks: 0.5,
    };
    return defaults.map((w, idx) => ({
        ...w,
        order: FRACTIONAL_ORDERS[w.id] ?? idx + 1,
    }));
}

export const DEFAULT_STUDENT_DISPLAY_SETTINGS: StudentDisplaySettingsData = {
    sidebar: {
        visible: true,
        tabs: defaultSidebarTabs(),
        appLinks: true,
    },
    dashboard: {
        widgets: defaultDashboardWidgets(),
    },
    ui: {
        type: 'default',
    },
    signup: {
        enabled: true,
        providers: {
            google: true,
            github: false,
            usernamePassword: true,
            emailOtp: false,
            defaultProvider: 'google',
        },
        usernameStrategy: 'email',
        passwordStrategy: 'manual',
        passwordDelivery: 'none',
        presentation: 'page',
    },
    permissions: {
        canViewProfile: true,
        canEditProfile: true,
        canDeleteProfile: false,
        canViewFiles: false,
        canViewReports: false,
    },
    profile: {
        // Hidden by default; admins can enable it in Student Display settings.
        showMembershipStatus: false,
    },
    courseDetails: {
        tabs: [
            { id: 'OUTLINE', order: 1, visible: true },
            { id: 'CONTENT_STRUCTURE', order: 2, visible: true },
            { id: 'TEACHERS', order: 3, visible: true },
            { id: 'ASSESSMENTS', order: 4, visible: true },
        ],
        defaultTab: 'OUTLINE',
        outlineMode: 'expanded',
        ratingsAndReviewsVisible: true,
        hideAuthorName: false,
        // Full teacher roster is opt-in; the first author always shows.
        showInstructors: false,
        showCourseConfiguration: true,
        hideTags: false,
        showCourseContentPrefixes: true,
        courseOverview: { visible: true, showSlidesData: true },
        slidesView: {
            showLearningPath: true,
            feedbackVisible: true,
            canAskDoubt: true,
            // "breadcrumb" = legacy chapter-scoped slide list; cross-module
            // navigation happens via the breadcrumb popovers at the top of
            // the viewer. Switch to "ancestors" to show the full
            // Subject → Module → Chapter → Slide tree in the sidebar.
            sidebarNavigation: 'breadcrumb',
        },
        // "full" = today's course-details page. Institutes that want the
        // table-of-contents page (Content Structure card only, no right-hand
        // overview card / description / tags) switch this to "contentOnly".
        enrolledLayout: 'full',
        contentCardImageFit: 'cover',
    },
    courseSettings: {
        quiz: {
            moveOnlyOnCorrectAnswer: false,
            celebrateOnQuizComplete: true,
            showReportAndCorrectAnswers: true,
        },
        assignment: {
            hideAttemptsAllowed: false,
            hideRepeatedTitle: false,
        },
    },
    allCourses: {
        tabs: [
            { id: 'InProgress', order: 1, visible: true },
            { id: 'Completed', order: 2, visible: true },
            { id: 'AllCourses', order: 3, visible: true },
        ],
        defaultTab: 'InProgress',
        hideInstructorName: false,
        pageSize: 10,
        showAllEnrolledOnDashboard: false,
    },
    notifications: {
        allowSystemAlerts: true,
        allowDashboardPins: true,
        allowBatchStream: true,
        allowAppOverlays: true,
    },
    liveClasses: {
        showPastSessions: false,
        showRecordings: false,
        showAttendance: false,
        showActivityStats: false,
        showClassMaterials: false,
        showUnassignedPublicSessions: false,
    },
    tutorials: {
        // Off by default; admins opt in from Student Display settings.
        enabled: false,
        enabledTours: [...LEARNER_TOUR_KEYS],
        pdfGuideEnabled: false,
    },
    concentration: {
        enabled: true,
        frequency: {
            min_minutes: 5,
            max_minutes: 7,
        },
        behavior: {
            allow_skip: false,
            penalty_type: 'pause',
        },
        appearance: {
            title: 'Focus Check',
            subtitle: 'Select the matching number to continue your streak',
        },
    },
    postLoginRedirectRoute: '/dashboard',
};
