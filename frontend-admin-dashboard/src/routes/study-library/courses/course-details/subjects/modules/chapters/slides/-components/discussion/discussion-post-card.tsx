import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
    ArrowBendUpLeft,
    CheckCircle,
    Eye,
    EyeSlash,
    Flag,
    PencilSimple,
    PushPin,
    PushPinSlash,
    Trash,
    Broom,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { Textarea } from '@/components/ui/textarea';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
    DISCUSSION_REACTIONS,
    POST_CONTENT_MAX,
    type DiscussionModerationAction,
    type DiscussionPostView,
} from './discussion-types';

const REACTION_EMOJI = new Map(DISCUSSION_REACTIONS.map((r) => [r.key as string, r]));

function relativeTime(value: string | number | undefined): string {
    if (value === undefined || value === null) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return formatDistanceToNow(date, { addSuffix: true });
}

function absoluteTime(value: string | number | undefined): string | undefined {
    if (value === undefined || value === null) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString();
}

function Tag({
    children,
    tone = 'neutral',
}: {
    children: React.ReactNode;
    tone?: 'neutral' | 'primary' | 'info';
}) {
    return (
        <span
            className={cn(
                'rounded-full px-2 py-0.5 text-caption',
                tone === 'primary' && 'bg-primary-50 text-primary-600',
                tone === 'info' && 'bg-info-50 text-info-700',
                tone === 'neutral' && 'bg-neutral-100 text-neutral-600'
            )}
        >
            {children}
        </span>
    );
}

export interface DiscussionPostCardProps {
    post: DiscussionPostView;
    isResponse: boolean;
    /** Batch name for the post's package_session_id; undefined hides the batch tag. */
    batchLabel?: string;
    busy: boolean;
    onModerate: (postId: string, action: DiscussionModerationAction) => void;
    onReply?: (response: DiscussionPostView, content: string) => Promise<boolean>;
    onEdit: (postId: string, content: string) => Promise<boolean>;
}

