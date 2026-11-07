import { SelectedFilterRevaluateInterface } from '@/types/assessments/assessment-revaluate-question-wise';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { getRevaluateStudentResult } from '../../-services/assessment-details-services';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Route } from '../..';
import { getInstituteId } from '@/constants/helper';
import { MyButton } from '@/components/design-system/button';
import { WarningCircle } from '@phosphor-icons/react';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { useTranslation } from 'react-i18next';

const AssessmentGlobalLevelRevaluateAssessment = () => {
    const { t } = useTranslation('assessmentGlobalLevelRevaluate');
    const [openDialog, setOpenDialog] = useState(false);
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId();
    const [selectedRevaluateFilter] = useState<SelectedFilterRevaluateInterface>({
        questions: [
            {
                section_id: '',
                question_ids: [],
            },
        ],
        attempt_ids: [],
    });
    const getRevaluateResultMutation = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            methodType,
            selectedFilter,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
            methodType: string;
            selectedFilter: SelectedFilterRevaluateInterface;
        }) => getRevaluateStudentResult(assessmentId, instituteId, methodType, selectedFilter),
        onSuccess: () => {
            toast.success(t('toasts.revaluateSuccess'), {
                className: 'success-toast',
                duration: 4000,
            });
            setOpenDialog(false);
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleRevaluateAllStudents = () => {
        getRevaluateResultMutation.mutate({
            assessmentId,
            instituteId,
            methodType: 'ENTIRE_ASSESSMENT',
            selectedFilter: selectedRevaluateFilter,
        });
    };

    return (
        <>
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                <DialogTrigger>
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="secondary"
                        className="font-medium"
                    >
                        {t('trigger.entireAssessment')}
                    </MyButton>
                </DialogTrigger>
                <DialogContent className="flex flex-col p-0">
                    <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                        {t('dialog.title', {
                            learnerPlural: getTerminologyPlural(
                                RoleTerms.Learner,
                                SystemTerms.Learner
                            ),
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
                                onClick={handleRevaluateAllStudents}
                            >
                                {t('dialog.confirmButton')}
                            </MyButton>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default AssessmentGlobalLevelRevaluateAssessment;
