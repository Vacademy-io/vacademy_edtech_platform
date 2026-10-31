import { useTranslation } from 'react-i18next';
import { CalendarBlank, ListChecks, PaperPlaneTilt, Users, Warning } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { relativeDayOf, type ComposerForm } from '../forms/composer-schema';
import { formatDay, formatDayRange, formatNumber, slotRunDates } from '../../-utils/format';

/**
 * "Publish this plan?" — the last look before learners see it: which batch, how many
 * learners, how many tasks over which dates, and anything that will surprise the
 * teacher (days already over, dates past the daily cap).
 */

export interface PublishSummary {
    /** Batch names; several on a create for more than one batch. */
    batchLabels: string[];
    /** Learners in the batch, when known (edit). */
    learnerCount?: number | null;
    /** Distinct dates any day of the plan runs on. */
    runDates: number;
    /** Days (slots) in the plan. */
    dayCount: number;
    /** Tasks across every day (a repeating day's task counts once). */
    taskCount: number;
    firstDate: string | null;
    lastDate: string | null;
    /** The first date on or after today, when the plan starts in the past. */
    startsOn: string | null;
    /** Run dates already before today. */
    pastDates: number;
    /** Run dates with more tasks than the daily cap. */
    overCapDates: number;
    dailyItemCap?: number | null;
    /**
     * A join-based plan: first/last are "Day N" numbers, and nothing is "already over"
     * (each learner starts on their own Day 1).
     */
    relative?: { firstDay: number; lastDay: number } | null;
}

const MAX_DATES = 400;

/** The numbers the publish confirm shows, from the form as it will be saved. */
export function buildPublishSummary(
    form: Pick<ComposerForm, 'slots'> & Partial<Pick<ComposerForm, 'scheduleMode'>>,
    options: {
        batchLabels: string[];
        learnerCount?: number | null;
        today: string;
        dailyItemCap?: number | null;
    }
): PublishSummary {
    const perDate = new Map<string, number>();
    let taskCount = 0;
    for (const slot of form.slots) {
        taskCount += slot.items.length;
        for (const date of slotRunDates(slot, MAX_DATES)) {
            perDate.set(date, (perDate.get(date) ?? 0) + slot.items.length);
        }
    }
    const dates = [...perDate.keys()].sort();
    const cap = options.dailyItemCap;
    if (form.scheduleMode === 'RELATIVE') {
        const firstDay = relativeDayOf(dates[0]) ?? 1;
        const lastDay = relativeDayOf(dates[dates.length - 1]) ?? firstDay;
        return {
            batchLabels: options.batchLabels,
            learnerCount: options.learnerCount ?? null,
            runDates: dates.length,
            dayCount: form.slots.length,
            taskCount,
            firstDate: null,
            lastDate: null,
            startsOn: null,
            pastDates: 0,
            overCapDates:
                cap && cap > 0 ? dates.filter((date) => perDate.get(date)! > cap).length : 0,
            dailyItemCap: cap ?? null,
            relative: { firstDay, lastDay },
        };
    }
    return {
        batchLabels: options.batchLabels,
        learnerCount: options.learnerCount ?? null,
        runDates: dates.length,
        dayCount: form.slots.length,
        taskCount,
        firstDate: dates[0] ?? null,
        lastDate: dates[dates.length - 1] ?? null,
        startsOn: dates.find((date) => date >= options.today) ?? null,
        pastDates: dates.filter((date) => date < options.today).length,
        overCapDates: cap && cap > 0 ? dates.filter((date) => perDate.get(date)! > cap).length : 0,
        dailyItemCap: cap ?? null,
    };
}

export interface PublishSummaryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    summary: PublishSummary | null;
    /** Saves as Published. The dialog closes when it settles. */
    onConfirm: () => Promise<void>;
}

