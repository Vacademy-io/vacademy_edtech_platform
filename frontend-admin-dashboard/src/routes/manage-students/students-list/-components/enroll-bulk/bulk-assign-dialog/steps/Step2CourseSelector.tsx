import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
    MagnifyingGlass,
    BookOpen,
    FunnelSimple,
    X,
    CaretDown,
    CaretLeft,
    CaretRight,
    Warning,
    Tag,
} from '@phosphor-icons/react';
import { SelectedPackageSession } from '../../../../-types/bulk-assign-types';
import { cn } from '@/lib/utils';
import { getAllCoursesWithFilters } from '@/routes/study-library/courses/-services/courses-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { GET_LEVELS_BY_INSTITUTE, GET_SESSION_DETAILS } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type { CourseItem } from '@/routes/study-library/courses/-components/course-material';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import {
    ContentTerms,
    RoleTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';

interface Props {
    selectedPackageSessions: SelectedPackageSession[];
    onSelectedPackageSessionsChange: (sessions: SelectedPackageSession[]) => void;
    initialPackageSessionId?: string;
}

function useDebounce<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timeoutId = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timeoutId);
    }, [value, delay]);
    return debounced;
}

const PAGE_SIZE = 20;

/**
 * The batch's own name, with the course prefix the API bolts on removed — the backend
 * returns packageSessionName as CONCAT(package_name, ' ', ps.name), and the course name
 * is already the heading this row sits under.
 */
const batchLabel = (batch: { package_session_name?: string | null; package_name?: string }) => {
    const full = batch.package_session_name?.trim();
    if (!full) return '';
    const course = batch.package_name?.trim();
    if (course && full.toLowerCase().startsWith(course.toLowerCase())) {
        return full.slice(course.length).trim() || full;
    }
    return full;
};

