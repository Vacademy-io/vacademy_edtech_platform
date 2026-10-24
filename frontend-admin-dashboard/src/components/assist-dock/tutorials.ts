// Route → tutorial mapping for the Assist Dock (right rail).
//
// AUTO-DRAFTED from the 55 walkthroughs-v2 filenames — REVIEW the `routes`/`tab`
// for accuracy. Each tutorial is one self-contained animated HTML on S3.
//
// Matching: a tutorial shows when the current pathname startsWith one of `routes`.
// For Settings tutorials, `tab` further narrows to a specific Settings tab
// (the `selectedTab` search param) so a page only shows its own walkthroughs.
//
// i18n: `title` is not stored here — these defs run at module scope (no React
// context), so the title text lives in public/locales/{en,ar,hi,fr}/tutorials.json
// keyed by `id` and is resolved by buildTutorials(t)/tutorialsForRoute(t, ...) at
// call time. The calling component MUST hold a `useTranslation('tutorials')`
// subscription (see AssistDock.tsx) so titles re-render on language change.

import type { TFunction } from 'i18next';

export const TUTORIALS_BASE_URL =
    'https://vacademy-tutorials.s3.us-east-1.amazonaws.com/walkthroughs-v2';

export interface Tutorial {
    id: string;
    /** Filename on S3 (under TUTORIALS_BASE_URL). */
    file: string;
    title: string;
    /** Pathname prefixes where this tutorial is relevant. */
    routes: string[];
    /** Optional Settings tab (the `selectedTab` value) for finer matching on /settings. */
    tab?: string;
}

interface TutorialDef {
    id: string;
    /** Filename on S3 (under TUTORIALS_BASE_URL). */
    file: string;
    /** Pathname prefixes where this tutorial is relevant. */
    routes: string[];
    /** Optional Settings tab (the `selectedTab` value) for finer matching on /settings. */
    tab?: string;
}

const f = (slug: string) => `admin-how-to-${slug}.html`;

