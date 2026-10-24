import type { ComponentType } from 'react';
import { SettingsTabs } from '../-constants/terms';
import PaymentSettings from '../-components/Payment/PaymentSettings';
import ReferralSettings from '../-components/Referral/ReferralSettings';
import CourseSettings from '../-components/Course/CourseSettings';
import NamingSettings from '../-components/NamingSettings';
import NotificationSettings from '../-components/Notification/NotificationSettings';
import RoleDisplaySettingsMain from '../-components/RoleDisplay/RoleDisplaySettingsMain';
import StudentDisplaySettings from '@/routes/settings/-components/RoleDisplay/StudentDisplaySettings';
import ContentProtectionSettings from '../-components/ContentProtectionSettings';
import CustomFieldsSettings from '@/components/settings/CustomFieldsSettings';
import CertificatesSettings from '../-components/Certificates/CertificatesSettings';
import { TemplateSettings } from '@/components/templates';
import AiSettings from '../-components/AiSettings';
import ScheduledReportsSettings from '../-components/ScheduledReportsSettings';
import SchoolSettings from '../-components/School/SchoolSettings';
import WhiteLabelSettings from '../-components/WhiteLabelSettings';
import AppStatusSettings from '../-components/AppStatusSettings';
import AssessmentSettings from '../-components/AssessmentSettings';
import WhatsAppSettings from '../-components/WhatsAppSettings/WhatsAppSettings';
import LeadSettings from '../-components/LeadSettings';
import GuardianSettings from '../-components/GuardianSettings';
import OnboardingSettings from '../-components/OnboardingSettings';
import GtmSettings from '../-components/GtmSettings';
import UtmSettings from '../-components/UtmSettings';
import SecuritySettings from '../-components/SecuritySettings';
import TncSettings from '../-components/Tnc/TncSettings';
import IntegrationSettings from '../-components/IntegrationSettings';
import DoubtManagementSettings from '../-components/DoubtManagementSettings';
import LiveSessionSettings from '../-components/LiveSessionSettings';
import MentorshipSettings from '../-components/MentorshipSettings';
import YoutubeIntegrationSettings from '../-components/YoutubeIntegrationSettings';
import { AutomationSettings } from '../-components/Automations';
import InvoiceSettings from '../-components/Invoice/InvoiceSettings';
import CouponSettings from '../-components/Coupons/CouponSettings';
import TelephonySettings from '../-components/TelephonySettings';
import { TelephonyProviderCards } from '@/routes/settings/telephony/-components/telephony-provider-cards';
import PaymentGatewaySettings from '../-components/PaymentGatewaySettings';
import LmsSettings from '../-components/Lms/LmsSettings';
import AiCallingSettings from '../-components/AiCallingSettings';
import CrmIntelligenceSettings from '../-components/CrmIntelligenceSettings';
import AssistantToolsSettings from '../-components/AssistantToolsSettings';
import MCPServerSettings from '../-components/MCPServerSettings';
import BadgesRewardsSettings from '../-components/BadgesRewards/BadgesRewardsSettings';
import EngagementSettings from '../-components/EngagementSettings';
import LanguageSettings from '../-components/LanguageSettings';
import AppearanceSettings from '../-components/Appearance/AppearanceSettings';
import LearnerActivitySettings from '../-components/LearnerActivitySettings';
import LearnerCredentialSettings from '../-components/LearnerCredentialSettings';

/** Top-level settings navigation categories — order here is display order. */
export type SettingsDomain =
    | 'General'
    | 'LMS'
    | 'CRM'
    | 'Finances'
    | 'Calling'
    | 'Communications'
    | 'Integrations';

export const SETTINGS_DOMAIN_ORDER: SettingsDomain[] = [
    'General',
    'LMS',
    'CRM',
    'Finances',
    'Calling',
    'Communications',
    'Integrations',
];