export function PublishSummaryDialog({
    open,
    onOpenChange,
    summary,
    onConfirm,
}: PublishSummaryDialogProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;

    const batch =
        !summary || summary.batchLabels.length === 0
            ? t('composer.thisBatch')
            : summary.batchLabels.length === 1
              ? summary.batchLabels[0]!
              : t('composer.publishSummary.batches', { count: summary.batchLabels.length });

    const range =
        summary?.firstDate && summary.lastDate
            ? formatDayRange(summary.firstDate, summary.lastDate, lang)
            : '';

    return (
        <MyDialog
            heading={t('composer.publishSummary.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('composer.publishSummary.back')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={onConfirm}
                        loadingText={t('composer.saving')}
                        disable={!summary}
                    >
                        <PaperPlaneTilt size={16} aria-hidden />{' '}
                        {t('composer.publishSummary.confirm')}
                    </MyButton>
                </>
            }
        >
            {summary && (
                <div className="space-y-4">
                    <p className="text-body text-neutral-700">
                        {summary.relative
                            ? t('composer.relative.publishLead', {
                                  batch,
                                  last: summary.relative.lastDay,
                              })
                            : summary.startsOn
                              ? t('composer.publishSummary.lead', {
                                    batch,
                                    date: formatDay(summary.startsOn, lang),
                                })
                              : t('composer.publishSummary.leadOver', { batch })}
                    </p>

                    <dl className="grid grid-cols-3 gap-2">
                        <div className="min-w-0 rounded-lg border border-neutral-200 p-2 sm:p-3">
                            <dt className="flex items-center gap-1.5 text-caption text-neutral-500">
                                <Users size={14} aria-hidden />
                                {t('composer.publishSummary.learnersLabel')}
                            </dt>
                            <dd className="mt-1 text-subtitle font-semibold text-neutral-900">
                                {summary.learnerCount != null
                                    ? formatNumber(summary.learnerCount, lang)
                                    : t('composer.publishSummary.learnersUnknown')}
                            </dd>
                        </div>
                        <div className="min-w-0 rounded-lg border border-neutral-200 p-2 sm:p-3">
                            <dt className="flex items-center gap-1.5 text-caption text-neutral-500">
                                <CalendarBlank size={14} aria-hidden />
                                {t('composer.publishSummary.daysLabel')}
                            </dt>
                            <dd className="mt-1 text-subtitle font-semibold text-neutral-900">
                                {formatNumber(summary.runDates, lang)}
                            </dd>
                        </div>
                        <div className="min-w-0 rounded-lg border border-neutral-200 p-2 sm:p-3">
                            <dt className="flex items-center gap-1.5 text-caption text-neutral-500">
                                <ListChecks size={14} aria-hidden />
                                {t('composer.publishSummary.tasksLabel')}
                            </dt>
                            <dd className="mt-1 text-subtitle font-semibold text-neutral-900">
                                {formatNumber(summary.taskCount, lang)}
                            </dd>
                        </div>
                    </dl>

                    {range && (
                        <p className="text-caption text-neutral-600">
                            {t('composer.publishSummary.range', {
                                range,
                                count: summary.dayCount,
                            })}
                        </p>
                    )}

                    {(summary.pastDates > 0 || summary.overCapDates > 0) && (
                        <ul className="space-y-2">
                            {summary.pastDates > 0 && (
                                <li className="flex items-start gap-2 rounded-md bg-warning-50 px-3 py-2 text-caption text-warning-700">
                                    <Warning size={16} className="mt-0.5 shrink-0" aria-hidden />
                                    {t('composer.publishSummary.pastDates', {
                                        count: summary.pastDates,
                                    })}
                                </li>
                            )}
                            {summary.overCapDates > 0 && summary.dailyItemCap && (
                                <li className="flex items-start gap-2 rounded-md bg-warning-50 px-3 py-2 text-caption text-warning-700">
                                    <Warning size={16} className="mt-0.5 shrink-0" aria-hidden />
                                    {t('composer.publishSummary.overCap', {
                                        count: summary.overCapDates,
                                        cap: summary.dailyItemCap,
                                    })}
                                </li>
                            )}
                        </ul>
                    )}

                    <p className="text-caption text-neutral-500">
                        {t('composer.publishSummary.note')}
                    </p>
                </div>
            )}
        </MyDialog>
    );
}
