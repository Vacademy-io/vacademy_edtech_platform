/**
 * Post-call disposition capture.
 *
 * When a click-to-call reaches a terminal state (COMPLETED / NO_ANSWER / BUSY /
 * FAILED), `usePlaceCall` lazy-imports this module and calls
 * {@link openPostCallDisposition}. A right-side Radix Sheet opens and lets the
 * counsellor log outcome + lead status + note + next follow-up in ONE submit —
 * each underlying request fires only when its field actually changed/filled.
 *
 * Hosting: calls can be placed from several routes (Recent Leads, Follow-ups,
 * Audience lists) and none of them owns a global overlay slot, so the sheet
 * self-mounts into its own React root on first use — same imperative-modal
 * pattern as `VerifyEmailWithOtp.tsx`. A tiny zustand store carries the payload
 * across roots; the main app's QueryClient is passed in explicitly so cache
 * invalidations land on the real cache despite the separate root.
 *
 * Per-user opt-out: localStorage `crm-postcall-sheet-disabled` — when set, the
 * sheet doesn't auto-open; a toast with a "Log disposition" action is shown
 * instead (same sheet, on demand).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import { createRoot } from 'react-dom/client';
import { create } from 'zustand';
import {
    QueryClientProvider,
    useMutation,
    useQuery,
    useQueryClient,
    type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { CaretDown, Check, CircleNotch } from '@phosphor-icons/react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MyButton } from '@/components/design-system/button';
import { LeadStatusChip } from '@/components/shared/lead-status-chip';
import { cn } from '@/lib/utils';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CREATE_TIMELINE_EVENT, CREATE_LEAD_FOLLOWUP } from '@/constants/urls';
import {
    FollowUpFields,
    useFollowUpFeatures,
    useFollowUpFields,
    useFollowUpNotesRequired,
} from './follow-up-fields';
import {
    fetchLeadStatuses,
    setLeadStatusForLead,
    LEAD_STATUSES_QUERY_KEY,
    type LeadStatus,
} from '@/hooks/use-lead-statuses';
import { callActivityToMetadata } from '@/components/shared/lead-calls/call-activity';
import { LeadAvatar } from './lead-avatar';
import { CallStatusPill } from './lead-call-history';

// ─── Public contract ─────────────────────────────────────────────────────────

/** Terminal call statuses that warrant a disposition (CANCELLED is excluded —
 *  the counsellor never reached the lead's line, there's nothing to log). */
export type PostCallTerminalStatus = 'COMPLETED' | 'NO_ANSWER' | 'BUSY' | 'FAILED';

export interface PostCallDispositionPayload {
    /** telephony_call_log row id — linked into the note's metadata. */
    callLogId: string;
    status: PostCallTerminalStatus;
    durationSeconds: number | null;
    /** Lead's user id — required for the timeline note; status change and
     *  follow-up still work without it. */
    leadUserId?: string;
    leadName?: string;
    /** audience_response_id — target of the status change + follow-up. */
    responseId: string;
    /** Lead's current pipeline status (key or label), when the caller knows it —
     *  pre-selects the status picker so submit only fires on a real change. */
    currentStatus?: string | null;
    /** Main app's QueryClient. The sheet renders in its own React root, so the
     *  client is passed explicitly instead of read from context. */
    queryClient: QueryClient;
}

// ─── Per-user opt-out (localStorage) ─────────────────────────────────────────

const OPT_OUT_KEY = 'crm-postcall-sheet-disabled';

export function isPostCallAutoOpenDisabled(): boolean {
    try {
        return localStorage.getItem(OPT_OUT_KEY) === 'true';
    } catch {
        return false;
    }
}

function setPostCallAutoOpenDisabled(disabled: boolean): void {
    try {
        if (disabled) localStorage.setItem(OPT_OUT_KEY, 'true');
        else localStorage.removeItem(OPT_OUT_KEY);
    } catch {
        /* private mode etc. — opt-out simply won't persist */
    }
}

// ─── Cross-root store + self-mounting host ──────────────────────────────────

interface PostCallDispositionState {
    payload: PostCallDispositionPayload | null;
    open: (payload: PostCallDispositionPayload) => void;
    close: () => void;
}

