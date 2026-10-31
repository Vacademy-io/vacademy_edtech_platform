/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBatchDetailsListOfStudents } from '../-services/assessment-details-services';
import { getInstituteId } from '@/constants/helper';
import { MyTable } from '@/components/design-system/table';
import { step3ParticipantsListColumn } from '../-utils/student-columns';
import { OnChangeFn, RowSelectionState } from '@tanstack/react-table';
import { MyPagination } from '@/components/design-system/pagination';
import { getAssessmentStep3ParticipantsListWithBatchName } from '../-utils/helper';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { AssessmentDetailsSearchComponent } from './SearchComponent';
import { MyFilterOption } from '@/types/assessments/my-filter';
import { ScheduleTestFilters } from '@/routes/assessment/assessment-list/-components/ScheduleTestFilters';
import { MyButton } from '@/components/design-system/button';

export interface AssessmentParticipantsInterface {
    name: string;
    statuses: string[];
    institute_ids: string[];
    package_session_ids: string[];
    group_ids: string[];
    gender: MyFilterOption[];
    sort_columns: Record<string, string>; // For dynamic keys in sort_columns
}

export const AssessmentParticipantsList = ({ batchId }: { batchId: string }) => {
    const { t } = useTranslation('assessmentParticipantsList');
    const { data: initData } = useSuspenseQuery(useInstituteQuery());
    const instituteId = getInstituteId();
    const [pageNo, setPageNo] = useState(0);
    const [rowSelections, setRowSelections] = useState<Record<number, Record<string, boolean>>>({});
    const currentPageSelection = rowSelections[pageNo] || {};
    const [searchText, setSearchText] = useState('');
    const [selectedFilter, setSelectedFilter] = useState<AssessmentParticipantsInterface>({
        name: '',
        statuses: [],
        institute_ids: [instituteId!],
        package_session_ids: [batchId],
        group_ids: [],
        gender: [],
        sort_columns: {},
    });

    const [participantsData, setParticipantsData] = useState({
        content: [],
        total_pages: 0,
        page_no: pageNo,
        page_size: 10,
        total_elements: 0,
        last: false,
    });

    const getParticipantsData = useMutation({
        mutationFn: ({
            pageNo,
            pageSize,
            selectedFilter,
        }: {
            pageNo: number;
            pageSize: number;
            selectedFilter: AssessmentParticipantsInterface;
        }) => getBatchDetailsListOfStudents(pageNo, pageSize, selectedFilter),
        onSuccess: (data) => {
            setParticipantsData(data);
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleGetParticipantsDetails = () => {
        getParticipantsData.mutate({
            pageNo,
            pageSize: 10,
            selectedFilter,
        });
    };

    const handlePageChange = (newPage: number) => {
        setPageNo(newPage);
        getParticipantsData.mutate({
            pageNo: newPage,
            pageSize: 10,
            selectedFilter,
        });
    };

    const handleRowSelectionChange: OnChangeFn<RowSelectionState> = (updaterOrValue) => {
        const newSelection =
            typeof updaterOrValue === 'function'
                ? updaterOrValue(rowSelections[pageNo] || {})
                : updaterOrValue;

        setRowSelections((prev) => ({
            ...prev,
            [pageNo]: newSelection,
        }));
    };

    const handleSearch = (searchValue: string) => {
        setSearchText(searchValue);
        getParticipantsData.mutate({
            pageNo,
            pageSize: 10,
            selectedFilter: {
                ...selectedFilter,
                name: searchValue,
            },
        });
    };

    const clearSearch = () => {
        setSearchText('');
        selectedFilter['name'] = '';
        getParticipantsData.mutate({
            pageNo,
            pageSize: 10,
            selectedFilter: {
                ...selectedFilter,
                name: '',
            },
        });
    };

    const handleFilterChange = (filterKey: string, selectedItems: MyFilterOption[]) => {
        setSelectedFilter((prev) => {
            const updatedFilters = { ...prev, [filterKey]: selectedItems };
            return updatedFilters;
        });
    };

    const handleResetFilters = () => {
        setSelectedFilter((prevFilter) => ({
            ...prevFilter,
            name: '',
            gender: [],
        }));
        setSearchText('');
        getParticipantsData.mutate({
            pageNo,
            pageSize: 10,
            selectedFilter: {
                ...selectedFilter,
                name: '',
                gender: [],
            },
        });
    };

    const handleSubmitFilters = () => {
        getParticipantsData.mutate({
            pageNo,
            pageSize: 10,
            selectedFilter,
        });
    };

    return (
        <Dialog>
            <DialogTrigger>
                <div className="flex items-center">
                    <span
                        className="text-sm text-primary-500"
                        onClick={handleGetParticipantsDetails}
                    >
                        {t('trigger.viewList')}
                    </span>
                </div>
            </DialogTrigger>
            <DialogContent className="no-scrollbar !m-0 flex h-[90vh] !w-full !max-w-[90vw] flex-col gap-6 overflow-y-auto !p-0">{/* design-lint-ignore: vh/vw dialog sizing matches MyDialog primitive */}
                <h1 className="rounded-t-lg bg-primary-100 p-4 font-semibold text-primary-500">
                    {t('dialog.title')}
                </h1>
                {getParticipantsData.status === 'pending' ? (
                    <DashboardLoader />
                ) : (
                    <div className="flex flex-col gap-6 px-4">
                        <div className="flex items-center gap-6">
                            <AssessmentDetailsSearchComponent
                                onSearch={handleSearch}
                                searchText={searchText}
                                setSearchText={setSearchText}
                                clearSearch={clearSearch}
                            />
                            <ScheduleTestFilters
                                label={t('filters.genderLabel')}
                                data={initData?.genders.map((gender, idx) => ({
                                    id: String(idx),
                                    name: gender,
                                }))}
                                selectedItems={selectedFilter['gender'] || []}
                                onSelectionChange={(items) => handleFilterChange('gender', items)}
                            />
                            <Step3ParticipantsFilterButtons
                                selectedQuestionPaperFilters={selectedFilter}
                                handleSubmitFilters={handleSubmitFilters}
                                handleResetFilters={handleResetFilters}
                            />
                        </div>
                        <MyTable
                            data={{
                                content: getAssessmentStep3ParticipantsListWithBatchName(
                                    participantsData.content,
                                    initData?.batches_for_sessions || []
                                ),
                                total_pages: participantsData.total_pages,
                                page_no: pageNo,
                                page_size: 10,
                                total_elements: participantsData.total_elements,
                                last: participantsData.last,
                            }}
                            columns={step3ParticipantsListColumn || []}
                            rowSelection={currentPageSelection}
                            onRowSelectionChange={handleRowSelectionChange}
                            currentPage={pageNo}
                        />
                        <MyPagination
                            currentPage={pageNo}
                            totalPages={participantsData.total_pages}
                            onPageChange={handlePageChange}
                        />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
interface ScheduleTestFilterButtonsProps {
    selectedQuestionPaperFilters: AssessmentParticipantsInterface;
    handleSubmitFilters: () => void;
    handleResetFilters: () => void;
}

export const Step3ParticipantsFilterButtons = ({
    selectedQuestionPaperFilters,
    handleSubmitFilters,
    handleResetFilters,
}: ScheduleTestFilterButtonsProps) => {
    const { t } = useTranslation('assessmentParticipantsList');
    const isButtonEnabled = () => {
        const { name, gender } = selectedQuestionPaperFilters;
        return name || gender?.length > 0;
    };
    return (
        <>
            {!!isButtonEnabled() && (
                <div className="flex gap-6">
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        layoutVariant="default"
                        className="h-8"
                        onClick={handleSubmitFilters}
                    >
                        {t('filterButtons.filter')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        layoutVariant="default"
                        className="h-8 border border-neutral-400 bg-neutral-200 hover:border-neutral-500 hover:bg-neutral-300 active:border-neutral-600 active:bg-neutral-400"
                        onClick={handleResetFilters}
                    >
                        {t('filterButtons.reset')}
                    </MyButton>
                </div>
            )}
        </>
    );
};
