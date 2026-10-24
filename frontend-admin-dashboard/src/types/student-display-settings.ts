// Types for Student Display Settings (Learner Portal)

import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const STUDENT_DISPLAY_SETTINGS_KEY = 'STUDENT_DISPLAY_SETTINGS' as const;

// Sidebar
export interface StudentSidebarSubTabConfig {
    id: string;
    label?: string;
    route: string;
    order: number;
    visible: boolean;
}

export interface StudentSidebarTabConfig {
    id: string; // dashboard, learning-center, homework, assessment-center, referral, attendance, etc.
    label?: string;
    route?: string;
    order: number;
    visible: boolean;
    subTabs?: StudentSidebarSubTabConfig[];
    isCustom?: boolean;
}

// Dashboard Widgets
/**
 * Every id the learner dashboard actually renders. Keep in sync with the
 * learner app's StudentDashboardWidgetId.
 */
export type StudentDashboardWidgetId =
    // The "Let's get you started" first-run onboarding checklist in the hero
    // band. Only the default/vibrant hero has one — the play / cleaner-play
    // heroes show a greeting band instead, which this flag does not affect.
    | 'gettingStarted'
    // The XP / streak / badges block at the bottom of the dashboard. Covers
    // both the standard panel and the play theme's own trio of widgets. Note
    // the badges card has a second, narrower switch of its own (the badge
    // config's master toggle); this flag hides the whole block.
    | 'gamification'
    | 'coursesStat'
    | 'evaluationStat'
    | 'continueLearning'
    // The learner's enrolled courses with per-course progress and a way back
    // in. Distinct from coursesStat, which is only the count tile.
    | 'enrolledCourses'
    | 'learningAnalytics'
    | 'liveClasses'
    | 'thisWeekAttendance'
    | 'myMembership'
    | 'myBooks'
    | 'upcomingLiveClasses'
    | 'myMentors'
    | 'myOrders'
    // Bottom-of-page commerce CTAs. Separate from myMembership / myBooks so the
    // widget and the "go buy more" button can be controlled independently.
    | 'exploreMemberships'
    | 'exploreBooks'
    // "Get the app" download card. Shows the store links configured on the
    // institute's domain-routing row — the same source the learner sidebar
    // footer uses, so an institute can carry them in the sidebar, the
    // dashboard, both, or neither (see `sidebar.appLinks`).
    | 'getApp'
    // Today's teacher-scheduled tasks (the Daily Engagement module). The
    // learner dashboard renders nothing for an institute with no plan running.
    | 'todayTasks'
    | 'custom';

/**
 * Ids that used to be offered here but that the learner dashboard never reads.
 * Toggling them did nothing, so they are filtered out of the settings UI. They
 * may still exist in an institute's saved JSON — harmless, and left in place so
 * this list stays a pure display filter rather than a destructive migration.
 */
export const RETIRED_WIDGET_IDS: ReadonlySet<string> = new Set([
    'assessmentsStat',
    'activityTrend',
    'dailyProgress',
    'myClasses',
    'referAFriend',
]);

/** Human labels for the settings screen — `w.id` alone reads like a variable name. */
export const WIDGET_LABELS: Record<string, string> = {
    gettingStarted: "Getting Started checklist (“Let's get you started”)",
    continueLearning: 'Continue Learning',
    enrolledCourses: 'Enrolled Courses (one card per enrolled course)',
    coursesStat: 'Courses (stat card)',
    liveClasses: 'Live Sessions (stat card)',
    evaluationStat: 'Assessments (stat card)',
    learningAnalytics: 'Learning Analytics',
    myMembership: 'My Membership',
    myBooks: 'My Books',
    myOrders: 'My Orders',
    upcomingLiveClasses: 'Upcoming Live Classes',
    myMentors: 'My Mentors',
    thisWeekAttendance: 'Attendance (this week)',
    gamification: 'Gamification (XP, streak, badges)',
    exploreMemberships: 'Explore Memberships (button)',
    exploreBooks: 'Explore Books (button)',
    getApp: 'Get the app (download links card)',
    todayTasks: "Today's tasks (daily engagement plan)",
    custom: 'Custom',
};

