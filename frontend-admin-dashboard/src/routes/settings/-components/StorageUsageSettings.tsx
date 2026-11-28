import { useTranslation } from 'react-i18next';
import { Database, CloudArrowDown, Info } from '@phosphor-icons/react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getInstituteId } from '@/constants/helper';
import { cn } from '@/lib/utils';
import {
    useInstituteStorageUsage,
    type AllowanceStatus,
    type CategoryUsage,
    type InstituteStorageUsage,
} from '../-services/storage-usage';

const CATEGORY_LABELS: Record<string, string> = {
    RECORDING: 'Live class recordings',
    VIDEO: 'Videos',
    AUDIO: 'Audio',
    DOCUMENT: 'Documents',
    IMAGE: 'Images',
    OTHER: 'Other files',
};

function formatBytes(bytes: number, locale: string): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toLocaleString(locale, { maximumFractionDigits: unit >= 3 ? 2 : 0 })} ${units[unit]}`;
}

function CategoryBreakdown({ rows, total, locale, countLabel }: {
    rows: CategoryUsage[];
    total: number;
    locale: string;
    countLabel: string;
}) {
    if (rows.length === 0) {
        return <p className="text-sm text-muted-foreground">Nothing measured yet.</p>;
    }
    return (
        <div className="flex flex-col gap-3">
            {rows.map((row) => (
                <div key={row.category} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium">{CATEGORY_LABELS[row.category] ?? row.category}</span>
                        <span className="text-muted-foreground">
                            {formatBytes(row.bytes, locale)} · {row.count.toLocaleString(locale)} {countLabel}
                        </span>
                    </div>
                    <Progress value={total > 0 ? (row.bytes / total) * 100 : 0} />
                </div>
            ))}
        </div>
    );
}

const GB = 1024 ** 3;

function formatMoney(amount: number, currency: string, locale: string): string {
    if (currency === 'CREDITS') {
        return `${amount.toLocaleString(locale, { maximumFractionDigits: 2 })} credits`;
    }
    try {
        return amount.toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: 2 });
    } catch {
        return `${currency} ${amount.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
    }
}

function formatGb(gb: number, locale: string): string {
    return `${gb.toLocaleString(locale, { maximumFractionDigits: 2 })} GB`;
}

