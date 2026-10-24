import type { SidebarCategory } from '@/types/layout-container/layout-container-types';
// Types that define Admin/Teacher display settings configuration

export type UserRoleForDisplaySettings = 'ADMIN' | 'TEACHER';

// Identifier for a top-level sidebar tab
export interface SidebarTabConfig {
    id: string; // e.g., 'dashboard', 'manage-institute'
    label?: string; // optional custom display label
    route?: string; // route for non-collapsible tabs or custom tabs
    order: number; // ordering among tabs
    visible: boolean; // whether the tab is visible for the role
    locked?: boolean; // whether the tab is locked for the role
    // List of sub-tabs (if any). For non-collapsible tabs this can be empty
    subTabs?: Array<{
        id: string; // e.g., 'batches', 'sessions'
        label?: string; // optional custom label
        route: string; // route to navigate when selected
        order: number; // ordering among sub-tabs
        visible: boolean; // whether the sub-tab is visible for the role
        locked?: boolean; // whether the sub-tab is locked for the role
    }>;
    // Whether this tab was added as a custom tab from settings
    isCustom?: boolean;
    // For custom tabs: which sidebar category (CRM/LMS/AI) it belongs to.
    // Built-in tabs derive their category from SidebarItemsData; this only applies
    // to user-added custom tabs whose id isn't in SidebarItemsData.
    category?: SidebarCategory;
}

// Dashboard widget identifiers. These are string literal ids that we can enforce in UI.
// The list is derived from widgets present in `src/routes/dashboard/index.tsx`.
export type DashboardWidgetId =
    | 'assistantLaunchBar'
    | 'quickActions'
    | 'pendingActions'
    | 'kpiBand'
    | 'financeSummary'
    | 'recentTransactions'
    | 'recentNotifications'
    | 'realTimeActiveUsers'
    | 'currentlyActiveUsers'
    | 'userActivitySummary'
    | 'dailyActivityTrend'
    | 'enrollLearners'
    | 'learningCenter'
    | 'assessmentCenter'
    | 'roleTypeUsers'
    | 'myCourses'
    | 'unresolvedDoubts'
    | 'liveClasses'
    | 'aiFeaturesCard'
    | 'instituteOverview'
    | 'subOrgOverview'
    | 'subOrgSelfStats'
    | 'subOrgGeography'
    | 'revenueTrends'
    | 'subOrgRevenueTrends'
    | 'vleAnalytics'
    | 'topVles'
    | 'subOrgSeatCourses'
    | 'subOrgActivityDues'
    | 'mentorshipStats'
    | 'lmsConnectionHealth';

export interface DashboardWidgetConfig {
    id: DashboardWidgetId;
    order: number;
    visible: boolean;
}

export type CourseListTabId =
    | 'AllCourses'
    | 'AuthoredCourses'
    | 'CourseApproval'
    | 'CourseInReview';

export interface CourseListTabConfig {
    id: CourseListTabId;
    label?: string;
    order: number;
    visible: boolean;
}

export type CourseDetailsTabId =
    | 'OUTLINE'
    | 'CONTENT_STRUCTURE'
    | 'LEARNER'
    | 'TEACHER'
    | 'ASSESSMENT'
    | 'QUIZ_RESULTS'
    | 'LIVE_SESSION'
    | 'PLANNING'
    | 'ACTIVITY'
    | 'PULSE'
    | 'REPORTS'
    | 'CERTIFICATES'
    | 'DOWNLOADS'
    | 'SETTINGS'
    | 'TUTOR_MODE'
    | 'AI_KNOWLEDGE';

export interface CourseDetailsTabConfig {
    id: CourseDetailsTabId;
    label?: string;
    order: number;
    visible: boolean;
}

// 5) Course content type visibility controls
export interface CourseContentTypeSettings {
    pdf: boolean;
    video: {
        enabled: boolean;
        showInVideoQuestion: boolean;
    };
    codeEditor: boolean;
    document: boolean;
    question: boolean;
    quiz: boolean;
    assignment: boolean;
    jupyterNotebook: boolean;
    scratch: boolean;
    ppt: boolean;
    audio: boolean;
    scorm: boolean;
    assessment: boolean;
}

