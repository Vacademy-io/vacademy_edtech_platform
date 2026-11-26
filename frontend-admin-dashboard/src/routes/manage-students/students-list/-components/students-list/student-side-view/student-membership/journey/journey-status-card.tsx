import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDown, CaretRight, Compass } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { JourneyStatusBadge } from '@/components/shared/journey-status-badge';
import {
    findJourneyStatus,
    findReentryStatus,
    useJourneyStatusSettings,
    useLearnerJourney,
    type JourneyEnrolment,
} from '@/services/journey-status';
import { formatDay, formatInstant } from '../breaks/break-utils';
import { ChangeJourneyStatusDialog } from './change-journey-status-dialog';
import { StartReentryDialog } from './start-reentry-dialog';

interface JourneyStatusCardProps {
    userId: string;
    instituteId: string;
    learnerName?: string;
}

/**
 * The learner's journey status in each current batch, a "Change status" action and the journey
 * history (imported journey cases and every change since). Renders nothing unless Settings →
 * Journey status is on.
 */
export const JourneyStatusCard = ({ userId, instituteId, learnerName }: JourneyStatusCardProps) => {
    const { t } = useTranslation('manageStudentsJourney');
    const { enabled, settings } = useJourneyStatusSettings();
    const { data, isLoading, isError, refetch } = useLearnerJourney(userId, instituteId, enabled);
    const [changeFor, setChangeFor] = useState<{ batch: string | null; status: string | null } | null>(
        null
    );
    const [showHistory, setShowHistory] = useState(false);
    /** Open re-entry form: the batch it starts on (null = let staff choose). */
    const [reentryFor, setReentryFor] = useState<{ batch: string | null } | null>(null);

    if (!userId || !enabled) return null;

    const enrolments = data?.enrolments ?? [];
    const reentryStatus = findReentryStatus(settings);
    const canReentry = Boolean(reentryStatus) && enrolments.some((e) => !e.extra_class);
    const history = data?.history ?? [];
    const batchLabel = (psId: string | null) =>
        enrolments.find((e) => e.package_session_id === psId)?.course_label ?? null;

    const subline = (e: JourneyEnrolment) => {
        const parts: string[] = [];
        if (e.since && !e.is_default) parts.push(t('card.since', { date: formatInstant(e.since) }));
        if (e.next_action_date) parts.push(t('card.nextAction', { date: formatDay(e.next_action_date) }));
        if (e.source === 'AUTO_RISK') parts.push(t('card.byRiskCheck'));
        if (e.source === 'BREAK') parts.push(t('card.byBreak'));
        if (e.source === 'REENTRY') parts.push(t('card.byReentry'));
        if (e.source === 'AUTO_RETURN') parts.push(t('card.byReentryReturn'));
        return parts.join(' · ');
    };

    return (
        <section
            className="rounded-lg border border-neutral-200 bg-card p-3"
            aria-labelledby="journey-status-title"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                    <span className="rounded-md bg-primary-50 p-1.5 text-primary-500">
                        <Compass className="size-4" />
                    </span>
                    <div className="min-w-0">
                        <h3
                            id="journey-status-title"
                            className="text-body font-semibold text-neutral-800"
                        >
                            {t('card.title')}
                        </h3>
                        <p className="text-caption text-neutral-500">{t('card.subtitle')}</p>
                    </div>
                </div>
                {!isLoading && !isError && enrolments.length > 0 && (
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        {canReentry && (
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                onClick={() => setReentryFor({ batch: null })}
                            >
                                {t('card.startReentry')}
                            </MyButton>
                        )}
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setChangeFor({ batch: null, status: null })}
                        >
                            {t('card.change')}
                        </MyButton>
                    </div>
                )}
            </div>

            <div className="mt-3 space-y-2">
                {isLoading && <Skeleton className="h-12 w-full" />}

                {isError && (
                    <div className="flex items-center justify-between gap-2 rounded-md bg-danger-50 p-3 text-caption text-danger-700 ring-1 ring-danger-200">
                        <span>{t('card.error')}</span>
                        <MyButton type="button" buttonType="text" scale="small" onClick={() => refetch()}>
                            {t('card.retry')}
                        </MyButton>
                    </div>
                )}

                {!isLoading && !isError && enrolments.length === 0 && (
                    <p className="rounded-md bg-neutral-50 p-3 text-caption text-neutral-500">
                        {t('card.noBatches')}
                    </p>
                )}

                {enrolments.length > 0 && (
                    <ul className="divide-y divide-neutral-100">
                        {enrolments.map((e) => (
                            <li
                                key={e.package_session_id}
                                className="flex items-start justify-between gap-3 py-2"
                            >
                                <div className="min-w-0 space-y-1">
                                    <p className="truncate text-caption text-neutral-600">
                                        {e.course_label || t('card.unnamedBatch')}
                                    </p>
                                    <JourneyStatusBadge
                                        def={findJourneyStatus(settings, e.status_key)}
                                        fallbackLabel={e.status_key}
                                    />
                                    {e.reason && (
                                        <p className="text-caption text-neutral-600">{e.reason}</p>
                                    )}
                                    {subline(e) && (
                                        <p className="text-caption text-neutral-500">{subline(e)}</p>
                                    )}
                                </div>
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    onClick={() =>
                                        setChangeFor({
                                            batch: e.package_session_id,
                                            status: e.status_key,
                                        })
                                    }
                                >
                                    {t('card.changeOne')}
                                </MyButton>
                            </li>
                        ))}
                    </ul>
                )}

                {history.length > 0 && (
                    <div className="border-t border-neutral-100 pt-2">
                        <button
                            type="button"
                            onClick={() => setShowHistory((v) => !v)}
                            className="flex items-center gap-1 rounded-sm text-caption font-semibold text-neutral-600 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                            aria-expanded={showHistory}
                        >
                            {showHistory ? (
                                <CaretDown className="size-3" />
                            ) : (
                                <CaretRight className="size-3 rtl:rotate-180" />
                            )}
                            {t('card.history', { count: history.length })}
                        </button>
                        {showHistory && (
                            <ul className="mt-1 divide-y divide-neutral-100">
                                {history.map((h) => (
                                    <li key={h.id} className="space-y-0.5 py-2 text-caption">
                                        <div className="flex items-start justify-between gap-3">
                                            <span className="font-semibold text-neutral-800">
                                                {h.from_status && h.from_status !== h.to_status
                                                    ? `${h.from_status} → ${h.to_status ?? ''}`
                                                    : h.to_status ?? h.title}
                                            </span>
                                            <span className="shrink-0 text-neutral-500">
                                                {formatInstant(h.created_at)}
                                            </span>
                                        </div>
                                        {batchLabel(h.package_session_id) && (
                                            <p className="text-neutral-500">
                                                {batchLabel(h.package_session_id)}
                                            </p>
                                        )}
                                        {h.reason && <p className="text-neutral-600">{h.reason}</p>}
                                        <p className="text-neutral-500">
                                            {[
                                                h.case_status
                                                    ? t('card.importedCase', { status: h.case_status })
                                                    : null,
                                                h.next_action_date
                                                    ? t('card.nextAction', {
                                                          date: formatDay(h.next_action_date),
                                                      })
                                                    : null,
                                                h.actor_name,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>

            {changeFor && (
                <ChangeJourneyStatusDialog
                    onClose={() => setChangeFor(null)}
                    instituteId={instituteId}
                    settings={settings}
                    userIds={[userId]}
                    batches={enrolments.map((e) => ({
                        package_session_id: e.package_session_id,
                        course_label: e.course_label,
                    }))}
                    initialBatch={changeFor.batch}
                    initialStatus={changeFor.status}
                    heading={
                        learnerName ? t('dialog.titleFor', { name: learnerName }) : undefined
                    }
                    onReentry={
                        canReentry
                            ? (batch) => {
                                  setChangeFor(null);
                                  setReentryFor({ batch });
                              }
                            : undefined
                    }
                />
            )}

            {reentryFor && (
                <StartReentryDialog
                    onClose={() => setReentryFor(null)}
                    userId={userId}
                    instituteId={instituteId}
                    settings={settings}
                    enrolments={enrolments}
                    initialBatch={reentryFor.batch}
                    learnerName={learnerName}
                />
            )}
        </section>
    );
};
