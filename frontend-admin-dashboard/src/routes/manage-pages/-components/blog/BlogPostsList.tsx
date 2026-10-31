import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MagnifyingGlass, PencilSimple, Trash, DotsThreeVertical, ArrowSquareOut, Robot } from '@phosphor-icons/react';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCataloguePermissions } from '../../-hooks/use-catalogue-permissions';
import {
    archiveBlogPost,
    deleteBlogPost,
    listBlogPosts,
    publishBlogPost,
    unpublishBlogPost,
    type BlogPost,
    type BlogPostStatus,
} from '../../-services/blog-service';

/**
 * Website Builder → Blog: every post of the institute, any status.
 *
 * Posts are rows, not page JSON, so this list is where an article's lifecycle
 * lives — draft, publish, unpublish, archive, delete — independently of any
 * site's draft/publish cycle. A post an AI app wrote over MCP arrives here as a
 * DRAFT (marked with its source) and goes live only when someone presses
 * Publish in this list or in the editor.
 */

const STATUS_FILTERS: Array<{ key: BlogPostStatus | 'ALL'; label: string }> = [
    { key: 'ALL', label: 'All' },
    { key: 'PUBLISHED', label: 'Published' },
    { key: 'DRAFT', label: 'Drafts' },
    { key: 'ARCHIVED', label: 'Archived' },
];

const statusChip = (status: BlogPostStatus) => {
    if (status === 'PUBLISHED') return <StatusChip text="Published" textSize="text-xs" status="SUCCESS" />;
    if (status === 'ARCHIVED') return <StatusChip text="Archived" textSize="text-xs" status="INFO" showIcon={false} />;
    return <StatusChip text="Draft" textSize="text-xs" status="WARNING" showIcon={false} />;
};

