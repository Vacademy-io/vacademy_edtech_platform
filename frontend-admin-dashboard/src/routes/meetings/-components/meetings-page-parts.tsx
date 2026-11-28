import type { Icon } from '@phosphor-icons/react';
import { X } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { BookingInstanceDTO } from '../-types/meetings-types';
import { parseUtc } from '../-utils/meetings-utils';

/*
 * Small layout pieces shared by My Schedule and Team Meetings. Everything here
 * works on bookings the page has already loaded — no requests of its own.
 */

/** Status → its label key in the `meetingsMeetingsList` namespace. */
export const MEETING_STATUS_KEY: Record<string, string> = {
    CONFIRMED: 'status.confirmed',
    PENDING: 'status.pending',
    COMPLETED: 'status.completed',
    NO_SHOW: 'status.noShow',
    CANCELLED: 'status.cancelled',
    RESCHEDULED: 'status.rescheduled',
};

/** Cancelled / rescheduled rows no longer take time on anyone's calendar. */
export const isActiveBooking = (b: BookingInstanceDTO): boolean =>
    b.status !== 'CANCELLED' && b.status !== 'RESCHEDULED';

/** Minutes on calls, from each active meeting's own start and end time. */
export const bookedMinutes = (bookings: BookingInstanceDTO[]): number =>
    bookings.filter(isActiveBooking).reduce((sum, b) => {
        const minutes =
            (parseUtc(b.scheduled_end_utc).getTime() - parseUtc(b.scheduled_start_utc).getTime()) /
            60000;
        return sum + (Number.isFinite(minutes) && minutes > 0 ? minutes : 0);
    }, 0);

/** Splits minutes into whole hours + leftover minutes for a "2h 30m" style label. */
export const splitMinutes = (total: number): { hours: number; minutes: number } => {
    const rounded = Math.round(total);
    return { hours: Math.floor(rounded / 60), minutes: rounded % 60 };
};

/** Page title row: icon tile, title, subtitle, optional badge and actions. */
export function MeetingsPageHeader({
    icon: I,
    title,
    subtitle,
    badge,
    actions,
}: {
    icon: Icon;
    title: string;
    subtitle: string;
    badge?: React.ReactNode;
    actions?: React.ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
                    <I size={20} weight="duotone" />
                </span>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-h2 font-semibold text-neutral-900">{title}</h1>
                        {badge}
                    </div>
                    <p className="mt-0.5 text-body text-neutral-500">{subtitle}</p>
                </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

/** A right-column card: icon + title (+ subtitle) header, optional action, body, footnote. */
export function SideCard({
    icon: I,
    title,
    subtitle,
    action,
    footer,
    children,
}: {
    icon: Icon;
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
    footer?: string;
    children: React.ReactNode;
}) {
    return (
        <Card className="flex flex-col gap-3 rounded-xl border-neutral-200 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <I size={16} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <p className="truncate text-body font-semibold text-neutral-800">{title}</p>
                        {subtitle && (
                            <p className="truncate text-caption text-neutral-500">{subtitle}</p>
                        )}
                    </div>
                </div>
                {action}
            </div>
            {children}
            {footer && (
                <p className="border-t border-neutral-100 pt-2 text-caption text-neutral-500">
                    {footer}
                </p>
            )}
        </Card>
    );
}

/** A small number + label tile for the "This week" card. */
export function StatTile({
    value,
    label,
    tone = 'neutral',
}: {
    value: string | number;
    label: string;
    tone?: 'neutral' | 'warning';
}) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
            <span
                className={cn(
                    'text-h3 font-bold tabular-nums',
                    tone === 'warning' ? 'text-warning-700' : 'text-neutral-900'
                )}
            >
                {value}
            </span>
            <span className="truncate text-caption text-neutral-500">{label}</span>
        </div>
    );
}

/** "Showing: Pending ×" chip so an active status filter is always visible and clearable. */
export function ActiveFilterChip({
    label,
    clearLabel,
    onClear,
}: {
    label: string;
    clearLabel: string;
    onClear: () => void;
}) {
    return (
        <span className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 py-0.5 pl-2.5 pr-1 text-caption font-medium text-primary-600">
            {label}
            <button
                type="button"
                onClick={onClear}
                title={clearLabel}
                aria-label={clearLabel}
                className="flex size-5 items-center justify-center rounded-full hover:bg-primary-100"
            >
                <X size={12} weight="bold" />
            </button>
        </span>
    );
}
