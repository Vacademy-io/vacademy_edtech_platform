/**
 * MCP server settings API.
 *
 * Two backends are involved, deliberately:
 *   - the institute setting (enabled / roles / tools) is stored through the
 *     generic admin-core settings endpoint, like every other settings tab;
 *   - everything operational (server URL, tool catalogue, OAuth client ids,
 *     live connections) comes from ai_service, which owns the MCP server.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_INSITITUTE_SETTINGS,
    MCP_CONNECTION_INFO,
    MCP_CONNECTION_REVOKE,
    MCP_MANUAL_CLIENT,
    MCP_MANUAL_CLIENT_DELETE,
} from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    MCP_SERVER_SETTING_KEY,
    MCP_SERVER_SETTING_NAME,
    mergeMcpSettingWithDefaults,
    type McpConnectionInfo,
    type McpManualClient,
    type McpServerSettingData,
} from '../-constants/mcp-server';

const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

export async function fetchMcpSettings(): Promise<McpServerSettingData> {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: MCP_SERVER_SETTING_KEY },
    });
    // `/get` returns a SettingDto shape: { key, name, data }.
    return mergeMcpSettingWithDefaults(response.data?.data ?? null);
}

export async function saveMcpSettings(data: McpServerSettingData): Promise<void> {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: MCP_SERVER_SETTING_NAME, setting_data: data },
        { params: { instituteId, settingKey: MCP_SERVER_SETTING_KEY } }
    );
}

export async function fetchMcpConnectionInfo(): Promise<McpConnectionInfo> {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: MCP_CONNECTION_INFO,
        // This page keeps opt-in groups (publishing, live data edits) out of its presets,
        // so it may see them; older bundles never ask and never get them.
        params: { opt_in: 1 },
    });
    return response.data as McpConnectionInfo;
}

export async function createMcpManualClient(payload: {
    client_name: string;
    redirect_uris: string[];
}): Promise<McpManualClient> {
    const response = await authenticatedAxiosInstance.post(MCP_MANUAL_CLIENT, payload);
    return response.data as McpManualClient;
}

export async function deleteMcpManualClient(clientId: string): Promise<void> {
    await authenticatedAxiosInstance.delete(MCP_MANUAL_CLIENT_DELETE(clientId));
}

export async function revokeMcpConnection(pairId: string): Promise<void> {
    await authenticatedAxiosInstance.delete(MCP_CONNECTION_REVOKE(pairId));
}
