import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowSquareOut, CaretDown, SortAscending, UsersThree, X } from '@phosphor-icons/react';
import { MyInput } from '@/components/design-system/input';
import { MyDropdown } from '@/components/design-system/dropdown';
import {
    AsyncSearchableSelect,
    type LoadOptionsResult,
} from '@/components/design-system/async-searchable-select';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    fetchBatchesByIds,
    fetchPaginatedBatches,
} from '@/routes/admin-package-management/-services/package-service';
import type { PackageSessionDTO } from '@/routes/admin-package-management/-types/package-types';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type { PlanListSort, PlanListStatus } from '../../-types/types';
import { batchLabel } from '../BatchPickerDialog';

/** The lifecycle segments, in the order they are offered. `CURRENT` is the default. */
export const LIFECYCLE_FILTERS = [
    'CURRENT',
    'RUNNING',
    'UPCOMING',
    'DRAFT',
    'ENDED',
    'ARCHIVED',
    'ALL',
] as const;

export type LifecycleFilter = (typeof LIFECYCLE_FILTERS)[number];

export const DEFAULT_LIFECYCLE_FILTER: LifecycleFilter = 'CURRENT';

export const PLAN_SORTS: PlanListSort[] = ['CREATED', 'START_DATE', 'TITLE'];

export function isLifecycleFilter(value: unknown): value is LifecycleFilter {
    return typeof value === 'string' && (LIFECYCLE_FILTERS as readonly string[]).includes(value);
}

/**
 * The `/plan/list?status=` values for a segment. "Current" is everything a teacher is
 * still working with: running, upcoming and drafts (a plan saved as a draft must not
 * vanish from the default view). "All" sends no filter.
 */
export function lifecycleStatuses(filter: LifecycleFilter): PlanListStatus[] | undefined {
    switch (filter) {
        case 'CURRENT':
            return ['RUNNING', 'UPCOMING', 'DRAFT'];
        case 'ALL':
            return undefined;
        default:
            return [filter];
    }
}

/** What the list and the dialogs need to know about one batch. */
export interface BatchInfo {
    id: string;
    label: string;
    courseId?: string;
    courseName?: string;
    sessionId?: string;
    levelId?: string;
}

function toBatchInfo(batch: PackageSessionDTO, fallback: string): BatchInfo {
    return {
        id: batch.id,
        label: batchLabel(batch, fallback),
        courseId: batch.package_dto?.id,
        courseName: batch.package_dto?.package_name,
        sessionId: batch.session?.id,
        levelId: batch.level?.id,
    };
}

/**
 * A batch's name and course, from the institute store when it has the batch, else from
 * the server. Null while unknown (no id, loading, or the lookup failed).
 */
export function useBatchInfo(packageSessionId: string | null | undefined): BatchInfo | null {
    const { t } = useTranslation('engagement');
    const fallback = t('batchPicker.courseFallback');
    const fromStore = useInstituteDetailsStore((state) =>
        packageSessionId ? state.getDetailsFromPackageSessionId({ packageSessionId }) : null
    ) as unknown as PackageSessionDTO | null;
    const { data } = useQuery({
        queryKey: ['engagement-batch-info', packageSessionId],
        queryFn: async () => {
            const response = await fetchBatchesByIds([packageSessionId!]);
            const rows = (response?.content ?? []) as PackageSessionDTO[];
            return rows.find((row) => row?.id === packageSessionId) ?? null;
        },
        enabled: Boolean(packageSessionId) && !fromStore,
        staleTime: 10 * 60_000,
        retry: 1,
    });
    const batch = fromStore ?? data ?? null;
    return batch ? toBatchInfo(batch, fallback) : null;
}

/**
 * Filters above the plans list: batch (written to `?packageSessionId=`), title search,
 * sort, and the lifecycle segments. The segments are a `TabsList`, so the caller wraps
 * the toolbar and the list in one `<Tabs value={lifecycle}>`.
 */
