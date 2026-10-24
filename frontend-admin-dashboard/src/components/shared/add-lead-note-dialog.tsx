import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { cn, parseHtmlToString } from '@/lib/utils';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CREATE_TIMELINE_EVENT, CREATE_LEAD_FOLLOWUP } from '@/constants/urls';
import {
    FollowUpFields,
    useFollowUpFeatures,
    useFollowUpFields,
    useFollowUpNotesRequired,
} from '@/components/shared/leads/follow-up-fields';
import { CallRecordingInput } from '@/components/shared/lead-calls/CallRecordingInput';
import {
    type CallActivity,
    callActivityToMetadata,
    isCallActivityEmpty,
} from '@/components/shared/lead-calls/call-activity';
import { NotePencil, Phone, CalendarCheck, Buildings } from '@phosphor-icons/react';
import { LeadAvatar } from '@/components/shared/leads/lead-avatar';

const NOTE_ACTION_TYPES = [
    { value: 'NOTE', label: 'Note', icon: <NotePencil weight="fill" className="size-3.5" /> },
    { value: 'CALL_LOG', label: 'Call Log', icon: <Phone weight="fill" className="size-3.5" /> },
    {
        value: 'FOLLOW_UP',
        label: 'Follow Up',
        icon: <CalendarCheck weight="fill" className="size-3.5" />,
    },
    { value: 'MEETING', label: 'Meeting', icon: <Buildings weight="fill" className="size-3.5" /> },
];

interface AddLeadNoteDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userId: string;
    userName?: string;
    /** Required to schedule a follow-up via POST /v1/lead-followup. When missing,
     *  the Follow Up tab is disabled with an inline hint. */
    audienceResponseId?: string;
    onSuccess?: () => void;
    /** Called only after a follow-up (not a note) is saved — the Follow-ups
     *  page closes the previous follow-up here, so dismissing the dialog
     *  leaves it pending instead of completed with nothing booked. */
    onFollowUpScheduled?: () => void;
    /** Pre-select an action tab when the dialog opens (e.g. CALL_LOG when
     *  invoked from a row in the Call History panel). */
    initialActionType?: string;
    /** Pre-fill the CallActivity (direction, phone, telephonyCallLogId, …) when
     *  the dialog opens from a specific call row. */
    initialCallActivity?: CallActivity | null;
    /** Hide the Record/Upload audio controls — true when the linked call already
     *  carries its own recording from the telephony provider. */
    hideCallRecordingControls?: boolean;
}

