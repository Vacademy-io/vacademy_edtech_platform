import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CaretLeft, CaretRight, MagnifyingGlass, UsersThree, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Checkbox } from '@/components/ui/checkbox';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { reportApiError } from '@/lib/report-api-error';
import { cn } from '@/lib/utils';
import { fetchAllMatchingStudents, searchStudents } from '../-services/mentorship-service';
import {
    batchLabelMap,
    buildBatchOptions,
    MAX_BULK_SELECT,
    mergeSelection,
    PICKER_PAGE_SIZE,
    pageSelectionState,
    removeSelection,
    SELECT_ALL_PAGE_SIZE,
    selectAllAffordance,
    studentLabel,
    type PickerBatch,
} from '../-utils/mentee-picker';
import type { StudentRow } from '../-types/mentorship-types';

interface MenteePickerProps {
    instituteId: string;
    selected: StudentRow[];
    onChange: (rows: StudentRow[]) => void;
    /**
     * Only one student can be chosen (booking a 1:1). Picking a second replaces
     * the first, and the bulk controls are hidden — "Select all 45 matching" in a
     * dialog that books one learner is an offer the screen can't honour.
     */
    singleSelect?: boolean;
}

/**
 * Pick the students to assign: browse a batch, or search by name, and take them
 * in bulk.
 *
 * It lists on open rather than waiting for a search term. Assigning a mentor is a
 * roster job — an admin arrives wanting "everyone in Class 10", not one student
 * whose name they already know — and the search-only version made bulk assignment
 * look impossible: an empty box that said "Type a name to search students", then
 * one click per student, with no way to see who was already picked once the
 * results moved on.
 */
