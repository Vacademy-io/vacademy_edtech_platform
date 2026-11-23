/**
 * Platform breakdown: one row per ad platform (Meta, Google, YouTube) with spend, clicks,
 * enquiries, cost per enquiry and admissions. Headers sort (admissions, high to low, by
 * default) and a row expands into its campaigns. A compact report breakdown of at most
 * three rows with nested campaign rows, so it is a plain semantic table rather than the
 * paginated MyTable data grid.
 */
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowDown, ArrowUp, ArrowsDownUp, CaretRight } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { PlatformIcon, platformLabel } from '../../-marketing/platform-meta';
import type {
    AdPerformanceCampaign,
    AdPerformancePlatform,
    AdPerformanceUnattributed,
    AdPlatform,
} from '../../-marketing/types';
import {
    DEFAULT_SORT,
    channelMix,
    compareRows,
    formatCount,
    formatMoney,
    type SortKey,
    type SortState,
} from './ad-performance-utils';

/** Campaigns shown before "Show all" in an expanded row. */
const CAMPAIGN_PREVIEW = 8;
/** Channels named in the Google row subtitle. */
const SUBTITLE_CHANNELS = 3;

const NUMERIC_COLUMNS: { key: Exclude<SortKey, 'name'>; labelKey: string }[] = [
    { key: 'spend', labelKey: 'ads.table.spend' },
    { key: 'clicks', labelKey: 'ads.table.clicks' },
    { key: 'enquiries', labelKey: 'ads.table.enquiries' },
    { key: 'cost_per_enquiry', labelKey: 'ads.table.costPerEnquiry' },
    { key: 'admissions', labelKey: 'ads.table.admissions' },
];

