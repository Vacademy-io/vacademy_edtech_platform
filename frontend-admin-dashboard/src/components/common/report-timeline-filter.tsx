import {
    endOfMonth,
    endOfWeek,
    format,
    startOfMonth,
    startOfWeek,
    subDays,
    subMonths,
} from 'date-fns';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Timeline picker shared by the learner profile's Reports tab and Learning Reports → Batch:
 * weekly, monthly and custom ranges. Dates are yyyy-MM-dd.
 */
export type TimelinePreset =
    | 'THIS_WEEK'
    | 'LAST_WEEK'
    | 'THIS_MONTH'
    | 'LAST_MONTH'
    | 'LAST_30_DAYS'
    | 'LAST_3_MONTHS'
    | 'LAST_12_MONTHS'
    | 'CUSTOM';

export interface TimelineValue {
    preset: TimelinePreset;
    /** Used when preset is CUSTOM. */
    customStart?: string;
    customEnd?: string;
}

export interface TimelineRange {
    start: string;
    end: string;
}

const PRESET_LABELS: Record<TimelinePreset, string> = {
    THIS_WEEK: 'This week',
    LAST_WEEK: 'Last week',
    THIS_MONTH: 'This month',
    LAST_MONTH: 'Last month',
    LAST_30_DAYS: 'Last 30 days',
    LAST_3_MONTHS: 'Last 3 months',
    LAST_12_MONTHS: 'Last 12 months',
    CUSTOM: 'Custom range',
};

const PRESETS = Object.keys(PRESET_LABELS) as TimelinePreset[];
const WEEK_STARTS_ON = 1; // Monday

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

export const DEFAULT_TIMELINE: TimelineValue = { preset: 'LAST_12_MONTHS' };

/**
 * The range a timeline value covers, or null for an incomplete or inverted custom range.
 * Ranges never run past today — there is nothing to report on yet.
 */
export function resolveTimeline(
    value: TimelineValue,
    today: Date = new Date()
): TimelineRange | null {
    const todayYmd = ymd(today);
    const cap = (d: Date) => (ymd(d) > todayYmd ? todayYmd : ymd(d));
    switch (value.preset) {
        case 'THIS_WEEK':
            return {
                start: ymd(startOfWeek(today, { weekStartsOn: WEEK_STARTS_ON })),
                end: todayYmd,
            };
        case 'LAST_WEEK': {
            const lastWeek = subDays(startOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }), 1);
            return {
                start: ymd(startOfWeek(lastWeek, { weekStartsOn: WEEK_STARTS_ON })),
                end: ymd(endOfWeek(lastWeek, { weekStartsOn: WEEK_STARTS_ON })),
            };
        }
        case 'THIS_MONTH':
            return { start: ymd(startOfMonth(today)), end: cap(endOfMonth(today)) };
        case 'LAST_MONTH': {
            const lastMonth = subMonths(today, 1);
            return { start: ymd(startOfMonth(lastMonth)), end: ymd(endOfMonth(lastMonth)) };
        }
        case 'LAST_30_DAYS':
            return { start: ymd(subDays(today, 29)), end: todayYmd };
        case 'LAST_3_MONTHS':
            return { start: ymd(subMonths(today, 3)), end: todayYmd };
        case 'LAST_12_MONTHS':
            return { start: ymd(subDays(today, 364)), end: todayYmd };
        case 'CUSTOM':
            if (!value.customStart || !value.customEnd || value.customStart > value.customEnd) {
                return null;
            }
            return { start: value.customStart, end: value.customEnd };
    }
}

export function ReportTimelineFilter({
    value,
    onChange,
    className,
}: {
    value: TimelineValue;
    onChange: (next: TimelineValue) => void;
    className?: string;
}) {
    const inverted =
        value.preset === 'CUSTOM' &&
        !!value.customStart &&
        !!value.customEnd &&
        value.customStart > value.customEnd;
    const today = ymd(new Date());

    return (
        <div className={cn('flex flex-col gap-2', className)}>
            <Select
                value={value.preset}
                onValueChange={(preset) => onChange({ ...value, preset: preset as TimelinePreset })}
            >
                <SelectTrigger className="h-9 w-full text-sm" aria-label="Timeline">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {PRESETS.map((p) => (
                        <SelectItem key={p} value={p}>
                            {PRESET_LABELS[p]}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {value.preset === 'CUSTOM' && (
                <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-xs text-neutral-500">
                        From
                        <Input
                            type="date"
                            value={value.customStart ?? ''}
                            max={value.customEnd || today}
                            onChange={(e) => onChange({ ...value, customStart: e.target.value })}
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-neutral-500">
                        To
                        <Input
                            type="date"
                            value={value.customEnd ?? ''}
                            min={value.customStart || undefined}
                            max={today}
                            onChange={(e) => onChange({ ...value, customEnd: e.target.value })}
                        />
                    </label>
                    {inverted && (
                        <p className="col-span-2 text-xs text-danger-600">
                            The start date is after the end date.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
