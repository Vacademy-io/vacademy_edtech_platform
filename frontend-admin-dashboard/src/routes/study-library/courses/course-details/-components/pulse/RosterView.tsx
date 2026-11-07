import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import { pulseSummaryQueryOptions } from '../../-services/pulse-services';
import type { PulseRosterRow, PulseState } from '../../-types/pulse-types';
import {
    formatDuration,
    initialsOf,
    KpiCard,
    LiveStatusLine,
    PulseMessage,
    slideIconFor,
    useSecondsTicker,
} from './pulse-shared';

function useStateMeta(t: (key: string) => string): Record<PulseState, { label: string; chip: string; rail: string }> {
    return {
        NEEDS_HELP: { label: t('needsHelp'), chip: 'bg-danger-50 text-danger-600', rail: 'bg-danger-500' },
        IDLE: { label: t('idle'), chip: 'bg-warning-50 text-warning-600', rail: 'bg-warning-500' },
        ACTIVE: { label: t('active'), chip: 'bg-success-50 text-success-600', rail: 'bg-success-500' },
    };
}

function RosterRow({ row, secondsSinceFetch }: { row: PulseRosterRow; secondsSinceFetch: number }) {
    const { t } = useTranslation('studyLibraryPulseRosterView');
    const meta = useStateMeta(t)[row.state];
    const Icon = slideIconFor(row.slideType);
    const liveSeconds = row.onSlideSeconds + secondsSinceFetch;

    return (
        <div className="relative flex items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0 hover:bg-neutral-50">
            <span className={cn('absolute inset-y-0 left-0 w-1', meta.rail)} />
            <div
                className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    meta.chip
                )}
            >
                {initialsOf(row.fullName)}
            </div>

            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-700">
                    {row.fullName ?? t('unknownLearner')}
                </p>
                <p className="flex items-center gap-1.5 truncate text-xs text-neutral-500">
                    <Icon size={14} className="shrink-0 text-neutral-400" />
                    <span className="truncate">{row.slideTitle ?? t('untitledSlide')}</span>
                </p>
            </div>

            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', meta.chip)}>
                {meta.label}
            </span>

            <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums text-neutral-600">
                {formatDuration(liveSeconds)}
            </span>
        </div>
    );
}

export default function RosterView({ batchId }: { batchId: string }) {
    const { t } = useTranslation('studyLibraryPulseRosterView');
    const { data, isLoading, isError, refetch, dataUpdatedAt, isFetching } = useQuery(
        pulseSummaryQueryOptions(batchId)
    );

    const now = useSecondsTicker();
    const secondsSinceFetch = dataUpdatedAt
        ? Math.max(0, Math.floor((now - dataUpdatedAt) / 1000))
        : 0;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center rounded-md bg-white p-10 shadow-sm">
                <DashboardLoader />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
                <PulseMessage
                    tone="danger"
                    title={t('couldNotLoadLivePulse')}
                    subtitle={t('checkConnectionAndRetry')}
                    action={
                        <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                            {t('retry')}
                        </MyButton>
                    }
                />
            </div>
        );
    }

    const counts = data?.counts;
    const roster = data?.roster ?? [];

    return (
        <div className="flex flex-col gap-4">
            <LiveStatusLine secondsSinceFetch={secondsSinceFetch} isFetching={isFetching} />

            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
                <KpiCard label={t('activeNow')} value={counts?.active ?? 0} hint={t('seenInLast2Min')} tone="bg-success-500" />
                <KpiCard label={t('idle')} value={counts?.idle ?? 0} hint={t('openNotEngaging')} tone="bg-warning-500" />
                <KpiCard label={t('offline')} value={counts?.offline ?? 0} hint={t('ofEnrolled', { count: counts?.enrolled ?? 0 })} tone="bg-neutral-300" />
                <KpiCard label={t('needHelp')} value={counts?.needHelp ?? 0} hint={t('stuckOnASlide')} tone="bg-danger-500" />
                <KpiCard label={t('enrolled')} value={counts?.enrolled ?? 0} hint={t('inThisBatch')} tone="bg-primary-500" />
            </div>

            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {t('rosterNeedsAttentionFirst')}
                    </p>
                    {data && data.totalPresent > roster.length && (
                        <p className="text-xs text-neutral-400">
                            {t('showingOfActive', { showing: roster.length, total: data.totalPresent })}
                        </p>
                    )}
                </div>

                {roster.length === 0 ? (
                    <PulseMessage
                        title={t('noOneActiveInBatch')}
                        subtitle={t('learnersAppearHere')}
                    />
                ) : (
                    roster.map((row) => (
                        <RosterRow key={row.userId} row={row} secondsSinceFetch={secondsSinceFetch} />
                    ))
                )}
            </div>
        </div>
    );
}