function humanise(value: string): string {
    const words = value.toLowerCase().split('_').filter(Boolean);
    const text = words.join(' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function channelLabel(channel: string | null, t: TFunction): string | null {
    if (!channel) return null;
    return t(`ads.channel.${channel}`, { defaultValue: humanise(channel) });
}

function platformSubtitle(
    platform: AdPlatform,
    campaigns: AdPerformanceCampaign[],
    t: TFunction
): string {
    if (platform === 'GOOGLE') {
        const channels = channelMix(campaigns, 'GOOGLE')
            .filter((channel) => channel !== 'VIDEO')
            .slice(0, SUBTITLE_CHANNELS)
            .map((channel) => channelLabel(channel, t))
            .filter(Boolean);
        if (channels.length > 0) return channels.join(' · ');
    }
    return t(`ads.table.subtitle.${platform}`);
}

function SortHeader({
    label,
    sortKey,
    sort,
    onSort,
    align = 'right',
}: {
    label: string;
    sortKey: SortKey;
    sort: SortState;
    onSort: (key: SortKey) => void;
    align?: 'left' | 'right';
}) {
    const active = sort.key === sortKey;
    const SortIcon = !active ? ArrowsDownUp : sort.direction === 'desc' ? ArrowDown : ArrowUp;
    return (
        <th
            scope="col"
            aria-sort={active ? (sort.direction === 'desc' ? 'descending' : 'ascending') : 'none'}
            className={cn(
                'whitespace-nowrap px-4 py-3 font-medium',
                align === 'right' ? 'text-end' : 'text-start'
            )}
        >
            <button
                type="button"
                onClick={() => onSort(sortKey)}
                className={cn(
                    'inline-flex items-center gap-1 rounded-sm text-caption transition-colors hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                    align === 'right' && 'flex-row-reverse',
                    active ? 'font-semibold text-neutral-800' : 'text-neutral-500'
                )}
            >
                <SortIcon size={12} className={active ? 'text-primary-500' : 'text-neutral-300'} />
                {label}
            </button>
        </th>
    );
}

function MetricCells({
    row,
    currency,
    muted = false,
}: {
    row: Pick<
        AdPerformancePlatform,
        'spend' | 'clicks' | 'enquiries' | 'cost_per_enquiry' | 'admissions'
    >;
    currency: string;
    muted?: boolean;
}) {
    const cell = cn(
        'whitespace-nowrap px-4 text-end tabular-nums',
        muted ? 'py-2 text-caption text-neutral-600' : 'py-3 text-body text-neutral-800'
    );
    return (
        <>
            <td className={cell}>{formatMoney(row.spend, currency)}</td>
            <td className={cell}>{formatCount(row.clicks)}</td>
            <td className={cell}>{formatCount(row.enquiries)}</td>
            <td className={cell}>{formatMoney(row.cost_per_enquiry, currency)}</td>
            <td
                className={cn(
                    cell,
                    'font-semibold',
                    row.admissions > 0 ? 'text-success-600' : 'text-neutral-400'
                )}
            >
                {formatCount(row.admissions)}
            </td>
        </>
    );
}

function CampaignRows({
    campaigns,
    currency,
    sort,
}: {
    campaigns: AdPerformanceCampaign[];
    currency: string;
    sort: SortState;
}) {
    const { t } = useTranslation('marketingAds');
    const [showAll, setShowAll] = useState(false);
    const nameOf = (c: AdPerformanceCampaign) =>
        c.campaign_name || c.campaign_id || t('ads.table.otherCampaign');
    const sorted = useMemo(
        () =>
            [...campaigns].sort((a, b) => {
                // "Other / not matched" always sits last.
                if (a.campaign_id === null && b.campaign_id !== null) return 1;
                if (b.campaign_id === null && a.campaign_id !== null) return -1;
                return compareRows(a, b, sort, nameOf);
            }),
        // nameOf only reads t, which is already a dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [campaigns, sort, t]
    );
    const visible = showAll ? sorted : sorted.slice(0, CAMPAIGN_PREVIEW);

    if (campaigns.length === 0) {
        return (
            <tr className="bg-neutral-50">
                <td colSpan={6} className="px-4 py-3 ps-16 text-caption text-neutral-500">
                    {t('ads.table.noCampaigns')}
                </td>
            </tr>
        );
    }

    return (
        <>
            {visible.map((campaign) => {
                const channel =
                    campaign.platform === 'META' ? null : channelLabel(campaign.channel, t);
                const unmatched = campaign.campaign_id === null;
                return (
                    <tr
                        key={`${campaign.platform}-${campaign.campaign_id ?? 'other'}`}
                        className="bg-neutral-50"
                    >
                        <td className="max-w-md py-2 pe-4 ps-16">
                            <div className="flex min-w-0 flex-col">
                                <span
                                    className={cn(
                                        'truncate text-caption font-medium',
                                        unmatched ? 'italic text-neutral-500' : 'text-neutral-700'
                                    )}
                                    title={nameOf(campaign)}
                                >
                                    {unmatched ? t('ads.table.otherCampaign') : nameOf(campaign)}
                                </span>
                                {(channel || unmatched) && (
                                    <span className="truncate text-caption text-neutral-400">
                                        {unmatched ? t('ads.table.otherCampaignHint') : channel}
                                    </span>
                                )}
                            </div>
                        </td>
                        <MetricCells row={campaign} currency={currency} muted />
                    </tr>
                );
            })}
            {sorted.length > CAMPAIGN_PREVIEW && (
                <tr className="bg-neutral-50">
                    <td colSpan={6} className="px-4 py-2 ps-16">
                        <button
                            type="button"
                            onClick={() => setShowAll((v) => !v)}
                            className="rounded-sm text-caption font-medium text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                        >
                            {showAll
                                ? t('ads.table.showFewer')
                                : t('ads.table.showAll', { count: sorted.length })}
                        </button>
                    </td>
                </tr>
            )}
        </>
    );
}

export function PlatformTable({
    platforms,
    campaigns,
    unattributed,
    currency,
}: {
    platforms: AdPerformancePlatform[];
    campaigns: AdPerformanceCampaign[];
    unattributed: AdPerformanceUnattributed | null;
    currency: string;
}) {
    const { t } = useTranslation('marketingAds');
    const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
    const [expanded, setExpanded] = useState<Set<AdPlatform>>(new Set());

    const sorted = useMemo(
        () =>
            [...platforms].sort((a, b) =>
                compareRows(a, b, sort, (row) => platformLabel(row.platform, t, 'ads'))
            ),
        [platforms, sort, t]
    );

    const campaignsByPlatform = useMemo(() => {
        const map = new Map<AdPlatform, AdPerformanceCampaign[]>();
        for (const campaign of campaigns) {
            const list = map.get(campaign.platform) ?? [];
            list.push(campaign);
            map.set(campaign.platform, list);
        }
        return map;
    }, [campaigns]);

    const onSort = (key: SortKey) =>
        setSort((current) =>
            current.key === key
                ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
                : { key, direction: key === 'name' ? 'asc' : 'desc' }
        );

    const toggle = (platform: AdPlatform) =>
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(platform)) next.delete(platform);
            else next.add(platform);
            return next;
        });

    const hasUnattributed =
        !!unattributed && (unattributed.enquiries > 0 || unattributed.admissions > 0);

    return (
        <Card className="flex flex-col overflow-hidden shadow-none">
            <div className="flex flex-col gap-0.5 px-5 pb-2 pt-5">
                <h2 className="text-subtitle font-semibold text-neutral-800">
                    {t('ads.table.title')}
                </h2>
                <p className="text-caption text-neutral-500">{t('ads.table.subtitleHint')}</p>
            </div>
            {sorted.length === 0 ? (
                <p className="mx-5 mb-5 rounded-lg border border-dashed border-neutral-200 px-4 py-8 text-center text-body text-neutral-500">
                    {t('ads.table.empty')}
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-max border-collapse">
                        <thead className="border-y border-neutral-100 bg-neutral-50">
                            <tr>
                                <SortHeader
                                    label={t('ads.table.account')}
                                    sortKey="name"
                                    sort={sort}
                                    onSort={onSort}
                                    align="left"
                                />
                                {NUMERIC_COLUMNS.map((column) => (
                                    <SortHeader
                                        key={column.key}
                                        label={t(column.labelKey)}
                                        sortKey={column.key}
                                        sort={sort}
                                        onSort={onSort}
                                    />
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                            {sorted.map((row) => {
                                const open = expanded.has(row.platform);
                                const label = platformLabel(row.platform, t, 'ads');
                                return (
                                    <Fragment key={row.platform}>
                                        <tr
                                            className={cn(
                                                'cursor-pointer transition-colors hover:bg-neutral-50',
                                                open && 'bg-neutral-50'
                                            )}
                                            onClick={() => toggle(row.platform)}
                                        >
                                            <td className="px-4 py-3">
                                                <button
                                                    type="button"
                                                    aria-expanded={open}
                                                    aria-label={t(
                                                        open
                                                            ? 'ads.table.collapseAria'
                                                            : 'ads.table.expandAria',
                                                        { platform: label }
                                                    )}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        toggle(row.platform);
                                                    }}
                                                    className="flex w-full items-center gap-3 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                                >
                                                    <CaretRight
                                                        size={14}
                                                        className={cn(
                                                            'shrink-0 text-neutral-400 transition-transform',
                                                            open && 'rotate-90'
                                                        )}
                                                    />
                                                    <PlatformIcon platform={row.platform} />
                                                    <span className="flex min-w-0 flex-col">
                                                        <span className="truncate text-body font-semibold text-neutral-800">
                                                            {label}
                                                        </span>
                                                        <span className="truncate text-caption text-neutral-500">
                                                            {platformSubtitle(
                                                                row.platform,
                                                                campaigns,
                                                                t
                                                            )}
                                                        </span>
                                                    </span>
                                                </button>
                                            </td>
                                            <MetricCells row={row} currency={currency} />
                                        </tr>
                                        {open && (
                                            <CampaignRows
                                                campaigns={
                                                    campaignsByPlatform.get(row.platform) ?? []
                                                }
                                                currency={currency}
                                                sort={sort}
                                            />
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            {hasUnattributed && unattributed && (
                <p className="border-t border-neutral-100 px-5 py-3 text-caption text-neutral-500">
                    {t('ads.table.notFromAds', {
                        enquiries: formatCount(unattributed.enquiries),
                        admissions: formatCount(unattributed.admissions),
                    })}
                </p>
            )}
        </Card>
    );
}
