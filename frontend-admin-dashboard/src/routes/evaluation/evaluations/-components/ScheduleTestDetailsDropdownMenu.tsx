import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNavigate } from '@tanstack/react-router';
import { DotsThree, Info } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { TestContent } from '@/types/assessments/schedule-test-list';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { getInstituteId } from '@/constants/helper';
import { useAssessmentActionVisibility } from '@/lib/display-settings/assessment-actions';
import {
    AssessmentSlideCascadeOption,
    deleteLinkedAssessmentSlides,
    useLinkedAssessmentSlides,
} from '@/components/common/assessment/assessment-slide-cascade';
import { handleDeleteAssessment } from '@/routes/assessment/assessment-list/-services/assessment-services';

export function ScheduleTestDetailsDropdownLive({
    scheduleTestContent,
    handleRefetchData,
}: {
    scheduleTestContent: TestContent;
    handleRefetchData: () => void;
}) {
    const { t } = useTranslation('evaluationScheduleTestDetailsDropdownMenu');
    const [isRemiderAlertDialogOpen, setIsRemiderAlertDialogOpen] = useState(false);
    const [isDeleteAssessmentDialog, setIsDeleteAssessmentDialog] = useState(false);
    const [isPauseLiveStatausDialog, setIsPauseLiveStatausDialog] = useState(false);
    const [isResumeLiveStatusDialog, setIsResumeLiveStatusDialog] = useState(false);
    const navigate = useNavigate();
    const handleNavigateAssessment = (assessmentId: string) => {
        navigate({
            to: '/evaluation/evaluations/assessment-details/$assessmentId/$examType/$assesssmentType',
            params: {
                assessmentId: assessmentId,
                examType: scheduleTestContent.play_mode,
                assesssmentType: scheduleTestContent.assessment_visibility,
            },
        });
    };

    const { canDelete } = useAssessmentActionVisibility();
    const handleDeleteAssessmentClick = (assessmentId: string) => {
        console.log(assessmentId);
        setIsDeleteAssessmentDialog(true);
    };
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="w-6 !min-w-6"
                    >
                        <DotsThree size={32} />
                    </MyButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleNavigateAssessment(scheduleTestContent.assessment_id)}
                    >
                        {t('viewAssessmentDetails')}
                    </DropdownMenuItem>
                    {canDelete && (
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAssessmentClick(scheduleTestContent.assessment_id);
                            }}
                        >
                            {t('deleteAssessment')}
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            {isRemiderAlertDialogOpen && (
                <ScheduleTestReminderDialog onClose={() => setIsRemiderAlertDialogOpen(false)} />
            )}
            {isDeleteAssessmentDialog && (
                <ScheduleTestDeleteDialog
                    handleRefetchData={handleRefetchData}
                    scheduleTestContent={scheduleTestContent}
                    onClose={() => setIsDeleteAssessmentDialog(false)}
                />
            )}
            {isPauseLiveStatausDialog && (
                <ScheduleTestPauseDialog onClose={() => setIsPauseLiveStatausDialog(false)} />
            )}
            {isResumeLiveStatusDialog && (
                <ScheduleTestResumeDialog onClose={() => setIsResumeLiveStatusDialog(false)} />
            )}
        </>
    );
}

export function ScheduleTestDetailsDropdownUpcoming({
    scheduleTestContent,
    handleRefetchData,
}: {
    scheduleTestContent: TestContent;
    handleRefetchData: () => void;
}) {
    const { t } = useTranslation('evaluationScheduleTestDetailsDropdownMenu');
    const [isDeleteAssessmentDialog, setIsDeleteAssessmentDialog] = useState(false);
    const navigate = useNavigate();
    const handleNavigateAssessment = (assessmentId: string) => {
        navigate({
            to: '/evaluation/evaluations/assessment-details/$assessmentId/$examType/$assesssmentType',
            params: {
                assessmentId: assessmentId,
                examType: scheduleTestContent.play_mode,
                assesssmentType: scheduleTestContent.assessment_visibility,
            },
        });
    };

    const { canDelete } = useAssessmentActionVisibility();
    const handleDeleteAssessmentClick = (assessmentId: string) => {
        console.log(assessmentId);
        setIsDeleteAssessmentDialog(true);
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="w-6 !min-w-6"
                    >
                        <DotsThree size={32} />
                    </MyButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleNavigateAssessment(scheduleTestContent.assessment_id)}
                    >
                        {t('viewAssessmentDetails')}
                    </DropdownMenuItem>

                    {canDelete && (
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAssessmentClick(scheduleTestContent.assessment_id);
                            }}
                        >
                            {t('deleteAssessment')}
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            {isDeleteAssessmentDialog && (
                <ScheduleTestDeleteDialog
                    handleRefetchData={handleRefetchData}
                    scheduleTestContent={scheduleTestContent}
                    onClose={() => setIsDeleteAssessmentDialog(false)}
                />
            )}
        </>
    );
}

