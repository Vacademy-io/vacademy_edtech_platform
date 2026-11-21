import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ stored: {} as Record<string, unknown>, posts: [] as unknown[] }));

vi.mock('@/lib/auth/axiosInstance', () => {
    const instance = Object.assign(
        vi.fn(async (config: { params: { settingKey: string } }) => ({
            data: { data: http.stored[config.params.settingKey] ?? null },
        })),
        {
            post: vi.fn(async (_url: string, body: unknown, config: unknown) => {
                http.posts.push({ body, config });
                return { data: {} };
            }),
        }
    );
    return { default: instance };
});
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/constants/urls', () => ({
    GET_INSITITUTE_SETTINGS: '/admin-core-service/institute/setting/v1/get',
    AI_ACCESS_CATALOG: '/ai-service/mcp/oauth/access-catalog',
}));

import { saveAssistantSettingMerged, saveMcpSettingMerged } from './ai-access-service';

describe('AI access saves read the latest stored value first', () => {
    beforeEach(() => {
        http.posts.length = 0;
    });

    it('keeps keys and values the screen does not show (assistant)', async () => {
        http.stored.ASSISTANT_TOOLS_SETTING = {
            enabled_tools: ['search_help_knowledge', 'courses'],
            role_overrides: { 'CUSTOM ROLE': { enabled_tools: ['blog'] } },
            unknown_key: 'kept',
        };
        await saveAssistantSettingMerged(
            { enabled_tools: ['search_help_knowledge'], role_overrides: {} },
            { enabled_tools: ['search_help_knowledge', 'payments'], role_overrides: {} }
        );
        expect(http.posts).toEqual([
            {
                body: {
                    setting_name: 'Vacademy Assistant Tools',
                    setting_data: {
                        enabled_tools: ['search_help_knowledge', 'courses', 'payments'],
                        role_overrides: { 'CUSTOM ROLE': { enabled_tools: ['blog'] } },
                        unknown_key: 'kept',
                    },
                },
                config: {
                    params: { instituteId: 'inst-1', settingKey: 'ASSISTANT_TOOLS_SETTING' },
                },
            },
        ]);
    });

    it('keeps keys and values the screen does not show (MCP server)', async () => {
        http.stored.MCP_SERVER_SETTING = {
            enabled: true,
            allowed_roles: ['ADMIN', 'TEACHER'],
            enabled_tools: ['blog'],
            role_overrides: {},
            unknown_key: { nested: [1, 2] },
        };
        await saveMcpSettingMerged(
            {
                enabled: true,
                allowed_roles: ['ADMIN'],
                enabled_tools: ['blog'],
                role_overrides: {},
            },
            {
                enabled: false,
                allowed_roles: ['ADMIN'],
                enabled_tools: ['blog'],
                role_overrides: {},
            },
            []
        );
        expect(http.posts).toHaveLength(1);
        expect((http.posts[0] as { body: { setting_data: unknown } }).body.setting_data).toEqual({
            enabled: false,
            allowed_roles: ['ADMIN', 'TEACHER'],
            enabled_tools: ['blog'],
            role_overrides: {},
            unknown_key: { nested: [1, 2] },
        });
    });
});
