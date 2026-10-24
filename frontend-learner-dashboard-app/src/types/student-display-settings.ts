export const STUDENT_DISPLAY_SETTINGS_KEY = "STUDENT_DISPLAY_SETTINGS" as const;

// Sidebar
export interface StudentSidebarSubTabConfig {
  id: string;
  label?: string;
  route: string;
  order: number;
  visible: boolean;
}

export interface StudentSidebarTabConfig {
  id: string; // 'dashboard','learning-center','homework','assessment-center','referral','attendance', ...
  label?: string;
  route?: string;
  order: number;
  visible: boolean;
  subTabs?: StudentSidebarSubTabConfig[];
  isCustom?: boolean;
}

// Dashboard
/**
 * Every id the dashboard actually renders. Keep in sync with the admin app's
 * StudentDashboardWidgetId — the admin writes these, the dashboard reads them.
 *
 * RETIRED ids (assessmentsStat, activityTrend, dailyProgress, myClasses,
 * referAFriend) are deliberately absent: nothing reads them, so an admin
 * toggling them changed nothing. They stay listed in the admin app's
 * RETIRED_WIDGET_IDS so old saved entries are filtered out of the settings UI
 * rather than shown as dead switches.
 */
export type StudentDashboardWidgetId =
  // The "Let's get you started" first-run onboarding checklist in the hero
  // band. Only the default/vibrant hero has one — the play / cleaner-play
  // heroes show a greeting band instead, which this flag does not affect.
  | "gettingStarted"
  // The XP / streak / badges block at the bottom of the dashboard. Covers both
  // the standard panel and the play theme's own trio of widgets. Note the
  // badges card has a second, narrower switch of its own (the badge config's
  // master toggle); this flag hides the whole block.
  | "gamification"
  | "coursesStat"
  | "evaluationStat"
  | "continueLearning"
  // The learner's enrolled courses with per-course progress and a way back
  // in. Distinct from coursesStat, which is only the count tile.
  | "enrolledCourses"
  | "learningAnalytics"
  | "liveClasses"
  | "thisWeekAttendance"
  | "myMembership"
  | "myBooks"
  | "upcomingLiveClasses"
  | "myMentors"
  | "myOrders"
  // Bottom-of-page commerce CTAs. Separate from myMembership / myBooks so the
  // widget and the "go buy more" button can be controlled independently.
  | "exploreMemberships"
  | "exploreBooks"
  // "Get the app" download card. Shows the store/download links configured on
  // the institute's domain-routing row — the same source the sidebar footer
  // uses, so an institute can carry them in the sidebar, the dashboard, both,
  // or neither (see `sidebar.appLinks`). Self-hides when no link is set.
  | "getApp"
  // Today's teacher-scheduled tasks (the Daily Engagement module). Renders
  // nothing for an institute with no plan running. Placed first in the rail
  // at lg and up, else right under the hero; see the dashboard route.
  | "todayTasks"
  | "custom";

export interface StudentDashboardWidgetConfig {
  id: StudentDashboardWidgetId;
  order: number;
  visible: boolean;
  isCustom?: boolean;
  title?: string; // for custom
  subTitle?: string; // for custom
  link?: string; // for custom (route or URL)
}

// Signup/Login
export type StudentSignupProvider =
  | "google"
  | "github"
  | "usernamePassword"
  | "emailOtp";
export type StudentDefaultProvider = StudentSignupProvider;
export type UsernameStrategy = "email" | "random" | "manual";
export type PasswordStrategy = "manual" | "autoRandom";
export type PasswordDelivery = "showOnScreen" | "sendEmail" | "none";

// How catalogue header login/signup buttons surface auth.
// - "page" (default): navigate to /login or /signup
// - "modal": open the AuthModal in-place
export type StudentAuthPresentation = "page" | "modal";

export interface StudentSignupSettings {
  // Master toggle: when false, "Sign Up" links are hidden in the catalogue UI.
  // Default: true.
  enabled?: boolean;
  providers: {
    google: boolean;
    github: boolean;
    usernamePassword: boolean;
    emailOtp: boolean;
    defaultProvider: StudentDefaultProvider;
  };
  usernameStrategy: UsernameStrategy;
  passwordStrategy: PasswordStrategy;
  passwordDelivery: PasswordDelivery;
  presentation?: StudentAuthPresentation;
}

// Course details
export type StudentCourseDetailsTabId =
  | "OUTLINE"
  | "CONTENT_STRUCTURE"
  | "TEACHERS"
  | "ASSESSMENTS";

export interface StudentCourseDetailsTabConfig {
  id: StudentCourseDetailsTabId;
  label?: string;
  order: number;
  visible: boolean;
}

export type OutlineMode = "expanded" | "collapsed";

