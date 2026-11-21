/**
 * Settings → AI access API.
 *
 * The catalogue comes from ai_service; both settings (the assistant's and the
 * MCP server's) are stored through the generic admin-core settings endpoint.
 *
 * Saving never writes the screen's copy over the stored value: it reads the
 * latest stored value first and applies only what the screen changed (see
 * mergeAssistantSettingForSave / mergeMcpSettingForSave), so other keys and
 * values saved meanwhile are kept.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_ACCESS_CATALOG, GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { ASSISTANT_TOOLS_SETTING_NAME, type AccessCatalog } from '../-constants/ai-access';
import {
    ASSISTANT_TOOLS_SETTING_KEY,
    type AssistantToolsSettingData,
} from '../-constants/assistant-tools';
import {
    MCP_SERVER_SETTING_KEY,
    MCP_SERVER_SETTING_NAME,
    type McpServerSettingData,
} from '../-constants/mcp-server';
import type { McpToolArea } from '../-components/McpToolAccessList';
import { mergeAssistantSettingForSave, mergeMcpSettingForSave } from '../-utils/ai-access';

const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

export async function fetchAccessCatalog(): Promise<AccessCatalog> {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: AI_ACCESS_CATALOG,
        // This screen keeps opt-in groups (publishing, live data edits) out of its presets.
        params: { opt_in: 1 },
    });
    return response.data as AccessCatalog;
}

/** The stored `data` of one institute setting, exactly as saved (null when never saved). */
export async function fetchSettingData(settingKey: string): Promise<unknown> {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey },
    });
    // `/get` returns a SettingDto shape: { key, name, data }.
    return response.data?.data ?? null;
}

async function saveSettingData(settingKey: string, settingName: string, data: unknown) {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: settingName, setting_data: data },
        { params: { instituteId, settingKey } }
    );
}

/** Saves the assistant setting: the latest stored value plus this screen's changes. */
export async function saveAssistantSettingMerged(
    base: AssistantToolsSettingData,
    mine: AssistantToolsSettingData
): Promise<void> {
    const latest = await fetchSettingData(ASSISTANT_TOOLS_SETTING_KEY);
    await saveSettingData(
        ASSISTANT_TOOLS_SETTING_KEY,
        ASSISTANT_TOOLS_SETTING_NAME,
        mergeAssistantSettingForSave(latest, base, mine)
    );
}

/** Saves the MCP setting the same way. */
export async function saveMcpSettingMerged(
    base: McpServerSettingData,
    mine: McpServerSettingData,
    areas: McpToolArea[]
): Promise<void> {
    const latest = await fetchSettingData(MCP_SERVER_SETTING_KEY);
    await saveSettingData(
        MCP_SERVER_SETTING_KEY,
        MCP_SERVER_SETTING_NAME,
        mergeMcpSettingForSave(latest, base, mine, areas)
    );
}