export interface CourseCreationSettings {
    // Allow a permission-gated custom role to see the "Add Course" button even
    // without a CREATE_COURSE access mapping. Opt-in per role; undefined/false
    // preserves the default gating (admins/CREATE_COURSE holders only).
    showCreateCourse?: boolean;
    // Whether to expose the "Create Course with AI" entry points
    showCreateCourseWithAI: boolean;
    // Require selecting package sessions when creating a new chapter
    requirePackageSelectionForNewChapter: boolean;
    // Toggle visibility of advanced options inside course creation flows
    showAdvancedSettings: boolean;
    // Restrict the course hierarchy to a single level (no nested modules)
    limitToSingleLevel: boolean;
}

// Per-role visibility of the assessment create / edit / delete actions. Applies
// across every surface that exposes them: the Assessments list header, the
// /assessment type picker, the sidebar "Create …" shortcuts, the in-slide
// "Create new assessment" option, the Assessment Details edit (pencil) button
// and the "Delete Assessment" item in each assessment card's "…" menu — plus
// the Evaluation Centre and Homework clones of those lists.
//
// Every flag is optional and DEFAULTS TO TRUE (on). Read sites must therefore
// test `=== false` / `!== false`, never truthiness, so a role that has never
// been configured keeps seeing the actions.
export interface AssessmentActionSettings {
    // "Create Assessment" / "Create Homework" entry points.
    showCreateAssessment?: boolean;
    // The edit (pencil) button on Assessment Details that reopens the
    // create-assessment wizard for an existing assessment.
    showEditAssessment?: boolean;
    // "Delete Assessment" / "Delete Homework" in the card "…" menu.
    showDeleteAssessment?: boolean;
    // Assessment folders: New folder, folder edit/copy link/delete, drag-and-drop and
    // "Move to folder". Off still lets the role browse folders.
    showManageFolders?: boolean;
}

export const DEFAULT_ASSESSMENT_ACTION_SETTINGS: AssessmentActionSettings = {
    showCreateAssessment: true,
    showEditAssessment: true,
    showDeleteAssessment: true,
    showManageFolders: true,
};

// Stable identifiers for the student side-view tabs. Used as keys in the
// settings ordering map and as values for the default-tab selector. These
// match the `setCategory(...)` strings the side-view component already uses.
export type StudentSideViewTabId =
    | 'overview'
    | 'courses'
    | 'learningProgress'
    | 'testRecord'
    | 'notifications'
    | 'membership'
    | 'paymentHistory'
    | 'userTagging'
    | 'badges'
    | 'files'
    | 'portalAccess'
    | 'reports'
    | 'enrollDeroll'
    | 'enquiry'
    | 'application'
    | 'lead'
    | 'fullHistory'
    | 'workflows'
    | 'parent'
    | 'onboarding';

export interface StudentSideViewSettings {
    overviewTab: boolean;
    testTab: boolean;
    progressTab: boolean;
    coursesTab: boolean;
    notificationTab: boolean;
    membershipTab: boolean;
    paymentHistoryTab: boolean;
    userTaggingTab: boolean;
    badgesTab: boolean;
    fileTab: boolean;
    portalAccessTab: boolean;
    reportsTab: boolean;
    enrollDerollTab: boolean;
    enquiryTab: boolean;
    applicationTab: boolean;
    leadTab: boolean;
    fullHistoryTab?: boolean;
    // Workflows tab — the automations that ran for this person, with a Retry
    // action per run. Optional for backward-compat with settings saved before
    // this tab existed.
    workflowsTab?: boolean;
    // Guardian tab — surfaces the linked guardian/children (parent-link feature).
    // Optional for backward-compat with settings saved before this tab existed.
    parentTab?: boolean;
    // Onboarding tab — surfaces the subject's onboarding flow instance(s)
    // (ONBOARDING_SETTING feature). Optional for backward-compat with
    // settings saved before this tab existed.
    onboardingTab?: boolean;
    /**
     * The Resend control on each outbound row of the Notifications tab, which
     * sends that message to the learner a second time. Not a tab toggle — the
     * tab itself is `notificationTab` — so it is kept out of
     * StudentSideViewVisibilityKey and rendered as its own option.
     *
     * Optional for backward-compat: an institute whose saved settings pre-date
     * this flag falls through to the role's default (on for admin, off for
     * teacher and custom roles).
     */
    allowResendMessage?: boolean;
    // Custom ordering by tab id. Lower numbers render first. Tabs missing
    // from the map fall back to the default order. Optional for
    // backward-compat with settings that pre-date this feature.
    tabOrders?: Partial<Record<StudentSideViewTabId, number>>;
    // Tab to open by default when the side view first renders. Falls back to
    // the first visible tab if unset or if the chosen tab is hidden.
    defaultTab?: StudentSideViewTabId;

