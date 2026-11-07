import { describe, expect, it } from 'vitest';
import copy from '../../../../../public/locales/en/dashboardIndex.json';
import { createEntitlement, FULL_ENTITLEMENT } from '@/lib/capabilities/entitlement';
import { canAllExcept, canForModules, loadRealCatalog } from '@/lib/capabilities/test-support';
import type { AssistantCapabilities } from '../../types';
import {
    MAX_STARTERS,
    pickStarters,
    STARTER_FEATURES,
    STARTER_PROMPT_FALLBACKS,
    STARTERS,
    starterPromptKey,
} from '../../launch-bar-starters';

const catalog = loadRealCatalog();
const knownFeatures = new Set(catalog.modules.flatMap((m) => m.features.map((f) => f.key)));

/** The QA institute: CRM-only, finance OFF. */
const crmNoFinance = createEntitlement({
    catalog,
    can: canForModules(catalog, ['crm', 'communications', 'automation', 'website']),
    staticItems: [],
});

/** Every starter's group with its tool — a full-access admin. */
const everything: AssistantCapabilities = {
    groups: STARTERS.map((s) => ({ key: s.group, mode: 'WRITE' as const, tools: [s.tool] })),
};

const keys = (list: { key: string }[]) => list.map((s) => s.key);

describe('dashboard assistant starters', () => {
    it('maps only to real catalogue features and existing copy', () => {
        Object.values(STARTER_FEATURES)
            .flat()
            .forEach((f) => expect(knownFeatures.has(f)).toBe(true));
        const starters = copy.assistant.starters as Record<string, Record<string, string>>;
        Object.entries(STARTER_PROMPT_FALLBACKS).forEach(([key, { feature, promptKey }]) => {
            expect(knownFeatures.has(feature)).toBe(true);
            expect(starters[key]?.[promptKey]).toBeTruthy();
        });
        STARTERS.forEach((s) => expect(starters[s.key]?.prompt, s.key).toBeTruthy());
    });

    it('LEGACY: unchanged — first four in task order', () => {
        expect(keys(pickStarters(everything, FULL_ENTITLEMENT))).toEqual([
            'overview',
            'learner',
            'assessments',
            'announcement',
        ]);
        expect(starterPromptKey('help', FULL_ENTITLEMENT)).toBe('assistant.starters.help.prompt');
    });

    it('CRM-only without finance: no fee, learner, evaluation, class or batch chips', () => {
        const picked = keys(pickStarters(everything, crmNoFinance));
        expect(picked).toEqual(['announcement', 'help']);
        expect(picked).not.toContain('overview'); // "Check pending fees" (generic group)
        expect(starterPromptKey('help', crmNoFinance)).toBe(
            'assistant.starters.help.promptGeneral'
        );
        expect(starterPromptKey('announcement', crmNoFinance)).toBe(
            'assistant.starters.announcement.prompt'
        );
    });

    it('backfills the freed slots from the remaining entitled starters, max four', () => {
        // Finance off only: both fee chips go, the next ones move up.
        const noFees = createEntitlement({
            catalog,
            can: canAllExcept(['finance.fees']),
            staticItems: [],
        });
        expect(keys(pickStarters(everything, noFees))).toEqual([
            'learner',
            'assessments',
            'announcement',
            'schedule',
        ]);
        // LMS + assessments off: fees first, then the rest in order.
        const noLms = createEntitlement({
            catalog,
            can: canForModules(catalog, ['crm', 'finance', 'communications', 'live_classes']),
            staticItems: [],
        });
        const picked = keys(pickStarters(everything, noLms));
        expect(picked).toEqual(['overview', 'announcement', 'schedule', 'payments']);
        expect(picked.length).toBeLessThanOrEqual(MAX_STARTERS);
    });

    it('still requires the caller to hold the tool', () => {
        expect(
            keys(
                pickStarters(
                    {
                        groups: [
                            { key: 'announcements', mode: 'READ', tools: ['list_announcements'] },
                        ],
                    },
                    FULL_ENTITLEMENT
                )
            )
        ).toEqual([]);
        expect(pickStarters(undefined, FULL_ENTITLEMENT)).toEqual([]);
    });
});
