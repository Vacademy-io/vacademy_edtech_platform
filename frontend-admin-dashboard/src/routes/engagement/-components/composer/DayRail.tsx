import { useMemo } from 'react';
import { useFormState, useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    ArrowDown,
    ArrowUp,
    CalendarPlus,
    CopySimple,
    DotsSixVertical,
    DotsThreeVertical,
    Repeat,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import type { DropdownItem } from '@/components/design-system/utils/types/dropdown-types';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { cn } from '@/lib/utils';
import {
    countFormErrors,
    relativeDayOf,
    type ComposerForm,
    type SlotForm,
} from '../forms/composer-schema';
import {
    formatDay,
    formatDayRange,
    formatWeekdays,
    isEveryDay,
    slotLastDate,
    slotRunDates,
} from '../../-utils/format';

/**
 * The composer's "Days" rail: one row per slot, in date order (the order the server
 * lists them and learners get them).
 *
 * Desktop: a vertical, drag-sortable list ("Thu, 25 Sep · Forces · 4 tasks") with a
 * per-day menu (move, duplicate, delete) and an error badge when the day has problems.
 * Because a day's place is its date, moving a day hands it the dates of the place it
 * moves to (the days in between shift along); its tasks and times go with it.
 * Below `lg` it becomes a horizontal strip of day chips above the editor, so a phone
 * still sees every day and can jump between them.
 */

/**
 * Form indexes in the order days are shown: by first date, then start time, then form
 * order. Matches the server's ORDER BY start_date, start_time, sort_order.
 */
export function orderDays(
    slots: (Pick<SlotForm, 'startDate' | 'startTime'> | undefined)[] | undefined
): number[] {
    return (slots ?? [])
        .map((slot, index) => ({ slot, index }))
        .sort(
            (a, b) =>
                (a.slot?.startDate ?? '').localeCompare(b.slot?.startDate ?? '') ||
                (a.slot?.startTime ?? '').localeCompare(b.slot?.startTime ?? '') ||
                a.index - b.index
        )
        .map(({ index }) => index);
}

/** 1-based position of each form index in date order ("Day 2"). */
export function dayRanks(slots: Parameters<typeof orderDays>[0]): Map<number, number> {
    return new Map(orderDays(slots).map((formIndex, position) => [formIndex, position + 1]));
}

export interface DayRailProps {
    control: Control<ComposerForm>;
    /** The slots field array's entries (React keys, in form order). */
    days: { rhfKey: string }[];
    /** Form index of the selected day. */
    selectedIndex: number;
    onSelect: (formIndex: number) => void;
    onAdd: () => void;
    onDuplicate: (formIndex: number) => void;
    onDelete: (formIndex: number) => void;
    /** Move a day between two positions of the date order (display positions). */
    onMove: (fromPosition: number, toPosition: number) => void;
}

/**
 * "Thu, 25 Sep", or for a repeating day "Mon, Wed · 29 Sep – 10 Oct". On a join-based
 * plan (pass `relative`, the engagement `t`) it is "Day 3" or "Days 1–3".
 */
export function dayHeading(
    slot: Pick<SlotForm, 'startDate' | 'endDate' | 'dowMask'>,
    lang: string,
    relative?: TFunction | null
): { label: string; repeats: boolean } {
    const last = slotLastDate(slot);
    if (!slot.startDate) return { label: '', repeats: false };
    if (relative) {
        const first = relativeDayOf(slot.startDate);
        const end = relativeDayOf(last);
        if (first == null) return { label: '', repeats: false };
        if (end == null || end <= first) {
            return { label: relative('composer.relative.day', { n: first }), repeats: false };
        }
        return {
            label: relative('composer.relative.dayRange', { from: first, to: end }),
            repeats: true,
        };
    }
    if (last === slot.startDate) return { label: formatDay(slot.startDate, lang), repeats: false };
    const weekdays = formatWeekdays(slot.dowMask, lang);
    const range = formatDayRange(slot.startDate, last, lang);
    return { label: weekdays ? `${weekdays} · ${range}` : range, repeats: true };
}

type SlotsErrors = Record<number, unknown> | undefined;

export function DayRail({
    control,
    days,
    selectedIndex,
    onSelect,
    onAdd,
    onDuplicate,
    onDelete,
    onMove,
}: DayRailProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const slots = useWatch({ control, name: 'slots' });
    const relative = useWatch({ control, name: 'scheduleMode' }) === 'RELATIVE';
    const { errors } = useFormState({ control, name: 'slots' });
    const slotErrors = errors.slots as SlotsErrors;

    // Recomputed every render: the errors object is updated in place by the form.
    const order = orderDays(days.map((_, index) => slots?.[index]));
    const rows = order.map((index, position) => {
        const entry = days[index]!;
        const slot = slots?.[index];
        const heading = slot
            ? dayHeading(slot, lang, relative ? t : null)
            : { label: '', repeats: false };
        // In the narrow rail a repeating day leads with its dates; the weekdays go on the
        // second line, so truncation never hides when the day runs.
        const last = slot?.startDate ? slotLastDate(slot) : '';
        const railLabel =
            heading.repeats && slot && !relative
                ? formatDayRange(slot.startDate, last, lang)
                : heading.label;
        const weekdays =
            heading.repeats && slot && !relative && !isEveryDay(slot.dowMask)
                ? formatWeekdays(slot.dowMask, lang)
                : '';
        const taskCount = slot?.items?.length ?? 0;
        const runCount = slot ? slotRunDates(slot, 400).length : 0;
        return {
            key: entry.rhfKey,
            index,
            position,
            heading,
            railLabel,
            weekdays,
            theme: slot?.title?.trim() ?? '',
            taskCount,
            runCount,
            errorCount: countFormErrors(slotErrors?.[index]),
        };
    });

    const orderKey = rows.map((row) => row.key).join('|');
    const sortable = useMemo(
        () =>
            orderKey
                .split('|')
                .filter(Boolean)
                .map((id) => ({ id })),
        [orderKey]
    );

    function menuFor(position: number): DropdownItem[] {
        const items: DropdownItem[] = [];
        if (position > 0) {
            items.push({
                label: t('composer.rail.moveUp'),
                value: 'up',
                icon: <ArrowUp size={16} />,
            });
        }
        if (position < days.length - 1) {
            items.push({
                label: t('composer.rail.moveDown'),
                value: 'down',
                icon: <ArrowDown size={16} />,
            });
        }
        items.push({
            label: t('composer.rail.duplicate'),
            value: 'duplicate',
            icon: <CopySimple size={16} />,
        });
        if (days.length > 1) {
            items.push({
                label: t('composer.rail.delete'),
                value: 'delete',
                icon: <Trash size={16} className="text-danger-600" />,
            });
        }
        return items;
    }

    function handleMenu(row: { index: number; position: number }, value: string) {
        if (value === 'up') onMove(row.position, row.position - 1);
        else if (value === 'down') onMove(row.position, row.position + 1);
        else if (value === 'duplicate') onDuplicate(row.index);
        else if (value === 'delete') onDelete(row.index);
    }

    const subline = (row: (typeof rows)[number]) => {
        const tasks = t('composer.rail.tasks', { count: row.taskCount });
        const parts = [row.weekdays, row.theme, tasks].filter(Boolean);
        // A join-based range already reads "Days 2–4"; a date count would repeat it.
        if (row.heading.repeats && !relative) {
            parts.push(t('composer.rail.runs', { count: row.runCount }));
        }
        return parts.join(' · ');
    };

    return (
        <nav aria-label={t('composer.rail.label')} className="min-w-0">
            {/* Desktop: vertical sortable list. */}
            <div className="hidden lg:block">
                <p className="mb-2 text-subtitle font-semibold text-neutral-900">
                    {t('composer.rail.title')}
                </p>
                <Sortable
                    value={sortable}
                    onMove={({ activeIndex, overIndex }) => onMove(activeIndex, overIndex)}
                >
                    <ol className="flex flex-col gap-1.5">
                        {rows.map((row) => {
                            const selected = row.index === selectedIndex;
                            return (
                                <SortableItem key={row.key} value={row.key} asChild>
                                    <li
                                        className={cn(
                                            'flex items-stretch gap-1 rounded-lg border bg-white transition-colors',
                                            selected
                                                ? 'border-primary-300 bg-primary-50'
                                                : 'border-neutral-200 hover:border-neutral-300'
                                        )}
                                    >
                                        <SortableDragHandle
                                            variant="ghost"
                                            aria-label={t('composer.rail.drag', {
                                                n: row.position + 1,
                                            })}
                                            className="h-auto w-6 shrink-0 rounded-none rounded-s-lg p-0 text-neutral-400 hover:bg-transparent hover:text-neutral-600"
                                        >
                                            <DotsSixVertical size={16} />
                                        </SortableDragHandle>
                                        <button
                                            type="button"
                                            onClick={() => onSelect(row.index)}
                                            aria-current={selected ? 'true' : undefined}
                                            className="min-w-0 flex-1 py-2 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                        >
                                            <span className="flex items-center gap-1.5">
                                                {row.heading.repeats && (
                                                    <Repeat
                                                        size={14}
                                                        className="shrink-0 text-neutral-500"
                                                        aria-hidden
                                                    />
                                                )}
                                                <span
                                                    className={cn(
                                                        'truncate text-body font-semibold',
                                                        selected
                                                            ? 'text-primary-600'
                                                            : 'text-neutral-900'
                                                    )}
                                                >
                                                    {row.railLabel ||
                                                        t('composer.rail.dayN', {
                                                            n: row.position + 1,
                                                        })}
                                                </span>
                                            </span>
                                            <span className="block truncate text-caption text-neutral-500">
                                                {subline(row)}
                                            </span>
                                        </button>
                                        {row.errorCount > 0 && (
                                            <span className="flex shrink-0 items-center gap-0.5 self-center rounded-md bg-danger-50 px-1.5 py-0.5 text-caption font-semibold text-danger-600">
                                                <WarningCircle size={12} aria-hidden />
                                                <span aria-hidden>{row.errorCount}</span>
                                                <span className="sr-only">
                                                    {t('composer.rail.problems', {
                                                        count: row.errorCount,
                                                    })}
                                                </span>
                                            </span>
                                        )}
                                        <div className="flex shrink-0 items-center pe-1">
                                            <MyDropdown
                                                dropdownList={menuFor(row.position)}
                                                onSelect={(value) => handleMenu(row, value)}
                                            >
                                                <span className="flex size-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100">
                                                    <DotsThreeVertical size={18} aria-hidden />
                                                    <span className="sr-only">
                                                        {t('composer.rail.actions', {
                                                            n: row.position + 1,
                                                        })}
                                                    </span>
                                                </span>
                                            </MyDropdown>
                                        </div>
                                    </li>
                                </SortableItem>
                            );
                        })}
                    </ol>
                </Sortable>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    className="mt-3 w-full"
                    onClick={onAdd}
                >
                    <CalendarPlus size={16} /> {t('composer.rail.add')}
                </MyButton>
            </div>

            {/* Below lg: a horizontal strip of day chips. */}
            <div className="lg:hidden">
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {rows.map((row) => {
                        const selected = row.index === selectedIndex;
                        return (
                            <button
                                key={row.key}
                                type="button"
                                onClick={() => onSelect(row.index)}
                                aria-current={selected ? 'true' : undefined}
                                className={cn(
                                    'flex shrink-0 flex-col items-start rounded-lg border px-3 py-1.5 text-start',
                                    selected
                                        ? 'border-primary-300 bg-primary-50'
                                        : 'border-neutral-200 bg-white'
                                )}
                            >
                                <span className="flex items-center gap-1 text-caption font-semibold text-neutral-900">
                                    {row.railLabel ||
                                        t('composer.rail.dayN', { n: row.position + 1 })}
                                    {row.errorCount > 0 && (
                                        <>
                                            <WarningCircle
                                                size={12}
                                                className="text-danger-600"
                                                aria-hidden
                                            />
                                            <span className="sr-only">
                                                {t('composer.rail.problems', {
                                                    count: row.errorCount,
                                                })}
                                            </span>
                                        </>
                                    )}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {t('composer.rail.tasks', { count: row.taskCount })}
                                </span>
                            </button>
                        );
                    })}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="icon"
                        aria-label={t('composer.rail.add')}
                        className="shrink-0"
                        onClick={onAdd}
                    >
                        <CalendarPlus size={18} />
                    </MyButton>
                </div>
            </div>
        </nav>
    );
}
