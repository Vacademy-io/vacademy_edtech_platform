import { formatDistanceStrict } from 'date-fns';
import { cn } from '@/lib/utils';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { TatDueOverridePopover } from '@/components/shared/tat-due-override-popover';

/** Parse a backend ISO string into a Date, treating missing TZ markers as UTC.
 *  Mirrors the normalisation in formatClock so both render paths agree. */
function parseTs(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(iso);
    const normalized = hasTimezone ? iso : `${iso.replace(' ', 'T')}Z`;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Two display modes for SLA cells in the leads tables:
 *
 * `mode = 'response'` — Reach-out-by column. Shows **when the counsellor actually contacted the lead**
 *   (the moment of their first activity — note / call / status change). Never shows the deadline.
 *     - Contacted on time: green "✓ Contacted · 5:30 PM"
 *     - Contacted late  : red   "✗ Contacted · 5:30 PM"
 *     - Not contacted, within TAT: neutral "Pending"
 *     - Not contacted, past TAT  : red "Overdue · No contact"
 *
 * `mode = 'deadline'` (default) — Follow-up by column. Shows the next deadline as a clock time;
 *   "Overdue" label in red if past.
 */
interface SlaDeadlineCellProps {
    /** ISO timestamp from the backend (tat_due_at / follow_up_due_at). */
    dueAt?: string | null;
    /** Force the overdue styling even if the clock hasn't crossed (uses the backend badge flag). */
    overdue?: boolean | null;
    /** First counsellor activity timestamp. Used in `response` mode to render the contact time. */
    respondedAt?: string | null;
    /** Reserved for older callers — no longer used (display is always clock times, no elapsed). */
    baselineAt?: string | null;
    /** Which display semantic to use. Defaults to 'deadline' to preserve Follow-up by behaviour. */
    mode?: 'response' | 'deadline';
    /** `response` mode: the lead's audience_response id — enables the admin "change deadline" pencil. */
    responseId?: string | null;
    /** `response` mode: the deadline was set by hand by an admin. */
    dueOverridden?: boolean | null;
    /** Lead is Lost / Converted (backend `sla_closed`): off the SLA clock, never Pending / Overdue. */
    closed?: boolean | null;
}

/** Format an ISO timestamp as "23 May, 5:30 PM" in the user's locale.
 *  Backend serialises Timestamps as bare ISO strings without a TZ marker; we
 *  interpret them as UTC and convert to the browser's local timezone. 12-hour
 *  clock via `hour12: true`. */
function formatClock(iso: string): string | null {
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(iso);
    const normalized = hasTimezone ? iso : `${iso.replace(' ', 'T')}Z`;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

export function SlaDeadlineCell({
    dueAt,
    overdue,
    respondedAt,
    baselineAt,
    mode = 'deadline',
    responseId,
    dueOverridden,
    closed,
}: SlaDeadlineCellProps) {
    // ── RESPONSE MODE — Reach-out-in column ──────────────────────────────────
    // Show the counsellor's contact time + how long it took relative to submitted_at.
    // Colour green when contacted on/before tat_due_at, red when contacted after.
    if (mode === 'response') {
        if (respondedAt) {
            const respondedDate = parseTs(respondedAt);
            const respondedFmt = respondedDate && formatClock(respondedAt);
            if (respondedDate && respondedFmt) {
                const dueDate = parseTs(dueAt);
                const onTime = !dueDate || respondedDate.getTime() <= dueDate.getTime();
                const baselineDate = parseTs(baselineAt);
                // "in 2 minutes" / "in 1 hour" — duration from submitted_at to first
                // counsellor activity. Hidden when the baseline is unknown.
                const delta =
                    baselineDate && respondedDate.getTime() >= baselineDate.getTime()
                        ? formatDistanceStrict(respondedDate, baselineDate)
                        : null;
                return (
                    <div
                        className={cn(
                            'flex flex-col gap-0.5',
                            onTime ? 'text-success-600' : 'text-danger-600'
                        )}
                    >
                        <span className="text-sm font-medium">{respondedFmt}</span>
                        {delta && <span className="text-xs">in {delta}</span>}
                    </div>
                );
            }
        }

        // Lost / converted before anyone logged contact: there is nothing left to reach out
        // for, so neither Pending nor Overdue applies.
        if (closed) return <span className="text-sm text-neutral-400">Closed</span>;

        // Not contacted yet. Show the deadline itself — with working hours it is no longer
        // simply "submitted + N hours" (e.g. an evening lead is due 10:00 the next morning).
        const dueDate = parseTs(dueAt);
        const dueFmt = dueAt ? formatClock(dueAt) : null;
        const pastTat = (dueDate !== null && dueDate.getTime() < Date.now()) || !!overdue;
        const canEdit = !!responseId && isAdminForInstitute(getCurrentInstituteId());
        const dueLine = dueFmt ? (
            <span
                className={cn(
                    'flex items-center gap-1 text-xs',
                    pastTat ? 'text-danger-600' : 'text-neutral-500'
                )}
            >
                {pastTat ? 'was due' : 'by'} {dueFmt}
                {dueOverridden && <span className="text-neutral-400">(set manually)</span>}
                {canEdit && (
                    <TatDueOverridePopover
                        responseId={responseId as string}
                        dueDate={dueDate}
                        overridden={dueOverridden}
                    />
                )}
            </span>
        ) : null;
        if (pastTat) {
            return (
                <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-danger-600">Overdue</span>
                    {dueLine ?? <span className="text-xs text-danger-600">No contact yet</span>}
                </div>
            );
        }
        return (
            <div className="flex flex-col gap-0.5">
                <span className="text-sm text-neutral-400">Pending</span>
                {dueLine}
            </div>
        );
    }

    // ── DEADLINE MODE — Follow-up by column ──────────────────────────────────
    if (!dueAt) return <span className="text-sm text-neutral-400">—</span>;
    const abs = formatClock(dueAt);
    if (!abs) return <span className="text-sm text-neutral-400">—</span>;

    // A callback still scheduled on a closed lead is moot — show it muted, never Overdue.
    if (closed) return <span className="text-sm text-neutral-400">{abs}</span>;

    const isPast = new Date(dueAt).getTime() < Date.now() || !!overdue;

    return (
        <div className="flex flex-col gap-0.5">
            <span
                className={cn(
                    'text-sm font-medium',
                    isPast ? 'text-danger-600' : 'text-neutral-800'
                )}
            >
                {abs}
            </span>
            {isPast && <span className="text-xs font-medium text-danger-600">Overdue</span>}
        </div>
    );
}
