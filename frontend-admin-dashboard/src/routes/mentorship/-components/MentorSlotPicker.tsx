import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarX, CaretLeft, CaretRight, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useMentorSlots } from '../-hooks/use-mentorship';
import { browserTimezone, groupSlotsByDay, isoDate, slotWindow } from '../-utils/slot-window';

/**
 * Pick a real free slot on a mentor's booking page.
 *
 * Reads the same public availability the learner's booking page reads, so an admin or
 * mentor can only place a session where the mentor is genuinely free. This replaced a
 * bare `datetime-local` field whose only guidance was "must be a slot the mentor is
 * actually available for" — which meant guessing, and being told no after the fact.
 */
export function MentorSlotPicker({
    instituteId,
    slug,
    duration,
    value,
    onChange,
}: {
    instituteId: string | undefined;
    /** The mentor's booking-page slug; null when they have no booking page yet. */
    slug: string | null | undefined;
    /** Session length in minutes; omitted uses the page's default. */
    duration?: number;
    /** Currently chosen slot, as the ISO string the API returned. */
    value: string | null;
    onChange: (slot: string | null) => void;
}) {
    const { t } = useTranslation('mentorshipMentorSlotPicker');
    const tz = useMemo(() => browserTimezone(), []);
    const [weekOffset, setWeekOffset] = useState(0);
    const [dayKey, setDayKey] = useState<string | null>(null);

    const range = useMemo(() => slotWindow(weekOffset), [weekOffset]);
    const query = useMentorSlots({ instituteId, slug, from: range.from, to: range.to, tz, duration });

    const byDay = useMemo(() => groupSlotsByDay(query.data?.slots ?? []), [query.data]);

    // Land on the first day that actually has slots, so the common case needs no
    // clicking. Deliberately only moves when the current day has nothing to show —
    // a background refetch must not yank the admin off the day they just picked.
    useEffect(() => {
        setDayKey((current) => {
            if (current && (byDay[current]?.length ?? 0) > 0) return current;
            return range.days.map(isoDate).find((key) => (byDay[key]?.length ?? 0) > 0) ?? null;
        });
    }, [byDay, range.days]);

    if (!slug) {
        return (
            <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3">
                <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-warning-600" />
                <p className="text-caption text-neutral-600">
                    {t('noBookingPage')}
                </p>
            </div>
        );
    }

    const daySlots = dayKey ? byDay[dayKey] ?? [] : [];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="icon"
                    // Offset 0 already starts today; going back would only show the past.
                    disable={weekOffset === 0}
                    onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
                    aria-label={t('previousWeek')}
                >
                    <CaretLeft size={16} />
                </MyButton>
                <span className="text-caption text-neutral-500">
                    {range.days[0]?.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    {' – '}
                    {range.days[6]?.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    {' · '}
                    {query.data?.timezone || tz}
                </span>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="icon"
                    onClick={() => setWeekOffset((w) => w + 1)}
                    aria-label={t('nextWeek')}
                >
                    <CaretRight size={16} />
                </MyButton>
            </div>

            <div className="grid grid-cols-7 gap-1">
                {range.days.map((day) => {
                    const key = isoDate(day);
                    const count = byDay[key]?.length ?? 0;
                    const active = key === dayKey;
                    return (
                        <button
                            key={key}
                            type="button"
                            disabled={count === 0}
                            onClick={() => setDayKey(key)}
                            className={cn(
                                'flex flex-col items-center gap-0.5 rounded-md border p-2 transition-colors',
                                active
                                    ? 'border-primary-500 bg-primary-50'
                                    : 'border-neutral-200 hover:border-primary-200',
                                count === 0 && 'cursor-not-allowed border-neutral-100 opacity-50'
                            )}
                        >
                            <span className="text-caption text-neutral-400">
                                {day.toLocaleDateString(undefined, { weekday: 'short' })}
                            </span>
                            <span className="text-body font-medium tabular-nums text-neutral-700">
                                {day.getDate()}
                            </span>
                            <span className="text-caption text-neutral-400">
                                {count === 0 ? '—' : count}
                            </span>
                        </button>
                    );
                })}
            </div>

            {query.isLoading ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <Skeleton key={i} className="h-9 w-full rounded-md" />
                    ))}
                </div>
            ) : query.isError ? (
                <div className="flex flex-col items-start gap-2 rounded-lg border border-danger-100 bg-danger-50 p-3">
                    <p className="text-caption text-danger-600">{t('couldNotLoadSlots')}</p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => query.refetch()}
                    >
                        {t('retry')}
                    </MyButton>
                </div>
            ) : daySlots.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-neutral-200 p-6 text-center">
                    <CalendarX size={28} className="text-neutral-300" />
                    <p className="text-caption text-neutral-500">
                        {t('noFreeSlots')}
                    </p>
                </div>
            ) : (
                <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                    {daySlots.map((slot) => {
                        const active = slot === value;
                        return (
                            <button
                                key={slot}
                                type="button"
                                onClick={() => onChange(active ? null : slot)}
                                className={cn(
                                    'rounded-md border py-2 text-caption tabular-nums transition-colors',
                                    active
                                        ? 'border-primary-500 bg-primary-500 text-white'
                                        : 'border-neutral-200 text-neutral-700 hover:border-primary-300'
                                )}
                            >
                                {new Date(slot).toLocaleTimeString(undefined, {
                                    hour: 'numeric',
                                    minute: '2-digit',
                                })}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
