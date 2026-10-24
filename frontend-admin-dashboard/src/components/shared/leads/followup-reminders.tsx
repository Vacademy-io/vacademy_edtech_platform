/**
 * Follow-up reminders — the "don't miss a follow-up" surface for counsellors.
 *
 * Data: GET /admin-core-service/v1/lead-followup/my-pending WITHOUT instituteId,
 * which the backend scopes to the caller's own open follow-ups (created_by =
 * caller) — so every counsellor (and admin) is only nagged about their own
 * commitments. Polled every minute.
 *
 * Two consumers:
 *   1. `FollowUpReminderDialog` — a global CENTERED modal mounted in __root.tsx
 *      that pops automatically when a follow-up is due (≤15 min away) or
 *      overdue. Closing it without acting snoozes the shown items locally for
 *      15 minutes (it comes back — that's the point); per-item actions are
 *      Mark done (shared close popover — closing note required), Snooze 1h/3h/tomorrow (reschedule API) and a
 *      jump to the Follow-ups page.
 *   2. The navbar bell — `useDueFollowupReminders` feeds a "Follow-up
 *      reminders" section + the badge count so the bell agrees with the modal.
 *
 * Local snoozes live in localStorage keyed by follow-up id so a dismissal
 * survives reloads but never mutates the actual schedule.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { format } from 'date-fns';
import { Alarm, ArrowSquareOut, CalendarCheck, CheckCircle, Phone } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { MY_PENDING_LEAD_FOLLOWUPS, UPDATE_LEAD_FOLLOWUP } from '@/constants/urls';
import { CompleteFollowUpPopover } from './complete-followup-popover';
import { useFollowUpFeatures } from './follow-up-fields';
import { getUserId } from '@/utils/userDetails';
import { cn, parseHtmlToString } from '@/lib/utils';

// ── Types + fetch ──────────────────────────────────────────────────────

/** Snake_case payload of LeadFollowupDto, incl. the my-pending lead fields. */
export interface PendingFollowup {
    id: string;
    audience_response_id: string;
    institute_id: string | null;
    created_by: string | null;
    schedule_time: string | null;
    status: string;
    is_closed: boolean;
    content: string | null;
    created_at?: string | null;
    lead_name: string | null;
    lead_mobile: string | null;
    lead_user_id: string | null;
}

async function fetchMyPendingFollowups(): Promise<PendingFollowup[]> {
    const { data } = await authenticatedAxiosInstance.get(MY_PENDING_LEAD_FOLLOWUPS);
    return Array.isArray(data) ? data : [];
}

// ── Local snooze store ─────────────────────────────────────────────────

const SNOOZE_KEY = 'vacademy-followup-reminder-snoozes';
const DISMISS_SNOOZE_MS = 15 * 60 * 1000;
/** A follow-up counts as "due" this far ahead of its schedule time. */
const DUE_SOON_MS = 15 * 60 * 1000;
const POLL_MS = 60 * 1000;

