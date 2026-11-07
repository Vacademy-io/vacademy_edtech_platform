import { MyButton } from '@/components/design-system/button';
import CustomInput from '@/components/design-system/custom-input';
import SelectField from '@/components/design-system/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { PencilSimpleLine } from '@phosphor-icons/react';
import { useForm, SubmitHandler, UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { uploadQuestionPaperFormSchema } from '../-utils/upload-question-paper-form-schema';
import { useFilterDataForAssesment } from '../../assessment-list/-utils.ts/useFiltersData';
import { useState } from 'react';
import { useNamingSettings } from '@/hooks/useNamingSettings';
import { useTranslation } from 'react-i18next';

interface FormData {
    title: string;
    yearClass?: string;
    subject?: string;
}
type QuestionPaperForm = z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>;

export const QuestionPaperEditDialog = ({ form }: { form: UseFormReturn<QuestionPaperForm> }) => {
    const { t } = useTranslation('assessmentQuestionPaperEditDialogue');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const { instituteDetails } = useInstituteDetailsStore();
    const { YearClassFilterData, SubjectFilterData } = useFilterDataForAssesment(instituteDetails);
    const { getTerminology } = useNamingSettings();
    const { control, handleSubmit } = useForm<FormData>({
        defaultValues: {
            title: form.getValues('title'),
            yearClass: form.getValues('yearClass'),
            subject: form.getValues('subject'),
        },
    });
    const { setValue } = form;

    const onSubmit: SubmitHandler<FormData> = (data) => {
        setValue('title', data.title);
        setValue('yearClass', data.yearClass);
        setValue('subject', data.subject);
        setIsDialogOpen(false);
    };

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger>
                <Button
                    variant="outline"
                    className="border-none bg-transparent shadow-none hover:bg-transparent"
                    type="button"
                >
                    <PencilSimpleLine size={16} />
                </Button>
            </DialogTrigger>
            <DialogContent className="gap-2 p-0">
                <h1 className="rounded-t-lg bg-primary-50 p-4 text-primary-500">{t('title')}</h1>
                <form className="flex flex-col gap-2 p-4 pt-0">
                    <CustomInput
                        control={control}
                        name="title"
                        label={t('titleFieldLabel')}
                        placeholder={t('titleFieldPlaceholder')}
                        required
                    />
                    <div className="flex items-center gap-4">
                        <SelectField
                            label={getTerminology('Level', 'Year/Class')}
                            name="yearClass"
                            options={YearClassFilterData.map((option, index) => ({
                                value: option.name,
                                label: option.name,
                                _id: index,
                            }))}
                            control={control}
                            className="!w-full"
                        />
                        <SelectField
                            label={getTerminology('Subject', 'Subject')}
                            name="subject"
                            options={SubjectFilterData.map((option, index) => ({
                                value: option.name,
                                label: option.name,
                                _id: index,
                            }))}
                            control={control}
                            className="!w-full"
                        />
                    </div>
                    <div className="flex justify-end pt-2">
                        <MyButton
                            type="button"
                            scale="large"
                            buttonType="primary"
                            layoutVariant="default"
                            onClick={handleSubmit(onSubmit)}
                        >
                            {t('saveButton')}
                        </MyButton>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
};