export function PlanListToolbar({
    packageSessionId,
    batchName,
    onBatchChange,
    search,
    onSearchChange,
    sort,
    onSortChange,
}: {
    packageSessionId?: string;
    /** A label for the selected batch when the caller already has one (a plan's packageSessionLabel). */
    batchName?: string | null;
    onBatchChange: (packageSessionId: string | undefined) => void;
    search: string;
    onSearchChange: (value: string) => void;
    sort: PlanListSort;
    onSortChange: (sort: PlanListSort) => void;
}) {
    const { t } = useTranslation('engagement');
    const fallback = t('batchPicker.courseFallback');
    const info = useBatchInfo(packageSessionId);
    const label = info?.label || batchName || t('list.unknownBatch');

    const loadBatches = useCallback(
        async (query: string, page: number): Promise<LoadOptionsResult> => {
            const response = await fetchPaginatedBatches({
                page,
                size: 20,
                statuses: ['ACTIVE'],
                sortBy: 'package_name',
                sortDirection: 'ASC',
                ...(query ? { search: query } : {}),
            });
            return {
                options: (response.content ?? []).map((batch) => ({
                    value: batch.id,
                    label: batchLabel(batch, fallback),
                })),
                hasMore: Boolean(response.has_next),
            };
        },
        [fallback]
    );

    const sortItems = PLAN_SORTS.map((value) => ({ value, label: t(`list.sort.${value}`) }));

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
                {packageSessionId ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-2 md:max-w-lg">
                        <span className="inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-md border border-primary-200 bg-primary-50 pe-1 ps-3 text-body text-neutral-900">
                            <UsersThree
                                size={16}
                                aria-hidden
                                className="shrink-0 text-neutral-600"
                            />
                            <span className="truncate">
                                <span className="sr-only">{t('list.batchFilter')}: </span>
                                {label}
                            </span>
                            <button
                                type="button"
                                onClick={() => onBatchChange(undefined)}
                                aria-label={t('list.clearBatch')}
                                title={t('list.clearBatch')}
                                className="flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-primary-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                            >
                                <X size={14} aria-hidden />
                            </button>
                        </span>
                        {info?.courseId && (
                            <Link
                                to="/study-library/courses/course-details"
                                search={{
                                    courseId: info.courseId,
                                    sessionId: info.sessionId,
                                    levelId: info.levelId,
                                }}
                                className="inline-flex items-center gap-1 rounded-md text-body font-semibold text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                            >
                                {t('list.openCourse')}
                                <ArrowSquareOut size={14} aria-hidden />
                            </Link>
                        )}
                    </div>
                ) : (
                    <div className="w-full md:w-64">
                        <AsyncSearchableSelect
                            value=""
                            onChange={(value) => onBatchChange(value || undefined)}
                            loadOptions={loadBatches}
                            placeholder={t('list.allBatches')}
                            searchPlaceholder={t('batchPicker.search')}
                            emptyText={t('batchPicker.noMatch')}
                            triggerClassName="h-9 border-neutral-300 text-body text-neutral-600"
                        />
                    </div>
                )}

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 md:justify-end">
                    <div className="min-w-0 flex-1 md:max-w-xs">
                        <MyInput
                            inputType="search"
                            input={search}
                            onChangeFunction={(e) => onSearchChange(e.target.value)}
                            inputPlaceholder={t('list.searchPlaceholder')}
                            aria-label={t('list.search')}
                            className="sm:w-full"
                        />
                    </div>
                    <MyDropdown
                        dropdownList={sortItems}
                        currentValue={sort}
                        onSelect={(value) => onSortChange(value as PlanListSort)}
                    >
                        <span className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-neutral-300 px-3 text-body text-neutral-600 hover:border-primary-200">
                            <SortAscending size={16} aria-hidden />
                            {t('list.sortLabel', { sort: t(`list.sort.${sort}`) })}
                            <CaretDown size={14} aria-hidden />
                        </span>
                    </MyDropdown>
                </div>
            </div>

            <div className="-mx-1 overflow-x-auto px-1 pb-1">
                <TabsList aria-label={t('list.lifecycleLabel')} className="h-auto w-max">
                    {LIFECYCLE_FILTERS.map((filter) => (
                        <TabsTrigger
                            key={filter}
                            value={filter}
                            className="px-3 py-1.5 text-body text-neutral-600 data-[state=active]:text-neutral-900"
                        >
                            {t(`list.lifecycle.${filter}`)}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </div>
        </div>
    );
}
