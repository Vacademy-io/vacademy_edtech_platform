import type { StudentSideViewTabId, StudentSideViewVisibilityKey } from '@/types/display-settings';

// Bridge between the boolean visibility flag (e.g., "overviewTab") and the
// stable tab id used by the sidebar component (e.g., "overview"). Used by:
//   - the settings UIs (reorder + default-tab selector)
//   - the StudentSidebar component (rendering and initial-tab selection)
export const VISIBILITY_KEY_TO_TAB_ID: Record<StudentSideViewVisibilityKey, StudentSideViewTabId> =
    {
        overviewTab: 'overview',
        testTab: 'testRecord',
        progressTab: 'learningProgress',
        coursesTab: 'courses',
        notificationTab: 'notifications',
        membershipTab: 'membership',
        paymentHistoryTab: 'paymentHistory',
        userTaggingTab: 'userTagging',
        badgesTab: 'badges',
        fileTab: 'files',
        portalAccessTab: 'portalAccess',
        reportsTab: 'reports',
        enrollDerollTab: 'enrollDeroll',
        enquiryTab: 'enquiry',
        applicationTab: 'application',
        leadTab: 'lead',
        fullHistoryTab: 'fullHistory',
        workflowsTab: 'workflows',
        parentTab: 'parent',
        onboardingTab: 'onboarding',
    };

// Reverse lookup: tab id → visibility flag.
export const TAB_ID_TO_VISIBILITY_KEY: Record<StudentSideViewTabId, StudentSideViewVisibilityKey> =
    Object.entries(VISIBILITY_KEY_TO_TAB_ID).reduce(
        (acc, [vis, tab]) => {
            acc[tab as StudentSideViewTabId] = vis as StudentSideViewVisibilityKey;
            return acc;
        },
        {} as Record<StudentSideViewTabId, StudentSideViewVisibilityKey>
    );

export const STUDENT_SIDE_VIEW_TAB_LABELS: Record<StudentSideViewTabId, string> = {
    overview: 'Overview',
    courses: 'Courses',
    learningProgress: 'Progress',
    testRecord: 'Tests',
    notifications: 'Notifications',
    membership: 'Membership',
    paymentHistory: 'Payment History',
    userTagging: 'User Tagging',
    badges: 'Badges',
    files: 'Files',
    portalAccess: 'Portal Access',
    reports: 'Reports',
    enrollDeroll: 'Enroll/Deroll',
    enquiry: 'Enquiry',
    application: 'Application',
    lead: 'Lead Profile',
    fullHistory: 'Full History',
    workflows: 'Workflows',
    parent: 'Guardian',
    onboarding: 'Onboarding',
};
