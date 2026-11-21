import { createFileRoute } from '@tanstack/react-router';
import { SITE_ASSISTANT_TABS, type SiteAssistantTab } from './-utils/tabs';

/**
 * Manage Pages → Site Assistant. `?site=<tag>` picks the site (the settings
 * card links here with it); `?tab=` opens a tab.
 */
export const Route = createFileRoute('/manage-pages/site-assistant/')({
    validateSearch: (
        search: Record<string, unknown>
    ): { site?: string; tab?: SiteAssistantTab } => ({
        site: typeof search.site === 'string' && search.site ? search.site : undefined,
        tab: SITE_ASSISTANT_TABS.find((t) => t === search.tab),
    }),
    component: () => <div>Loading...</div>, // Will be overridden by lazy
});