    // ─── Vacademy design-handoff tenant settings ────────────────────────
    // Phase C of the Learner Profile redesign. All optional + back-compat:
    // missing values fall through to sensible defaults so today's clients
    // see no change.

    /**
     * Navigation style inside the learner profile drawer.
     * 'tabs' (default) — horizontal scrolling tab bar (existing UX).
     * 'grouped'        — vertical 208px left-rail with sections grouped
     *                    under uppercase labels (Snapshot · Learning ·
     *                    Finance · CRM · Account · Records).
     */
    profileNavStyle?: 'tabs' | 'grouped';

    /**
     * Feature modules per the handoff's GROUP_TO_MODULE mapping. Disabling
     * a module removes its entire section group from the rail / tab bar.
     * Snapshot is always on (it has the Overview entry surface).
     */
    profileModules?: {
        learning?: boolean;
        finance?: boolean;
        crm?: boolean;
        account?: boolean;
        records?: boolean;
    };

    /**
     * Quick-action toggles for the Overview tab. Hides individual buttons
     * (Email / Call / WhatsApp) when off. Other actions (Edit Details,
     * Report, Copy credentials) are always shown.
     */
    profileQuickActions?: {
        email?: boolean;
        call?: boolean;
        whatsapp?: boolean;
    };
}

// Keys of StudentSideViewSettings that toggle a tab's visibility. Used by
// the settings UI to iterate only over the boolean visibility fields and
// avoid widening to ordering/default-tab fields.
export type StudentSideViewVisibilityKey =
    | 'overviewTab'
    | 'testTab'
    | 'progressTab'
    | 'coursesTab'
    | 'notificationTab'
    | 'membershipTab'
    | 'paymentHistoryTab'
    | 'userTaggingTab'
    | 'badgesTab'
    | 'fileTab'
    | 'portalAccessTab'
    | 'reportsTab'
    | 'enrollDerollTab'
    | 'enquiryTab'
    | 'applicationTab'
    | 'leadTab'
    | 'fullHistoryTab'
    | 'workflowsTab'
    | 'parentTab'
    | 'onboardingTab';

export interface LearnerManagementSettings {
    allowPortalAccess: boolean;
    allowViewPassword: boolean;
    allowSendResetPasswordMail: boolean;
    showApprovalToggle: boolean;
    // Controls the "Edit" action on the Portal Access → Account Credentials card,
    // which rewrites the learner's username/password. Unlike the other flags
    // here it drives a WRITE, and it signs the learner out of their session.
    //
    // Role-dependent default when the key is absent (institutes whose saved
    // settings predate this flag): ON for ADMIN, OFF for teachers and custom
    // roles. An admin grants it to another role from Display Settings. Consumers
    // must resolve `?? isAdmin` rather than `?? false`, or admins on an older
    // settings blob lose the button.
    //
    // Only meaningful when allowViewPassword is on — the card it lives in is
    // hidden otherwise.
    allowEditCredentials?: boolean;
    // Lets the role PERMANENTLY delete an offline/manual payment or an invoice from the learner's
    // payment tab and Manage Payments. OFF by default for every role, including admin — an institute
    // opts in here. Absent (every settings blob saved before this flag) means OFF, and the server
    // enforces the same rule, so hiding the button is not the only guard.
    allowDeletePayments?: boolean;
    // May this role apply admin discounts (manual enroll, bulk assign, admin invoice).
    // Admin defaults to ON.
    canApplyDiscounts?: boolean;
}

// What a custom header button links to.
//  - 'url' (default): opens the manually-entered `url`.
//  - 'suborg_learner_invite': auto-resolves the VIEWER's sub-org SUBORG_LEARNER
//     invite link for the course being viewed. Only renders for a sub-org admin
//     on a course Student tab (needs a selected sub-org + a package session).
//     Learners who enrol through it appear in the sub-org admin's learner list.
//  - 'course_invite': auto-resolves the course's DEFAULT learner invite link for
//     the package session being viewed.
export type StudentHeaderButtonKind = 'url' | 'suborg_learner_invite' | 'course_invite';

