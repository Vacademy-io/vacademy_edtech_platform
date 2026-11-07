import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PencilSimpleLine } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getInstituteId } from '@/constants/helper';
import {
    editLibraryCopy,
    fetchLibraryCopy,
} from '@/routes/assessment/question-library/-services/question-library-services';
import { MyQuestion } from '@/types/assessments/question-paper-form';
import { QuestionEditor } from './AssessmentQuestionEditDialog';

/**
 * Edit a question added from the Question Library, while its test is being put together.
 *
 * AssessmentQuestionEditDialog works through the section's saved mapping, so it cannot
 * open a question on a test that has not been saved. A library copy already has its own row
 * from the moment it was added, so it is loaded and saved by its id. The server only accepts
 * this institute's copies here, so the edit cannot reach the library.
 */
export const LibraryCopyEditDialog = ({
    questionId,
    assessmentId,
    examType,
    onSaved,
}: {
    questionId: string;
    assessmentId: string;
    examType?: string;
    /** Called with the question as saved, so the caller can refresh its own row. */
    onSaved?: (question: MyQuestion) => void;
}) => {
    const { t } = useTranslation('assessmentStep2SectionInfo');
    const [open, setOpen] = useState(false);
    const instituteId = getInstituteId() ?? '';
    const queryClient = useQueryClient();

    const { data: source, isLoading } = useQuery({
        queryKey: ['QUESTION_LIBRARY_COPY', instituteId, questionId],
        queryFn: () => fetchLibraryCopy(instituteId, questionId),
        enabled: open && !!instituteId,
        staleTime: 0,
        gcTime: 0,
    });

    return (
        <>
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                layoutVariant="icon"
                aria-label={t('table.editQuestion')}
                onClick={() => setOpen(true)}
            >
                <PencilSimpleLine size={16} />
            </MyButton>
            <MyDialog
                heading={t('table.editQuestion')}
                open={open}
                onOpenChange={setOpen}
                dialogWidth="max-w-dialog-xl"
            >
                {isLoading || !source ? (
                    <div className="flex h-40 items-center justify-center">
                        {isLoading ? (
                            <DashboardLoader />
                        ) : (
                            <p className="text-sm text-neutral-500">
                                {t('table.editQuestionMissing')}
                            </p>
                        )}
                    </div>
                ) : (
                    <QuestionEditor
                        key={source.id ?? questionId}
                        source={source}
                        examType={examType}
                        onCancel={() => setOpen(false)}
                        onSubmit={async (updated) => {
                            const [first] = updated;
                            if (first) await editLibraryCopy(instituteId, first);
                        }}
                        onSaved={(saved) => {
                            setOpen(false);
                            queryClient.invalidateQueries({
                                queryKey: ['ASSESSMENT_FULL_QUESTIONS', assessmentId],
                            });
                            queryClient.invalidateQueries({
                                queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS', assessmentId],
                            });
                            onSaved?.(saved);
                        }}
                    />
                )}
            </MyDialog>
        </>
    );
};
