import { TestContent } from '@/types/assessments/schedule-test-list';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CheckCircle, Copy, DownloadSimple, LockSimple, PauseCircle } from '@phosphor-icons/react';
import QRCode from 'react-qr-code';
import { convertToLocalDateTime } from '@/constants/helper';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    copyToClipboard,
    handleDownloadQRCode,
} from '../../create-assessment/$assessmentId/$examtype/-utils/helper';
import { ScheduleTestMainDropdownComponent } from './ScheduleTestDetailsDropdownMenu';
import { getAssessmentJoinUrl } from '@/lib/learner-portal-url';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { getBatchNamesByIds } from '../assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-utils/helper';
import { resolveSubjectName } from '@/services/subject-names';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { useTranslation } from 'react-i18next';

const ScheduleTestDetails = ({
    scheduleTestContent,
    selectedTab,
    handleRefetchData,
    subjectNamesById = {},
}: {
    scheduleTestContent: TestContent;
    selectedTab: string;
    handleRefetchData: () => void;
    /** Names for the subject ids the institute list cannot resolve — see subject-names.ts. */
    subjectNamesById?: Record<string, string>;
}) => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const navigate = useNavigate();
    const { t: tHelper } = useTranslation('homeworkCreationCreateAssessmentHelper');
    const { data: instituteDetails, isLoading } = useSuspenseQuery(useInstituteQuery());
    const batchIdsList = getBatchNamesByIds(
        instituteDetails?.batches_for_sessions,
        scheduleTestContent.batch_ids
    );
    // Share links must sit on the institute's own learner domain, otherwise the
    // link and its WhatsApp preview are both branded Vacademy. (The previous
    // inline template literals also wrapped across lines, so the copied link
    // and the QR code carried a newline + indentation inside the URL.)
    const joinUrl = getAssessmentJoinUrl(
        scheduleTestContent.join_link,
        instituteDetails?.learner_portal_base_url
    );
    const qrCodeId = `qr-code-svg-assessment-list-${scheduleTestContent.join_link}`;
    const handleNavigateAssessment = (assessmentId: string) => {
        if (!isDialogOpen) {
            navigate({
                to: '/homework-creation/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab',
                params: {
                    assessmentId: assessmentId,
                    examType: scheduleTestContent.play_mode,
                    assesssmentType: scheduleTestContent.assessment_visibility,
                    assessmentTab: selectedTab,
                },
            });
        }
    };

    if (isLoading) return <DashboardLoader />;
    return (
        <div
            className="my-6 flex cursor-pointer flex-col gap-4 rounded-xl border bg-neutral-50 p-4"
            onClick={() => handleNavigateAssessment(scheduleTestContent.assessment_id)}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h1 className="font-semibold">{scheduleTestContent.name}</h1>
                    <Badge
                        className={`rounded-md border border-neutral-300 ${
                            scheduleTestContent.assessment_visibility === 'PRIVATE'
                                ? 'bg-primary-50'
                                : 'bg-info-50'
                        } py-1.5 shadow-none`}
                    >
                        <LockSimple size={16} className="mr-2" />
                        {scheduleTestContent.assessment_visibility}
                    </Badge>
                    <Separator orientation="vertical" className="h-8 w-px bg-neutral-300" />
                    <Badge
                        className={`rounded-md border ${
                            scheduleTestContent.status === 'PUBLISHED'
                                ? 'bg-success-50'
                                : 'bg-neutral-100'
                        } border-neutral-300 py-1.5 shadow-none`}
                    >
                        {scheduleTestContent.status === 'PUBLISHED' ? (
                            <CheckCircle
                                size={16}
                                weight="fill"
                                className="mr-2 text-success-600"
                            />
                        ) : (
                            <PauseCircle
                                size={16}
                                weight="fill"
                                className="mr-2 text-neutral-400"
                            />
                        )}
                        {scheduleTestContent.status}
                    </Badge>
                </div>
                <div className="flex items-center gap-4">
                    {batchIdsList.length > 0 && (
                        <Badge className="rounded-md border border-primary-200 bg-primary-50 py-1.5 shadow-none">
                            {batchIdsList[0]}
                        </Badge>
                    )}
                    {batchIdsList.length - 1 > 0 && (
                        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                            <DialogTrigger onClick={(e) => e.stopPropagation()}>
                                <span className="text-sm text-primary-500">
                                    +{batchIdsList.length - 1} more
                                </span>
                            </DialogTrigger>
                            <DialogContent className="p-0">
                                <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                                    Homework Batches
                                </h1>
                                <ul className="flex list-disc flex-col gap-4 pb-4 pl-8 pr-4">
                                    {batchIdsList.map((batchId, idx) => {
                                        if (idx === 0) return null;
                                        return <li key={idx}>{batchId}</li>;
                                    })}
                                </ul>
                            </DialogContent>
                        </Dialog>
                    )}
                    <ScheduleTestMainDropdownComponent
                        scheduleTestContent={scheduleTestContent}
                        selectedTab={selectedTab}
                        handleRefetchData={handleRefetchData}
                    />
                </div>
            </div>
            <div className="flex w-full items-start justify-start gap-8 text-sm text-neutral-500">
                <div className="flex flex-col gap-4">
                    <p>Created on: {convertToLocalDateTime(scheduleTestContent.created_at)}</p>
                    <p>
                        {getTerminology(ContentTerms.Subjects, SystemTerms.Subjects)}:{' '}
                        {resolveSubjectName(
                            instituteDetails?.subjects,
                            subjectNamesById,
                            scheduleTestContent.subject_id
                        ) || 'N/A'}
                    </p>
                </div>
                <div className="flex flex-col gap-4">
                    {(scheduleTestContent.play_mode === 'EXAM' ||
                        scheduleTestContent.play_mode === 'SURVEY') && (
                        <p>
                            Start Date and Time:{' '}
                            {convertToLocalDateTime(scheduleTestContent.bound_start_time)}
                        </p>
                    )}
                    {(scheduleTestContent.play_mode === 'EXAM' ||
                        scheduleTestContent.play_mode === 'MOCK') && (
                        <p>
                            <span className="font-normal text-neutral-500">Duration: </span>
                            {scheduleTestContent.duration >= 60 ? (
                                <span>{(scheduleTestContent.duration / 60).toFixed(2)} hrs</span>
                            ) : (
                                <span>{scheduleTestContent.duration} min</span>
                            )}
                        </p>
                    )}
                </div>
                <div className="flex flex-col gap-4">
                    {(scheduleTestContent.play_mode === 'EXAM' ||
                        scheduleTestContent.play_mode === 'SURVEY') && (
                        <p>
                            End Date and Time:{' '}
                            {convertToLocalDateTime(scheduleTestContent.bound_end_time)}
                        </p>
                    )}
                    <p>Total Participants: {scheduleTestContent.user_registrations}</p>
                </div>
            </div>
            <div className="flex justify-between">
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                    <h1 className="!font-normal text-black">Join Link:</h1>
                    <span className="px-3 py-2 text-sm underline">{joinUrl}</span>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="h-8 min-w-8"
                        onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(joinUrl);
                        }}
                    >
                        <Copy size={32} />
                    </MyButton>
                </div>
                <div className="flex items-center gap-4">
                    <QRCode value={joinUrl} className="size-16" id={qrCodeId} />
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="h-8 min-w-8"
                        onClick={(e) => {
                            handleDownloadQRCode(qrCodeId, tHelper);
                            e.stopPropagation();
                        }}
                    >
                        <DownloadSimple size={32} />
                    </MyButton>
                </div>
            </div>
        </div>
    );
};

export default ScheduleTestDetails;
