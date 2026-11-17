/**
 * The Assistant settings tab lists every group admins can switch, with the same
 * out-of-the-box defaults as the backend registry (ai_service
 * app/services/assistant_tool_registry.py — default_roles).
 */
import { describe, expect, it } from 'vitest';
import copy from '../../../../public/locales/en/settingsAssistantTools.json';
import hiCopy from '../../../../public/locales/hi/settingsAssistantTools.json';
import frCopy from '../../../../public/locales/fr/settingsAssistantTools.json';
import arCopy from '../../../../public/locales/ar/settingsAssistantTools.json';
import { createEntitlement, FULL_ENTITLEMENT } from '@/lib/capabilities/entitlement';
import { canAllExcept, canForModules, loadRealCatalog } from '@/lib/capabilities/test-support';
import {
    ASSISTANT_TOOL_CATALOG,
    NON_LEARNER_SYSTEM_ROLES,
    defaultAssistantToolsSetting,
    entitledAssistantTools,
} from './assistant-tools';

const CRM_READ_GROUPS = [
    'crm_leads',
    'crm_calls',
    'crm_meetings',
    'crm_messages',
    'crm_reports',
    'crm_collections',
];

describe('Assistant settings catalog', () => {
    it('lists the CRM read groups, read-only and on for admins and counsellors', () => {
        for (const key of CRM_READ_GROUPS) {
            const entry = ASSISTANT_TOOL_CATALOG.find((t) => t.key === key);
            expect(entry, key).toBeDefined();
            expect(entry?.phase).toBe(2);
            expect(entry?.defaultEnabled).toBe(false);
            expect(entry?.defaultRoles).toEqual(['ADMIN', 'COUNSELLOR', 'COUNSELOR']);
        }
    });

    it('defaults grant the CRM reads per role, never to everyone', () => {
        const setting = defaultAssistantToolsSetting();
        for (const key of CRM_READ_GROUPS) {
            expect(setting.enabled_tools).not.toContain(key);
            expect(setting.role_overrides.ADMIN?.enabled_tools).toContain(key);
            expect(setting.role_overrides.COUNSELLOR?.enabled_tools).toContain(key);
        }
        expect(setting.role_overrides.TEACHER).toBeUndefined();
    });

    it('lets admins customise the counsellor role', () => {
        expect(NON_LEARNER_SYSTEM_ROLES).toContain('COUNSELLOR');
    });

    it('has an English label and description for every CRM group', () => {
        const tools = copy.tools as Record<string, { label?: string; description?: string }>;
        for (const key of CRM_READ_GROUPS) {
            expect(tools[key]?.label, key).toBeTruthy();
            expect(tools[key]?.description, key).toBeTruthy();
        }
    });

    it('has a label and description for every group in every language', () => {
        for (const [lng, locale] of Object.entries({
            en: copy,
            hi: hiCopy,
            fr: frCopy,
            ar: arCopy,
        })) {
            const tools = locale.tools as Record<string, { label?: string; description?: string }>;
            for (const { key } of ASSISTANT_TOOL_CATALOG) {
                expect(tools[key]?.label, `${lng} ${key}`).toBeTruthy();
                expect(tools[key]?.description, `${lng} ${key}`).toBeTruthy();
            }
        }
    });
});

describe('Assistant settings and the institute plan', () => {
    const catalog = loadRealCatalog();
    const keys = (list: { key: string }[]) => list.map((t) => t.key);

    it('every assistant group in the capability catalogue is a group listed here', () => {
        const listed = new Set(keys(ASSISTANT_TOOL_CATALOG));
        const governed = catalog.modules.flatMap((m) =>
            m.features.flatMap((f) => f.governs.assistant_groups)
        );
        expect(governed.filter((g) => !listed.has(g))).toEqual([]);
        for (const key of CRM_READ_GROUPS) expect(governed, key).toContain(key);
    });

    it('lists every group when the institute is not on managed modules', () => {
        expect(keys(entitledAssistantTools(FULL_ENTITLEMENT))).toEqual(
            keys(ASSISTANT_TOOL_CATALOG)
        );
    });

    it('does not list the CRM groups for a plan without the CRM module', () => {
        const noCrm = createEntitlement({
            catalog,
            can: canForModules(catalog, ['lms', 'assessments', 'live_classes', 'finance']),
            staticItems: [],
        });
        const listed = keys(entitledAssistantTools(noCrm));
        for (const key of CRM_READ_GROUPS) expect(listed).not.toContain(key);
        expect(listed).toContain('learner_data');
        expect(listed).toContain('payments');
    });

    it('lists the CRM groups for a plan with the CRM module', () => {
        const crm = createEntitlement({
            catalog,
            can: canForModules(catalog, ['crm', 'finance']),
            staticItems: [],
        });
        const listed = keys(entitledAssistantTools(crm));
        for (const key of CRM_READ_GROUPS) expect(listed).toContain(key);
        expect(listed).not.toContain('batch_data');
    });

    it('lists the call group only while calling is on', () => {
        const noCalling = createEntitlement({
            catalog,
            can: canAllExcept(['crm.calling']),
            staticItems: [],
        });
        const listed = keys(entitledAssistantTools(noCalling));
        expect(listed).not.toContain('crm_calls');
        expect(listed).toContain('crm_leads');
    });
});
