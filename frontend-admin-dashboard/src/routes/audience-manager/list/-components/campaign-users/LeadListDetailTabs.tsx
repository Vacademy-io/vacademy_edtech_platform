import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export type LeadListTab = 'leads' | 'history' | 'share' | 'auto';

const TABS: LeadListTab[] = ['leads', 'history', 'share', 'auto'];

/** Underlined section tabs of one lead list; a count shows only when it is known. */
export function LeadListDetailTabs({
    value,
    onChange,
    counts,
}: {
    value: LeadListTab;
    onChange: (tab: LeadListTab) => void;
    counts: Partial<Record<LeadListTab, number | null | undefined>>;
}) {
    const { t, i18n } = useTranslation('audienceManagerCampaignUsersTable');
    return (
        <Tabs value={value} onValueChange={(v) => onChange(v as LeadListTab)}>
            <TabsList
                aria-label={t('detail.tabs.ariaLabel')}
                className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-neutral-200 bg-transparent p-0"
            >
                {TABS.map((tab) => {
                    const count = counts[tab];
                    return (
                        <TabsTrigger
                            key={tab}
                            value={tab}
                            className="group -mb-px gap-2 rounded-none border-b-2 border-transparent px-4 py-2.5 text-body font-semibold text-neutral-500 hover:text-neutral-800 data-[state=active]:border-primary-500 data-[state=active]:bg-transparent data-[state=active]:text-primary-600 data-[state=active]:shadow-none"
                        >
                            {t(`detail.tabs.${tab}`)}
                            {count != null && (
                                <span
                                    className={cn(
                                        'rounded-full bg-neutral-100 px-2 text-caption text-neutral-600',
                                        'group-data-[state=active]:bg-primary-100 group-data-[state=active]:text-primary-600'
                                    )}
                                >
                                    {count.toLocaleString(i18n.language)}
                                </span>
                            )}
                        </TabsTrigger>
                    );
                })}
            </TabsList>
        </Tabs>
    );
}