const usePostCallDispositionStore = create<PostCallDispositionState>((set) => ({
    payload: null,
    open: (payload) => set({ payload }),
    close: () => set({ payload: null }),
}));

// Module singleton — the host root survives route changes and is created at
// most once (same pattern as the OTP modal root in VerifyEmailWithOtp.tsx).
let hostRoot: ReturnType<typeof createRoot> | null = null;

function ensureHostMounted(): void {
    if (hostRoot || typeof document === 'undefined') return;
    let container = document.getElementById('__post_call_disposition_root');
    if (!container) {
        container = document.createElement('div');
        container.id = '__post_call_disposition_root';
        document.body.appendChild(container);
    }
    hostRoot = createRoot(container);
    hostRoot.render(<PostCallDispositionHost />);
}

function PostCallDispositionHost() {
    const payload = usePostCallDispositionStore((s) => s.payload);
    const close = usePostCallDispositionStore((s) => s.close);
    if (!payload) return null;
    return (
        <QueryClientProvider client={payload.queryClient}>
            {/* key resets the form state when a new call's disposition opens */}
            <PostCallDispositionSheet key={payload.callLogId} payload={payload} onClose={close} />
        </QueryClientProvider>
    );
}

const STATUS_TOAST_LABEL: Record<PostCallTerminalStatus, string> = {
    COMPLETED: 'Call ended',
    NO_ANSWER: 'No answer',
    BUSY: 'Lead was busy',
    FAILED: 'Call failed',
};

/**
 * Entry point called by `usePlaceCall` after the live-status toast resolves on
 * a terminal call state. Opens the sheet immediately, unless the user opted
 * out of auto-open (or another disposition is mid-edit) — then a toast with a
 * "Log disposition" action offers the same sheet on demand. Never throws.
 */
export function openPostCallDisposition(payload: PostCallDispositionPayload): void {
    ensureHostMounted();
    const store = usePostCallDispositionStore.getState();
    // Auto-open disabled, or a sheet for a *different* call is already open
    // (never clobber a counsellor's in-progress typing) → toast action instead.
    if (
        isPostCallAutoOpenDisabled() ||
        (store.payload && store.payload.callLogId !== payload.callLogId)
    ) {
        toast(STATUS_TOAST_LABEL[payload.status], {
            description: payload.leadName
                ? `Log the outcome for ${payload.leadName}?`
                : 'Log the outcome for this call?',
            action: {
                label: 'Log disposition',
                onClick: () => {
                    ensureHostMounted();
                    usePostCallDispositionStore.getState().open(payload);
                },
            },
            duration: 8000,
        });
        return;
    }
    store.open(payload);
}

// ─── Sheet UI ────────────────────────────────────────────────────────────────

const NOTE_PLACEHOLDER: Record<PostCallTerminalStatus, string> = {
    COMPLETED: 'What happened on this call?',
    NO_ANSWER: 'No answer — add context?',
    BUSY: 'Line was busy — add context?',
    FAILED: 'Call failed — add context?',
};

/** Maps the telephony terminal status to the existing Call Log outcome keys
 *  (see CALL_OUTCOMES in lead-calls/call-activity.ts). */
const OUTCOME_BY_STATUS: Record<PostCallTerminalStatus, string> = {
    COMPLETED: 'CONNECTED',
    NO_ANSWER: 'NO_ANSWER',
    BUSY: 'BUSY',
    FAILED: 'NOT_REACHABLE',
};

/** Quick follow-up chips — all land at 10:00 local so reminders are predictable. */
const QUICK_FOLLOW_UPS: Array<{ label: string; days: number }> = [
    { label: 'Tomorrow 10am', days: 1 },
    { label: '+3 days', days: 3 },
    { label: 'Next week', days: 7 },
];

