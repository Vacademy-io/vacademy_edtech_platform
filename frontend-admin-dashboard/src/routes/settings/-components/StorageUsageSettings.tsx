import { useTranslation } from 'react-i18next';
import { Database, CloudArrowDown, Info } from '@phosphor-icons/react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getInstituteId } from '@/constants/helper';
import { useInstituteStorageUsage, type CategoryUsage } from '../-services/storage-usage';

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
