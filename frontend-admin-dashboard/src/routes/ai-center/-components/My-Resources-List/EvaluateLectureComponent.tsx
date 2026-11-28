import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { handleEvaluateLecture } from '../../-services/ai-center-service';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import AITasksList from '../AITasksList';
import { Badge } from '@/components/ui/badge';
import { getRandomTaskName } from '../../-utils/helper';

const EvaluateLectureComponent = ({ fileId }: { fileId: string }) => {
    const { t } = useTranslation('aiCenterEvaluateLectureComponent');
    const [enableDialog, setEnableDialog] = useState(false);
    const queryClient = useQueryClient();

    /* Generate Assessment Complete */
    const generateAssessmentMutation = useMutation({
        mutationFn: ({ pdfId, taskName }: { pdfId: string; taskName: string }) => {
            return handleEvaluateLecture(pdfId, taskName);
        },
        onSuccess: () => {
            setEnableDialog(true);
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['GET_INDIVIDUAL_AI_LIST_DATA'] });
            }, 100);
        },
        onError: (error: unknown) => {
            console.log(error);
        },
    });

    const handleExtractQuestions = () => {
        generateAssessmentMutation.mutate({
            pdfId: fileId || '',
            taskName: getRandomTaskName(),
        });
    };
    return (
        <>
            <Badge
                className={`cursor-pointer whitespace-nowrap bg-info-50 text-black
                     ${generateAssessmentMutation.status === 'pending' ? 'h-6' : ''}`}
                onClick={handleExtractQuestions}
            >
                {generateAssessmentMutation.status === 'pending' ? (
                    <DashboardLoader />
                ) : (
                    t('trigger.label')
                )}
            </Badge>

            {enableDialog && (
                <AITasksList
                    heading={t('tasksList.heading')}
                    enableDialog={enableDialog}
                    setEnableDialog={setEnableDialog}
                />
            )}
        </>
    );
};

export default EvaluateLectureComponent;