function readSnoozes(): Record<string, number> {
    try {
        const raw = localStorage.getItem(SNOOZE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, number>;
        const now = Date.now();
        // Prune expired entries so the map never grows unbounded.
        return Object.fromEntries(Object.entries(parsed).filter(([, until]) => until > now));
    } catch {
        return {};
    }
}

function snoozeLocally(ids: string[], ms: number) {
    const next = readSnoozes();
    const until = Date.now() + ms;
    ids.forEach((id) => {
        next[id] = until;
    });
    try {
        localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
    } catch {
        // Storage unavailable (private mode) — the reminder just re-pops sooner.
    }
}

// ── Hook ───────────────────────────────────────────────────────────────

export interface DueFollowupReminders {
    /** Open follow-ups due within 15 min or overdue (unsnoozed for `visible`). */
    due: PendingFollowup[];
    /** Due items not locally snoozed — what the modal actually shows. */
    visible: PendingFollowup[];
    isReady: boolean;
}

/**
 * Polls the caller's own pending follow-ups and classifies what's due.
 * `tick` re-evaluates due-ness every poll even without a refetch, so an
 * item crosses into "due" on time, not on the next server change.
 */
export function useDueFollowupReminders(): DueFollowupReminders {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const userId = getUserId();
    const [tick, setTick] = useState(0);

    const query = useQuery({
        queryKey: ['my-pending-followups', userId],
        queryFn: fetchMyPendingFollowups,
        enabled: !!accessToken && !!userId,
        refetchInterval: POLL_MS,
        staleTime: 30_000,
        retry: false,
    });

    useEffect(() => {
        const t = setInterval(() => setTick((v) => v + 1), POLL_MS);
        return () => clearInterval(t);
    }, []);

    return useMemo(() => {
        // `tick` intentionally participates so due-ness re-evaluates each minute.
        void tick;
        const now = Date.now();
        const due = (query.data ?? [])
            .filter((f) => !f.is_closed && f.schedule_time)
            .filter((f) => Date.parse(f.schedule_time as string) <= now + DUE_SOON_MS)
            .sort(
                (a, b) =>
                    Date.parse(a.schedule_time as string) - Date.parse(b.schedule_time as string)
            );
        const snoozes = readSnoozes();
        const visible = due.filter((f) => !snoozes[f.id]);
        return { due, visible, isReady: query.isSuccess };
    }, [query.data, query.isSuccess, tick]);
}

// ── Time helpers ───────────────────────────────────────────────────────

/** "Overdue by 2h" / "Due now" / "Due in 10m" for a schedule time. */
export function dueLabel(scheduleTime: string | null): {
    text: string;
    tone: 'overdue' | 'now' | 'soon';
} {
    const ts = scheduleTime ? Date.parse(scheduleTime) : NaN;
    if (Number.isNaN(ts)) return { text: 'Due', tone: 'now' };
    const diffMin = Math.round((ts - Date.now()) / 60000);
    if (diffMin <= -60 * 24) return { text: `Overdue by ${Math.floor(-diffMin / 1440)}d`, tone: 'overdue' };
    if (diffMin <= -60) return { text: `Overdue by ${Math.floor(-diffMin / 60)}h`, tone: 'overdue' };
    if (diffMin < -1) return { text: `Overdue by ${-diffMin}m`, tone: 'overdue' };
    if (diffMin <= 1) return { text: 'Due now', tone: 'now' };
    return { text: `Due in ${diffMin}m`, tone: 'soon' };
}

const contentPreview = (f: PendingFollowup): string | null => {
    if (!f.content) return null;
    const isHtml = /<\/?[a-z][^>]*>/i.test(f.content);
    const text = (isHtml ? parseHtmlToString(f.content) : f.content).trim();
    if (!text) return null;
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
};

const tomorrowAt9 = (): Date => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
};

const MAX_SHOWN = 6;

// ── Global centered dialog ─────────────────────────────────────────────

/**
 * " · Created 12 Oct, 4:10 PM" — only with the institute's follow-up history
 * switch on. Reads the switch here, not in the dialog: the dialog is mounted on
 * every page from __root, this only once a reminder row is on screen.
 */
function CreatedOn({ raw }: { raw: string }) {
    const { showHistory } = useFollowUpFeatures();
    if (!showHistory) return null;
    return <> · Created {format(new Date(raw), 'd MMM, h:mm a')}</>;
}