function monthName(month: string, locale: string): string {
    return new Date(`${month}-01T00:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

function AllowanceMeter({ label, usedBytes, includedGb, extraBytes, charge, rateText, currency, locale }: {
    label: string;
    usedBytes: number;
    includedGb: number;
    extraBytes: number;
    charge: number;
    rateText: string;
    currency: string;
    locale: string;
}) {
    const usedGb = usedBytes / GB;
    const pct = includedGb > 0 ? Math.min(100, (usedGb / includedGb) * 100) : usedBytes > 0 ? 100 : 0;
    const over = extraBytes > 0;
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground">
                    {formatBytes(usedBytes, locale)} of {formatGb(includedGb, locale)} included
                </span>
            </div>
            <Progress value={pct} className={over ? '[&>div]:bg-danger-500' : undefined} />
            <p className={cn('text-xs', over ? 'text-danger-600' : 'text-muted-foreground')}>
                {over
                    ? `${formatBytes(extraBytes, locale)} over the plan · ${formatMoney(charge, currency, locale)} extra`
                    : `${formatGb(Math.max(0, includedGb - usedGb), locale)} left`}
                {` · then ${rateText}`}
            </p>
        </div>
    );
}

/** Included storage and bandwidth, what is used, and the extra charge so far. */
function AllowanceCard({ current, previous, previousCharge, locale }: {
    current: AllowanceStatus;
    previous: AllowanceStatus | null | undefined;
    previousCharge: InstituteStorageUsage['previous_month_charge'];
    locale: string;
}) {
    const cur = current.currency;
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Your plan, {monthName(current.month, locale)}</CardTitle>
                <CardDescription>
                    Your plan includes {formatGb(current.included_storage_gb + current.addon_storage_gb, locale)} of
                    storage
                    {current.addon_storage_gb > 0 &&
                        ` (with a ${formatGb(current.addon_storage_gb, locale)} storage pack at ${formatMoney(current.addon_price, cur, locale)} a month)`}{' '}
                    and {formatGb(current.included_bandwidth_gb, locale)} of bandwidth a month. Anything above that is
                    charged per GB
                    {cur === 'CREDITS' ? ' from your credits, once a month' : ''}. Videos and files never stop
                    playing.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
                <AllowanceMeter
                    label="Storage (average this month)"
                    usedBytes={current.storage_average_bytes}
                    includedGb={current.included_storage_gb + current.addon_storage_gb}
                    extraBytes={current.storage_extra_bytes}
                    charge={current.storage_charge}
                    rateText={`${formatMoney(current.storage_rate_per_gb, cur, locale)} per extra GB a month`}
                    currency={cur}
                    locale={locale}
                />
                <AllowanceMeter
                    label="Bandwidth this month"
                    usedBytes={current.bandwidth_bytes}
                    includedGb={current.included_bandwidth_gb}
                    extraBytes={current.bandwidth_extra_bytes}
                    charge={current.bandwidth_charge}
                    rateText={`${formatMoney(current.bandwidth_rate_per_gb, cur, locale)} per extra GB`}
                    currency={cur}
                    locale={locale}
                />
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-4">
                    <div>
                        <p className="text-sm font-medium">
                            {current.addon_price > 0 ? 'Charge so far this month (incl. storage pack)' : 'Extra charge so far this month'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            An estimate from usage up to last night. Storage counts the month's average, so a large
                            upload late in the month adds only part of its size.
                            {current.charged_to_wallet
                                ? ' Taken from your credits in the first days of next month.'
                                : current.currency === 'CREDITS' && current.charge_from_month
                                  ? ` Charging starts with ${monthName(current.charge_from_month, locale)}; nothing is taken for this month.`
                                  : ''}
                        </p>
                    </div>
                    <p className="text-2xl font-semibold">{formatMoney(current.total_charge, cur, locale)}</p>
                </div>
                {previousCharge && previousCharge.status === 'CHARGED' && (
                    <p className="text-sm text-muted-foreground">
                        {monthName(previousCharge.month, locale)}:{' '}
                        {previousCharge.credits > 0
                            ? `${formatMoney(previousCharge.credits, 'CREDITS', locale)} taken from your credits.`
                            : 'within your plan, nothing taken.'}
                    </p>
                )}
                {previous && !(previousCharge && previousCharge.status === 'CHARGED') && (
                    <p className="text-sm text-muted-foreground">
                        {monthName(previous.month, locale)}:{' '}
                        {previous.total_charge > 0
                            ? `${formatMoney(previous.total_charge, previous.currency, locale)} extra (storage ${formatMoney(previous.storage_charge, previous.currency, locale)}, bandwidth ${formatMoney(previous.bandwidth_charge, previous.currency, locale)})`
                            : 'within your plan, no extra charge'}
                        .
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * Settings → Storage & Bandwidth: what this institute stores with us and how much its
 * learners download or stream. Read-only; numbers refresh once a night.
 */
export default function StorageUsageSettings() {
    const { i18n } = useTranslation();
    const locale = i18n.language || 'en';
    const instituteId = getInstituteId();
    const { data, isLoading, isError } = useInstituteStorageUsage(instituteId);

    if (isLoading) {
        return (
            <div className="flex flex-col gap-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }
    if (isError || !data) {
        return (
            <Alert variant="destructive">
                <AlertDescription>Could not load storage and bandwidth usage. Please try again later.</AlertDescription>
            </Alert>
        );
    }

    const monthLabel = new Date(`${data.bandwidth_month}-01T00:00:00`).toLocaleDateString(locale, {
        month: 'long',
        year: 'numeric',
    });

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h2 className="text-lg font-semibold">Storage &amp; bandwidth</h2>
                <p className="text-sm text-muted-foreground">
                    The files your institute stores with us, and how much your learners download or stream.
                    Updated every night.
                </p>
            </div>

            {!data.storage_as_of && !data.bandwidth_tracking_since && (
                <Alert>
                    <Info className="size-4" />
                    <AlertDescription>
                        Usage tracking has just started. The first numbers appear within two days.
                    </AlertDescription>
                </Alert>
            )}

            {data.allowance && (
                <AllowanceCard
                    current={data.allowance}
                    previous={data.allowance_previous_month}
                    previousCharge={data.previous_month_charge}
                    locale={locale}
                />
            )}

            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2">
                            <Database className="size-4" /> Storage used
                        </CardDescription>
                        <CardTitle className="text-2xl">{formatBytes(data.storage_bytes, locale)}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        {data.storage_objects.toLocaleString(locale)} files
                        {data.storage_as_of &&
                            ` · as of ${new Date(`${data.storage_as_of}T00:00:00`).toLocaleDateString(locale)}`}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2">
                            <CloudArrowDown className="size-4" /> Bandwidth in {monthLabel}
                        </CardDescription>
                        <CardTitle className="text-2xl">{formatBytes(data.bandwidth_month_bytes, locale)}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        {data.bandwidth_month_requests.toLocaleString(locale)} downloads and video plays
                        {data.bandwidth_tracking_since &&
                            ` · measured since ${new Date(`${data.bandwidth_tracking_since}T00:00:00`).toLocaleDateString(locale)}`}
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">What takes up the space</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <CategoryBreakdown rows={data.storage_by_category} total={data.storage_bytes} locale={locale} countLabel="files" />
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">What learners download or stream</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <CategoryBreakdown rows={data.bandwidth_month_by_category} total={data.bandwidth_month_bytes} locale={locale} countLabel="requests" />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Daily bandwidth, last 30 days</CardTitle>
                </CardHeader>
                <CardContent className="h-64">
                    {data.bandwidth_daily.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nothing measured yet.</p>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.bandwidth_daily.map((d) => ({ ...d, gb: d.bytes / 1024 ** 3 }))}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="date" tickFormatter={(d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })} fontSize={12} />
                                <YAxis tickFormatter={(v: number) => `${v.toLocaleString(locale, { maximumFractionDigits: 1 })} GB`} fontSize={12} width={64} />
                                <Tooltip formatter={(_v, _n, item) => formatBytes(item.payload.bytes, locale)} labelFormatter={(d) => new Date(`${d}T00:00:00`).toLocaleDateString(locale)} />
                                <Bar dataKey="gb" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
