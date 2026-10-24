export const CONTENT_TERMS = [
    'Course',
    'Level',
    'Session',
    'Subject',
    'Module',
    'Chapter',
    'Slide',
    'LiveSession',
    'Batch',
    'Package',
    'PopularTag',
] as const;

export const ROLE_TERMS = [
    'Admin',
    'Teacher',
    'CourseCreator',
    'AssessmentCreator',
    'Evaluator',
    'Learner',
] as const;

export const OTHER_TERMS = [
    'AudienceList',
    'Invite',
    'Inventory',
    'SubOrg',
] as const;

/**
 * One institute's rename of a term in a NON-source language. Every field is
 * optional: an institute may translate the singular only, or record gender
 * without renaming anything.
 */
export type NamingSettingsLocaleOverride = {
    customValue?: string;
    customPluralValue?: string;
    /** Grammatical gender of customValue — consumed by future sentence frames (hi/ar). */
    gender?: 'm' | 'f';
};

/** BCP-47 locale → override. Keys are locales from src/i18n/locales.ts. */
export type NamingSettingsLocales = Record<string, NamingSettingsLocaleOverride>;

export type NamingSettingsType = {
    key: string;
    systemValue: string;
    customValue: string;
    systemPluralValue: string;
    customPluralValue: string;
    /**
     * OPTIONAL per-locale overrides. `customValue`/`customPluralValue` above stay
     * the institute's entry in its CONTENT SOURCE language (LANGUAGE_SETTING
     * .content_source_locale, 'en' when unset).
     *
     * Absent from every blob cached before this field existed, so readers must
     * treat it as possibly-undefined — see getTerminology() in
     * components/common/layout-container/sidebar/utils.ts.
     */
    locales?: NamingSettingsLocales;
};
export const defaultNamingSettings: NamingSettingsType[] = [
    // Content & Structure
    { key: 'Course', systemValue: 'Course', customValue: 'Course', systemPluralValue: 'Courses', customPluralValue: 'Courses' },
    { key: 'Level', systemValue: 'Level', customValue: 'Level', systemPluralValue: 'Levels', customPluralValue: 'Levels' },
    { key: 'Session', systemValue: 'Session', customValue: 'Session', systemPluralValue: 'Sessions', customPluralValue: 'Sessions' },
    { key: 'Subject', systemValue: 'Subject', customValue: 'Subject', systemPluralValue: 'Subjects', customPluralValue: 'Subjects' },
    { key: 'Module', systemValue: 'Module', customValue: 'Module', systemPluralValue: 'Modules', customPluralValue: 'Modules' },
    { key: 'Chapter', systemValue: 'Chapter', customValue: 'Chapter', systemPluralValue: 'Chapters', customPluralValue: 'Chapters' },
    { key: 'Slide', systemValue: 'Slide', customValue: 'Slide', systemPluralValue: 'Slides', customPluralValue: 'Slides' },
    { key: 'LiveSession', systemValue: 'Live Session', customValue: 'Live Session', systemPluralValue: 'Live Sessions', customPluralValue: 'Live Sessions' },
    { key: 'Batch', systemValue: 'Batch', customValue: 'Batch', systemPluralValue: 'Batches', customPluralValue: 'Batches' },
    { key: 'Package', systemValue: 'Package', customValue: 'Package', systemPluralValue: 'Packages', customPluralValue: 'Packages' },
    { key: 'PopularTag', systemValue: 'Popular Tag', customValue: 'Popular Tag', systemPluralValue: 'Popular Tags', customPluralValue: 'Popular Tags' },
    // Roles
    { key: 'Admin', systemValue: 'Admin', customValue: 'Admin', systemPluralValue: 'Admins', customPluralValue: 'Admins' },
    { key: 'Teacher', systemValue: 'Teacher', customValue: 'Teacher', systemPluralValue: 'Teachers', customPluralValue: 'Teachers' },
    { key: 'CourseCreator', systemValue: 'Course Creator', customValue: 'Course Creator', systemPluralValue: 'Course Creators', customPluralValue: 'Course Creators' },
    { key: 'AssessmentCreator', systemValue: 'Assessment Creator', customValue: 'Assessment Creator', systemPluralValue: 'Assessment Creators', customPluralValue: 'Assessment Creators' },
    { key: 'Evaluator', systemValue: 'Evaluator', customValue: 'Evaluator', systemPluralValue: 'Evaluators', customPluralValue: 'Evaluators' },
    { key: 'Learner', systemValue: 'Learner', customValue: 'Learner', systemPluralValue: 'Learners', customPluralValue: 'Learners' },
    // Other
    { key: 'AudienceList', systemValue: 'Audience List', customValue: 'Audience List', systemPluralValue: 'Audience Lists', customPluralValue: 'Audience Lists' },
    { key: 'Invite', systemValue: 'Invite', customValue: 'Invite', systemPluralValue: 'Invites', customPluralValue: 'Invites' },
    { key: 'Inventory', systemValue: 'Inventory', customValue: 'Inventory', systemPluralValue: 'Inventory', customPluralValue: 'Inventory' },
    { key: 'SubOrg', systemValue: 'Sub-Org', customValue: 'Sub-Org', systemPluralValue: 'Sub-Orgs', customPluralValue: 'Sub-Orgs' },
];

