import { Info } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Small "ⓘ" hover tooltip used next to report metric labels so admins know
 * exactly what each number (Concentration Score, Course Completed, etc.) means.
 */
export function MetricInfo({ text }: { text: string }) {
    const { t } = useTranslation('studyLibraryReportsMetricInfo');
    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        aria-label={t('whatIsThis')}
                        className="text-neutral-400 transition-colors hover:text-primary-500"
                    >
                        <Info className="size-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent
                    side="top"
                    sideOffset={6}
                    className="z-50 max-w-xs rounded-md border border-neutral-200 bg-white px-3 py-2 text-caption font-normal leading-relaxed text-neutral-700 shadow-lg"
                >
                    {text}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

/** Canonical metric explanations, shared across the report views. */
export const buildMetricInfo = (t: TFunction) =>
    ({
        courseCompleted: t('studyLibraryReportsMetricInfo:courseCompleted'),
        timeSpentAvg: t('studyLibraryReportsMetricInfo:timeSpentAvg'),
        concentration: t('studyLibraryReportsMetricInfo:concentration'),
        leaderboard: t('studyLibraryReportsMetricInfo:leaderboard'),
    }) as const;
