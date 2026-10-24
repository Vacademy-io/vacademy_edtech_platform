import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDown, Coins, Info, Prohibit, Wallet, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { LmsVideoEstimateResponse } from '@/services/lms-ai-video';
import {
    effectiveOrientation,
    effectiveTeacher,
    summariseEstimate,
    type AiVideoFormState,
} from './ai-video-form';
import { Notice } from './ai-video-ui';
import { DURATION_KEY } from './step-format';

const NS = 'studyLibraryAddAiVideoDialog';

export function StepReview({
    state,
    estimate,
    estimateLoading,
    estimateError,
    onRetryEstimate,
    submitError,
    onEdit,
    canEdit,
}: {
    state: AiVideoFormState;
    estimate: LmsVideoEstimateResponse | undefined;
    /** True while the estimate is being fetched or the inputs changed since. */
    estimateLoading: boolean;
    estimateError: string | null;
    onRetryEstimate: () => void;
    submitError: string | null;
    /** Jump back to step 0 (what to teach) or 1 (format). */
    onEdit: (step: 0 | 1) => void;
    /** False once the video has started — edits would no longer apply. */
    canEdit: boolean;
}) {
    const { t, i18n } = useTranslation(NS);
    const locale = i18n.resolvedLanguage || i18n.language || 'en';
    const [breakdownOpen, setBreakdownOpen] = useState(false);
    const credits = (value: number) =>
        new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
    const teacher = effectiveTeacher(state);
    const sourceCount = state.sourceSlideIds.length;
    const fileCount = state.referenceFiles.length;

    const rows: Array<{ label: string; value: string; step: 0 | 1 }> = [
        { label: t('review.summary.topic'), value: state.topic.trim(), step: 0 },
        {
            label: t('review.summary.sources'),
            value:
                sourceCount + fileCount === 0 && !state.notes.trim()
                    ? t('review.summary.noSources')
                    : t('review.summary.sourcesValue', {
                          slides: sourceCount,
                          files: fileCount,
                      }) + (state.notes.trim() ? ` · ${t('review.summary.withNotes')}` : ''),
            step: 0,
        },
        { label: t('review.summary.language'), value: state.language, step: 0 },
        {
            label: t('review.summary.format'),
            value: `${t(`format.options.${state.format}.label`)} · ${t(
                `format.advanced.orientation.${effectiveOrientation(state)}`
            )}`,
            step: 1,
        },
        {
            label: t('review.summary.teacher'),
            value:
                teacher?.name ||
                (teacher ? t('review.summary.teacherPicked') : t('review.summary.noTeacher')),
            step: 1,
        },
        {
            label: t('review.summary.length'),
            value: `${t(`format.duration.options.${DURATION_KEY[state.duration]}`)} · ${t(
                `format.quality.options.${state.quality}.label`
            )}`,
            step: 1,
        },
    ];

    const summary = estimate ? summariseEstimate(estimate.estimate) : null;
    const rawBalance = estimate?.balance?.current_balance;
    const balance =
        typeof rawBalance === 'number' && Number.isFinite(rawBalance) ? rawBalance : null;

    return (
        <div className="flex flex-col gap-4">
            {submitError && (
                <Notice
                    tone="danger"
                    title={t('review.submitFailed')}
                    icon={<WarningCircle className="size-4" weight="fill" />}
                >
                    <p>{submitError}</p>
                </Notice>
            )}

            <section className="rounded-lg border border-border">
                <h3 className="border-b border-border px-4 py-2.5 text-sm font-medium text-foreground">
                    {t('review.summary.title')}
                </h3>
                <dl className="divide-y divide-border">
                    {rows.map((row) => (
                        <div key={row.label} className="flex items-start gap-3 px-4 py-2">
                            <dt className="w-24 shrink-0 text-xs text-muted-foreground sm:w-28">
                                {row.label}
                            </dt>
                            <dd className="min-w-0 flex-1 break-words text-sm text-foreground">
                                {row.value}
                            </dd>
                            {canEdit && (
                                <button
                                    type="button"
                                    onClick={() => onEdit(row.step)}
                                    className="shrink-0 text-xs font-medium text-primary-500 hover:text-primary-600 focus-visible:underline focus-visible:outline-none"
                                >
                                    {t('review.summary.edit')}
                                </button>
                            )}
                        </div>
                    ))}
                </dl>
            </section>

            <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
                <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Coins className="size-4 text-primary-500" />
                    {t('review.cost.title')}
                </h3>

                {estimateError && !estimateLoading ? (
                    <div className="flex flex-wrap items-center gap-3">
                        <p className="text-sm text-danger-600">{estimateError}</p>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={onRetryEstimate}
                        >
                            {t('review.cost.retry')}
                        </MyButton>
                    </div>
                ) : estimateLoading || !estimate || !summary ? (
                    <div className="flex flex-col gap-2" aria-busy="true">
                        <Skeleton className="h-7 w-40" />
                        <Skeleton className="h-4 w-56" />
                        <span className="sr-only">{t('review.cost.loading')}</span>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <div>
                                <p className="text-h3 font-semibold text-foreground">
                                    {summary.isRange
                                        ? t('review.cost.range', {
                                              low: credits(summary.low),
                                              high: credits(summary.high),
                                          })
                                        : t('review.cost.single', {
                                              value: credits(summary.expected),
                                          })}
                                </p>
                                {summary.isRange && (
                                    <p className="text-xs text-muted-foreground">
                                        {t('review.cost.expected', {
                                            value: credits(summary.expected),
                                        })}
                                    </p>
                                )}
                            </div>
                            {balance !== null && (
                                <p
                                    className={cn(
                                        'flex items-center gap-1.5 text-sm',
                                        balance < summary.expected
                                            ? 'text-danger-600'
                                            : 'text-muted-foreground'
                                    )}
                                >
                                    <Wallet className="size-4" />
                                    {t('review.cost.balance', { value: credits(balance) })}
                                </p>
                            )}
                        </div>

                        {estimate.estimate.rows.length > 0 && (
                            <div>
                                <button
                                    type="button"
                                    onClick={() => setBreakdownOpen((v) => !v)}
                                    aria-expanded={breakdownOpen}
                                    className="flex items-center gap-1 text-xs font-medium text-primary-500 hover:text-primary-600"
                                >
                                    {t('review.cost.breakdown')}
                                    <CaretDown
                                        className={cn(
                                            'size-3 transition-transform',
                                            breakdownOpen && 'rotate-180'
                                        )}
                                    />
                                </button>
                                {breakdownOpen && (
                                    <ul className="mt-2 divide-y divide-border rounded-md bg-muted px-3">
                                        {estimate.estimate.rows.map((row) => (
                                            <li
                                                key={row.label}
                                                className="flex items-center justify-between gap-3 py-1.5 text-xs"
                                            >
                                                <span className="text-muted-foreground">
                                                    {row.label}
                                                </span>
                                                <span className="font-medium text-foreground">
                                                    {credits(row.credits)}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground">{t('review.cost.note')}</p>
                    </>
                )}
            </section>

            {estimate && !estimateLoading && !estimate.allowed && (
                <Notice
                    tone="danger"
                    title={t('review.blocked')}
                    icon={<Prohibit className="size-4" />}
                >
                    <p>{estimate.blocked_reason || t('review.blockedFallback')}</p>
                </Notice>
            )}

            {estimate && !estimateLoading && estimate.warnings.length > 0 && (
                <Notice
                    tone="warning"
                    title={t('review.warnings')}
                    icon={<WarningCircle className="size-4" />}
                >
                    <ul className="list-disc space-y-0.5 ps-4">
                        {estimate.warnings.map((w) => (
                            <li key={w}>{w}</li>
                        ))}
                    </ul>
                </Notice>
            )}

            <Notice tone="info" icon={<Info className="size-4" />}>
                <p>{t('review.afterCreate')}</p>
            </Notice>
        </div>
    );
}
