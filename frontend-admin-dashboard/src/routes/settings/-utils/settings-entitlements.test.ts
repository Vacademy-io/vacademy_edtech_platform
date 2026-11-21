import { describe, expect, it } from 'vitest';
import { createEntitlement, FULL_ENTITLEMENT } from '@/lib/capabilities/entitlement';
import { canAllExcept, canForModules, loadRealCatalog } from '@/lib/capabilities/test-support';
import {
    filterSettingsTabs,
    isSettingsTabEntitled,
    resolveSettingsTab,
    SETTINGS_FEATURE_FAMILIES,
    SETTINGS_TAB_FEATURES,
} from './settings-entitlements';

const catalog = loadRealCatalog();
const knownFeatures = new Set(catalog.modules.flatMap((m) => m.features.map((f) => f.key)));
// Every screen key ('tab' is the bare rail icon's sentinel, never a screen).
const allTabs = Object.keys(SETTINGS_TAB_FEATURES)
    .filter((tab) => tab !== 'tab')
    .map((tab) => ({ tab }));

/** The QA institute: core, crm, communications, automation, website on; everything else off. */
const crmOnly = createEntitlement({
    catalog,
    can: canForModules(catalog, ['crm', 'communications', 'automation', 'website']),
    staticItems: [],
});

const shown = (e: Parameters<typeof filterSettingsTabs>[1]) =>
    new Set(filterSettingsTabs(allTabs, e).map((t) => t.tab));

describe('settings screens by plan', () => {
    it('uses real catalogue features; each family lists every feature of its modules', () => {
        Object.values(SETTINGS_TAB_FEATURES).forEach((features) =>
            (features ?? []).forEach((f) => expect(knownFeatures.has(f), f).toBe(true))
        );
        Object.values(SETTINGS_FEATURE_FAMILIES).forEach(({ modules, features }) => {
            const expected = catalog.modules
                .filter((m) => (modules as readonly string[]).includes(m.key))
                .flatMap((m) => m.features.map((f) => f.key));
            expect([...features].sort()).toEqual(expected.sort());
        });
    });

    it('LEGACY: every screen, the list itself', () => {
        expect(filterSettingsTabs(allTabs, FULL_ENTITLEMENT)).toBe(allTabs);
        allTabs.forEach(({ tab }) =>
            expect(isSettingsTabEntitled(tab, FULL_ENTITLEMENT)).toBe(true)
        );
    });

    it('MANAGED with everything on hides nothing', () => {
        const all = createEntitlement({ catalog, can: () => true, staticItems: [] });
        expect(shown(all).size).toBe(allTabs.length);
    });

    it('CRM-only: no LMS or Finances screens; General, CRM, Calling, Communications, Integrations stay', () => {
        const tabs = shown(crmOnly);
        // LMS
        [
            'course',
            'lms',
            'assessment',
            'certificates',
            'badgesRewards',
            'engagement',
            'liveSession',
            'doubtManagement',
            'contentProtection',
            'studentDisplay',
            'learnerActivity',
            'learnerCredentials',
            'mentorship',
        ].forEach((t) => expect(tabs.has(t), t).toBe(false));
        // Finances
        ['payment', 'paymentGateways', 'invoice', 'coupons'].forEach((t) =>
            expect(tabs.has(t), t).toBe(false)
        );
        // Kept
        [
            'roleDisplay',
            'appearance',
            'naming',
            'customFields',
            'aiSettings',
            'leadSettings',
            'referral',
            'schoolSettings',
            'guardianSettings',
            'onboardingSettings',
            'telephony',
            'aiCalling',
            'crmIntelligence',
            'whatsapp',
            'templates',
            'automations',
            'notification',
            'integrations',
            'youtube',
            'gtmSettings',
            'utmSettings',
        ].forEach((t) => expect(tabs.has(t), t).toBe(true));
    });

    it('calling screens follow crm.calling / crm.ai_calling', () => {
        const noCalling = createEntitlement({
            catalog,
            can: canAllExcept(['crm.calling', 'crm.ai_calling', 'crm.call_intelligence']),
            staticItems: [],
        });
        const tabs = shown(noCalling);
        ['telephony', 'aiCalling', 'crmIntelligence'].forEach((t) =>
            expect(tabs.has(t)).toBe(false)
        );
        expect(tabs.has('leadSettings')).toBe(true);
        // AI calling alone still needs the telephony provider screen.
        const aiOnly = createEntitlement({
            catalog,
            can: canAllExcept(['crm.calling']),
            staticItems: [],
        });
        expect(shown(aiOnly).has('telephony')).toBe(true);
    });

    it('a deep link to a hidden screen falls back to Display Settings, else the first shown', () => {
        const visible = filterSettingsTabs(allTabs, crmOnly);
        expect(resolveSettingsTab('payment', visible)?.tab).toBe('roleDisplay');
        expect(resolveSettingsTab('course', visible)?.tab).toBe('roleDisplay');
        expect(resolveSettingsTab('tab', visible)?.tab).toBe('roleDisplay');
        expect(resolveSettingsTab('leadSettings', visible)?.tab).toBe('leadSettings');
        expect(resolveSettingsTab('payment', [{ tab: 'naming' }, { tab: 'security' }])?.tab).toBe(
            'naming'
        );
        expect(resolveSettingsTab('payment', [])).toBeUndefined();
    });

    it('unknown screen keys are never hidden', () => {
        expect(isSettingsTabEntitled('some-future-tab', crmOnly)).toBe(true);
    });
});
