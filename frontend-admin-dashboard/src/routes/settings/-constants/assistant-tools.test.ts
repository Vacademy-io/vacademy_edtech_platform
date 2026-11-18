/**
 * The assistant's settings copy. The list of groups itself comes from ai_service
 * (Settings → AI access catalogue); the dashboard keeps only their translations.
 */
import { describe, expect, it } from 'vitest';
import copy from '../../../../public/locales/en/settingsAssistantTools.json';
import hiCopy from '../../../../public/locales/hi/settingsAssistantTools.json';
import frCopy from '../../../../public/locales/fr/settingsAssistantTools.json';
import arCopy from '../../../../public/locales/ar/settingsAssistantTools.json';
import { ASSISTANT_ROLE_PRESETS, NON_LEARNER_SYSTEM_ROLES } from './assistant-tools';

const CRM_READ_GROUPS = [
    'crm_leads',
    'crm_calls',
    'crm_meetings',
    'crm_messages',
    'crm_reports',
    'crm_collections',
];

type ToolCopy = Record<string, { label?: string; description?: string }>;

describe('Assistant settings copy', () => {
    it('lets admins customise the counsellor role', () => {
        expect(NON_LEARNER_SYSTEM_ROLES).toContain('COUNSELLOR');
    });

    it('has an English label and description for every CRM group', () => {
        const tools = copy.tools as ToolCopy;
        for (const key of CRM_READ_GROUPS) {
            expect(tools[key]?.label, key).toBeTruthy();
            expect(tools[key]?.description, key).toBeTruthy();
        }
    });

    it('translates every group the English copy names, in every language', () => {
        const keys = Object.keys(copy.tools);
        for (const [lng, locale] of Object.entries({ hi: hiCopy, fr: frCopy, ar: arCopy })) {
            const tools = locale.tools as ToolCopy;
            for (const key of keys) {
                expect(tools[key]?.label, `${lng} ${key}`).toBeTruthy();
                expect(tools[key]?.description, `${lng} ${key}`).toBeTruthy();
            }
        }
    });

    it('suggests only groups it has copy for', () => {
        const tools = copy.tools as ToolCopy;
        for (const preset of ASSISTANT_ROLE_PRESETS) {
            for (const key of preset.tools) expect(tools[key]?.label, key).toBeTruthy();
        }
    });
});