export interface StudentDashboardWidgetConfig {
    id: StudentDashboardWidgetId;
    order: number;
    visible: boolean;
    isCustom?: boolean;
    title?: string;
    subTitle?: string;
    link?: string; // route or external link for onClick
}

// Signup/Login configuration
export type StudentSignupProvider = 'google' | 'github' | 'usernamePassword' | 'emailOtp';
export type StudentDefaultProvider = StudentSignupProvider;
// email/random/manual: learner signup only, as before. phone/customField: also learner
// signup. usernameApplyToAll extends the chosen strategy to every new learner (admin
// add, CSV, invite links, payments, forms); an admin-typed username wins unless
// usernameOverrideTyped is also on.
export type UsernameStrategy = 'email' | 'random' | 'manual' | 'phone' | 'customField';
export type PasswordStrategy = 'manual' | 'autoRandom';
export type PasswordDelivery = 'showOnScreen' | 'sendEmail' | 'none';
// Controls how catalogue-header login/signup buttons surface auth.
// - "page" (default): navigate to /login or /signup
// - "modal": open the AuthModal in-place
export type StudentAuthPresentation = 'page' | 'modal';

export interface StudentSignupSettings {
    // Master toggle: when false, signup is hidden in catalogue UI
    // (e.g. "Sign Up" auth links are filtered out). Default: true.
    enabled?: boolean;
    providers: {
        google: boolean;
        github: boolean;
        usernamePassword: boolean;
        emailOtp: boolean;
        defaultProvider: StudentDefaultProvider;
    };
    usernameStrategy: UsernameStrategy;
    usernameCustomFieldId?: string; // for 'customField'
    usernamePrefix?: string; // put in front of phone / custom field values
    usernameApplyToAll?: boolean; // default off
    usernameOverrideTyped?: boolean; // default off; with usernameApplyToAll, also over a typed username
    passwordStrategy: PasswordStrategy;
    passwordDelivery: PasswordDelivery;
    presentation?: StudentAuthPresentation;
}

// UI
export type StudentUiType = 'default' | 'vibrant' | 'play' | 'cleanerPlay' | 'corporate';
export interface StudentUiSettings {
    type: StudentUiType;
}

// Course details settings
export type StudentCourseDetailsTabId =
    | 'OUTLINE'
    | 'CONTENT_STRUCTURE'
    | 'TEACHERS'
    | 'ASSESSMENTS';

export interface StudentCourseDetailsTabConfig {
    id: StudentCourseDetailsTabId;
    label?: string;
    order: number;
    visible: boolean;
}

export type OutlineMode = 'expanded' | 'collapsed';

/**
 * How the slide viewer's left sidebar lets the learner navigate course content.
 * - "breadcrumb": Sidebar shows only the current chapter's slide list; learners
 *   jump across modules/subjects via breadcrumb popovers (legacy layout).
 * - "ancestors": Sidebar shows the full Subject → Module → Chapter → Slide tree.
 * - "lessons": Sidebar shows the whole course as a flat, thumbnail-led lesson
 *   list — chapters are headings rather than toggles and nothing collapses.
 * - "hidden": No sidebar; the learner moves with Previous / Next alone.
 */
export type SlidesSidebarNavigation = 'breadcrumb' | 'ancestors' | 'lessons' | 'hidden';

/**
 * Layout of the course-details page once the learner is ENROLLED in the course.
 *
 * - "full" (default): today's page — banner, description/tags, course
 *   highlights, the enrollment/configuration block and the right-hand overview
 *   card, with every visible tab.
 * - "contentOnly": a focused page for institutes that treat course-details as
 *   a table of contents rather than a sales page. Everything marketing-shaped
 *   is dropped (description, tags, media, highlights, author, right-hand card)
 *   and the page renders the Content Structure card alone, which drills
 *   Subject → Module → Chapter → Slides as cards.
 *
 * Scope: the learner's own course page under /study-library — the surface they
 * land on after enrolling. The shopper-facing pages (/courses/course-details
 * and the public catalogue) are separate components and are never affected, so
 * a buyer still gets the description, price and author they need to decide.
 */
export type EnrolledCourseLayout = 'full' | 'contentOnly';

