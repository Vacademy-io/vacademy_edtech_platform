/**
 * /audience-manager/ad-performance — "All ad accounts". Spend from every connected Meta
 * and Google ad account next to the enquiries and admissions those ads brought into the
 * CRM, per platform and per campaign, with an advice-only budget suggestion.
 *
 * State: the window (range/from/to) and the chart metric live in the URL. Coming back
 * from a provider's sign-in (?mkt_session=…) opens the account picker. While an account
 * is on its first sync, or right after "Sync now", the account list is polled so the
 * report refreshes as soon as data lands.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowsClockwise, ChartLineUp, Info } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { ScreenHeader } from '@/components/shared/crm-enhance/screen-header';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { cn } from '@/lib/utils';
import { ConnectProviderMenu } from '../../-marketing/connect-buttons';
import { ConnectAccountsDialog } from '../../-marketing/connect-dialog';
import { marketingErrorMessage } from '../../-marketing/marketing-api';
import { useOAuthReturn } from '../../-marketing/use-oauth-return';
import {
    marketingKeys,
    useAdAccounts,
    useAdPerformance,
    useSyncAllAdAccounts,
} from '../../-marketing/use-marketing';
import type { AdMetric, AdRange } from '../index';
import { AccountChips } from './account-chips';
import { ConnectEmptyState, ReconnectAlert } from './connect-empty-state';
import { DailyChartCard } from './daily-chart-card';
import { KpiCards } from './kpi-cards';
import { PlatformTable } from './platform-table';
import { RangeControls } from './range-controls';
import { ErrorBlock, PageSkeleton, ReportSkeleton } from './ad-performance-states';
import { SuggestionCard } from './suggestion-card';
import {
    DEFAULT_METRIC,
    DEFAULT_RANGE,
    accountFirstSyncPending,
    accountNeedsAttention,
    formatRelativeTime,
    formatTimestamp,
    latestSync,
    resolveWindow,
} from './ad-performance-utils';

const ROUTE = '/audience-manager/ad-performance/' as const;
const FALLBACK_CURRENCY = 'INR';
/** How often the account list is re-read while a sync is running. */
const POLL_MS = 15_000;
/** How long to keep polling after "Sync now" (the server syncs in the background). */
const SYNC_ALL_POLL_MS = 3 * 60_000;
/** Stop waiting for a first sync after this long on the page. */
const FIRST_SYNC_POLL_LIMIT_MS = 15 * 60_000;

function useAdPerformanceSearch() {
    const search = useSearch({ from: ROUTE });
    const navigate = useNavigate({ from: ROUTE });
    const reportWindow = useMemo(
        () => resolveWindow(search.range, search.from, search.to),
        [search.range, search.from, search.to]
    );
    const metric: AdMetric = search.metric ?? DEFAULT_METRIC;

    const setRange = (range: AdRange) =>
        navigate({
            search: (prev) => ({
                ...prev,
                range: range === DEFAULT_RANGE ? undefined : range,
                // Custom starts from the window on screen, so the dates are never blank.
                from: range === 'custom' ? reportWindow.from : undefined,
                to: range === 'custom' ? reportWindow.to : undefined,
            }),
        });
    const setCustom = (from: string, to: string) =>
        navigate({ search: (prev) => ({ ...prev, range: 'custom', from, to }) });
    const setMetric = (next: AdMetric) =>
        navigate({
            replace: true,
            search: (prev) => ({ ...prev, metric: next === DEFAULT_METRIC ? undefined : next }),
        });

    return { reportWindow, metric, setRange, setCustom, setMetric };
}

