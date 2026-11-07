import { ArrowRight, ChartLineUp, Coins, Info, Wallet } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatCredits } from '../../-utils/report-format';
import type { RoiHeroView, RoiTone } from '../../-utils/report-roi';
import { SectionError } from './ReportSection';
import { useReportT } from './range-context';

const TONE_TEXT: Record<RoiTone, string> = {
    success: 'text-success-600',
    warning: 'text-warning-600',
    danger: 'text-danger-600',
    neutral: 'text-neutral-900',
};

const TONE_SURFACE: Record<RoiTone, string> = {
    success: 'border-success-200 bg-success-50',
    warning: 'border-warning-200 bg-warning-50',
    danger: 'border-danger-200 bg-danger-50',
    neutral: 'border-neutral-200 bg-neutral-50',
};

function Figure({
    label,
    value,
    hint,
    className,
    valueClassName,
}: {
    label: string;
    value: string;
    hint?: string;
    className?: string;
    valueClassName?: string;
}) {
    return (
        <div className={cn('flex min-w-0 flex-col gap-1 rounded-lg border p-3', className)}>
            <span className="flex items-center gap-1 text-neutral-500">
                <span className="text-caption">{label}</span>
                {hint && (
                    <TooltipProvider delayDuration={150}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={hint}
                                    className="rounded-sm text-neutral-400 hover:text-neutral-600"
                                >
                                    <Info size={14} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                                <span className="text-caption">{hint}</span>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </span>
            <span className={cn('truncate font-semibold', valueClassName ?? 'text-neutral-900')}>
                <span className="text-h3">{value}</span>
            </span>
        </div>
    );
}

interface RoiHeroProps {
    roi: RoiHeroView | null;
    isLoading: boolean;
    onRetry: () => void;
}

/**
 * The money story at the top of the report: what the engines cost, the revenue of the people
 * they reached, and the return on it.
 */
export function RoiHero({ roi, isLoading, onRetry }: RoiHeroProps) {
    const t = useReportT();
    if (isLoading && !roi) {
        return <Skeleton className="h-48 w-full rounded-xl" />;
    }
    // An older server sends no ROI block: nothing to show, nothing broken.
    if (!roi) return null;

    return (
        <Card className="flex flex-col gap-4 rounded-xl border-neutral-200 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-success-50 text-success-600">
                        <ChartLineUp size={22} weight="duotone" />
                    </span>
                    <div className="flex flex-col">
                        <span className="font-semibold text-neutral-900">
                            <span className="text-subtitle">{t('roi.title')}</span>
                        </span>
                        <span className="text-neutral-500">
                            <span className="text-caption">{t('roi.subtitle')}</span>
                        </span>
                    </div>
                </div>
                {roi.rateHint && (
                    <span className="flex items-center gap-1 rounded-md bg-neutral-50 px-2 py-1 text-neutral-600">
                        <Coins size={14} />
                        <span className="text-caption">{roi.rateHint}</span>
                    </span>
                )}
            </div>

            {roi.state === 'failed' ? (
                <SectionError message={t('roi.failed')} onRetry={onRetry} />
            ) : (
                <>
                    <div className="flex flex-col items-stretch gap-3 md:flex-row">
                        <Figure
                            label={t('roi.spend')}
                            value={roi.spend}
                            hint={t('roi.spendHint')}
                            className="flex-1 border-neutral-200 bg-white"
                        />
                        <ArrowRight
                            size={20}
                            className="hidden self-center text-neutral-400 md:block"
                            aria-hidden
                        />
                        <Figure
                            label={t('roi.revenue')}
                            value={roi.revenue}
                            hint={t('roi.revenueHint')}
                            className="flex-1 border-neutral-200 bg-white"
                        />
                        <ArrowRight
                            size={20}
                            className="hidden self-center text-neutral-400 md:block"
                            aria-hidden
                        />
                        <Figure
                            label={t('roi.multiple')}
                            value={roi.multiple}
                            hint={t(`roi.state.${roi.state}`)}
                            className={cn('flex-1', TONE_SURFACE[roi.tone])}
                            valueClassName={TONE_TEXT[roi.tone]}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Figure
                            label={t('roi.net')}
                            value={roi.net}
                            className="border-neutral-100"
                            valueClassName={TONE_TEXT[roi.tone]}
                        />
                        <Figure
                            label={t('roi.payingLeads')}
                            value={roi.payingLeads}
                            className="border-neutral-100"
                        />
                        <Figure
                            label={t('roi.payments')}
                            value={roi.payments}
                            className="border-neutral-100"
                        />
                        <Figure
                            label={t('roi.costPerPayingLead')}
                            value={roi.costPerPayingLead}
                            className="border-neutral-100"
                        />
                    </div>

                    {roi.state !== 'ok' && (
                        <p className="flex items-start gap-2 rounded-lg border border-info-200 bg-info-50 p-3 text-info-700">
                            <Info size={16} weight="fill" className="mt-0.5 shrink-0" />
                            <span className="text-caption">{t(`roi.state.${roi.state}`)}</span>
                        </p>
                    )}

                    {roi.breakdown.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <span className="flex items-center gap-1 text-neutral-600">
                                <Wallet size={14} />
                                <span className="text-caption">{t('roi.breakdown.title')}</span>
                            </span>
                            <div className="flex flex-wrap gap-2">
                                {roi.breakdown.map((b) => (
                                    <span
                                        key={b.key}
                                        className={cn(
                                            'flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-neutral-700',
                                            b.excluded && 'border-dashed text-neutral-400'
                                        )}
                                    >
                                        <span className="text-caption">
                                            {b.credits === null
                                                ? t('roi.breakdown.moneyOnly', {
                                                      label: b.label,
                                                      money: b.money,
                                                  })
                                                : t('roi.breakdown.item', {
                                                      label: b.label,
                                                      credits: formatCredits(b.credits),
                                                      money: b.money,
                                                  })}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    <p className="text-neutral-500">
                        <span className="text-caption">{t('roi.attribution')}</span>
                    </p>
                    {roi.notes.map((note) => (
                        <p key={note} className="text-neutral-500">
                            <span className="text-caption">{note}</span>
                        </p>
                    ))}
                </>
            )}
        </Card>
    );
}
