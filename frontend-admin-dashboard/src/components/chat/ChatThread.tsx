import { useEffect, useRef, useState } from 'react';
import { Flag, ChatCircleDots, ArrowClockwise, Trash, PencilSimple } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { MyButton } from '@/components/design-system/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type {
    ChatConversationResponse,
    ChatMessageResponse,
} from '@/services/chat/chatApi';
import { formatClockTime, toUtcDate } from './chatTime';
import { MessageText } from './MessageText';

export interface ThreadMessage extends ChatMessageResponse {
    /** Local-only dedup key threaded through the optimistic send for reconciliation/retry. */
    clientDedupKey?: string;
    /** Local-only flag for optimistic messages awaiting server reconciliation. */
    pending?: boolean;
    /** Local-only flag for messages whose send failed. */
    failed?: boolean;
}

/** Roles allowed to delete any message in a conversation (not just their own). */
const MODERATOR_ROLES = new Set(['MODERATOR', 'OWNER', 'ADMIN']);

interface ChatThreadProps {
    conversation: ChatConversationResponse;
    messages: ThreadMessage[];
    currentUserId: string;
    isLoading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    /** Omit to hide the report affordance (e.g. surfaces with no review queue). */
    onReport?: (message: ChatMessageResponse) => void;
    onRetry: (message: ThreadMessage) => void;
    onDelete: (message: ThreadMessage) => void;
    /** Omit to hide the edit affordance. Resolves once the server has accepted the new text. */
    onEdit?: (message: ThreadMessage, text: string) => Promise<void>;
}

const dayLabel = (iso: string): string => {
    const d = toUtcDate(iso);
    if (!d) return '';
    const now = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};

const dayKey = (iso: string): string => {
    const d = toUtcDate(iso);
    return d ? d.toDateString() : '';
};

const timeLabel = (iso: string): string => {
    const d = toUtcDate(iso);
    return d ? formatClockTime(d) : '';
};

