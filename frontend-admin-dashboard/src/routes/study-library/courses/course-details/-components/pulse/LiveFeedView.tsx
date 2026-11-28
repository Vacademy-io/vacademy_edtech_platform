import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/utils';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import { pulseFeedQueryOptions } from '../../-services/pulse-services';
import type { PulseFeedEvent } from '../../-types/pulse-types';
import { LiveStatusLine, PulseMessage, slideIconFor } from './pulse-shared';

const VERB_KEYS: Record<string, string> = {
    SUBMITTED_ASSIGNMENT: 'verbs.submitted',
    SUBMITTED_ASSESSMENT: 'verbs.submitted',
    CODE_SUBMISSION: 'verbs.ran',
    ANSWERED_QUESTION: 'verbs.answered',
    ANSWERED_QUIZ: 'verbs.answered',
};

/** Tone from the event's detail text (verdict / answer status). */
function toneFor(event: PulseFeedEvent): string {
    const d = (event.detail ?? '').toLowerCase();
    if (/(wrong|incorrect|fail|wa|tle|error|late)/.test(d)) return 'text-danger-600';
    if (/(correct|accept|passed|ac|all )/.test(d)) return 'text-success-600';
    return 'text-neutral-400';
}

function formatClock(epochMs: number, language: string): string {
    return new Date(epochMs).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
}

function EventRow({ event, t }: { event: PulseFeedEvent; t: TFunction }) {
    const { i18n } = useTranslation('studyLibraryLiveFeedView');
    const Icon = slideIconFor(event.slideType);
    const verb = t(VERB_KEYS[event.eventType] ?? 'verbs.updated');
    return (
        <div className="flex items-baseline gap-3 border-b border-neutral-100 px-4 py-2.5 last:border-b-0">
            <time className="w-12 shrink-0 text-xs tabular-nums text-neutral-400">
                {formatClock(event.occurredAtEpoch, i18n.language)}
            </time>
            <Icon size={15} className="shrink-0 translate-y-0.5 text-neutral-400" />
            <p className="min-w-0 flex-1 text-sm text-neutral-700">
                <span className="font-semibold">{event.fullName ?? t('aLearner')}</span> {verb}{' '}
                <span className="text-neutral-500">{event.slideTitle ?? t('aSlide')}</span>
                {event.detail && (
                    <span className={cn('font-medium', toneFor(event))}> · {event.detail}</span>
                )}
            </p>
        </div>
    );
}

export default function LiveFeedView({ batchId, active }: { batchId: string; active: boolean }) {
    const { t } = useTranslation('studyLibraryLiveFeedView');
    const { data, isLoading, isError, refetch, dataUpdatedAt, isFetching } = useQuery(
        pulseFeedQueryOptions(batchId, active)
    );

    const secondsSinceFetch = dataUpdatedAt
        ? Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000))
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
                    title={t('loadError')}
                    action={
                        <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                            {t('retry')}
                        </MyButton>
                    }
                />
            </div>
        );
    }

    const events = data?.events ?? [];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <LiveStatusLine secondsSinceFetch={secondsSinceFetch} isFetching={isFetching} />
                <p className="text-xs text-neutral-400">
                    {t('windowSummary', { count: data?.windowMinutes ?? 15 })}
                </p>
            </div>

            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                {events.length === 0 ? (
                    <PulseMessage
                        title={t('emptyTitle')}
                        subtitle={t('emptySubtitle')}
                    />
                ) : (
                    events.map((e, i) => (
                        <EventRow key={`${e.userId}-${e.occurredAtEpoch}-${i}`} event={e} t={t} />
                    ))
                )}
            </div>
        </div>
    );
}
