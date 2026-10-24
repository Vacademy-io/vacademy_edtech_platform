import { useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowClockwise,
    BookOpen,
    CircleNotch,
    Info,
    MagnifyingGlass,
    UsersThree,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { fetchPaginatedBatches } from '@/routes/admin-package-management/-services/package-service';
import type { PackageSessionDTO } from '@/routes/admin-package-management/-types/package-types';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const PAGE_SIZE = 20;
/** "Select all in course" reads a course's batches in pages of this size… */
const COURSE_PAGE_SIZE = 100;
/** …and stops after this many pages (1000 batches), which no real course reaches. */
const COURSE_MAX_PAGES = 10;
/** Selected chips shown before "+N more", so a big selection doesn't push the list away. */
const CHIP_PREVIEW = 6;

export interface BatchOption {
    id: string;
    /** "Course · Session · Level" (or the batch's own name). */
    label: string;
    /** The batch's course (package). Set by this picker; optional for callers. */
    courseId?: string;
    courseName?: string;
}

function isDefaultPart(value: string | null | undefined): boolean {
    return !value || !value.trim() || value.trim().toUpperCase() === 'DEFAULT';
}

/** "Session · Level", skipping the DEFAULT placeholders; '' when both are default. */
export function batchSubLabel(b: PackageSessionDTO): string {
    return [b.session?.session_name, b.level?.level_name]
        .filter((part) => !isDefaultPart(part))
        .map((part) => part!.trim())
        .join(' · ');
}

/**
 * The batch's name, else "Course · Session · Level" with DEFAULT parts skipped — the
 * same rule as the server's EngagementPlanService.batchLabel, so a plan card and this
 * picker name a batch the same way.
 */
export function batchLabel(
    b: PackageSessionDTO,
    fallback = getTerminology(ContentTerms.Course, SystemTerms.Course)
): string {
    const own = b.name?.trim();
    if (own) return own;
    const course = b.package_dto?.package_name?.trim();
    const parts = [isDefaultPart(course) ? '' : course, batchSubLabel(b)].filter(Boolean);
    return parts.join(' · ') || fallback;
}

function toOption(b: PackageSessionDTO, fallback: string): BatchOption {
    return {
        id: b.id,
        label: batchLabel(b, fallback),
        courseId: b.package_dto?.id,
        courseName: b.package_dto?.package_name,
    };
}

interface CourseGroup {
    id: string;
    name: string;
    rows: PackageSessionDTO[];
}

/** Groups a page's rows by course, keeping the server's order (sorted by course name). */
function groupByCourse(rows: PackageSessionDTO[], fallback: string): CourseGroup[] {
    const groups: CourseGroup[] = [];
    const byId = new Map<string, CourseGroup>();
    for (const row of rows) {
        const id = row.package_dto?.id ?? '';
        let group = byId.get(id);
        if (!group) {
            group = { id, name: row.package_dto?.package_name?.trim() || fallback, rows: [] };
            byId.set(id, group);
            groups.push(group);
        }
        group.rows.push(row);
    }
    return groups;
}

/**
 * Pick one or more batches, grouped by course.
 *
 * - Search and paging are done by the SERVER (an institute can have hundreds of
 *   batches), sorted by course name so a course's batches sit together.
 * - Selections survive paging and searching; Cancel discards them.
 * - "Select all in course" fetches every batch of that course (matching the search),
 *   not just the ones on this page.
 * - `courseId` limits the list to one course — a course-content task must only reach
 *   batches of the course its lesson belongs to.
 */
export function BatchPickerDialog({
    open,
    onOpenChange,
    selected,
    onConfirm,
    courseId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selected: BatchOption[];
    onConfirm: (next: BatchOption[]) => void;
    /** Only show batches of this course (package id). */
    courseId?: string;
}) {
    const { t } = useTranslation('engagement');
    const [search, setSearch] = useState('');
    const [debounced, setDebounced] = useState('');
    const [page, setPage] = useState(0);
    const [draft, setDraft] = useState<BatchOption[]>(selected);
    const [busyCourse, setBusyCourse] = useState<string | null>(null);
    const [chipsExpanded, setChipsExpanded] = useState(false);
    const courseFallback = t('batchPicker.courseFallback');

    // Re-seed the draft each time the dialog opens so Cancel truly discards.
    useEffect(() => {
        if (open) {
            setDraft(selected);
            setSearch('');
            setDebounced('');
            setPage(0);
            setBusyCourse(null);
            setChipsExpanded(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebounced(search.trim());
            setPage(0);
        }, 300);
        return () => window.clearTimeout(timer);
    }, [search]);

    const query = useQuery({
        queryKey: ['engagement-batch-picker', courseId ?? null, debounced, page],
        queryFn: () =>
            fetchPaginatedBatches({
                page,
                size: PAGE_SIZE,
                statuses: ['ACTIVE'],
                sortBy: 'package_name',
                sortDirection: 'ASC',
                ...(courseId ? { packageId: courseId } : {}),
                ...(debounced ? { search: debounced } : {}),
            }),
        enabled: open,
        placeholderData: keepPreviousData,
    });
    const { data, isLoading, isFetching, isError, refetch } = query;

    const rows = useMemo(() => data?.content ?? [], [data]);
    // The batches DTO is snake_case; total_pages, not totalPages.
    const totalPages = Math.max(1, data?.total_pages ?? 1);
    const groups = useMemo(() => groupByCourse(rows, courseFallback), [rows, courseFallback]);
    const selectedIds = useMemo(() => new Set(draft.map((b) => b.id)), [draft]);
    const showSkeleton = isLoading && !data;
    const refreshing = isFetching && !showSkeleton;

    // A page past the end (the list shrank) falls back to the last page.
    useEffect(() => {
        if (data && page > 0 && page >= data.total_pages)
            setPage(Math.max(0, data.total_pages - 1));
    }, [data, page]);

    function toggle(batch: PackageSessionDTO) {
        setDraft((prev) =>
            prev.some((b) => b.id === batch.id)
                ? prev.filter((b) => b.id !== batch.id)
                : [...prev, toOption(batch, courseFallback)]
        );
    }

    function addAll(batches: PackageSessionDTO[]) {
        setDraft((prev) => {
            const have = new Set(prev.map((b) => b.id));
            const added = batches
                .filter((b) => !have.has(b.id))
                .map((b) => toOption(b, courseFallback));
            return added.length ? [...prev, ...added] : prev;
        });
    }

    async function selectCourse(group: CourseGroup) {
        setBusyCourse(group.id);
        try {
            const all: PackageSessionDTO[] = [];
            let next = 0;
            let pages = 1;
            do {
                const response = await fetchPaginatedBatches({
                    page: next,
                    size: COURSE_PAGE_SIZE,
                    statuses: ['ACTIVE'],
                    sortBy: 'package_name',
                    sortDirection: 'ASC',
                    packageId: group.id,
                    ...(debounced ? { search: debounced } : {}),
                });
                all.push(...(response.content ?? []));
                pages = response.total_pages ?? 1;
                next += 1;
            } while (next < pages && next < COURSE_MAX_PAGES);
            addAll(all.length ? all : group.rows);
        } catch {
            // Still honour what the teacher can see.
            addAll(group.rows);
            toast.error(t('batchPicker.selectAllError'));
        } finally {
            setBusyCourse(null);
        }
    }

    function clearCourse(group: CourseGroup) {
        const visible = new Set(group.rows.map((b) => b.id));
        setDraft((prev) => prev.filter((b) => b.courseId !== group.id && !visible.has(b.id)));
    }

    const courseName = courseId ? groups[0]?.name : undefined;

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={t('batchPicker.title')}
            dialogWidth="max-w-xl"
            footerLeft={
                <p className="text-body tabular-nums text-neutral-600" aria-live="polite">
                    {t('batchPicker.selected', { count: draft.length })}
                </p>
            }
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('batchPicker.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={draft.length === 0}
                        onClick={() => {
                            onConfirm(draft);
                            onOpenChange(false);
                        }}
                    >
                        {t('batchPicker.use', { count: draft.length })}
                    </MyButton>
                </>
            }
        >
            <div className="space-y-3">
                <div className="relative">
                    <MagnifyingGlass
                        size={16}
                        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                        aria-hidden="true"
                    />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('batchPicker.search')}
                        aria-label={t('batchPicker.search')}
                        className="ps-9"
                    />
                </div>

                {courseId && (
                    <p className="flex items-start gap-1.5 text-caption text-neutral-600">
                        <Info
                            size={14}
                            className="mt-0.5 shrink-0 text-info-500"
                            aria-hidden="true"
                        />
                        <span>
                            {courseName
                                ? t('batchPicker.courseOnlyNamed', { course: courseName })
                                : t('batchPicker.courseOnly')}
                        </span>
                    </p>
                )}

                {draft.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {(chipsExpanded ? draft : draft.slice(0, CHIP_PREVIEW)).map((b) => (
                            <span
                                key={b.id}
                                className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary-50 py-0.5 pe-1 ps-2 text-caption text-primary-500"
                            >
                                <span className="min-w-0 truncate" dir="auto">
                                    {b.label}
                                </span>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setDraft((prev) => prev.filter((x) => x.id !== b.id))
                                    }
                                    className="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                    aria-label={t('batchPicker.removeNamed', { label: b.label })}
                                    title={t('batchPicker.remove')}
                                >
                                    <X size={12} aria-hidden="true" />
                                </button>
                            </span>
                        ))}
                        {draft.length > CHIP_PREVIEW && (
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                aria-expanded={chipsExpanded}
                                onClick={() => setChipsExpanded((v) => !v)}
                            >
                                {chipsExpanded
                                    ? t('batchPicker.showLess')
                                    : t('batchPicker.moreChips', {
                                          count: draft.length - CHIP_PREVIEW,
                                      })}
                            </MyButton>
                        )}
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            onClick={() => setDraft([])}
                        >
                            {t('batchPicker.clearAll')}
                        </MyButton>
                    </div>
                )}

                {/* Before the empty state: a failed load must not read as "no match". */}
                {isError && (
                    <div
                        role="alert"
                        className="flex flex-wrap items-center gap-3 rounded-md border border-danger-200 bg-danger-50 px-3 py-2.5 text-danger-700"
                    >
                        <WarningCircle size={18} className="shrink-0" aria-hidden="true" />
                        <p className="min-w-0 flex-1 text-body">{t('batchPicker.loadError')}</p>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => void refetch()}
                        >
                            <ArrowClockwise size={14} aria-hidden="true" /> {t('common.retry')}
                        </MyButton>
                    </div>
                )}

                {showSkeleton ? (
                    <div
                        className="space-y-3 rounded-md border border-neutral-200 p-3"
                        aria-busy="true"
                        aria-label={t('batchPicker.loading')}
                    >
                        <Skeleton className="h-4 w-40" />
                        {Array.from({ length: 5 }, (_, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <Skeleton className="size-4 rounded-sm" />
                                <Skeleton className="h-4 flex-1" />
                            </div>
                        ))}
                    </div>
                ) : rows.length === 0 && !isError ? (
                    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-neutral-300 px-4 py-8 text-center">
                        <UsersThree size={28} className="text-neutral-400" aria-hidden="true" />
                        <p className="text-body text-neutral-600">
                            {debounced
                                ? t('batchPicker.noMatch')
                                : courseId
                                  ? t('batchPicker.emptyCourse')
                                  : t('batchPicker.empty')}
                        </p>
                    </div>
                ) : rows.length > 0 ? (
                    <div
                        aria-busy={refreshing}
                        className={cn(
                            'divide-y divide-neutral-100 overflow-hidden rounded-md border border-neutral-200 transition-opacity',
                            refreshing && 'opacity-60'
                        )}
                    >
                        {groups.map((group, groupIndex) => {
                            const chosen = group.rows.filter((b) => selectedIds.has(b.id)).length;
                            // A course's batches are contiguous (sorted by course), so only the
                            // first and last group on a page can continue on another page.
                            const mayContinue =
                                totalPages > 1 &&
                                (groupIndex === 0 || groupIndex === groups.length - 1);
                            const offerSelectAll =
                                Boolean(group.id) && (group.rows.length > 1 || mayContinue);
                            const allChosen = chosen === group.rows.length;
                            const busy = busyCourse === group.id;
                            const headerId = `batch-course-${group.id || 'none'}`;
                            return (
                                <div
                                    key={group.id || 'none'}
                                    role="group"
                                    aria-labelledby={headerId}
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-neutral-50 px-3 py-2">
                                        <p
                                            id={headerId}
                                            dir="auto"
                                            className="flex min-w-0 items-center gap-1.5 text-body font-semibold text-neutral-800"
                                        >
                                            <BookOpen
                                                size={16}
                                                className="shrink-0 text-neutral-500"
                                                aria-hidden="true"
                                            />
                                            <span className="min-w-0 truncate">{group.name}</span>
                                            {chosen > 0 && !allChosen && (
                                                <span className="shrink-0 text-caption font-normal text-neutral-500">
                                                    {t('batchPicker.selected', { count: chosen })}
                                                </span>
                                            )}
                                        </p>
                                        {offerSelectAll && (
                                            <label className="flex cursor-pointer items-center gap-2 text-caption text-neutral-700">
                                                {busy ? (
                                                    <CircleNotch
                                                        size={16}
                                                        className="animate-spin text-primary-500"
                                                        aria-hidden="true"
                                                    />
                                                ) : (
                                                    <Checkbox
                                                        checked={allChosen}
                                                        disabled={busyCourse !== null}
                                                        onCheckedChange={() =>
                                                            allChosen
                                                                ? clearCourse(group)
                                                                : void selectCourse(group)
                                                        }
                                                    />
                                                )}
                                                {busy
                                                    ? t('batchPicker.selectingCourse')
                                                    : t('batchPicker.selectAllInCourse')}
                                            </label>
                                        )}
                                    </div>
                                    <ul className="divide-y divide-neutral-100">
                                        {group.rows.map((batch) => {
                                            const sub = batchSubLabel(batch);
                                            const own = batch.name?.trim();
                                            return (
                                                <li key={batch.id}>
                                                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-neutral-50">
                                                        <Checkbox
                                                            checked={selectedIds.has(batch.id)}
                                                            onCheckedChange={() => toggle(batch)}
                                                        />
                                                        <span className="min-w-0 flex-1">
                                                            <span
                                                                dir="auto"
                                                                className="block truncate text-body text-neutral-800"
                                                            >
                                                                {own ||
                                                                    sub ||
                                                                    t('batchPicker.defaultBatch')}
                                                            </span>
                                                            {own && sub && (
                                                                <span
                                                                    dir="auto"
                                                                    className="block truncate text-caption text-neutral-500"
                                                                >
                                                                    {sub}
                                                                </span>
                                                            )}
                                                        </span>
                                                    </label>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                ) : null}

                {!showSkeleton && totalPages > 1 && (
                    <MyPagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                    />
                )}
            </div>
        </MyDialog>
    );
}
