'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import type * as z from 'zod';
import { useTranslation } from 'react-i18next';
import { CircleNotch, MagnifyingGlass, X } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchPaginatedBatches } from '@/routes/admin-package-management/-services/package-service';
import type { PackageSessionDTO } from '@/routes/admin-package-management/-types/package-types';
import { fetchCourseStudyLibraryDetails } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import { MultiSelect } from '@/components/design-system/multi-select';
import type { inviteUsersSchema } from './InviteUsersComponent';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const PAGE_SIZE = 10;

interface SubjectOption {
    label: string;
    value: string;
}

interface BatchSubjectFormProps {
    initialBatchId?: string;
    courseId?: string;
}

export default function BatchSubjectForm({ initialBatchId, courseId }: BatchSubjectFormProps) {
    const { t } = useTranslation('dashboardBatchAndSubjectSelection');
    const form = useFormContext<z.infer<typeof inviteUsersSchema>>();

    const [batchSearch, setBatchSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Debounce search input by 300ms before firing the API
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(batchSearch), 300);
        return () => clearTimeout(timer);
    }, [batchSearch]);

    // When inside a course, pre-filter by packageId so only that course's batches
    // load by default. Once the user types a search, drop the filter so they can
    // pick any batch across the institute.
    const activePackageId = debouncedSearch ? undefined : courseId;

    const {
        data,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: ['paginatedBatchesForTeacher', debouncedSearch, activePackageId],
        queryFn: ({ pageParam = 0 }) =>
            fetchPaginatedBatches({
                page: pageParam,
                size: PAGE_SIZE,
                sortBy: 'created_at',
                sortDirection: 'DESC',
                statuses: ['ACTIVE'],
                search: debouncedSearch || undefined,
                packageId: activePackageId,
            }),
        getNextPageParam: (lastPage) =>
            lastPage.has_next ? lastPage.page_number + 1 : undefined,
        initialPageParam: 0,
        staleTime: 5 * 60 * 1000, // batch list doesn't change frequently; skip background refetches
    });

    // Flatten all pages into a stable list (only changes when data changes)
    const allBatchItems: PackageSessionDTO[] = useMemo(
        () => data?.pages?.flatMap((page) => page.content) ?? [],
        [data]
    );

    // Infinite scroll observer
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (isFetchingNextPage) return;
            if (observerRef.current) observerRef.current.disconnect();
            observerRef.current = new IntersectionObserver((entries) => {
                if (entries[0]?.isIntersecting && hasNextPage) {
                    fetchNextPage();
                }
            });
            if (node) observerRef.current.observe(node);
        },
        [isFetchingNextPage, hasNextPage, fetchNextPage]
    );

    // State to track which batches are selected via checkbox
    const [selectedBatches, setSelectedBatches] = useState<string[]>(
        initialBatchId ? [initialBatchId] : []
    );
    // State to track subject selections for each batch
    const [subjectSelections, setSubjectSelections] = useState<Record<string, string[]>>({});
    // Cache of fetched subjects keyed by courseId_sessionId_levelId
    const [subjectsCache, setSubjectsCache] = useState<Record<string, SubjectOption[]>>({});
    const [loadingSubjects, setLoadingSubjects] = useState<Record<string, boolean>>({});

    // Track which courseIds have already been fetched or are in-flight (stable ref, no re-renders)
    const fetchedCourseIdsRef = useRef<Set<string>>(new Set());

    // Get batches from the paginated API
    const batches = useMemo(
        () =>
            allBatchItems.map((batch) => ({
                id: batch.id,
                name:
                    batch.level.id === 'DEFAULT'
                        ? `${batch.package_dto.package_name.replace(/^default\s+/i, '')}, ${batch.session.session_name}`.trim()
                        : `${batch.level.level_name.replace(/^default\s+/i, '')} ${batch.package_dto.package_name.replace(/^default\s+/i, '')}, ${batch.session.session_name}`.trim(),
            })),
        [allBatchItems]
    );

    // Keep the initial batch at the top of the list
    const sortedBatches = useMemo(() => {
        if (!initialBatchId || debouncedSearch) return batches;
        const initialIdx = batches.findIndex((b) => b.id === initialBatchId);
        if (initialIdx <= 0) return batches;
        return [batches[initialIdx]!, ...batches.slice(0, initialIdx), ...batches.slice(initialIdx + 1)];
    }, [batches, initialBatchId, debouncedSearch]);

    // Fetch subjects for a batch's course when selected
    const fetchSubjectsForBatch = useCallback(
        async (batch: PackageSessionDTO) => {
            const courseId = batch.package_dto.id;

            // Already fetched or in-flight for this course — skip
            if (fetchedCourseIdsRef.current.has(courseId)) return;
            fetchedCourseIdsRef.current.add(courseId);

            setLoadingSubjects((prev) => ({ ...prev, [batch.id]: true }));
            try {
                const courseData = await fetchCourseStudyLibraryDetails(courseId);
                const course = Array.isArray(courseData)
                    ? courseData.find((c: { course: { id: string } }) => c.course.id === courseId)
                    : courseData;

                if (!course) return;

                // Extract subjects for all session+level combos and cache them
                const newEntries: Record<string, SubjectOption[]> = {};
                for (const session of course.sessions || []) {
                    for (const level of session.level_with_details || []) {
                        const key = `${courseId}_${session.session_dto.id}_${level.id}`;
                        newEntries[key] = (level.subjects || []).map(
                            (s: { id: string; subject_name: string }) => ({
                                label: s.subject_name,
                                value: s.id,
                            })
                        );
                    }
                }
                setSubjectsCache((prev) => ({ ...prev, ...newEntries }));
            } catch {
                // Allow retry on failure
                fetchedCourseIdsRef.current.delete(courseId);
            } finally {
                setLoadingSubjects((prev) => ({ ...prev, [batch.id]: false }));
            }
        },
        [] // no reactive deps — uses ref for dedup
    );

    // Pre-compute subject options for all selected batches — avoids find() on every render
    const subjectsByBatchId = useMemo(() => {
        const map: Record<string, SubjectOption[]> = {};
        for (const batchId of selectedBatches) {
            const batch = allBatchItems.find((b) => b.id === batchId);
            if (!batch) continue;
            const key = `${batch.package_dto.id}_${batch.session.id}_${batch.level.id}`;
            map[batchId] = subjectsCache[key] || [];
        }
        return map;
    }, [selectedBatches, allBatchItems, subjectsCache]);

    // Fetch subjects when a batch is selected
    useEffect(() => {
        for (const batchId of selectedBatches) {
            const batch = allBatchItems.find((b) => b.id === batchId);
            if (!batch) continue;
            fetchSubjectsForBatch(batch);
        }
    }, [selectedBatches, allBatchItems, fetchSubjectsForBatch]);

    // Toggle batch selection
    const toggleBatchSelection = (batchId: string) => {
        setSelectedBatches((prev) => {
            if (prev.includes(batchId)) {
                const newSelected = prev.filter((id) => id !== batchId);
                const newSubjectSelections = { ...subjectSelections };
                delete newSubjectSelections[batchId];
                setSubjectSelections(newSubjectSelections);
                return newSelected;
            } else {
                return [...prev, batchId];
            }
        });
    };

    // Handle subject selection change
    const handleSubjectChange = (batchId: string, subjects: string[]) => {
        setSubjectSelections((prev) => ({
            ...prev,
            [batchId]: subjects,
        }));
    };

    // Update form values when selections change
    useEffect(() => {
        const mappings = selectedBatches.map((batchId) => ({
            batchId,
            subjectIds: subjectSelections[batchId] || [],
        }));

        form.setValue('batch_subject_mappings', mappings.length > 0 ? mappings : []);
    }, [selectedBatches, subjectSelections, form]);

    if (isLoading) {
        return <CircleNotch className="size-6 animate-spin text-primary-500" />;
    }

    return (
        <Card className="w-full">
            <CardHeader className="px-2 py-4">
                <CardTitle>
                    {t('title', {
                        subjectPlural: getTerminologyPlural(
                            ContentTerms.Subject,
                            SystemTerms.Subject
                        ),
                    })}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-2">
                {/* Batch search */}
                <div className="relative">
                    <MagnifyingGlass className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" />
                    <input
                        type="text"
                        placeholder={t('searchBatchesPlaceholder')}
                        value={batchSearch}
                        onChange={(e) => setBatchSearch(e.target.value)}
                        className="w-full rounded-md border border-neutral-200 py-2 pl-8 pr-8 text-sm outline-none transition-colors focus:border-primary-400"
                    />
                    {batchSearch && (
                        <button
                            type="button"
                            onClick={() => setBatchSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                        >
                            <X className="size-3.5" />
                        </button>
                    )}
                </div>

                <div className="space-y-4">
                    {sortedBatches.map((batch) => (
                        <div key={batch.id} className="space-y-2">
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id={`batch-${batch.id}`}
                                    checked={selectedBatches.includes(batch.id)}
                                    onCheckedChange={() => toggleBatchSelection(batch.id)}
                                    className="size-5 border-2 data-[state=checked]:border-primary-500 data-[state=checked]:bg-primary-500"
                                />
                                <label
                                    htmlFor={`batch-${batch.id}`}
                                    className="text-base font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                    {batch.name}
                                </label>
                            </div>

                            {selectedBatches.includes(batch.id) && (
                                <div className="ml-7">
                                    {loadingSubjects[batch.id] ? (
                                        <CircleNotch className="size-4 animate-spin text-primary-500" />
                                    ) : (
                                        <FormField
                                            control={form.control}
                                            // @ts-expect-error  : type error
                                            name={`subject-${batch.id}`}
                                            render={() => (
                                                <FormItem>
                                                    <FormLabel className="text-primary-500">
                                                        {t('selectSubjectsLabel')}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <MultiSelect
                                                            selected={subjectSelections[batch.id] || []}
                                                            options={subjectsByBatchId[batch.id] || []}
                                                            onChange={(selected) =>
                                                                handleSubjectChange(batch.id, selected)
                                                            }
                                                            placeholder={t('selectSubjectsPlaceholder')}
                                                            className="mt-1"
                                                        />
                                                    </FormControl>
                                                    <FormDescription className="mt-1">
                                                        {t('selectSubjectsDescription')}
                                                    </FormDescription>
                                                    {subjectSelections[batch.id]?.length === 0 && (
                                                        <FormMessage>
                                                            {t('subjectRequiredError')}
                                                        </FormMessage>
                                                    )}
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Infinite scroll sentinel */}
                {hasNextPage && (
                    <div ref={loadMoreRef} className="flex justify-center py-2">
                        {isFetchingNextPage && (
                            <CircleNotch className="size-5 animate-spin text-primary-500" />
                        )}
                    </div>
                )}

                {sortedBatches.length === 0 && !isLoading && (
                    <div className="py-4 text-center text-muted-foreground">
                        {debouncedSearch ? t('noMatchingBatches') : t('noBatchesAvailable')}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