/**
 * How a Content Structure card fits its thumbnail.
 *
 * - `cover`   fills the 16:9 frame and crops whatever overflows (today's
 *             behaviour, and what the admin dashboard does)
 * - `contain` shows the whole image, letterboxed inside the frame
 *
 * Worth a setting because it depends entirely on the artwork: a photo wants
 * `cover`, a designed thumbnail with a title baked into it gets its wording
 * sliced off and wants `contain`.
 */
export type ContentCardImageFit = 'cover' | 'contain';

/**
 * How far the learner must get before the "Give Feedback" slide is offered.
 * "CHAPTER" (default) is today's behaviour — after every chapter. MODULE /
 * SUBJECT / COURSE ask once per section instead, which is what a long course
 * wants; NEVER disables the auto-open while leaving the sidebar's Feedback
 * button working.
 */
export type FeedbackTrigger = 'CHAPTER' | 'MODULE' | 'SUBJECT' | 'COURSE' | 'NEVER';

export interface StudentCourseDetailsSettings {
    tabs: StudentCourseDetailsTabConfig[];
    defaultTab: StudentCourseDetailsTabId;
    outlineMode: OutlineMode;
    ratingsAndReviewsVisible: boolean;
    /** Hide the "Author" row in the course-details Course Overview panel. Default false (author shown). */
    hideAuthorName?: boolean;
    /**
     * List EVERY teacher of the batch on the course-details page. Default false:
     * only the first author is shown (with photo, subtitle and bio). Learners
     * never see email addresses either way.
     */
    showInstructors?: boolean;
    // New toggles
    showCourseConfiguration: boolean;
    /** Hide the course's tag chips (ENGLISH, E-LEARNING…) above its title. Default false (shown). */
    hideTags?: boolean;
    showCourseContentPrefixes: boolean;
    courseOverview: { visible: boolean; showSlidesData: boolean };
    slidesView: {
        showLearningPath: boolean;
        feedbackVisible: boolean;
        canAskDoubt: boolean;
        /** Optional for backwards compat. Missing means default ("breadcrumb"). */
        sidebarNavigation?: SlidesSidebarNavigation;
        /**
         * Collapse the app's own left nav rail while the slide viewer is open,
         * the way focus mode does. Unset means "follow the sidebar mode": the
         * sidebar-less viewer collapses the rail, every other mode leaves it
         * alone. An explicit true/false always wins.
         */
        collapseSidebarOnOpen?: boolean;
        /**
         * Show an explicit "Mark as complete" control in the slide viewer — the
         * checkbox Udemy, Coursera and LinkedIn Learning put beside a lesson.
         * Automatic tracking is unchanged; this is the manual override for what
         * dwell-time and watch-percentage cannot see. Writes the same progress
         * record as the automatic path and is reversible.
         *
         * Tri-state, like collapseSidebarOnOpen: unset follows the sidebar mode
         * (the sidebar-less viewer shows it, since it has no tick list or
         * progress readout of its own), explicit true/false wins.
         */
        manualCompletion?: boolean;
        /**
         * "Chapter complete — next up" hand-off bar. Tri-state: unset follows
         * the sidebar mode (shown only in the sidebar-less viewer, the one that
         * dead-ends without it), explicit true/false wins.
         */
        chapterCompleteCta?: boolean;
        /**
         * Whether the "Give Feedback" slide sits in the Prev/Next sequence.
         * Tri-state: unset follows the sidebar mode. Independent of
         * feedbackVisible, which is the master switch.
         */
        feedbackInSlideNav?: boolean;
        /** See {@link FeedbackTrigger}. Missing means 'CHAPTER' (today). */
        feedbackTrigger?: FeedbackTrigger;
    };
    /** See {@link EnrolledCourseLayout}. Optional for backwards compat; missing
     *  means "full" so saved settings keep rendering today's page. */
    enrolledLayout?: EnrolledCourseLayout;
    /**
     * Tapping a chapter card opens its first available slide straight in the
     * viewer instead of listing the chapter's slides first. Tri-state: unset
     * follows enrolledLayout (content-only skips the list), explicit wins.
     */
    chapterOpensFirstSlide?: boolean;
    /** See {@link ContentCardImageFit}. Missing means "cover" (today). */
    contentCardImageFit?: ContentCardImageFit;
}

