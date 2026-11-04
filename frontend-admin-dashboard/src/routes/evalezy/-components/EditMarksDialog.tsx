import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { STEP2_ASSESSMENT_URL } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { COPY_CHECK_CRITERIA_KEY } from '@/services/copy-check-criteria';
import {
    markingWithMarks,
    sectionTotalWithMarks,
    type PaperQuestion,
    type PaperSectionView,
} from '../-lib/paper-questions';

const MIN_MARKS = 0.5;
const MAX_MARKS = 1000;

/** The backend's refusal when it gave one (an API-managed exam cannot change its marks). */
const refusalOf = (error: unknown): string | undefined => {
    const data = (error as { response?: { data?: { message?: string; ex?: string } } })?.response
        ?.data;
    return data?.message || data?.ex;
};

/** Change what one question is out of: the read can get a question's marks wrong. */
export const EditMarksDialog = ({
    assessmentId,
    question,
    section,
    onClose,
}: {
    assessmentId: string;
    question: PaperQuestion;
    section: PaperSectionView;
    onClose: () => void;
}) => {
    const { t } = useTranslation('evalezy');
    const queryClient = useQueryClient();
    const [value, setValue] = useState(String(question.marks));
    const marks = Number(value);
    const valid = Number.isFinite(marks) && marks >= MIN_MARKS && marks <= MAX_MARKS;

    const save = useMutation({
        mutationFn: () =>
            authenticatedAxiosInstance({
                method: 'POST',
                url: STEP2_ASSESSMENT_URL,
                params: { assessmentId, instituteId: getInstituteId(), type: 'EXAM' },
                data: {
                    added_sections: [],
                    deleted_sections: [],
                    updated_sections: [
                        {
                            section_id: section.id,
                            total_marks: sectionTotalWithMarks(section, question.id, marks),
                            question_and_marking: [
                                {
                                    question_id: question.id,
                                    marking_json: markingWithMarks(
                                        question.markingJson,
                                        question.questionType,
                                        marks
                                    ),
                                    question_duration_in_min: question.durationMin,
                                    question_order: question.order,
                                    is_added: false,
                                    is_deleted: false,
                                    is_updated: true,
                                },
                            ],
                        },
                    ],
                },
            }),
        onSuccess: () => {
            toast.success(t('paper.marksSaved'));
            void queryClient.invalidateQueries({
                queryKey: ['GET_QUESTIONS_DATA_FOR_SECTIONS', assessmentId],
            });
            void queryClient.invalidateQueries({
                queryKey: ['GET_ASSESSMENT_DETAILS', assessmentId],
            });
            void queryClient.invalidateQueries({
                queryKey: [COPY_CHECK_CRITERIA_KEY, assessmentId],
            });
            onClose();
        },
        onError: (error) => toast.error(refusalOf(error) ?? t('paper.marksSaveFailed')),
    });

    return (
        <MyDialog
            open
            heading={t('paper.marksTitle', { number: question.number })}
            dialogWidth="max-w-md"
            onOpenChange={(next) => {
                if (!next && !save.isPending) onClose();
            }}
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={save.isPending}
                        onClick={onClose}
                    >
                        {t('paper.marksCancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={!valid || save.isPending}
                        onClick={() => save.mutate()}
                    >
                        {t('paper.marksSave')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <MyInput
                    label={t('paper.marksLabel')}
                    required
                    inputType="number"
                    input={value}
                    onChangeFunction={(e) => setValue(e.target.value)}
                    error={valid ? null : t('paper.marksInvalid')}
                    className="w-full sm:w-full"
                />
                <p className="text-caption text-neutral-500">{t('paper.marksNote')}</p>
            </div>
        </MyDialog>
    );
};
