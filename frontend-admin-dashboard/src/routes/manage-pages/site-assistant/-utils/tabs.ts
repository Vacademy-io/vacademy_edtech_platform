export const SITE_ASSISTANT_TABS = [
    'knowledge',
    'conversations',
    'unanswered',
    'preview',
    'embed',
    'status',
] as const;

export type SiteAssistantTab = (typeof SITE_ASSISTANT_TABS)[number];

export const TAB_LABELS: Record<SiteAssistantTab, string> = {
    knowledge: 'FAQs & notices',
    conversations: 'Conversations',
    unanswered: 'Unanswered',
    preview: 'Try it',
    embed: 'Your website',
    status: 'Status',
};