export function ScheduleTestDetailsDropdownPrevious({
    scheduleTestContent,
    handleRefetchData,
}: {
    scheduleTestContent: TestContent;
    handleRefetchData: () => void;
}) {
    const { t } = useTranslation('evaluationScheduleTestDetailsDropdownMenu');
    const [isDeleteAssessmentDialog, setIsDeleteAssessmentDialog] = useState(false);
    const [isReopenAssessment, setIsReopenAssessment] = useState(false);
    const navigate = useNavigate();
    const handleNavigateAssessment = (assessmentId: string) => {
        navigate({
            to: '/evaluation/evaluations/assessment-details/$assessmentId/$examType/$assesssmentType',
            params: {
                assessmentId: assessmentId,
                examType: scheduleTestContent.play_mode,
                assesssmentType: scheduleTestContent.assessment_visibility,
            },
        });
    };

    const { canDelete } = useAssessmentActionVisibility();
    const handleDeleteAssessmentClick = (assessmentId: string) => {
        console.log(assessmentId);
        setIsDeleteAssessmentDialog(true);
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="w-6 !min-w-6"
                    >
                        <DotsThree size={32} />
                    </MyButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleNavigateAssessment(scheduleTestContent.assessment_id)}
                    >
                        {t('viewAssessmentDetails')}
                    </DropdownMenuItem>

                    {canDelete && (
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAssessmentClick(scheduleTestContent.assessment_id);
                            }}
                        >
                            {t('deleteAssessment')}
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            {isDeleteAssessmentDialog && (
                <ScheduleTestDeleteDialog
                    handleRefetchData={handleRefetchData}
                    scheduleTestContent={scheduleTestContent}
                    onClose={() => setIsDeleteAssessmentDialog(false)}
                />
            )}
            {isReopenAssessment && (
                <ScheduleTestReopenDialog onClose={() => setIsReopenAssessment(false)} />
            )}
        </>
    );
}

export function ScheduleTestDetailsDropdowDrafts({
    scheduleTestContent,
    handleRefetchData,
}: {
    scheduleTestContent: TestContent;
    handleRefetchData: () => void;
}) {
    const { t } = useTranslation('evaluationScheduleTestDetailsDropdownMenu');
    const [isDeleteAssessmentDialog, setIsDeleteAssessmentDialog] = useState(false);
    const navigate = useNavigate();
    const handleNavigateAssessment = (assessmentId: string) => {
        navigate({
            to: '/evaluation/evaluations/assessment-details/$assessmentId/$examType/$assesssmentType',
            params: {
                assessmentId: assessmentId,
                examType: scheduleTestContent.play_mode,
                assesssmentType: scheduleTestContent.assessment_visibility,
            },
        });
    };
    const { canDelete } = useAssessmentActionVisibility();
    const handleDeleteAssessmentClick = (assessmentId: string) => {
        console.log(assessmentId);
        setIsDeleteAssessmentDialog(true);
    };
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="w-6 !min-w-6"
                    >
                        <DotsThree size={32} />
                    </MyButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleNavigateAssessment(scheduleTestContent.assessment_id)}
                    >
                        {t('viewAssessmentDetails')}
                    </DropdownMenuItem>
                    {canDelete && (
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAssessmentClick(scheduleTestContent.assessment_id);
                            }}
                        >
                            {t('deleteAssessment')}
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            {isDeleteAssessmentDialog && (
                <ScheduleTestDeleteDialog
                    handleRefetchData={handleRefetchData}
                    scheduleTestContent={scheduleTestContent}
                    onClose={() => setIsDeleteAssessmentDialog(false)}
                />
            )}
        </>
    );
}

