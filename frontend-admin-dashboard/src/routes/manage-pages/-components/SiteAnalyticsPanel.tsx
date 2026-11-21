import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ChartLine, Users, Eye, UserPlus } from '@phosphor-icons/react';
import { Label } from '@/components/ui/label';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getCatalogueAnalytics, type NamedCount } from '../-services/analytics-service';

const RANGES = [
    { days: 7, label: '7 days' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
];

const Stat = ({
    icon: Icon,
    label,
    value,
    hint,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    hint?: string;
}) => (
    <div className="rounded-lg border border-neutral-200 p-3">
        <div className="flex items-center gap-1.5 text-caption text-gray-500">
            <Icon className="size-3.5" />
            {label}
        </div>
        <p className="mt-1 text-h3 font-semibold text-gray-800">{value}</p>
        {hint && <p className="text-caption text-gray-400">{hint}</p>}
    </div>
);

/** Horizontal bars — a table of numbers hides which row dominates. */
const BarList = ({ rows, empty, locale }: { rows: NamedCount[]; empty: string; locale: string }) => {
    const max = Math.max(1, ...rows.map((r) => r.views));
    if (!rows.length) return <p className="py-6 text-center text-caption text-gray-400">{empty}</p>;
    return (
        <div className="space-y-1.5">
            {rows.slice(0, 10).map((r) => (
                <div key={r.name || '(root)'} className="flex items-center gap-2">
                    <div className="w-40 shrink-0 truncate text-caption text-gray-600" title={r.name}>
                        {r.name === '' ? '/ (home)' : r.name}
                    </div>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-gray-100">
                        <div
                            className="h-full rounded bg-primary-300"
                            // Bar length is the datum; it cannot come from a token.
                            style={{ width: `${Math.round((r.views / max) * 100)}%` }} // design-lint-ignore: data-driven bar width
                        />
                    </div>
                    <div className="w-20 shrink-0 text-end text-caption text-gray-600">
                        {r.views.toLocaleString(locale)}
                    </div>
                </div>
            ))}
        </div>
    );
};

/**
 * First-party traffic for the institute's catalogue sites.
 *
 * Exists because GA4/Pixel are the institute's own tools and most never connect
 * one — and even when they do, that data cannot be joined to the leads sitting
 * in our database. This shows arrivals and conversions in the same place.
 */
export const SiteAnalyticsPanel = () => {
    const { i18n } = useTranslation();
    // Explicit locale: number formatting with no locale argument follows the
    // BROWSER's locale, which can disagree with the language the admin picked
    // in the app — so an Arabic UI would render Latin digits, or vice versa.
    const locale = i18n.language || 'en';
    const instituteId = getCurrentInstituteId();
    const [days, setDays] = useState(30);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['catalogueAnalytics', instituteId, days],
        queryFn: () => getCatalogueAnalytics(instituteId!, days),
        enabled: !!instituteId,
    });

    const conversion = useMemo(() => {
        if (!data || !data.visitors) return '—';
        return `${((data.leads / data.visitors) * 100).toFixed(1)}%`;
    }, [data]);

    if (isLoading) return <DashboardLoader />;
    if (isError)
        return (
            <p className="p-4 text-caption text-danger-600">
                Couldn&apos;t load analytics. Try again in a moment.
            </p>
        );

    const empty = !data || data.views === 0;

    return (
        <div className="space-y-4 p-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ChartLine className="size-5 text-primary-500" />
                    <h3 className="text-title font-semibold text-gray-800">Site analytics</h3>
                </div>
                <div className="flex gap-1">
                    {RANGES.map((r) => (
                        <button
                            key={r.days}
                            onClick={() => setDays(r.days)}
                            className={`rounded-full border px-3 py-1 text-caption font-medium ${
                                days === r.days
                                    ? 'border-primary-400 bg-primary-50 text-primary-500'
                                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            {empty ? (
                <div className="rounded-lg border border-dashed border-neutral-200 py-10 text-center">
                    <p className="text-sm text-gray-600">No visits recorded yet</p>
                    <p className="mx-auto mt-1 max-w-md text-caption text-gray-400">
                        Views are counted from the moment your site is published — there is nothing
                        to switch on. If you just published, check back in a few minutes.
                    </p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Stat icon={Eye} label="Page views" value={data.views.toLocaleString(locale)} />
                        <Stat
                            icon={Users}
                            label="Visitors"
                            value={data.visitors.toLocaleString(locale)}
                            hint="unique per day"
                        />
                        <Stat icon={UserPlus} label="Leads" value={data.leads.toLocaleString(locale)} />
                        <Stat icon={ChartLine} label="Conversion" value={conversion} />
                    </div>

                    <div>
                        <Label className="text-xs">Most visited pages</Label>
                        <div className="mt-2">
                            <BarList rows={data.pages} empty="No page data yet." locale={locale} />
                        </div>
                    </div>

                    <div>
                        <Label className="text-xs">Where visitors came from</Label>
                        <div className="mt-2">
                            <BarList rows={data.sources} empty="No source data yet." locale={locale} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default SiteAnalyticsPanel;