export function ChatThread({
    conversation,
    messages,
    currentUserId,
    isLoading,
    hasMore,
    onLoadMore,
    onReport,
    onRetry,
    onDelete,
    onEdit,
}: ChatThreadProps) {
    const bottomRef = useRef<HTMLDivElement>(null);
    const [deleteTarget, setDeleteTarget] = useState<ThreadMessage | null>(null);
    const [editTarget, setEditTarget] = useState<ThreadMessage | null>(null);
    const [editText, setEditText] = useState('');
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const showSenderNames = conversation.type !== 'DIRECT';
    // Mirrors the server's rule exactly, so the control is never shown for an action that would 403.
    // Two independent grants: the per-conversation member role, and the institute ADMIN role from the
    // token. The latter is needed because an admin who is only OBSERVING a batch (surfaced by role,
    // never joined) has no member row at all — but it does NOT extend to a DM, which stays private to
    // its two participants with only the sender able to delete.
    const canModerate =
        MODERATOR_ROLES.has((conversation.memberRole ?? '').toUpperCase()) ||
        (conversation.type !== 'DIRECT' && isAdminForInstitute(conversation.instituteId));

    // Auto-scroll to the newest message when the count grows.
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length]);

    let lastDay = '';

    return (
        <div className="flex-1 overflow-y-auto bg-neutral-50 px-4 py-4">
            {hasMore && (
                <div className="mb-3 flex justify-center">
                    <button
                        type="button"
                        onClick={onLoadMore}
                        className="rounded-full border border-neutral-200 bg-white px-4 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                    >
                        Load earlier messages
                    </button>
                </div>
            )}

            {isLoading && messages.length === 0 && (
                <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div
                            key={i}
                            className={cn(
                                'h-12 w-2/3 animate-pulse rounded-2xl bg-neutral-200',
                                i % 2 === 0 ? '' : 'ml-auto'
                            )}
                        />
                    ))}
                </div>
            )}

            {!isLoading && messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center text-center">
                    <ChatCircleDots size={40} weight="duotone" className="mb-3 text-neutral-300" />
                    <p className="text-sm text-neutral-500">
                        No messages yet. Say hello to start the conversation.
                    </p>
                </div>
            )}

            <div
                className="flex flex-col gap-1"
                role="log"
                aria-live="polite"
                aria-label="Messages"
            >
                {messages.map((m) => {
                    const isOwn = m.senderId === currentUserId;
                    // Only persisted (non-temp), non-deleted, settled messages can be deleted.
                    const isLocalOnly = m.id.startsWith('temp-') || m.pending || m.failed;
                    // Deleting your OWN message can be switched off per institute (students only);
                    // moderation is a separate grant and is never gated by it. `!== false` so an older
                    // backend that doesn't send the flag keeps today's behaviour.
                    const canDeleteOwn = conversation.canDeleteOwnMessages !== false;
                    const canDelete =
                        !m.isDeleted && !isLocalOnly && ((isOwn && canDeleteOwn) || canModerate);
                    // Reporting targets a persisted message id, so an optimistic bubble can't be one.
                    const canReport = !!onReport && !isOwn && !isLocalOnly && !m.isDeleted;
                    // Only a message of your own that still has (or can hold) a body is editable —
                    // an edit rewrites text, so a tombstone or an unsent bubble has nothing to edit.
                    const canEdit =
                        !!onEdit &&
                        isOwn &&
                        !m.isDeleted &&
                        !isLocalOnly &&
                        conversation.canEditOwnMessages !== false;
                    const hasActions = canReport || canDelete || canEdit;
                    const key = dayKey(m.createdAt);
                    const showDay = key !== lastDay;
                    lastDay = key;

                    return (
                        <div key={m.id}>
                            {showDay && (
                                <div className="my-3 flex justify-center">
                                    <span className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-caption font-medium text-neutral-600">
                                        {dayLabel(m.createdAt)}
                                    </span>
                                </div>
                            )}

                            <div className={cn('flex', isOwn ? 'justify-end' : 'justify-start')}>
                                <div
                                    className={cn(
                                        'group relative rounded-2xl px-3 py-2 shadow-sm',
                                        // Below md the action rail is always visible (no hover on
                                        // touch), so a bubble THAT HAS ONE has to leave room or the
                                        // rail overflows the scrollport. Bubbles with no actions keep
                                        // the full width.
                                        hasActions
                                            ? 'max-w-[calc(100%-4.5rem)] md:max-w-[78%]' // design-lint-ignore: percentage bubble width has no spacing token
                                            : 'max-w-[78%]', // design-lint-ignore: percentage bubble width has no spacing token
                                        isOwn
                                            ? 'rounded-br-sm bg-primary-500 text-white'
                                            : 'rounded-bl-sm border border-neutral-200 bg-white text-neutral-700'
                                    )}
                                >
                                    {showSenderNames && !isOwn && (
                                        <div className="mb-0.5 text-xs font-semibold text-primary-600">
                                            {m.senderName || 'Member'}
                                        </div>
                                    )}

                                    {m.isDeleted ? (
                                        <div className="whitespace-pre-wrap break-words text-sm italic leading-relaxed opacity-60">
                                            This message was deleted
                                        </div>
                                    ) : (
                                        <>
                                            {m.attachmentUrl && (
                                                <a
                                                    href={m.attachmentUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="mb-1 block"
                                                >
                                                    <img
                                                        src={m.attachmentUrl}
                                                        alt={m.attachmentName || 'attachment'}
                                                        className="max-h-60 w-full max-w-xs rounded-md object-cover"
                                                    />
                                                </a>
                                            )}

                                            {m.content && (
                                                <MessageText
                                                    text={m.content}
                                                    isOwn={isOwn}
                                                    className="text-sm leading-relaxed"
                                                />
                                            )}
                                        </>
                                    )}

                                    <div
                                        className={cn(
                                            'mt-0.5 flex items-center justify-end gap-1 text-caption',
                                            isOwn ? 'text-white/70' : 'text-neutral-400'
                                        )}
                                    >
                                        {m.isFlagged && <Flag size={11} weight="fill" />}
                                        {m.isEdited && !m.isDeleted && <span>edited</span>}
                                        {m.failed ? (
                                            <button
                                                type="button"
                                                onClick={() => onRetry(m)}
                                                className="flex items-center gap-1 font-medium text-danger-200 underline hover:text-danger-100"
                                                aria-label="Message failed to send. Tap to retry."
                                            >
                                                <ArrowClockwise size={11} weight="bold" />
                                                Failed — retry
                                            </button>
                                        ) : m.pending ? (
                                            <span aria-label="Sending message">Sending...</span>
                                        ) : (
                                            <span>{timeLabel(m.createdAt)}</span>
                                        )}
                                    </div>

                                    {(canReport || canDelete) && (
                                        <div
                                            className={cn(
                                                // Anchored FLUSH to the bubble (right-full / left-full).
                                                // An offset rail leaves a dead gap between bubble and
                                                // button: the pointer stops hovering the group halfway
                                                // across it, the control disappears, and it can never be
                                                // clicked. Zero gap keeps the hover unbroken.
                                                'absolute top-1/2 flex -translate-y-1/2 items-center gap-1',
                                                'pointer-events-none opacity-0 transition-opacity',
                                                'group-hover:pointer-events-auto group-hover:opacity-100',
                                                'focus-within:pointer-events-auto focus-within:opacity-100',
                                                // Touch devices never fire hover — keep the rail live.
                                                'max-md:pointer-events-auto max-md:opacity-100',
                                                // Own bubbles are right-aligned and sit against the
                                                // scroll container's edge, so their rail MUST go left —
                                                // to the right it renders outside the scrollport.
                                                isOwn ? 'right-full pr-1.5' : 'left-full pl-1.5'
                                            )}
                                        >
                                            {canEdit && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditTarget(m);
                                                        setEditText(m.content ?? '');
                                                    }}
                                                    className="flex size-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-400 shadow-sm hover:border-primary-200 hover:text-primary-500"
                                                    aria-label="Edit message"
                                                    title="Edit message"
                                                >
                                                    <PencilSimple size={14} />
                                                </button>
                                            )}

                                            {canReport && (
                                                <button
                                                    type="button"
                                                    onClick={() => onReport?.(m)}
                                                    className="flex size-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-400 shadow-sm hover:border-danger-200 hover:text-danger-500"
                                                    aria-label="Report message"
                                                    title="Report message"
                                                >
                                                    <Flag size={14} />
                                                </button>
                                            )}

                                            {canDelete && (
                                                <button
                                                    type="button"
                                                    onClick={() => setDeleteTarget(m)}
                                                    className="flex size-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-400 shadow-sm hover:border-danger-200 hover:text-danger-500"
                                                    aria-label="Delete message"
                                                    title={
                                                        isOwn
                                                            ? 'Delete message'
                                                            : 'Delete this message for everyone'
                                                    }
                                                >
                                                    <Trash size={14} />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            <Dialog
                open={editTarget !== null}
                onOpenChange={(open) => {
                    if (!open && !isSavingEdit) setEditTarget(null);
                }}
            >
                <DialogContent className="w-full max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-base font-semibold text-neutral-700">
                            Edit message
                        </DialogTitle>
                    </DialogHeader>
                    <Textarea
                        aria-label="Message text"
                        rows={4}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        maxLength={8000}
                        placeholder="Message"
                    />
                    <p className="text-xs text-neutral-400">
                        Everyone in the conversation sees the change, marked as edited.
                    </p>
                    <DialogFooter>
                        <MyButton
                            buttonType="secondary"
                            disabled={isSavingEdit}
                            onClick={() => setEditTarget(null)}
                        >
                            Cancel
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            disabled={
                                isSavingEdit ||
                                !editText.trim() ||
                                editText.trim() === (editTarget?.content ?? '').trim()
                            }
                            onClick={() => {
                                const target = editTarget;
                                if (!target || !onEdit) return;
                                setIsSavingEdit(true);
                                void onEdit(target, editText.trim())
                                    .then(() => setEditTarget(null))
                                    .finally(() => setIsSavingEdit(false));
                            }}
                        >
                            {isSavingEdit ? 'Saving...' : 'Save'}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={deleteTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null);
                }}
            >
                <DialogContent className="w-full max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-base font-semibold text-neutral-700">
                            Delete message
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-neutral-600">
                        {deleteTarget && deleteTarget.senderId !== currentUserId
                            ? `This removes ${deleteTarget.senderName || 'this member'}'s message for everyone in the conversation. It can't be undone.`
                            : "This removes the message for everyone in the conversation. It can't be undone."}
                    </p>
                    <DialogFooter>
                        <MyButton buttonType="secondary" onClick={() => setDeleteTarget(null)}>
                            Cancel
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={() => {
                                const target = deleteTarget;
                                setDeleteTarget(null);
                                if (target) onDelete(target);
                            }}
                        >
                            Delete
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
