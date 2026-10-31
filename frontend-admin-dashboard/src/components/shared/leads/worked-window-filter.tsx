import { Phone, ClockCounterClockwise, CalendarBlank } from '@phosphor-icons/react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Sentinel for "no window" — the Select can't hold an empty value. */
export const WORKED_WINDOW_ANY = 'ANY';

/**
 * Sentinel for an explicit from–to range. Unlike the presets this is NOT rolling:
 * the caller supplies two calendar dates and we bound both ends, which is what
 * "show me what I worked between the 1st and the 15th" actually means.
 */
export const WORKED_WINDOW_CUSTOM = 'CUSTOM';

/**
 * Window presets, in HOURS.
 *
 * Deliberately a ROLLING window, unlike the submitted-date filter next to it, which
 * buckets by calendar day. A counsellor asking "how many did I call in the last 24
 * hours" at 9am means the last 24 hours, not "since midnight" — and the whole point
 * of this filter is to measure their own recent work, so the boundary has to be
 * relative to now.
 */
export const WORKED_WINDOW_PRESETS: { value: string; hours: number }[] = [
    { value: '24', hours: 24 },
    { value: '168', hours: 24 * 7 },
    { value: '360', hours: 24 * 15 },
    { value: '720', hours: 24 * 30 },
];

/**
 * ISO instant marking the start of the window, or undefined for "any time".
 * Open-ended at the top: "in the last 7 days" has no upper bound.
 */
export function workedWindowFromIso(value: string | undefined | null): string | undefined {
    if (!value || value === WORKED_WINDOW_ANY || value === WORKED_WINDOW_CUSTOM) return undefined;
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours <= 0) return undefined;
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export type WorkedWindowKind = 'CALLED' | 'ACTIVITY';

interface WorkedWindowFilterProps {
    /** 'CALLED' reads the call log; 'ACTIVITY' reads the whole timeline feed. */
    kind: WorkedWindowKind;
    /** Current value; WORKED_WINDOW_ANY (or '') means no window. */
    value: string;
    /** Emits '' to clear, otherwise the selected preset. */
    onValueChange: (value: string) => void;
    /** Labels, so the copy stays in the page's translation namespace. */
    labels: {
        anyLabel: string;
        placeholder: string;
        optionLabel: (hours: number) => string;
        /** Label for the from–to option. Omit to leave the custom range off entirely. */
        customLabel?: string;
    };
    /**
     * Supplied together with `labels.customLabel` to offer an explicit date range.
     * Dates are plain `yyyy-mm-dd` strings, exactly as the submitted-date filter keeps them.
     */
    custom?: {
        from: string;
        to: string;
        onChange: (from: string, to: string) => void;
        labels: { setDates: string; from: string; to: string; done: string };
    };
}

/**
 * "Worked in the last …" filter for the leads lists.
 *
 * Two independent instances rather than one combined control, because the two
 * questions genuinely differ: CALLED answers "who did I dial", ACTIVITY answers
 * "who did I touch at all" (a note, a status change and a logged call all count).
 * A counsellor who logged a call manually without dialling through the platform
 * shows up in the second and not the first, and that distinction is the reason
 * both exist.
 */
export function WorkedWindowFilter({
    kind,
    value,
    onValueChange,
    labels,
    custom,
}: WorkedWindowFilterProps) {
    const Icon = kind === 'CALLED' ? Phone : ClockCounterClockwise;
    const [rangeOpen, setRangeOpen] = useState(false);
    const offersCustom = Boolean(custom && labels.customLabel);

    return (
        <>
            <Select
                value={value || WORKED_WINDOW_ANY}
                onValueChange={(v) => onValueChange(v === WORKED_WINDOW_ANY ? '' : v)}
            >
                <SelectTrigger className="h-10 w-44">
                    <Icon className="mr-1.5 size-4 shrink-0 text-neutral-400" />
                    <SelectValue placeholder={labels.placeholder} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={WORKED_WINDOW_ANY}>{labels.anyLabel}</SelectItem>
                    {WORKED_WINDOW_PRESETS.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                            {labels.optionLabel(preset.hours)}
                        </SelectItem>
                    ))}
                    {offersCustom && (
                        <SelectItem value={WORKED_WINDOW_CUSTOM}>{labels.customLabel}</SelectItem>
                    )}
                </SelectContent>
            </Select>
            {offersCustom && value === WORKED_WINDOW_CUSTOM && custom && (
                <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-10">
                            <CalendarBlank className="mr-1.5 size-4 text-neutral-400" />
                            {custom.from && custom.to
                                ? `${custom.from} → ${custom.to}`
                                : custom.labels.setDates}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-neutral-600">
                                    {custom.labels.from}
                                </Label>
                                <Input
                                    type="date"
                                    value={custom.from}
                                    onChange={(e) => custom.onChange(e.target.value, custom.to)}
                                    className="h-9"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-neutral-600">
                                    {custom.labels.to}
                                </Label>
                                <Input
                                    type="date"
                                    value={custom.to}
                                    onChange={(e) => custom.onChange(custom.from, e.target.value)}
                                    className="h-9"
                                />
                            </div>
                        </div>
                        <Button size="sm" className="w-full" onClick={() => setRangeOpen(false)}>
                            {custom.labels.done}
                        </Button>
                    </PopoverContent>
                </Popover>
            )}
        </>
    );
}
