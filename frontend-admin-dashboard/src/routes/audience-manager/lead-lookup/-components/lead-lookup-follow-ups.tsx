/**
 * Check Lead — the follow-up half of a match.
 *
 * Only an admin or the lead's own counsellor gets this data; for anyone else
 * the backend withholds it and sends follow_ups_visible: false. That case says
 * so in words, because an empty history would otherwise read as "nobody has
 * called this person yet" — the exact mistake Check Lead exists to prevent.
 */
import { CalendarCheck, Clock, LockSimple } from '@phosphor-icons/react';
import { formatDateTime } from '@/lib/formatters';
import { useFollowUpFeatures } from '@/components/shared/leads/follow-up-fields';
import { cn, parseHtmlToString } from '@/lib/utils';
import type { LeadLookupFollowUp, LeadLookupResult } from '../-services/lead-lookup';

const FOLLOW_UP_STATUS: Record<string, { label: string; className: string }> = {
    PENDING: { label: 'Pending', className: 'bg-info-50 text-info-700' },
    ONGOING: { label: 'Ongoing', className: 'bg-warning-50 text-warning-700' },
    OVERDUE: { label: 'Overdue', className: 'bg-danger-50 text-danger-600' },
    COMPLETED: { label: 'Completed', className: 'bg-success-50 text-success-700' },
};

export function LeadLookupFollowUps({ result }: { result: LeadLookupResult }) {
    // Older backends don't send the flag at all — show nothing rather than
    // telling an admin the lead belongs to someone else.
    if (result.follow_ups_visible === undefined) return null;
    if (!result.follow_ups_visible) {
        return (
            <p className="flex items-center gap-2 rounded-md bg-neutral-50 px-3 py-2 text-body text-neutral-500">
                <LockSimple className="size-4 shrink-0" />
                This lead is assigned to another counsellor, so its follow-up history is hidden.
            </p>
        );
    }

    const followUps = result.follow_ups ?? [];
    return (
        <div className="space-y-3">
            <p className="font-medium text-neutral-700">Follow-up history</p>

            {/* design-lint-ignore arbitrary-grid-template — same label/value layout
                as the lead details above. */}
            <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-[auto_1fr]">
                <Row label="Lead created" value={dateTime(result.lead_created_at)} />
                <Row
                    label="Next follow-up"
                    value={dateTime(result.next_follow_up_at) || 'None scheduled'}
                />
                <Row label="Interest level" value={result.interest_level} />
            </dl>

            {followUps.length === 0 ? (
                <p className="text-body text-neutral-500">No follow-ups logged yet.</p>
            ) : (
                <ol className="space-y-2">
                    {followUps.map((f, i) => (
                        <FollowUpItem key={`${f.created_at ?? ''}-${i}`} followUp={f} />
                    ))}
                </ol>
            )}
        </div>
    );
}

function FollowUpItem({ followUp }: { followUp: LeadLookupFollowUp }) {
    const { showHistory } = useFollowUpFeatures();
    const status = FOLLOW_UP_STATUS[followUp.status ?? ''] ?? FOLLOW_UP_STATUS.PENDING!;
    const comments = followUp.comments ? toPlainText(followUp.comments) : '';
    const details: [string, string | undefined][] = [
        [
            'Created',
            showHistory && followUp.created_at ? formatDateTime(followUp.created_at) : undefined,
        ],
        ['Counsellor', followUp.counsellor_name],
        ['Interest level', followUp.interest_level],
        ['Action label', followUp.action_label],
        ['Mode', followUp.mode],
        ['Student response', followUp.student_response],
    ];

    return (
        <li className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
                <span
                    className={cn(
                        'rounded-full px-2 py-0.5 text-caption font-semibold',
                        status.className
                    )}
                >
                    {status.label}
                </span>
                {followUp.schedule_time && (
                    <span className="flex items-center gap-1.5 text-caption text-neutral-500">
                        <Clock weight="fill" className="size-3.5 shrink-0 text-neutral-400" />
                        {formatDateTime(followUp.schedule_time)}
                    </span>
                )}
                {followUp.closed_at && (
                    <span className="flex items-center gap-1.5 text-caption text-neutral-500">
                        <CalendarCheck className="size-3.5 shrink-0 text-neutral-400" />
                        Closed {formatDateTime(followUp.closed_at)}
                    </span>
                )}
            </div>

            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                {details.map(([label, value]) =>
                    value ? (
                        <div key={label} className="flex gap-1.5 text-caption">
                            <dt className="text-neutral-500">{label}:</dt>
                            <dd className="font-medium text-neutral-700">{value}</dd>
                        </div>
                    ) : null
                )}
            </dl>

            {comments && (
                <p className="mt-2 whitespace-pre-line text-body text-neutral-600">{comments}</p>
            )}
            {followUp.closer_reason && (
                <p className="mt-1.5 text-caption italic text-neutral-400">
                    Closing note: {followUp.closer_reason}
                </p>
            )}
        </li>
    );
}

function dateTime(value?: string): string {
    return value ? formatDateTime(value) : '';
}

/** Comments come from a rich-text editor and may be HTML. */
function toPlainText(value: string): string {
    return /<\/?[a-z][^>]*>/i.test(value) ? parseHtmlToString(value).trim() : value.trim();
}

function Row({ label, value }: { label: string; value?: string }) {
    if (!value) return null;
    return (
        <>
            <dt className="text-body text-neutral-500">{label}</dt>
            <dd className="text-body font-medium text-neutral-800">{value}</dd>
        </>
    );
}