const formatDate = (iso?: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const RowSkeleton = () => (
    <div className="animate-pulse grid grid-cols-[1fr_auto] items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4">
        <div className="space-y-2">
            <div className="h-4 w-1/2 rounded bg-neutral-100" />
            <div className="h-3 w-1/3 rounded bg-neutral-100" />
        </div>
        <div className="h-8 w-24 rounded bg-neutral-100" />
    </div>
);

interface BlogPostsListProps {
    /** 'new' opens a blank editor; any other id edits that post. */
    onOpenPost: (postId: string) => void;
}

export const BlogPostsList = ({ onOpenPost }: BlogPostsListProps) => {
    const instituteId = getCurrentInstituteId();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { canWrite, canDelete, canPublish } = useCataloguePermissions();
    const [status, setStatus] = useState<BlogPostStatus | 'ALL'>('ALL');
    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [page, setPage] = useState(0);
    const [deleteTarget, setDeleteTarget] = useState<BlogPost | null>(null);

    useEffect(() => {
        const handle = setTimeout(() => setDebouncedQ(q.trim()), 300);
        return () => clearTimeout(handle);
    }, [q]);

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['catalogue-blog-posts', instituteId, status, debouncedQ, page],
        queryFn: () => listBlogPosts(instituteId!, { status, q: debouncedQ, page, size: 20 }),
        enabled: !!instituteId,
        placeholderData: (prev) => prev,
    });

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['catalogue-blog-posts', instituteId] });

    const statusMutation = useMutation({
        mutationFn: ({ id, action }: { id: string; action: 'publish' | 'unpublish' | 'archive' }) =>
            action === 'publish'
                ? publishBlogPost(instituteId!, id)
                : action === 'unpublish'
                  ? unpublishBlogPost(instituteId!, id)
                  : archiveBlogPost(instituteId!, id),
        onSuccess: (_post, { action }) => {
            toast({
                title: action === 'publish' ? 'Published' : action === 'unpublish' ? 'Moved to drafts' : 'Archived',
                description:
                    action === 'publish' ? 'The post is live on every site with a Blog section.' : undefined,
            });
            invalidate();
        },
        onError: () => toast({ title: 'Error', description: 'The post could not be updated', variant: 'destructive' }),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteBlogPost(instituteId!, id),
        onSuccess: () => {
            toast({ title: 'Deleted', description: 'The post was deleted' });
            invalidate();
        },
        onError: () => toast({ title: 'Error', description: 'The post could not be deleted', variant: 'destructive' }),
    });

    if (!instituteId) return <div className="p-6 text-neutral-500">No institute selected</div>;

    const posts = data?.content ?? [];
    const totalPages = data?.total_pages ?? 0;

    return (
        <div className="animate-fadeIn flex flex-col gap-6 p-6 lg:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-800">Blog</h1>
                    <p className="mt-0.5 text-sm text-neutral-500">
                        Articles shown by the Blog section of your websites. Publishing a post never
                        republishes the site.
                    </p>
                </div>
                {canWrite && (
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={() => onOpenPost('new')}
                    >
                        <Plus className="size-4" /> New post
                    </MyButton>
                )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-1">
                    {STATUS_FILTERS.map((f) => (
                        <button
                            key={f.key}
                            type="button"
                            onClick={() => {
                                setStatus(f.key);
                                setPage(0);
                            }}
                            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                                status === f.key
                                    ? 'bg-primary-500 text-white'
                                    : 'text-neutral-600 hover:bg-neutral-100'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                <div className="relative w-full sm:w-72">
                    <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                    <Input
                        value={q}
                        onChange={(e) => {
                            setQ(e.target.value);
                            setPage(0);
                        }}
                        placeholder="Search title, slug or category"
                        className="pl-9"
                    />
                </div>
            </div>

            {isLoading ? (
                <div className="space-y-3">
                    <RowSkeleton />
                    <RowSkeleton />
                    <RowSkeleton />
                </div>
            ) : posts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center">
                    <p className="text-sm font-medium text-neutral-700">
                        {debouncedQ || status !== 'ALL' ? 'No posts match this filter' : 'No posts yet'}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                        Write your first article, then drop a Blog section on any website page to show it.
                    </p>
                    {canWrite && !debouncedQ && status === 'ALL' && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            className="mt-4"
                            onClick={() => onOpenPost('new')}
                        >
                            <Plus className="size-4" /> New post
                        </MyButton>
                    )}
                </div>
            ) : (
                <div className={`space-y-3 ${isFetching ? 'opacity-70' : ''}`}>
                    {posts.map((post) => (
                        <div
                            key={post.id}
                            className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4 transition hover:border-neutral-300"
                        >
                            <button
                                type="button"
                                className="min-w-0 text-left"
                                onClick={() =>
                                    onOpenPost(post.id)
                                }
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="truncate text-sm font-semibold text-neutral-800">{post.title}</span>
                                    {statusChip(post.status)}
                                    {post.source === 'MCP' && (
                                        <span
                                            className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-1.5 py-0.5 text-caption font-medium text-primary-500"
                                            title="Written by an AI app connected over MCP"
                                        >
                                            <Robot className="size-3" /> AI app
                                        </span>
                                    )}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-500">
                                    <span className="font-mono">/{post.slug}</span>
                                    {post.category && <span>{post.category}</span>}
                                    {post.author_name && <span>by {post.author_name}</span>}
                                    <span>
                                        {post.status === 'PUBLISHED'
                                            ? `Published ${formatDate(post.published_at)}`
                                            : `Edited ${formatDate(post.updated_at)}`}
                                    </span>
                                </div>
                            </button>
                            <div className="flex items-center gap-2">
                                {canPublish && post.status !== 'PUBLISHED' && (
                                    <MyButton
                                        buttonType="primary"
                                        scale="small"
                                        disable={statusMutation.isPending}
                                        onClick={() => statusMutation.mutate({ id: post.id, action: 'publish' })}
                                    >
                                        Publish
                                    </MyButton>
                                )}
                                {canPublish && post.status === 'PUBLISHED' && (
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        disable={statusMutation.isPending}
                                        onClick={() => statusMutation.mutate({ id: post.id, action: 'unpublish' })}
                                    >
                                        Unpublish
                                    </MyButton>
                                )}
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            type="button"
                                            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                                            aria-label="More actions"
                                        >
                                            <DotsThreeVertical className="size-5" weight="bold" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                            onClick={() =>
                                                onOpenPost(post.id)
                                            }
                                        >
                                            <PencilSimple className="mr-2 size-4" /> Edit
                                        </DropdownMenuItem>
                                        {canPublish && post.status !== 'ARCHIVED' && (
                                            <DropdownMenuItem
                                                onClick={() => statusMutation.mutate({ id: post.id, action: 'archive' })}
                                            >
                                                <ArrowSquareOut className="mr-2 size-4" /> Archive
                                            </DropdownMenuItem>
                                        )}
                                        {canDelete && (
                                            <DropdownMenuItem
                                                className="text-danger-600 focus:text-danger-600"
                                                onClick={() => setDeleteTarget(post)}
                                            >
                                                <Trash className="mr-2 size-4" /> Delete
                                            </DropdownMenuItem>
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 text-xs text-neutral-500">
                    <MyButton buttonType="secondary" scale="small" disable={page === 0} onClick={() => setPage((p) => p - 1)}>
                        Previous
                    </MyButton>
                    <span>
                        Page {page + 1} of {totalPages}
                    </span>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={page >= totalPages - 1}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Next
                    </MyButton>
                </div>
            )}

            <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this post?</AlertDialogTitle>
                        <AlertDialogDescription>
                            “{deleteTarget?.title}” will be removed permanently. Prefer Archive if you may want it back.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 hover:bg-danger-700"
                            onClick={() => {
                                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
                                setDeleteTarget(null);
                            }}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
