// Maps a CSV "Navigation Flow" string (e.g. "Settings > White Label", "Courses > Create Course")
// to a real admin-app route. Used to auto-generate capture specs for ~400 flows.

// Settings sub-tabs: keyword (lowercase) -> ?selectedTab=<id>
const SETTINGS_TABS = [
    [/white\s*-?label|branding|logo|theme|domain|favicon/, 'whiteLabel'],
    [/naming|terminolog/, 'naming'],
    [/payment gateway|razorpay|stripe|cashfree|gateway/, 'paymentGateways'],
    [/invoice|gst|tax/, 'invoice'],
    [/payment|fee plan|installment|pricing|subscription/, 'payment'],
    [/coupon|discount|promo/, 'coupons'],
    [/referral/, 'referral'],
    [/course setting/, 'course'],
    [/assessment setting/, 'assessment'],
    [/certificate/, 'certificates'],
    [/custom field/, 'customFields'],
    [/role|permission|display setting/, 'roleDisplay'],
    [/student display/, 'studentDisplay'],
    [/content protection/, 'contentProtection'],
    [/notification/, 'notification'],
    [/template/, 'templates'],
    [/\bai\b|ai setting/, 'aiSettings'],
    [/school|admission setting|counselor|counsellor allocation/, 'schoolSettings'],
    [/whatsapp/, 'whatsapp'],
    [/lead/, 'leadSettings'],
    [/gtm|google tag/, 'gtmSettings'],
    [/t&c|terms|conditions/, 'tnc'],
    [/ad integration|facebook|meta|pixel|integration/, 'integrations'],
    [/doubt/, 'doubtManagement'],
    [/live session setting/, 'liveSession'],
    [/youtube/, 'youtube'],
    [/telephony|calling|exotel/, 'telephony'],
    [/automation/, 'automations'],
    [/lms setting/, 'lms'],
];

// Section keyword -> route. Order matters (first match wins). Tested against the
// FULL flow string (lowercased) so deeper matches can win via specificity ordering.
const SECTION_ROUTES = [
    [/lead.*pool|counsellor pool|pools/, '/settings/leads/pools'],
    [/fee management/, '/settings/fee-management'],
    [/fee plan|fee.*setup|installment plan/, '/financial-management/fee-plans'],
    [/collection|dunning|outstanding|overdue/, '/financial-management/collection-dashboard'],
    [/pay installment|pay-installment/, '/financial-management/pay-installments'],
    [/adjustment approval/, '/financial-management/adjustment-approvals'],
    [/manage finance|finances/, '/financial-management/manage-finances'],
    [/manage payment/, '/manage-payments'],

    [/create course|course creation|course detail|study library|^courses|\bcourses\b|add content|drip/, '/study-library/courses'],
    [/live class|live session/, '/study-library/live-session'],
    [/doubt/, '/study-library/doubt-management'],
    [/learning report|learning engagement/, '/study-library/reports'],
    [/attendance/, '/study-library/attendance-tracker'],
    [/bulk content|bulk upload content/, '/study-library/bulk-content-uploading'],
    [/volt/, '/study-library/volt'],
    [/ai copilot|copilot/, '/study-library/ai-copilot'],

    [/question paper|question bank/, '/assessment/question-papers'],
    [/evaluation ai|ai evaluat|evaluate handwritten|vsmart feedback/, '/assessment/evaluation-ai'],
    [/assessment|test|exam|quiz|proctor/, '/assessment/assessment-list'],
    [/homework/, '/homework-creation/assessment-list'],
    [/evaluator/, '/evaluator-ai/assessment'],
    [/instructor copilot/, '/instructor-copilot'],

    [/ai center|vsmart|question paper from|paper digiti|topic question/, '/ai-center'],
    [/vimotion|reel|explainer video/, '/vim'],

    [/enquir/, '/admissions/enquiries'],
    [/application/, '/admissions/application'],
    [/admission/, '/admissions/dashboard'],

    [/team|invite team|invite member|invite user|org chart/, '/manage-institute/teams'],
    [/batch/, '/manage-institute/batches'],
    [/session/, '/manage-institute/sessions'],
    [/inventory/, '/manage-inventory'],
    [/manage package|package management/, '/admin-package-management'],
    [/sub-?org|custom team|branch/, '/manage-custom-teams'],
    [/manage institute|institute setting/, '/manage-institute/teams'],

    [/enroll request/, '/manage-students/enroll-requests'],
    [/invite link|enroll.*invite|create invite/, '/manage-students/invite'],
    [/manage learner|enroll learner|onboard|learner profile|learner.*list|^students|student profile/, '/manage-students/students-list'],

    [/all contact|manage contact|contact/, '/manage-contacts'],
    [/audience|capture lead|lead.*website|lead.*ad|nurture|campaign/, '/audience-manager/list'],
    [/follow.?up/, '/audience-manager/follow-ups'],
    [/recent lead/, '/audience-manager/recent-leads'],
    [/crm report|conversion funnel|source roi|counsellor performance/, '/audience-manager/reports'],
    [/\blead/, '/audience-manager/recent-leads'],

    [/whatsapp inbox|inbox/, '/communication/inbox'],
    [/whatsapp template/, '/communication/whatsapp-templates'],
    [/notification hub/, '/communication/notification-hub'],
    [/announcement/, '/announcement/create'],
    [/communication/, '/communication/inbox'],

    [/workflow|nurture workflow|build.*automation/, '/workflow/list'],
    [/chatbot/, '/automation/chatbot-flows'],
    [/automation/, '/workflow/list'],

    [/membership/, '/membership-stats'],
    [/user tag/, '/user-tags/institute'],
    [/dashboard|navigate the admin|home/, '/dashboard'],
];

export function resolveRoute(flowOrTitle) {
    const s = (flowOrTitle || '').toLowerCase();
    // Settings flows -> /settings(?selectedTab=)
    if (/^\s*settings\b|settings >|profile > preferences|appearance|dark mode/.test(s) || /\bsetting\b/.test(s)) {
        for (const [re, tab] of SETTINGS_TABS) {
            if (re.test(s)) return { route: '/settings', tab };
        }
        // "Settings > Teams > Invite", "Settings > Institute Settings" etc. are NOT
        // real settings tabs — they live elsewhere. Fall through to section routes
        // (but never to the /dashboard catch-all) before defaulting to /settings.
        for (const [re, route] of SECTION_ROUTES) {
            if (route !== '/dashboard' && re.test(s)) return { route, tab: null };
        }
        return { route: '/settings', tab: null };
    }
    for (const [re, route] of SECTION_ROUTES) {
        if (re.test(s)) return { route, tab: null };
    }
    return { route: '/dashboard', tab: null }; // fallback
}

export function routeToUrl(base, route, tab) {
    let url = base.replace(/\/+$/, '') + route;
    if (tab) url += `?selectedTab=${tab}`;
    return url;
}
