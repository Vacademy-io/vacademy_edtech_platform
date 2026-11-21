/**
 * Settings → AI access — the catalogue the screen renders.
 *
 * Served by ai_service (`/mcp/oauth/access-catalog`), like the MCP tool
 * catalogue, so the dashboard keeps no list of capabilities of its own: each
 * area (Website, Courses, …) with the in-product assistant's settings groups
 * and the MCP tools placed in it.
 */
import type { AssistantToolsSettingData } from './assistant-tools';
import type { McpToolCatalogEntry } from './mcp-server';

/** One row of the screen, in display order. */
export interface AccessAreaInfo {
    key: string;
    label: string;
    summary: string;
    order: number;
}

/** One in-product assistant settings group, as the backend registry describes it. */
export interface AssistantGroupEntry {
    /** Settings group key the switches write, e.g. "learner_data". */
    key: string;
    /** English name from the registry; the screen prefers its translation. */
    label: string;
    tools?: string[];
    mode: 'READ' | 'WRITE';
    /** Not a switch: on for everyone (identity). */
    always_on?: boolean;
    /** On for every role while the institute has never saved the setting. */
    default_enabled?: boolean;
    /** On for these roles while the institute has never saved the setting. */
    default_roles?: string[];
    module_feature?: string | null;
    area: string;
    area_label?: string;
    area_order?: number;
    /** "view" reads; "edit" proposes changes the user confirms in the assistant. */
    level: 'view' | 'edit';
    /**
     * Turned on one by one (changes to live data, enrolments, sending): never
     * switched on by the area's Edit level or a preset. Follows the MCP opt-in groups.
     */
    opt_in?: boolean;
    /** False when the institute's plan leaves the group out. */
    entitled?: boolean;
}

export interface AccessCatalog {
    areas: AccessAreaInfo[];
    mcp_tools: McpToolCatalogEntry[];
    assistant_groups: AssistantGroupEntry[];
    /** What the assistant allows before the institute first saves its setting. */
    assistant_default_setting: AssistantToolsSettingData;
}

/** Human name stored alongside the assistant payload by the generic settings endpoint. */
export const ASSISTANT_TOOLS_SETTING_NAME = 'Vacademy Assistant Tools';
