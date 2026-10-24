import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { SelectedReleaseResultFilterInterface } from '../AssessmentSubmissionsTab';
import { getReleaseStudentResult } from '../../-services/assessment-details-services';
import { toast } from 'sonner';
import { Route } from '../..';
import { getInstituteId } from '@/constants/helper';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { WarningCircle } from '@phosphor-icons/react';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { useTranslation } from 'react-i18next';

export const AssessmentGlobalLevelReleaseResultAssessment = () => {
    const { t } = useTranslation('homeworkCreationGlobalReleaseResultAssessment');
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId();
    const [releaseResultDialog, setReleaseResultDialog] = useState(false);
    const getRleaseResultMutation = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            methodType,
            selectedReleaseFilter,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
            methodType: string;
            selectedReleaseFilter: SelectedReleaseResultFilterInterface;
        }) => getReleaseStudentResult(assessmentId, instituteId, methodType, selectedReleaseFilter),
        onSuccess: () => {
            toast.success(t('toasts.releaseResultSuccess'), {
                className: 'success-toast',
                duration: 4000,
            });
            setReleaseResultDialog(false);
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleReleaseResultForAllStudents = () => {
        getRleaseResultMutation.mutate({
            assessmentId,
            instituteId,
            methodType: 'ASSESSMENT_ALL',
            selectedReleaseFilter: {
                attempt_ids: [],
            },
        });
    };
    return (
        <Dialog open={releaseResultDialog} onOpenChange={setReleaseResultDialog}>
            <DialogTrigger>
                <MyButton
                    type="button"
                    scale="large"
                    buttonType="secondary"
                    className="font-medium"
                >
                    {t('trigger.releaseResult')}
                </MyButton>
            </DialogTrigger>
            <DialogContent className="flex flex-col p-0">
                <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                    {t('dialog.title', {
                        learnerPlural: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
                    })}
                </h1>
                <div className="flex flex-col gap-2 p-4">
                    <div className="flex items-center text-danger-600">
                        <p>{t('dialog.attention')}</p>
                        <WarningCircle size={18} />
                    </div>
                    <h1>
                        {t('dialog.confirmText', {
                            learnerLower: getTerminology(
                                RoleTerms.Learner,
                                SystemTerms.Learner
                            ).toLocaleLowerCase(),
                        })}
                    </h1>
                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            className="mt-4 font-medium"
                            onClick={handleReleaseResultForAllStudents}
                        >
                            {t('dialog.confirmButton')}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
