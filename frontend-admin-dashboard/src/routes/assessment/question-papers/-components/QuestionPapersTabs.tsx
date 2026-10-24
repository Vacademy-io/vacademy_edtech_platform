import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CaretDown, Check, SortAscending, WarningCircle } from '@phosphor-icons/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TabListComponent } from './TabListComponent';
import { QuestionPapersFilter } from './QuestionPapersFilter';
import { QuestionPapersSearchComponent } from './QuestionPapersSearchComponent';
import { EmptyQuestionPapers } from '@/svgs';
import { QuestionPapersList } from './QuestionPapersList';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { FilterOption } from '@/types/assessments/question-paper-filter';
import { MyButton } from '@/components/design-system/button';
import {
    getQuestionPaperDataWithFilters,
    getQuestionTagsQuery,
} from '../-utils/question-paper-services';
import {
    PAPER_SORT_COLUMNS,
    PAPER_SORTS,
    PaperSort,
    QUESTION_PAPER_STATS_KEY,
    statusesForTab,
    useQuestionPaperStats,
} from '../-utils/question-paper-list';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useRefetchStore } from '../-global-states/refetch-store';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useFilterDataForAssesment } from '../../assessment-list/-utils.ts/useFiltersData';
import { z } from 'zod';
import sectionDetailsSchema from '../../create-assessment/$assessmentId/$examtype/-utils/section-details-schema';
import { UseFormReturn } from 'react-hook-form';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { AssignmentFormType } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-form-schemas/assignmentFormSchema';
import { useAddPaperWays } from './AddQuestionPaperFlow';
import { useAddPaperFlowStore } from '../-global-states/add-paper-flow-store';

export type SectionFormType = z.infer<typeof sectionDetailsSchema>;

interface QuestionPapersTabsProps {
    isAssessment: boolean; // Flag to determine if it's an assessment
    index?: number;
    sectionsForm?: UseFormReturn<SectionFormType>;
    studyLibraryAssignmentForm?: UseFormReturn<AssignmentFormType>;
    isStudyLibraryAssignment?: boolean;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
    examType?: string; // Add exam type prop
    onManualSelectionReady?: (
        questions: import('@/types/assessments/question-paper-form').MyQuestion[]
    ) => void;
}