// Course Settings
export interface StudentCourseSettings {
    quiz: {
        moveOnlyOnCorrectAnswer: boolean;
        celebrateOnQuizComplete: boolean;
        showReportAndCorrectAnswers: boolean;
    };
    /** Assignment slide. Both off by default (today's slide). */
    assignment: {
        /** Hide the "Attempts Allowed: …" line. */
        hideAttemptsAllowed: boolean;
        /** Hide the card title when it only repeats the slide name shown above it. */
        hideRepeatedTitle: boolean;
    };
}

// All Courses page settings
export type StudentAllCoursesTabId = 'InProgress' | 'Completed' | 'AllCourses';

export interface StudentAllCoursesTabConfig {
    id: StudentAllCoursesTabId;
    label?: string;
    order: number;
    visible: boolean;
}

/**
 * Admin-defined tab on the learner's Courses page that lists every catalogue
 * course carrying ANY of `tags`. Kept out of `tabs` on purpose: older learner
 * builds map an unknown tab id to In Progress, so a custom entry there would
 * surface as a duplicate In Progress tab. `order` shares the built-in tabs'
 * numbering so the two lists interleave.
 */
/**
 * What a custom Courses-page tab shows. Absent on tabs saved before types
 * existed — those are TAG tabs.
 * - TAG: catalogue courses carrying ANY of `tags`
 * - COURSES: the catalogue courses picked in `courseIds`
 * - FREE_COURSES: catalogue courses whose cheapest plan costs 0
 * - LIVE_SESSIONS: the learner's live/upcoming sessions (incl. public webinars)
 * - PRODUCT_PAGES: cards opening the product pages in `productPages`
 */
export type StudentAllCoursesCustomTabType =
    | 'TAG'
    | 'COURSES'
    | 'FREE_COURSES'
    | 'LIVE_SESSIONS'
    | 'PRODUCT_PAGES';

export interface StudentAllCoursesCustomTabProductPage {
    code: string;
    name: string;
}

export interface StudentAllCoursesCustomTab {
    id: string;
    label: string;
    type?: StudentAllCoursesCustomTabType;
    tags: string[];
    courseIds?: string[];
    productPages?: StudentAllCoursesCustomTabProductPage[];
    order: number;
    visible: boolean;
}

export interface StudentAllCoursesSettings {
    tabs: StudentAllCoursesTabConfig[];
    customTabs?: StudentAllCoursesCustomTab[];
    defaultTab: StudentAllCoursesTabId;
    /** Hide the instructor/teacher name block on each course card in the All Courses list. Default false (shown). */
    hideInstructorName?: boolean;
    /** Courses per page on the All Courses list. Default 10. */
    pageSize?: number;
    /** Dashboard "My courses": list every enrolled course instead of the first 4. Default false. */
    showAllEnrolledOnDashboard?: boolean;
}

// Permissions
export interface StudentPermissions {
    canViewProfile: boolean;
    canEditProfile: boolean;
    canDeleteProfile: boolean;
    canViewFiles: boolean;
    canViewReports: boolean;
}

// Profile page
export interface StudentProfileSettings {
    // Whether the "Membership Status" card (Access Days + expiry date) is shown
    // on the learner's Profile tab. Default: false (hidden).
    showMembershipStatus: boolean;
}

// Certificate settings used to be duplicated here. Certificate Settings is now
// the single source of truth; the learner app reads the resolved values from
// GET /admin-core-service/certificate/learner/v1/config.

// Guided in-app tutorials (learner Help menu). The learner app reads exactly
// these keys from STUDENT_DISPLAY_SETTINGS — do not rename.
export interface StudentTutorialSettings {
    // Master toggle. Default false (tutorials hidden).
    enabled: boolean;
    // Which tours are offered. Default: all LEARNER_TOUR_KEYS.
    enabledTours: string[];
    // Offer a downloadable, institute-branded how-to PDF (chapters follow
    // enabledTours) in the learner Help menu. Default false.
    pdfGuideEnabled: boolean;
}