export function DiscussionPostCard({
    post,
    isResponse,
    batchLabel,
    busy,
    onModerate,
    onReply,
    onEdit,
}: DiscussionPostCardProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState(post.content);
    const [isReplying, setIsReplying] = useState(false);
    const [replyText, setReplyText] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const isStaff = post.author_role === 'STAFF';
    const reportCount = post.report_count ?? 0;
    const reactions = (post.reactions ?? []).filter((r) => r.count > 0);
    const comments = post.comments ?? [];
    const disabled = busy || submitting;

    const submitEdit = async () => {
        const text = editText.trim();
        if (!text) return;
        setSubmitting(true);
        const ok = await onEdit(post.id, text);
        setSubmitting(false);
        if (ok) setIsEditing(false);
    };

    const submitReply = async () => {
        const text = replyText.trim();
        if (!text || !onReply) return;
        setSubmitting(true);
        const ok = await onReply(post, text);
        setSubmitting(false);
        if (ok) {
            setReplyText('');
            setIsReplying(false);
        }
    };

    return (
        <article
            className={cn(
                'flex flex-col gap-2',
                isResponse
                    ? cn(
                          'rounded-lg border bg-card p-4',
                          post.pinned ? 'border-primary-200' : 'border-border',
                          post.status === 'HIDDEN' && 'opacity-80'
                      )
                    : 'border-l-2 border-neutral-200 pl-3'
            )}
        >
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-body font-semibold text-neutral-700">{post.author_name}</span>
                {isStaff && <Tag tone="primary">Teacher</Tag>}
                {post.anonymous && <Tag tone="info">Anonymous to classmates</Tag>}
                {batchLabel && <Tag>{batchLabel}</Tag>}
                <span
                    className="text-caption text-neutral-500"
                    title={absoluteTime(post.created_at)}
                >
                    {relativeTime(post.created_at)}
                </span>
                {post.edited_at && (
                    <span
                        className="text-caption text-neutral-400"
                        title={absoluteTime(post.edited_at)}
                    >
                        · edited
                    </span>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    {post.pinned && (
                        <span className="flex items-center gap-1 text-caption text-primary-500">
                            <PushPin className="size-4" weight="fill" /> Pinned
                        </span>
                    )}
                    {post.status === 'PENDING' && (
                        <StatusChip
                            text="Awaiting approval"
                            status="WARNING"
                            textSize="text-caption"
                            showIcon={false}
                        />
                    )}
                    {post.status === 'HIDDEN' && (
                        <StatusChip
                            text="Hidden"
                            status="INFO"
                            textSize="text-caption"
                            showIcon={false}
                        />
                    )}
                </div>
            </header>

            {reportCount > 0 && (
                <div className="flex flex-col gap-1 rounded-md bg-danger-50 p-2 text-caption text-danger-600">
                    <span className="flex items-center gap-1 font-semibold">
                        <Flag className="size-4" weight="fill" />
                        Reported {reportCount === 1 ? 'once' : `${reportCount} times`}
                    </span>
                    {(post.report_reasons ?? []).filter(Boolean).length > 0 && (
                        <ul className="list-disc pl-5">
                            {(post.report_reasons ?? []).filter(Boolean).map((reason, i) => (
                                <li key={i} className="whitespace-pre-wrap">
                                    {reason}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {isEditing ? (
                <div className="flex flex-col gap-2">
                    <Textarea
                        value={editText}
                        maxLength={POST_CONTENT_MAX}
                        rows={3}
                        onChange={(e) => setEditText(e.target.value)}
                        aria-label="Edit your post"
                    />
                    <div className="flex justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => {
                                setEditText(post.content);
                                setIsEditing(false);
                            }}
                        >
                            Cancel
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            disable={disabled || !editText.trim()}
                            onClick={submitEdit}
                        >
                            Save
                        </MyButton>
                    </div>
                </div>
            ) : (
                <p className="whitespace-pre-wrap break-words text-body text-neutral-700">
                    {post.content}
                </p>
            )}

            {reactions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {reactions.map((r) => {
                        const meta = REACTION_EMOJI.get(r.reaction);
                        return (
                            <span
                                key={r.reaction}
                                title={meta?.label ?? r.reaction}
                                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-caption text-neutral-600"
                            >
                                <span aria-hidden>{meta?.emoji ?? '•'}</span>
                                <span className="sr-only">{meta?.label ?? r.reaction}</span>
                                {r.count}
                            </span>
                        );
                    })}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {post.status === 'PENDING' && (
                    <ActionButton
                        icon={<CheckCircle className="size-4" />}
                        label="Approve"
                        disabled={disabled}
                        onClick={() => onModerate(post.id, 'APPROVE')}
                    />
                )}
                {post.status === 'HIDDEN' ? (
                    <ActionButton
                        icon={<Eye className="size-4" />}
                        label="Unhide"
                        disabled={disabled}
                        onClick={() => onModerate(post.id, 'UNHIDE')}
                    />
                ) : (
                    <ActionButton
                        icon={<EyeSlash className="size-4" />}
                        label="Hide"
                        disabled={disabled}
                        onClick={() => onModerate(post.id, 'HIDE')}
                    />
                )}
                {isResponse && (
                    <ActionButton
                        icon={
                            post.pinned ? (
                                <PushPinSlash className="size-4" />
                            ) : (
                                <PushPin className="size-4" />
                            )
                        }
                        label={post.pinned ? 'Unpin' : 'Pin'}
                        disabled={disabled}
                        onClick={() => onModerate(post.id, post.pinned ? 'UNPIN' : 'PIN')}
                    />
                )}
                {reportCount > 0 && (
                    <ActionButton
                        icon={<Broom className="size-4" />}
                        label="Clear reports"
                        disabled={disabled}
                        onClick={() => onModerate(post.id, 'CLEAR_REPORTS')}
                    />
                )}
                {isResponse && onReply && (
                    <ActionButton
                        icon={<ArrowBendUpLeft className="size-4" />}
                        label="Reply"
                        disabled={disabled}
                        onClick={() => setIsReplying((v) => !v)}
                    />
                )}
                {isStaff && post.mine && !isEditing && (
                    <ActionButton
                        icon={<PencilSimple className="size-4" />}
                        label="Edit"
                        disabled={disabled}
                        onClick={() => {
                            setEditText(post.content);
                            setIsEditing(true);
                        }}
                    />
                )}
                <ActionButton
                    icon={<Trash className="size-4" />}
                    label="Delete"
                    tone="danger"
                    disabled={disabled}
                    onClick={() => setConfirmDelete(true)}
                />
            </div>

            {comments.length > 0 && (
                <div className="mt-1 flex flex-col gap-3">
                    {comments.map((c) => (
                        <DiscussionPostCard
                            key={c.id}
                            post={c}
                            isResponse={false}
                            busy={busy}
                            onModerate={onModerate}
                            onEdit={onEdit}
                        />
                    ))}
                </div>
            )}

            {isReplying && (
                <div className="mt-1 flex flex-col gap-2 border-l-2 border-primary-200 pl-3">
                    <Textarea
                        value={replyText}
                        maxLength={POST_CONTENT_MAX}
                        rows={2}
                        autoFocus
                        placeholder={`Reply to ${post.author_name}…`}
                        aria-label="Your reply"
                        onChange={(e) => setReplyText(e.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => {
                                setReplyText('');
                                setIsReplying(false);
                            }}
                        >
                            Cancel
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            disable={disabled || !replyText.trim()}
                            onClick={submitReply}
                        >
                            Reply
                        </MyButton>
                    </div>
                </div>
            )}

            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete this {isResponse ? 'response' : 'comment'}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {isResponse && comments.length > 0
                                ? 'The response and its comments will be removed for everyone. This can’t be undone.'
                                : 'It will be removed for everyone. This can’t be undone.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 text-white hover:bg-danger-500"
                            onClick={() => onModerate(post.id, 'DELETE')}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </article>
    );
}

function ActionButton({
    icon,
    label,
    onClick,
    disabled,
    tone = 'default',
}: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    tone?: 'default' | 'danger';
}) {
    return (
        <MyButton
            type="button"
            buttonType="text"
            scale="small"
            layoutVariant="default"
            disable={disabled}
            onClick={onClick}
            className={cn(
                'h-7 gap-1 px-1 sm:min-w-0',
                tone === 'danger' ? '!text-danger-600' : '!text-neutral-600 hover:!text-primary-500'
            )}
        >
            {icon}
            {label}
        </MyButton>
    );
}
