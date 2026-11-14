// Vacademy Assistant — Settings catalog.
//
// Keep `key` values in sync with the backend registry
// (ai_service app/services/assistant_tool_registry.py :: ASSISTANT_TOOLS).
// Phase-2/3 tools are added here as they ship.

export const ASSISTANT_TOOLS_SETTING_KEY = 'ASSISTANT_TOOLS_SETTING';

export interface AssistantToolCatalogEntry {
    key: string;
    label: string;
    description: string;
    /** Roadmap phase: 1 = help/how-to, 2 = read data, 3 = write data. */
    phase: number;
    /** On out-of-the-box for every role (until an institute configures the setting). */
    defaultEnabled: boolean;
    /** On out-of-the-box for THESE roles only (mirrors the backend registry's default_roles). */
    defaultRoles?: string[];
}

export const ASSISTANT_TOOL_CATALOG: AssistantToolCatalogEntry[] = [
    {
        key: 'search_help_knowledge',
        label: 'Help & how-to guidance',
        description:
            'Answers “how do I / where do I” questions about using the portal, with step-by-step instructions.',
        phase: 1,
        defaultEnabled: true,
    },
    {
        key: 'learner_data',
        label: 'Learner data lookup',
        description:
            'Find learners by name/email/phone and answer questions about their attendance, ' +
            'assessment scores, activity, course progress and login summary — and generate their ' +
            'full analysis report. On by default for Admins; grant to other roles below.',
        phase: 2,
        defaultEnabled: false,
        defaultRoles: ['ADMIN'],
    },
    {
        key: 'payments',
        label: 'Payments & fees',
        description:
            'Answer questions about a learner’s payment history, outstanding/overdue fees, and ' +
            'payment plans. On by default for Admins.',
        phase: 2,
        defaultEnabled: false,
        defaultRoles: ['ADMIN'],
    },
    {
        key: 'batch_data',
        label: 'Batch rosters',
        description:
            'List the learners in a batch and answer batch headcount questions. On by default for Admins.',
        phase: 2,
        defaultEnabled: false,
        defaultRoles: ['ADMIN'],
    },
    {
        key: 'schedule',
        label: 'Class schedule',
        description:
            'Answer “what classes are live/upcoming” and “what do I have today” from the live-session ' +
            'schedule. On by default for Admins.',
        phase: 2,
        defaultEnabled: false,
        defaultRoles: ['ADMIN'],
    },
    {
        key: 'institute_overview',
        label: 'Institute overview',
        description:
            'Institute-wide snapshots: total overdue fees, live classes right now, active learner ' +
            'counts. On by default for Admins.',
        phase: 2,
        defaultEnabled: false,
        defaultRoles: ['ADMIN'],
    },
    {
        key: 'learner_edits',
        label: 'Learner edits (actions)',
        description:
            'Let the assistant PROPOSE changes — edit a learner’s details, extend access, move ' +
            'batch, activate/deactivate. Every change requires the user to press Confirm on a card ' +
            'before anything is applied. On by default for Admins; other roles are opt-in.',
        phase: 3,
        defaultEnabled: false,
        defaultRoles: ['ADMIN'],
    },
    {
        key: 'assessments',
        label: 'Assessment results',
        description:
            'Find assessments and answer questions about submissions, scores, pending ' +
            'evaluations, and leaderboards. On by default for Admins.',
        phase: 2,
        defaultEnabled: false,
        defaultRoles: ['ADMIN'],
    },
    {
        key: 'website_builder',
        label: 'Website: view',
        description:
            'See the institute’s websites — pages, what each section shows (which courses, which ' +
            'lead campaign), traffic, lead capture health and pre-publish checks — and run the ' +
            'interview needed before a site is generated. Read-only. On by default for Admins.',
        phase: 2,
        defaultEnabled: false,
        defaultRoles: ['ADMIN'],
    },
    {
        key: 'website_builder_edits',
        label: 'Website: edit drafts',
        description:
            'Let the assistant build and change websites by conversation — compose pages, edit ' +
            'sections, set colours and fonts, wire forms to lead campaigns. Every change is saved ' +
            'as a draft; nothing goes live until you publish it in Manage Pages. Uses no AI ' +
            'credits. Off by default.',
        phase: 3,
        defaultEnabled: false,
    },
    {
        key: 'audience_forms',
        label: 'Lead forms: view',
        description:
            'See lead campaigns (Audience Manager): their form fields, where they are used on the ' +
            'websites, leads received and recent leads. Read-only. On by default for Admins.',
        phase: 2,
        defaultEnabled: false,
        defaultRoles: ['ADMIN'],
    },
    {
        key: 'audience_forms_edits',
        label: 'Lead forms: edit',
        description:
            'Let the assistant create lead campaigns, add fields to their forms and send test leads. ' +
            'It never removes anything. Off by default.',
        phase: 3,
        defaultEnabled: false,
    },
    {
        key: 'workflows',
        label: 'Automations: view',
        description:
            'See the institute’s automations (workflows): each one’s trigger or schedule, its nodes, ' +
            'recent runs and per-node results, plus the authoring catalog and the batches, lead ' +
            'campaigns and templates an automation can reference. Read-only. On by default for Admins.',
        phase: 2,
        defaultEnabled: false,
        defaultRoles: ['ADMIN'],
    },
    {
        key: 'workflows_edits',
        label: 'Automations: draft',
        description:
            'Let the assistant build automations by conversation — compose the workflow, check it ' +
            'against the builder’s rules, save it as a DRAFT, and create the new email and WhatsApp ' +
            'templates it needs (WhatsApp templates are sent to Meta for approval). A draft never ' +
            'runs until you open it in the builder and publish it; published automations and ' +
            'existing templates cannot be changed or removed from here. Uses no AI credits. Off by ' +
            'default.',
        phase: 3,
        defaultEnabled: false,
    },
    {
        key: 'announcements',
        label: 'Announcements',
        description:
            'See planned/past announcements, and PROPOSE sending one to batches, roles, or ' +
            'specific learners — sending always requires pressing Confirm on a card. On by ' +
            'default for Admins.',
        phase: 3,
        defaultEnabled: false,
        defaultRoles: ['ADMIN'],
    },
];

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
];

export interface AssistantToolsSettingData {
    /** Tools enabled for everyone in the institute. */
    enabled_tools: string[];
    /** Per-role grants ADDED on top of `enabled_tools` (keyed by JWT role name). */
    role_overrides: Record<string, { enabled_tools: string[] }>;
}

export function defaultAssistantToolsSetting(): AssistantToolsSettingData {
    // Role-scoped defaults land in role_overrides so SAVING the settings page
    // preserves them (the backend's default_roles fallback only applies while
    // no setting has ever been saved).
    const role_overrides: Record<string, { enabled_tools: string[] }> = {};
    for (const tool of ASSISTANT_TOOL_CATALOG) {
        for (const role of tool.defaultRoles ?? []) {
            const entry = role_overrides[role] ?? { enabled_tools: [] };
            role_overrides[role] = entry;
            if (!entry.enabled_tools.includes(tool.key)) {
                entry.enabled_tools.push(tool.key);
            }
        }
    }
    return {
        enabled_tools: ASSISTANT_TOOL_CATALOG.filter((t) => t.defaultEnabled).map((t) => t.key),
        role_overrides,
    };
}
