import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { listProductPages, deleteProductPage } from '../-services/product-pages-service';
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
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { CreateProductPageDialog } from './CreateProductPageDialog';
import { Trash2, Pencil, Plus, ShoppingCart, Hash, Search, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import type {
    ProductPageListSort,
    ProductPageListStatus,
    ProductPageSummary,
} from '../-types/product-page-types';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyPagination } from '@/components/design-system/pagination';
import { cn } from '@/lib/utils';
import { DotsThreeVertical } from '@phosphor-icons/react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UtmLinkMenuItem } from '@/components/common/utm/utm-link-menu-item';
import { UtmBuilderDialog } from '@/components/common/utm/utm-builder-dialog';
import { useUtmBuilderEnabled } from '@/hooks/use-utm-builder-enabled';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getLearnerPortalUrl } from '@/lib/learner-portal-url';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const GRADIENTS = [
    'from-primary-400 to-primary-600',
    'from-blue-400 to-blue-600',
    'from-emerald-400 to-teal-600',
    'from-orange-400 to-rose-500',
    'from-pink-400 to-fuchsia-600',
    'from-amber-400 to-orange-500',
    'from-indigo-400 to-blue-600',
    'from-teal-400 to-green-600',
];

const PAGE_SIZE = 12;

const SORT_OPTIONS: { value: ProductPageListSort; label: string }[] = [
    { value: 'LATEST', label: 'Latest' },
    { value: 'OLDEST', label: 'Oldest' },
    { value: 'NAME_ASC', label: 'A to Z' },
    { value: 'NAME_DESC', label: 'Z to A' },
];

const useDebounced = <T,>(value: T, delayMs = 300): T => {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(id);
    }, [value, delayMs]);
    return debounced;
};

const getGradient = (name: string) =>
    GRADIENTS[name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % GRADIENTS.length];

const CardSkeleton = () => (
    <div className="animate-pulse overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="h-24 bg-neutral-100" />
        <div className="space-y-2 p-4">
            <div className="h-4 w-2/3 rounded bg-neutral-100" />
            <div className="h-3 w-1/3 rounded bg-neutral-100" />
            <div className="mt-4 flex gap-2">
                <div className="h-8 flex-1 rounded bg-neutral-100" />
                <div className="h-8 w-8 rounded bg-neutral-100" />
            </div>
        </div>
    </div>
);

