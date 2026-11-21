import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormProvider } from 'react-hook-form';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Info } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useFilterDataForAssesment } from '../../assessment-list/-utils.ts/useFiltersData';
import { BasicFormFields, useQuestionPaperForm } from './QuestionPaperUpload';
import { QuestionPaperTemplate } from './QuestionPaperTemplate';
import { useSaveQuestionPaper } from '../-hooks/useSaveQuestionPaper';

interface CreateQuestionPaperDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onBack: () => void;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
}

/**
 * "Create manually": name the paper, then the existing full-screen question editor
 * (QuestionPaperTemplate) opens. Save in the editor saves the paper and returns to the
 * list — the old flow went back to this dialog for a separate Done click.
 */
export const CreateQuestionPaperDialog = ({
    open,
    onOpenChange,
    onBack,
    currentQuestionIndex,
    setCurrentQuestionIndex,
}: CreateQuestionPaperDialogProps) => {
    const { t } = useTranslation('assessmentQuestionPapersPage');
    const { t: tUpload } = useTranslation('assessmentQuestionPaperUpload');
    const { instituteDetails } = useInstituteDetailsStore();
    const { YearClassFilterData, SubjectFilterData } = useFilterDataForAssesment(instituteDetails);
    const form = useQuestionPaperForm('EXAM');
    const [editorOpen, setEditorOpen] = useState(false);
    const { save, isSaving } = useSaveQuestionPaper();
    const title = form.watch('title');

    // A fresh form every time the dialog opens.
    useEffect(() => {
        if (open) {
            form.reset();
            setCurrentQuestionIndex(0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleSaveFromEditor = () => {
        if ((form.getValues('questions') || []).length === 0) {
            toast.error(t('manual.noQuestions'));
            return;
        }
        form.handleSubmit(
            (values) =>
                save(values, {
                    onSaved: () => {
                        setEditorOpen(false);
                        onOpenChange(false);
                        setCurrentQuestionIndex(0);
                        toast.success(t('toasts.added', { title: values.title }));
                    },
                }),
            () => toast.error(tUpload('toasts.incompleteQuestions'))
        )();
    };

    return (
        <MyDialog
            heading={t('manual.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footerLeft={
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    layoutVariant="default"
                    className="gap-1 px-0"
                    onClick={onBack}
                >
                    <ArrowLeft size={16} />
                    {t('form.allOptions')}
                </MyButton>
            }
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('form.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        className="gap-1"
                        disable={!title?.trim()}
                        onClick={() => setEditorOpen(true)}
                    >
                        {t('manual.continue')}
                        <ArrowRight size={16} />
                    </MyButton>
                </>
            }
        >
            <FormProvider {...form}>
                <form className="flex flex-col gap-6" onSubmit={(e) => e.preventDefault()}>
                    <BasicFormFields
                        form={form}
                        YearClassFilterData={YearClassFilterData}
                        SubjectFilterData={SubjectFilterData}
                    />
                    <p className="flex items-start gap-2 text-caption text-neutral-500">
                        <Info size={16} className="mt-0.5 shrink-0" />
                        {t('manual.hint')}
                    </p>
                </form>
                <QuestionPaperTemplate
                    form={form}
                    questionPaperId="1"
                    isViewMode={false}
                    isManualCreated
                    buttonText=""
                    currentQuestionIndex={currentQuestionIndex}
                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                    examType="EXAM"
                    open={editorOpen}
                    onOpenChange={setEditorOpen}
                    hideTrigger
                    onValidSave={isSaving ? () => undefined : handleSaveFromEditor}
                />
            </FormProvider>
        </MyDialog>
    );
};
