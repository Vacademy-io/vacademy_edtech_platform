/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBatchDetailsListOfIndividualStudents } from '../-services/assessment-details-services';
import { MyTable } from '@/components/design-system/table';
import { buildStep3ParticipantsListIndividualStudentColumn } from '../-utils/student-columns';
import { getAssessmentStep3ParticipantsListIndividualStudents } from '../-utils/helper';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyFilterOption } from '@/types/assessments/my-filter';
import { Route } from '..';
import { getInstituteId } from '@/constants/helper';

export interface AssessmentParticipantsInterface {
    name: string;
    statuses: string[];
    institute_ids: string[];
    package_session_ids: string[];
    group_ids: string[];
    gender: MyFilterOption[];
    sort_columns: Record<string, string>; // For dynamic keys in sort_columns
}

export const AssessmentParticipantsIndividualList = ({ type }: { type: string }) => {
    const { t: tStudentColumns } = useTranslation('homeworkCreationStudentColumns');
    const instituteId = getInstituteId();
    const { assessmentId } = Route.useParams();
    const [participantsData, setParticipantsData] = useState([]);

    const getParticipantsData = useMutation({
        mutationFn: ({
            instituteId,
            assessmentId,
        }: {
            instituteId: string | undefined;
            assessmentId: string;
        }) => getBatchDetailsListOfIndividualStudents(instituteId, assessmentId),
        onSuccess: (data) => {
            setParticipantsData(data);
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleGetParticipantsDetails = () => {
        getParticipantsData.mutate({
            instituteId,
            assessmentId,
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
                        View List
                    </span>
                </div>
            </DialogTrigger>
            <DialogContent className="no-scrollbar !m-0 flex h-[90vh] !w-full !max-w-[90vw] flex-col gap-6 overflow-y-auto !p-0">{/* design-lint-ignore: vh/vw dialog sizing matches MyDialog primitive */}
                <h1 className="rounded-t-lg bg-primary-100 p-4 font-semibold text-primary-500">
                    Individual Learner List
                </h1>
                {getParticipantsData.status === 'pending' ? (
                    <DashboardLoader />
                ) : (
                    <div className="flex flex-col gap-6 px-4">
                        <MyTable
                            data={{
                                content: getAssessmentStep3ParticipantsListIndividualStudents(
                                    participantsData.filter((item) =>
                                        type === 'internal'
                                            ? item.source === 'ADMIN_PRE_REGISTRATION' ||
                                              item.source === 'BATCH_PREVIEW_REGISTRATION'
                                            : item.source === 'OPEN_REGISTRATION'
                                    )
                                ),
                                total_pages: 0,
                                page_no: 0,
                                page_size: 10,
                                total_elements: 0,
                                last: false,
                            }}
                            columns={
                                buildStep3ParticipantsListIndividualStudentColumn(
                                    tStudentColumns
                                ) || []
                            }
                            currentPage={0}
                        />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
