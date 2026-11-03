import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Info } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { QuestionEditor } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-components/StepComponents/-components/AssessmentQuestionEditDialog';
import type { QuestionResponse } from '@/types/assessments/question-paper-template';
import { cn } from '@/lib/utils';
import {
    editLibraryQuestion,
    libraryErrorMessage,
    useLibraryMutation,
    type LibraryQuestion,
} from '../-services/question-library-services';
import { DIFFICULTIES } from './library-constants';

/**
 * Edit one library question with the app's own question editor.
 *
 * The backend decides how to save: a question no assessment uses is edited in place;
 * one that an assessment already uses becomes a new version, so the tests already
 * taken keep the question their students saw.
 */
export const LibraryQuestionEditDialog = ({
    instituteId,
    item,
    open,
    onOpenChange,
}: {
    instituteId: string;
    item: LibraryQuestion | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const question = item?.question;
    const [difficulty, setDifficulty] = useState<string>(question?.ai_difficulty_level ?? 'MEDIUM');
    const save = useLibraryMutation((payload: unknown) =>
        editLibraryQuestion(instituteId, payload)
    );
    const usedBy = item?.assessment_count ?? 0;

    return (
        <MyDialog
            heading={t('edit.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-dialog-xl"
        >
            {question && (
                <div className="flex flex-col gap-4">
                    {usedBy > 0 && (
                        <Alert className="border-info-200 bg-info-50">
                            <Info className="size-4 text-info-600" />
                            <AlertDescription className="text-body text-neutral-700">
                                {t('edit.versionNotice', { count: usedBy })}
                            </AlertDescription>
                        </Alert>
                    )}
                    <QuestionEditor
                        key={question.id}
                        source={question as unknown as QuestionResponse}
                        onCancel={() => onOpenChange(false)}
                        extraFields={
                            <div className="flex flex-col gap-2">
                                <span className="text-caption font-semibold text-neutral-600">
                                    {t('edit.difficulty')}
                                </span>
                                <div className="flex flex-wrap gap-2">
                                    {DIFFICULTIES.map((level) => (
                                        <button
                                            key={level}
                                            type="button"
                                            onClick={() => setDifficulty(level)}
                                            className={cn(
                                                'rounded-full border px-3 py-1 text-caption',
                                                difficulty === level
                                                    ? 'border-primary-400 bg-primary-50 text-primary-500'
                                                    : 'border-neutral-200 text-neutral-600 hover:border-primary-400'
                                            )}
                                        >
                                            {t(`difficulty.${level}`)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        }
                        onSubmit={async (updated) => {
                            const [first] = updated as Record<string, unknown>[];
                            if (!first) return;
                            // The editor never sends a difficulty and the backend DTO
                            // defaults it to MEDIUM, so it is always sent explicitly here.
                            try {
                                const result = await save.mutateAsync({
                                    ...first,
                                    ai_difficulty_level: difficulty,
                                });
                                if (result.versioned) {
                                    toast.success(
                                        t('edit.savedAsVersion', {
                                            count: result.assessment_count ?? usedBy,
                                        })
                                    );
                                }
                            } catch (error) {
                                // The editor shows its own generic failure toast. Add
                                // the server reason when there is one worth reading.
                                const reason = libraryErrorMessage(error, '');
                                if (reason) toast.error(reason);
                                throw error;
                            }
                        }}
                        onSaved={() => onOpenChange(false)}
                    />
                </div>
            )}
        </MyDialog>
    );
};
