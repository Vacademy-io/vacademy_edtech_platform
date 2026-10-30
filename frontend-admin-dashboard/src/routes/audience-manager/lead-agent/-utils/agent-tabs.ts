export const AGENT_TABS = [
    'review',
    'delivered',
    'rejected',
    'progress',
    'activity',
    'settings',
    'extension',
] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

export const AGENT_TAB_LABELS: Record<AgentTab, string> = {
    review: 'Approval queue',
    delivered: 'Delivered',
    rejected: 'Rejected',
    progress: 'In progress',
    activity: 'Activity',
    settings: 'Settings',
    extension: 'Extension',
};
