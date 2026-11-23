import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { MyQuestionPaperFormInterface } from '@/types/assessments/question-paper-form';
import { addQuestionPaper } from '../-utils/question-paper-services';
import { getIdByLevelName, getIdBySubjectName } from '../-utils/helper';
import { QUESTION_PAPER_STATS_KEY } from '../-utils/question-paper-list';
import { useRefetchStore } from '../-global-states/refetch-store';
import { usePendingPaperFolderPrompt } from '../-global-states/pending-paper-folder-prompt';
import { PAPER_FOLDERS_QUERY_KEY } from '@/services/question-paper-folders';
import type { UploadQuestionPaperFormType } from '../-components/QuestionPaperUpload';

/**
 * Saves a new paper from the Question Papers page (upload or manual) the same way
 * QuestionPaperUpload does — level/subject names mapped to ids, then addQuestionPaper —
 * and then brings the list to the new paper: All tab, newest first, page 1, highlighted.
 */
export const useSaveQuestionPaper = () => {
    const { instituteDetails } = useInstituteDetailsStore();
    const queryClient = useQueryClient();
    const { handleShowNewest, setJustAddedId } = useRefetchStore();

    const mutation = useMutation({
        mutationFn: (data: MyQuestionPaperFormInterface) => addQuestionPaper(data),
    });

    const save = (
        values: UploadQuestionPaperFormType,
        { onSaved }: { onSaved?: (savedId: string | undefined) => void } = {}
    ) => {
        const data = {
            ...values,
            yearClass: getIdByLevelName(instituteDetails?.levels || [], values.yearClass),
            subject: getIdBySubjectName(instituteDetails?.subjects || [], values.subject),
        } as MyQuestionPaperFormInterface;
        mutation.mutate(data, {
            onSuccess: (response: { saved_question_paper_id?: string } | undefined) => {
                const savedId = response?.saved_question_paper_id;
                setJustAddedId(savedId ?? null);
                handleShowNewest();
                queryClient.invalidateQueries({ queryKey: [QUESTION_PAPER_STATS_KEY] });
                // Folders on: the page asks which folder the new paper goes in (and the
                // "Not in a folder" count changes). With folders off the page drops this.
                if (savedId) {
                    usePendingPaperFolderPrompt
                        .getState()
                        .setPending({ questionPaperId: savedId, title: values.title ?? '' });
                }
                queryClient.invalidateQueries({ queryKey: PAPER_FOLDERS_QUERY_KEY });
                onSaved?.(savedId);
            },
            onError: (error: unknown) => {
                toast.error(error instanceof Error ? error.message : String(error));
            },
        });
    };

    return { save, isSaving: mutation.isPending };
};
