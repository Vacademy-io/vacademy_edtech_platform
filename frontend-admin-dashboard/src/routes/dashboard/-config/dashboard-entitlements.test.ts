import { describe, expect, it } from 'vitest';
import { createEntitlement, FULL_ENTITLEMENT } from '@/lib/capabilities/entitlement';
import {
    canAllExcept,
    canForModules,
    CRM_ONLY_MODULES,
    loadRealCatalog,
} from '@/lib/capabilities/test-support';
import { quickActionsForRoles } from './dashboard-quick-actions';
import {
    GOVERNED_SETUP_STEP_IDS,
    hasEntitledSetupStep,
    isKpiEntitled,
    KPI_FEATURES,
    welcomeTextKey,
} from './dashboard-entitlements';

const catalog = loadRealCatalog();
const t = ((k: string) => k) as never;
const knownFeatures = new Set(catalog.modules.flatMap((m) => m.features.map((f) => f.key)));
const crmOnly = createEntitlement({
    catalog,
    can: canForModules(catalog, CRM_ONLY_MODULES),
    staticItems: [],
});

describe('dashboard entitlements', () => {
    it('KPI features and setup steps are real catalogue keys', () => {
        Object.values(KPI_FEATURES)
            .flat()
            .forEach((f) => expect(knownFeatures.has(f)).toBe(true));
        const steps = new Set(
            catalog.modules.flatMap((m) => m.features.flatMap((f) => f.governs.setup_steps))
        );
        expect([...GOVERNED_SETUP_STEP_IDS].sort()).toEqual([...steps].sort());
    });

    it('every quick action id is governed by the catalogue', () => {
        const governed = new Set(
            catalog.modules.flatMap((m) => m.features.flatMap((f) => f.governs.quick_actions))
        );
        const roles = ['ADMIN', 'TEACHER', 'CONTENT CREATOR', 'ASSESSMENT CREATOR', 'EVALUATOR'];
        roles
            .flatMap((r) => quickActionsForRoles([r], t))
            .forEach((a) => expect(governed.has(a.id)).toBe(true));
    });

    it('LEGACY: every KPI card, setup step and quick action is entitled', () => {
        [
            'activeLearners',
            'totalCourses',
            'teamMembers',
            'outstandingFees',
            'overdueFees',
            'classesToday',
        ].forEach((id) => expect(isKpiEntitled(id, FULL_ENTITLEMENT)).toBe(true));
        expect(hasEntitledSetupStep(FULL_ENTITLEMENT)).toBe(true);
        quickActionsForRoles(['ADMIN'], t).forEach((a) =>
            expect(FULL_ENTITLEMENT.isQuickActionEntitled(a.id)).toBe(true)
        );
    });

    it('CRM-only: no LMS checklist (not "fresh"), no LMS KPI cards or quick actions', () => {
        expect(hasEntitledSetupStep(crmOnly)).toBe(false);
        expect(isKpiEntitled('activeLearners', crmOnly)).toBe(false);
        expect(isKpiEntitled('totalCourses', crmOnly)).toBe(false);
        expect(isKpiEntitled('classesToday', crmOnly)).toBe(false);
        expect(isKpiEntitled('outstandingFees', crmOnly)).toBe(true);
        expect(isKpiEntitled('teamMembers', crmOnly)).toBe(true);
        expect(
            quickActionsForRoles(['ADMIN'], t)
                .filter((a) => crmOnly.isQuickActionEntitled(a.id))
                .map((a) => a.id)
        ).toEqual(['announce', 'collect-payment']);
    });

    it('finance off: fee cards go, the rest stay', () => {
        const e = createEntitlement({
            catalog,
            can: canAllExcept(['finance.fees']),
            staticItems: [],
        });
        expect(isKpiEntitled('outstandingFees', e)).toBe(false);
        expect(isKpiEntitled('overdueFees', e)).toBe(false);
        expect(isKpiEntitled('activeLearners', e)).toBe(true);
        expect(hasEntitledSetupStep(e)).toBe(true);
    });

    it('welcome line: neutral copy only for a MANAGED plan without LMS', () => {
        expect(welcomeTextKey(FULL_ENTITLEMENT)).toBe('welcomeVideo.text');
        expect(welcomeTextKey(crmOnly)).toBe('welcomeVideo.textGeneral');
        expect(
            welcomeTextKey(createEntitlement({ catalog, can: () => true, staticItems: [] }))
        ).toBe('welcomeVideo.text');
    });
});
