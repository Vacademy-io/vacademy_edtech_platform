import {
    Robot,
    Ticket,
    Megaphone,
    GearSix,
    UsersFour,
    PlusCircle,
    House,
    CreditCard,
    AddressBook,
    Video,
    CalendarCheck,
    ChartBar,
    Pulse,
    Lightning,
    Question,
    PencilCircle,
    Files,
    Sparkle,
    FilmStrip,
    Books,
    Code,
    UserList,
    Notebook,
    Broadcast,
    PhoneCall,
    ChatCircleDots,
    IdentificationBadge,
    AirplaneTakeoff,
    Money,
    ChartLineUp,
    SealCheck,
    UserCircle,
    SquaresFour,
} from '@phosphor-icons/react';
import i18next from 'i18next';
import { StorageKey } from '@/constants/storage/storage';
import {
    ContentTerms,
    OtherTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';
import { NamingSettingsType } from '@/routes/settings/-constants/terms';
import { SidebarItemsType } from '@/types/layout-container/layout-container-types';
import { isBulkContentUploadEnabled } from '@/components/common/study-library/bulk-content-uploading/feature-gate';
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from '@/i18n/locales';
import { getLanguageSetting } from '@/services/language-settings';
import { notifyNamingSettingsUpdated } from '@/hooks/useNamingSettingsVersion';

// Utility function to get naming settings from localStorage
const getNamingSettings = (): NamingSettingsType[] => {
    try {
        const saved = localStorage.getItem(StorageKey.NAMING_SETTINGS);
        if (!saved) return [];

        const parsed = JSON.parse(saved);

        // Ensure the parsed data is an array
        if (!Array.isArray(parsed)) {
            console.warn('Naming settings in localStorage is not an array:', parsed);
            return [];
        }

        return parsed;
    } catch (error) {
        console.error('Failed to parse naming settings from localStorage:', error);
        return [];
    }
};

/* -------------------------------------------------------------------------- *
 * Locale-aware terminology resolution
 *
 * Institutes rename terms ("Course" → "Programme") AND the UI can render in a
 * language other than the one those renames were typed in. resolveLocalizedTerm
 * covers steps (a)–(c) of the chain; it returns null when the caller must apply
 * step (d) — its own pre-existing fallback, byte-for-byte:
 *
 *   (a) term.locales[lng]                    → the institute's word for THIS locale
 *   (b) lng === content source locale        → null (flat customValue path = today)
 *   (c) i18n.t('terms:<key>')                → translated SYSTEM default
 *   (d) null                                 → caller's existing fallback
 *
 * ENGLISH IS UNTOUCHED: with no `locales` map and no LANGUAGE_SETTING, the
 * source locale defaults to 'en', so an 'en' UI always exits at (b) with null
 * and every caller behaves exactly as it did before this file changed. The
 * terms catalog is not even fetched.
 * -------------------------------------------------------------------------- */

const TERMS_NAMESPACE = 'terms';

/**
 * Active UI locale. Read off the i18next singleton rather than importing
 * '@/i18n' so this module never triggers i18n init (735 call sites import it,
 * including from non-browser contexts) and no import cycle is possible.
 */
const getActiveLocale = (): SupportedLocale =>
    normalizeLocale(i18next.resolvedLanguage ?? i18next.language);

/** Language the institute's flat customValue/customPluralValue are written in. */
const getContentSourceLocale = (): SupportedLocale => {
    try {
        return normalizeLocale(getLanguageSetting()?.content_source_locale ?? DEFAULT_LOCALE);
    } catch {
        return DEFAULT_LOCALE;
    }
};

// Locales whose terms catalog has been requested — the namespace is fetched
// lazily and only for locales that can actually reach step (c), so an
// English-only institute never pays for it.
const requestedTermsLocales = new Set<string>();

const ensureTermsCatalog = (locale: string): void => {
    if (requestedTermsLocales.has(locale) || !i18next.isInitialized) return;
    requestedTermsLocales.add(locale);
    void i18next
        .loadNamespaces(TERMS_NAMESPACE)
        // The catalog lands after the first paint; tell consumers to re-read.
        .then(() => notifyNamingSettingsUpdated())
        .catch(() => {
            // Missing/failed catalog is non-fatal — resolution falls to step (d).
            requestedTermsLocales.delete(locale);
        });
};

/** Translated system default for a term, or null when the catalog lacks it. */
const translateTerm = (key: string, suffix?: string): string | null => {
    if (!i18next.isInitialized) return null;
    const fullKey = suffix ? `${key}_${suffix}` : key;
    if (!i18next.exists(fullKey, { ns: TERMS_NAMESPACE })) return null;
    const value = i18next.t(fullKey, { ns: TERMS_NAMESPACE, defaultValue: '' });
    return typeof value === 'string' && value.length > 0 ? value : null;
};

/**
 * Steps (a)–(c) above. `null` means "use your own fallback" (step (d)).
 *
 * Plural reads the `_other` suffix: it is the bare plural LABEL in every
 * catalog (en "Courses", ar broken plural "دورات"), not a count-driven form.
 */
export const resolveLocalizedTerm = (
    setting: NamingSettingsType | undefined,
    key: string,
    form: 'singular' | 'plural'
): string | null => {
    const locale = getActiveLocale();

    // (a) Institute's own word for the active locale. `locales` is optional —
    // blobs cached before this field existed simply have nothing here.
    const override = setting?.locales?.[locale];
    const overrideValue = form === 'plural' ? override?.customPluralValue : override?.customValue;
    if (overrideValue) return overrideValue;

    // (b) The flat fields already hold the right language — caller's path wins.
    if (locale === getContentSourceLocale()) return null;

    // (c) Translated system default.
    ensureTermsCatalog(locale);
    return translateTerm(key, form === 'plural' ? 'other' : undefined);
};

// When true, getTerminology/getTerminologyPlural bypass localStorage and
// always return the system default, and sidebar labels resolve in English.
// Used by withSystemDefaults() so callers can compute what a label WOULD be
// without any user customization — i.e. exactly the value Display Settings
// seeded, which predates i18n and is therefore always English.
let useSystemDefaultsFlag = false;

/** `sidebar:aiLecturePlanning` -> `Ai Lecture Planning`. Last-resort only. */
const humanizeSidebarKey = (key: string): string => {
    const leaf = key.slice(key.indexOf(':') + 1);
    const spaced = leaf
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[._-]+/g, ' ')
        .trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

// English is always loaded (it is the fallbackLng), so forcing it here never
// yields a raw key even when another language is active.
//
// The fallback below is not decoration. i18next.t() returns `undefined` until
// init() has run and the bare key until the namespace is seeded, and these
// labels feed BOTH the nav and the Tab Name / Label boxes in Display Settings —
// which is how an editor full of blank name fields next to filled-in routes
// shipped. A nameless sidebar entry is never the right answer, so degrade to a
// readable form of the key rather than to nothing.
const sidebarT = (key: string, options?: Record<string, unknown>): string => {
    const value = i18next.t(key, {
        ...(options ?? {}),
        ...(useSystemDefaultsFlag ? { lng: DEFAULT_LOCALE } : {}),
    }) as string | undefined;
    const leaf = key.slice(key.indexOf(':') + 1);
    if (!value || value === key || value === leaf) return humanizeSidebarKey(key);
    return value;
};

export const withSystemDefaults = <T>(fn: () => T): T => {
    const prev = useSystemDefaultsFlag;
    useSystemDefaultsFlag = true;
    try {
        return fn();
    } finally {
        useSystemDefaultsFlag = prev;
    }
};

// Utility function to get custom terminology with fallback to default
export const getTerminology = (key: string, defaultValue: string): string => {
    if (useSystemDefaultsFlag) return defaultValue;

    const settings = getNamingSettings();

    // Double-check that settings is an array before calling find
    if (!Array.isArray(settings)) {
        console.warn('Settings is not an array in getTerminology:', settings);
        return defaultValue;
    }

    const setting = settings.find((item) => item.key === key);

    // Steps (a)-(c); null → step (d), the original line below, unchanged.
    const localized = resolveLocalizedTerm(setting, key, 'singular');
    if (localized) return localized;

    return setting?.customValue || defaultValue;
};

// Utility function to get pluralized terminology — uses stored customPluralValue
export const getTerminologyPlural = (key: string, defaultValue: string): string => {
    if (useSystemDefaultsFlag) return naivePluralize(defaultValue);

    const settings = getNamingSettings();

    if (!Array.isArray(settings)) {
        return defaultValue;
    }

    const setting = settings.find((item) => item.key === key);

    // Steps (a)-(c); null → step (d), the original body below, unchanged.
    // naivePluralize is English-only, so reaching it for a non-English locale
    // would mangle the word — that is exactly what step (c) prevents.
    const localized = resolveLocalizedTerm(setting, key, 'plural');
    if (localized) return localized;

    if (setting?.customPluralValue) {
        return setting.customPluralValue;
    }

    // Fallback: naive pluralization of the singular custom value (or default)
    const singular = setting?.customValue || defaultValue;
    return naivePluralize(singular);
};

// Fallback pluralization for when customPluralValue is not set
const naivePluralize = (word: string): string => {
    if (
        word.endsWith('s') ||
        word.endsWith('x') ||
        word.endsWith('z') ||
        word.endsWith('ch') ||
        word.endsWith('sh')
    ) {
        return `${word}es`;
    }
    if (
        word.endsWith('y') &&
        !['a', 'e', 'i', 'o', 'u'].includes(word.charAt(word.length - 2).toLowerCase())
    ) {
        return `${word.slice(0, -1)}ies`;
    }
    return `${word}s`;
};

// Re-evaluates on each call so naming settings changes are reflected immediately
export const getSidebarItemsData = (): SidebarItemsType[] => [
    // CRM with ERP
    {
        icon: House,
        title: sidebarT('sidebar:dashboard'),
        id: 'dashboard',
        to: '/dashboard',
        category: 'CRM',
    },
    {
        icon: UsersFour,
        title: sidebarT('sidebar:manageInstitute'),
        id: 'manage-institute',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:instituteOverview'),
                subItemLink: '/manage-institute/overview',
                subItemId: 'institute-overview',
                adminOnly: true,
            },
            {
                subItem: getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch),
                subItemLink: '/manage-institute/batches',
                subItemId: 'batches',
            },
            {
                subItem: getTerminology(ContentTerms.Session, SystemTerms.Session), // Session
                subItemLink: '/manage-institute/sessions',
                subItemId: 'sessions',
            },
            {
                subItem: sidebarT('sidebar:teams'),
                subItemLink: '/manage-institute/teams',
                subItemId: 'teams',
            },
            {
                subItem: sidebarT('sidebar:subOrgTeams', {
                    term: getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg),
                }),
                subItemLink: '/manage-suborg-teams',
                subItemId: 'suborg-teams',
            },
            {
                // Institute-admin surface — sub-orgs list + drilldown to a sub-org's
                // analytics deep page. Sibling to "Sub-Org Teams" (which is the
                // sub-org-admin's narrow view). Both default off; institutes opt in.
                subItem: sidebarT('sidebar:manageInstituteSubOrgs', {
                    term: getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg),
                }),
                subItemLink: '/manage-custom-teams',
                subItemId: 'manage-institute-suborgs',
            },
            {
                subItem: sidebarT('sidebar:inventoryManagement', {
                    term: getTerminology(OtherTerms.Inventory, SystemTerms.Inventory),
                }),
                subItemLink: '/manage-inventory',
                subItemId: 'inventory-management',
            },
            {
                subItem: sidebarT('sidebar:managePackages', {
                    term: getTerminologyPlural(ContentTerms.Package, SystemTerms.Package),
                }),
                subItemLink: '/admin-package-management',
                subItemId: 'manage-packages',
                adminOnly: true,
            },
        ],
    },
    {
        icon: AddressBook,
        title: sidebarT('sidebar:manageContacts'),
        id: 'manage-contacts',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:contactsDashboard'),
                subItemLink: '/manage-contacts/dashboard',
                subItemId: 'contacts-dashboard',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:allContacts'),
                subItemLink: '/manage-contacts',
                subItemId: 'all-contacts',
            },
            {
                subItem: sidebarT('sidebar:linkedCourseContacts', {
                    term: getTerminology(ContentTerms.Course, SystemTerms.Course),
                }),
                subItemLink: '/manage-students/students-list',
                subItemId: 'linked-contacts',
            },
            {
                subItem: sidebarT('sidebar:userTags'),
                subItemLink: '/user-tags/institute',
                subItemId: 'user-tags-main',
            },
            {
                subItem: sidebarT('sidebar:linkTag'),
                subItemLink: '/user-tags/link',
                subItemId: 'link-tag',
            },
            {
                subItem: sidebarT('sidebar:inviteUsers', {
                    term: getTerminology(OtherTerms.Invite, SystemTerms.Invite),
                }),
                subItemLink: '/manage-students/invite',
                subItemId: 'invite',
            },
        ],
    },
    {
        icon: AddressBook, // Can reuse AddressBook icon or import a new one like Users
        title: sidebarT('sidebar:admissions'),
        id: 'admissions',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:dashboard'),
                subItemLink: '/admissions/dashboard',
                subItemId: 'dashboard',
            },
            {
                subItem: sidebarT('sidebar:admissionList'),
                subItemLink: '/admissions/admission-list',
                subItemId: 'admission-list',
            },
            {
                subItem: sidebarT('sidebar:enquiries'),
                subItemLink: '/admissions/enquiries',
                subItemId: 'enquiry',
            },
            {
                subItem: sidebarT('sidebar:application'),
                subItemLink: '/admissions/application',
                subItemId: 'application',
            },
        ],
    },
    {
        icon: CreditCard,
        title: sidebarT('sidebar:feeManagement'),
        id: 'fee-management',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:createFeePlan'),
                subItemLink: '/financial-management/fee-plans',
                subItemId: 'create-fee-plan',
            },
            {
                subItem: sidebarT('sidebar:manageFinances'),
                subItemLink: '/financial-management/manage-finances',
                subItemId: 'manage-finances',
            },
            {
                subItem: sidebarT('sidebar:collectionDashboard'),
                subItemLink: '/financial-management/collection-dashboard',
                subItemId: 'collection-dashboard',
            },
            {
                subItem: sidebarT('sidebar:payInstallments'),
                subItemLink: '/financial-management/pay-installments',
                subItemId: 'pay-installments',
            },
            {
                subItem: sidebarT('sidebar:adjustmentApprovals'),
                subItemLink: '/financial-management/adjustment-approvals',
                subItemId: 'adjustment-approvals',
            },
        ],
    },
    {
        icon: CreditCard,
        title: sidebarT('sidebar:membership'),
        id: 'membership-management',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:paymentDashboard'),
                subItemLink: '/payment-dashboard',
                subItemId: 'payment-dashboard-sub',
            },
            {
                subItem: sidebarT('sidebar:managePayments'),
                subItemLink: '/manage-payments',
                subItemId: 'manage-payments-sub',
            },
            {
                subItem: sidebarT('sidebar:manageExpiry'),
                subItemLink: '/membership-expiry',
                subItemId: 'membership-expiry-sub',
            },
            {
                subItem: sidebarT('sidebar:inviteStats', {
                    term: getTerminology(OtherTerms.Invite, SystemTerms.Invite),
                }),
                subItemLink: '/membership-stats',
                subItemId: 'membership-stats-sub',
            },
        ],
    },
    {
        icon: Megaphone,
        title: sidebarT('sidebar:communications'),
        id: 'communications',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:messagingDashboard'),
                subItemLink: '/communication/dashboard',
                subItemId: 'messaging-dashboard',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:inAppMessages'),
                subItemLink: '/chat',
                subItemId: 'chat',
            },
            {
                subItem: sidebarT('sidebar:notificationHub'),
                subItemLink: '/communication/notification-hub',
                subItemId: 'notification-hub',
            },
            {
                subItem: sidebarT('sidebar:whatsappInbox'),
                subItemLink: '/communication/inbox',
                subItemId: 'whatsapp-inbox',
            },
            {
                subItem: sidebarT('sidebar:whatsappTemplates'),
                subItemLink: '/communication/whatsapp-templates',
                subItemId: 'whatsapp-templates',
            },
            {
                subItem: sidebarT('sidebar:createAnnouncement'),
                subItemLink: '/announcement/create',
                subItemId: 'announcement-create',
            },
            {
                subItem: sidebarT('sidebar:emailCampaigning'),
                subItemLink: '/announcement/email-campaigning',
                subItemId: 'announcement-email-campaigning',
            },
            {
                subItem: sidebarT('sidebar:announcementHistory'),
                subItemLink: '/announcement/history',
                subItemId: 'announcement-history',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:scheduleAnnouncement'),
                subItemLink: '/announcement/schedule',
                subItemId: 'announcement-schedule',
            },
            {
                subItem: sidebarT('sidebar:announcementApproval'),
                subItemLink: '/announcement/approval',
                subItemId: 'announcement-approval',
            },
        ],
    },
    {
        icon: Robot,
        title: sidebarT('sidebar:automations'),
        id: 'automations',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:automationDashboard'),
                subItemLink: '/automation/dashboard',
                subItemId: 'automation-dashboard',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:workflows'),
                subItemLink: '/workflow/list',
                subItemId: 'workflow-list',
            },
            {
                subItem: sidebarT('sidebar:chatbotFlows'),
                subItemLink: '/automation/chatbot-flows',
                subItemId: 'chatbot-flows',
            },
            {
                subItem: sidebarT('sidebar:websiteBuilder'),
                subItemLink: '/manage-pages',
                subItemId: 'website-builder',
            },
            {
                subItem: sidebarT('sidebar:productPages'),
                subItemLink: '/manage-pages/product-pages',
                subItemId: 'product-pages',
            },
            {
                subItem: sidebarT('sidebar:siteAssistant'),
                subItemLink: '/manage-pages/site-assistant',
                subItemId: 'site-assistant',
            },
            {
                subItem: sidebarT('sidebar:blog'),
                subItemLink: '/manage-pages/blog',
                subItemId: 'blog',
            },
        ],
    },
    {
        icon: UserList,
        title: sidebarT('sidebar:leads'),
        id: 'leads',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:leadList'),
                subItemLink: '/audience-manager/list',
                subItemId: 'lead-list-leads',
            },
            {
                subItem: sidebarT('sidebar:recentLeads'),
                subItemLink: '/audience-manager/recent-leads',
                subItemId: 'recent-leads',
            },
            {
                subItem: sidebarT('sidebar:leadBoard'),
                subItemLink: '/audience-manager/lead-board',
                subItemId: 'lead-board',
            },
            {
                subItem: sidebarT('sidebar:followUps'),
                subItemLink: '/audience-manager/follow-ups',
                subItemId: 'follow-ups',
            },
            {
                subItem: sidebarT('sidebar:callLog'),
                subItemLink: '/audience-manager/call-log',
                subItemId: 'call-log',
            },
            {
                subItem: sidebarT('sidebar:leadLookup'),
                subItemLink: '/audience-manager/lead-lookup',
                subItemId: 'lead-lookup',
            },
            {
                subItem: sidebarT('sidebar:onboarding'),
                subItemLink: '/audience-manager/onboarding',
                subItemId: 'onboarding',
            },
            {
                subItem: sidebarT('sidebar:aiIntelligence'),
                subItemLink: '/audience-manager/ai-intelligence',
                subItemId: 'ai-intelligence',
            },
            {
                subItem: sidebarT('sidebar:counsellors'),
                subItemLink: '/counsellors',
                subItemId: 'counsellors',
            },
            {
                subItem: sidebarT('sidebar:salesDashboard'),
                subItemLink: '/sales-dashboard',
                subItemId: 'sales-dashboard',
            },
            {
                subItem: sidebarT('sidebar:reports'),
                subItemLink: '/audience-manager/reports',
                subItemId: 'lead-reports',
            },
            {
                // Deep link into the Reports Center's Campaigns (UTM) tab — the
                // campaign-attribution dashboard is the thing admins go looking
                // for by name, and a tab inside Reports is not discoverable from
                // the nav on its own.
                subItem: sidebarT('sidebar:utmCampaigns'),
                subItemLink: '/audience-manager/reports?tab=utm',
                subItemId: 'utm-campaigns',
            },
        ],
    },
    {
        // Everything voice: the call history, the AI personas that make/take calls,
        // and the two settings screens that configure them (deep-linked into the
        // Settings tab shell so there's one source of truth for those forms).
        icon: PhoneCall,
        title: sidebarT('sidebar:calling'),
        id: 'calling',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:callingDashboard'),
                subItemLink: '/calling/dashboard',
                subItemId: 'calling-dashboard',
            },
            {
                subItem: sidebarT('sidebar:callLog'),
                subItemLink: '/audience-manager/call-log',
                subItemId: 'calling-call-log',
            },
            {
                subItem: sidebarT('sidebar:callQueue'),
                subItemLink: '/calling/call-queue',
                subItemId: 'calling-call-queue',
            },
            {
                subItem: sidebarT('sidebar:aiAgents'),
                subItemLink: '/calling/ai-agents',
                subItemId: 'calling-ai-agents',
            },
            {
                subItem: sidebarT('sidebar:callingSettings'),
                subItemLink: '/settings?selectedTab=telephony',
                subItemId: 'calling-settings',
            },
            {
                subItem: sidebarT('sidebar:aiCallingSettings'),
                subItemLink: '/settings?selectedTab=aiCalling',
                subItemId: 'calling-ai-settings',
            },
        ],
    },
    {
        icon: CalendarCheck,
        title: sidebarT('sidebar:meetings'),
        id: 'meetings',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:meetingsDashboard'),
                subItemLink: '/meetings/dashboard',
                subItemId: 'meetings-dashboard',
            },
            {
                subItem: sidebarT('sidebar:mySchedule'),
                subItemLink: '/meetings/my-schedule',
                subItemId: 'meetings-my-schedule',
            },
            {
                subItem: sidebarT('sidebar:teamMeetings'),
                subItemLink: '/meetings/team',
                subItemId: 'meetings-team',
            },
        ],
    },
    {
        icon: UsersFour,
        title: sidebarT('sidebar:mentorship'),
        id: 'mentorship',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:overview'),
                subItemLink: '/mentorship/dashboard',
                subItemId: 'mentorship-dashboard',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:mentors'),
                subItemLink: '/mentorship/mentors',
                subItemId: 'mentorship-mentors',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:sessions'),
                subItemLink: '/mentorship/sessions',
                subItemId: 'mentorship-sessions',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:requests'),
                subItemLink: '/mentorship/requests',
                subItemId: 'mentorship-requests',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:myMentorship'),
                subItemLink: '/mentorship/my-mentorship',
                subItemId: 'mentorship-my-mentorship',
            },
        ],
    },
    {
        icon: Lightning,
        title: sidebarT('sidebar:engagementEngines'),
        id: 'engagement-engines',
        category: 'CRM',
        subItems: [
            {
                subItem: sidebarT('sidebar:engagementDashboard'),
                subItemLink: '/engagement-engines/dashboard',
                subItemId: 'engagement-dashboard',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:engines'),
                subItemLink: '/engagement-engines',
                subItemId: 'engagement-engines-list',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:taskInbox'),
                subItemLink: '/engagement-engines/inbox',
                subItemId: 'engagement-task-inbox',
                adminOnly: true,
            },
        ],
    },
    // My HR is the EMPLOYEE's own workspace, so its sub-items are deliberately
    // not adminOnly. mySidebar strips the whole section for anyone without an
    // employee profile (see useMyEmployeeProfile) — same shape as
    // mentorship-my-mentorship.
    {
        icon: UserCircle,
        title: sidebarT('sidebar:myHr'),
        id: 'erp-my-hr',
        category: 'ERP',
        subItems: [
            {
                subItem: sidebarT('sidebar:overview'),
                subItemLink: '/erp/my-hr',
                subItemId: 'erp-my-hr-overview',
            },
            {
                subItem: sidebarT('sidebar:myLeave'),
                subItemLink: '/erp/my-hr/leave',
                subItemId: 'erp-my-hr-leave',
            },
            {
                subItem: sidebarT('sidebar:myPayslips'),
                subItemLink: '/erp/my-hr/payslips',
                subItemId: 'erp-my-hr-payslips',
            },
            {
                subItem: sidebarT('sidebar:myTax'),
                subItemLink: '/erp/my-hr/tax',
                subItemId: 'erp-my-hr-tax',
            },
            {
                subItem: sidebarT('sidebar:myClaims'),
                subItemLink: '/erp/my-hr/claims',
                subItemId: 'erp-my-hr-claims',
            },
        ],
    },
    // ─────────────────────────── ERP ───────────────────────────
    // The operations world: HR & Payroll today, accounting/inventory later.
    // Every module here is opt-in per institute (OPT_IN_TAB_IDS) and the ERP
    // rail category itself ships hidden, so nothing appears until an institute
    // turns it on in Settings → Display Settings.
    {
        icon: IdentificationBadge,
        title: sidebarT('sidebar:people'),
        id: 'erp-people',
        category: 'ERP',
        subItems: [
            {
                subItem: sidebarT('sidebar:employees'),
                subItemLink: '/erp/people',
                subItemId: 'erp-people-employees',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:departmentsAndDesignations'),
                subItemLink: '/erp/people/org',
                subItemId: 'erp-people-org',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:staffCoverage'),
                subItemLink: '/erp/people/staff-bridge',
                subItemId: 'erp-people-staff-bridge',
                adminOnly: true,
            },
        ],
    },
    {
        icon: AirplaneTakeoff,
        title: sidebarT('sidebar:leave'),
        id: 'erp-leave',
        category: 'ERP',
        subItems: [
            {
                subItem: sidebarT('sidebar:requests'),
                subItemLink: '/erp/leave',
                subItemId: 'erp-leave-requests',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:balances'),
                subItemLink: '/erp/leave/balances',
                subItemId: 'erp-leave-balances',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:typesAndPolicies'),
                subItemLink: '/erp/leave/setup',
                subItemId: 'erp-leave-setup',
                adminOnly: true,
            },
        ],
    },
    {
        icon: CalendarCheck,
        title: sidebarT('sidebar:attendance'),
        id: 'erp-attendance',
        category: 'ERP',
        subItems: [
            {
                subItem: sidebarT('sidebar:dailyBoard'),
                subItemLink: '/erp/attendance',
                subItemId: 'erp-attendance-daily',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:regularizations'),
                subItemLink: '/erp/attendance/regularizations',
                subItemId: 'erp-attendance-regularizations',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:shiftsAndHolidays'),
                subItemLink: '/erp/attendance/setup',
                subItemId: 'erp-attendance-setup',
                adminOnly: true,
            },
        ],
    },
    {
        icon: Money,
        title: sidebarT('sidebar:payroll'),
        id: 'erp-payroll',
        category: 'ERP',
        subItems: [
            {
                subItem: sidebarT('sidebar:runs'),
                subItemLink: '/erp/payroll',
                subItemId: 'erp-payroll-runs',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:variablePay'),
                subItemLink: '/erp/payroll/adjustments',
                subItemId: 'erp-payroll-adjustments',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:salarySetup'),
                subItemLink: '/erp/payroll/salary-setup',
                subItemId: 'erp-payroll-salary-setup',
                adminOnly: true,
            },
        ],
    },
    {
        icon: SealCheck,
        title: sidebarT('sidebar:compliance'),
        id: 'erp-compliance',
        category: 'ERP',
        subItems: [
            {
                subItem: sidebarT('sidebar:filings'),
                subItemLink: '/erp/compliance',
                subItemId: 'erp-compliance-filings',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:challans'),
                subItemLink: '/erp/compliance/challans',
                subItemId: 'erp-compliance-challans',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:provisions'),
                subItemLink: '/erp/compliance/provisions',
                subItemId: 'erp-compliance-provisions',
                adminOnly: true,
            },
        ],
    },
    {
        icon: ChartLineUp,
        title: sidebarT('sidebar:finance'),
        id: 'erp-finance',
        category: 'ERP',
        subItems: [
            {
                subItem: sidebarT('sidebar:journal'),
                subItemLink: '/erp/finance/journal',
                subItemId: 'erp-finance-journal',
                adminOnly: true,
            },
            {
                subItem: sidebarT('sidebar:pAndLSnapshot'),
                subItemLink: '/erp/finance/pnl',
                subItemId: 'erp-finance-pnl',
                adminOnly: true,
            },
        ],
    },
    {
        icon: GearSix,
        id: 'settings',
        title: sidebarT('sidebar:settings'),
        to: '/settings',
        category: 'CRM',
    },
    {
        icon: Notebook,
        id: 'admin-activity-logs',
        title: sidebarT('sidebar:adminActivityLogs'),
        to: '/admin-activity-logs',
        category: 'CRM',
    },

    // Live Activity. Deliberately ONE tab with no sub-items: the page's category tabs
    // are in-page state (?category=), not navigation. Display Settings therefore shows a
    // single on/off switch per role, and it ships hidden (see OPT_IN_TAB_IDS) so an
    // institute turns it on knowingly -- the feed surfaces prospect PII and payment
    // amounts to every role that has it enabled.
    {
        icon: Broadcast,
        id: 'live-activity',
        title: sidebarT('sidebar:liveActivity'),
        to: '/live-activity',
        category: 'CRM',
    },

    // LMS
    // LMS Dashboard — the learning cards moved off the home page. Shown only to roles
    // whose home is the CRM Dashboard (mySidebar.tsx shows it only to people whose sidebar has Leads).
    {
        icon: SquaresFour,
        title: sidebarT('sidebar:lmsDashboard'),
        id: 'lms-dashboard',
        to: '/lms-dashboard',
        category: 'LMS',
    },
    {
        icon: Books,
        title: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course),
        id: 'courses',
        to: '/study-library/courses',
        category: 'LMS',
    },
    {
        icon: PlusCircle,
        title: sidebarT('sidebar:courseCreation', {
            term: getTerminology(ContentTerms.Course, SystemTerms.Course),
        }),
        id: 'course-creation',
        category: 'LMS',
        subItems: [
            {
                subItem: sidebarT('sidebar:createNewCourseFromScratch', {
                    term: getTerminology(ContentTerms.Course, SystemTerms.Course).toLowerCase(),
                }),
                subItemLink: '/study-library/courses?action=create',
                subItemId: 'create-course-scratch',
            },
            {
                subItem: sidebarT('sidebar:createCourseFromAi', {
                    term: getTerminology(ContentTerms.Course, SystemTerms.Course).toLowerCase(),
                }),
                subItemLink: '/study-library/ai-copilot',
                subItemId: 'create-course-ai',
            },
            // Hidden by default — per-institute gate (see bulk-content-uploading/feature-gate.ts)
            ...(isBulkContentUploadEnabled()
                ? [
                      {
                          subItem: sidebarT('sidebar:bulkContentUpload'),
                          subItemLink: '/study-library/bulk-content-uploading',
                          subItemId: 'bulk-content-uploading',
                      },
                  ]
                : []),
        ],
    },
    {
        icon: Video,
        title: getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession),
        id: 'live-sessions',
        category: 'LMS',
        subItems: [
            {
                subItem: sidebarT('sidebar:liveSessionDashboard', {
                    term: getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession),
                }),
                subItemLink: '/study-library/live-session/dashboard',
                subItemId: 'live-session-dashboard',
            },
            {
                subItem: sidebarT('sidebar:scheduledLiveSessions', {
                    term: getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession),
                }),
                subItemLink: '/study-library/live-session',
                subItemId: 'scheduled-sessions',
            },
            {
                subItem: sidebarT('sidebar:createNew'),
                subItemLink: '/study-library/live-session/schedule/step1',
                subItemId: 'create-live-session',
            },
            {
                subItem: sidebarT('sidebar:bulkSchedule'),
                subItemLink: '/study-library/live-session/schedule/bulk',
                subItemId: 'bulk-schedule-live-session',
            },
            {
                subItem: sidebarT('sidebar:liveSessionAttendance', {
                    term: getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession),
                }),
                subItemLink: '/study-library/attendance-tracker',
                subItemId: 'session-attendance',
            },
            {
                subItem: sidebarT('sidebar:liveSessionFeedback', {
                    term: getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession),
                }),
                subItemLink: '/study-library/live-session/feedback',
                subItemId: 'live-session-feedback',
            },
        ],
    },
    {
        icon: CalendarCheck,
        title: sidebarT('sidebar:coursePlanningAndLogbook', {
            term: getTerminology(ContentTerms.Course, SystemTerms.Course),
        }),
        id: 'course-planning-logging',
        category: 'LMS',
        subItems: [
            {
                subItem: sidebarT('sidebar:curriculumTimelinePlanner'),
                subItemLink: '/planning/planning',
                subItemId: 'curriculum-planner',
            },
            {
                subItem: sidebarT('sidebar:aiLecturePlanning'),
                subItemLink: '/ai-center/ai-tools/vsmart-lecture',
                subItemId: 'ai-lecture-planning',
            },
            {
                subItem: sidebarT('sidebar:logCourseProgress', {
                    term: getTerminology(ContentTerms.Course, SystemTerms.Course),
                }),
                subItemLink: '/planning/activity-logs',
                subItemId: 'log-course-progress',
            },
        ],
    },
    {
        icon: Pulse,
        title: sidebarT('sidebar:institutePulse'),
        id: 'institute-pulse',
        to: '/institute-pulse',
        category: 'LMS',
    },
    {
        icon: ChartBar,
        title: sidebarT('sidebar:learningReports'),
        id: 'learning-reports',
        to: '/study-library/reports',
        category: 'LMS',
    },
    {
        icon: Lightning,
        title: sidebarT('sidebar:learningEngagement'),
        id: 'learning-engagement',
        category: 'LMS',
        subItems: [
            {
                subItem: sidebarT('sidebar:interactiveClass'), // Volt
                subItemLink: '/study-library/volt',
                subItemId: 'interactive-class-volt',
            },
            {
                subItem: sidebarT('sidebar:createEngagingContent'),
                subItemLink: '/video-api-studio',
                subItemId: 'create-engaging-content',
            },
            {
                subItem: sidebarT('sidebar:dailyEngagement'),
                subItemLink: '/engagement',
                subItemId: 'daily-engagement',
            },
        ],
    },
    {
        icon: Question,
        title: sidebarT('sidebar:doubtManagement'),
        id: 'doubt-management',
        to: '/study-library/doubt-management',
        category: 'LMS',
    },
    {
        icon: ChatCircleDots,
        title: sidebarT('sidebar:studentAi'),
        id: 'student-ai',
        to: '/study-library/student-ai',
        category: 'LMS',
    },
    {
        icon: PencilCircle, // Assuming pencilCircle variable name mismatch fix to come
        title: sidebarT('sidebar:assessmentsAndTests'),
        id: 'assessments-tests',
        category: 'LMS',
        subItems: [
            {
                subItem: sidebarT('sidebar:assessmentDashboard'),
                subItemLink: '/assessment/dashboard',
                subItemId: 'assessment-dashboard',
            },
            {
                subItem: sidebarT('sidebar:scheduledTests'),
                subItemLink: '/assessment/assessment-list?selectedTab=liveTests',
                subItemId: 'scheduled-tests',
            },
            {
                subItem: sidebarT('sidebar:createDeadlineBasedTests'),
                subItemLink: '/assessment/create-assessment/defaultId/EXAM?currentStep=0',
                subItemId: 'create-deadline-test',
            },
            {
                subItem: sidebarT('sidebar:createAnytimeAttemptTest'),
                subItemLink: '/assessment/create-assessment/defaultId/MOCK?currentStep=0',
                subItemId: 'create-anytime-test',
            },
            {
                subItem: sidebarT('sidebar:createSurvey'),
                subItemLink: '/assessment/create-assessment/defaultId/SURVEY?currentStep=0',
                subItemId: 'create-survey',
            },
            {
                subItem: sidebarT('sidebar:testEvaluations'),
                subItemLink: '/evaluation/evaluations',
                subItemId: 'test-evaluations',
            },
            {
                subItem: sidebarT('sidebar:scannedAnswerSheetEvaluation'),
                subItemLink: '/evaluation/evaluation-tool',
                subItemId: 'scanned-evaluation',
            },
        ],
    },
    {
        icon: Files,
        title: sidebarT('sidebar:questionsBanksAndPapers'),
        id: 'question-banks',
        to: '/assessment/question-papers',
        category: 'LMS',
    },

    // AI Tools
    {
        icon: Sparkle,
        title: sidebarT('sidebar:aiTools'),
        id: 'ai-tools-tab',
        category: 'AI',
        to: '/ai-center/ai-tools',
    },
    {
        icon: Books,
        title: sidebarT('sidebar:knowledgeBase'),
        id: 'knowledge-base-tab',
        category: 'AI',
        to: '/knowledge-base',
    },
    {
        icon: Robot, // Or User icon if available
        title: sidebarT('sidebar:instructorCopilot'),
        id: 'instructor-copilot-tab',
        category: 'AI',
        to: '/instructor-copilot',
    },
    {
        icon: Robot,
        title: sidebarT('sidebar:aiCourseCreator', {
            term: getTerminology(ContentTerms.Course, SystemTerms.Course),
        }),
        id: 'ai-copilot-tab',
        category: 'AI',
        to: '/study-library/ai-copilot',
    },
    {
        icon: FilmStrip,
        title: sidebarT('sidebar:vimotionContentStudio'),
        id: 'content-ai-studio',
        category: 'AI',
        to: '/video-api-studio/console',
    },
    {
        icon: Code,
        title: sidebarT('sidebar:contentAiApi'),
        id: 'content-ai-api',
        category: 'AI',
        to: '/video-api-studio',
    },

    // Access Passes (one purchase -> several courses). An LMS tab, appended last so no
    // other tab's order moves. Ships HIDDEN for every role (OPT_IN_TAB_IDS, the teacher
    // defaults and controlledTabs): an institute turns it on in Display Settings.
    {
        icon: Ticket,
        title: sidebarT('sidebar:accessPasses'),
        id: 'access-passes',
        category: 'LMS',
        to: '/access-passes',
    },
];

/** @deprecated Use getSidebarItemsData() instead — this static reference won't reflect naming changes */
export const SidebarItemsData: SidebarItemsType[] = getSidebarItemsData();