export const ProductPagesList = () => {
    const instituteId = getCurrentInstituteId();
    const courseLower = getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase();
    const coursesLower = getTerminologyPlural(
        ContentTerms.Course,
        SystemTerms.Course
    ).toLocaleLowerCase();
    const navigate = useNavigate();
    const { toast } = useToast();
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteConfirmPage, setDeleteConfirmPage] = useState<ProductPageSummary | null>(null);
    const [utmPage, setUtmPage] = useState<ProductPageSummary | null>(null);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<ProductPageListStatus>('ALL');
    const [sort, setSort] = useState<ProductPageListSort>('LATEST');
    const [pageIndex, setPageIndex] = useState(0);
    const debouncedSearch = useDebounced(search.trim(), 300);
    const { instituteDetails } = useInstituteDetailsStore();
    // One action in the ⋮ menu today, so hide the trigger entirely rather than
    // opening an empty popover for institutes that never enabled the builder.
    const { enabled: utmEnabled } = useUtmBuilderEnabled();

    /**
     * Public URL of a product page, on the institute's OWN learner domain.
     * A link built on the shared learner.vacademy.io fallback shows Vacademy
     * branding in the message and in WhatsApp's unfurl — see
     * lib/learner-portal-url.
     */
    const productPageUrl = (page: Pick<ProductPageSummary, 'code'>) =>
        page.code
            ? getLearnerPortalUrl(
                  `/product-pages/${encodeURIComponent(page.code)}?instituteId=${encodeURIComponent(
                      instituteId || ''
                  )}`,
                  instituteDetails?.learner_portal_base_url
              )
            : '';

    const { data, isLoading, isFetching, refetch } = useQuery({
        queryKey: ['productPagesList', instituteId, debouncedSearch, status, sort, pageIndex],
        queryFn: () =>
            listProductPages(instituteId!, {
                search: debouncedSearch,
                status,
                sort,
                page: pageIndex,
                size: PAGE_SIZE,
            }),
        enabled: !!instituteId,
        placeholderData: keepPreviousData,
    });

    const pages = data?.content ?? [];
    const totalPages = data?.total_pages ?? 0;
    const activeCount = data?.active_count ?? 0;
    const draftCount = data?.draft_count ?? 0;
    const hasFilters = !!debouncedSearch || status !== 'ALL';

    // Deleting the last card of the last page leaves that page empty: step back.
    useEffect(() => {
        if (data && data.content.length === 0 && pageIndex > 0 && pageIndex >= data.total_pages) {
            setPageIndex(Math.max(data.total_pages - 1, 0));
        }
    }, [data, pageIndex]);

    const changeStatus = (next: ProductPageListStatus) => {
        setStatus((prev) => (prev === next && next !== 'ALL' ? 'ALL' : next));
        setPageIndex(0);
    };

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteProductPage(id),
        onSuccess: () => {
            toast({ title: 'Deleted', description: 'Product page deleted successfully' });
            setDeletingId(null);
            refetch();
        },
        onError: () => {
            toast({ title: 'Error', description: 'Failed to delete product page', variant: 'destructive' });
            setDeletingId(null);
        },
    });

    const confirmDelete = () => {
        if (!deleteConfirmPage) return;
        setDeletingId(deleteConfirmPage.id);
        deleteMutation.mutate(deleteConfirmPage.id);
        setDeleteConfirmPage(null);
    };

    if (!instituteId) return <div className="p-6 text-neutral-500">No institute selected</div>;

    const chipClass = (selected: boolean) =>
        cn(
            'flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm shadow-sm transition-colors',
            selected
                ? 'border-primary-400 ring-1 ring-primary-200'
                : 'border-neutral-200 hover:border-neutral-300'
        );

    return (
        <div className="animate-fadeIn flex flex-col gap-6 p-6 lg:p-8">
            {/* Page header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-800">Product Pages</h1>
                    <p className="mt-0.5 text-sm text-neutral-500">
                        Multi-{courseLower} enrollment landing pages with a combined checkout
                    </p>
                </div>
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={() => setIsCreateDialogOpen(true)}
                >
                    <Plus className="size-4" />
                    New Product Page
                </MyButton>
            </div>

            {/* Status chips + search + sort */}
            {(isLoading || hasFilters || activeCount + draftCount > 0) && (
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            className={chipClass(status === 'ALL')}
                            aria-pressed={status === 'ALL'}
                            onClick={() => changeStatus('ALL')}
                        >
                            <ShoppingCart className="size-4 text-neutral-400" />
                            <span className="font-semibold text-neutral-700">
                                {activeCount + draftCount}
                            </span>
                            <span className="text-neutral-400">total</span>
                        </button>
                        <button
                            type="button"
                            className={chipClass(status === 'ACTIVE')}
                            aria-pressed={status === 'ACTIVE'}
                            onClick={() => changeStatus('ACTIVE')}
                        >
                            <span className="size-2 rounded-full bg-success-500" />
                            <span className="font-semibold text-neutral-700">{activeCount}</span>
                            <span className="text-neutral-400">active</span>
                        </button>
                        <button
                            type="button"
                            className={chipClass(status === 'DRAFT')}
                            aria-pressed={status === 'DRAFT'}
                            onClick={() => changeStatus('DRAFT')}
                        >
                            <span className="size-2 rounded-full bg-warning-400" />
                            <span className="font-semibold text-neutral-700">{draftCount}</span>
                            <span className="text-neutral-400">draft</span>
                        </button>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="relative sm:w-72">
                            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                            <Input
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setPageIndex(0);
                                }}
                                placeholder="Search by name or code"
                                className="px-9"
                                aria-label="Search product pages"
                            />
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearch('');
                                        setPageIndex(0);
                                    }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                                    aria-label="Clear search"
                                >
                                    <X className="size-4" />
                                </button>
                            )}
                        </div>
                        <Select
                            value={sort}
                            onValueChange={(value) => {
                                setSort(value as ProductPageListSort);
                                setPageIndex(0);
                            }}
                        >
                            <SelectTrigger className="sm:w-40" aria-label="Sort product pages">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {SORT_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}

            {/* Content */}
            {isLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <CardSkeleton key={i} />
                    ))}
                </div>
            ) : pages.length === 0 && hasFilters ? (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-200 bg-white py-16 text-center">
                    <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-neutral-50">
                        <Search className="size-7 text-neutral-300" />
                    </div>
                    <h3 className="mb-1 text-base font-semibold text-neutral-700">
                        No product pages match
                    </h3>
                    <p className="mb-6 max-w-xs text-sm text-neutral-400">
                        Try a different search or status.
                    </p>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => {
                            setSearch('');
                            setStatus('ALL');
                            setPageIndex(0);
                        }}
                    >
                        Clear filters
                    </MyButton>
                </div>
            ) : pages.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-200 bg-white py-20 text-center">
                    <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary-50">
                        <ShoppingCart className="size-7 text-primary-400" />
                    </div>
                    <h3 className="mb-1 text-base font-semibold text-neutral-700">No product pages yet</h3>
                    <p className="mb-6 max-w-xs text-sm text-neutral-400">
                        Create a product page to let learners add multiple {coursesLower} to a cart
                        and pay in one go.
                    </p>
                    <MyButton buttonType="primary" scale="medium" onClick={() => setIsCreateDialogOpen(true)}>
                        <Plus className="size-4" />
                        Create your first product page
                    </MyButton>
                </div>
            ) : (
                <div
                    className={cn(
                        'grid gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
                        isFetching && 'opacity-60'
                    )}
                >
                    {pages.map((page) => {
                        const isActive = page.status === 'ACTIVE';
                        const gradient = getGradient(page.name);
                        const initial = page.name[0]?.toUpperCase() ?? '?';
                        const isDeleting = deletingId === page.id;

                        return (
                            <div
                                key={page.id}
                                className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                            >
                                <div
                                    className={`relative flex h-24 items-center justify-center bg-gradient-to-br ${gradient}`}
                                >
                                    <span className="select-none text-5xl font-bold text-white/20">
                                        {initial}
                                    </span>
                                    <div className="absolute right-3 top-3">
                                        <StatusChip
                                            text={isActive ? 'Active' : 'Draft'}
                                            textSize="text-[10px]"
                                            status={isActive ? 'SUCCESS' : 'WARNING'}
                                            showIcon={false}
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-1 flex-col p-4">
                                    <h3 className="break-words text-sm font-semibold leading-snug text-neutral-800">
                                        {page.name}
                                    </h3>

                                    <div className="mt-1 flex items-center gap-1 text-[11px] text-neutral-400">
                                        <Hash className="size-3" />
                                        <span className="font-mono">{page.code}</span>
                                    </div>

                                    {page.mapping_count > 0 && (
                                        <div className="mt-0.5 text-[11px] text-neutral-400">
                                            {page.mapping_count}{' '}
                                            {page.mapping_count !== 1
                                                ? coursesLower
                                                : courseLower}
                                        </div>
                                    )}

                                    <div className="mt-auto flex items-center gap-2 pt-4">
                                        <MyButton
                                            scale="small"
                                            buttonType="primary"
                                            className="flex-1"
                                            onClick={() =>
                                                navigate({
                                                    to: '/manage-pages/product-pages/editor/$productPageId',
                                                    params: { productPageId: page.id },
                                                })
                                            }
                                        >
                                            <Pencil className="size-3" />
                                            Edit
                                        </MyButton>

                                        {utmEnabled && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <MyButton
                                                        scale="small"
                                                        buttonType="secondary"
                                                        layoutVariant="icon"
                                                        title="More actions"
                                                    >
                                                        <DotsThreeVertical className="size-3.5" />
                                                    </MyButton>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <UtmLinkMenuItem
                                                        hidden={!page.code}
                                                        onSelect={() => setUtmPage(page)}
                                                    />
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}

                                        <MyButton
                                            scale="small"
                                            buttonType="secondary"
                                            layoutVariant="icon"
                                            disable={isDeleting}
                                            onClick={() => setDeleteConfirmPage(page)}
                                            title="Delete page"
                                        >
                                            {isDeleting ? (
                                                <span className="size-3.5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
                                            ) : (
                                                <Trash2 className="size-3.5 text-danger-500" />
                                            )}
                                        </MyButton>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* Add new card */}
                    <button
                        onClick={() => setIsCreateDialogOpen(true)}
                        className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 bg-white text-neutral-400 transition-all hover:border-primary-300 hover:bg-primary-50/30 hover:text-primary-500"
                    >
                        <div className="flex size-10 items-center justify-center rounded-full bg-neutral-100 transition-colors group-hover:bg-primary-100">
                            <Plus className="size-5" />
                        </div>
                        <span className="text-sm font-medium">New product page</span>
                    </button>
                </div>
            )}

            {totalPages > 1 && (
                <MyPagination
                    currentPage={pageIndex}
                    totalPages={totalPages}
                    onPageChange={setPageIndex}
                />
            )}

            <UtmBuilderDialog
                open={!!utmPage}
                onOpenChange={(open) => !open && setUtmPage(null)}
                baseUrl={utmPage ? productPageUrl(utmPage) : ''}
                sourceType="PRODUCT_PAGE"
                entityName={utmPage?.name}
            />

            <CreateProductPageDialog
                open={isCreateDialogOpen}
                onOpenChange={setIsCreateDialogOpen}
                onCreated={(id) => {
                    navigate({
                        to: '/manage-pages/product-pages/editor/$productPageId',
                        params: { productPageId: id },
                    });
                }}
            />

            <AlertDialog
                open={!!deleteConfirmPage}
                onOpenChange={(open) => !open && setDeleteConfirmPage(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete &quot;{deleteConfirmPage?.name}&quot;?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete this product page. Learners with the link will no
                            longer be able to access it.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            className="bg-danger-600 hover:bg-danger-700"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