// A custom link button rendered in the Learner Management header (the Student
// tab on Course Details + the standalone learner lists). Lets an admin surface
// a manual link, the sub-org learner invite link, or the course invite link as
// a one-click action.
export interface StudentHeaderCustomButton {
    id: string;
    label: string;
    // Link source. Missing/undefined = 'url' (backwards-compatible with buttons
    // saved before kinds existed).
    kind?: StudentHeaderButtonKind;
    // Manual URL — used only when kind is 'url'/undefined; ignored for the auto
    // (invite-resolving) kinds.
    url?: string;
    // Open the URL in a new browser tab. Default (undefined/true) = new tab.
    openInNewTab?: boolean;
}

// Per-role control of the action buttons in the Learner Management header.
export interface StudentManagementActionSettings {
    // Show the built-in "Enroll" button. Default (undefined/true) = shown.
    showEnrollButton?: boolean;
    // Show the built-in "Invite" button. Default (undefined/true) = shown.
    showInviteButton?: boolean;
    // Custom link buttons rendered alongside the built-in buttons. Missing/empty
    // = none. Each is a label + URL an admin pastes (invite link, sub-org learner
    // registration link, or any other link).
    customButtons?: StudentHeaderCustomButton[];
}

// Per-role column visibility on the manage-students learner-list. Holds the
// set of column accessors (system field accessorKey, e.g. 'mobile_number', or
// a custom-field UUID) this role must NOT see. Missing/empty list = role
// inherits the institute-wide defaults configured in CustomFieldsSettings.
//
// Precedence at render time:
//   1. Filter-driven visibility (Batch/Invite/Plan/Amount) ALWAYS wins — when
//      the filter is active those columns must be visible so the admin can
//      see what they filtered on.
//   2. Role hiddenColumns — forces those accessors hidden.
//   3. Institute-wide system field setting — admin-level defaults.
export interface LearnerListColumnSettings {
    // System field accessors this role has EXPLICITLY HIDDEN. Missing/empty list = role
    // sees all system columns. Default semantics: visible unless listed here.
    hiddenColumns: string[];

    // Custom field accessors (custom_field UUIDs) this role has EXPLICITLY ENABLED for
    // the learner-list table. Missing/empty = no custom fields visible for this role.
    // Default semantics: hidden unless listed here. (Opposite of hiddenColumns above.)
    // Admins opt in per role; new custom fields added later default to hidden until
    // an admin toggles them on.
    enabledCustomFields?: string[];

    // Whether the Total/Active/Inactive count badges show in the learner-list header
    // (Student list + Course Details → Learner tab). Missing = visible (default true).
    showCountBadges?: boolean;
}

export interface LiveClassSchedulingSettings {
    /** Whether the "Bulk Schedule" entry point is available for this role. */
    bulkScheduleEnabled: boolean;
    /** Whether the single-class scheduling page is available for this role. */
    singleScheduleEnabled: boolean;
}

export const DEFAULT_LIVE_CLASS_SCHEDULING_SETTINGS: LiveClassSchedulingSettings = {
    bulkScheduleEnabled: true,
    singleScheduleEnabled: true,
};

// Per-role actions on the live-class list (Live Sessions page).
export interface LiveClassActionSettings {
    // "Delete" in the "…" menu of each card on the Past tab. Deleting a past
    // class takes its attendance, recordings and feedback out of the list, so it
    // is role-dependent: ON for ADMIN, OFF for teachers and custom roles. Absent
    // (every blob saved before this flag) falls through to the role's default,
    // so read sites must resolve `?? isAdmin`, never `?? true`.
    allowDeletePastSessions?: boolean;
}

// Per-role actions on the leads pages (CRM).
export interface LeadActionSettings {
    // "Add New Lead" on All Leads: pick a campaign type, then an audience, and
    // fill that audience's form. OFF for every role, admin included, until an
    // institute opts a role in, so read sites must resolve `=== true`.
    showAddLead?: boolean;
}

