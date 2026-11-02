import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Report tabs grouped (Pipeline, Campaigns, Calling, Team, Revenue, Custom). */
const GROUPS: Array<[string, string[]]> = [
    ['pipeline', ['overview', 'funnel', 'dispositions', 'followups']],
    ['campaigns', ['sources', 'utm']],
    ['calling', ['calling', 'lead-calls', 'call-intelligence']],
    ['team', ['activity', 'counsellors', 'conversions', 'manager']],
    ['revenue', ['revenue', 'admissions', 'cohort', 'forecast']],
    ['custom', ['custom']],
];

/** tab value → key in the page's own `tabs.*` labels (and `descriptions.*`). */
export const LABEL_KEY: Record<string, string> = {
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
    conversions: 'conversions',
    manager: 'manager',
    revenue: 'revenue',
    admissions: 'admissions',
    cohort: 'cohort',
    forecast: 'forecast',
    custom: 'custom',
};

/**
 * Reports navigation, above the report so the report itself gets the full width.
 * Row 1 picks the group (underlined tabs); row 2 picks the report inside it (pills).
 * Picking a group opens its first report.
 */
export function ReportsRail({
    active,
    onSelect,
    showIntelligence,
    actions,
}: {
    active: string;
    onSelect: (tab: string) => void;
    showIntelligence: boolean;
    /** Right side of the group row (e.g. Refresh). */
    actions?: ReactNode;
}) {
    const { t } = useTranslation('audienceManagerLeadReportsPage');
    const { t: tp } = useTranslation('crmPages');
    const groups = GROUPS.map(
        ([group, tabs]) =>
            [group, tabs.filter((tab) => tab !== 'call-intelligence' || showIntelligence)] as const
    );
    const activeGroup = groups.find(([, tabs]) => tabs.includes(active)) ?? groups[0]!;
    const [activeGroupKey, activeTabs] = activeGroup;

    return (
        <nav className="flex flex-col rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-neutral-200 pe-3">
                <div role="tablist" className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-2">
                    {groups.map(([group, tabs]) => {
                        const selected = group === activeGroupKey;
                        return (
                            <button
                                key={group}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                onClick={() => !selected && tabs[0] && onSelect(tabs[0])}
                                className={cn(
                                    '-mb-px whitespace-nowrap border-b-2 px-4 py-3 transition-colors',
                                    selected
                                        ? 'border-primary-500 font-semibold text-primary-600'
                                        : 'border-transparent font-medium text-neutral-600 hover:text-neutral-900'
                                )}
                            >
                                <span className="text-body">{tp(`reports.groups.${group}`)}</span>
                            </button>
                        );
                    })}
                </div>
                {actions}
            </div>
            <div role="tablist" className="flex flex-wrap gap-2 px-4 py-3">
                {activeTabs.map((tab) => (
                    <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={active === tab}
                        onClick={() => onSelect(tab)}
                        className={cn(
                            'whitespace-nowrap rounded-full border px-4 py-1.5 transition-colors',
                            active === tab
                                ? 'border-primary-500 bg-primary-500 font-medium text-white'
                                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                        )}
                    >
                        <span className="text-body">{t(`tabs.${LABEL_KEY[tab]}`)}</span>
                    </button>
                ))}
            </div>
        </nav>
    );
}