/**
 * How the slide viewer's left sidebar lets the learner navigate course content.
 *
 * - "breadcrumb": Sidebar shows only the current chapter's slide list (the
 *   legacy view). Cross-subject/cross-module jumps happen via the breadcrumb
 *   popovers at the top.
 * - "ancestors": Sidebar shows the full Subject → Module → Chapter → Slide
 *   tree; the breadcrumb is a passive label (no popovers) since the tree
 *   already exposes every jump.
 * - "lessons": Sidebar shows the whole course as a flat, thumbnail-led lesson
 *   list — chapters are headings rather than toggles, nothing collapses, and a
 *   course-wide progress line sits at the top. For courses that are a linear
 *   programme rather than a reference library.
 * - "hidden": No sidebar; the learner moves with Previous / Next alone.
 */
export type SlidesSidebarNavigation =
  | "breadcrumb"
  | "ancestors"
  | "lessons"
  | "hidden";

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
export type EnrolledCourseLayout = "full" | "contentOnly";

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
export type ContentCardImageFit = "cover" | "contain";

/**
 * How far the learner must get before the "Give Feedback" slide is offered.
 *
 * - "CHAPTER" (default): at the end of every chapter — today's behaviour.
 * - "MODULE" / "SUBJECT": once the whole module / subject is done, so long
 *   courses ask once per section instead of after every chapter.
 * - "COURSE": once, at the end of the course.
 * - "NEVER": never offered automatically. The sidebar's Feedback button (when
 *   feedbackVisible is on) still works — this only controls the auto-open.
 *
 * Asking after every chapter is the right cadence for a short course and
 * fatiguing for a forty-chapter one, which is why it is a setting rather than
 * a constant.
 */
export type FeedbackTrigger =
  | "CHAPTER"
  | "MODULE"
  | "SUBJECT"
  | "COURSE"
  | "NEVER";

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
  // New flags
  showCourseConfiguration: boolean;
  /** Hide the course's tag chips (ENGLISH, E-LEARNING…) above its title. Default false (shown). */
  hideTags?: boolean;
  showCourseContentPrefixes: boolean;
  courseOverview: { visible: boolean; showSlidesData: boolean };
  slidesView: {
    showLearningPath: boolean;
    feedbackVisible: boolean;
    canAskDoubt: boolean;
    /** See {@link SlidesSidebarNavigation}. Optional for backwards compat
     *  with settings payloads saved before this field existed — consumers
     *  should fall back to "breadcrumb" (the legacy default) when missing
     *  so existing learners aren't dropped into a different layout. */
    sidebarNavigation?: SlidesSidebarNavigation;
    /**
     * Collapse the app's own left nav rail while the slide viewer is open,
     * the way focus mode does — so the slide gets the full width without the
     * learner reaching for the navbar toggle every time.
     *
     * Tri-state on purpose. Unset means "follow the sidebar mode": the
     * sidebar-less viewer collapses the rail (a viewer with its own sidebar
     * switched off did not ask for the nav rail to sit open beside the slide
     * instead), every other mode leaves it alone. An explicit true/false
     * always wins, so an institute can force either behaviour.
     */
    collapseSidebarOnOpen?: boolean;
    /**
     * Show an explicit "Mark as complete" control in the slide viewer — the
     * checkbox Udemy, Coursera and LinkedIn Learning put beside a lesson.
     *
     * Automatic tracking is unchanged and still the primary signal; this is the
     * manual override for what dwell-time and watch-percentage cannot see (a
     * one-page PDF read at a glance, a reading done on paper, a video already
     * watched before enrolling). It writes the same progress record as the
     * automatic path, so chapter/course progress, drip unlocks and certificates
     * all move with it, and it is reversible.
     *
     * Tri-state, like collapseSidebarOnOpen. Unset means "follow the sidebar
     * mode": the sidebar-less viewer shows it, every other mode does not. That
     * default is where it actually earns its place — with no sidebar there is
     * no tick list and no progress readout, so without this control the learner
     * has no completion feedback at all, while the breadcrumb and tree modes
     * already show both. An explicit true/false always wins, so an institute
     * can put it in every viewer or take it out of all of them.
     */
    manualCompletion?: boolean;
    /**
     * "Chapter complete — next up" hand-off bar. Tri-state: unset follows the
     * sidebar mode (shown only in the sidebar-less viewer, which is the one
     * that dead-ends without it), explicit true/false wins.
     */
    chapterCompleteCta?: boolean;
    /**
     * Whether the synthesised "Give Feedback" slide sits in the Prev/Next
     * sequence. Tri-state: unset follows the sidebar mode — the sidebar-less
     * viewer leaves it out so Next rolls into the next chapter instead of a
     * form, every other mode keeps today's behaviour. Independent of
     * feedbackVisible, which is the master switch.
     */
    feedbackInSlideNav?: boolean;
    /** See {@link FeedbackTrigger}. Missing means "CHAPTER" (today). */
    feedbackTrigger?: FeedbackTrigger;
  };
  /** See {@link EnrolledCourseLayout}. Optional for backwards compat; missing
   *  means "full" so saved settings keep rendering today's page. */
  enrolledLayout?: EnrolledCourseLayout;
  /**
   * Tapping a chapter card opens its first available slide straight in the
   * viewer instead of listing the chapter's slides first.
   *
   * Tri-state: unset follows enrolledLayout — the content-only page skips the
   * list (the viewer's own Prev/Next already walks the chapter, so the list is
   * one tap between the learner and the content), the full page keeps it.
   * Explicit true/false wins. The list still appears either way when no slide
   * can be opened, since that screen is what explains why.
   */
  chapterOpensFirstSlide?: boolean;
  /** See {@link ContentCardImageFit}. Missing means "cover" (today). */
  contentCardImageFit?: ContentCardImageFit;
}

