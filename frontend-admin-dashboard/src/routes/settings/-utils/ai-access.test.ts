import { describe, expect, it } from 'vitest';
import en from '../../../../public/locales/en/settingsAiAccess.json';
import hi from '../../../../public/locales/hi/settingsAiAccess.json';
import fr from '../../../../public/locales/fr/settingsAiAccess.json';
import ar from '../../../../public/locales/ar/settingsAiAccess.json';
import type { AccessCatalog, AssistantGroupEntry } from '../-constants/ai-access';
import type { AssistantToolsSettingData } from '../-constants/assistant-tools';
import type { McpServerSettingData, McpToolCatalogEntry } from '../-constants/mcp-server';
import { SettingsTabs } from '../-constants/terms';
import { groupToolsByArea } from '../-components/McpToolAccessList';
import {
    assistantAreaLevel,
    assistantLevels,
    buildAccessAreas,
    mergeAssistantSettingForSave,
    mergeKeyList,
    mergeMcpSettingForSave,
    normalizeAssistantSetting,
    withAssistantAreaLevel,
} from './ai-access';
import { SETTINGS_TAB_FEATURES } from './settings-entitlements';
import { canonicalSettingsTab, validateSettingsSearch } from './settings-tab-aliases';

const tool = (over: Partial<McpToolCatalogEntry> & { key: string }): McpToolCatalogEntry => ({
    name: over.key,
    label: over.key,
    description: '',
    mode: over.level === 'edit' ? 'WRITE' : 'READ',
    level: 'view',
    ...over,
});

const group = (over: Partial<AssistantGroupEntry> & { key: string; area: string }) =>
    ({
        label: over.key,
        mode: over.level === 'edit' ? 'WRITE' : 'READ',
        level: 'view',
        ...over,
    }) as AssistantGroupEntry;

const catalog: AccessCatalog = {
    areas: [
        { key: 'identity', label: 'Who is connected', summary: '', order: 0 },
        { key: 'website', label: 'Website', summary: 'Pages', order: 3 },
        { key: 'blog', label: 'Blog', summary: 'Posts', order: 6 },
        { key: 'learners', label: 'Learners', summary: 'Find learners', order: 8 },
        { key: 'announcements', label: 'Announcements', summary: '', order: 14 },
        { key: 'crm_leads', label: 'CRM: Leads', summary: '', order: 16 },
    ],
    mcp_tools: [
        tool({ key: 'identity', area: 'identity', always_on: true }),
        tool({ key: 'website_builder', area: 'website' }),
        tool({ key: 'website_builder_edits', area: 'website', level: 'edit', risk: 'drafts' }),
        tool({ key: 'blog', area: 'blog' }),
        tool({ key: 'learners', area: 'learners' }),
        tool({ key: 'announcements', area: 'announcements' }),
        tool({ key: 'crm_leads', area: 'crm_leads', entitled: false }),
    ],
    assistant_groups: [
        group({ key: 'identity', area: 'identity', always_on: true }),
        group({ key: 'website_builder', area: 'website' }),
        group({ key: 'website_builder_edits', area: 'website', level: 'edit' }),
        group({ key: 'learner_data', area: 'learners' }),
        group({ key: 'learner_edits', area: 'learners', level: 'edit' }),
        group({ key: 'announcements', area: 'announcements', level: 'edit' }),
        group({ key: 'crm_leads', area: 'crm_leads', entitled: false }),
    ],
    assistant_default_setting: {
        enabled_tools: ['search_help_knowledge'],
        role_overrides: { ADMIN: { enabled_tools: ['learner_data', 'blog'] } },
    },
};

