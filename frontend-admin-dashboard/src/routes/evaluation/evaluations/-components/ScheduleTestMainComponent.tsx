import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@/components/ui/tabs';
import { useEffect, useState } from 'react';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { ScheduleTestFilters } from './ScheduleTestFilters';
import {
    useFilterDataForAssesment,
    useFilterDataForAssesmentInitData,
} from '@/routes/assessment/assessment-list/-utils.ts/useFiltersData';
import { ScheduleTestSearchComponent } from './ScheduleTestSearchComponent';
import { MyFilterOption } from '@/types/assessments/my-filter';
import ScheduleTestTabList from './ScheduleTestTabList';
import ScheduleTestFilterButtons from './ScheduleTestFilterButtons';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import ScheduleTestLists from './ScheduleTestLists';
import {
    getAssessmentListWithFilters,
    getInitAssessmentDetails,
} from '@/routes/assessment/assessment-list/-services/assessment-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { ScheduleTestTab } from '@/types/assessments/assessment-list';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { NoCourseDialog } from '@/components/common/students/no-course-dialog';
import { useRefetchStoreAssessment } from '@/routes/assessment/assessment-list/-global-store/refetch-store';
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
}

export const ScheduleTestMainComponent = () => {
    const { t } = useTranslation('evaluationScheduleTestMainComponent');
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const [isOpen, setIsOpen] = useState(false);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
    const { setNavHeading } = useNavHeadingStore();
    const [selectedTab, setSelectedTab] = useState('liveTests');
    const { data: initData } = useSuspenseQuery(useInstituteQuery());
    const { data: initAssessmentData } = useSuspenseQuery(getInitAssessmentDetails(initData?.id));
    const { BatchesFilterData, SubjectFilterData } = useFilterDataForAssesment(initData);
    const { AssessmentTypeData, ModeData } = useFilterDataForAssesmentInitData(initAssessmentData);
    const { getCourseFromPackage } = useInstituteDetailsStore();
    const setHandleRefetchDataAssessment = useRefetchStoreAssessment(
        (state) => state.setHandleRefetchDataAssessment
    );

    const [selectedQuestionPaperFilters, setSelectedQuestionPaperFilters] =
        useState<SelectedQuestionPaperFilters>({
            name: '',
            batch_ids: [],
            subjects_ids: [],
            tag_ids: [],
            get_live_assessments: false,
            get_passed_assessments: false,
            get_upcoming_assessments: false,
            institute_ids: [initData?.id || ''],
            assessment_statuses: [],
            assessment_modes: [],
            access_statuses: [],
            evaluation_types: [
                {
                    id: 'MANUAL',
                    name: 'MANUAL',
                },
            ],
        });

    const [scheduleTestTabsData, setScheduleTestTabsData] = useState<ScheduleTestTab[]>([
        {
            value: 'liveTests',
            message: t('noLiveTests'),
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
            message: t('noUpcomingTests'),
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
            message: t('noPreviousTests'),
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
            message: t('noDraftTests'),
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

    const handleFilterChange = (filterKey: string, selectedItems: MyFilterOption[]) => {
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
    };

    const handleResetFilters = () => {
        setSelectedQuestionPaperFilters({
            name: '',
            batch_ids: [],
            subjects_ids: [],
            tag_ids: [],
            get_live_assessments: false,
            get_passed_assessments: false,
            get_upcoming_assessments: false,
            institute_ids: [initData?.id || ''],
            assessment_statuses: [],
            assessment_modes: [],
            access_statuses: [],
            evaluation_types: [
                {
                    id: 'MANUAL',
                    name: 'MANUAL',
                },
            ],
        });
        setSearchText('');
        getFilteredData.mutate({
            pageNo: pageNo,
            pageSize: 10,
            instituteId: INSTITUTE_ID,
            data: {
                name: '',
                batch_ids: [],
                subjects_ids: [],
                tag_ids: [],
                get_live_assessments: selectedTab === 'liveTests' ? true : false,
                get_passed_assessments: selectedTab === 'previousTests' ? true : false,
                get_upcoming_assessments: selectedTab === 'upcomingTests' ? true : false,
                institute_ids: [initData?.id || ''],
                evaluation_types: [
                    {
                        id: 'MANUAL',
                        name: 'MANUAL',
                    },
                ],
                assessment_statuses: [
                    {
                        id: '0',
                        name: selectedTab === 'draftTests' ? 'DRAFT' : 'PUBLISHED',
                    },
                ],
                assessment_modes: [],
                access_statuses: [],
            },
        });
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
            if (selectedTab === 'liveTests') {
                setScheduleTestTabsData((prevTabs) =>
                    prevTabs.map((tab) =>
                        tab.value === 'liveTests' ? { ...tab, data: data } : tab
                    )
                );
            } else {
                setScheduleTestTabsData((prevTabs) =>
                    prevTabs.map((tab) =>
                        tab.value === 'previousTests' ? { ...tab, data: data } : tab
                    )
                );
            }
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleSubmitFilters = () => {
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
                setIsLoading(false);
            })
            .catch((error) => {
                console.error(error);
                setIsLoading(false);
            });
    };

    // Track which tabs have been loaded
    const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set());

    // Fetch data for a specific tab
    const fetchTabData = (tabValue: string) => {
        const tabConfigs: Record<string, { get_live: boolean; get_passed: boolean; get_upcoming: boolean; status: string }> = {
            liveTests: { get_live: true, get_passed: false, get_upcoming: false, status: 'PUBLISHED' },
            upcomingTests: { get_live: false, get_passed: false, get_upcoming: true, status: 'PUBLISHED' },
            previousTests: { get_live: false, get_passed: true, get_upcoming: false, status: 'PUBLISHED' },
            draftTests: { get_live: false, get_passed: false, get_upcoming: false, status: 'DRAFT' },
        };

        const config = tabConfigs[tabValue];
        if (!config) return Promise.resolve();

        return getAssessmentListWithFilters(pageNo, 10, INSTITUTE_ID, {
            ...selectedQuestionPaperFilters,
            assessment_statuses: [{ id: '0', name: config.status }],
            get_live_assessments: config.get_live,
            get_passed_assessments: config.get_passed,
            get_upcoming_assessments: config.get_upcoming,
            evaluation_types: [{ id: 'MANUAL', name: 'MANUAL' }],
        }).then((data) => {
            setScheduleTestTabsData((prevTabs) =>
                prevTabs.map((tab) =>
                    tab.value === tabValue ? { ...tab, data: data } : tab
                )
            );
            setLoadedTabs((prev) => new Set([...prev, tabValue]));
        });
    };

    // Handle tab change - fetch data if tab hasn't been loaded yet
    const handleTabChange = (newTab: string) => {
        setSelectedTab(newTab);

        // Only fetch if this tab hasn't been loaded yet
        if (!loadedTabs.has(newTab)) {
            setIsLoading(true);
            fetchTabData(newTab)
                .catch((error) => console.error(error))
                .finally(() => setIsLoading(false));
        }
    };

    // Initial fetch - only load the default tab (liveTests)
    useEffect(() => {
        setIsLoading(true);

        // Only fetch the currently selected tab (liveTests by default)
        fetchTabData(selectedTab)
            .catch((error) => console.error(error))
            .finally(() => setIsLoading(false));
    }, []);

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('assessmentsList')}</h1>);
    }, []);

    useEffect(() => {
        const courseList = getCourseFromPackage();
        if (courseList.length === 0) {
            setIsOpen(true);
        }
    }, []);

    // Define the handleRefetchData function here
    useEffect(() => {
        setHandleRefetchDataAssessment(handleRefetchData);
    }, [setHandleRefetchDataAssessment]);

    if (isLoading) return <DashboardLoader />;
    return (
        <>
            <Helmet>
                <title>{t('helmet.title')}</title>
                <meta name="description" content={t('helmet.description')} />
            </Helmet>
            <div className="flex flex-col gap-4">
                <Tabs value={selectedTab} onValueChange={handleTabChange}>
                    <ScheduleTestTabList
                        selectedTab={selectedTab}
                        scheduleTestTabsData={scheduleTestTabsData}
                    />
                    <div className="my-6 flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <ScheduleTestFilters
                                label={getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch)}
                                data={BatchesFilterData}
                                selectedItems={selectedQuestionPaperFilters['batch_ids'] || []}
                                onSelectionChange={(items) =>
                                    handleFilterChange('batch_ids', items)
                                }
                            />
                            <ScheduleTestFilters
                                label={getTerminologyPlural(ContentTerms.Subjects, SystemTerms.Subjects)}
                                data={SubjectFilterData}
                                selectedItems={selectedQuestionPaperFilters['subjects_ids'] || []}
                                onSelectionChange={(items) =>
                                    handleFilterChange('subjects_ids', items)
                                }
                            />
                            <ScheduleTestFilters
                                label={t('mode')}
                                data={ModeData}
                                selectedItems={
                                    selectedQuestionPaperFilters['assessment_modes'] || []
                                }
                                onSelectionChange={(items) =>
                                    handleFilterChange('assessment_modes', items)
                                }
                            />
                            <ScheduleTestFilters
                                label={t('type')}
                                data={AssessmentTypeData}
                                selectedItems={
                                    selectedQuestionPaperFilters['access_statuses'] || []
                                }
                                onSelectionChange={(items) =>
                                    handleFilterChange('access_statuses', items)
                                }
                            />
                            <ScheduleTestFilterButtons
                                selectedQuestionPaperFilters={selectedQuestionPaperFilters}
                                handleSubmitFilters={handleSubmitFilters}
                                handleResetFilters={handleResetFilters}
                            />
                        </div>
                        <ScheduleTestSearchComponent
                            onSearch={handleSearch}
                            searchText={searchText}
                            setSearchText={setSearchText}
                            clearSearch={clearSearch}
                        />
                    </div>
                    {scheduleTestTabsData.map((tab, index) => (
                        <ScheduleTestLists
                            key={index}
                            tab={tab}
                            pageNo={pageNo}
                            handlePageChange={handlePageChange}
                            selectedTab={selectedTab}
                            handleRefetchData={handleRefetchData}
                        />
                    ))}
                </Tabs>
            </div>
            <NoCourseDialog
                type={t('noCourseDialogType')}
                isOpen={isOpen}
                setIsOpen={setIsOpen}
            />
        </>
    );
};
