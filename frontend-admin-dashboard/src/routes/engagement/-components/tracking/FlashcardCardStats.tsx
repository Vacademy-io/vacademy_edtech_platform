import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { Cards, Info, WarningCircle } from '@phosphor-icons/react';
import { MyTable, type TableData } from '@/components/design-system/table';
import { MyButton } from '@/components/design-system/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import type { FlashcardCardStat } from '../../-types/types';
import { formatNumber, formatPercent } from '../../-utils/format';
import type { CardStatsData } from './tracking-columns';

/**
 * The Cards tab of a flashcards task: how every card in the current deck went,
 * hardest first ("Still learning" share, then the most studied).
 *
 * Counts cover every completed attempt across deck versions (a card keeps its id
 * when edited); card text is the deck as it is now. Outcomes on cards that have
 * since been removed are summed into one note under the table.
 */

/** Hardest first: the highest "Still learning" share, then the most studied, then deck order. */
export function sortCardsHardestFirst(cards: FlashcardCardStat[]): FlashcardCardStat[] {
    return cards
        .map((card, index) => ({ card, index }))
        .sort(
            (a, b) =>
                b.card.stillLearningRate - a.card.stillLearningRate ||
                b.card.studied - a.card.studied ||
                a.index - b.index
        )
        .map(({ card }) => card);
}

export interface FlashcardCardStatsProps {
    stats: CardStatsData | undefined;
    loading: boolean;
    error: boolean;
    onRetry: () => void;
    retrying?: boolean;
}

export function FlashcardCardStats({
    stats,
    loading,
    error,
    onRetry,
    retrying = false,
}: FlashcardCardStatsProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;

    const sorted = useMemo(() => sortCardsHardestFirst(stats?.cards ?? []), [stats?.cards]);
    const anyResults = sorted.some((card) => card.studied > 0);

    const columns = useMemo<ColumnDef<FlashcardCardStat>[]>(
        () => [
            {
                id: 'card',
                header: t('tracking.cards.card'),
                size: 400,
                cell: ({ row }) => (
                    <div className="min-w-0">
                        <span className="line-clamp-2 break-words font-medium text-neutral-900">
                            {row.original.front}
                        </span>
                        <span className="line-clamp-2 break-words text-caption text-neutral-500">
                            {row.original.back}
                        </span>
                    </div>
                ),
            },
            {
                id: 'studied',
                header: t('tracking.cards.studied'),
                size: 95,
                cell: ({ row }) => (
                    <span className="block tabular-nums">
                        {formatNumber(row.original.studied, lang)}
                    </span>
                ),
            },
            {
                id: 'gotIt',
                header: t('tracking.cards.gotIt'),
                size: 95,
                cell: ({ row }) => (
                    <span className="block tabular-nums">
                        {formatNumber(row.original.gotIt, lang)}
                    </span>
                ),
            },
            {
                id: 'stillLearning',
                header: t('tracking.cards.stillLearning'),
                size: 250,
                cell: ({ row }) => {
                    const card = row.original;
                    if (!(card.studied > 0)) {
                        return (
                            <span className="text-caption text-neutral-400">
                                {t('tracking.cards.notStudied')}
                            </span>
                        );
                    }
                    const rate = Math.min(1, Math.max(0, card.stillLearningRate || 0));
                    const percent = Math.round(rate * 100);
                    return (
                        <div className="flex items-center gap-2">
                            <div
                                className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100"
                                role="progressbar"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={percent}
                                aria-label={t('tracking.cards.stillLearningLabel', {
                                    front: card.front,
                                    percent: formatPercent(rate, lang),
                                })}
                            >
                                <div
                                    className={cn(
                                        'h-full rounded-full',
                                        rate >= 0.5 ? 'bg-warning-500' : 'bg-primary-400'
                                    )}
                                    style={{ width: `${percent}%` }} // design-lint-ignore: data-driven bar width
                                />
                            </div>
                            <span className="w-16 shrink-0 text-end text-caption tabular-nums text-neutral-700">
                                {t('tracking.cards.stillLearningValue', {
                                    percent: formatPercent(rate, lang),
                                    n: formatNumber(card.stillLearning, lang),
                                })}
                            </span>
                        </div>
                    );
                },
            },
        ],
        [t, lang]
    );

    if (error && !stats) {
        return (
            <Alert className="border-danger-200 bg-danger-50">
                <WarningCircle size={18} className="text-danger-600" />
                <AlertDescription className="space-y-3 text-danger-700">
                    <p>{t('tracking.cards.loadError')}</p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={retrying}
                        onClick={onRetry}
                    >
                        {t('tracking.retry')}
                    </MyButton>
                </AlertDescription>
            </Alert>
        );
    }

    const tableData: TableData<FlashcardCardStat> | undefined = stats
        ? {
              content: sorted,
              total_pages: 1,
              page_no: 0,
              page_size: Math.max(1, sorted.length),
              total_elements: sorted.length,
              last: true,
          }
        : undefined;

    if (!loading && stats && sorted.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 p-8 text-center">
                <Cards size={28} className="text-neutral-400" aria-hidden="true" />
                <p className="text-body text-neutral-600">{t('tracking.cards.emptyDeck')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {!loading && stats && !anyResults && (
                <p className="flex items-start gap-2 rounded-md bg-neutral-50 px-3 py-2 text-caption text-neutral-600">
                    <Info size={16} className="mt-px shrink-0" aria-hidden="true" />
                    {t('tracking.cards.noResults')}
                </p>
            )}
            <MyTable<FlashcardCardStat>
                data={tableData}
                columns={columns}
                isLoading={loading}
                error={null}
                currentPage={0}
                enableColumnPinning={false}
            />
            {(stats?.removedOutcomes ?? 0) > 0 && (
                <p className="text-caption text-neutral-500">
                    {t('tracking.cards.removedOutcomes', {
                        count: stats!.removedOutcomes,
                        n: formatNumber(stats!.removedOutcomes, lang),
                    })}
                </p>
            )}
        </div>
    );
}
