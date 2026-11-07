import { Helmet } from 'react-helmet';
import { Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { ScheduleTestFilters } from './ScheduleTestFilters';
import { Info } from '@phosphor-icons/react';
import {
    useFilterDataForAssesment,
    useFilterDataForAssesmentInitData,
} from '../-utils.ts/useFiltersData';
import { ScheduleTestSearchComponent } from './ScheduleTestSearchComponent';
import { MyFilterOption } from '@/types/assessments/my-filter';
import { ScheduleTestHeaderDescription } from './ScheduleTestHeaderDescription';
import ScheduleTestTabList from './ScheduleTestTabList';
import ScheduleTestFilterButtons from './ScheduleTestFilterButtons';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import ScheduleTestLists from './ScheduleTestLists';
import {
    getAssessmentListWithFilters,
    getInitAssessmentDetails,
} from '../-services/assessment-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { ScheduleTestTab } from '@/types/assessments/assessment-list';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { NoCourseDialog } from '@/components/common/students/no-course-dialog';
import { useRefetchStoreAssessment } from '../-global-store/refetch-store';
import { Route } from '..';
import { useNavigate } from '@tanstack/react-router';
import { getCourseSubjects } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getSubjects';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ASSESSMENT_SOURCE_FILTERS } from '../-utils.ts/assessment-source';
import type { FolderListFilter } from './folders/AssessmentFolderWorkspace';

export interface SelectedQuestionPaperFilters {
    name: string | { id: string; name: string }[];
    batch_ids: MyFilterOption[];
    subjects_ids: MyFilterOption[];
    tag_ids: MyFilterOption[];
    get_live_assessments: boolean;
    get_passed_assessments: boolean;
    get_upcoming_assessments: boolean;
    institute_ids: string[];
    assessment_statuses: MyFilterOption[];
    assessment_modes: MyFilterOption[];
    access_statuses: MyFilterOption[];
    evaluation_types: MyFilterOption[];
    /** Folder scope (assessment folders); set from the route, not a filter chip. */
    folder_id?: string;
    unfiled_only?: boolean;
}

// Per-tab request flags/status — shared by the full-list fetch and the
// lightweight count-only fetch so both stay in lockstep.
const TAB_CONFIGS = {
    liveTests: { get_live: true, get_passed: false, get_upcoming: false, status: 'PUBLISHED' },
    upcomingTests: { get_live: false, get_passed: false, get_upcoming: true, status: 'PUBLISHED' },
    previousTests: { get_live: false, get_passed: true, get_upcoming: false, status: 'PUBLISHED' },
    draftTests: { get_live: false, get_passed: false, get_upcoming: false, status: 'DRAFT' },
} satisfies Record<
    string,
    { get_live: boolean; get_passed: boolean; get_upcoming: boolean; status: string }
>;

const TAB_VALUES = ['liveTests', 'upcomingTests', 'previousTests', 'draftTests'] as const;

// Overlay the per-tab flags/status onto a shared filter payload.
const buildTabData = (baseData: SelectedQuestionPaperFilters, tabValue: string) => {
    const config = TAB_CONFIGS[tabValue as keyof typeof TAB_CONFIGS] ?? TAB_CONFIGS.liveTests;
    return {
        ...baseData,
        get_live_assessments: config.get_live,
        get_passed_assessments: config.get_passed,
        get_upcoming_assessments: config.get_upcoming,
        assessment_statuses: [{ id: '0', name: config.status }],
    };
};

const SafeRouteSearch = () => {
    try {
        return Route.useSearch();
    } catch (error) {
        // Return a default object if the hook fails
        return { selectedTab: 'liveTests' };
    }
};

export const ScheduleTestMainComponent = ({
    isCourseOutline = false,
    batchId,
    showBatchFilter = true,
    folderFilter,
    toolbar,
    hideList = false,
}: {
    isCourseOutline?: boolean;
    batchId?: string;
    showBatchFilter?: boolean;
    /** Folder the list is scoped to; the workspace remounts this component when it changes. */
    folderFilter?: FolderListFilter;
    /** Rendered under the page header, above the tabs (assessment folder cards / breadcrumb). */
    toolbar?: React.ReactNode;
    /** Assessment folders: show only the header + toolbar (every test is in a folder). */
    hideList?: boolean;
}) => {
    const navigate = useNavigate();
    const { t } = useTranslation('assessmentScheduleTestMainComponent');

    // Always call Route.useSearch() regardless of props
    const routeSearchParams = SafeRouteSearch();

    const searchParams = !isCourseOutline ? routeSearchParams : { selectedTab: 'liveTests' };

    // Set state based on the derived value
    const [selectedTab, setSelectedTab] = useState(searchParams.selectedTab ?? 'liveTests');
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const [isOpen, setIsOpen] = useState(false);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
    const { setNavHeading } = useNavHeadingStore();
    const { data: initData } = useSuspenseQuery(useInstituteQuery());
    const { data: initAssessmentData } = useSuspenseQuery(getInitAssessmentDetails(initData?.id));
    const { BatchesFilterData, SubjectFilterData } = useFilterDataForAssesment(initData);
    const { AssessmentTypeData, ModeData, EvaluationTypeData } =
        useFilterDataForAssesmentInitData(initAssessmentData);
    const { getCourseFromPackage, getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const setHandleRefetchDataAssessment = useRefetchStoreAssessment(
        (state) => state.setHandleRefetchDataAssessment
    );

    const [selectedQuestionPaperFilters, setSelectedQuestionPaperFilters] =
        useState<SelectedQuestionPaperFilters>({
            name: '',
            // If in course outline mode and batchId is provided, pre-select it
            batch_ids: isCourseOutline && batchId ? [{ id: batchId, name: '' }] : [],
            subjects_ids: [],
            tag_ids: [],
            get_live_assessments: false,
            get_passed_assessments: false,
            get_upcoming_assessments: false,
            institute_ids: [initData?.id || ''],
            assessment_statuses: [],
            assessment_modes: [],
            access_statuses: [],
            evaluation_types: [],
            ...folderFilter,
        });

    // Whether the admin changed a filter since the last Apply — see hasUnappliedFilters.
    const [filtersTouched, setFiltersTouched] = useState(false);

    // Source (All / Dashboard / API). The list endpoint has no source parameter, so this
    // filters the loaded page client-side and takes effect immediately (no Apply needed).
    const [sourceFilter, setSourceFilter] = useState<MyFilterOption[]>([]);
    const sourceFilterOptions: MyFilterOption[] = ASSESSMENT_SOURCE_FILTERS.map((value) => ({
        id: value,
        name: t(`filters.source.options.${value}`),
    }));

    const [scheduleTestTabsData, setScheduleTestTabsData] = useState<ScheduleTestTab[]>([
        {
            value: 'liveTests',
            message: t('tabs.liveTests.emptyMessage'),
            data: {
                content: [],
                last: false,
                page_no: 1,
                page_size: 10,
                total_elements: 0,
                total_pages: 0,
            },
        },
        {
            value: 'upcomingTests',
            message: t('tabs.upcomingTests.emptyMessage'),
            data: {
                content: [],
                last: false,
                page_no: 1,
                page_size: 10,
                total_elements: 0,
                total_pages: 0,
            },
        },
        {
            value: 'previousTests',
            message: t('tabs.previousTests.emptyMessage'),
            data: {
                content: [],
                last: false,
                page_no: 1,
                page_size: 10,
                total_elements: 0,
                total_pages: 0,
            },
        },
        {
            value: 'draftTests',
            message: t('tabs.draftTests.emptyMessage'),
            data: {
                content: [],
                last: false,
                page_no: 1,
                page_size: 10,
                total_elements: 0,
                total_pages: 0,
            },
        },
    ]);

    const [searchText, setSearchText] = useState('');
    const [pageNo, setPageNo] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    // Tab badge counts kept independent of the (lazily loaded) per-tab list data,
    // so every tab shows its real count on first paint — not 0 until opened.
    // null = not fetched yet.
    const [tabCounts, setTabCounts] = useState<Record<string, number | null>>({
        liveTests: null,
        upcomingTests: null,
        previousTests: null,
        draftTests: null,
    });

    // Count-only fetch (pageSize=1): we only read total_elements, so this stays
    // cheap and runs in the background without gating the page loader.
    const fetchTabCount = async (tabValue: string, dataForTab: SelectedQuestionPaperFilters) => {
        try {
            const data = await getAssessmentListWithFilters(0, 1, INSTITUTE_ID, dataForTab);
            setTabCounts((prev) => ({ ...prev, [tabValue]: data?.total_elements ?? 0 }));
        } catch (error) {
            console.error('Failed to fetch count for', tabValue, error);
        }
    };

    // Refresh all four badge counts in parallel from a shared filter payload
    // (search text + selected filters), so badges reflect the current filters.
    const refreshAllTabCounts = (baseData: SelectedQuestionPaperFilters) => {
        TAB_VALUES.forEach((tabValue) =>
            fetchTabCount(tabValue, buildTabData(baseData, tabValue))
        );
    };

    const handleFilterChange = (filterKey: string, selectedItems: MyFilterOption[]) => {
        setFiltersTouched(true);
        setSelectedQuestionPaperFilters((prev) => {
            const updatedFilters = { ...prev, [filterKey]: selectedItems };
            return updatedFilters;
        });
    };

    const clearSearch = () => {
        setSearchText('');
        selectedQuestionPaperFilters['name'] = '';
        getFilteredData.mutate({
            pageNo: pageNo,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                ...selectedQuestionPaperFilters,
                get_live_assessments: selectedTab === 'liveTests' ? true : false,
                get_passed_assessments: selectedTab === 'previousTests' ? true : false,
                get_upcoming_assessments: selectedTab === 'upcomingTests' ? true : false,
                assessment_statuses: [
                    {
                        id: '0',
                        name: selectedTab === 'draftTests' ? 'DRAFT' : 'PUBLISHED',
                    },
                ],
                name: '',
            },
        });
        refreshAllTabCounts({ ...selectedQuestionPaperFilters, name: '' });
    };

    const handleSearch = (searchValue: string) => {
        setSearchText(searchValue);
        getFilteredData.mutate({
            pageNo: pageNo,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                ...selectedQuestionPaperFilters,
                get_live_assessments: selectedTab === 'liveTests' ? true : false,
                get_passed_assessments: selectedTab === 'previousTests' ? true : false,
                get_upcoming_assessments: selectedTab === 'upcomingTests' ? true : false,
                assessment_statuses: [
                    {
                        id: '0',
                        name: selectedTab === 'draftTests' ? 'DRAFT' : 'PUBLISHED',
                    },
                ],
                name: [{ id: searchValue, name: searchValue }],
            },
        });
        refreshAllTabCounts({
            ...selectedQuestionPaperFilters,
            name: [{ id: searchValue, name: searchValue }],
        });
    };

    const handleResetFilters = () => {
        setFiltersTouched(false);
        setSourceFilter([]);
        setSelectedQuestionPaperFilters({
            name: '',
            // Keep the batch selection if in course outline mode
            batch_ids: isCourseOutline && batchId ? [{ id: batchId, name: '' }] : [],
            subjects_ids: [],
            tag_ids: [],
            get_live_assessments: false,
            get_passed_assessments: false,
            get_upcoming_assessments: false,
            institute_ids: [initData?.id || ''],
            assessment_statuses: [],
            assessment_modes: [],
            access_statuses: [],
            evaluation_types: [],
            ...folderFilter,
        });
        setSearchText('');
        const resetBaseData: SelectedQuestionPaperFilters = {
            name: '',
            batch_ids: isCourseOutline && batchId ? [{ id: batchId, name: '' }] : [],
            subjects_ids: [],
            tag_ids: [],
            get_live_assessments: false,
            get_passed_assessments: false,
            get_upcoming_assessments: false,
            institute_ids: [initData?.id || ''],
            evaluation_types: [],
            assessment_statuses: [],
            assessment_modes: [],
            access_statuses: [],
            ...folderFilter,
        };
        getFilteredData.mutate({
            pageNo: pageNo,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                ...resetBaseData,
                get_live_assessments: selectedTab === 'liveTests' ? true : false,
                get_passed_assessments: selectedTab === 'previousTests' ? true : false,
                get_upcoming_assessments: selectedTab === 'upcomingTests' ? true : false,
                assessment_statuses: [
                    {
                        id: '0',
                        name: selectedTab === 'draftTests' ? 'DRAFT' : 'PUBLISHED',
                    },
                ],
            },
        });
        refreshAllTabCounts(resetBaseData);
    };

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
            data: SelectedQuestionPaperFilters;
        }) => getAssessmentListWithFilters(pageNo, pageSize, instituteId, data),
        onSuccess: (data) => {
            // Keep the active tab's badge in sync with the freshly loaded list.
            setTabCounts((prev) => ({ ...prev, [selectedTab]: data?.total_elements ?? 0 }));
            if (selectedTab === 'liveTests') {
                setScheduleTestTabsData((prevTabs) =>
                    prevTabs.map((tab) =>
                        tab.value === 'liveTests' ? { ...tab, data: data } : tab
                    )
                );
            } else if (selectedTab === 'upcomingTests') {
                setScheduleTestTabsData((prevTabs) =>
                    prevTabs.map((tab) =>
                        tab.value === 'upcomingTests' ? { ...tab, data: data } : tab
                    )
                );
            } else if (selectedTab === 'previousTests') {
                setScheduleTestTabsData((prevTabs) =>
                    prevTabs.map((tab) =>
                        tab.value === 'previousTests' ? { ...tab, data: data } : tab
                    )
                );
            } else {
                setScheduleTestTabsData((prevTabs) =>
                    prevTabs.map((tab) =>
                        tab.value === 'draftTests' ? { ...tab, data: data } : tab
                    )
                );
            }
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    // Counted per group, not per value, and only over groups that actually have a chip on
    // screen: "2 filters" then matches the two highlighted chips. Counting values would
    // read "5 filters" for two chips; counting assessment_statuses would never be zero
    // because the tab sets it; tag_ids is out for the same reason — no chip here, so a
    // preset would inflate a count whose cause the admin cannot see.
    const activeFilterCount = [
        selectedQuestionPaperFilters.batch_ids,
        selectedQuestionPaperFilters.subjects_ids,
        selectedQuestionPaperFilters.assessment_modes,
        selectedQuestionPaperFilters.access_statuses,
        selectedQuestionPaperFilters.evaluation_types,
    ].filter((group) => (group?.length ?? 0) > 0).length;

    // Gated on a real interaction, not merely on something being selected. In
    // course-outline mode batch_ids arrives pre-selected (and its chip can be hidden), so
    // counting alone would greet the admin with "1 filter selected — press Apply" before
    // they touched anything, about a list that is already correctly scoped.
    const hasUnappliedFilters = filtersTouched && activeFilterCount > 0;

    const handleSubmitFilters = () => {
        setFiltersTouched(false);
        getFilteredData.mutate({
            pageNo: pageNo,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                ...selectedQuestionPaperFilters,
                get_live_assessments: selectedTab === 'liveTests' ? true : false,
                get_passed_assessments: selectedTab === 'previousTests' ? true : false,
                get_upcoming_assessments: selectedTab === 'upcomingTests' ? true : false,
                assessment_statuses: [
                    {
                        id: '0',
                        name: selectedTab === 'draftTests' ? 'DRAFT' : 'PUBLISHED',
                    },
                ],
            },
        });
        // Filters apply to every tab — refresh all badge counts, not just the open one.
        refreshAllTabCounts(selectedQuestionPaperFilters);
    };

    const handleRefetchData = () => {
        getFilteredData.mutate({
            pageNo: pageNo,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                ...selectedQuestionPaperFilters,
                get_live_assessments: selectedTab === 'liveTests' ? true : false,
                get_passed_assessments: selectedTab === 'previousTests' ? true : false,
                get_upcoming_assessments: selectedTab === 'upcomingTests' ? true : false,
                assessment_statuses: [
                    {
                        id: '0',
                        name: selectedTab === 'draftTests' ? 'DRAFT' : 'PUBLISHED',
                    },
                ],
            },
        });
    };

    const handlePageChange = (newPage: number) => {
        setPageNo(newPage);
        getAssessmentListWithFilters(newPage, 10, INSTITUTE_ID, {
            ...selectedQuestionPaperFilters,
            get_live_assessments: selectedTab === 'liveTests' ? true : false,
            get_passed_assessments: selectedTab === 'previousTests' ? true : false,
            get_upcoming_assessments: selectedTab === 'upcomingTests' ? true : false,
            assessment_statuses: [
                {
                    id: '0',
                    name: selectedTab === 'draftTests' ? 'DRAFT' : 'PUBLISHED',
                },
            ],
        })
            .then((data) => {
                setScheduleTestTabsData((prevTabs) =>
                    prevTabs.map((tab) =>
                        tab.value === selectedTab ? { ...tab, data: data } : tab
                    )
                );
                setTabCounts((prev) => ({ ...prev, [selectedTab]: data?.total_elements ?? 0 }));
                setIsLoading(false);
            })
            .catch((error) => {
                console.error(error);
                setIsLoading(false);
            });
    };

    // Make sure getSubjectsByBatchId is defined outside any effect or function
    const getSubjectsByBatchId = useCallback(
        (batchId: string) => {
            const batch = getDetailsFromPackageSessionId({ packageSessionId: batchId });
            const subjects = getCourseSubjects(
                batch?.package_dto?.id ?? '',
                batch?.session?.id ?? '',
                batch?.level?.id ?? ''
            );
            return subjects.map((subject) => ({
                name: subject.subject_name,
                id: subject.id,
            }));
        },
        [getDetailsFromPackageSessionId]
    );

    // Track which tabs have been loaded
    const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set());

    // Define base filters that include batch_id if in course outline mode
    const getBaseFilters = useCallback(() => ({
        ...selectedQuestionPaperFilters,
        batch_ids:
            isCourseOutline && batchId
                ? [{ id: batchId, name: '' }]
                : selectedQuestionPaperFilters.batch_ids,
    }), [selectedQuestionPaperFilters, isCourseOutline, batchId]);

    // Fetch data for a specific tab
    const fetchTabData = useCallback((tabValue: string) => {
        const tabConfigs: Record<string, { get_live: boolean; get_passed: boolean; get_upcoming: boolean; status: string }> = {
            liveTests: { get_live: true, get_passed: false, get_upcoming: false, status: 'PUBLISHED' },
            upcomingTests: { get_live: false, get_passed: false, get_upcoming: true, status: 'PUBLISHED' },
            previousTests: { get_live: false, get_passed: true, get_upcoming: false, status: 'PUBLISHED' },
            draftTests: { get_live: false, get_passed: false, get_upcoming: false, status: 'DRAFT' },
        };

        const config = tabConfigs[tabValue];
        if (!config) return Promise.resolve();

        return getAssessmentListWithFilters(pageNo, 10, INSTITUTE_ID, {
            ...getBaseFilters(),
            assessment_statuses: [{ id: '0', name: config.status }],
            get_live_assessments: config.get_live,
            get_passed_assessments: config.get_passed,
            get_upcoming_assessments: config.get_upcoming,
        }).then((data) => {
            setScheduleTestTabsData((prevTabs) =>
                prevTabs.map((tab) =>
                    tab.value === tabValue ? { ...tab, data: data } : tab
                )
            );
            setTabCounts((prev) => ({ ...prev, [tabValue]: data?.total_elements ?? 0 }));
            setLoadedTabs((prev) => new Set([...prev, tabValue]));
        });
    }, [pageNo, INSTITUTE_ID, getBaseFilters]);

    // Handle tab change - fetch data if tab hasn't been loaded yet
    const handleTabChange = useCallback((newTab: string) => {
        setSelectedTab(newTab);

        // Only fetch if this tab hasn't been loaded yet
        if (!loadedTabs.has(newTab)) {
            setIsLoading(true);
            fetchTabData(newTab)
                .catch((error) => console.error(error))
                .finally(() => setIsLoading(false));
        }
    }, [loadedTabs, fetchTabData]);

    // Initial fetch - load the selected tab's full list (gates the page loader),
    // and fetch every tab's badge count in the background so all counts show up
    // front without waiting for each tab to be opened.
    useEffect(() => {
        setIsLoading(true);

        // Only fetch the currently selected tab (liveTests by default)
        fetchTabData(selectedTab)
            .catch((error) => console.error(error))
            .finally(() => setIsLoading(false));

        refreshAllTabCounts(getBaseFilters());
    }, [isCourseOutline, batchId]);

    useEffect(() => {
        if (!isCourseOutline)
            setNavHeading(<h1 className="text-lg">{t('header.navHeading')}</h1>);
    }, []);

    useEffect(() => {
        const courseList = getCourseFromPackage();
        if (courseList.length === 0) {
            setIsOpen(true);
        }
    }, []);

    useEffect(() => {
        if (!isCourseOutline)
            navigate({
                to: '/assessment/assessment-list',
                // Keep ?folderId= so the folder (and a sidebar sub-tab pointing at it) stays selected.
                search: (prev: Record<string, unknown>) => ({
                    ...prev,
                    selectedTab: selectedTab,
                }),
            });
    }, [selectedTab, isCourseOutline, navigate]);

    // Define the handleRefetchData function here
    useEffect(() => {
        setHandleRefetchDataAssessment(handleRefetchData);
    }, [setHandleRefetchDataAssessment]);

    if (isLoading) return <DashboardLoader />;
    return (
        <>
            <Helmet>
                <title>{t('meta.helmetTitle')}</title>
                <meta name="description" content={t('meta.helmetDescription')} />
            </Helmet>
            <ScheduleTestHeaderDescription isCourseOutline />
            {toolbar}
            {/* hideList (assessment folders, every test in a folder): no empty tabs. */}
            <div className={cn('flex flex-col gap-4', hideList && 'hidden')}>
                <Tabs value={selectedTab} onValueChange={handleTabChange}>
                    <ScheduleTestTabList
                        selectedTab={selectedTab}
                        scheduleTestTabsData={scheduleTestTabsData}
                        tabCounts={tabCounts}
                    />
                    <div className="my-4 sm:my-6">
                        {/* One bordered surface so the filters and the search read as a
                            single control strip. Loose on white they looked like five
                            unrelated "add" buttons floating above the results. */}
                        <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 sm:p-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-3">
                                {/* One row from lg up (flex-nowrap + overflow-x-auto), wrapping
                                    below it. Five chips on a phone are better stacked than
                                    hidden behind a sideways scroll nobody discovers — at 440px
                                    the desktop single-row version cut "Type" and "Evaluation"
                                    off the edge. min-w-0 is what lets this shrink beside the
                                    search box; without it the flex child refuses to go below
                                    its content width and pushes the last chip onto a new line
                                    even on a wide screen. */}
                                <div className="no-scrollbar -mx-1 flex min-w-0 flex-1 flex-wrap items-center gap-2 px-1 lg:flex-nowrap lg:overflow-x-auto">
                                    <span className="hidden shrink-0 pr-1 text-sm font-medium text-neutral-500 sm:inline">
                                        {t('filters.filterBy')}
                                    </span>
                                    {/* Only show batch filter if not in course outline mode or explicitly enabled */}
                                    {(!isCourseOutline || showBatchFilter) && (
                                        <ScheduleTestFilters
                                            label={getTerminologyPlural(
                                                ContentTerms.Batch,
                                                SystemTerms.Batch
                                            )}
                                            data={BatchesFilterData}
                                            selectedItems={
                                                selectedQuestionPaperFilters['batch_ids'] || []
                                            }
                                            onSelectionChange={(items) =>
                                                handleFilterChange('batch_ids', items)
                                            }
                                        />
                                    )}
                                    <ScheduleTestFilters
                                        label={getTerminology(
                                            ContentTerms.Subjects,
                                            SystemTerms.Subjects
                                        )}
                                        data={
                                            isCourseOutline && batchId
                                                ? getSubjectsByBatchId(batchId)
                                                : SubjectFilterData
                                        }
                                        selectedItems={
                                            selectedQuestionPaperFilters['subjects_ids'] || []
                                        }
                                        onSelectionChange={(items) =>
                                            handleFilterChange('subjects_ids', items)
                                        }
                                    />
                                    <ScheduleTestFilters
                                        label={t('filters.mode')}
                                        data={ModeData}
                                        selectedItems={
                                            selectedQuestionPaperFilters['assessment_modes'] || []
                                        }
                                        onSelectionChange={(items) =>
                                            handleFilterChange('assessment_modes', items)
                                        }
                                    />
                                    <ScheduleTestFilters
                                        label={t('filters.type')}
                                        data={AssessmentTypeData}
                                        selectedItems={
                                            selectedQuestionPaperFilters['access_statuses'] || []
                                        }
                                        onSelectionChange={(items) =>
                                            handleFilterChange('access_statuses', items)
                                        }
                                    />
                                    <ScheduleTestFilters
                                        label={t('filters.evaluation')}
                                        data={EvaluationTypeData}
                                        selectedItems={
                                            selectedQuestionPaperFilters['evaluation_types'] || []
                                        }
                                        onSelectionChange={(items) =>
                                            handleFilterChange('evaluation_types', items)
                                        }
                                    />
                                    <ScheduleTestFilters
                                        label={t('filters.source.label')}
                                        data={sourceFilterOptions}
                                        selectedItems={sourceFilter}
                                        onSelectionChange={setSourceFilter}
                                    />
                                </div>
                                {/* Apply / Clear sit OUTSIDE the scrolling cluster. Inside it
                                    they scrolled out of reach on a narrow window — the one
                                    control the admin has to press to see any effect. */}
                                <div className="shrink-0">
                                    <ScheduleTestFilterButtons
                                        selectedQuestionPaperFilters={selectedQuestionPaperFilters}
                                        handleSubmitFilters={handleSubmitFilters}
                                        handleResetFilters={handleResetFilters}
                                    />
                                </div>
                                {/* Search sits in the same strip, on the right. w-72 not w-56:
                                    the input itself carries pl-8 pr-12, so 80px of that width
                                    is padding and a narrower box truncates its own
                                    "Search Question Paper" placeholder. The chip cluster
                                    scrolls rather than shrinking this. */}
                                <div className="w-full lg:w-72 lg:shrink-0">
                                    <ScheduleTestSearchComponent
                                        onSearch={handleSearch}
                                        searchText={searchText}
                                        setSearchText={setSearchText}
                                        clearSearch={clearSearch}
                                    />
                                </div>
                            </div>
                            {/* Picking a filter only stores it — the list is refetched by a
                                mutation on Apply, not by a query keyed on filter state. Say
                                so, because otherwise ticking boxes looks broken. */}
                            {hasUnappliedFilters && (
                                <p className="mt-3 flex items-center gap-1.5 border-t border-neutral-200 pt-3 text-xs text-neutral-500">
                                    <Info className="size-3.5 shrink-0 text-primary-500" />
                                    <span>
                                        {t('filters.unapplied.countLabel', {
                                            count: activeFilterCount,
                                        })}{' '}
                                        {t('filters.unapplied.instructionPrefix')}{' '}
                                        <span className="font-medium text-neutral-700">
                                            {t('filters.unapplied.applyLabel')}
                                        </span>{' '}
                                        {t('filters.unapplied.instructionSuffix')}
                                    </span>
                                </p>
                            )}
                        </div>
                    </div>
                    {scheduleTestTabsData.map((tab, index) => (
                        <ScheduleTestLists
                            key={index}
                            tab={tab}
                            pageNo={pageNo}
                            handlePageChange={handlePageChange}
                            selectedTab={selectedTab}
                            handleRefetchData={handleRefetchData}
                            sourceFilter={sourceFilter.map((option) => option.id)}
                        />
                    ))}
                </Tabs>
            </div>
            <NoCourseDialog
                type={t('dialogs.noCourse.type')}
                isOpen={isOpen}
                setIsOpen={setIsOpen}
            />
        </>
    );
};
