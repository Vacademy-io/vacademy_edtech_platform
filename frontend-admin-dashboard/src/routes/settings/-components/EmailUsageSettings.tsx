import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Coins, EnvelopeSimple, Info, Wallet, WarningCircle } from '@phosphor-icons/react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { TopUpModal } from '@/components/common/ai-credits/TopUpModal';
import { formatEmailCredits } from '@/components/common/email-billing/EmailCostEstimate';
import { getInstituteId } from '@/constants/helper';
import {
    emailBillingKeys,
    recentBillingMonths,
    useEmailUsage,
    type EmailUsageSummary,
} from '@/services/email-billing-service';
import { EmailHeldBackList } from './EmailHeldBackList';

function monthLabel(month: string, locale: string): string {
    return new Date(`${month}-01T00:00:00`).toLocaleDateString(locale, {
        month: 'long',
        year: 'numeric',
    });
}

/** Provider events shown to the admin, in order, with plain names. */
const DELIVERY_ROWS: { key: string; label: string }[] = [
    { key: 'DELIVERY', label: 'Delivered' },
    { key: 'OPEN', label: 'Opened' },
    { key: 'CLICK', label: 'Clicked a link' },
    { key: 'BOUNCE', label: 'Bounced' },
    { key: 'COMPLAINT', label: 'Marked as spam' },
];

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3 py-2 text-body">
            <span className="text-neutral-600">{label}</span>
            <span className="text-end font-semibold text-neutral-800">
                {value}
                {hint && <span className="ms-1 font-regular text-muted-foreground">{hint}</span>}
            </span>
        </div>
    );
}

