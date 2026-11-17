/**
 * The Assistant settings tab lists every group admins can switch, with the same
 * out-of-the-box defaults as the backend registry (ai_service
 * app/services/assistant_tool_registry.py — default_roles).
 */
import { describe, expect, it } from 'vitest';
import copy from '../../../../public/locales/en/settingsAssistantTools.json';
import {
    ASSISTANT_TOOL_CATALOG,
    NON_LEARNER_SYSTEM_ROLES,
    defaultAssistantToolsSetting,
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
});
