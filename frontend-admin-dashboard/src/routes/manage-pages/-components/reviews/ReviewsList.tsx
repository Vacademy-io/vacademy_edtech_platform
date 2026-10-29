import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowCounterClockwise,
    Check,
    DotsThreeVertical,
    MagnifyingGlass,
    PencilSimple,
    Star,
    Trash,
    X,
} from '@phosphor-icons/react';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
    deleteSiteReview,
    listSiteReviews,
    setSiteReviewStatus,
    updateSiteReview,
    type ReviewStatus,
    type SiteReview,
    type SiteReviewInput,
} from '../../-services/review-service';

/**
 * Website Builder → Reviews: what visitors sent through a Reviews & feedback
 * block. New ones wait under Pending; Approve makes a review public, so every
 * testimonials section set to show reviews picks it up on its next load.
 */

const TABS: Array<ReviewStatus | 'ALL'> = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'];

const formatDate = (iso?: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const Stars = ({ value, size = 14 }: { value: number; size?: number }) => (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} size={size} weight={n <= value ? 'fill' : 'regular'} className={n <= value ? 'text-warning-500' : 'text-neutral-300'} />
        ))}
    </span>
);

const RowSkeleton = () => (
    <div className="animate-pulse space-y-2 rounded-xl border border-neutral-200 bg-white px-5 py-4">
        <div className="h-3 w-24 rounded bg-neutral-100" />
        <div className="h-4 w-1/3 rounded bg-neutral-100" />
        <div className="h-3 w-2/3 rounded bg-neutral-100" />
    </div>
);

/* ── edit ─────────────────────────────────────────────────────────────── */