export function FollowUpReminderDialog() {
    const { visible } = useDueFollowupReminders();
    const [open, setOpen] = useState(false);
    // Bump to re-read localStorage snoozes after we write them.
    const [, setSnoozeVersion] = useState(0);
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Signature of what's currently due — a NEW due follow-up reopens the
    // dialog even if the user dismissed an earlier batch.
    const visibleSignature = visible.map((f) => f.id).join('|');
    useEffect(() => {
        if (visibleSignature) setOpen(true);
    }, [visibleSignature]);

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: ['my-pending-followups'] });

    const snoozeMutation = useMutation({
        mutationFn: ({ f, until }: { f: PendingFollowup; until: Date }) =>
            authenticatedAxiosInstance.put(UPDATE_LEAD_FOLLOWUP(f.id), {
                schedule_time: until.toISOString(),
            }),
        onSuccess: (_, { f, until }) => {
            toast.success(`Snoozed to ${format(until, 'd MMM, h:mm a')}`);
            queryClient.invalidateQueries({
                queryKey: ['lead-followups', f.audience_response_id],
            });
            void invalidate();
        },
        onError: () => toast.error('Failed to snooze follow-up'),
    });

    // Closing without acting = local 15-min snooze for everything shown, so
    // the reminder returns instead of being lost.
    const handleOpenChange = (next: boolean) => {
        if (!next && visible.length > 0) {
            snoozeLocally(
                visible.map((f) => f.id),
                DISMISS_SNOOZE_MS
            );
            setSnoozeVersion((v) => v + 1);
        }
        setOpen(next);
    };

    const goToFollowups = () => {
        handleOpenChange(false);
        navigate({ to: '/audience-manager/follow-ups' });
    };

    if (visible.length === 0) return null;
    const shown = visible.slice(0, MAX_SHOWN);
    const overflow = visible.length - shown.length;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
                <DialogHeader className="border-b border-neutral-100 bg-warning-50 px-5 py-4">
                    <DialogTitle className="flex items-center gap-2 text-base text-neutral-900">
                        <span className="flex size-8 items-center justify-center rounded-full bg-warning-100 text-warning-700">
                            <Alarm size={18} weight="bold" />
                        </span>
                        Follow-up reminder{visible.length > 1 ? 's' : ''}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-neutral-600">
                        {visible.length === 1
                            ? 'A follow-up you scheduled is due — don’t let this lead slip.'
                            : `${visible.length} follow-ups you scheduled are due — don’t let these leads slip.`}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex max-h-96 flex-col gap-2 overflow-y-auto px-5 py-4">
                    {shown.map((f) => {
                        const due = dueLabel(f.schedule_time);
                        const preview = contentPreview(f);
                        return (
                            <div
                                key={f.id}
                                className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-neutral-900">
                                            {f.lead_name ?? 'Lead'}
                                        </p>
                                        {f.lead_mobile && (
                                            <a
                                                href={`tel:${f.lead_mobile.replace(/[^+\d]/g, '')}`}
                                                className="flex items-center gap-1 text-xs font-medium text-primary-500 hover:underline"
                                            >
                                                <Phone size={12} weight="bold" />
                                                {f.lead_mobile}
                                            </a>
                                        )}
                                    </div>
                                    <span
                                        className={cn(
                                            'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                                            due.tone === 'overdue'
                                                ? 'bg-danger-100 text-danger-700'
                                                : due.tone === 'now'
                                                  ? 'bg-warning-100 text-warning-700'
                                                  : 'bg-info-100 text-info-700'
                                        )}
                                    >
                                        {due.text}
                                    </span>
                                </div>
                                {preview && (
                                    <p className="line-clamp-2 text-xs text-neutral-600">
                                        {preview}
                                    </p>
                                )}
                                {f.schedule_time && (
                                    <p className="text-xs text-neutral-400">
                                        Scheduled{' '}
                                        {format(new Date(f.schedule_time), 'd MMM, h:mm a')}
                                        {f.created_at && <CreatedOn raw={f.created_at} />}
                                    </p>
                                )}
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <CompleteFollowUpPopover
                                        audienceResponseId={f.audience_response_id}
                                        userId={f.lead_user_id ?? ''}
                                        followupId={f.id}
                                        invalidateKeys={[['my-pending-followups']]}
                                        align="start"
                                        trigger={
                                            <Button
                                                size="sm"
                                                className="h-7 gap-1 bg-success-600 px-2.5 text-xs text-white hover:bg-success-700"
                                            >
                                                <CheckCircle size={13} weight="bold" />
                                                Mark done
                                            </Button>
                                        }
                                    />
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-7 gap-1 px-2.5 text-xs"
                                                disabled={snoozeMutation.isPending}
                                            >
                                                <Alarm size={13} />
                                                Snooze
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start">
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    snoozeMutation.mutate({
                                                        f,
                                                        until: new Date(Date.now() + 60 * 60 * 1000),
                                                    })
                                                }
                                            >
                                                In 1 hour
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    snoozeMutation.mutate({
                                                        f,
                                                        until: new Date(
                                                            Date.now() + 3 * 60 * 60 * 1000
                                                        ),
                                                    })
                                                }
                                            >
                                                In 3 hours
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    snoozeMutation.mutate({ f, until: tomorrowAt9() })
                                                }
                                            >
                                                Tomorrow 9:00 am
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 gap-1 px-2.5 text-xs text-neutral-600"
                                        onClick={goToFollowups}
                                    >
                                        <ArrowSquareOut size={13} />
                                        Open
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                    {overflow > 0 && (
                        <p className="text-center text-xs text-neutral-500">
                            +{overflow} more due — see the Follow-ups page.
                        </p>
                    )}
                </div>

                <DialogFooter className="flex-row justify-between gap-2 border-t border-neutral-100 px-5 py-3 sm:justify-between">
                    <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-neutral-500"
                        onClick={() => handleOpenChange(false)}
                    >
                        Remind me in 15 min
                    </Button>
                    <Button size="sm" className="gap-1.5 text-xs" onClick={goToFollowups}>
                        <CalendarCheck size={14} weight="bold" />
                        Go to follow-ups
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