describe('AI access: one row per area, both sides', () => {
    const areas = buildAccessAreas(catalog);
    const row = (key: string) => areas.find((a) => a.key === key)!;

    it('places each assistant group in the same area as the MCP tools, in display order', () => {
        expect(areas.map((a) => a.key)).toEqual([
            'identity',
            'website',
            'blog',
            'learners',
            'announcements',
            'crm_leads',
        ]);
        expect(row('website').assistant?.views.map((g) => g.key)).toEqual(['website_builder']);
        expect(row('website').assistant?.edits.map((g) => g.key)).toEqual([
            'website_builder_edits',
        ]);
        expect(row('website').mcp?.view?.key).toBe('website_builder');
        expect(row('learners').assistant?.views.map((g) => g.key)).toEqual(['learner_data']);
    });

    it('says when a side offers nothing in an area, and shows always-on areas as such', () => {
        expect(row('blog').assistant).toBeNull();
        expect(row('blog').assistantOutsidePlan).toBe(false);
        expect(row('identity').assistant?.alwaysOn).toBe(true);
        expect(row('identity').mcp?.alwaysOn).toBe(true);
    });

    it('leaves what the plan does not include out of the rows and flags the side', () => {
        expect(row('crm_leads').assistant).toBeNull();
        expect(row('crm_leads').assistantOutsidePlan).toBe(true);
        expect(row('crm_leads').mcp).toBeNull();
        expect(row('crm_leads').mcpOutsidePlan).toBe(true);
        // The dashboard's own capability catalogue can also leave a group out.
        const noLearners = buildAccessAreas(catalog, (key) => key !== 'learner_data');
        const learners = noLearners.find((a) => a.key === 'learners')!;
        expect(learners.assistant?.views).toEqual([]);
        expect(learners.assistant?.edits.map((g) => g.key)).toEqual(['learner_edits']);
    });

    it('gives the assistant side Off / View / Edit, or Off / Edit when it only proposes changes', () => {
        const website = row('website').assistant!;
        expect(assistantLevels(website)).toEqual(['off', 'view', 'edit']);
        expect(assistantLevels(row('announcements').assistant!)).toEqual(['off', 'edit']);
        expect(assistantAreaLevel(website, [])).toBe('off');
        const edit = withAssistantAreaLevel(website, 'edit', ['other']);
        expect(edit.sort()).toEqual(['other', 'website_builder', 'website_builder_edits']);
        expect(assistantAreaLevel(website, edit)).toBe('edit');
        expect(withAssistantAreaLevel(website, 'view', edit).sort()).toEqual([
            'other',
            'website_builder',
        ]);
        expect(withAssistantAreaLevel(website, 'off', edit)).toEqual(['other']);
    });
});

describe('AI access: saving changes only what the screen changed', () => {
    const assistantBase: AssistantToolsSettingData = {
        enabled_tools: ['search_help_knowledge'],
        role_overrides: {
            ADMIN: { enabled_tools: ['learner_data'] },
            TEACHER: { enabled_tools: ['schedule'] },
        },
    };

    it('keeps unknown keys, unknown groups and role fields of the stored assistant setting', () => {
        const stored = {
            enabled_tools: ['search_help_knowledge', 'blog', 7],
            role_overrides: {
                ADMIN: { enabled_tools: ['learner_data', 'courses'], note: 'kept' },
                TEACHER: { enabled_tools: ['schedule'] },
                'CUSTOM ROLE': { enabled_tools: ['payments'] },
            },
            version: 3,
            future_option: { nested: true },
        };
        const mine: AssistantToolsSettingData = {
            enabled_tools: ['search_help_knowledge', 'institute_overview'],
            role_overrides: { ADMIN: { enabled_tools: ['learner_data', 'payments'] } },
        };
        const saved = mergeAssistantSettingForSave(stored, assistantBase, mine);
        expect(saved.version).toBe(3);
        expect(saved.future_option).toEqual({ nested: true });
        expect(saved.enabled_tools).toEqual([
            'search_help_knowledge',
            'blog',
            7,
            'institute_overview',
        ]);
        expect(saved.role_overrides).toEqual({
            ADMIN: { enabled_tools: ['learner_data', 'courses', 'payments'], note: 'kept' },
            'CUSTOM ROLE': { enabled_tools: ['payments'] },
        });
    });

    it('leaves values saved meanwhile by someone else in place', () => {
        // Someone else switched on "workflows" for everyone and changed TEACHER after this screen loaded.
        const latest = {
            enabled_tools: ['search_help_knowledge', 'workflows'],
            role_overrides: {
                ADMIN: { enabled_tools: ['learner_data'] },
                TEACHER: { enabled_tools: ['schedule', 'assessments'] },
            },
        };
        const mine: AssistantToolsSettingData = {
            ...assistantBase,
            role_overrides: { ...assistantBase.role_overrides, ADMIN: { enabled_tools: [] } },
        };
        const saved = mergeAssistantSettingForSave(latest, assistantBase, mine);
        expect(saved.enabled_tools).toEqual(['search_help_knowledge', 'workflows']);
        expect(saved.role_overrides).toEqual({
            ADMIN: { enabled_tools: [] },
            TEACHER: { enabled_tools: ['schedule', 'assessments'] },
        });
    });

    it('returns the stored value untouched when nothing changed', () => {
        const stored = {
            enabled_tools: ['a'],
            role_overrides: { X: { enabled_tools: [] } },
            extra: 1,
        };
        const base = normalizeAssistantSetting(stored, catalog.assistant_default_setting);
        expect(mergeAssistantSettingForSave(stored, base, base)).toEqual(stored);
    });

    it('a first save starts from the defaults the screen showed', () => {
        const base = normalizeAssistantSetting(null, catalog.assistant_default_setting);
        expect(base).toEqual(catalog.assistant_default_setting);
        const mine = { ...base, enabled_tools: [...base.enabled_tools, 'payments'] };
        expect(mergeAssistantSettingForSave(null, base, mine)).toEqual({
            enabled_tools: ['search_help_knowledge', 'payments'],
            role_overrides: { ADMIN: { enabled_tools: ['learner_data', 'blog'] } },
        });
    });

    const mcpAreas = groupToolsByArea(catalog.mcp_tools);
    const mcpBase: McpServerSettingData = {
        enabled: false,
        allowed_roles: ['ADMIN'],
        enabled_tools: ['blog'],
        role_overrides: {},
    };

    it('keeps unknown keys of the stored MCP setting and writes only what changed', () => {
        const stored = {
            enabled: false,
            allowed_roles: ['ADMIN', 'Custom-Role'],
            enabled_tools: ['blog', 'course_edits'],
            role_overrides: { TEACHER: { enabled_tools: ['learners'], since: '2026-01-01' } },
            audit: { by: 'someone' },
        };
        const mine: McpServerSettingData = { ...mcpBase, enabled: true };
        const saved = mergeMcpSettingForSave(stored, mcpBase, mine, mcpAreas);
        expect(saved).toEqual({ ...stored, enabled: true });
    });

    it('gives each edit it writes its view, and drops a removed role with its list', () => {
        const base: McpServerSettingData = {
            ...mcpBase,
            allowed_roles: ['ADMIN', 'TEACHER'],
            role_overrides: { TEACHER: { enabled_tools: ['learners'] } },
        };
        const mine: McpServerSettingData = {
            ...base,
            allowed_roles: ['ADMIN'],
            enabled_tools: ['blog', 'website_builder_edits'],
            role_overrides: {},
        };
        const stored = {
            ...base,
            role_overrides: { TEACHER: { enabled_tools: ['learners'] } },
            extra: true,
        };
        const saved = mergeMcpSettingForSave(stored, base, mine, mcpAreas);
        expect(saved.allowed_roles).toEqual(['ADMIN']);
        expect(saved.role_overrides).toEqual({});
        expect([...(saved.enabled_tools as string[])].sort()).toEqual([
            'blog',
            'website_builder',
            'website_builder_edits',
        ]);
        expect(saved.extra).toBe(true);
    });

    it('merges a list: removes what was removed, adds what was added, keeps the rest', () => {
        expect(mergeKeyList(['x', 'a', 'b'], ['a', 'b'], ['b', 'c'])).toEqual(['x', 'b', 'c']);
        expect(mergeKeyList(undefined, ['a'], ['a', 'b'])).toEqual(['a', 'b']);
    });
});