export function AdPerformancePage() {
    const { t, i18n } = useTranslation('marketingAds');
    const setNavHeading = useNavHeadingStore((s) => s.setNavHeading);
    const queryClient = useQueryClient();
    const { reportWindow, metric, setRange, setCustom, setMetric } = useAdPerformanceSearch();

    useEffect(() => {
        setNavHeading(t('ads.navTitle'));
    }, [setNavHeading, t]);

    // ── OAuth return → account picker ───────────────────────────────────────
    const oauth = useOAuthReturn();
    const [dialogOpen, setDialogOpen] = useState(() => !!oauth.sessionKey);
    useEffect(() => {
        if (oauth.sessionKey) setDialogOpen(true);
    }, [oauth.sessionKey]);

    // ── Accounts ────────────────────────────────────────────────────────────
    const accountsQuery = useAdAccounts();
    const accounts = useMemo(
        () => (accountsQuery.data ?? []).filter((a) => a.status !== 'DISCONNECTED'),
        [accountsQuery.data]
    );
    const attentionAccounts = useMemo(() => accounts.filter(accountNeedsAttention), [accounts]);
    const firstSyncCount = accounts.filter(accountFirstSyncPending).length;
    const lastSynced = latestSync(accounts);

    // ── Report ──────────────────────────────────────────────────────────────
    const hasAccounts = accounts.length > 0;
    const performance = useAdPerformance(reportWindow.from, reportWindow.to, hasAccounts);
    const report = performance.data;
    const currency =
        report?.currency || accounts.find((a) => a.currency)?.currency || FALLBACK_CURRENCY;

    // ── Sync + polling ──────────────────────────────────────────────────────
    const syncAll = useSyncAllAdAccounts();
    /** "Sync now" polling: when it was clicked and when to give up waiting (epoch ms). */
    const [syncAllRun, setSyncAllRun] = useState<{ startedAt: number; until: number } | null>(null);
    const [firstSyncWaitOver, setFirstSyncWaitOver] = useState(false);
    const pollingFirstSync = firstSyncCount > 0 && !firstSyncWaitOver;
    const polling = pollingFirstSync || syncAllRun !== null;

    useEffect(() => {
        const timer = window.setTimeout(() => setFirstSyncWaitOver(true), FIRST_SYNC_POLL_LIMIT_MS);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (!polling) return;
        const timer = window.setInterval(() => {
            void queryClient.invalidateQueries({ queryKey: marketingKeys.adAccounts() });
        }, POLL_MS);
        return () => window.clearInterval(timer);
    }, [polling, queryClient]);

    // Stop the "Sync now" wait at its deadline, or as soon as every active account has
    // synced since the click.
    useEffect(() => {
        if (!syncAllRun) return;
        const active = accounts.filter((a) => a.status === 'ACTIVE');
        const allDone =
            active.length > 0 &&
            active.every(
                (a) =>
                    !!a.last_synced_at &&
                    new Date(a.last_synced_at).getTime() >= syncAllRun.startedAt
            );
        if (allDone) {
            setSyncAllRun(null);
            return;
        }
        const timer = window.setTimeout(
            () => setSyncAllRun(null),
            Math.max(0, syncAllRun.until - Date.now())
        );
        return () => window.clearTimeout(timer);
    }, [syncAllRun, accounts]);

    // New spend landed (a sync finished): refresh the report.
    const previousSync = useRef<string | null | undefined>(undefined);
    useEffect(() => {
        if (!accountsQuery.isSuccess) return;
        const signature = `${lastSynced ?? ''}|${firstSyncCount}`;
        if (previousSync.current !== undefined && previousSync.current !== signature) {
            void queryClient.invalidateQueries({ queryKey: marketingKeys.adPerformanceAll() });
        }
        previousSync.current = signature;
    }, [accountsQuery.isSuccess, lastSynced, firstSyncCount, queryClient]);

    const onSyncAll = () => {
        const startedAt = Date.now();
        syncAll.mutate(undefined, {
            onSuccess: (data) => {
                if ((data?.queued ?? 0) > 0)
                    setSyncAllRun({ startedAt, until: Date.now() + SYNC_ALL_POLL_MS });
            },
        });
    };

    const syncBusy = syncAll.isPending || syncAllRun !== null;
    const lastSyncedText = formatRelativeTime(lastSynced, i18n.language);

    // ── Render ──────────────────────────────────────────────────────────────
    const dialog = (
        <ConnectAccountsDialog
            sessionKey={oauth.sessionKey}
            provider={oauth.provider}
            open={dialogOpen && !!oauth.sessionKey}
            onOpenChange={(open) => {
                setDialogOpen(open);
                if (!open) oauth.clear();
            }}
        />
    );

    const header = (
        <ScreenHeader
            icon={ChartLineUp}
            title={t('ads.title')}
            subtitle={t('ads.subtitle')}
            actions={
                hasAccounts ? (
                    <>
                        <span
                            className="text-caption text-neutral-500"
                            title={formatTimestamp(lastSynced, i18n.language) ?? undefined}
                        >
                            {syncBusy
                                ? t('ads.sync.syncing')
                                : lastSyncedText
                                  ? t('ads.sync.lastSynced', { time: lastSyncedText })
                                  : t('ads.sync.never')}
                        </span>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            className="gap-1.5"
                            disable={syncBusy}
                            onClick={onSyncAll}
                        >
                            <ArrowsClockwise size={16} className={cn(syncBusy && 'animate-spin')} />
                            {t('ads.sync.now')}
                        </MyButton>
                    </>
                ) : undefined
            }
        />
    );

    if (accountsQuery.isLoading) {
        return (
            <>
                <PageSkeleton />
                {dialog}
            </>
        );
    }

    if (accountsQuery.isError) {
        return (
            <div className="flex flex-col gap-6">
                {header}
                <ErrorBlock
                    message={marketingErrorMessage(
                        accountsQuery.error,
                        t('ads.states.accountsError')
                    )}
                    onRetry={() => void accountsQuery.refetch()}
                />
                {dialog}
            </div>
        );
    }

    if (!hasAccounts) {
        return (
            <div className="flex flex-col gap-6">
                {header}
                <ConnectEmptyState />
                {dialog}
            </div>
        );
    }

    const refreshing = performance.isFetching && performance.isPlaceholderData;

    return (
        <div className="flex flex-col gap-6">
            {header}

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <AccountChips accounts={accounts} />
                    <ConnectProviderMenu kind="ads" scale="small" />
                </div>
                <RangeControls
                    window={reportWindow}
                    onRangeChange={setRange}
                    onCustomChange={setCustom}
                />
            </div>

            {attentionAccounts.length > 0 && <ReconnectAlert accounts={attentionAccounts} />}

            {report?.mixed_currency && (
                <p className="flex items-start gap-2 rounded-lg bg-info-50 px-3 py-2 text-caption text-info-700">
                    <Info size={16} className="mt-0.5 shrink-0" />
                    {t('ads.mixedCurrency', { currency })}
                </p>
            )}

            {performance.isLoading ? (
                <ReportSkeleton />
            ) : performance.isError && !report ? (
                <ErrorBlock
                    message={marketingErrorMessage(performance.error, t('ads.states.reportError'))}
                    onRetry={() => void performance.refetch()}
                />
            ) : report ? (
                <div
                    className={cn(
                        'flex flex-col gap-4 transition-opacity',
                        refreshing && 'opacity-60'
                    )}
                    aria-busy={refreshing}
                >
                    <KpiCards
                        totals={report.totals}
                        currency={currency}
                        accountCount={accounts.length}
                    />
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <DailyChartCard
                            daily={report.daily ?? []}
                            from={report.from || reportWindow.from}
                            to={report.to || reportWindow.to}
                            metric={metric}
                            onMetricChange={setMetric}
                            currency={currency}
                            firstSyncPending={firstSyncCount > 0}
                        />
                        <SuggestionCard
                            suggestion={report.suggestion}
                            platforms={report.platforms ?? []}
                            currency={currency}
                        />
                    </div>
                    <PlatformTable
                        platforms={report.platforms ?? []}
                        campaigns={report.campaigns ?? []}
                        unattributed={report.unattributed ?? null}
                        currency={currency}
                    />
                </div>
            ) : null}

            {dialog}
        </div>
    );
}
