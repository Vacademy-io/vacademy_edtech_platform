// Vacademy Assistant — settings shapes shared by Settings → AI access.
//
// The list of assistant capabilities is NOT kept here: ai_service serves it with
// the MCP tools, area by area (see ./ai-access.ts), from its tool registry
// (app/services/assistant_tool_registry.py, placed by app/mcp/constants.py
// ASSISTANT_GROUP_PLACEMENT), so the screen never shows a switch the assistant
// does not have.

export const ASSISTANT_TOOLS_SETTING_KEY = 'ASSISTANT_TOOLS_SETTING';

/** One-click role presets for the settings screen — sensible grants per role. */
export const ASSISTANT_ROLE_PRESETS: Array<{
    role: string;
    label: string;
    tools: string[];
}> = [
    {
        role: 'TEACHER',
        label: 'Teachers: learner data + schedule + assessments',
        tools: ['learner_data', 'schedule', 'assessments'],
    },
    {
        role: 'EVALUATOR',
        label: 'Evaluators: learner data + assessments',
        tools: ['learner_data', 'assessments'],
    },
];

// Non-learner system roles, by their JWT role-name. Custom roles are appended at
// runtime from getAllRoles(). Keys here must match the role names the backend
// reads from the JWT authorities map.
export const NON_LEARNER_SYSTEM_ROLES = [
    'ADMIN',
    'TEACHER',
    'EVALUATOR',
    'CONTENT CREATOR',
    'ASSESSMENT CREATOR',
    'COUNSELLOR',
];

export interface AssistantToolsSettingData {
    /** Tools enabled for everyone in the institute. */
    enabled_tools: string[];
    /** Per-role grants ADDED on top of `enabled_tools` (keyed by JWT role name). */
    role_overrides: Record<string, { enabled_tools: string[] }>;
}
