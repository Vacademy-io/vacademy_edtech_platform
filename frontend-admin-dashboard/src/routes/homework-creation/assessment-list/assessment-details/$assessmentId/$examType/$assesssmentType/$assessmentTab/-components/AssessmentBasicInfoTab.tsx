import { Separator } from '@/components/ui/separator';
import { getAssessmentDetails } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useSuspenseQuery } from '@tanstack/react-query';
import { CheckCircle } from '@phosphor-icons/react';
import { Route } from '..';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { convertToLocalDateTime } from '@/constants/helper';
import {
    resolveSubjectName,
    unresolvedSubjectIds,
    useSubjectNamesByIds,
} from '@/services/subject-names';
import { useTranslation } from 'react-i18next';

export const AssessmentBasicInfoTab = () => {
    const { t } = useTranslation('homeworkCreationAssessmentBasicInfoTab');
    const { assessmentId, examType } = Route.useParams();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        })
    );
    // Before the early return. The institute list keeps one subject per distinct name and
    // drops subjects whose course was deleted, so most stored ids need the direct lookup.
    const savedSubjectId = assessmentDetails[0]?.saved_data?.subject_selection;
    const subjectNamesById = useSubjectNamesByIds(
        unresolvedSubjectIds(instituteDetails?.subjects, [savedSubjectId])
    );
    if (isLoading) return <DashboardLoader />;
    return (
        <>
            <div className="mt-4 flex flex-col gap-8">
                <div className="flex flex-col gap-6">
                    <h1 className="text-sm font-semibold">
                        {t('fields.homeworkName.label')}{' '}
                        <span className="font-thin">{assessmentDetails[0]?.saved_data?.name}</span>
                    </h1>
                    <h1 className="text-sm font-semibold">
                        {t('fields.subject.label')}{' '}
                        <span className="font-thin">
                            {resolveSubjectName(
                                instituteDetails?.subjects,
                                subjectNamesById,
                                savedSubjectId
                            )}
                        </span>
                    </h1>
                    <div className="flex flex-col gap-1 text-sm">
                        <h1 className="font-semibold">
                            {t('fields.assessmentInstructions.sectionTitle')}
                        </h1>
                        <div
                            dangerouslySetInnerHTML={{
                                __html:
                                    assessmentDetails[0]?.saved_data?.instructions?.content || '',
                            }}
                        />
                    </div>
                </div>
                <div className="flex flex-col gap-1 font-semibold">
                    <h1>{t('fields.liveDateRange.sectionTitle')}</h1>
                    <div className="flex items-center gap-8">
                        <h1 className="text-sm">
                            {t('fields.liveDateRange.startDateLabel')}{' '}
                            <span className="font-thin">
                                {' '}
                                {convertToLocalDateTime(
                                    assessmentDetails[0]?.saved_data?.boundation_start_date ?? ''
                                )}
                            </span>{' '}
                        </h1>
                        <h1 className="text-sm">
                            {t('fields.liveDateRange.endDateLabel')}{' '}
                            <span className="font-thin">
                                {' '}
                                {convertToLocalDateTime(
                                    assessmentDetails[0]?.saved_data?.boundation_end_date ?? ''
                                )}
                            </span>{' '}
                        </h1>
                    </div>
                </div>
                <Separator className="my-6" />
                <div className="flex w-1/2 flex-col gap-4">
                    <h1 className="font-semibold">{t('fields.attemptSettings.sectionTitle')}</h1>
                    {examType === 'EXAM' && (
                        <div className="flex items-center gap-6 text-sm">
                            <h1 className="whitespace-nowrap font-semibold">
                                {t('fields.attemptSettings.reattemptCountLabel')}
                            </h1>
                            <h1 className="whitespace-nowrap font-thin">
                                {assessmentDetails[0]?.saved_data?.reattempt_count}
                            </h1>
                        </div>
                    )}
                    <div className="flex items-center gap-6 text-sm">
                        <h1 className="whitespace-nowrap font-semibold">
                            {t('fields.attemptSettings.durationSettingsLabel')}
                        </h1>
                        <h1 className="whitespace-nowrap font-thin">
                            {t('fields.attemptSettings.entireDurationLabel')}
                        </h1>
                        <h1 className="whitespace-nowrap font-thin">
                            {t('fields.attemptSettings.minuteValue', {
                                count: assessmentDetails[1]?.saved_data?.duration,
                            })}
                        </h1>
                    </div>
                    {(assessmentDetails[0]?.saved_data?.assessment_preview ?? 0) > 0 && (
                        <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-6">
                                <h1 className="font-semibold">
                                    {t('fields.attemptSettings.previewLabel')}
                                </h1>
                                <h1 className="font-thin">
                                    {t('fields.attemptSettings.minuteValue', {
                                        count: assessmentDetails[0]?.saved_data
                                            ?.assessment_preview,
                                    })}
                                </h1>
                            </div>
                            <CheckCircle size={22} weight="fill" className="text-success-600" />
                        </div>
                    )}
                    {assessmentDetails[0]?.saved_data?.can_switch_section && (
                        <div className="flex items-center justify-between text-sm">
                            <h1 className="font-semibold">
                                {t('fields.attemptSettings.switchSectionsLabel')}
                            </h1>
                            <CheckCircle size={22} weight="fill" className="text-success-600" />
                        </div>
                    )}
                    {/* will be adding this later
                    {assessmentDetails[0]?.saved_data?.reattempt_consent && (
                        <div className="flex items-center justify-between text-sm">
                            <h1 className="font-semibold">
                                Allow participants to raise reattempt request
                            </h1>
                            <CheckCircle size={22} weight="fill" className="text-success-600" />
                        </div>
                    )}
                    {assessmentDetails[0]?.saved_data?.add_time_consent && (
                        <div className="flex items-center justify-between text-sm">
                            <h1 className="font-semibold">
                                Allow participants to raise time increase request
                            </h1>
                            <CheckCircle size={22} weight="fill" className="text-success-600" />
                        </div>
                    )} */}
                </div>
            </div>
        </>
    );
};