// Per-role control over which roles this role can see/select in the Team tab —
// in the role-type filter chips and the "Role Type" dropdown of the Invite
// User dialog. Keys are role names uppercased (matches backend authorities and
// RoleType.name from dummy-data), e.g. 'ADMIN', 'TEACHER', 'CONTENT CREATOR'.
// Missing keys default to true so existing institutes are unaffected.
export interface TeamManagementSettings {
    visibleRoles: Record<string, boolean>;
    // Whether the Org Chart tab shows up on /manage-institute/teams. Defaults
    // to FALSE (hidden) so the feature is opt-in per institute until we are
    // confident it works for that institute's users. Admins flip this on
    // from Settings → Admin Display Settings when they're ready to roll it out.
    orgChartTabVisible?: boolean;
    // Controls the Teams "Password" column + per-member "View Password" action.
    // Defaults to ON (shown) — treated as enabled unless explicitly set to false,
    // so an admin can hide staff credentials per institute by turning it off.
    allowViewPassword?: boolean;
}

// Opt-in flags for the counsellor workbench + sales dashboard routes. Both
// default to FALSE so the features stay hidden until an admin explicitly
// enables them. The routes themselves check these flags and render a
// "feature not enabled" message when off, so even a direct URL hit doesn't
// expose them to users whose institute hasn't opted in.
export interface WorkbenchVisibilitySettings {
    counsellorsPageVisible?: boolean;
    salesDashboardVisible?: boolean;
}

// Per-role access to the Sub-Organizations (Channel Partners) module —
// /manage-custom-teams and the per-sub-org drilldown.
//
// Off by default for every role. Enabling it for a NON-admin role (teacher or a
// custom role) surfaces the module in the sidebar and unlocks the route, but the
// user still only ever sees the channel partners ASSIGNED to them: the backend
// scopes every sub-org response to the caller's ACTIVE SUB_ORG-linked FSPSSM
// rows, so search, filters, pagination and counts all operate on the assigned
// set, and a user with no assignments gets an empty list. Admins are unaffected
// by the scoping and continue to see the whole network.
// Per-role capabilities inside the Sub-Organizations (Channel Partners) module.
// Deliberately mapped to actions that actually exist today — there is no delete
// endpoint for a channel partner, so there is no delete toggle to offer.
export interface SubOrgModulePermissions {
    /** Create a new channel partner. Default false. */
    canCreate?: boolean;
    /** Edit a partner's configuration + re-sync its invites. Default false. */
    canEditConfig?: boolean;
    /** Add / remove people on a partner's Team tab. Default false. */
    canManageTeam?: boolean;
    /** See the Admin Payment + Invoices tabs at all. Default TRUE (read). */
    canViewFinance?: boolean;
    /** Record payments, mark invoices paid, send reminders, raise invoices. Default false. */
    canManageFinance?: boolean;
    /** Export the partner list to CSV. Default TRUE (read). */
    canExport?: boolean;
}

export interface SubOrgModuleSettings {
    // Grant this role access to the Sub-Organizations module. Missing/undefined
    // = false (module hidden), so existing institutes are unaffected.
    moduleEnabled?: boolean;

    // What this role may DO on the channel partners it can see. Read gates are
    // separate from write gates on purpose: an institute usually wants a regional
    // sales role to see a partner's finances without being able to move money.
    //
    // Every write flag defaults to FALSE and every read flag to TRUE, so granting
    // the module alone produces a read-only view — the safe end of the range. An
    // institute admin opts each capability in per role.
    //
    // Enforced in BOTH places: the UI hides the affordance, and the backend
    // re-checks the same flag before mutating. A UI-only gate would be theatre —
    // the endpoints are reachable directly.
    permissions?: SubOrgModulePermissions;

    // Sub-org (channel partner) ids every holder of this role can see — a
    // ROLE-level grant, read server-side by SubOrgAccessScopeService.
    //
    // Why this exists alongside per-user assignment: assignment was originally
    // only per-person (a SUB_ORG-linked FSPSSM row created from a partner's Team
    // tab). For a regional team ("Gujarat sales") that meant wiring every member
    // individually and re-doing it for each new joiner. Listing the partners on
    // the role covers the whole team at once, including people added later.
    //
    // The two mechanisms UNION — a per-user assignment still adds on top of what
    // the role grants, so nothing configured the old way stops working. Empty or
    // missing = this role grants no partners on its own.
    assignedSubOrgIds?: string[];
}

