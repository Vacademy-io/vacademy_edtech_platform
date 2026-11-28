/**
 * MCP server settings API.
 *
 * Two backends are involved, deliberately:
 *   - the institute setting (enabled / roles / tools) is stored through the
 *     generic admin-core settings endpoint (read and saved by ai-access-service.ts,
 *     which merges a save into the latest stored value);
 *   - everything operational (server URL, tool catalogue, OAuth client ids,
 *     live connections) comes from ai_service, which owns the MCP server.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    MCP_CONNECTION_INFO,
    MCP_CONNECTION_REVOKE,
    MCP_MANUAL_CLIENT,
    MCP_MANUAL_CLIENT_DELETE,
} from '@/constants/urls';
import type { McpConnectionInfo, McpManualClient } from '../-constants/mcp-server';

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