const TUTORIAL_DEFS: TutorialDef[] = [
    // ── Courses / content ────────────────────────────────────────────────
    {
        id: 'create-a-course',
        file: f('create-a-course'),
        routes: ['/study-library/courses', '/study-library'],
    },

    // ── Batches / sessions (Manage Institute) ────────────────────────────
    {
        id: 'create-a-batch',
        file: f('create-a-batch'),
        routes: ['/manage-institute/batches'],
    },
    {
        id: 'create-a-session',
        file: f('create-a-session'),
        routes: ['/manage-institute/sessions'],
    },

    // ── Learners (Manage Students) ───────────────────────────────────────
    {
        id: 'enroll-a-learner',
        file: f('enroll-a-learner'),
        routes: ['/manage-students', '/manage-institute/batches'],
    },
    {
        id: 'add-a-tag-to-a-student',
        file: f('add-a-tag-to-a-student'),
        routes: ['/manage-students'],
    },
    {
        id: 'edit-a-learner-details',
        file: f('edit-a-learner-details'),
        routes: ['/manage-students'],
    },
    {
        id: 'create-a-user-tag',
        file: f('create-a-user-tag'),
        routes: ['/manage-students', '/audience-manager'],
    }, // REVIEW route

    // ── CRM / Leads (Audience Manager) ───────────────────────────────────
    {
        id: 'assign-a-counselor-to-a-lead',
        file: f('assign-a-counselor-to-a-lead'),
        routes: ['/audience-manager/recent-leads', '/audience-manager/follow-ups'],
    },
    {
        id: 'log-a-note-for-a-lead',
        file: f('log-a-note-for-a-lead'),
        routes: ['/audience-manager/recent-leads'],
    },
    {
        id: 'log-a-call-with-a-lead',
        file: f('log-a-call-with-a-lead'),
        routes: ['/audience-manager/recent-leads'],
    },
    {
        id: 'log-a-meeting-with-a-lead',
        file: f('log-a-meeting-with-a-lead'),
        routes: ['/audience-manager/recent-leads'],
    },
    {
        id: 'schedule-a-follow-up-for-a-lead',
        file: f('schedule-a-follow-up-for-a-lead'),
        routes: ['/audience-manager/follow-ups', '/audience-manager/recent-leads'],
    },
    {
        id: 'change-a-lead-status',
        file: f('change-a-lead-status'),
        routes: ['/audience-manager/recent-leads'],
    },

    // ── Lead pools (Settings › Leads › Pools) ────────────────────────────
    {
        id: 'create-a-lead-distribution-pool',
        file: f('create-a-lead-distribution-pool'),
        routes: ['/settings/leads/pools', '/settings'],
        tab: 'leadSettings',
    },
    {
        id: 'update-a-lead-pool',
        file: f('update-a-lead-pool'),
        routes: ['/settings/leads/pools'],
    },
    {
        id: 'add-a-counselor-to-a-pool',
        file: f('add-a-counselor-to-a-pool'),
        routes: ['/settings/leads/pools'],
    },
    {
        id: 'attach-a-campaign-to-a-pool',
        file: f('attach-a-campaign-to-a-pool'),
        routes: ['/settings/leads/pools'],
    },

    // ── Lead config (Settings › Lead Settings) ───────────────────────────
    {
        id: 'set-up-custom-lead-statuses',
        file: f('set-up-custom-lead-statuses'),
        routes: ['/settings'],
        tab: 'leadSettings',
    },
    {
        id: 'configure-lead-scoring-rules',
        file: f('configure-lead-scoring-rules'),
        routes: ['/settings'],
        tab: 'leadSettings',
    },
    {
        id: 'set-counsellor-monthly-targets',
        file: f('set-counsellor-monthly-targets'),
        routes: ['/settings', '/sales-dashboard'],
        tab: 'leadSettings',
    },

    // ── Naming (Settings › Naming) ───────────────────────────────────────
    {
        id: 'rename-content-terms',
        file: f('rename-content-terms'),
        routes: ['/settings'],
        tab: 'naming',
    },
    {
        id: 'rename-role-terms',
        file: f('rename-role-terms'),
        routes: ['/settings'],
        tab: 'naming',
    },
    {
        id: 'rename-other-terms',
        file: f('rename-other-terms'),
        routes: ['/settings'],
        tab: 'naming',
    },
    {
        id: 'rename-system-terminology',
        file: f('rename-system-terminology'),
        routes: ['/settings'],
        tab: 'naming',
    },

    // ── Display & roles (Settings) ───────────────────────────────────────
    {
        id: 'configure-admin-display-settings',
        file: f('configure-admin-display-settings'),
        routes: ['/settings'],
        tab: 'roleDisplay',
    },
    {
        id: 'configure-student-display-settings',
        file: f('configure-student-display-settings'),
        routes: ['/settings'],
        tab: 'studentDisplay',
    },
    {
        id: 'create-a-custom-role',
        file: f('create-a-custom-role'),
        routes: ['/settings'],
        tab: 'roleDisplay',
    },
    {
        id: 'create-a-custom-team',
        file: f('create-a-custom-team'),
        routes: ['/manage-custom-teams'],
    },
    {
        id: 'create-a-custom-field',
        file: f('create-a-custom-field'),
        routes: ['/settings'],
        tab: 'customFields',
    },
    {
        id: 'set-up-content-protection',
        file: f('set-up-content-protection'),
        routes: ['/settings'],
        tab: 'contentProtection',
    },

    // ── Feature settings (Settings) ──────────────────────────────────────
    {
        id: 'configure-assessment-settings',
        file: f('configure-assessment-settings'),
        routes: ['/settings'],
        tab: 'assessment',
    },
    {
        id: 'configure-course-settings',
        file: f('configure-course-settings'),
        routes: ['/settings'],
        tab: 'course',
    },
    {
        id: 'configure-live-session-settings',
        file: f('configure-live-session-settings'),
        routes: ['/settings'],
        tab: 'liveSession',
    },
    {
        id: 'configure-school-settings',
        file: f('configure-school-settings'),
        routes: ['/settings'],
        tab: 'schoolSettings',
    },
    {
        id: 'enable-youtube-integration',
        file: f('enable-youtube-integration'),
        routes: ['/settings'],
        tab: 'youtube',
    },
    {
        id: 'set-up-google-tag-manager',
        file: f('set-up-google-tag-manager'),
        routes: ['/settings'],
        tab: 'gtmSettings',
    },
    {
        id: 'set-up-student-terms-and-conditions',
        file: f('set-up-student-terms-and-conditions'),
        routes: ['/settings'],
        tab: 'tnc',
    },
    {
        id: 'create-a-doubt-category',
        file: f('create-a-doubt-category'),
        routes: ['/settings', '/study-library/doubt-management'],
        tab: 'doubtManagement',
    },

    // ── Payments / invoices / coupons (Settings) ─────────────────────────
    {
        id: 'create-a-payment-plan',
        file: f('create-a-payment-plan'),
        routes: ['/settings'],
        tab: 'payment',
    },
    {
        id: 'create-a-coupon',
        file: f('create-a-coupon'),
        routes: ['/settings'],
        tab: 'coupons',
    },
    {
        id: 'create-a-flat-discount-coupon',
        file: f('create-a-flat-discount-coupon'),
        routes: ['/settings'],
        tab: 'coupons',
    },
    {
        id: 'create-a-referral-reward',
        file: f('create-a-referral-reward'),
        routes: ['/settings'],
        tab: 'referral',
    },
    {
        id: 'configure-invoice-options',
        file: f('configure-invoice-options'),
        routes: ['/settings'],
        tab: 'invoice',
    },
    {
        id: 'set-the-invoice-tax-label',
        file: f('set-the-invoice-tax-label'),
        routes: ['/settings'],
        tab: 'invoice',
    },
    {
        id: 'add-a-tax-rate',
        file: f('add-a-tax-rate'),
        routes: ['/settings'],
        tab: 'invoice',
    },
    {
        id: 'set-your-time-zone-and-currency',
        file: f('set-your-time-zone-and-currency'),
        routes: ['/settings'],
        tab: 'payment',
    }, // REVIEW tab

    // ── White-label / portal branding (Settings › White-Label Setup) ─────
    {
        id: 'set-theme-primary-color',
        file: f('set-theme-primary-color'),
        routes: ['/settings', '/dashboard'],
        tab: 'whiteLabel',
    },
    {
        id: 'set-your-portal-font',
        file: f('set-your-portal-font'),
        routes: ['/settings'],
        tab: 'whiteLabel',
    },
    {
        id: 'set-your-portal-tab-title',
        file: f('set-your-portal-tab-title'),
        routes: ['/settings'],
        tab: 'whiteLabel',
    },
    {
        id: 'set-your-privacy-policy-url',
        file: f('set-your-privacy-policy-url'),
        routes: ['/settings'],
        tab: 'whiteLabel',
    },
    {
        id: 'set-your-terms-url',
        file: f('set-your-terms-url'),
        routes: ['/settings'],
        tab: 'whiteLabel',
    },
    {
        id: 'set-your-ios-app-link',
        file: f('set-your-ios-app-link'),
        routes: ['/settings'],
        tab: 'whiteLabel',
    },
    {
        id: 'set-your-android-app-link',
        file: f('set-your-android-app-link'),
        routes: ['/settings'],
        tab: 'whiteLabel',
    },

    // ── Booking (REVIEW: confirm the actual route for these) ─────────────
    {
        id: 'create-a-booking-type',
        file: f('create-a-booking-type'),
        routes: ['/settings'],
    }, // REVIEW route
    {
        id: 'create-a-booking-event',
        file: f('create-a-booking-event'),
        routes: ['/settings'],
    }, // REVIEW route
];

/** Resolves every tutorial def's translated title via the given `t` (namespace `tutorials`). */
export function buildTutorials(t: TFunction): Tutorial[] {
    return TUTORIAL_DEFS.map((def) => ({
        ...def,
        title: t(def.id),
    }));
}

/** Tutorials relevant to the current location (pathname + optional settings tab). */
export function tutorialsForRoute(
    t: TFunction,
    pathname: string,
    selectedTab?: string | null
): Tutorial[] {
    return buildTutorials(t).filter((tut) => {
        const pathMatch = tut.routes.some((r) => pathname.startsWith(r));
        if (!pathMatch) return false;
        // On /settings, a tutorial with a `tab` only shows for its own tab.
        if (tut.tab && pathname.startsWith('/settings') && selectedTab) {
            return tut.tab === selectedTab;
        }
        return true;
    });
}