// Admin list surfaces that support custom-field filter/sort gating.
export type ListCustomFieldSurface = 'LEADS' | 'CONTACTS' | 'STUDENTS';

export interface ListCustomFieldSurfaceControls {
    // custom_field_ids exposed as filters in this surface's filter bar.
    filterFields: string[];
    // custom_field_ids sortable from this surface's column headers.
    sortableFields: string[];
}

export type ListCustomFieldControls = Partial<
    Record<ListCustomFieldSurface, ListCustomFieldSurfaceControls>
>;

// Campaign (UTM) attribution filters on the same list surfaces. Which
// dimensions can be offered lives in services/utm-list-filters
// (UTM_FILTER_DIMENSIONS); this is the per-surface admin override.
export type ListUtmFilterDimension =
    | 'source'
    | 'medium'
    | 'campaign'
    | 'content'
    | 'term'
    | 'source_type';

export interface ListUtmFilterSurfaceControls {
    // Explicit on/off for this surface. ABSENT = follow the institute's
    // campaign-link (UTM) setting: the filters appear the moment that is
    // switched on and vanish when it is switched off, with nothing to
    // configure here. `false` hides them even while UTM is on (a role that
    // never needs them); `true` still requires UTM to be on — without it
    // there is nothing to filter by.
    enabled?: boolean;
    // Dimensions rendered as dropdowns. ABSENT = automatic: source, medium and
    // campaign always; content, term and channel only once the institute's
    // data actually holds a value for them. An explicit list pins exactly
    // these (a dimension with no data still renders, empty).
    dimensions?: ListUtmFilterDimension[];
}

export type ListUtmFilterControls = Partial<
    Record<ListCustomFieldSurface, ListUtmFilterSurfaceControls>
>;

// The filters a list surface ships with, as opposed to custom fields and UTM
// dimensions. Admins turn these off when a column means nothing to their
// institute (no counsellors assigned, one audience, …).
export type ListBuiltInFilter = 'counsellor' | 'campaignType' | 'audience';

export const LIST_BUILT_IN_FILTERS: readonly ListBuiltInFilter[] = [
    'counsellor',
    'campaignType',
    'audience',
] as const;

export interface ListBuiltInFilterSurfaceControls {
    // Filters hidden on this surface. ABSENT or empty = all of them show, which
    // is what every institute got before this existed.
    hidden?: ListBuiltInFilter[];
}

export type ListBuiltInFilterControls = Partial<
    Record<ListCustomFieldSurface, ListBuiltInFilterSurfaceControls>
>;

export interface DisplaySettingsData {
    // 1) Sidebar tabs and sub-tabs configuration and ordering
    sidebar: SidebarTabConfig[];

    // 2) Dashboard widgets visibility and ordering
    dashboard: {
        widgets: DashboardWidgetConfig[];
    };

    // 3) Course list page tab configuration
    courseList?: {
        tabs: CourseListTabConfig[];
        defaultTab: CourseListTabId;
    };

    // 4) Course details tab configuration
    courseDetails?: {
        tabs: CourseDetailsTabConfig[];
        defaultTab: CourseDetailsTabId;
    };

    // 5) Permissions and profile visibility/editing controls
    permissions: {
        canViewInstituteDetails: boolean;
        canEditInstituteDetails: boolean;
        canViewProfileDetails: boolean;
        canEditProfileDetails: boolean;
    };

    // 6) Global UI toggles
    ui?: {
        showSupportButton: boolean;
        // Controls whether the left sidebar is shown for this role
        showSidebar?: boolean;
        showAiCredits?: boolean;
        // Controls the "Status" (service health) link pinned in the sidebar
        // rail. Defaults to VISIBLE; set false to hide it for this role.
        showStatus?: boolean;
        // Controls the "Settings" gear pinned at the bottom of the sidebar
        // rail (admin-only surface). Defaults to VISIBLE; set false to hide it
        // for this role.
        showSettings?: boolean;
        // Controls the right-edge Assist Dock rail (Guides / Assist / Issues /
        // What's new / Explore / Admin App). Defaults to VISIBLE for the admin
        // role and HIDDEN for teacher/custom roles; admins can opt a specific
        // role in from that role's Display Settings.
        showAssistDock?: boolean;
    };

    // 7) Course content types (slides) visibility
    contentTypes?: CourseContentTypeSettings;

