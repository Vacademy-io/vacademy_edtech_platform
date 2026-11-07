import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface DateRangePresetsProps {
    startDate: string; // yyyy-MM-dd
    endDate: string; // yyyy-MM-dd
    onChange: (start: string, end: string) => void;
}

const PRESETS: Array<{ id: 'today' | 'week' | 'fortnight' | 'month'; days: number }> = [
    { id: 'today', days: 1 },
    { id: 'week', days: 7 },
    { id: 'fortnight', days: 15 },
    { id: 'month', days: 30 },
];

const rangeForDays = (days: number) => ({
    start: dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD'),
    end: dayjs().format('YYYY-MM-DD'),
});

const fmt = (d: string) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

// Subtle, on-brand pill styling that matches the batch/subject filters.
const pillBase =
    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200';
const pillOn = 'border-primary-500 bg-primary-50 text-primary-700';
const pillOff = 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50';

/**
 * Compact date-range filter for the feedback page. Mirrors the rest of the
 * filter bar's "selected = soft primary tint" treatment rather than the shared
 * DateRangeFilter's bold solid-orange selected pill.
 */
export function DateRangePresets({ startDate, endDate, onChange }: DateRangePresetsProps) {
    const { t } = useTranslation('studyLibraryDateRangePresets');

    const matchedPreset = useMemo(() => {
        for (const p of PRESETS) {
            const r = rangeForDays(p.days);
            if (r.start === startDate && r.end === endDate) return p.id;
        }
        return null;
    }, [startDate, endDate]);

    const [customOpen, setCustomOpen] = useState(matchedPreset === null);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                {PRESETS.map((p) => {
                    const active = !customOpen && matchedPreset === p.id;
                    return (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                                const r = rangeForDays(p.days);
                                setCustomOpen(false);
                                onChange(r.start, r.end);
                            }}
                            className={cn(pillBase, active ? pillOn : pillOff)}
                        >
                            {t(`presets.${p.id}`)}
                        </button>
                    );
                })}
                <button
                    type="button"
                    onClick={() => setCustomOpen(true)}
                    className={cn(pillBase, customOpen ? pillOn : pillOff)}
                >
                    {t('custom')}
                </button>

                <span className="ml-1 text-sm text-neutral-500">
                    {fmt(startDate)} <span className="text-neutral-400">—</span> {fmt(endDate)}
                </span>
            </div>

            {customOpen && (
                <div className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-neutral-50 p-3 sm:flex-row sm:items-end">
                    <label className="flex flex-1 flex-col gap-1">
                        <span className="text-xs font-medium text-neutral-600">{t('startDate')}</span>
                        <input
                            type="date"
                            value={startDate}
                            max={endDate || undefined}
                            onChange={(e) => e.target.value && onChange(e.target.value, endDate)}
                            className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                    </label>
                    <label className="flex flex-1 flex-col gap-1">
                        <span className="text-xs font-medium text-neutral-600">{t('endDate')}</span>
                        <input
                            type="date"
                            value={endDate}
                            min={startDate || undefined}
                            onChange={(e) => e.target.value && onChange(startDate, e.target.value)}
                            className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                    </label>
                </div>
            )}
        </div>
    );
}