export const AddLeadNoteDialog = ({
    open,
    onOpenChange,
    userId,
    userName,
    audienceResponseId,
    onSuccess,
    onFollowUpScheduled,
    initialActionType,
    initialCallActivity,
    hideCallRecordingControls = false,
}: AddLeadNoteDialogProps) => {
    const [noteText, setNoteText] = useState('');
    const [actionType, setActionType] = useState(initialActionType ?? 'NOTE');
    const [callActivity, setCallActivity] = useState<CallActivity | null>(
        initialCallActivity ?? null
    );
    // Re-seed state on the *transition* from closed → open. Doing it on every
    // change to `initialCallActivity` would wipe the counsellor's typing every
    // time the parent re-renders (the call-history query refetching mid-edit,
    // say), since the parent rebuilds the initial object inline.
    const wasOpenRef = useRef(open);
    useEffect(() => {
        if (open && !wasOpenRef.current) {
            setActionType(initialActionType ?? 'NOTE');
            setCallActivity(initialCallActivity ?? null);
        }
        wasOpenRef.current = open;
    }, [open, initialActionType, initialCallActivity]);
    // Counsellor-set callback time when Follow Up is the active tab. Stored as the
    // raw <input type="datetime-local"> value (browser-local "YYYY-MM-DDTHH:mm"),
    // converted to ISO at submit-time so the backend receives a UTC timestamp.
    const [scheduleTime, setScheduleTime] = useState('');
    const queryClient = useQueryClient();

    const isFollowUp = actionType === 'FOLLOW_UP';
    const followUpFields = useFollowUpFields();
    const notesRequired = useFollowUpNotesRequired();
    const { keepPopupsOpen } = useFollowUpFeatures();
    // With the institute's "close pop-ups only with X" switch on, a stray click
    // outside (or Escape) no longer closes the dialog and wipes what was typed;
    // only X / Cancel do. Off = the old behaviour.
    const keepOpen = keepPopupsOpen ? (e: Event) => e.preventDefault() : undefined;

    // The rich text editor emits HTML — check the rendered text for emptiness.
    const isNoteEmpty = !parseHtmlToString(noteText).trim();

    // For Call Log, a recording / call details alone are enough to submit.
    const callMeta =
        actionType === 'CALL_LOG' && !isCallActivityEmpty(callActivity)
            ? callActivityToMetadata(callActivity as CallActivity)
            : undefined;
    const canSubmit = isFollowUp
        ? !!scheduleTime &&
          !!audienceResponseId &&
          (!notesRequired || !isNoteEmpty) &&
          !followUpFields.missingRequired
        : !isNoteEmpty || callMeta !== undefined;

    const resetState = () => {
        setNoteText('');
        setActionType('NOTE');
        setCallActivity(null);
        setScheduleTime('');
        followUpFields.reset();
    };

    const createNoteMutation = useMutation({
        mutationFn: async () => {
            const label = NOTE_ACTION_TYPES.find((t) => t.value === actionType)?.label ?? 'Note';
            const response = await authenticatedAxiosInstance.post(CREATE_TIMELINE_EVENT, {
                type: 'STUDENT',
                type_id: userId,
                action_type: actionType,
                title: label,
                description: noteText.trim(),
                student_user_id: userId,
                // metadata_json is free-form, so the student's response rides along
                // with a note (or a call log) without a schema change.
                metadata:
                    callMeta || followUpFields.noteMetadata()
                        ? { ...(callMeta ?? {}), ...(followUpFields.noteMetadata() ?? {}) }
                        : undefined,
            });
            return response.data;
        },
        onSuccess: () => {
            toast.success('Note added');
            resetState();
            queryClient.invalidateQueries({ queryKey: ['latest-notes-batch'] });
            queryClient.invalidateQueries({ queryKey: ['cross-stage-timeline', userId] });
            // Lead Journey timeline (used in student-lead-profile side view)
            // reads via 'lead-all-events' — without invalidating it, a note
            // added from the Call History row wouldn't appear in Lead Journey
            // until the user manually refreshed.
            queryClient.invalidateQueries({ queryKey: ['lead-all-events', userId] });
            onSuccess?.();
            onOpenChange(false);
        },
        onError: () => toast.error('Failed to add note'),
    });

    const createFollowUpMutation = useMutation({
        mutationFn: () =>
            authenticatedAxiosInstance.post(CREATE_LEAD_FOLLOWUP, {
                audience_response_id: audienceResponseId,
                schedule_time: scheduleTime ? new Date(scheduleTime).toISOString() : null,
                content: noteText.trim() || null,
                ...followUpFields.payload,
            }),
        onSuccess: () => {
            toast.success('Follow-up scheduled');
            resetState();
            // Refresh the lead lists so the new schedule_time appears in the
            // "Follow up at" column and the followups-by-lead query is fresh.
            if (audienceResponseId) {
                queryClient.invalidateQueries({
                    queryKey: ['lead-followups', audienceResponseId],
                });
            }
            queryClient.invalidateQueries({ queryKey: ['recent-leads'] });
            queryClient.invalidateQueries({ queryKey: ['campaign-users'] });
            queryClient.invalidateQueries({ queryKey: ['latest-notes-batch'] });
            queryClient.invalidateQueries({ queryKey: ['cross-stage-timeline', userId] });
            queryClient.invalidateQueries({ queryKey: ['lead-all-events', userId] });
            onFollowUpScheduled?.();
            onSuccess?.();
            onOpenChange(false);
        },
        onError: () => toast.error('Failed to schedule follow-up'),
    });

    const isPending = createNoteMutation.isPending || createFollowUpMutation.isPending;
    const submit = () => {
        if (!canSubmit || isPending) return;
        if (isFollowUp) createFollowUpMutation.mutate();
        else createNoteMutation.mutate();
    };

    const handleClose = () => {
        if (isPending) return;
        resetState();
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
            <DialogContent
                className="flex w-full flex-col overflow-hidden p-0 sm:max-w-lg"
                // Inline style: cap height to the viewport so tall content (e.g. Call Log)
                // scrolls inside the dialog instead of overflowing the screen.
                style={{ maxHeight: '90vh' }}
                onInteractOutside={keepOpen}
                onEscapeKeyDown={keepOpen}
            >
                <DialogHeader className="border-b border-neutral-100 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <LeadAvatar name={userName} size="md" />
                        <div className="min-w-0 text-left">
                            <DialogTitle>Add activity</DialogTitle>
                            <DialogDescription className="truncate">
                                {userName
                                    ? `Log a note or activity for ${userName}`
                                    : 'Log a note or activity for this lead'}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                    {/* Activity type — segmented control */}
                    <div className="flex rounded-lg bg-neutral-100 p-0.5">
                        {NOTE_ACTION_TYPES.map((type) => (
                            <button
                                key={type.value}
                                type="button"
                                onClick={() => setActionType(type.value)}
                                className={cn(
                                    'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium transition-all',
                                    actionType === type.value
                                        ? 'bg-white text-primary-700 shadow-sm'
                                        : 'text-neutral-500 hover:text-neutral-700'
                                )}
                            >
                                {type.icon}
                                {type.label}
                            </button>
                        ))}
                    </div>

                    {/* Schedule time — Follow Up tab only; required to create the
                        lead_followup row that powers the "Follow up at" column. */}
                    {isFollowUp && (
                        <div className="flex flex-col gap-1">
                            <label
                                htmlFor="lead-followup-schedule"
                                className="text-xs font-medium text-neutral-700"
                            >
                                Schedule time <span className="text-danger-500">*</span>
                            </label>
                            <input
                                id="lead-followup-schedule"
                                type="datetime-local"
                                value={scheduleTime}
                                onChange={(e) => setScheduleTime(e.target.value)}
                                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-300"
                            />
                            {!audienceResponseId && (
                                <p className="text-xs text-warning-600">
                                    No campaign response linked — follow-up cannot be scheduled from
                                    here.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Institute-configured response / mode / next-action dropdowns.
                        portal={false}: this is inside a Dialog, where a portalled
                        list can't be scrolled. */}
                    {isFollowUp && followUpFields.visible && (
                        <FollowUpFields
                            values={followUpFields.values}
                            onChange={followUpFields.setValues}
                            portal={false}
                        />
                    )}

                    {/* The student's response also belongs on a plain note — "spoke to
                        them, they want a callback" is the same answer whether or not a
                        follow-up is being booked. Not made mandatory here: the
                        institute's setting is about follow-ups, and blocking every
                        quick jotting on a dropdown would be its own problem. */}
                    {!isFollowUp && followUpFields.studentResponseVisible && (
                        <FollowUpFields
                            values={followUpFields.values}
                            onChange={followUpFields.setValues}
                            only={['studentResponse']}
                            required={false}
                            portal={false}
                        />
                    )}

                    {/* Writing surface — note body. For FOLLOW_UP it's a reminder, optional
                        unless the institute requires a note on every follow-up. */}
                    <div
                        className="overflow-hidden rounded-lg border border-neutral-200 bg-white text-sm text-neutral-800 transition-colors focus-within:border-primary-300 focus-within:ring-1 focus-within:ring-primary-300 [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                submit();
                            }
                        }}
                    >
                        <RichTextEditor
                            value={noteText}
                            onChange={setNoteText}
                            placeholder={
                                isFollowUp
                                    ? notesRequired
                                        ? 'Add a note for this follow-up (required)…'
                                        : 'Add a note for this follow-up (optional)…'
                                    : 'Type your note here…'
                            }
                            minHeight={isFollowUp ? 80 : 120}
                            minimalToolbar
                        />
                    </div>
                    {isFollowUp && followUpFields.missingRequired && (
                        <p className="text-xs text-danger-600">
                            Answer every field marked * before scheduling this follow-up.
                        </p>
                    )}
                    {isFollowUp && notesRequired && isNoteEmpty && (
                        <p className="text-xs text-danger-600">
                            Your institute requires a note on every follow-up.
                        </p>
                    )}

                    {actionType === 'CALL_LOG' && (
                        <CallRecordingInput
                            value={callActivity}
                            onChange={setCallActivity}
                            hideRecordingControls={hideCallRecordingControls}
                        />
                    )}
                </div>

                <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-neutral-100 px-6 py-4 sm:justify-between">
                    <span className="hidden items-center gap-1.5 text-xs text-neutral-400 sm:flex">
                        <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-xs font-medium text-neutral-500">
                            Ctrl + Enter
                        </kbd>
                        to save
                    </span>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={handleClose} disabled={isPending}>
                            Cancel
                        </Button>
                        <Button
                            onClick={submit}
                            disabled={isPending || !canSubmit}
                            className="disabled:bg-neutral-200 disabled:text-neutral-500 disabled:opacity-100"
                        >
                            {isPending ? 'Saving…' : isFollowUp ? 'Schedule Follow-up' : 'Add note'}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