    // 8) Post-login redirect route
    postLoginRedirectRoute: string; // e.g., '/dashboard'

    // 9) Course page level visibility toggles
    coursePage?: {
        viewInviteLinks: boolean;
        viewShortInviteLinks: boolean;
        viewCourseConfiguration: boolean;
        viewCourseOverviewItem: boolean;
        viewContentNumbering: boolean;
        // When true, non-admin users with HAS_FACULTY_ASSIGNED can navigate
        // into slides on a published / in-review course in read-only mode.
        // When false, slide click is blocked entirely (legacy behavior).
        allowViewSlidesInReadOnly?: boolean;
        // When true, non-admin roles bypass the read-only lock on published
        // courses and the Copy-to-Edit / Submit-for-Review approval flow —
        // they can edit and publish published courses directly.
        directEditPublishedCourse?: boolean;
        // When true (default — the long-standing behaviour), a non-admin's new
        // DRAFT course must go through Submit for Review -> admin approval
        // before it becomes ACTIVE. Set false per role to give that role a
        // "Publish" button instead. Read sites test `!== false` so a saved
        // blob that predates this key keeps requiring review.
        requireCourseApproval?: boolean;
        // When true, Edit buttons on Subject / Module / Chapter rows in the
        // Outline & Content Structure tabs are visible regardless of course
        // status. Admin always sees these; this flag is for non-admin roles.
        canEditCourseStructure?: boolean;
        // When true, Delete buttons on Subject / Module / Chapter rows are
        // visible regardless of course status.
        canDeleteCourseStructure?: boolean;
        // When true, the Course Details header shows a "..." menu exposing
        // raw IDs (course / package session / session / level) with copy.
        // Off by default — intended for admins debugging configuration.
        showAdvancedCourseIds?: boolean;
        // When true, the "Bulk Upload (ZIP)" button is shown in the Course
        // Structure header. Off by default for every role — opt-in per role
        // from Display Settings.
        showBulkUpload?: boolean;
        // Per-role visibility of the "Add" creation buttons in the Outline &
        // Content Structure tabs (and the standalone Subject/Module/Chapter
        // material pages). Default (undefined/true) shows them so existing
        // roles are unaffected; set false to hide the button for this role.
        showAddSubject?: boolean;
        showAddModule?: boolean;
        showAddChapter?: boolean;
        showAddSlide?: boolean;
        // Show the per-learner "Student Progress" sub-tab inside Reports —
        // Course Details → Reports and Learning Reports → Batch both read this.
        // Default (undefined/true) shows it; set false to hide for this role.
        showLearnerProgressReport?: boolean;
    };

    // 10) Slide view action visibility toggles
    slideView?: {
        showCopyTo: boolean;
        showMoveTo: boolean;
        showDelete?: boolean;
        // Show the "Add Question" button on video slides (in-video question authoring)
        showAddVideoQuestion?: boolean;
        // Show the "Convert to Split Screen" button on video slides
        showConvertToSplitScreen?: boolean;
    };

    // 10b) Authored Courses card action visibility (Explore Courses → Authored tab)
    authoredCoursesCard?: {
        showCopyToEdit: boolean;
        showDelete: boolean;
    };

    // 10c) Course list card content visibility (Explore Courses → All / Authored cards)
    courseListCard?: {
        // Show the number of ACTIVE enrolled students on each course card
        showEnrolledStudentCount: boolean;
    };

    // 10d) Assessment action visibility toggles. See AssessmentActionSettings —
    //      every flag defaults to ON so existing roles are unaffected.
    assessmentPage?: AssessmentActionSettings;

    // 11) Course creation configuration
    courseCreation?: CourseCreationSettings;

    // 12) Student portal side-view tab visibility
    studentSideView?: StudentSideViewSettings;

    // 12b) Manage-students learner-list column visibility for this role.
    //      Independent from the institute-wide custom-field settings — this is the
    //      per-role overlay that admins use to hide columns from teachers etc.
    learnerListColumns?: LearnerListColumnSettings;

    // 12c) custom_field_ids exposed as filters on the leads views (open Lead List
    //      + Recent Leads). Each enabled field renders a searchable multi-select
    //      in the filter bar; empty/absent = no custom-field filters and the
    //      distinct-values API is never called. Saved with the rest of this blob
    //      via the display-settings unsaved-changes bar.
    //      DEPRECATED in favor of listCustomFieldControls.LEADS.filterFields —
    //      kept as a read-fallback so institutes that configured leads filters
    //      before the unified controls existed keep them without a migration.
    leadsFilterCustomFields?: string[];

