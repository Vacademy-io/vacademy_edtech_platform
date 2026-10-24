import type { Entitlement } from '@/lib/capabilities/entitlement';
import { SettingsTabs } from '../-constants/terms';

/**
 * Which Settings screens belong to the institute's plan
 * (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §8, §9). Applied only in MANAGED mode.
 *
 * Each screen lists the features that use it; it is shown when ANY of them is
 * on, so a screen disappears only when everything it configures is clearly off.
 * `null` = ungoverned (General and Integrations screens): always shown.
 * Where the catalogue's `setting_keys` names a screen's setting, that feature is
 * used; the rest follow the screen's domain.
 *
 * Typed as a full Record so a new SettingsTabs value fails to compile until it
 * is classified here.
 */
const LMS_SIDE = [
    'lms.courses',
    'lms.batches',
    'lms.course_planning',
    'lms.reports',
    'lms.student_ai',
    'lms.doubts',
    'lms.engagement',
    'lms.mentorship',
    'assessments.tests',
    'assessments.question_banks',
    'assessments.scanned_evaluation',
    'live_classes.sessions',
    'live_classes.meetings',
] as const;

const CRM = [
    'crm.leads',
    'crm.admissions',
    'crm.calling',
    'crm.ai_calling',
    'crm.call_intelligence',
    'crm.live_activity',
] as const;

const FINANCE = ['finance.fees', 'finance.memberships', 'finance.packages'] as const;

const COMMUNICATIONS = [
    'communications.announcements',
    'communications.email',
    'communications.whatsapp',
    'communications.chat',
    'communications.notification_hub',
] as const;

const AUTOMATION = [
    'automation.workflows',
    'automation.chatbot_flows',
    'automation.engagement_engines',
] as const;

/** Module families the test checks against the catalogue (every feature listed). */
export const SETTINGS_FEATURE_FAMILIES = {
    lmsSide: { modules: ['lms', 'assessments', 'live_classes'], features: LMS_SIDE },
    crm: { modules: ['crm'], features: CRM },
    finance: { modules: ['finance'], features: FINANCE },
    communications: { modules: ['communications'], features: COMMUNICATIONS },
    automation: { modules: ['automation'], features: AUTOMATION },
} as const;

export const SETTINGS_TAB_FEATURES: Readonly<Record<SettingsTabs, readonly string[] | null>> = {
    // ── General ── always shown
    [SettingsTabs.Tab]: null,
    [SettingsTabs.Appearance]: null,
    [SettingsTabs.WhiteLabel]: null,
    [SettingsTabs.AppStatus]: null,
    [SettingsTabs.Naming]: null,
    [SettingsTabs.RoleDisplay]: null,
    [SettingsTabs.Tnc]: null,
    [SettingsTabs.Security]: null,
    [SettingsTabs.CustomFields]: null,
    [SettingsTabs.Language]: null,
    [SettingsTabs.AiSettings]: null,
    [SettingsTabs.ScheduledReports]: null,
    [SettingsTabs.AssistantTools]: null,
    [SettingsTabs.McpServer]: null,
    // ── LMS ──
    [SettingsTabs.Course]: ['lms.courses'], // COURSE_SETTING
    [SettingsTabs.Lms]: ['lms.courses'], // LMS_SETTING
    [SettingsTabs.Assessment]: ['assessments.tests'],
    [SettingsTabs.Certificates]: ['lms.courses', 'assessments.tests'], // CERTIFICATE_SETTING
    [SettingsTabs.BadgesRewards]: LMS_SIDE,
    [SettingsTabs.Engagement]: ['lms.engagement'], // ENGAGEMENT_SETTING
    [SettingsTabs.LiveSession]: ['live_classes.sessions'], // LIVE_SESSION_SETTING
    [SettingsTabs.DoubtManagement]: ['lms.doubts'], // DOUBT_MANAGEMENT_SETTING
    [SettingsTabs.ContentProtection]: ['lms.courses'], // SLIDE_*_SETTING
    [SettingsTabs.StudentDisplay]: LMS_SIDE,
    [SettingsTabs.LearnerActivity]: LMS_SIDE,
    [SettingsTabs.LearnerCredentials]: LMS_SIDE,
    // ── CRM ──
    [SettingsTabs.LeadSettings]: ['crm.leads'], // LEAD_SETTING
    // Referral programs reward learner enrolments as well as leads.
    [SettingsTabs.Referral]: [...CRM, ...LMS_SIDE, ...FINANCE],
    [SettingsTabs.SchoolSettings]: ['crm.leads', 'crm.admissions'],
    // Guardian ↔ student linking: learners exist with either side.
    [SettingsTabs.GuardianSettings]: [...CRM, ...LMS_SIDE],
    [SettingsTabs.OnboardingSettings]: ['crm.leads'], // ONBOARDING_SETTING
    // ── Finances ──
    [SettingsTabs.Payment]: FINANCE, // PAYMENT_SETTING
    [SettingsTabs.PaymentGateways]: FINANCE,
    [SettingsTabs.Invoice]: FINANCE,
    [SettingsTabs.Coupons]: FINANCE,
    // ── Calling ──
    [SettingsTabs.Telephony]: ['crm.calling', 'crm.ai_calling'], // VOICE_CALLING_SETTING
    [SettingsTabs.AiCalling]: ['crm.ai_calling'], // AI_CALLING_SETTING
    [SettingsTabs.CrmIntelligence]: ['crm.call_intelligence'], // CRM_INTELLIGENCE_SETTING
    // ── Communications ──
    // The WhatsApp account also sends workflow and chatbot messages.
    [SettingsTabs.WhatsApp]: [...COMMUNICATIONS, ...AUTOMATION],
    // Message templates are used everywhere (credentials, invites, workflows).
    [SettingsTabs.Templates]: null,
    [SettingsTabs.Automations]: AUTOMATION, // workflow recipes
    // EMAIL_SETTING sender addresses — the system-wide utility mail too.
    [SettingsTabs.Notification]: null,
    [SettingsTabs.Mentorship]: ['lms.mentorship'],
    // ── Integrations ── always shown
    [SettingsTabs.Integrations]: null,
    [SettingsTabs.Youtube]: null,
    [SettingsTabs.GtmSettings]: null,
    [SettingsTabs.UtmSettings]: null,
};

/** LEGACY (not managed) and ungoverned/unknown tabs are always entitled. */
export function isSettingsTabEntitled(tab: string, entitlement: Entitlement): boolean {
    if (!entitlement.managed) return true;
    const features = (SETTINGS_TAB_FEATURES as Record<string, readonly string[] | null>)[tab];
    return !features || features.some((f) => entitlement.isFeatureOn(f));
}

/** The settings screens to offer (MANAGED filter; LEGACY returns `tabs` itself). */
export function filterSettingsTabs<T extends { tab: string }>(
    tabs: T[],
    entitlement: Entitlement
): T[] {
    if (!entitlement.managed) return tabs;
    return tabs.filter((t) => isSettingsTabEntitled(t.tab, entitlement));
}

/**
 * The screen /settings renders for `selectedTab`: the selected one when it is
 * offered, else Display Settings (the default for the bare rail icon's 'tab'
 * sentinel and for a deep link to a screen outside the plan), else the first.
 */
export function resolveSettingsTab<T extends { tab: string }>(
    selectedTab: string | undefined,
    visibleTabs: T[]
): T | undefined {
    return (
        visibleTabs.find((t) => t.tab === selectedTab) ??
        visibleTabs.find((t) => t.tab === SettingsTabs.RoleDisplay) ??
        visibleTabs[0]
    );
}