// All Courses page
export type StudentAllCoursesTabId = "InProgress" | "Completed" | "AllCourses";

export interface StudentAllCoursesTabConfig {
  id: StudentAllCoursesTabId;
  label?: string;
  order: number;
  visible: boolean;
}

/**
 * Admin-defined Courses-page tab listing every catalogue course that carries
 * ANY of `tags`. Lives outside `tabs` so builds that predate it ignore it
 * instead of mapping the unknown id to In Progress. `order` shares the
 * built-in tabs' numbering.
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
  | "TAG"
  | "COURSES"
  | "FREE_COURSES"
  | "LIVE_SESSIONS"
  | "PRODUCT_PAGES";

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

// UI
export type StudentUIType =
  | "default"
  | "vibrant"
  | "play"
  | "cleanerPlay"
  | "corporate";

export interface StudentUISettings {
  type: StudentUIType;
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

// Notifications
export interface StudentNotificationSettings {
  allowSystemAlerts: boolean;
  allowDashboardPins: boolean;
  allowBatchStream: boolean;
  // Full-screen APP_OVERLAY announcements shown when the app is opened
  allowAppOverlays: boolean;
}

// Guided tutorials (intro tours). Keys must match the admin dashboard's
// Student Display settings tour registry — do not rename.
export const LEARNER_TOUR_KEYS = [
  "dashboard-overview",
  "browse-courses",
  "watch-content",
  "take-assessment",
  "join-live-class",
  "view-progress",
] as const;

export type LearnerTourKey = (typeof LEARNER_TOUR_KEYS)[number];

export interface StudentTutorialSettings {
  // Master switch — institutes opt in from admin Student Display settings
  enabled: boolean;
  // Which predefined tours learners can run (subset of LEARNER_TOUR_KEYS)
  enabledTours: string[];
  // Offer a downloadable, institute-branded how-to PDF (chapters follow
  // enabledTours) from the Help & tutorials menu
  pdfGuideEnabled: boolean;
}

// Certificate settings used to live here as a duplicate of the ones on the
// Certificate Settings page. Certificate Settings is now the single source of
// truth; the learner app reads the resolved values from
// GET /admin-core-service/certificate/learner/v1/config.

// Course Settings
export interface StudentCourseSettingsQuiz {
  moveOnlyOnCorrectAnswer: boolean;
  celebrateOnQuizComplete: boolean;
  showReportAndCorrectAnswers: boolean;
}

/** Assignment slide. Both off by default (today's slide). */
export interface StudentCourseSettingsAssignment {
  /** Hide the "Attempts Allowed: …" line. */
  hideAttemptsAllowed: boolean;
  /** Hide the card title when it only repeats the slide name shown above it. */
  hideRepeatedTitle: boolean;
}

export interface StudentCourseSettings {
  quiz: StudentCourseSettingsQuiz;
  assignment: StudentCourseSettingsAssignment;
}

export interface ConcentrationSettings {
  enabled: boolean;
  frequency: {
    min_minutes: number;
    max_minutes: number;
  };
  behavior: {
    allow_skip: boolean;
    penalty_type: "pause" | "flag_only";
  };
  appearance: {
    title: string;
    subtitle: string;
  };
}

// Root
export interface StudentDisplaySettingsData {
  sidebar: {
    visible: boolean;
    tabs: StudentSidebarTabConfig[];
    /**
     * Whether the sidebar footer carries the "Apps & Portals" download row.
     * Defaults to true (the historical behaviour). Turn it off to move those
     * links to the dashboard's `getApp` widget instead of showing both.
     */
    appLinks?: boolean;
  };
  dashboard: { widgets: StudentDashboardWidgetConfig[] };
  signup: StudentSignupSettings;
  permissions: StudentPermissions;
  profile: StudentProfileSettings;
  courseDetails: StudentCourseDetailsSettings;
  courseSettings: StudentCourseSettings;
  allCourses: StudentAllCoursesSettings;
  notifications: StudentNotificationSettings;
  tutorials: StudentTutorialSettings;
  concentration: ConcentrationSettings;
  ui: StudentUISettings;
  postLoginRedirectRoute: string;
}