export function ScheduleTestMainDropdownComponent({
    scheduleTestContent,
    selectedTab,
    handleRefetchData,
}: {
    scheduleTestContent: TestContent;
    selectedTab: string;
    handleRefetchData: () => void;
}) {
    switch (selectedTab) {
        case 'liveTests':
            return (
                <ScheduleTestDetailsDropdownLive
                    scheduleTestContent={scheduleTestContent}
                    handleRefetchData={handleRefetchData}
                />
            );
        case 'upcomingTests':
            return (
                <ScheduleTestDetailsDropdownUpcoming
                    scheduleTestContent={scheduleTestContent}
                    handleRefetchData={handleRefetchData}
                />
            );
        case 'previousTests':
            return (
                <ScheduleTestDetailsDropdownPrevious
                    scheduleTestContent={scheduleTestContent}
                    handleRefetchData={handleRefetchData}
                />
            );
        case 'draftTests':
            return (
                <ScheduleTestDetailsDropdowDrafts
                    scheduleTestContent={scheduleTestContent}
                    handleRefetchData={handleRefetchData}
                />
            );
        default:
            return null;
    }
}

const ScheduleTestReminderDialog = ({ onClose }: { onClose: () => void }) => {
    const { t } = useTranslation('evaluationScheduleTestDetailsDropdownMenu');
    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogTrigger>{t('open')}</DialogTrigger>
            <DialogContent className="flex w-[500px] flex-col p-0">
                <h1 className="rounded-lg bg-primary-50 p-4 text-primary-500">
                    {t('sendReminder')}
                </h1>
                <div className="flex flex-col gap-4 p-4 pt-3">
                    <div className="flex items-center gap-1">
                        <span className="text-danger-600">{t('attention')}</span>
                        <Info size={18} className="text-danger-600" />
                    </div>
                    <h1 className="-mt-2 font-thin">
                        {t('reminderBody.prefix')}
                        <span className="text-primary-500">
                            {' '}
                            {t('reminderBody.participantCount', { count: 56 })}{' '}
                        </span>
                        {t('reminderBody.suffix')}
                    </h1>
                    <div className="mt-2 flex justify-end">
                        <MyButton type="button" scale="large" buttonType="primary">
                            {t('send')}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const ScheduleTestDeleteDialog = ({
    handleRefetchData,
    scheduleTestContent,
    onClose,
}: {
    handleRefetchData: () => void;
    scheduleTestContent: TestContent;
    onClose: () => void;
}) => {
    const { t } = useTranslation('evaluationScheduleTestDetailsDropdownMenu');
    const instituteId = getInstituteId();
    // An assessment created from a course slide is only half-deleted if the slide
    // survives, so offer to take both — ticked by default.
    const [alsoDeleteSlides, setAlsoDeleteSlides] = useState(true);
    const { data: linkedSlides = [], isLoading: isLoadingLinkedSlides } =
        useLinkedAssessmentSlides(scheduleTestContent.assessment_id);

    const handleDeleteAssessmentMutation = useMutation({
        mutationFn: async ({
            assessmentId,
            instituteId,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
        }) => {
            const result = await handleDeleteAssessment(assessmentId, instituteId);
            // After the assessment, so a failure here can't leave the assessment
            // alive while its slides are gone. Not gated on linkedSlides being
            // loaded — the lookup may still be in flight when Delete is clicked,
            // and the endpoint is idempotent (returns 0 when there is nothing).
            if (alsoDeleteSlides) {
                try {
                    await deleteLinkedAssessmentSlides(assessmentId);
                } catch (slideError) {
                    // The assessment is already gone; reporting a blanket failure
                    // here would read as "nothing was deleted" and invite a retry
                    // that then 404s. Report the partial outcome instead.
                    console.error('Failed to delete linked assessment slides:', slideError);
                    toast.warning(t('toasts.slideDeleteFailed'), { duration: 4000 });
                }
            }
            return result;
        },
        onSuccess: async () => {
            toast.success(t('toasts.deleteSuccess'), {
                className: 'success-toast',
                duration: 2000,
            });
            onClose();
            handleRefetchData();
        },
        onError: (error: unknown) => {
            if (error instanceof AxiosError) {
                toast.error(error.message, {
                    className: 'error-toast',
                    duration: 2000,
                });
            } else {
                // Handle non-Axios errors if necessary
                console.error('Unexpected error:', error);
            }
        },
    });

    const deleteAssessment = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        handleDeleteAssessmentMutation.mutate({
            assessmentId: scheduleTestContent.assessment_id,
            instituteId,
        });
    };
    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogTrigger>{t('open')}</DialogTrigger>
            <DialogContent className="flex w-[500px] flex-col p-0">
                <h1 className="rounded-lg bg-primary-50 p-4 text-primary-500">
                    {t('deleteAssessment')}
                </h1>
                <div className="flex flex-col gap-4 p-4 pt-3">
                    <div className="flex items-center gap-1">
                        <span className="text-danger-600">{t('attention')}</span>
                        <Info size={18} className="text-danger-600" />
                    </div>
                    <h1 className="-mt-2 font-thin">
                        {t('deleteConfirm.prefix')}
                        <span className="text-primary-500">&nbsp;{scheduleTestContent.name}</span>?
                    </h1>
                    <AssessmentSlideCascadeOption
                        linkedSlides={linkedSlides}
                        checked={alsoDeleteSlides}
                        onCheckedChange={setAlsoDeleteSlides}
                        isLoading={isLoadingLinkedSlides}
                    />
                    <div className="mt-2 flex justify-end">
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            onClick={deleteAssessment}
                        >
                            {t('delete')}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const ScheduleTestPauseDialog = ({ onClose }: { onClose: () => void }) => {
    const { t } = useTranslation('evaluationScheduleTestDetailsDropdownMenu');
    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogTrigger>{t('open')}</DialogTrigger>
            <DialogContent className="flex w-[500px] flex-col p-0">
                <h1 className="rounded-lg bg-primary-50 p-4 text-primary-500">
                    {t('pauseLiveStatus')}
                </h1>
                <div className="flex flex-col gap-4 p-4 pt-3">
                    <div>
                        <h1 className="mb-1 text-sm">
                            {t('date')} <span className="text-danger-600">*</span>
                        </h1>
                        <Input type="date" placeholder={t('date')} />
                    </div>
                    <div className="text-sm">
                        <h1 className="mb-1 text-sm">
                            {t('pauseUntil')} <span className="text-danger-600">*</span>
                        </h1>
                        <Input type="time" placeholder={t('time')} />
                    </div>
                    <div className="mt-2 flex justify-end">
                        <MyButton type="button" scale="large" buttonType="primary">
                            {t('pause')}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const ScheduleTestResumeDialog = ({ onClose }: { onClose: () => void }) => {
    const { t } = useTranslation('evaluationScheduleTestDetailsDropdownMenu');
    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogTrigger>{t('open')}</DialogTrigger>
            <DialogContent className="flex w-[500px] flex-col p-0">
                <h1 className="rounded-lg bg-primary-50 p-4 text-primary-500">
                    {t('resumeLiveStatus')}
                </h1>
                <div className="flex flex-col gap-4 p-4 pt-3">
                    <div className="flex items-center gap-1">
                        <span className="text-danger-600">{t('attention')}</span>
                        <Info size={18} className="text-danger-600" />
                    </div>
                    <h1 className="-mt-2 font-thin">
                        {t('resumeConfirm.prefix')}
                        <span className="text-primary-500">
                            &nbsp;{t('resumeConfirm.assessmentName')}
                        </span>
                        ?
                    </h1>
                    <div className="mt-2 flex justify-end">
                        <MyButton type="button" scale="large" buttonType="primary">
                            {t('resume')}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const ScheduleTestReopenDialog = ({ onClose }: { onClose: () => void }) => {
    const { t } = useTranslation('evaluationScheduleTestDetailsDropdownMenu');
    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogTrigger>{t('open')}</DialogTrigger>
            <DialogContent className="flex w-[500px] flex-col p-0">
                <h1 className="rounded-lg bg-primary-50 p-4 text-primary-500">
                    {t('reopenAssessment')}
                </h1>
                <div className="flex flex-col gap-4 p-4 pt-3">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-1">
                            <span className="text-danger-600">{t('attention')}</span>
                            <Info size={18} className="text-danger-600" />
                        </div>
                        <h1 className="-mt-2 font-thin">
                            {t('reminderBody.prefix')}
                            <span className="text-primary-500">
                                {' '}
                                {t('reminderBody.participantCount', { count: 56 })}{' '}
                            </span>
                            {t('reminderBody.suffix')}
                        </h1>
                    </div>
                    <h1>{t('selectReopenDateTime')}</h1>
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="mb-1 text-sm">
                                {t('startDateTime')} <span className="text-danger-600">*</span>
                            </h1>
                            <Input type="datetime-local" placeholder={t('date')} />
                        </div>
                        <div className="text-sm">
                            <h1 className="mb-1 text-sm">
                                {t('endDateTime')} <span className="text-danger-600">*</span>
                            </h1>
                            <Input type="datetime-local" placeholder={t('time')} />
                        </div>
                    </div>
                    <div className="mt-2 flex justify-end">
                        <MyButton type="button" scale="large" buttonType="primary">
                            {t('reopen')}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
