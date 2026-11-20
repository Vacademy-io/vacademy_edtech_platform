import { useTranslation } from 'react-i18next';
import {
    ArrowRight,
    BellSlash,
    CalendarBlank,
    CreditCard,
    LockSimple,
    LockSimpleOpen,
    Receipt,
    WarningCircle,
    XCircle,
} from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import type { BreakPreview } from '@/services/enrolment-breaks';
import { formatDay, formatInstant } from './break-utils';

interface BreakEffectsPanelProps {
    preview?: BreakPreview;
    isLoading: boolean;
    /** 'create' explains a new break; 'resume' explains what the resume changes. */
    mode: 'create' | 'resume';
}

const Line = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
    <li className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-neutral-500">{icon}</span>
        <span>{children}</span>
    </li>
);

const DateMove = ({ from, to }: { from: string | null; to: string | null }) => (
    <span className="inline-flex flex-wrap items-center gap-1 font-semibold text-neutral-800">
        {formatInstant(from) || '—'}
        <ArrowRight className="size-3 text-neutral-400" aria-hidden />
        {formatInstant(to) || '—'}
    </span>
);

/**
 * "What will happen", worded from the server's preview so the admin sees the exact dates
 * before saving. Blockers (red) explain why Save is off; warnings (amber) never block.
 */
export const BreakEffectsPanel = ({ preview, isLoading, mode }: BreakEffectsPanelProps) => {
    const { t } = useTranslation('manageStudentsBreaks');

    if (isLoading && !preview) {
        return (
            <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
            </div>
        );
    }
    if (!preview) return null;

    const pause = preview.kind === 'PAUSE';
    const datesMove =
        pause &&
        preview.plan_end_now &&
        preview.plan_end_after &&
        preview.plan_end_now !== preview.plan_end_after;
    const nextMoves =
        pause &&
        preview.next_charge_now &&
        preview.next_charge_after &&
        preview.next_charge_now !== preview.next_charge_after;

    return (
        <div className="space-y-3" aria-live="polite">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <h4 className="mb-2 text-caption font-semibold uppercase text-neutral-500">
                    {t('preview.title')}
                </h4>
                <ul className="space-y-1.5 text-body text-neutral-700">
                    {mode === 'create' && (
                        <Line icon={<CalendarBlank className="size-4" />}>
                            {preview.starts_today
                                ? t('preview.startsToday')
                                : t('preview.startsOn', {
                                      date: formatDay(preview.starts_on),
                                  })}{' '}
                            {preview.ends_on
                                ? t('preview.lastDay', {
                                      date: formatDay(preview.ends_on),
                                      count: preview.days ?? 0,
                                  })
                                : t('preview.untilResumed')}
                        </Line>
                    )}
                    {mode === 'resume' && preview.paused_days !== null && (
                        <Line icon={<CalendarBlank className="size-4" />}>
                            {t(pause ? 'preview.pausedFor' : 'preview.heldFor', {
                                count: preview.paused_days,
                            })}
                        </Line>
                    )}
                    {preview.stop_class_reminders && (
                        <Line icon={<BellSlash className="size-4" />}>
                            {mode === 'create'
                                ? t('preview.classStops')
                                : t('preview.classRestarts')}
                        </Line>
                    )}
                    {preview.stop_fee_reminders && (
                        <Line icon={<BellSlash className="size-4" />}>
                            {mode === 'create' ? t('preview.feeStops') : t('preview.feeRestarts')}
                        </Line>
                    )}
                    {pause &&
                        (preview.remove_access ? (
                            <Line icon={<LockSimple className="size-4" />}>
                                {mode === 'create'
                                    ? t('preview.accessOff')
                                    : t('preview.accessBack')}
                            </Line>
                        ) : (
                            mode === 'create' && (
                                <Line icon={<LockSimpleOpen className="size-4" />}>
                                    {t('preview.accessStays')}
                                </Line>
                            )
                        ))}
                    {pause && mode === 'create' && (
                        <Line icon={<CreditCard className="size-4" />}>
                            {t('preview.billingStops')}
                        </Line>
                    )}
                    {datesMove && (
                        <Line icon={<CalendarBlank className="size-4" />}>
                            {mode === 'create'
                                ? t('preview.endMovesOnReturn')
                                : t('preview.endMoves')}{' '}
                            <DateMove from={preview.plan_end_now} to={preview.plan_end_after} />
                        </Line>
                    )}
                    {nextMoves && (
                        <Line icon={<CreditCard className="size-4" />}>
                            {t('preview.nextPaymentMoves')}{' '}
                            <DateMove
                                from={preview.next_charge_now}
                                to={preview.next_charge_after}
                            />
                        </Line>
                    )}
                    {mode === 'resume' && preview.unpaid_instalments_moved > 0 && (
                        <Line icon={<Receipt className="size-4" />}>
                            {t('preview.instalmentsMove', {
                                count: preview.unpaid_instalments_moved,
                            })}
                        </Line>
                    )}
                    {mode === 'resume' && pause && !datesMove && !nextMoves && (
                        <Line icon={<CalendarBlank className="size-4" />}>
                            {t('preview.datesUnchanged')}
                        </Line>
                    )}
                </ul>
            </div>

            {preview.warnings.map((code) => (
                <div
                    key={code}
                    className="flex items-start gap-2 rounded-md bg-warning-50 p-3 text-caption text-warning-700 ring-1 ring-warning-200"
                >
                    <WarningCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{t(`warnings.${code}`, { defaultValue: code })}</span>
                </div>
            ))}
            {preview.blockers.map((code) => (
                <div
                    key={code}
                    role="alert"
                    className="flex items-start gap-2 rounded-md bg-danger-50 p-3 text-caption text-danger-700 ring-1 ring-danger-200"
                >
                    <XCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{t(`blockers.${code}`, { defaultValue: code })}</span>
                </div>
            ))}
        </div>
    );
};
