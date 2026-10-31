import type { ReactNode } from 'react';
import { MagnifyingGlass, Funnel } from '@phosphor-icons/react';
import { MyInput } from '@/components/design-system/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SummaryStatusKey } from './PaymentKpiCards';

/**
 * What the switch below the KPI row selects. All but 'due' narrow the payment records; 'due' swaps
 * the table for the learners who still owe money, which is a different question entirely — an
 * unpaid balance usually has no payment record to filter to.
 */
export type SegmentKey = SummaryStatusKey;

export interface StatusSegment {
    key: SegmentKey;
    label: string;
    count: number;
}

interface PaymentControlBarProps {
    searchValue: string;
    onSearchChange: (value: string) => void;
    segments: StatusSegment[];
    activeStatus: SegmentKey;
    onStatusSelect: (key: SegmentKey) => void;
    filterCount: number;
    onOpenFilters: () => void;
    /** Right-aligned actions (e.g. export). */
    actions?: ReactNode;
}

/**
 * Redesign control bar: free-text search, a segmented status switch (with live counts), a Filters
 * button that opens the slide-over, and an actions slot. Mirrors the mockup's toolbar.
 */
export function PaymentControlBar({
    searchValue,
    onSearchChange,
    segments,
    activeStatus,
    onStatusSelect,
    filterCount,
    onOpenFilters,
    actions,
}: PaymentControlBarProps) {
    return (
        // Two fixed rows. On one wrapping row the switch, whose width grows with its counts
        // ("All 13045" vs "All 5"), decided whether the search shared a line with it: with
        // the full counts it wrapped and the search stretched across the whole row, then
        // snapped back once a search narrowed the counts.
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                {/* Search — capped, so it never takes the whole row */}
                <div className="relative w-full sm:w-auto sm:max-w-md sm:flex-1">
                    <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-neutral-400" />
                    <MyInput
                        inputType="text"
                        input={searchValue}
                        onChangeFunction={(e) => onSearchChange(e.target.value)}
                        inputPlaceholder="Search name, email, phone, amount, invoice no., plan or txn ID"
                        className="pl-9 sm:w-full"
                    />
                </div>

                {/* Filters button */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenFilters}
                    className={cn(
                        'h-9 gap-2',
                        filterCount > 0 && 'border-primary-500 bg-primary-50 text-primary-600'
                    )}
                >
                    <Funnel size={16} weight={filterCount > 0 ? 'fill' : 'regular'} />
                    Filters
                    {filterCount > 0 && (
                        <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-primary-500 text-caption text-neutral-50">
                            {filterCount}
                        </span>
                    )}
                </Button>

                {actions}
            </div>

            {/* Segmented status switch — scrolls sideways rather than wrapping on a narrow screen */}
            <div
                role="tablist"
                aria-label="Filter by payment status"
                className="flex max-w-full items-center gap-0.5 self-start overflow-x-auto rounded-md border border-neutral-200 bg-neutral-100 p-0.5"
            >
                {segments.map((seg) => {
                    const isActive = seg.key === activeStatus;
                    return (
                        <button
                            key={seg.key}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => onStatusSelect(seg.key)}
                            className={cn(
                                'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2.5 text-caption font-semibold transition-colors',
                                isActive
                                    ? 'bg-white text-neutral-800 shadow-sm'
                                    : 'text-neutral-500 hover:text-neutral-700'
                            )}
                        >
                            {seg.label}
                            <span
                                className={cn(
                                    'tabular-nums',
                                    isActive ? 'text-neutral-500' : 'text-neutral-400'
                                )}
                            >
                                {seg.count}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