export const QuestionPapersTabs = ({
    isAssessment,
    index,
    sectionsForm,
    studyLibraryAssignmentForm,
    isStudyLibraryAssignment,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    examType,
    onManualSelectionReady,
}: QuestionPapersTabsProps) => {
    const { t } = useTranslation('assessmentQuestionPapersTabs');
    const { t: tPage } = useTranslation('assessmentQuestionPapersPage');
    // The Question Papers page itself (not the "pick a saved paper" pickers inside
    // assessment / homework / assignment creation, which all pass isAssessment).
    const isPage = !isAssessment;
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
    const queryClient = useQueryClient();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const [selectedTab, setSelectedTab] = useState('ACTIVE');
    const [selectedQuestionPaperFilters, setSelectedQuestionPaperFilters] = useState<
        Record<string, FilterOption[]>
    >({});
    const [searchText, setSearchText] = useState('');
    // The search that is actually applied (searchText is only what is typed).
    const [activeSearch, setActiveSearch] = useState('');
    const [pageNo, setPageNo] = useState(0);
    const [sortOrder, setSortOrder] = useState<PaperSort>('NEWEST');
    // Read by fetches fired in the same tick as a sort change, before state settles.
    const sortRef = useRef<PaperSort>('NEWEST');
    const [questionPaperList, setQuestionPaperList] = useState(null);
    const [questionPaperFavouriteList, setQuestionPaperFavouriteList] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    // A failed fetch used to render the same "No question papers available" screen as a
    // genuinely empty bank, which reads as "there is nothing here" and sends the user off
    // to create a duplicate.
    const [loadError, setLoadError] = useState<string | null>(null);
    const addPaperWays = useAddPaperWays();
    const pickWay = useAddPaperFlowStore((s) => s.pickWay);
    const { data: stats } = useQuestionPaperStats(isPage ? INSTITUTE_ID : undefined);

    const reportPaperListError = useCallback((error: unknown) => {
        console.error(error);
        const message =
            (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
            'Could not load question papers. Please try again.';
        setLoadError(message);
        toast.error(message);
    }, []);
    const setHandleRefetchData = useRefetchStore((state) => state.setHandleRefetchData);
    const setHandleShowNewest = useRefetchStore((state) => state.setHandleShowNewest);

    const { YearClassFilterData, SubjectFilterData } = useFilterDataForAssesment(instituteDetails);

    const { data: questionTags } = useQuery(getQuestionTagsQuery(INSTITUTE_ID));
    const TagFilterData: FilterOption[] = (questionTags ?? []).map((tag) => ({
        id: tag.tag_id,
        name: tag.tag_name,
    }));

    const fetchPapers = (
        page: number,
        pageSize: number,
        instituteId: string | undefined,
        filters: Record<string, FilterOption[]>
    ) =>
        getQuestionPaperDataWithFilters(
            page,
            pageSize,
            instituteId,
            filters,
            PAPER_SORT_COLUMNS[sortRef.current]
        );

    const nameFilter = (search: string): Record<string, FilterOption[]> =>
        search ? { name: [{ id: search, name: search }] } : {};

    const getFilteredData = useMutation({
        mutationFn: ({
            pageNo,
            pageSize,
            instituteId,
            data,
        }: {
            pageNo: number;
            pageSize: number;
            instituteId: string | undefined;
            data: Record<string, FilterOption[]>;
        }) => fetchPapers(pageNo, pageSize, instituteId, data),
        onSuccess: (data) => {
            setLoadError(null);
            if (selectedTab === 'FAVOURITE') {
                setQuestionPaperFavouriteList(data);
            } else {
                setQuestionPaperList(data);
            }
        },
        onError: (error: unknown) => {
            // Was `throw error` inside a react-query callback: an unhandled rejection,
            // no toast, and the list silently rendered its empty state as if the
            // institute simply had no papers.
            reportPaperListError(error);
        },
    });

    const getFilteredFavouriteData = useMutation({
        mutationFn: ({
            pageNo,
            pageSize,
            instituteId,
            data,
        }: {
            pageNo: number;
            pageSize: number;
            instituteId: string | undefined;
            data: Record<string, FilterOption[]>;
        }) => fetchPapers(pageNo, pageSize, instituteId, data),
        onSuccess: (data) => {
            setQuestionPaperFavouriteList(data);
        },
        onError: (error: unknown) => {
            // Was `throw error` inside a react-query callback: an unhandled rejection,
            // no toast, and the list silently rendered its empty state as if the
            // institute simply had no papers.
            reportPaperListError(error);
        },
    });

    const getFilteredActiveData = useMutation({
        mutationFn: ({
            pageNo,
            pageSize,
            instituteId,
            data,
        }: {
            pageNo: number;
            pageSize: number;
            instituteId: string | undefined;
            data: Record<string, FilterOption[]>;
        }) => fetchPapers(pageNo, pageSize, instituteId, data),
        onSuccess: (data) => {
            setQuestionPaperList(data);
        },
        onError: (error: unknown) => {
            // Was `throw error` inside a react-query callback: an unhandled rejection,
            // no toast, and the list silently rendered its empty state as if the
            // institute simply had no papers.
            reportPaperListError(error);
        },
    });

    // Track which tabs have been loaded
    const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set());

    // Page: re-query the current tab from page 1 with the given filters/search, and
    // forget the other tab so switching to it fetches with the same settings.
    const reloadCurrentTab = (filters: Record<string, FilterOption[]>, search: string) => {
        setPageNo(0);
        setLoadedTabs(new Set([selectedTab]));
        getFilteredData.mutate({
            pageNo: 0,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                ...filters,
                ...nameFilter(search),
                statuses: statusesForTab(selectedTab),
            },
        });
    };

    const handleFilterChange = (filterKey: string, selectedItems: FilterOption[]) => {
        const updatedFilters = { ...selectedQuestionPaperFilters, [filterKey]: selectedItems };
        if (selectedItems.length === 0) {
            delete updatedFilters[filterKey]; // Remove empty filters
        }
        setSelectedQuestionPaperFilters(updatedFilters);
        if (isPage) {
            // Page: filters apply as they are picked, no separate Filter button.
            reloadCurrentTab(updatedFilters, activeSearch);
        } else if (Object.entries(updatedFilters).length === 0) {
            getFilteredData.mutate({
                pageNo: pageNo,
                pageSize: 10,
                instituteId: INSTITUTE_ID,
                data: { ...updatedFilters, statuses: statusesForTab(selectedTab) },
            });
        }
    };

    const handleResetFilters = () => {
        setSelectedQuestionPaperFilters({});
        setSearchText('');
        setActiveSearch('');
        if (isPage) {
            reloadCurrentTab({}, '');
            return;
        }
        getFilteredData.mutate({
            pageNo: pageNo,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                statuses: statusesForTab(selectedTab),
            },
        });
    };

    const clearSearch = () => {
        setSearchText('');
        delete selectedQuestionPaperFilters['name'];
        if (isPage && activeSearch) {
            setActiveSearch('');
            reloadCurrentTab(selectedQuestionPaperFilters, '');
        }
    };

    const handleSubmitFilters = () => {
        getFilteredData.mutate({
            pageNo: pageNo,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                ...selectedQuestionPaperFilters,
                statuses: statusesForTab(selectedTab),
            },
        });
    };

    const handleSortChange = (next: PaperSort) => {
        sortRef.current = next;
        setSortOrder(next);
        reloadCurrentTab(selectedQuestionPaperFilters, activeSearch);
    };

    const handlePageChange = (newPage: number) => {
        setPageNo(newPage);
        getFilteredData.mutate({
            pageNo: newPage,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                ...selectedQuestionPaperFilters,
                // The page keeps its search across pages; the pickers behave as before.
                ...(isPage ? nameFilter(activeSearch) : {}),
                statuses: statusesForTab(selectedTab),
            },
        });
    };

    // Registered once in the store, so it must always read the latest state: the old
    // version captured the filters and page of the first render.
    const refetchRef = useRef<() => void>(() => undefined);
    refetchRef.current = () => {
        const search = isPage ? nameFilter(activeSearch) : {};
        getFilteredFavouriteData.mutate({
            pageNo: 0,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                ...selectedQuestionPaperFilters,
                ...search,
                statuses: statusesForTab('FAVOURITE'),
            },
        });
        getFilteredActiveData.mutate({
            pageNo,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                ...selectedQuestionPaperFilters,
                ...search,
                statuses: statusesForTab('ACTIVE'),
            },
        });
        queryClient.invalidateQueries({ queryKey: [QUESTION_PAPER_STATS_KEY] });
    };

    // Page only: after a paper is added, show it — All tab, newest first, page 1, no filters.
    const showNewestRef = useRef<() => void>(() => undefined);
    showNewestRef.current = () => {
        sortRef.current = 'NEWEST';
        setSortOrder('NEWEST');
        setSelectedTab('ACTIVE');
        setPageNo(0);
        setSelectedQuestionPaperFilters({});
        setSearchText('');
        setActiveSearch('');
        setLoadedTabs(new Set(['ACTIVE', 'FAVOURITE']));
        getFilteredActiveData.mutate({
            pageNo: 0,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: { statuses: statusesForTab('ACTIVE') },
        });
        getFilteredFavouriteData.mutate({
            pageNo: 0,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: { statuses: statusesForTab('FAVOURITE') },
        });
    };

    useEffect(() => {
        setHandleRefetchData(() => refetchRef.current());
        if (isPage) setHandleShowNewest(() => showNewestRef.current());
        return () => {
            if (isPage) setHandleShowNewest(() => undefined);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setHandleRefetchData, setHandleShowNewest]);

    // Fetch data for a specific tab
    const fetchTabData = (tabValue: string) => {
        return fetchPapers(pageNo, 10, INSTITUTE_ID, {
            ...selectedQuestionPaperFilters,
            ...(isPage ? nameFilter(activeSearch) : {}),
            statuses: statusesForTab(tabValue),
        }).then((data) => {
            setLoadError(null);
            if (tabValue === 'FAVOURITE') {
                setQuestionPaperFavouriteList(data);
            } else {
                setQuestionPaperList(data);
            }
            setLoadedTabs((prev) => new Set([...prev, tabValue]));
        });
    };

    // Handle tab change with lazy loading
    const handleTabChangeWithLazyLoad = (value: string) => {
        setSelectedTab(value);

        // Only fetch if this tab hasn't been loaded yet
        if (!loadedTabs.has(value)) {
            setIsLoading(true);
            fetchTabData(value)
                .catch(reportPaperListError)
                .finally(() => setIsLoading(false));
        }
    };

    // Initial fetch - only load the ACTIVE tab (default selected)
    useEffect(() => {
        setIsLoading(true);
        fetchTabData('ACTIVE')
            .catch(reportPaperListError)
            .finally(() => setIsLoading(false));
    }, []);

    // Page: deleting the last paper on a later page leaves that page empty — go back one.
    const currentList = (
        selectedTab === 'FAVOURITE' ? questionPaperFavouriteList : questionPaperList
    ) as {
        content?: unknown[];
        total_elements?: number;
    } | null;
    useEffect(() => {
        if (
            isPage &&
            pageNo > 0 &&
            currentList &&
            (currentList.content?.length ?? 0) === 0 &&
            (currentList.total_elements ?? 0) > 0
        ) {
            handlePageChange(pageNo - 1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentList]);

    if (isLoading) return <DashboardLoader />;

    const hasFilters = Object.keys(selectedQuestionPaperFilters).length > 0 || !!activeSearch;
    const favouriteCount =
        stats?.favourites ??
        (questionPaperFavouriteList as { total_elements?: number } | null)?.total_elements ??
        0;

    // Page empty states: a brand-new bank, no matches, or no favourites yet.
    const renderPageEmpty = (tab: 'ACTIVE' | 'FAVOURITE') => {
        if (hasFilters) {
            return (
                <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center">
                    <p className="text-subtitle font-semibold text-neutral-700">
                        {tPage('list.noMatchTitle')}
                    </p>
                    <p className="text-body text-neutral-500">{tPage('list.noMatchHint')}</p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="default"
                        className="mt-2"
                        onClick={handleResetFilters}
                    >
                        {tPage('list.clearFilters')}
                    </MyButton>
                </div>
            );
        }
        if (tab === 'FAVOURITE') {
            return (
                <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center">
                    <p className="text-subtitle font-semibold text-neutral-700">
                        {tPage('list.noFavouritesTitle')}
                    </p>
                    <p className="text-body text-neutral-500">{tPage('list.noFavouritesHint')}</p>
                </div>
            );
        }
        return (
            <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
                <EmptyQuestionPapers />
                <p className="text-subtitle font-semibold text-neutral-700">
                    {tPage('list.emptyTitle')}
                </p>
                <p className="max-w-md text-body text-neutral-500">{tPage('list.emptyHint')}</p>
                <div className="mt-4 flex w-full max-w-2xl flex-col gap-3">
                    {addPaperWays(pickWay)}
                </div>
            </div>
        );
    };

    const listFor = (list: typeof questionPaperList, tab: 'ACTIVE' | 'FAVOURITE') => {
        const total = (list as { total_elements?: number } | null)?.total_elements;
        // Only a truly empty result gets the empty state; an emptied later page steps back (below).
        if (isPage && list && !total) return renderPageEmpty(tab);
        return list ? (
            <QuestionPapersList
                questionPaperList={list}
                pageNo={pageNo}
                handlePageChange={handlePageChange}
                refetchData={() => refetchRef.current()}
                isAssessment={isAssessment}
                index={index}
                sectionsForm={sectionsForm}
                studyLibraryAssignmentForm={studyLibraryAssignmentForm}
                isStudyLibraryAssignment={isStudyLibraryAssignment}
                currentQuestionIndex={currentQuestionIndex}
                setCurrentQuestionIndex={setCurrentQuestionIndex}
                examType={examType}
                onManualSelectionReady={tab === 'ACTIVE' ? onManualSelectionReady : undefined}
                sortOrder={sortOrder}
            />
        ) : null;
    };

    const filterButtons = (
        <>
            <QuestionPapersFilter
                label={t('filters.yearClass')}
                data={YearClassFilterData}
                selectedItems={selectedQuestionPaperFilters['level_ids'] || []}
                onSelectionChange={(items) => handleFilterChange('level_ids', items)}
            />
            <QuestionPapersFilter
                label={getTerminology(ContentTerms.Subjects, SystemTerms.Subjects)}
                data={SubjectFilterData}
                selectedItems={selectedQuestionPaperFilters['subject_ids'] || []}
                onSelectionChange={(items) => handleFilterChange('subject_ids', items)}
            />
            {TagFilterData.length > 0 && (
                <QuestionPapersFilter
                    label={t('filters.tags')}
                    data={TagFilterData}
                    selectedItems={selectedQuestionPaperFilters['tag_ids'] || []}
                    onSelectionChange={(items) => handleFilterChange('tag_ids', items)}
                />
            )}
        </>
    );

    const search = (
        <QuestionPapersSearchComponent
            onSearch={(searchValue: string) => {
                setActiveSearch(searchValue);
                if (isPage) {
                    reloadCurrentTab(selectedQuestionPaperFilters, searchValue);
                    return;
                }
                getFilteredData.mutate({
                    pageNo: pageNo,
                    pageSize: 10,
                    instituteId: INSTITUTE_ID,
                    data: {
                        ...selectedQuestionPaperFilters,
                        statuses: statusesForTab(selectedTab),
                        name: [{ id: searchValue, name: searchValue }],
                    },
                });
            }}
            searchText={searchText}
            setSearchText={setSearchText}
            clearSearch={clearSearch}
        />
    );

    return (
        <Tabs value={selectedTab} onValueChange={handleTabChangeWithLazyLoad}>
            {isPage ? (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <TabsList>
                            <TabsTrigger value="ACTIVE" className="gap-2">
                                {tPage('tabs.all')}
                                <Badge className="rounded-full bg-primary-500 px-2 text-2xs text-white hover:bg-primary-500">
                                    {(questionPaperList as { total_elements?: number } | null)
                                        ?.total_elements ?? 0}
                                </Badge>
                            </TabsTrigger>
                            <TabsTrigger value="FAVOURITE" className="gap-2">
                                {tPage('tabs.favourites')}
                                <Badge variant="secondary" className="rounded-full px-2 text-2xs">
                                    {favouriteCount}
                                </Badge>
                            </TabsTrigger>
                        </TabsList>
                        <div className="ml-auto flex flex-wrap items-center gap-3">
                            {search}
                            {filterButtons}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="medium"
                                        layoutVariant="default"
                                        className="gap-2"
                                    >
                                        <SortAscending size={16} />
                                        {tPage(`list.sort.${sortOrder}`)}
                                        <CaretDown size={14} />
                                    </MyButton>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {PAPER_SORTS.map((option) => (
                                        <DropdownMenuItem
                                            key={option}
                                            className="cursor-pointer gap-2"
                                            onClick={() => handleSortChange(option)}
                                        >
                                            {tPage(`list.sort.${option}`)}
                                            {option === 'NEWEST' && (
                                                <span className="text-caption text-neutral-400">
                                                    {tPage('list.sort.default')}
                                                </span>
                                            )}
                                            {option === sortOrder && (
                                                <Check
                                                    size={14}
                                                    className="ml-auto text-primary-500"
                                                />
                                            )}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                    {hasFilters && (
                        <div>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="default"
                                onClick={handleResetFilters}
                            >
                                {tPage('list.clearFilters')}
                            </MyButton>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex flex-wrap items-center justify-between gap-8">
                    <div className="flex flex-wrap gap-8">
                        {questionPaperList !== null && (
                            <TabListComponent
                                selectedTab={selectedTab}
                                questionPaperList={questionPaperList}
                                questionPaperFavouriteList={questionPaperFavouriteList}
                            />
                        )}
                        {filterButtons}
                        {Object.keys(selectedQuestionPaperFilters).length > 0 && (
                            <div className="flex gap-6">
                                <MyButton
                                    buttonType="primary"
                                    scale="small"
                                    layoutVariant="default"
                                    className="h-8"
                                    onClick={handleSubmitFilters}
                                >
                                    {t('actions.filter')}
                                </MyButton>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    layoutVariant="default"
                                    className="h-8 border border-neutral-400 bg-neutral-200 hover:border-neutral-500 hover:bg-neutral-300 active:border-neutral-600 active:bg-neutral-400"
                                    onClick={handleResetFilters}
                                >
                                    {t('actions.reset')}
                                </MyButton>
                            </div>
                        )}
                        <div
                            className={`flex gap-4 ${
                                Object.keys(selectedQuestionPaperFilters).length > 0 ? '-mt-1' : ''
                            }`}
                        >
                            {search}
                            {/* The date-range filter was rendered with no props and its
                            onSubmit only console.logged, so it never filtered
                            anything. Removed rather than left as a control that
                            looks functional and is not. */}
                        </div>
                    </div>
                </div>
            )}
            <TabsContent value="ACTIVE">
                {questionPaperList ? (
                    listFor(questionPaperList, 'ACTIVE')
                ) : (
                    <div className="flex h-screen flex-col items-center justify-center gap-2">
                        {loadError ? (
                            <>
                                <WarningCircle className="size-8 text-danger-600" />
                                <span className="text-neutral-700">{loadError}</span>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() => {
                                        setLoadError(null);
                                        setIsLoading(true);
                                        fetchTabData(selectedTab)
                                            .catch(reportPaperListError)
                                            .finally(() => setIsLoading(false));
                                    }}
                                >
                                    {t('actions.tryAgain')}
                                </MyButton>
                            </>
                        ) : (
                            <>
                                <EmptyQuestionPapers />
                                <span className="text-neutral-600">
                                    {t('emptyStates.noQuestionPapers')}
                                </span>
                            </>
                        )}
                    </div>
                )}
            </TabsContent>
            <TabsContent value="FAVOURITE">
                {questionPaperFavouriteList ? (
                    listFor(questionPaperFavouriteList, 'FAVOURITE')
                ) : (
                    <div className="flex h-screen flex-col items-center justify-center">
                        <EmptyQuestionPapers />
                        <span className="text-neutral-600">
                            {t('emptyStates.noFavouriteQuestionPapers')}
                        </span>
                    </div>
                )}
            </TabsContent>
        </Tabs>
    );
};
