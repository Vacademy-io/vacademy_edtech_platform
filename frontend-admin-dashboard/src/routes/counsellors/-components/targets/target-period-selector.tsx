import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CalendarBlank } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { TargetPeriodType } from '../../-services/counsellor-target-services';

/** The timeline the dashboard evaluates targets against. */
export interface TargetPeriodValue {
    periodType: TargetPeriodType;
    /** yyyy-MM-dd, only used (and required) when periodType === 'CUSTOM'. */
    from?: string;
    to?: string;
}

function buildOptions(t: TFunction): { key: TargetPeriodType; label: string }[] {
    return [
        { key: 'WEEK', label: t('options.week') },
        { key: 'MONTH', label: t('options.month') },
        { key: 'CUSTOM', label: t('options.custom') },
    ];
}

/**
 * Segmented control for the target timeline. Renders inline from/to date inputs
 * when Custom is selected. Recurring (WEEK/MONTH) let the backend derive the
 * current period, so no dates are needed.
 */
export function TargetPeriodSelector({
    value,
    onChange,
}: {
    value: TargetPeriodValue;
    onChange: (next: TargetPeriodValue) => void;
}) {
    const { t } = useTranslation('counsellorsTargetsPeriodSelector');
    const options = buildOptions(t);
    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-neutral-300">
                {options.map((o) => (
                    <button
                        key={o.key}
                        type="button"
                        onClick={() => onChange({ ...value, periodType: o.key })}
                        className={cn(
                            'px-3 py-1.5 text-caption font-medium',
                            value.periodType === o.key
                                ? 'bg-primary-500 text-white'
                                : 'bg-white text-neutral-700 hover:bg-neutral-50'
                        )}
                    >
                        {o.label}
                    </button>
                ))}
            </div>
            {value.periodType === 'CUSTOM' && (
                <div className="flex items-center gap-1.5">
                    <CalendarBlank size={16} className="text-neutral-400" />
                    <input
                        type="date"
                        value={value.from ?? ''}
                        onChange={(e) => onChange({ ...value, from: e.target.value })}
                        className="rounded-md border border-neutral-300 px-2 py-1.5 text-caption"
                        aria-label={t('rangeStart')}
                    />
                    <span className="text-caption text-neutral-400">{t('to')}</span>
                    <input
                        type="date"
                        value={value.to ?? ''}
                        onChange={(e) => onChange({ ...value, to: e.target.value })}
                        className="rounded-md border border-neutral-300 px-2 py-1.5 text-caption"
                        aria-label={t('rangeEnd')}
                    />
                </div>
            )}
        </div>
    );
}
