import { getDaysAgo, getTomorrow, getYesterday } from '@/utils/dateUtils';
import { FilterType } from '../../-types/filter-type';
import SelectChips from '@/components/design-system/SelectChips';
import { useEffect, useMemo, useState } from 'react';
import { useDoubtFilters } from '../../-stores/filter-store';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { CalendarBlank } from '@phosphor-icons/react';
import type { DateRange } from 'react-day-picker';
import { useTranslation } from 'react-i18next';

const CUSTOM_VALUE = 'custom';

const formatYMD = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseYMD = (value: string | undefined): Date | undefined => {
    if (!value) return undefined;
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return undefined;
    return new Date(y, m - 1, d);
};

const formatDisplay = (date: Date | undefined, locale: string) => {
    if (!date) return '';
    return date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
};

function getDatesFromValue(value: string): [string, string] {
    const [startDate, endDate] = value.split(',');
    return [startDate || '', endDate || ''];
}

export const DateFilter = () => {
    const { t, i18n } = useTranslation('studyLibraryDateFilter');
    const { filters, updateFilters } = useDoubtFilters();

    const dateFilterList: FilterType[] = useMemo(
        () => [
            { label: t('options.today'), value: [getYesterday(), getTomorrow()].join(',') },
            { label: t('options.thisWeek'), value: [getDaysAgo(7), getTomorrow()].join(',') },
            { label: t('options.thisMonth'), value: [getDaysAgo(30), getTomorrow()].join(',') },
            { label: t('options.thisYear'), value: [getDaysAgo(365), getTomorrow()].join(',') },
            { label: t('options.custom'), value: CUSTOM_VALUE },
        ],
        [t]
    );

    const [selectedDate, setSelectedDate] = useState<FilterType[]>([dateFilterList[1]!]);
    // Labels are re-read from the live option list: the initial state captures `t` before the
    // namespace has loaded in dev, which otherwise leaves "options.thisWeek" frozen on the chip.
    const selectedDisplay = selectedDate.map(
        (sel) => dateFilterList.find((o) => o.value === sel.value) ?? sel
    );
    const [customOpen, setCustomOpen] = useState(false);
    const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);

    const handleDateChange = (next: FilterType[]) => {
        const chosen = next[0]!;
        setSelectedDate(next);
        if (chosen.value === CUSTOM_VALUE) {
            setCustomRange({
                from: parseYMD(filters.start_date),
                to: parseYMD(filters.end_date),
            });
            setCustomOpen(true);
        }
    };

    useEffect(() => {
        const chosen = selectedDate[0]!;
        if (chosen.value === CUSTOM_VALUE) return;
        const [start, end] = getDatesFromValue(chosen.value);
        updateFilters({ start_date: start, end_date: end });
    }, [selectedDate, updateFilters]);

    const applyCustomRange = () => {
        if (!customRange?.from || !customRange?.to) return;
        updateFilters({
            start_date: formatYMD(customRange.from),
            end_date: formatYMD(customRange.to),
        });
        setCustomOpen(false);
    };

    const clearCustomRange = () => {
        setCustomRange(undefined);
    };

    const isCustomSelected = selectedDate[0]?.value === CUSTOM_VALUE;
    const customLabel =
        isCustomSelected && customRange?.from && customRange?.to
            ? `${formatDisplay(customRange.from, i18n.language)} – ${formatDisplay(customRange.to, i18n.language)}`
            : t('customRange.pickARange');

    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-neutral-600">{t('label.date')}</span>
            <SelectChips
                options={dateFilterList}
                selected={selectedDisplay}
                onChange={handleDateChange}
                hasClearFilter={false}
                className="min-w-40"
            />
            {isCustomSelected && (
                <Popover open={customOpen} onOpenChange={setCustomOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 rounded-full border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100"
                        >
                            <CalendarBlank size={14} weight="duotone" />
                            <span className="text-xs font-medium">{customLabel}</span>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                            mode="range"
                            numberOfMonths={2}
                            selected={customRange}
                            onSelect={setCustomRange}
                            defaultMonth={customRange?.from ?? new Date()}
                        />
                        <div className="flex items-center justify-between gap-2 border-t border-neutral-200 p-3">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearCustomRange}
                                disabled={!customRange?.from && !customRange?.to}
                            >
                                {t('customRange.clear')}
                            </Button>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCustomOpen(false)}
                                >
                                    {t('customRange.cancel')}
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={applyCustomRange}
                                    disabled={!customRange?.from || !customRange?.to}
                                >
                                    {t('customRange.apply')}
                                </Button>
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>
            )}
        </div>
    );
};
