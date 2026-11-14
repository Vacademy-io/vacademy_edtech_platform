import { useMemo, useState } from 'react';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowClockwise, ChatsCircle, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
    DISCUSSION_THREAD_KEY,
    createDiscussionPost,
    discussionErrorMessage,
    editDiscussionPost,
    moderateDiscussionPost,
} from './discussion-api';
import { DiscussionPostCard } from './discussion-post-card';
import {
    POST_CONTENT_MAX,
    type DiscussionModerationAction,
    type DiscussionPostView,
    type DiscussionThreadView,
} from './discussion-types';

/** Select value standing for "no batch filter" / "post to every batch". */
export const ALL_BATCHES = '__all__';

type Filter = 'ALL' | 'PENDING' | 'REPORTED' | 'HIDDEN';

const MODERATION_TOAST: Record<DiscussionModerationAction, string> = {
    APPROVE: 'Approved — classmates can see it now',
    HIDE: 'Hidden from learners',
    UNHIDE: 'Visible again',
    PIN: 'Pinned to the top',
    UNPIN: 'Unpinned',
    DELETE: 'Deleted',
    CLEAR_REPORTS: 'Reports cleared',
};

function matchesFilter(post: DiscussionPostView, filter: Filter): boolean {
    switch (filter) {
        case 'PENDING':
            return post.status === 'PENDING';
        case 'REPORTED':
            return (post.report_count ?? 0) > 0;
        case 'HIDDEN':
            return post.status === 'HIDDEN';
        default:
            return true;
    }
}

