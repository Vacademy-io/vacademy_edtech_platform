import { MyButton } from '@/components/design-system/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    // DropdownMenuSub,
    // DropdownMenuSubTrigger,
    // DropdownMenuSubContent,
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
import { handleDeleteAssessment } from '../-services/assessment-services';
import { useTranslation } from 'react-i18next';

export function ScheduleTestDetailsDropdownLive({
    scheduleTestContent,
    handleRefetchData,
    selectedTab,
}: {
    scheduleTestContent: TestContent;
    handleRefetchData: () => void;
    selectedTab: string;
}) {
    const { t } = useTranslation('homeworkCreationScheduleTestDetailsDropdownMenu');
    const [isRemiderAlertDialogOpen, setIsRemiderAlertDialogOpen] = useState(false);
    const [isDeleteAssessmentDialog, setIsDeleteAssessmentDialog] = useState(false);
    const [isPauseLiveStatausDialog, setIsPauseLiveStatausDialog] = useState(false);
    const [isResumeLiveStatusDialog, setIsResumeLiveStatusDialog] = useState(false);
    const navigate = useNavigate();
    const handleNavigateAssessment = (assessmentId: string) => {
        navigate({
            to: '/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab',
            params: {
                assessmentId: assessmentId,
                examType: scheduleTestContent.play_mode,
                assesssmentType: scheduleTestContent.assessment_visibility,
                assessmentTab: selectedTab,
            },
        });
    };

    // const handleSendReminderClick = (assessmentId: string) => {
    //     console.log(assessmentId);
    //     setIsRemiderAlertDialogOpen(true);
    // };

    const { canDelete } = useAssessmentActionVisibility();
    const handleDeleteAssessmentClick = (assessmentId: string) => {
        console.log(assessmentId);
        setIsDeleteAssessmentDialog(true);
    };

    // const handleRescheduleAssessment = (assessmentId: string) => {
    //     console.log(assessmentId);
    // };

    // const handleDuplicateAssessment = (assessmentId: string) => {
    //     console.log(assessmentId);
    // };

    // const handlePauseLiveStatus = (assessmentId: string, value: number) => {
    //     console.log(assessmentId, value);
    // };

    // const handleCustomPauseLiveAssessment = (assessmentId: string) => {
    //     console.log(assessmentId);
    //     setIsPauseLiveStatausDialog(true);
    // };

    // const handleResumeLiveAssessment = (assessmentId: string) => {
    //     console.log(assessmentId);
    //     setIsResumeLiveStatusDialog(true);
    // };
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
                        {t('menu.viewHomeworkDetails')}
                    </DropdownMenuItem>
                    {/* <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleSendReminderClick(scheduleTestContent.assessment_id)}
                    >
                        Send Reminder
                    </DropdownMenuItem> */}
                    {/* <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="cursor-pointer">
                            Pause Live Status
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() =>
                                    handlePauseLiveStatus(scheduleTestContent.assessment_id, 30)
                                }
                            >
                                For 30 min
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() =>
                                    handlePauseLiveStatus(scheduleTestContent.assessment_id, 60)
                                }
                            >
                                For 1 Hour
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() =>
                                    handlePauseLiveStatus(scheduleTestContent.assessment_id, 120)
                                }
                            >
                                For 2 Hour
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() =>
                                    handleCustomPauseLiveAssessment(
                                        scheduleTestContent.assessment_id,
                                    )
                                }
                            >
                                Custom
                            </DropdownMenuItem>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub> */}
                    {/* <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() =>
                            handleResumeLiveAssessment(scheduleTestContent.assessment_id)
                        }
                    >
                        Resume Live Status
                    </DropdownMenuItem> */}
                    {/* <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() =>
                            handleRescheduleAssessment(scheduleTestContent.assessment_id)
                        }
                    >
                        Reschedule Assessment
                    </DropdownMenuItem> */}
                    {/* <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleDuplicateAssessment(scheduleTestContent.assessment_id)}
                    >
                        Duplicate Assessment
                    </DropdownMenuItem> */}
                    {canDelete && (
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAssessmentClick(scheduleTestContent.assessment_id);
                            }}
                        >
                            {t('menu.deleteHomework')}
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
    selectedTab,
}: {
    scheduleTestContent: TestContent;
    handleRefetchData: () => void;
    selectedTab: string;
}) {
    const { t } = useTranslation('homeworkCreationScheduleTestDetailsDropdownMenu');
    const [isDeleteAssessmentDialog, setIsDeleteAssessmentDialog] = useState(false);
    const navigate = useNavigate();
    const handleNavigateAssessment = (assessmentId: string) => {
        navigate({
            to: '/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab',
            params: {
                assessmentId: assessmentId,
                examType: scheduleTestContent.play_mode,
                assesssmentType: scheduleTestContent.assessment_visibility,
                assessmentTab: selectedTab,
            },
        });
    };

    // const handleRescheduleAssessment = (assessmentId: string) => {
    //     console.log(assessmentId);
    // };

    // const handleDuplicateAssessment = (assessmentId: string) => {
    //     console.log(assessmentId);
    // };

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
                        {t('menu.viewHomeworkDetails')}
                    </DropdownMenuItem>
                    {/* <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() =>
                            handleRescheduleAssessment(scheduleTestContent.assessment_id)
                        }
                    >
                        Reschedule Assessment
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleDuplicateAssessment(scheduleTestContent.assessment_id)}
                    >
                        Duplicate Assessment
                    </DropdownMenuItem> */}
                    {canDelete && (
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAssessmentClick(scheduleTestContent.assessment_id);
                            }}
                        >
                            {t('menu.deleteHomework')}
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
    selectedTab,
}: {
    scheduleTestContent: TestContent;
    handleRefetchData: () => void;
    selectedTab: string;
}) {
    const { t } = useTranslation('homeworkCreationScheduleTestDetailsDropdownMenu');
    const [isDeleteAssessmentDialog, setIsDeleteAssessmentDialog] = useState(false);
    const [isReopenAssessment, setIsReopenAssessment] = useState(false);
    const navigate = useNavigate();
    const handleNavigateAssessment = (assessmentId: string) => {
        navigate({
            to: '/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab',
            params: {
                assessmentId: assessmentId,
                examType: scheduleTestContent.play_mode,
                assesssmentType: scheduleTestContent.assessment_visibility,
                assessmentTab: selectedTab,
            },
        });
    };

    // const handleRescheduleAssessment = (assessmentId: string) => {
    //     console.log(assessmentId);
    // };

    // const handleDuplicateAssessment = (assessmentId: string) => {
    //     console.log(assessmentId);
    // };

    const { canDelete } = useAssessmentActionVisibility();
    const handleDeleteAssessmentClick = (assessmentId: string) => {
        console.log(assessmentId);
        setIsDeleteAssessmentDialog(true);
    };

    // const handleReopenAssessment = (assessmentId: string) => {
    //     console.log(assessmentId);
    //     setIsReopenAssessment(true);
    // };

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
                        {t('menu.viewHomeworkDetails')}
                    </DropdownMenuItem>
                    {/* <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() =>
                            handleRescheduleAssessment(scheduleTestContent.assessment_id)
                        }
                    >
                        Reschedule Assessment
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleDuplicateAssessment(scheduleTestContent.assessment_id)}
                    >
                        Duplicate Assessment
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleReopenAssessment(scheduleTestContent.assessment_id)}
                    >
                        Reopen Assessment
                    </DropdownMenuItem> */}
                    {canDelete && (
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAssessmentClick(scheduleTestContent.assessment_id);
                            }}
                        >
                            {t('menu.deleteHomework')}
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
    selectedTab,
}: {
    scheduleTestContent: TestContent;
    handleRefetchData: () => void;
    selectedTab: string;
}) {
    const { t } = useTranslation('homeworkCreationScheduleTestDetailsDropdownMenu');
    const [isDeleteAssessmentDialog, setIsDeleteAssessmentDialog] = useState(false);
    const navigate = useNavigate();
    const handleNavigateAssessment = (assessmentId: string) => {
        navigate({
            to: '/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab',
            params: {
                assessmentId: assessmentId,
                examType: scheduleTestContent.play_mode,
                assesssmentType: scheduleTestContent.assessment_visibility,
                assessmentTab: selectedTab,
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
                        {t('menu.viewHomeworkDetails')}
                    </DropdownMenuItem>
                    {canDelete && (
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAssessmentClick(scheduleTestContent.assessment_id);
                            }}
                        >
                            {t('menu.deleteHomework')}
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
                    selectedTab={selectedTab}
                />
            );
        case 'upcomingTests':
            return (
                <ScheduleTestDetailsDropdownUpcoming
                    scheduleTestContent={scheduleTestContent}
                    handleRefetchData={handleRefetchData}
                    selectedTab={selectedTab}
                />
            );
        case 'previousTests':
            return (
                <ScheduleTestDetailsDropdownPrevious
                    scheduleTestContent={scheduleTestContent}
                    handleRefetchData={handleRefetchData}
                    selectedTab={selectedTab}
                />
            );
        case 'draftTests':
            return (
                <ScheduleTestDetailsDropdowDrafts
                    scheduleTestContent={scheduleTestContent}
                    handleRefetchData={handleRefetchData}
                    selectedTab={selectedTab}
                />
            );
        default:
            return null;
    }
}

const ScheduleTestReminderDialog = ({ onClose }: { onClose: () => void }) => {
    const { t } = useTranslation('homeworkCreationScheduleTestDetailsDropdownMenu');
    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogTrigger>{t('common.open')}</DialogTrigger>
            <DialogContent className="flex w-dialog-md flex-col p-0">
                <h1 className="rounded-lg bg-primary-50 p-4 text-primary-500">
                    {t('reminderDialog.title')}
                </h1>
                <div className="flex flex-col gap-4 p-4 pt-3">
                    <div className="flex items-center gap-1">
                        <span className="text-danger-600">{t('common.attention')}</span>
                        <Info size={18} className="text-danger-600" />
                    </div>
                    <h1 className="-mt-2 font-thin">
                        {t('common.reminderBodyPrefix')}
                        <span className="text-primary-500">
                            {' '}
                            {t('common.participants', { count: 56 })}{' '}
                        </span>
                        {t('common.reminderBodySuffix')}
                    </h1>
                    <div className="mt-2 flex justify-end">
                        <MyButton type="button" scale="large" buttonType="primary">
                            {t('reminderDialog.send')}
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
    const { t } = useTranslation('homeworkCreationScheduleTestDetailsDropdownMenu');
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
                    toast.warning(t('deleteDialog.slidesDeleteFailedToast'), { duration: 4000 });
                }
            }
            return result;
        },
        onSuccess: async () => {
            toast.success(t('deleteDialog.successToast'), {
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
            <DialogTrigger>{t('common.open')}</DialogTrigger>
            <DialogContent className="flex w-dialog-md flex-col p-0">
                <h1 className="rounded-lg bg-primary-50 p-4 text-primary-500">
                    {t('deleteDialog.title')}
                </h1>
                <div className="flex flex-col gap-4 p-4 pt-3">
                    <div className="flex items-center gap-1">
                        <span className="text-danger-600">{t('common.attention')}</span>
                        <Info size={18} className="text-danger-600" />
                    </div>
                    <h1 className="-mt-2 font-thin">
                        {t('deleteDialog.confirmPrefix')}
                        <span className="text-primary-500">&nbsp;{scheduleTestContent.name}</span>
                        {t('deleteDialog.confirmSuffix')}
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
                            {t('deleteDialog.delete')}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const ScheduleTestPauseDialog = ({ onClose }: { onClose: () => void }) => {
    const { t } = useTranslation('homeworkCreationScheduleTestDetailsDropdownMenu');
    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogTrigger>{t('common.open')}</DialogTrigger>
            <DialogContent className="flex w-dialog-md flex-col p-0">
                <h1 className="rounded-lg bg-primary-50 p-4 text-primary-500">
                    {t('pauseDialog.title')}
                </h1>
                <div className="flex flex-col gap-4 p-4 pt-3">
                    <div>
                        <h1 className="mb-1 text-sm">
                            {t('common.dateText')} <span className="text-danger-600">*</span>
                        </h1>
                        <Input type="date" placeholder={t('common.dateText')} />
                    </div>
                    <div className="text-sm">
                        <h1 className="mb-1 text-sm">
                            {t('pauseDialog.pauseUntilLabel')}{' '}
                            <span className="text-danger-600">*</span>
                        </h1>
                        <Input type="time" placeholder={t('common.timeText')} />
                    </div>
                    <div className="mt-2 flex justify-end">
                        <MyButton type="button" scale="large" buttonType="primary">
                            {t('pauseDialog.pause')}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const ScheduleTestResumeDialog = ({ onClose }: { onClose: () => void }) => {
    const { t } = useTranslation('homeworkCreationScheduleTestDetailsDropdownMenu');
    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogTrigger>{t('common.open')}</DialogTrigger>
            <DialogContent className="flex w-dialog-md flex-col p-0">
                <h1 className="rounded-lg bg-primary-50 p-4 text-primary-500">
                    {t('resumeDialog.title')}
                </h1>
                <div className="flex flex-col gap-4 p-4 pt-3">
                    <div className="flex items-center gap-1">
                        <span className="text-danger-600">{t('common.attention')}</span>
                        <Info size={18} className="text-danger-600" />
                    </div>
                    <h1 className="-mt-2 font-thin">
                        {t('resumeDialog.confirmPrefix')}
                        <span className="text-primary-500">
                            &nbsp;{t('resumeDialog.testName')}
                        </span>
                        {t('resumeDialog.confirmSuffix')}
                    </h1>
                    <div className="mt-2 flex justify-end">
                        <MyButton type="button" scale="large" buttonType="primary">
                            {t('resumeDialog.resume')}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const ScheduleTestReopenDialog = ({ onClose }: { onClose: () => void }) => {
    const { t } = useTranslation('homeworkCreationScheduleTestDetailsDropdownMenu');
    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogTrigger>{t('common.open')}</DialogTrigger>
            <DialogContent className="flex w-dialog-md flex-col p-0">
                <h1 className="rounded-lg bg-primary-50 p-4 text-primary-500">
                    {t('reopenDialog.title')}
                </h1>
                <div className="flex flex-col gap-4 p-4 pt-3">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-1">
                            <span className="text-danger-600">{t('common.attention')}</span>
                            <Info size={18} className="text-danger-600" />
                        </div>
                        <h1 className="-mt-2 font-thin">
                            {t('common.reminderBodyPrefix')}
                            <span className="text-primary-500">
                                {' '}
                                {t('common.participants', { count: 56 })}{' '}
                            </span>
                            {t('common.reminderBodySuffix')}
                        </h1>
                    </div>
                    <h1>{t('reopenDialog.selectDateTime')}</h1>
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="mb-1 text-sm">
                                {t('reopenDialog.startDateTimeLabel')}{' '}
                                <span className="text-danger-600">*</span>
                            </h1>
                            <Input type="datetime-local" placeholder={t('common.dateText')} />
                        </div>
                        <div className="text-sm">
                            <h1 className="mb-1 text-sm">
                                {t('reopenDialog.endDateTimeLabel')}{' '}
                                <span className="text-danger-600">*</span>
                            </h1>
                            <Input type="datetime-local" placeholder={t('common.timeText')} />
                        </div>
                    </div>
                    <div className="mt-2 flex justify-end">
                        <MyButton type="button" scale="large" buttonType="primary">
                            {t('reopenDialog.reopen')}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