function DeliveryCard({ delivery, locale }: { delivery: Record<string, number>; locale: string }) {
    const sent = delivery.SEND ?? 0;
    const anything = DELIVERY_ROWS.some((row) => (delivery[row.key] ?? 0) > 0) || sent > 0;
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-subtitle font-semibold">How your emails did</CardTitle>
                {sent > 0 && (
                    <CardDescription>
                        Out of {sent.toLocaleString(locale)} emails handed to the mail provider.
                    </CardDescription>
                )}
            </CardHeader>
            <CardContent>
                {!anything ? (
                    <p className="text-body text-muted-foreground">No delivery reports yet.</p>
                ) : (
                    <div className="divide-y divide-border">
                        {DELIVERY_ROWS.map((row) => {
                            const count = delivery[row.key] ?? 0;
                            const rate =
                                sent > 0
                                    ? `${((count / sent) * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`
                                    : undefined;
                            return (
                                <StatRow
                                    key={row.key}
                                    label={row.label}
                                    value={count.toLocaleString(locale)}
                                    hint={rate}
                                />
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function SentByTypeCard({ data, locale }: { data: EmailUsageSummary; locale: string }) {
    const emails = (cls: 'FREE' | 'ESSENTIAL' | 'BILLABLE') =>
        (data.byClass[cls]?.emails ?? 0).toLocaleString(locale);
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-subtitle font-semibold">What was sent</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="divide-y divide-border">
                    <StatRow
                        label="Login codes, password resets and login details"
                        value={emails('FREE')}
                        hint="always free"
                    />
                    <StatRow label="Receipts and invoices" value={emails('ESSENTIAL')} />
                    <StatRow label="All other emails" value={emails('BILLABLE')} />
                </div>
            </CardContent>
        </Card>
    );
}

/**
 * Settings → Email usage: this month's free emails, the credits email has used, the wallet balance,
 * daily volume, how the emails did, and the emails held back for lack of credits.
 */
export default function EmailUsageSettings() {
    const { i18n } = useTranslation();
    const locale = i18n.language || 'en';
    const instituteId = getInstituteId();
    // Undefined = the server's current billing month; the server's answer anchors the picker, so
    // the browser's clock and timezone never decide which month is "this month".
    const [month, setMonth] = useState<string | undefined>(undefined);
    const [serverMonth, setServerMonth] = useState<string | undefined>(undefined);
    const queryClient = useQueryClient();
    const [topUpOpen, setTopUpOpen] = useState(false);
    const { data, isLoading, isError, refetch } = useEmailUsage(instituteId, month);
    useEffect(() => {
        if (month === undefined && data?.month) setServerMonth(data.month);
    }, [month, data?.month]);

    const months = useMemo(() => (serverMonth ? recentBillingMonths(serverMonth, 12) : []), [serverMonth]);
    const monthOptions = useMemo(
        () => months.map((m) => ({ value: m, label: monthLabel(m, locale) })),
        [months, locale]
    );
    const shownMonth = month ?? data?.month ?? serverMonth;
    const isCurrentMonth = month === undefined || month === serverMonth;

    const header = (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <h2 className="text-h3 font-semibold">Email usage</h2>
                <p className="text-body text-muted-foreground">
                    How many emails your institute sent, and what they cost.
                </p>
            </div>
            <MyDropdown
                currentValue={shownMonth ? monthLabel(shownMonth, locale) : ''}
                dropdownList={monthOptions.map((o) => o.label)}
                handleChange={(label) => {
                    const picked = monthOptions.find((o) => o.label === label);
                    if (picked) setMonth(picked.value);
                }}
                className="sm:w-48"
                contentClassName="max-h-72 overflow-y-auto"
            />
        </div>
    );

    if (isLoading) {
        return (
            <div className="flex flex-col gap-6">
                {header}
                <div className="grid gap-4 md:grid-cols-3">
                    <Skeleton className="h-36 w-full" />
                    <Skeleton className="h-36 w-full" />
                    <Skeleton className="h-36 w-full" />
                </div>
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }
    if (isError || !data || !instituteId) {
        return (
            <div className="flex flex-col gap-6">
                {header}
                <Alert variant="destructive">
                    <AlertDescription className="flex flex-wrap items-center gap-2">
                        Could not load email usage. Please try again.
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            onClick={() => void refetch()}
                        >
                            Try again
                        </MyButton>
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    const free = data.freeUnitsPerMonth;
    const usedPct = free > 0 ? Math.min(100, (data.freeUnitsUsed / free) * 100) : 100;
    const creditsUsed = data.chargedCredits + data.pendingCredits;
    const emailsPerCredit = data.creditsPerUnit > 0 ? Math.round(1 / data.creditsPerUnit) : null;
    const paused =
        !data.exempt &&
        data.enforced &&
        data.availableCredits !== null &&
        data.availableCredits <= 0 &&
        data.freeUnitsRemaining === 0;

    return (
        <div className="flex flex-col gap-6">
            {header}

            {data.exempt ? (
                <Alert>
                    <Info className="size-4" />
                    <AlertDescription>Emails are not charged for this institute.</AlertDescription>
                </Alert>
            ) : (
                paused && (
                    <Alert variant="destructive" className="border-danger-200 bg-danger-50">
                        <WarningCircle className="size-4" weight="fill" />
                        <AlertTitle className="text-danger-700">Emails are paused</AlertTitle>
                        <AlertDescription className="flex flex-col gap-3 text-danger-700 sm:flex-row sm:items-center sm:justify-between">
                            <span>
                                Emails are paused: no free emails or credits left. Add credits to
                                restart them.
                            </span>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                className="shrink-0"
                                onClick={() => setTopUpOpen(true)}
                            >
                                Add credits
                            </MyButton>
                        </AlertDescription>
                    </Alert>
                )
            )}

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2">
                            <EnvelopeSimple className="size-4" /> Free emails
                        </CardDescription>
                        <CardTitle className="text-h3 font-semibold">
                            {data.freeUnitsUsed.toLocaleString(locale)} of{' '}
                            {free.toLocaleString(locale)} used
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                        <Progress value={usedPct} className="h-2" />
                        <p className="text-caption text-muted-foreground">
                            {data.freeUnitsRemaining.toLocaleString(locale)} free emails left in{' '}
                            {monthLabel(data.month, locale)}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2">
                            <Coins className="size-4" /> Credits used for email
                        </CardDescription>
                        <CardTitle className="text-h3 font-semibold">
                            {formatEmailCredits(creditsUsed)}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-caption text-muted-foreground">
                        {formatEmailCredits(data.chargedCredits)} charged
                        {data.pendingCredits > 0 &&
                            `, ${formatEmailCredits(data.pendingCredits)} to be charged within the hour`}
                        {data.unitsBeyondFree > 0 &&
                            ` · ${data.unitsBeyondFree.toLocaleString(locale)} emails beyond the free ${free.toLocaleString(locale)}`}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2">
                            <Wallet className="size-4" /> Wallet balance
                        </CardDescription>
                        <CardTitle className="text-h3 font-semibold">
                            {data.balance === null
                                ? '—'
                                : `${formatEmailCredits(data.balance)} credits`}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-caption text-muted-foreground">
                        {isCurrentMonth
                            ? data.balance === null
                                ? 'Balance could not be loaded right now.'
                                : 'The same credits pay for AI features.'
                            : 'Shown for the current month only.'}
                    </CardContent>
                </Card>
            </div>

            {!data.exempt && (
                <p className="text-body text-muted-foreground">
                    The first {free.toLocaleString(locale)} emails each month are free. After that,{' '}
                    {emailsPerCredit ?? 25} emails cost 1 credit. Login codes, password resets and
                    login details are always free.
                </p>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="text-subtitle font-semibold">Emails per day</CardTitle>
                </CardHeader>
                <CardContent className="h-64">
                    {data.daily.length === 0 ? (
                        <p className="text-body text-muted-foreground">
                            No emails sent in {monthLabel(data.month, locale)}.
                        </p>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.daily}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(d: string) =>
                                        new Date(`${d}T00:00:00`).toLocaleDateString(locale, {
                                            day: 'numeric',
                                            month: 'short',
                                        })
                                    }
                                    fontSize={12}
                                />
                                <YAxis allowDecimals={false} fontSize={12} width={48} />
                                <Tooltip
                                    formatter={(v: number) => [
                                        `${Number(v).toLocaleString(locale)} emails`,
                                        'Sent',
                                    ]}
                                    labelFormatter={(d) =>
                                        new Date(`${d}T00:00:00`).toLocaleDateString(locale)
                                    }
                                />
                                <Bar
                                    dataKey="emails"
                                    fill="hsl(var(--primary))"
                                    radius={[4, 4, 0, 0]}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
                <SentByTypeCard data={data} locale={locale} />
                <DeliveryCard delivery={data.delivery} locale={locale} />
            </div>

            {!data.exempt && <EmailHeldBackList instituteId={instituteId} />}

            <TopUpModal
                open={topUpOpen}
                onOpenChange={(open) => {
                    setTopUpOpen(open);
                    // A top-up lifts the pause; show the new balance straight away.
                    if (!open)
                        void queryClient.invalidateQueries({ queryKey: emailBillingKeys.all });
                }}
            />
        </div>
    );
}