export const systemValueDescription = {
    Course: 'A Course is the main learning program that covers a subject or skill. It may consist of different Levels to structure learning progressively.',
    Level: 'Levels organize a course into structured learning stages. These stages may represent increasing difficulty, different modules, or key milestones within the course. For eg: Basic, Advanced',
    Session:
        'An Academic Session represents a semester, term, or academic year. For eg: 2025-26, Spring 2025. Note: "Package Session" in the UI refers to Batch, not this term.',
    Subject:
        'Subjects are the topics or subjects covered in a course. For eg: Mathematics, Science, English',
    Module: 'Modules are the sub-topics or units within a subject. For eg: Algebra, Geometry, Calculus',
    Chapter: 'Chapters are the sections within a module. For eg: Chapter 1, Chapter 2',
    Slide: 'Slides are the individual slides within a chapter. For eg: Slide 1, Slide 2',
    Admin: 'Admin is the user role that has access to all the features of the platform. For eg: Admin, Super Admin',
    Teacher:
        'Teacher is the user role that can teach the courses of the platform. For eg: Teacher, Instructor',
    CourseCreator:
        'Course Creator is the user role that can has access to create courses of the platform. For eg: Course Creator, Instructor',
    AssessmentCreator:
        'Assessment Creator is the user role that can has access to create assessments of the platform. For eg: Assessment Creator, Instructor',
    Evaluator:
        'Evaluator is the user role that can has access to evaluate the assessments of the platform. For eg: Evaluator, Instructor',
    Learner:
        'Student is the user role that can has access to the courses of the platform. For eg: Student, Learner',
    LiveSession: 'Live Session of the course. For eg: Live Session 1, Live Session 2',
    Batch: 'A Batch is a group of learners enrolled in a course session. For eg: Morning Batch, Weekend Batch',
    Package: 'A Package is a combination of Course, Level, and Session offered together. For eg: Class 10 Science 2025-26',
    PopularTag: 'The label used for the "Popular" tag on courses. This tag is shown in filters and during course creation. For eg: Popular, Trending, Featured',
    AudienceList: 'An Audience List is a group of contacts targeted for campaigns or communications. Also known as Campaigns.',
    Invite: 'An Invite is a link or form sent to users to enroll them into courses or the platform. For eg: Invite, Enrollment Link',
    Inventory: 'Inventory refers to physical or digital items managed by the institute. For eg: Books, Uniforms, Equipment',
    SubOrg: 'A Sub-Org is a child organization managed under your institute — e.g. a branch, franchise, chapter, or partner. Rename it to match how you refer to these units. For eg: Branch, Franchise, Chapter, Partner',
};

export const enum SettingsTabs {
    Tab = 'tab',
    Naming = 'naming',
    Payment = 'payment',
    Invoice = 'invoice',
    Referral = 'referral',
    Course = 'course',
    Assessment = 'assessment',
    Notification = 'notification',
    RoleDisplay = 'roleDisplay',
    StudentDisplay = 'studentDisplay',
    ContentProtection = 'contentProtection',
    CustomFields = 'customFields',
    Certificates = 'certificates',
    Templates = 'templates',
    AiSettings = 'aiSettings',
    ScheduledReports = 'scheduledReports',
    SchoolSettings = 'schoolSettings',
    WhiteLabel = 'whiteLabel',
    AppStatus = 'appStatus',
    WhatsApp = 'whatsapp',
    LeadSettings = 'leadSettings',
    GuardianSettings = 'guardianSettings',
    LearnerCredentials = 'learnerCredentials',
    GtmSettings = 'gtmSettings',
    UtmSettings = 'utmSettings',
    Tnc = 'tnc',
    Integrations = 'integrations',
    Security = 'security',
    DoubtManagement = 'doubtManagement',
    LiveSession = 'liveSession',
    Youtube = 'youtube',
    Automations = 'automations',
    Coupons = 'coupons',
    Telephony = 'telephony',
    PaymentGateways = 'paymentGateways',
    Lms = 'lms',
    AiCalling = 'aiCalling',
    CrmIntelligence = 'crmIntelligence',
    AssistantTools = 'assistantTools',
    McpServer = 'mcpServer',
    BadgesRewards = 'badgesRewards',
    Engagement = 'engagement',
    Language = 'language',
    OnboardingSettings = 'onboardingSettings',
    Appearance = 'appearance',
    LearnerActivity = 'learnerActivity',
    Mentorship = 'mentorship',
}

export const DAYS_IN_MONTH = 30;
