import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Report tabs grouped the way the approved mock groups them. */
const GROUPS: Array<[string, string[]]> = [
    ['pipeline', ['overview', 'funnel', 'dispositions', 'followups']],
    ['campaigns', ['sources', 'utm']],
    ['calling', ['calling', 'lead-calls', 'call-intelligence']],
    ['team', ['activity', 'counsellors', 'manager']],
    ['revenue', ['revenue', 'cohort', 'forecast']],
    ['custom', ['custom']],
];

/** tab value → key in the page's own `tabs.*` labels. */
const LABEL_KEY: Record<string, string> = {
    overview: 'overview',
    sources: 'sources',
    utm: 'utm',
    funnel: 'funnel',
    dispositions: 'dispositions',
    calling: 'calling',
    'lead-calls': 'leadCalls',
    'call-intelligence': 'callIntelligence',
    activity: 'activity',
    followups: 'followups',
    counsellors: 'counsellors',
    manager: 'manager',
    revenue: 'revenue',
    cohort: 'cohort',
    forecast: 'forecast',
    custom: 'custom',
};

/**
 * Reports: the report tabs grouped (Pipeline, Campaigns, Calling, Team, Revenue,
 * Custom) as a left rail on wide screens and a scrolling row on small ones.
 */
export function ReportsRail({
    active,
    onSelect,
    showIntelligence,
}: {
    active: string;
    onSelect: (tab: string) => void;
    showIntelligence: boolean;
}) {
    const { t } = useTranslation('audienceManagerLeadReportsPage');
    const { t: tp } = useTranslation('crmPages');
    return (
        <nav
            role="tablist"
            aria-orientation="vertical"
            className="flex gap-3 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-2 lg:sticky lg:top-4 lg:w-44 lg:shrink-0 lg:flex-col lg:gap-3 lg:overflow-visible"
        >
            {GROUPS.map(([group, tabs]) => (
                <div
                    key={group}
                    className="flex shrink-0 items-center gap-0.5 lg:flex-col lg:items-stretch"
                >
                    <span className="hidden px-2 pb-1 font-semibold uppercase tracking-wide text-neutral-400 lg:block">
                        <span className="text-caption">{tp(`reports.groups.${group}`)}</span>
                    </span>
                    {tabs
                        .filter((tab) => tab !== 'call-intelligence' || showIntelligence)
                        .map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                role="tab"
                                aria-selected={active === tab}
                                onClick={() => onSelect(tab)}
                                className={cn(
                                    'whitespace-nowrap rounded-md px-2 py-1 text-left transition-colors',
                                    active === tab
                                        ? 'bg-primary-50 font-semibold text-primary-600'
                                        : 'text-neutral-700 hover:bg-neutral-50'
                                )}
                            >
                                <span className="text-body">{t(`tabs.${LABEL_KEY[tab]}`)}</span>
                            </button>
                        ))}
                </div>
            ))}
        </nav>
    );
}