// Fixed tour registry keys — the learner app matches on these exact strings.
export const LEARNER_TOUR_KEYS = [
    'dashboard-overview',
    'browse-courses',
    'watch-content',
    'take-assessment',
    'join-live-class',
    'view-progress',
] as const;

export type LearnerTourKey = (typeof LEARNER_TOUR_KEYS)[number];

export interface LearnerTourOption {
    key: LearnerTourKey;
    label: string;
    description: string;
}

// Labels/descriptions read the institute's Naming Settings at call time, so this
// is a function rather than a module-scope const (terminology loads after boot).
export function getLearnerTourOptions(): LearnerTourOption[] {
    const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase();
    const course = getTerminology(ContentTerms.Course, SystemTerms.Course).toLowerCase();
    const slides = getTerminologyPlural(ContentTerms.Slide, SystemTerms.Slide).toLowerCase();
    const liveSession = getTerminology(
        ContentTerms.LiveSession,
        SystemTerms.LiveSession
    ).toLowerCase();
    const learners = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner).toLowerCase();
    return [
        {
            key: 'dashboard-overview',
            label: 'Getting around the app',
            description: `A quick orientation of the dashboard and sidebar for new ${learners}.`,
        },
        {
            key: 'browse-courses',
            label: `Browse & open ${courses}`,
            description: `How to find ${courses} and open one from the library.`,
        },
        {
            key: 'watch-content',
            label: `Watch videos & study ${slides}`,
            description: `How to play videos and move through ${course} ${slides}.`,
        },
        {
            key: 'take-assessment',
            label: 'Take an assessment',
            description: 'How to start, answer and submit an assessment.',
        },
        {
            key: 'join-live-class',
            label: `Join a ${liveSession}`,
            description: `How to find the schedule and join a ${liveSession}.`,
        },
        {
            key: 'view-progress',
            label: 'Track learning progress',
            description: 'Where to see completion, scores and learning analytics.',
        },
    ];
}

// Live classes — what learners may see about PAST live sessions, plus whether
// PUBLIC classes with no batch/learner attached are listed to every enrolled
// learner. All default false; enforced server-side by the learner endpoints.
export interface StudentLiveClassesSettings {
    showPastSessions: boolean;
    showRecordings: boolean;
    showAttendance: boolean;
    showActivityStats: boolean;
    showClassMaterials: boolean;
    showUnassignedPublicSessions: boolean;
}

// Periodic "Active Focus Check" shown over video slides in the learner app: the
// learner must tap a highlighted number to keep watching. The learner app owns
// the whole behaviour; the admin app only needs to round-trip the block so that
// saving Student Display settings never drops an institute's opt-out.
export interface StudentConcentrationSettings {
    enabled: boolean;
    frequency: {
        min_minutes: number;
        max_minutes: number;
    };
    behavior: {
        allow_skip: boolean;
        penalty_type: 'pause' | 'flag_only';
    };
    appearance: {
        title: string;
        subtitle: string;
    };
}

// Root schema
export interface StudentDisplaySettingsData {
    sidebar: {
        visible: boolean; // toggle to show/hide entire sidebar
        tabs: StudentSidebarTabConfig[];
        /**
         * Whether the learner sidebar footer carries the "Apps & Portals"
         * download row. Defaults to true (the historical behaviour). Turn it
         * off to move those links to the dashboard's getApp widget instead of
         * showing both.
         */
        appLinks?: boolean;
    };
    dashboard: {
        widgets: StudentDashboardWidgetConfig[];
    };
    ui: StudentUiSettings;
    signup: StudentSignupSettings;
    permissions: StudentPermissions;
    profile: StudentProfileSettings;
    courseDetails: StudentCourseDetailsSettings;
    courseSettings: StudentCourseSettings;
    allCourses: StudentAllCoursesSettings;
    notifications: {
        allowSystemAlerts: boolean;
        allowDashboardPins: boolean;
        allowBatchStream: boolean;
        // Full-screen APP_OVERLAY announcements on app open. Default true.
        allowAppOverlays: boolean;
    };
    liveClasses: StudentLiveClassesSettings;
    tutorials: StudentTutorialSettings;
    concentration: StudentConcentrationSettings;
    postLoginRedirectRoute: string;
}