const EditReviewDialog = ({
    review,
    saving,
    onCancel,
    onSave,
}: {
    review: SiteReview;
    saving: boolean;
    onCancel: () => void;
    onSave: (input: SiteReviewInput) => void;
}) => {
    const { t } = useTranslation('managePagesReviews');
    const [rating, setRating] = useState(review.rating);
    const [name, setName] = useState(review.reviewer_name);
    const [text, setText] = useState(review.review_text || '');
    const [city, setCity] = useState(review.city || '');
    const [course, setCourse] = useState(review.course_name || '');
    const [designation, setDesignation] = useState(review.designation || '');

    return (
        <Dialog open onOpenChange={(o) => !o && onCancel()}>
            <DialogContent className="w-full max-w-lg" aria-describedby={undefined}>
                <DialogHeader>
                    <DialogTitle>{t('list.editTitle')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div>
                        <Label className="text-xs">{t('list.fields.rating')}</Label>
                        <div className="mt-1 flex gap-1" role="radiogroup" aria-label={t('list.fields.rating')}>
                            {[1, 2, 3, 4, 5].map((n) => (
                                <button
                                    key={n}
                                    type="button"
                                    role="radio"
                                    aria-checked={rating === n}
                                    aria-label={t('list.starsA11y', { count: n })}
                                    onClick={() => setRating(n)}
                                    className="rounded p-0.5 hover:bg-neutral-100"
                                >
                                    <Star size={22} weight={n <= rating ? 'fill' : 'regular'} className={n <= rating ? 'text-warning-500' : 'text-neutral-300'} />
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <Label className="text-xs">{t('list.fields.name')}</Label>
                        <Input className="mt-1" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div>
                        <Label className="text-xs">{t('list.fields.text')}</Label>
                        <Textarea className="mt-1" rows={4} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <Label className="text-xs">{t('list.fields.course')}</Label>
                            <Input className="mt-1" value={course} maxLength={255} onChange={(e) => setCourse(e.target.value)} />
                        </div>
                        <div>
                            <Label className="text-xs">{t('list.fields.city')}</Label>
                            <Input className="mt-1" value={city} maxLength={120} onChange={(e) => setCity(e.target.value)} />
                        </div>
                    </div>
                    <div>
                        <Label className="text-xs">{t('list.fields.designation')}</Label>
                        <Input className="mt-1" value={designation} maxLength={255} onChange={(e) => setDesignation(e.target.value)} />
                    </div>
                </div>
                <DialogFooter className="gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={onCancel}>
                        {t('list.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={saving || !name.trim()}
                        onClick={() =>
                            onSave({
                                rating,
                                reviewer_name: name.trim(),
                                review_text: text.trim(),
                                city: city.trim(),
                                course_name: course.trim(),
                                designation: designation.trim(),
                            })
                        }
                    >
                        {t('list.save')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

/* ── list ─────────────────────────────────────────────────────────────── */

export const ReviewsList = () => {
    const { t } = useTranslation('managePagesReviews');
    const instituteId = getCurrentInstituteId();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { canWrite, canDelete, canPublish } = useCataloguePermissions();
    const [status, setStatus] = useState<ReviewStatus | 'ALL'>('PENDING');
    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [page, setPage] = useState(0);
    const [editing, setEditing] = useState<SiteReview | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<SiteReview | null>(null);

    useEffect(() => {
        const handle = setTimeout(() => setDebouncedQ(q.trim()), 300);
        return () => clearTimeout(handle);
    }, [q]);

    const { data, isLoading, isError, isFetching, refetch } = useQuery({
        queryKey: ['catalogue-site-reviews', instituteId, status, debouncedQ, page],
        queryFn: () => listSiteReviews(instituteId!, { status, q: debouncedQ, page, size: 20 }),
        enabled: !!instituteId,
        placeholderData: (prev) => prev,
    });

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['catalogue-site-reviews', instituteId] });

    const statusMutation = useMutation({
        mutationFn: ({ id, next }: { id: string; next: ReviewStatus }) => setSiteReviewStatus(instituteId!, id, next),
        onSuccess: (_r, { next }) => {
            toast({
                title: t(`list.toast.${next}.title`),
                description: next === 'APPROVED' ? t('list.toast.APPROVED.description') : undefined,
            });
            invalidate();
        },
        onError: () => toast({ title: t('list.toast.errorTitle'), description: t('list.toast.updateFailed'), variant: 'destructive' }),
    });

    const editMutation = useMutation({
        mutationFn: ({ id, input }: { id: string; input: SiteReviewInput }) => updateSiteReview(instituteId!, id, input),
        onSuccess: () => {
            toast({ title: t('list.toast.saved') });
            setEditing(null);
            invalidate();
        },
        onError: () => toast({ title: t('list.toast.errorTitle'), description: t('list.toast.updateFailed'), variant: 'destructive' }),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteSiteReview(instituteId!, id),
        onSuccess: () => {
            toast({ title: t('list.toast.deleted') });
            invalidate();
        },
        onError: () => toast({ title: t('list.toast.errorTitle'), description: t('list.toast.deleteFailed'), variant: 'destructive' }),
    });

    if (!instituteId) return <div className="p-6 text-neutral-500">{t('list.noInstitute')}</div>;

    const reviews = data?.content ?? [];
    const totalPages = data?.total_pages ?? 0;
    const counts = data?.counts ?? {};
    const countOf = (s: ReviewStatus | 'ALL') =>
        s === 'ALL' ? (counts.PENDING ?? 0) + (counts.APPROVED ?? 0) + (counts.REJECTED ?? 0) : counts[s] ?? 0;

    const chip = (s: ReviewStatus) =>
        s === 'APPROVED' ? (
            <StatusChip text={t('status.APPROVED')} textSize="text-xs" status="SUCCESS" />
        ) : s === 'REJECTED' ? (
            <StatusChip text={t('status.REJECTED')} textSize="text-xs" status="DANGER" showIcon={false} />
        ) : (
            <StatusChip text={t('status.PENDING')} textSize="text-xs" status="WARNING" showIcon={false} />
        );

    return (
        <div className="animate-fadeIn flex flex-col gap-6 p-6 lg:p-8">
            <div>
                <h1 className="text-xl font-semibold text-neutral-800">{t('list.title')}</h1>
                <p className="mt-0.5 text-sm text-neutral-500">{t('list.description')}</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-1" role="tablist">
                    {TABS.map((key) => (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={status === key}
                            onClick={() => {
                                setStatus(key);
                                setPage(0);
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                                status === key ? 'bg-primary-500 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                            }`}
                        >
                            {t(`tabs.${key}`)}
                            {data && (
                                <span
                                    className={`rounded-full px-1.5 text-caption ${
                                        status === key ? 'bg-white/20' : key === 'PENDING' && countOf(key) > 0 ? 'bg-warning-100 text-warning-700' : 'bg-neutral-100'
                                    }`}
                                >
                                    {countOf(key)}
                                </span>
                            )}
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
                        placeholder={t('list.search')}
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
            ) : isError ? (
                <div className="rounded-xl border border-danger-200 bg-danger-50 px-6 py-10 text-center">
                    <p className="text-sm font-medium text-danger-700">{t('list.loadFailed')}</p>
                    <MyButton buttonType="secondary" scale="small" className="mt-3" onClick={() => refetch()}>
                        {t('list.retry')}
                    </MyButton>
                </div>
            ) : reviews.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center">
                    <p className="text-sm font-medium text-neutral-700">
                        {debouncedQ ? t('list.emptyFiltered') : t(`list.empty.${status}`)}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">{t('list.emptyHint')}</p>
                </div>
            ) : (
                <div className={`space-y-3 ${isFetching ? 'opacity-70' : ''}`}>
                    {reviews.map((r) => {
                        const meta = [r.designation, r.course_name, r.city].filter(Boolean).join(' · ');
                        return (
                            <div key={r.id} className="rounded-xl border border-neutral-200 bg-white px-5 py-4 transition hover:border-neutral-300">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Stars value={r.rating} />
                                            <span className="sr-only">{t('list.starsA11y', { count: r.rating })}</span>
                                            {chip(r.status)}
                                        </div>
                                        <p className="mt-2 text-sm font-semibold text-neutral-800">{r.reviewer_name}</p>
                                        {meta && <p className="text-xs text-neutral-500">{meta}</p>}
                                        {r.review_text ? (
                                            <p className="mt-2 whitespace-pre-line text-sm text-neutral-700">{r.review_text}</p>
                                        ) : (
                                            <p className="mt-2 text-xs italic text-neutral-400">{t('list.noText')}</p>
                                        )}
                                        {r.answers && r.answers.length > 0 && (
                                            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 rounded-md bg-neutral-50 px-3 py-2 text-xs sm:grid-cols-2">
                                                {r.answers.map((a) => (
                                                    <div key={a.key} className="min-w-0">
                                                        <dt className="truncate text-neutral-500">{a.label}</dt>
                                                        <dd className="whitespace-pre-line break-words text-neutral-800">{a.value}</dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        )}
                                        <p className="mt-2 text-caption text-neutral-400">
                                            {t('list.sentOn', { date: formatDate(r.created_at) })}
                                            {r.catalogue_tag ? ` · ${t('list.fromSite', { site: r.catalogue_tag })}` : ''}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {canPublish && r.status !== 'APPROVED' && (
                                            <MyButton
                                                buttonType="primary"
                                                scale="small"
                                                disable={statusMutation.isPending}
                                                onClick={() => statusMutation.mutate({ id: r.id, next: 'APPROVED' })}
                                            >
                                                <Check className="size-4" /> {t('list.approve')}
                                            </MyButton>
                                        )}
                                        {canPublish && r.status !== 'REJECTED' && (
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                disable={statusMutation.isPending}
                                                onClick={() => statusMutation.mutate({ id: r.id, next: 'REJECTED' })}
                                            >
                                                <X className="size-4" /> {r.status === 'APPROVED' ? t('list.hide') : t('list.reject')}
                                            </MyButton>
                                        )}
                                        {(canWrite || canDelete || (canPublish && r.status !== 'PENDING')) && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                                                        aria-label={t('list.moreActions')}
                                                    >
                                                        <DotsThreeVertical className="size-5" weight="bold" />
                                                    </button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    {canWrite && (
                                                        <DropdownMenuItem onClick={() => setEditing(r)}>
                                                            <PencilSimple className="mr-2 size-4" /> {t('list.edit')}
                                                        </DropdownMenuItem>
                                                    )}
                                                    {canPublish && r.status !== 'PENDING' && (
                                                        <DropdownMenuItem onClick={() => statusMutation.mutate({ id: r.id, next: 'PENDING' })}>
                                                            <ArrowCounterClockwise className="mr-2 size-4" /> {t('list.backToPending')}
                                                        </DropdownMenuItem>
                                                    )}
                                                    {canDelete && (
                                                        <DropdownMenuItem
                                                            className="text-danger-600 focus:text-danger-600"
                                                            onClick={() => setDeleteTarget(r)}
                                                        >
                                                            <Trash className="mr-2 size-4" /> {t('list.delete')}
                                                        </DropdownMenuItem>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 text-xs text-neutral-500">
                    <MyButton buttonType="secondary" scale="small" disable={page === 0} onClick={() => setPage((p) => p - 1)}>
                        {t('list.previous')}
                    </MyButton>
                    <span>{t('list.pageOf', { page: page + 1, total: totalPages })}</span>
                    <MyButton buttonType="secondary" scale="small" disable={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                        {t('list.next')}
                    </MyButton>
                </div>
            )}

            {editing && (
                <EditReviewDialog
                    review={editing}
                    saving={editMutation.isPending}
                    onCancel={() => setEditing(null)}
                    onSave={(input) => editMutation.mutate({ id: editing.id, input })}
                />
            )}

            <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('list.deleteTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('list.deleteBody', { name: deleteTarget?.reviewer_name || '' })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('list.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 hover:bg-danger-700"
                            onClick={() => {
                                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
                                setDeleteTarget(null);
                            }}
                        >
                            {t('list.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