/** Sub-group display order within each domain. */
export const SETTINGS_GROUP_ORDER: Record<SettingsDomain, string[]> = {
    General: [
        'Branding & Identity',
        'Roles & Access',
        'Security',
        'Data & Fields',
        'Platform Configuration',
    ],
    LMS: [
        'Course & Curriculum',
        'Assessment & Certification',
        'Content & Delivery',
        'Learner Experience',
    ],
    CRM: ['Leads & Contacts'],
    Finances: ['Billing & Payments'],
    Calling: ['Voice & Telephony'],
    Communications: ['Messaging & Automation'],
    Integrations: ['Third-Party Connections'],
};

export interface SettingsTabEntry {
    tab: SettingsTabs;
    value: string;
    component: ComponentType<Record<string, unknown>>;
    domain: SettingsDomain;
    group: string;
    /**
     * Chrome-free variant to render when this setting is shown inside the
     * quick-access popup instead of the full /settings page. Falls back to
     * `component` when absent (see getSettingsEntryByKey consumers).
     */
    embeddedComponent?: ComponentType<Record<string, unknown>>;
}

export const getAvailableSettingsTabs = (): SettingsTabEntry[] => {
    // Grouped by domain/group for readability. Render order is driven by
    // SETTINGS_DOMAIN_ORDER / SETTINGS_GROUP_ORDER at the consumption sites
    // (sidebar-panel.tsx, sidebar-search.tsx), not by this array's order.
    return [
        // ── General — Branding & Identity ──────────────────────────────────
        {
            tab: SettingsTabs.Appearance,
            value: 'Appearance',
            component: AppearanceSettings,
            domain: 'General',
            group: 'Branding & Identity',
        },
        {
            tab: SettingsTabs.WhiteLabel,
            value: 'White-Label Setup',
            component: WhiteLabelSettings,
            domain: 'General',
            group: 'Branding & Identity',
        },
        {
            tab: SettingsTabs.AppStatus,
            value: 'App Status',
            component: AppStatusSettings,
            domain: 'General',
            group: 'Branding & Identity',
        },
        {
            tab: SettingsTabs.Naming,
            value: 'Naming Settings',
            component: NamingSettings,
            domain: 'General',
            group: 'Branding & Identity',
        },
        // ── General — Roles & Access ────────────────────────────────────────
        {
            tab: SettingsTabs.RoleDisplay,
            value: 'Display Settings',
            component: RoleDisplaySettingsMain,
            domain: 'General',
            group: 'Roles & Access',
        },
        {
            tab: SettingsTabs.Tnc,
            value: 'Student T&C',
            component: TncSettings,
            domain: 'General',
            group: 'Roles & Access',
        },
        // ── General — Security ───────────────────────────────────────────────
        {
            tab: SettingsTabs.Security,
            value: 'Security Settings',
            component: SecuritySettings,
            domain: 'General',
            group: 'Security',
        },
        // ── General — Data & Fields ──────────────────────────────────────────
        {
            tab: SettingsTabs.CustomFields,
            value: 'Custom Fields',
            component: CustomFieldsSettings,
            domain: 'General',
            group: 'Data & Fields',
        },
        // ── General — Platform Configuration ────────────────────────────────
        {
            tab: SettingsTabs.Language,
            value: 'Language Settings',
            component: LanguageSettings,
            domain: 'General',
            group: 'Platform Configuration',
        },
        {
            tab: SettingsTabs.AiSettings,
            value: 'AI Settings',
            component: AiSettings,
            domain: 'General',
            group: 'Platform Configuration',
        },
        {
            tab: SettingsTabs.ScheduledReports,
            value: 'Scheduled Reports',
            component: ScheduledReportsSettings,
            domain: 'General',
            group: 'Platform Configuration',
        },
        {
            tab: SettingsTabs.AssistantTools,
            value: 'Vacademy Assistant',
            component: AssistantToolsSettings,
            domain: 'General',
            group: 'Platform Configuration',
        },
        {
            tab: SettingsTabs.McpServer,
            value: 'MCP Server',
            component: MCPServerSettings,
            domain: 'General',
            group: 'Platform Configuration',
        },
        // ── LMS — Course & Curriculum ────────────────────────────────────────
        {
            tab: SettingsTabs.Course,
            value: 'Course Settings',
            component: CourseSettings,
            domain: 'LMS',
            group: 'Course & Curriculum',
        },
        {
            tab: SettingsTabs.Lms,
            value: 'Learning Platform Defaults',
            component: LmsSettings,
            domain: 'LMS',
            group: 'Course & Curriculum',
        },
        // ── LMS — Assessment & Certification ────────────────────────────────
        {
            tab: SettingsTabs.Assessment,
            value: 'Assessment Settings',
            component: AssessmentSettings,
            domain: 'LMS',
            group: 'Assessment & Certification',
        },
        {
            tab: SettingsTabs.Certificates,
            value: 'Certificate Settings',
            component: CertificatesSettings,
            domain: 'LMS',
            group: 'Assessment & Certification',
        },
        {
            tab: SettingsTabs.BadgesRewards,
            value: 'Badges & Rewards',
            component: BadgesRewardsSettings,
            domain: 'LMS',
            group: 'Assessment & Certification',
        },
        {
            tab: SettingsTabs.Engagement,
            value: 'Daily Engagement',
            component: EngagementSettings,
            domain: 'LMS',
            group: 'Assessment & Certification',
        },
        // ── LMS — Content & Delivery ─────────────────────────────────────────
        {
            tab: SettingsTabs.LiveSession,
            value: 'Live Session Settings',
            component: LiveSessionSettings,
            domain: 'LMS',
            group: 'Content & Delivery',
        },
        {
            tab: SettingsTabs.DoubtManagement,
            value: 'Doubt Management',
            component: DoubtManagementSettings,
            domain: 'LMS',
            group: 'Content & Delivery',
        },
        {
            tab: SettingsTabs.ContentProtection,
            value: 'Content Protection',
            component: ContentProtectionSettings,
            domain: 'LMS',
            group: 'Content & Delivery',
        },
        // ── LMS — Learner Experience ─────────────────────────────────────────
        {
            tab: SettingsTabs.StudentDisplay,
            value: 'Student Display',
            component: StudentDisplaySettings,
            domain: 'LMS',
            group: 'Learner Experience',
        },
        {
            tab: SettingsTabs.LearnerActivity,
            value: 'Learner Activity',
            component: LearnerActivitySettings,
            domain: 'LMS',
            group: 'Learner Experience',
        },
        {
            tab: SettingsTabs.LearnerCredentials,
            value: 'Learner Credentials',
            component: LearnerCredentialSettings,
            domain: 'LMS',
            group: 'Learner Experience',
        },
        // ── CRM — Leads & Contacts ───────────────────────────────────────────
        {
            tab: SettingsTabs.LeadSettings,
            value: 'Lead Settings',
            component: LeadSettings,
            domain: 'CRM',
            group: 'Leads & Contacts',
        },
        {
            tab: SettingsTabs.Referral,
            value: 'Referral Settings',
            component: ReferralSettings,
            domain: 'CRM',
            group: 'Leads & Contacts',
        },
        {
            tab: SettingsTabs.SchoolSettings,
            value: 'Admissions & Counsellors',
            component: SchoolSettings,
            domain: 'CRM',
            group: 'Leads & Contacts',
        },
        {
            tab: SettingsTabs.GuardianSettings,
            value: 'Guardian Settings',
            component: GuardianSettings,
            domain: 'CRM',
            group: 'Leads & Contacts',
        },
        {
            tab: SettingsTabs.OnboardingSettings,
            value: 'Onboarding Settings',
            component: OnboardingSettings,
            domain: 'CRM',
            group: 'Leads & Contacts',
        },
        // ── Finances — Billing & Payments ────────────────────────────────────
        {
            tab: SettingsTabs.Payment,
            value: 'Payment Settings',
            component: PaymentSettings,
            domain: 'Finances',
            group: 'Billing & Payments',
        },
        {
            tab: SettingsTabs.PaymentGateways,
            value: 'Payment Gateways',
            component: PaymentGatewaySettings,
            domain: 'Finances',
            group: 'Billing & Payments',
        },
        {
            tab: SettingsTabs.Invoice,
            value: 'Invoice Settings',
            component: InvoiceSettings,
            domain: 'Finances',
            group: 'Billing & Payments',
        },
        {
            tab: SettingsTabs.Coupons,
            value: 'Coupon Settings',
            component: CouponSettings,
            domain: 'Finances',
            group: 'Billing & Payments',
        },
        // ── Calling — Voice & Telephony ──────────────────────────────────────
        {
            tab: SettingsTabs.Telephony,
            value: 'Calling (Telephony)',
            component: TelephonySettings,
            embeddedComponent: TelephonyProviderCards,
            domain: 'Calling',
            group: 'Voice & Telephony',
        },
        {
            tab: SettingsTabs.AiCalling,
            value: 'AI Calling',
            component: AiCallingSettings,
            domain: 'Calling',
            group: 'Voice & Telephony',
        },
        {
            tab: SettingsTabs.CrmIntelligence,
            value: 'CRM Intelligence',
            component: CrmIntelligenceSettings,
            domain: 'Calling',
            group: 'Voice & Telephony',
        },
        // ── Communications — Messaging & Automation ──────────────────────────
        {
            tab: SettingsTabs.WhatsApp,
            value: 'WhatsApp Settings',
            component: WhatsAppSettings,
            domain: 'Communications',
            group: 'Messaging & Automation',
        },
        {
            tab: SettingsTabs.Templates,
            value: 'Template Settings',
            component: TemplateSettings,
            domain: 'Communications',
            group: 'Messaging & Automation',
        },
        {
            tab: SettingsTabs.Automations,
            value: 'Automations',
            component: AutomationSettings,
            domain: 'Communications',
            group: 'Messaging & Automation',
        },
        {
            tab: SettingsTabs.Notification,
            value: 'Notification Settings',
            component: NotificationSettings,
            domain: 'Communications',
            group: 'Messaging & Automation',
        },
        {
            tab: SettingsTabs.Mentorship,
            value: 'Mentorship Settings',
            component: MentorshipSettings,
            domain: 'Communications',
            group: 'Messaging & Automation',
        },
        // ── Integrations — Third-Party Connections ───────────────────────────
        {
            tab: SettingsTabs.Integrations,
            value: 'Ad Integrations',
            component: IntegrationSettings,
            domain: 'Integrations',
            group: 'Third-Party Connections',
        },
        {
            tab: SettingsTabs.Youtube,
            value: 'YouTube Integration',
            component: YoutubeIntegrationSettings,
            domain: 'Integrations',
            group: 'Third-Party Connections',
        },
        {
            tab: SettingsTabs.GtmSettings,
            value: 'GTM Settings',
            component: GtmSettings,
            domain: 'Integrations',
            group: 'Third-Party Connections',
        },
        {
            // Its own entry, not a section of GTM: attribution is first-party
            // and needs no tag manager, so an institute that has never used
            // one would never think to look under "GTM" for campaign links.
            tab: SettingsTabs.UtmSettings,
            value: 'Campaign Links (UTM)',
            component: UtmSettings,
            domain: 'Integrations',
            group: 'Third-Party Connections',
        },
    ];
};

let settingsEntryLookup: Record<string, SettingsTabEntry> | null = null;

/**
 * O(1) lookup by `tab` key, used by the quick-access popup (and anywhere else
 * that needs one entry rather than the whole list). Memoized once — the
 * underlying array is static for the lifetime of the app.
 */
export const getSettingsEntryByKey = (key: string): SettingsTabEntry | undefined => {
    if (!settingsEntryLookup) {
        settingsEntryLookup = {};
        getAvailableSettingsTabs().forEach((entry) => {
            settingsEntryLookup![entry.tab] = entry;
        });
    }
    return settingsEntryLookup[key];
};