/** Date → <input type="datetime-local"> value (browser-local "YYYY-MM-DDTHH:mm"). */
const toLocalInputValue = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours()
    )}:${pad(d.getMinutes())}`;
};

const quickFollowUpValue = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(10, 0, 0, 0);
    return toLocalInputValue(d);
};

const formatDurationLabel = (s: number | null): string => {
    if (!s || s <= 0) return '';
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m === 0 ? `${r}s` : `${m}m ${r}s`;
};

const normalizeStatus = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '_');

function PostCallDispositionSheet({
    payload,
    onClose,
}: {
    payload: PostCallDispositionPayload;
    onClose: () => void;
}) {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(true);
    // The institute's own word for "Lead status" (e.g. "Action Label").
    const terminology = useLeadTerminology();
    const [note, setNote] = useState('');
    const [followUpAt, setFollowUpAt] = useState('');
    const followUpFields = useFollowUpFields();
    const notesRequired = useFollowUpNotesRequired();
    const { keepPopupsOpen } = useFollowUpFeatures();
    const keepOpen = keepPopupsOpen ? (e: Event) => e.preventDefault() : undefined;
    const [statusPickerOpen, setStatusPickerOpen] = useState(false);
    // null = untouched (keep the lead's current status — nothing is posted).
    const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null);
    const [optedOut, setOptedOut] = useState(isPostCallAutoOpenDisabled);

    // Close with the Radix slide-out animation before unmounting the content.
    const closeTimerRef = useRef<number | null>(null);
    useEffect(
        () => () => {
            if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
        },
        []
    );
    const requestClose = () => {
        if (closeTimerRef.current !== null) return;
        setOpen(false);
        closeTimerRef.current = window.setTimeout(onClose, 300);
    };

    // Pipeline statuses — shared cache with the rest of the leads UI.
    const { data: statuses = [], isLoading: statusesLoading } = useQuery({
        queryKey: LEAD_STATUSES_QUERY_KEY,
        queryFn: fetchLeadStatuses,
        staleTime: 5 * 60 * 1000,
    });

    const chipStatuses = useMemo(
        () =>
            statuses.map((s) => ({
                key: s.status_key,
                label: s.label,
                color: s.color,
                order: s.display_order,
            })),
        [statuses]
    );

    // Lead's current status (when the caller knew it) → pre-selected baseline;
    // submit only fires the status endpoint when the selection differs from it.
    const initialStatusId = useMemo(() => {
        const norm = payload.currentStatus ? normalizeStatus(payload.currentStatus) : null;
        if (!norm) return null;
        return (
            statuses.find(
                (s) => normalizeStatus(s.status_key) === norm || normalizeStatus(s.label) === norm
            )?.id ?? null
        );
    }, [statuses, payload.currentStatus]);

    const effectiveStatusId = selectedStatusId ?? initialStatusId;
    const effectiveStatus = statuses.find((s) => s.id === effectiveStatusId) ?? null;
    const statusChanged = selectedStatusId !== null && selectedStatusId !== initialStatusId;

    const noteTrimmed = note.trim();
    // A note needs the lead's userId for the timeline event; without one it can
    // still ride along as the follow-up's content.
    const noteSavable = noteTrimmed.length > 0 && (!!payload.leadUserId || !!followUpAt);
    // Only blocks the paths that actually create a follow-up — a counsellor who just
    // sets a status here is not logging a follow-up and must stay unblocked.
    const followUpNoteMissing = !!followUpAt && notesRequired && noteTrimmed.length === 0;
    const canSave =
        (statusChanged || !!followUpAt || noteSavable) &&
        !followUpNoteMissing &&
        !(!!followUpAt && followUpFields.missingRequired);

    // Tracks which steps already succeeded so a retry after a partial failure
    // doesn't duplicate the completed requests.
    const doneRef = useRef({ status: false, note: false, followUp: false });

    const saveMutation = useMutation({
        mutationFn: async () => {
            if (statusChanged && selectedStatusId && !doneRef.current.status) {
                await setLeadStatusForLead(payload.responseId, selectedStatusId, 'MANUAL');
                doneRef.current.status = true;
            }
            if (noteTrimmed && payload.leadUserId && !doneRef.current.note) {
                // Same payload shape as AddLeadNoteDialog's CALL_LOG tab.
                await authenticatedAxiosInstance.post(CREATE_TIMELINE_EVENT, {
                    type: 'STUDENT',
                    type_id: payload.leadUserId,
                    action_type: 'CALL_LOG',
                    title: 'Call Log',
                    description: noteTrimmed,
                    student_user_id: payload.leadUserId,
                    metadata: {
                        ...callActivityToMetadata({
                            direction: 'OUTBOUND',
                            outcome: OUTCOME_BY_STATUS[payload.status],
                            telephonyCallLogId: payload.callLogId,
                        }),
                        // Plain call duration — the recording_* metadata keys are
                        // reserved for attached audio, which this auto-log lacks.
                        ...(payload.durationSeconds != null
                            ? { call_duration_seconds: payload.durationSeconds }
                            : {}),
                    },
                });
                doneRef.current.note = true;
            }
            if (followUpAt && !doneRef.current.followUp) {
                await authenticatedAxiosInstance.post(CREATE_LEAD_FOLLOWUP, {
                    audience_response_id: payload.responseId,
                    schedule_time: new Date(followUpAt).toISOString(),
                    content: noteTrimmed || null,
                    ...followUpFields.payload,
                });
                doneRef.current.followUp = true;
            }
        },
        onSuccess: () => {
            toast.success('Disposition saved');
            queryClient.invalidateQueries({ queryKey: ['recent-leads'] });
            queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
            queryClient.invalidateQueries({ queryKey: ['lead-profiles-batch'] });
            queryClient.invalidateQueries({ queryKey: ['latest-notes-batch'] });
            queryClient.invalidateQueries({ queryKey: ['lead-all-events'] });
            queryClient.invalidateQueries({
                queryKey: ['lead-followups', payload.responseId],
            });
            requestClose();
        },
        onError: () => toast.error('Could not save disposition — try again'),
    });

    const handleStatusPick = (status: LeadStatus) => {
        setStatusPickerOpen(false);
        setSelectedStatusId(status.id);
    };

    const durationLabel = formatDurationLabel(payload.durationSeconds);
    const leadName = payload.leadName?.trim() || 'Lead';

    return (
        <Sheet
            open={open}
            onOpenChange={(o) => {
                // Escape / overlay click — dismiss without side effects.
                if (!o) requestClose();
            }}
        >
            <SheetContent
                side="right"
                className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md"
                // "Close pop-ups only with X" on: only X / Skip close it, so a
                // stray click does not drop the typed note.
                onInteractOutside={keepOpen}
                onEscapeKeyDown={keepOpen}
            >
                <SheetHeader className="space-y-0 border-b border-neutral-100 px-6 py-4 text-left">
                    <div className="flex items-center gap-3">
                        <LeadAvatar name={payload.leadName} size="md" />
                        <div className="min-w-0">
                            <SheetTitle className="truncate text-base font-semibold text-neutral-800">
                                {leadName}
                            </SheetTitle>
                            <SheetDescription className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
                                <CallStatusPill status={payload.status} />
                                {durationLabel && <span>{durationLabel}</span>}
                            </SheetDescription>
                        </div>
                    </div>
                </SheetHeader>

                <div className="flex-1 space-y-5 px-6 py-4">
                    {/* Lead status — deferred picker; persisted only on Save. */}
                    <div className="space-y-1.5">
                        <span className="text-xs font-medium text-neutral-700">
                            {terminology.leadStatus}
                        </span>
                        {statusesLoading ? (
                            <div className="flex h-9 items-center gap-2 rounded-lg border border-neutral-200 px-3 text-xs text-neutral-400">
                                <CircleNotch className="size-3.5 animate-spin" />
                                Loading statuses…
                            </div>
                        ) : statuses.length === 0 ? (
                            <p className="text-xs text-neutral-400">
                                No pipeline statuses configured for this institute.
                            </p>
                        ) : (
                            <Popover open={statusPickerOpen} onOpenChange={setStatusPickerOpen}>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-left transition-colors hover:border-neutral-300 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-300"
                                    >
                                        {effectiveStatus ? (
                                            <LeadStatusChip
                                                status={effectiveStatus.status_key}
                                                statuses={chipStatuses}
                                                size="sm"
                                            />
                                        ) : (
                                            <span className="text-sm text-neutral-400">
                                                Keep current status
                                            </span>
                                        )}
                                        <CaretDown className="size-3.5 shrink-0 text-neutral-400" />
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-64 p-1">
                                    <div className="flex max-h-64 flex-col overflow-y-auto">
                                        {statuses.map((s) => {
                                            const active = s.id === effectiveStatusId;
                                            return (
                                                <button
                                                    key={s.id}
                                                    type="button"
                                                    onClick={() => handleStatusPick(s)}
                                                    className={cn(
                                                        'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-100',
                                                        active
                                                            ? 'font-medium text-neutral-900'
                                                            : 'text-neutral-700'
                                                    )}
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <span
                                                            className="size-2 shrink-0 rounded-full"
                                                            // Status colour is arbitrary user-picked hex — no token equivalent.
                                                            style={{ backgroundColor: s.color }}
                                                        />
                                                        {s.label}
                                                    </span>
                                                    {active && (
                                                        <Check className="size-3.5 text-primary-600" />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        )}
                    </div>

                    {/* Note — posts a CALL_LOG timeline event linked to this call. */}
                    <div className="space-y-1.5">
                        <label
                            htmlFor="post-call-note"
                            className="text-xs font-medium text-neutral-700"
                        >
                            Note
                        </label>
                        <Textarea
                            id="post-call-note"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder={NOTE_PLACEHOLDER[payload.status]}
                            rows={4}
                            autoFocus
                            className="text-sm"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSave) {
                                    e.preventDefault();
                                    saveMutation.mutate();
                                }
                            }}
                        />
                        {noteTrimmed.length > 0 && !payload.leadUserId && !followUpAt && (
                            <p className="text-xs text-warning-600">
                                No lead profile linked — add a follow-up time to keep this note, or
                                it can&apos;t be saved.
                            </p>
                        )}
                    </div>

                    {/* Next follow-up — optional; creates a lead_followup row. */}
                    <div className="space-y-1.5">
                        <label
                            htmlFor="post-call-followup"
                            className="text-xs font-medium text-neutral-700"
                        >
                            Next follow-up{' '}
                            <span className="font-normal text-neutral-400">(optional)</span>
                        </label>
                        <input
                            id="post-call-followup"
                            type="datetime-local"
                            value={followUpAt}
                            onChange={(e) => setFollowUpAt(e.target.value)}
                            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-300"
                        />
                        <div className="flex flex-wrap gap-1.5">
                            {QUICK_FOLLOW_UPS.map((chip) => {
                                const value = quickFollowUpValue(chip.days);
                                const active = followUpAt === value;
                                return (
                                    <button
                                        key={chip.label}
                                        type="button"
                                        onClick={() => setFollowUpAt(active ? '' : value)}
                                        className={cn(
                                            'rounded-full border px-2.5 py-1 text-xs transition-colors',
                                            active
                                                ? 'border-primary-300 bg-primary-50 font-medium text-primary-700'
                                                : 'border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50'
                                        )}
                                    >
                                        {chip.label}
                                    </button>
                                );
                            })}
                        </div>
                        {followUpNoteMissing && (
                            <p className="text-xs text-danger-600">
                                Your institute requires a note on every follow-up.
                            </p>
                        )}
                        {!!followUpAt && followUpFields.missingRequired && (
                            <p className="text-xs text-danger-600">
                                Answer every field marked * before scheduling this follow-up.
                            </p>
                        )}
                        {/* Institute-configured response / mode / next-action dropdowns.
                            Only once a time is set — they describe the follow-up being
                            scheduled, so they'd be answering about nothing before that. */}
                        {followUpAt && followUpFields.visible && (
                            <FollowUpFields
                                values={followUpFields.values}
                                onChange={followUpFields.setValues}
                                portal={false}
                                className="pt-1"
                            />
                        )}
                    </div>
                </div>

                <div className="space-y-3 border-t border-neutral-100 px-6 py-4">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-500">
                        <Checkbox
                            checked={optedOut}
                            onCheckedChange={(checked) => {
                                const disabled = checked === true;
                                setOptedOut(disabled);
                                setPostCallAutoOpenDisabled(disabled);
                            }}
                        />
                        Don&apos;t open automatically after calls
                    </label>
                    <div className="flex items-center justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={requestClose}
                            disable={saveMutation.isPending}
                        >
                            Skip
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => saveMutation.mutate()}
                            disable={!canSave || saveMutation.isPending}
                        >
                            {saveMutation.isPending ? 'Saving…' : 'Save disposition'}
                        </MyButton>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
