/**
 * MCP server settings — shared types and defaults.
 *
 * The tool CATALOGUE deliberately lives on the backend (ai_service exposes it at
 * /mcp/oauth/connection-info), because the list is derived from the Assistant
 * tool registry. Keeping a second copy here would let the two drift and show
 * admins toggles for tools the server does not actually expose.
 *
 * Stored under the institute-settings key MCP_SERVER_SETTING. The shape matches
 * what ai_service app/mcp/access.py normalizes and what the Assistant tool gate
 * consumes, so the same per-tool gating code serves both surfaces.
 */
import { NON_LEARNER_SYSTEM_ROLES } from './assistant-tools';

export const MCP_SERVER_SETTING_KEY = 'MCP_SERVER_SETTING';

/** Human name stored alongside the payload by the generic settings endpoint. */
export const MCP_SERVER_SETTING_NAME = 'MCP Server';

/** Roles that must never be offered: the MCP surface is staff-only. */
export const MCP_LEARNER_ROLE_NAMES = new Set(['STUDENT', 'LEARNER', 'PARENT']);

/** Roles offered by default. Mirrors the backend's DEFAULT_ALLOWED_ROLES. */
export const MCP_DEFAULT_ALLOWED_ROLES = ['ADMIN'];

/** Non-learner system roles, reused from the Assistant settings catalogue. */
export const MCP_SYSTEM_ROLES = NON_LEARNER_SYSTEM_ROLES;

/** One tool as the backend describes it. */
export interface McpToolCatalogEntry {
    /** Registry tool name, e.g. "get_institute_overview". */
    name: string;
    /** Settings group key that the toggles write, e.g. "institute_overview". */
    key: string;
    label: string;
    /** Model-facing description (argument lists, rules) — long. */
    description: string;
    /** One plain sentence for the settings page. */
    summary?: string;
    /** For action-style tools: the verbs the toggle allows, e.g. ["list", "get_page"]. */
    actions?: string[];
    mode: 'READ' | 'WRITE';
    /** Not a toggle: on for everyone who may connect (identity only). */
    always_on?: boolean;
    /** The settings-page row this tool belongs to, e.g. "courses". */
    area?: string;
    area_label?: string;
    area_summary?: string;
    area_order?: number;
    /** An area has one view tool and any number of edit tools (edit includes view). */
    level?: 'view' | 'edit';
    /** What an edit can touch; null for view tools. */
    risk?: McpToolRisk | null;
    /** The edit's own name when its area has several. */
    sub_label?: string | null;
    /**
     * Turned on one by one (e.g. website publishing): never switched on by the
     * area's Edit level or the "Turn everything on" preset.
     */
    opt_in?: boolean;
}

/**
 * drafts: nothing goes live · additive: only adds · not_live: courses not live yet ·
 * live_additive: only adds, but to live records (new folders / pages start hidden or draft; tags on live
 * courses and courses added to an active store page show at once), never turned on by the area's Edit
 * level · live: learners see it at once · outbound: calls or messages leads, or sends them invites; always
 * turned on one by one (never by the area's Edit level, a preset or the first Enable).
 */
export type McpToolRisk =
    | 'drafts'
    | 'additive'
    | 'not_live'
    | 'live_additive'
    | 'live'
    | 'outbound';

export interface McpManualClient {
    client_id: string;
    client_name?: string | null;
    redirect_uris: string[];
    created_at?: string | null;
    /**
     * The client every institute gets automatically. Shown as "your client ID";
     * the backend refuses to delete it, so the UI offers no Remove for it.
     */
    is_primary?: boolean;
}

export interface McpConnection {
    pair_id: string;
    client_id: string;
    client_name?: string | null;
    user_id: string;
    username?: string | null;
    created_at?: string | null;
    last_used_at?: string | null;
}

export interface McpConnectionInfo {
    /** Institute-scoped URL to paste into an AI app (…/mcp/i/<institute>): the
     *  OAuth consent then lands on this institute's own admin portal. */
    server_url: string;
    /** The bare, institute-less endpoint (platform dashboard + institute picker). */
    legacy_server_url?: string;
    /** This institute's admin portal origin (white-label aware). */
    admin_portal_url?: string;
    issuer: string;
    scope: string;
    tools: McpToolCatalogEntry[];
    manual_clients: McpManualClient[];
    connections: McpConnection[];
}

export interface McpServerSettingData {
    /** Master switch. Off until an admin turns it on. */
    enabled: boolean;
    /** Roles allowed to connect an AI client. Learner roles are stripped server-side. */
    allowed_roles: string[];
    /** Tool group keys enabled for everyone who may connect. */
    enabled_tools: string[];
    /** Extra tool groups granted to specific roles, on top of enabled_tools. */
    role_overrides: Record<string, { enabled_tools: string[] }>;
}

export function defaultMcpServerSetting(): McpServerSettingData {
    return {
        enabled: false,
        allowed_roles: [...MCP_DEFAULT_ALLOWED_ROLES],
        enabled_tools: [],
        role_overrides: {},
    };
}

/** Coerce whatever is stored (or nothing at all) into a complete setting. */
export function mergeMcpSettingWithDefaults(
    raw: Partial<McpServerSettingData> | null | undefined
): McpServerSettingData {
    const base = defaultMcpServerSetting();
    if (!raw) return base;
    return {
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
        allowed_roles: Array.isArray(raw.allowed_roles)
            ? raw.allowed_roles.filter((r) => !MCP_LEARNER_ROLE_NAMES.has(String(r).toUpperCase()))
            : base.allowed_roles,
        enabled_tools: Array.isArray(raw.enabled_tools) ? raw.enabled_tools : base.enabled_tools,
        role_overrides:
            raw.role_overrides && typeof raw.role_overrides === 'object' ? raw.role_overrides : {},
    };
}