describe('AI access: old links', () => {
    it('opens the AI access screen for the two tab ids it replaced', () => {
        expect(validateSettingsSearch({ selectedTab: 'assistantTools' })).toEqual({
            selectedTab: 'aiAccess',
        });
        expect(validateSettingsSearch({ selectedTab: 'mcpServer' })).toEqual({
            selectedTab: 'aiAccess',
        });
        expect(canonicalSettingsTab('payment')).toBe('payment');
        expect(validateSettingsSearch({})).toEqual({ selectedTab: 'tab' });
        expect(canonicalSettingsTab('toString')).toBe('toString');
    });

    it('lists one AI access screen and neither of the old ones', () => {
        const tabs = Object.keys(SETTINGS_TAB_FEATURES);
        expect(tabs).toContain(SettingsTabs.AiAccess);
        expect(tabs).not.toContain('assistantTools');
        expect(tabs).not.toContain('mcpServer');
    });
});

describe('AI access: copy', () => {
    const keysOf = (obj: unknown, prefix = ''): string[] =>
        obj && typeof obj === 'object'
            ? Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
                  keysOf(v, prefix ? `${prefix}.${k}` : k)
              )
            : [prefix];

    it('every language has every string', () => {
        const expected = keysOf(en).sort();
        for (const [lng, locale] of Object.entries({ hi, fr, ar })) {
            expect(keysOf(locale).sort(), lng).toEqual(expected);
            for (const key of expected) {
                const value = key
                    .split('.')
                    .reduce<unknown>(
                        (node, part) => (node as Record<string, unknown>)[part],
                        locale
                    );
                expect(typeof value === 'string' && value.length > 0, `${lng} ${key}`).toBe(true);
            }
        }
    });

    it('keeps the placeholders of every string', () => {
        const placeholders = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort();
        for (const key of keysOf(en)) {
            const get = (locale: unknown) =>
                key
                    .split('.')
                    .reduce<unknown>((n, p) => (n as Record<string, unknown>)[p], locale) as string;
            for (const locale of [hi, fr, ar]) {
                expect(placeholders(get(locale)), key).toEqual(placeholders(get(en)));
            }
        }
    });
});