export function DiscussionResponsesPanel({
    slideId,
    threadQuery,
    batchFilter,
    onBatchFilterChange,
}: {
    slideId: string;
    threadQuery: UseQueryResult<DiscussionThreadView>;
    batchFilter: string;
    onBatchFilterChange: (value: string) => void;
}) {
    const queryClient = useQueryClient();
    const [filter, setFilter] = useState<Filter>('ALL');
    const [composerText, setComposerText] = useState('');
    const [composerBatch, setComposerBatch] = useState<string>(ALL_BATCHES);

    const thread = threadQuery.data;
    const batches = useMemo(() => thread?.batches ?? [], [thread?.batches]);
    const batchNames = useMemo(
        () => new Map(batches.map((b) => [b.package_session_id, b.name])),
        [batches]
    );

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: [DISCUSSION_THREAD_KEY, slideId] });

    const moderateMutation = useMutation({
        mutationFn: ({ postId, action }: { postId: string; action: DiscussionModerationAction }) =>
            moderateDiscussionPost(postId, action),
        onSuccess: (_data, { action }) => {
            toast.success(MODERATION_TOAST[action]);
            invalidate();
        },
        onError: (error) => toast.error(discussionErrorMessage(error, 'Could not update the post')),
    });

    const createMutation = useMutation({
        mutationFn: createDiscussionPost,
        onSuccess: () => invalidate(),
    });

    const editMutation = useMutation({
        mutationFn: ({ postId, content }: { postId: string; content: string }) =>
            editDiscussionPost(postId, content),
        onSuccess: () => invalidate(),
    });

    const busy = moderateMutation.isPending;

    const handleReply = async (response: DiscussionPostView, content: string) => {
        try {
            await createMutation.mutateAsync({
                slide_id: slideId,
                package_session_id: response.package_session_id ?? null,
                parent_id: response.id,
                content,
            });
            toast.success('Reply posted');
            return true;
        } catch (error) {
            toast.error(discussionErrorMessage(error, 'Could not post your reply'));
            return false;
        }
    };

    const handleEdit = async (postId: string, content: string) => {
        try {
            await editMutation.mutateAsync({ postId, content });
            toast.success('Post updated');
            return true;
        } catch (error) {
            toast.error(discussionErrorMessage(error, 'Could not save your edit'));
            return false;
        }
    };

    const handleCompose = async () => {
        const content = composerText.trim();
        if (!content) return;
        try {
            await createMutation.mutateAsync({
                slide_id: slideId,
                package_session_id: composerBatch === ALL_BATCHES ? null : composerBatch,
                content,
            });
            setComposerText('');
            toast.success('Posted to the discussion');
        } catch (error) {
            toast.error(discussionErrorMessage(error, 'Could not post'));
        }
    };

    const visiblePosts = useMemo(() => {
        const posts = thread?.posts ?? [];
        if (filter === 'ALL') return posts;
        // Keep a response when it, or any comment under it, matches.
        return posts.filter(
            (p) =>
                matchesFilter(p, filter) || (p.comments ?? []).some((c) => matchesFilter(c, filter))
        );
    }, [thread?.posts, filter]);

    const stats = thread?.stats;
    const chips: Array<{ value: Filter; label: string; count?: number }> = [
        { value: 'ALL', label: 'All' },
        { value: 'PENDING', label: 'Awaiting approval', count: stats?.pending ?? 0 },
        { value: 'REPORTED', label: 'Reported', count: stats?.flagged ?? 0 },
        { value: 'HIDDEN', label: 'Hidden', count: stats?.hidden ?? 0 },
    ];

    return (
        <div className="flex flex-col gap-4">
            {/* Teacher post composer */}
            <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                <h3 className="text-subtitle font-semibold text-neutral-700">Post as teacher</h3>
                <Textarea
                    value={composerText}
                    maxLength={POST_CONTENT_MAX}
                    rows={3}
                    placeholder="Share an example, a follow-up thought or a word of encouragement…"
                    aria-label="Teacher post"
                    onChange={(e) => setComposerText(e.target.value)}
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-caption text-neutral-500">Post to</span>
                        <Select value={composerBatch} onValueChange={setComposerBatch}>
                            <SelectTrigger className="h-9 w-56" aria-label="Post to batch">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_BATCHES}>All batches</SelectItem>
                                {batches.map((b) => (
                                    <SelectItem
                                        key={b.package_session_id}
                                        value={b.package_session_id}
                                    >
                                        {b.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={createMutation.isPending || !composerText.trim()}
                        onClick={handleCompose}
                    >
                        Post
                    </MyButton>
                </div>
            </section>

            {/* Filters */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter responses">
                    {chips.map((chip) => (
                        <button
                            key={chip.value}
                            type="button"
                            role="tab"
                            aria-selected={filter === chip.value}
                            onClick={() => setFilter(chip.value)}
                            className={cn(
                                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption transition-colors',
                                filter === chip.value
                                    ? 'border-primary-300 bg-primary-50 text-primary-600'
                                    : 'border-border text-neutral-600 hover:border-primary-200'
                            )}
                        >
                            {chip.label}
                            {chip.count !== undefined && chip.count > 0 && (
                                <span
                                    className={cn(
                                        'rounded-full px-1.5 text-caption',
                                        chip.value === 'REPORTED'
                                            ? 'bg-danger-100 text-danger-600'
                                            : 'bg-neutral-100 text-neutral-600'
                                    )}
                                >
                                    {chip.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <Select value={batchFilter} onValueChange={onBatchFilterChange}>
                    <SelectTrigger className="h-9 w-full sm:w-56" aria-label="Filter by batch">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL_BATCHES}>All batches</SelectItem>
                        {batches.map((b) => (
                            <SelectItem key={b.package_session_id} value={b.package_session_id}>
                                {b.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {stats && (
                <p className="text-caption text-neutral-500">
                    {stats.responses} {stats.responses === 1 ? 'response' : 'responses'} ·{' '}
                    {stats.participants} {stats.participants === 1 ? 'participant' : 'participants'}
                </p>
            )}

            {threadQuery.isLoading ? (
                <div className="flex flex-col gap-3">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-28 w-full rounded-lg" />
                    ))}
                </div>
            ) : threadQuery.isError ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-6 text-center">
                    <WarningCircle className="size-8 text-danger-500" />
                    <p className="text-body text-danger-600">
                        {discussionErrorMessage(threadQuery.error, 'Could not load responses.')}
                    </p>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => threadQuery.refetch()}
                    >
                        <ArrowClockwise className="size-4" /> Try again
                    </MyButton>
                </div>
            ) : visiblePosts.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
                    <ChatsCircle className="size-10 text-neutral-300" />
                    <p className="text-subtitle font-semibold text-neutral-600">
                        {filter === 'ALL' ? 'No responses yet' : 'Nothing here'}
                    </p>
                    <p className="max-w-md text-caption text-neutral-500">
                        {filter === 'ALL'
                            ? 'When learners share their thoughts, they’ll appear here. You can start things off with a post of your own.'
                            : 'No posts match this filter right now.'}
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {visiblePosts.map((post) => (
                        <DiscussionPostCard
                            key={post.id}
                            post={post}
                            isResponse
                            batchLabel={
                                batchFilter !== ALL_BATCHES
                                    ? undefined
                                    : post.package_session_id
                                      ? batchNames.get(post.package_session_id)
                                      : post.author_role === 'STAFF'
                                        ? 'All batches'
                                        : undefined
                            }
                            busy={busy}
                            onModerate={(postId, action) =>
                                moderateMutation.mutate({ postId, action })
                            }
                            onReply={handleReply}
                            onEdit={handleEdit}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