    // 12d) Unified per-surface custom-field filter/sort gating for the admin
    //      list pages. Institute-wide (applies to all roles), like
    //      leadsFilterCustomFields. Per surface:
    //        - filterFields: custom_field_ids rendered as filter controls in
    //          that page's filter bar (searchable multi-selects fed by the
    //          surface's distinct-values endpoint).
    //        - sortableFields: custom_field_ids whose columns offer sorting
    //          (consumed once custom-field sorting ships; safe to configure
    //          ahead of that).
    //      Absent surface entry falls back:
    //        LEADS    → leadsFilterCustomFields (legacy key)
    //        STUDENTS → legacy auto-expose (all TEXT + dropdown fields)
    //        CONTACTS → none
    listCustomFieldControls?: ListCustomFieldControls;

    // 12e) Campaign (UTM) attribution filters per list surface — the same
    //      surfaces as 12d. Institute-wide, stored on the ADMIN blob. Absent
    //      surface entry = follow the UTM setting (see
    //      ListUtmFilterSurfaceControls). Edited from the same "Manage
    //      filters" popup / Display Settings card as the custom-field filters.
    listUtmFilterControls?: ListUtmFilterControls;

    // 12f) The built-in filters (counsellor, campaign type, audience) per list
    //      surface. Absent = every one of them shows. Edited from the same
    //      "Manage filters" popup as 12d and 12e.
    listBuiltInFilterControls?: ListBuiltInFilterControls;

    // 13) Learner management permissions for admins/teachers
    learnerManagement?: LearnerManagementSettings;

    // 13a) Learner Management header action buttons — hide the built-in
    //      Enroll/Invite buttons per role and add custom link buttons (e.g. an
    //      invite link or sub-org learner registration link). Missing = defaults
    //      (both built-in buttons shown, no custom buttons).
    studentManagementActions?: StudentManagementActionSettings;

    // 13b) Live class scheduling controls. Role-level overlay on top of the
    //      institute-level Live Session Settings — admin can hide bulk
    //      scheduling for specific roles even if it's institute-enabled.
    //      Both flags default to true so existing institutes are unaffected.
    liveClassScheduling?: LiveClassSchedulingSettings;

    // 13b-ii) Live class list actions (Past tab delete). See
    //         LiveClassActionSettings — ON for admin, OFF for other roles.
    liveClassActions?: LiveClassActionSettings;

    // 13b-iii) Lead page actions (All Leads → Add New Lead). See
    //          LeadActionSettings — OFF for every role by default.
    leadActions?: LeadActionSettings;

    // 13c) Team tab role-visibility controls. Restricts which roles the
    //      viewing role can see/select in the Team tab's role-type filter and
    //      the Invite User dialog. Self-role is always treated as visible by
    //      consumers to prevent lockout.
    teamManagement?: TeamManagementSettings;

    // Opt-in gates for the counsellor workbench (/counsellors) and the
    // sales dashboard (/sales-dashboard). Both default to false. See
    // WorkbenchVisibilitySettings for details.
    workbench?: WorkbenchVisibilitySettings;

    // 13d) Sub-Organizations (Channel Partners) module access for this role.
    //      Off by default. See SubOrgModuleSettings — enabling it for a
    //      non-admin role grants the module but keeps visibility limited to the
    //      channel partners assigned to that user.
    subOrganizations?: SubOrgModuleSettings;

    // 14) Sidebar Category Configuration
    sidebarCategories?: Array<{
        id: SidebarCategory;
        visible: boolean;
        locked?: boolean; // whether the category is locked
        default: boolean; // Is this the default category on load?
        order?: number; // Optional ordering
    }>;
}

export const ADMIN_DISPLAY_SETTINGS_KEY = 'ADMIN_DISPLAY_SETTINGS' as const;
export const TEACHER_DISPLAY_SETTINGS_KEY = 'TEACHER_DISPLAY_SETTINGS' as const;
export const CUSTOM_ROLE_DISPLAY_SETTINGS_KEY = 'CUSTOM_ROLE_DISPLAY_SETTINGS_KEY' as const;