export const Step2CourseSelector = ({
    selectedPackageSessions,
    onSelectedPackageSessionsChange,
    initialPackageSessionId,
}: Props) => {
    const { t } = useTranslation('manageStudentsStep2CourseSelector');
    const instituteId = getCurrentInstituteId();

    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const coursesTerm = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
    const levelTerm = getTerminology(ContentTerms.Level, SystemTerms.Level);
    const levelsTerm = getTerminologyPlural(ContentTerms.Level, SystemTerms.Level);
    const sessionTerm = getTerminology(ContentTerms.Session, SystemTerms.Session);
    const sessionsTerm = getTerminologyPlural(ContentTerms.Session, SystemTerms.Session);
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const batchesTerm = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
    const learnersTerm = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);
    const tagTerm = getTerminology(ContentTerms.PopularTag, SystemTerms.PopularTag);

    const { instituteDetails } = useInstituteDetailsStore();
    const tagOptions = useMemo(() => instituteDetails?.tags ?? [], [instituteDetails?.tags]);

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedLevelIds, setSelectedLevelIds] = useState<string[]>([]);
    const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [page, setPage] = useState(0);
    const debouncedSearch = useDebounce(searchQuery, 400);

    useEffect(() => {
        setPage(0);
    }, [debouncedSearch, selectedLevelIds, selectedSessionIds, selectedTags]);

    const { data: levelOptions = [], isLoading: isLevelsLoading } = useQuery<
        { id: string; level_name: string }[]
    >({
        queryKey: ['STEP2_LEVELS', instituteId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.get(GET_LEVELS_BY_INSTITUTE, {
                params: { instituteId },
            });
            return response.data;
        },
        staleTime: 300000,
        enabled: !!instituteId,
    });

    // GET_SESSION_DETAILS returns [{ session: { id, session_name, ... }, packages: [...] }]
    // must map to flatten
    const { data: sessionOptions = [], isLoading: isSessionsLoading } = useQuery<
        { id: string; session_name: string }[]
    >({
        queryKey: ['STEP2_SESSIONS', instituteId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.get(GET_SESSION_DETAILS, {
                params: { instituteId },
            });
            return (response.data ?? []).map(
                (item: { session: { id: string; session_name: string } }) => ({
                    id: item.session.id,
                    session_name: item.session.session_name,
                })
            );
        },
        staleTime: 300000,
        enabled: !!instituteId,
    });

    const {
        data: courseData,
        isLoading: isCoursesLoading,
        isError,
        error,
    } = useQuery({
        queryKey: [
            'STEP2_COURSES',
            instituteId,
            debouncedSearch,
            selectedLevelIds,
            selectedSessionIds,
            selectedTags,
            page,
        ],
        queryFn: () =>
            getAllCoursesWithFilters(page, PAGE_SIZE, instituteId, {
                status: ['ACTIVE'],
                level_ids: selectedLevelIds,
                session_ids: selectedSessionIds,
                tag: selectedTags,
                faculty_ids: [],
                search_by_name: debouncedSearch || '',
                min_percentage_completed: 0,
                max_percentage_completed: 0,
                sort_columns: { created_at: 'DESC' },
                package_ids: [],
                package_session_ids: [],
                package_view: false,
            }),
        enabled: !!instituteId,
        staleTime: 1000 * 30,
    });

    const items: CourseItem[] = courseData?.content ?? [];
    const totalPages: number = courseData?.totalPages ?? 0;
    const totalElements: number = courseData?.totalElements ?? 0;

    const groups = useMemo(() => {
        const map: Record<string, { packageName: string; items: CourseItem[] }> = {};
        items.forEach((item) => {
            if (!map[item.id]) {
                map[item.id] = { packageName: item.package_name, items: [] };
            }
            map[item.id]!.items.push(item);
        });
        const arr = Object.entries(map).map(([pkgId, group]) => ({
            id: pkgId,
            packageName: group.packageName,
            batches: group.items,
        }));
        if (initialPackageSessionId) {
            arr.sort((a, b) => {
                const aHas = a.batches.some(
                    (x) => x.package_session_id === initialPackageSessionId
                );
                const bHas = b.batches.some(
                    (x) => x.package_session_id === initialPackageSessionId
                );
                if (aHas && !bHas) return -1;
                if (!aHas && bHas) return 1;
                return 0;
            });
        }
        return arr;
    }, [items, initialPackageSessionId]);

    const isSelected = useCallback(
        (packageSessionId: string) =>
            selectedPackageSessions.some((s) => s.packageSessionId === packageSessionId),
        [selectedPackageSessions]
    );

    const toggle = useCallback(
        (item: CourseItem) => {
            const psId = item.package_session_id;
            if (isSelected(psId)) {
                onSelectedPackageSessionsChange(
                    selectedPackageSessions.filter((s) => s.packageSessionId !== psId)
                );
            } else {
                onSelectedPackageSessionsChange([
                    ...selectedPackageSessions,
                    {
                        packageSessionId: psId,
                        courseName: item.package_name,
                        sessionName: item.session_name ?? '',
                        levelName: item.package_session_name || item.level_name,
                        enrollInviteId: null,
                        accessDays: null,
                    },
                ]);
            }
        },
        [isSelected, selectedPackageSessions, onSelectedPackageSessionsChange]
    );

    const activeFilterCount =
        selectedLevelIds.length + selectedSessionIds.length + selectedTags.length;

    const clearFilters = () => {
        setSelectedLevelIds([]);
        setSelectedSessionIds([]);
        setSelectedTags([]);
    };

    const isDropdownLoading = isLevelsLoading || isSessionsLoading;

    return (
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
            {selectedPackageSessions.length > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-sm text-primary-700">
                    <span className="font-semibold">{selectedPackageSessions.length}</span>{' '}
                    {t('summary.selectedBanner', {
                        term: (selectedPackageSessions.length !== 1
                            ? batchesTerm
                            : batchTerm
                        ).toLowerCase(),
                        learners: learnersTerm.toLowerCase(),
                    })}
                </div>
            )}

            {/* Search on its own row on mobile, inline on sm+ */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative w-full sm:flex-1">
                    <MagnifyingGlass
                        size={15}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                    />
                    <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('search.placeholder', {
                            coursesTerm: coursesTerm.toLowerCase(),
                            levelsTerm: levelsTerm.toLowerCase(),
                        })}
                        className="h-9 w-full pl-9 text-sm"
                    />
                </div>

                {/* Filter dropdowns — 2-col grid below search on mobile, inline on sm+ */}
                <div
                    className={cn(
                        'grid w-full gap-2 sm:flex sm:w-auto sm:items-center',
                        tagOptions.length > 0 ? 'grid-cols-3' : 'grid-cols-2'
                    )}
                >
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className={cn(
                                'h-9 w-full justify-center gap-1.5 text-xs font-medium sm:w-auto',
                                selectedLevelIds.length > 0 &&
                                    'border-primary-300 bg-primary-50 text-primary-700'
                            )}
                        >
                            <FunnelSimple size={13} />
                            {levelTerm}
                            {selectedLevelIds.length > 0 && (
                                <Badge className="ml-0.5 h-4 min-w-4 rounded-full px-1 py-0 text-caption leading-none">
                                    {selectedLevelIds.length}
                                </Badge>
                            )}
                            <CaretDown size={11} className="text-neutral-400" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="z-popover-above-modal max-h-60 w-48 overflow-y-auto">
                        <DropdownMenuLabel className="text-xs text-neutral-500">
                            {t('filters.filterBy', { term: levelTerm })}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {isDropdownLoading ? (
                            <div className="space-y-1 p-2">
                                <Skeleton className="h-5 w-full" />
                                <Skeleton className="h-5 w-3/4" />
                            </div>
                        ) : levelOptions.length === 0 ? (
                            <p className="px-2 py-1 text-xs text-neutral-400">
                                {t('filters.noneFound', { term: levelsTerm.toLowerCase() })}
                            </p>
                        ) : (
                            levelOptions.map((lvl) => (
                                <DropdownMenuCheckboxItem
                                    key={lvl.id}
                                    checked={selectedLevelIds.includes(lvl.id)}
                                    onCheckedChange={(checked) =>
                                        setSelectedLevelIds((prev) =>
                                            checked
                                                ? [...prev, lvl.id]
                                                : prev.filter((id) => id !== lvl.id)
                                        )
                                    }
                                    className="text-xs"
                                >
                                    {lvl.level_name}
                                </DropdownMenuCheckboxItem>
                            ))
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className={cn(
                                'h-9 w-full justify-center gap-1.5 text-xs font-medium sm:w-auto',
                                selectedSessionIds.length > 0 &&
                                    'border-primary-300 bg-primary-50 text-primary-700'
                            )}
                        >
                            <FunnelSimple size={13} />
                            {sessionTerm}
                            {selectedSessionIds.length > 0 && (
                                <Badge className="ml-0.5 h-4 min-w-4 rounded-full px-1 py-0 text-caption leading-none">
                                    {selectedSessionIds.length}
                                </Badge>
                            )}
                            <CaretDown size={11} className="text-neutral-400" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="z-popover-above-modal max-h-60 w-48 overflow-y-auto">
                        <DropdownMenuLabel className="text-xs text-neutral-500">
                            {t('filters.filterBy', { term: sessionTerm })}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {isDropdownLoading ? (
                            <div className="space-y-1 p-2">
                                <Skeleton className="h-5 w-full" />
                                <Skeleton className="h-5 w-3/4" />
                            </div>
                        ) : sessionOptions.length === 0 ? (
                            <p className="px-2 py-1 text-xs text-neutral-400">
                                {t('filters.noneFound', { term: sessionsTerm.toLowerCase() })}
                            </p>
                        ) : (
                            sessionOptions.map((ses) => (
                                <DropdownMenuCheckboxItem
                                    key={ses.id}
                                    checked={selectedSessionIds.includes(ses.id)}
                                    onCheckedChange={(checked) =>
                                        setSelectedSessionIds((prev) =>
                                            checked
                                                ? [...prev, ses.id]
                                                : prev.filter((id) => id !== ses.id)
                                        )
                                    }
                                    className="text-xs"
                                >
                                    {ses.session_name}
                                </DropdownMenuCheckboxItem>
                            ))
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Tags come from the institute's course tags; hidden when no course has one. */}
                {tagOptions.length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className={cn(
                                    'h-9 w-full justify-center gap-1.5 text-xs font-medium sm:w-auto',
                                    selectedTags.length > 0 &&
                                        'border-primary-300 bg-primary-50 text-primary-700'
                                )}
                            >
                                <Tag size={13} />
                                <span className="truncate">{tagTerm}</span>
                                {selectedTags.length > 0 && (
                                    <Badge className="ml-0.5 h-4 min-w-4 rounded-full px-1 py-0 text-caption leading-none">
                                        {selectedTags.length}
                                    </Badge>
                                )}
                                <CaretDown size={11} className="text-neutral-400" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            className="z-popover-above-modal max-h-60 w-56 overflow-y-auto"
                        >
                            <DropdownMenuLabel className="text-xs text-neutral-500">
                                {t('filters.filterBy', { term: tagTerm })}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {tagOptions.map((tagValue) => (
                                <DropdownMenuCheckboxItem
                                    key={tagValue}
                                    checked={selectedTags.includes(tagValue)}
                                    onCheckedChange={(checked) =>
                                        setSelectedTags((prev) =>
                                            checked
                                                ? [...prev, tagValue]
                                                : prev.filter((x) => x !== tagValue)
                                        )
                                    }
                                    onSelect={(e) => e.preventDefault()}
                                    className="text-xs"
                                >
                                    {tagValue}
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
                </div>
            </div>

            {activeFilterCount > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {selectedLevelIds.map((id) => {
                        const lvl = levelOptions.find((l) => l.id === id);
                        return (
                            <span
                                key={id}
                                className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
                            >
                                {t('filters.tagLabel', {
                                    term: levelTerm,
                                    value: lvl?.level_name ?? id,
                                })}
                                <button
                                    onClick={() =>
                                        setSelectedLevelIds((prev) =>
                                            prev.filter((x) => x !== id)
                                        )
                                    }
                                    className="ml-0.5 rounded-full hover:text-primary-900"
                                >
                                    <X size={11} />
                                </button>
                            </span>
                        );
                    })}
                    {selectedSessionIds.map((id) => {
                        const ses = sessionOptions.find((s) => s.id === id);
                        return (
                            <span
                                key={id}
                                className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700"
                            >
                                {t('filters.tagLabel', {
                                    term: sessionTerm,
                                    value: ses?.session_name ?? id,
                                })}
                                <button
                                    onClick={() =>
                                        setSelectedSessionIds((prev) =>
                                            prev.filter((x) => x !== id)
                                        )
                                    }
                                    className="ml-0.5 rounded-full hover:text-violet-900"
                                >
                                    <X size={11} />
                                </button>
                            </span>
                        );
                    })}
                    {selectedTags.map((tagValue) => (
                        <span
                            key={tagValue}
                            className="inline-flex items-center gap-1 rounded-full border border-warning-200 bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700"
                        >
                            {t('filters.tagLabel', { term: tagTerm, value: tagValue })}
                            <button
                                onClick={() =>
                                    setSelectedTags((prev) => prev.filter((x) => x !== tagValue))
                                }
                                className="ml-0.5 rounded-full hover:text-warning-600"
                            >
                                <X size={11} />
                            </button>
                        </span>
                    ))}
                    <button
                        onClick={clearFilters}
                        className="text-xs text-neutral-400 underline-offset-2 hover:text-neutral-600 hover:underline"
                    >
                        {t('filters.clearAll')}
                    </button>
                </div>
            )}

            {isError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <Warning size={16} weight="fill" className="shrink-0" />
                    <span>
                        {t('errors.failedToLoad', { term: coursesTerm.toLowerCase() })}{' '}
                        {error instanceof Error ? error.message : t('errors.tryAgain')}
                    </span>
                </div>
            )}

            <div className="flex flex-col gap-3">
                {isCoursesLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="rounded-lg border border-neutral-200 bg-white">
                            <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3">
                                <Skeleton className="size-4 rounded" />
                                <Skeleton className="h-4 w-40" />
                            </div>
                            <div className="space-y-2 px-4 py-3">
                                <Skeleton className="h-9 w-full" />
                                <Skeleton className="h-9 w-full" />
                            </div>
                        </div>
                    ))
                ) : groups.length === 0 && !isError ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <BookOpen
                            size={36}
                            className="mb-3 text-neutral-300"
                            weight="duotone"
                        />
                        <p className="text-sm font-medium text-neutral-500">
                            {t('list.empty.title', { term: coursesTerm.toLowerCase() })}
                        </p>
                        <p className="mt-1 text-xs text-neutral-400">
                            {t('list.empty.subtitle')}
                        </p>
                    </div>
                ) : (
                    groups.map((group) => (
                        <div
                            key={group.id}
                            className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm"
                        >
                            <div className="flex items-center gap-2.5 border-b border-neutral-100 bg-neutral-50 px-4 py-2.5">
                                <BookOpen
                                    size={15}
                                    className="shrink-0 text-primary-500"
                                    weight="duotone"
                                />
                                <span className="text-sm font-semibold leading-tight text-neutral-800">
                                    {group.packageName}
                                </span>
                                <span className="ml-auto text-xs text-neutral-400">
                                    {t('list.batchCount', {
                                        count: group.batches.length,
                                        term: (group.batches.length !== 1
                                            ? batchesTerm
                                            : batchTerm
                                        ).toLowerCase(),
                                    })}
                                </span>
                            </div>

                            <div className="divide-y divide-neutral-50">
                                {group.batches.map((batch) => {
                                    const selected = isSelected(batch.package_session_id);
                                    return (
                                        <button
                                            key={batch.package_session_id}
                                            onClick={() => toggle(batch)}
                                            className={cn(
                                                'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-primary-50/60',
                                                selected && 'bg-primary-50'
                                            )}
                                        >
                                            <Checkbox
                                                checked={selected}
                                                onCheckedChange={() => toggle(batch)}
                                                className="pointer-events-none shrink-0"
                                            />
                                            {/* The batch's own name leads when it has one.
                                                Institutes that never set up levels or sessions
                                                leave every batch on "default · DEFAULT", which
                                                made six batches of one course indistinguishable
                                                even though each carried a real name. */}
                                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                                <span className="truncate text-xs font-medium text-neutral-700">
                                                    {batchLabel(batch) || batch.level_name}
                                                </span>
                                                {batchLabel(batch) ? (
                                                    <span className="truncate text-xs text-neutral-400">
                                                        {[batch.level_name, batch.session_name]
                                                            .filter(Boolean)
                                                            .join(' · ')}
                                                    </span>
                                                ) : (
                                                    batch.session_name && (
                                                        <>
                                                            <span className="text-neutral-300">
                                                                ·
                                                            </span>
                                                            <span className="truncate text-xs text-neutral-500">
                                                                {batch.session_name}
                                                            </span>
                                                        </>
                                                    )
                                                )}
                                            </div>
                                            <span
                                                className={cn(
                                                    'shrink-0 text-xs font-medium',
                                                    selected
                                                        ? 'text-primary-600'
                                                        : 'text-neutral-300'
                                                )}
                                            >
                                                {selected ? '✓' : '+'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3">
                    <span className="text-xs text-neutral-400">
                        {t('pagination.showingRange', {
                            from: page * PAGE_SIZE + 1,
                            to: Math.min((page + 1) * PAGE_SIZE, totalElements),
                            total: totalElements,
                        })}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={page === 0}
                            onClick={() => setPage((p) => p - 1)}
                        >
                            <CaretLeft size={13} />
                        </Button>
                        <span className="px-2 text-xs text-neutral-600">
                            {t('pagination.pageOf', { current: page + 1, total: totalPages })}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={page >= totalPages - 1}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            <CaretRight size={13} />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};