export function MenteePicker({
    instituteId,
    selected,
    onChange,
    singleSelect = false,
}: MenteePickerProps) {
    const { t } = useTranslation('mentorshipMenteePicker');
    const [query, setQuery] = useState('');
    const [debounced, setDebounced] = useState('');
    const [batchIds, setBatchIds] = useState<string[]>([]);
    const [page, setPage] = useState(0);
    const [selectingAll, setSelectingAll] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(query), 300);
        return () => clearTimeout(timer);
    }, [query]);

    // Narrowing the filter shortens the list, so page 4 of the old result set is
    // usually past the end of the new one — an empty table that reads as "no
    // students in this batch".
    useEffect(() => {
        setPage(0);
    }, [debounced, batchIds]);

    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const batchOptions = useMemo(
        () =>
            buildBatchOptions(instituteDetails?.batches_for_sessions as PickerBatch[] | undefined),
        [instituteDetails]
    );
    const batchLabels = useMemo(() => batchLabelMap(batchOptions), [batchOptions]);

    const { data, isLoading, isFetching, isError, refetch } = useQuery({
        queryKey: ['mentorship-student-search', instituteId, debounced, batchIds, page],
        queryFn: () =>
            searchStudents({
                instituteId,
                name: debounced,
                packageSessionIds: batchIds,
                pageNo: page,
                pageSize: PICKER_PAGE_SIZE,
            }),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
        // Without this the list blanks to the skeleton on every page turn, so the
        // checkboxes an admin is working through jump under the cursor.
        placeholderData: keepPreviousData,
    });

    const results = data?.content ?? [];
    const totalMatching = data?.total_elements ?? 0;
    const totalPages = data?.total_pages ?? 1;
    const selectedIds = useMemo(() => new Set(selected.map((s) => s.user_id)), [selected]);
    const pageState = pageSelectionState(selected, results);
    const selectAll = selectAllAffordance(totalMatching);
    const filtered = !!debounced || batchIds.length > 0;

    const toggle = (row: StudentRow) => {
        if (selectedIds.has(row.user_id)) onChange(removeSelection(selected, [row]));
        else if (singleSelect) onChange([row]);
        else onChange(mergeSelection(selected, [row]));
    };

    const togglePage = () => {
        if (pageState === 'all') onChange(removeSelection(selected, results));
        else onChange(mergeSelection(selected, results));
    };

    const selectEveryMatch = async () => {
        setSelectingAll(true);
        try {
            const rows = await fetchAllMatchingStudents({
                instituteId,
                name: debounced,
                packageSessionIds: batchIds,
                limit: MAX_BULK_SELECT,
                pageSize: SELECT_ALL_PAGE_SIZE,
            });
            const next = mergeSelection(selected, rows);
            const added = next.length - selected.length;
            onChange(next);
            toast.success(
                added === 0
                    ? t('toast.allAlreadySelected')
                    : t('toast.selectedMore', { count: added })
            );
        } catch (error) {
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'select-all-students' },
                extra: { batchCount: batchIds.length, totalMatching },
                fallbackMessage: t('toast.selectAllFailed'),
            });
        } finally {
            setSelectingAll(false);
        }
    };

    const rangeStart = totalMatching === 0 ? 0 : page * PICKER_PAGE_SIZE + 1;
    const rangeEnd = Math.min(totalMatching, page * PICKER_PAGE_SIZE + results.length);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-72">
                    <MagnifyingGlass
                        size={16}
                        className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                    />
                    <MyInput
                        input={query}
                        onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setQuery(e.target.value)
                        }
                        inputType="text"
                        inputPlaceholder={t('searchPlaceholder')}
                        className="pl-9 sm:w-full"
                    />
                </div>
                {batchOptions.length > 0 && (
                    <MultiSelectFilter
                        label={t('batchFilter.label')}
                        icon={<UsersThree size={15} className="text-neutral-500" />}
                        options={batchOptions}
                        selected={batchIds}
                        onChange={setBatchIds}
                        placeholder={t('batchFilter.placeholder')}
                        widthClass="w-56"
                    />
                )}
            </div>

            {/* Selection summary — visible whatever the filter shows, so students
                picked from an earlier batch don't silently vanish from view. */}
            {selected.length > 0 && (
                <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-caption font-medium text-neutral-700">
                            {t('selectedSummary.count', { count: selected.length })}
                        </span>
                        <button
                            type="button"
                            className="text-caption font-medium text-neutral-500 hover:text-neutral-700"
                            onClick={() => onChange([])}
                        >
                            {t('selectedSummary.clearAll')}
                        </button>
                    </div>
                    <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                        {selected.slice(0, 40).map((row) => (
                            <span
                                key={row.user_id}
                                className="flex max-w-xs items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-caption text-neutral-600"
                            >
                                <span className="truncate">{studentLabel(row)}</span>
                                <button
                                    type="button"
                                    onClick={() => onChange(removeSelection(selected, [row]))}
                                    aria-label={t('selectedSummary.removeAria', {
                                        name: studentLabel(row),
                                    })}
                                    className="shrink-0 text-neutral-400 hover:text-danger-600"
                                >
                                    <X size={11} weight="bold" />
                                </button>
                            </span>
                        ))}
                        {selected.length > 40 && (
                            <span className="px-1 py-0.5 text-caption text-neutral-500">
                                {t('selectedSummary.more', { count: selected.length - 40 })}
                            </span>
                        )}
                    </div>
                </div>
            )}

            <div className="rounded-md border border-neutral-200">
                {!singleSelect && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
                        <label className="flex cursor-pointer items-center gap-2">
                            <Checkbox
                                checked={pageState === 'all'}
                                onCheckedChange={togglePage}
                                disabled={results.length === 0}
                                aria-label={t('pageSelection.selectAllAria')}
                            />
                            <span className="text-caption text-neutral-600">
                                {results.length > 0
                                    ? t(
                                          pageState === 'all'
                                              ? 'pageSelection.deselectAllCount'
                                              : 'pageSelection.selectAllCount',
                                          { count: results.length }
                                      )
                                    : t(
                                          pageState === 'all'
                                              ? 'pageSelection.deselectAll'
                                              : 'pageSelection.selectAll'
                                      )}
                            </span>
                        </label>
                        {selectAll.available && totalMatching > results.length && (
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                onClick={selectEveryMatch}
                                disable={selectingAll}
                            >
                                {selectingAll
                                    ? t('selectAllMatching.selecting')
                                    : t('selectAllMatching.button', { count: totalMatching })}
                            </MyButton>
                        )}
                        {selectAll.blocked && (
                            <span className="text-caption text-neutral-500">
                                {t('selectAllMatching.blocked', {
                                    count: totalMatching,
                                    max: MAX_BULK_SELECT,
                                })}
                            </span>
                        )}
                    </div>
                )}

                <div className="max-h-72 overflow-y-auto">
                    {isLoading ? (
                        <div className="p-4 text-body text-neutral-400">
                            {t('results.loading')}
                        </div>
                    ) : isError ? (
                        <div className="flex flex-col items-start gap-2 p-4">
                            <span className="text-body text-danger-600">
                                {t('results.loadError')}
                            </span>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => refetch()}
                            >
                                {t('results.retry')}
                            </MyButton>
                        </div>
                    ) : results.length === 0 ? (
                        <div className="p-4 text-body text-neutral-400">
                            {filtered
                                ? t('results.emptyFiltered')
                                : t('results.emptyAll')}
                        </div>
                    ) : (
                        results.map((row) => {
                            const isSel = selectedIds.has(row.user_id);
                            const batch = row.package_session_id
                                ? batchLabels[row.package_session_id]
                                : undefined;
                            // Plenty of learners are enrolled with a phone and no email.
                            const caption = [row.email || row.mobile_number, batch]
                                .filter(Boolean)
                                .join(' · ');
                            return (
                                <label
                                    key={row.user_id}
                                    className={cn(
                                        'flex cursor-pointer items-center gap-3 border-b border-neutral-100 px-3 py-2 last:border-b-0 hover:bg-neutral-50',
                                        isSel && 'bg-primary-50'
                                    )}
                                >
                                    <Checkbox
                                        checked={isSel}
                                        onCheckedChange={() => toggle(row)}
                                        aria-label={t('results.selectRowAria', {
                                            name: studentLabel(row),
                                        })}
                                    />
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate text-body text-neutral-700">
                                            {studentLabel(row)}
                                        </span>
                                        {caption && (
                                            <span className="truncate text-caption text-neutral-400">
                                                {caption}
                                            </span>
                                        )}
                                    </span>
                                </label>
                            );
                        })
                    )}
                </div>

                {totalMatching > 0 && (
                    <div className="flex items-center justify-between gap-2 border-t border-neutral-200 px-3 py-2">
                        <span className="text-caption text-neutral-500">
                            {t('pagination.range', { start: rangeStart, end: rangeEnd, total: totalMatching })}
                            {isFetching && !isLoading ? ` · ${t('pagination.updating')}` : ''}
                        </span>
                        {totalPages > 1 && (
                            <span className="flex items-center gap-1">
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    layoutVariant="icon"
                                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                                    disable={page === 0}
                                    aria-label={t('pagination.previousAria')}
                                >
                                    <CaretLeft size={14} />
                                </MyButton>
                                <span className="text-caption text-neutral-500">
                                    {t('pagination.pageOf', { page: page + 1, total: totalPages })}
                                </span>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    layoutVariant="icon"
                                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                                    disable={page >= totalPages - 1}
                                    aria-label={t('pagination.nextAria')}
                                >
                                    <CaretRight size={14} />
                                </MyButton>
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
