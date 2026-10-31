import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MainViewQuillEditor } from '@/components/quill/MainViewQuillEditor';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface Announcement {
    id: string;
    title: string;
    instructions: string | undefined;
}

interface AnnouncementProps {
    announcementList: Announcement[];
    setAnnouncementList: React.Dispatch<React.SetStateAction<Announcement[]>>;
}

const buildFormSchema = (t: TFunction) =>
    z.object({
        title: z.string().min(1, t('validation.titleRequired')), // Ensures title is a non-empty string
        instructions: z.string().optional(), // Instructions are optional
    });

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

export const AnnouncementComponent = ({
    announcementList,
    setAnnouncementList,
}: AnnouncementProps) => {
    const { t } = useTranslation('homeworkCreationAnnouncementComponent');
    const [isMakeAssessmentDialog, setIsMakeAssessmentDialog] = useState(false);
    const formSchema = buildFormSchema(t);
    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            title: '',
            instructions: '',
        },
        mode: 'onChange',
    });

    function onSubmit(values: FormValues) {
        setAnnouncementList([
            ...announcementList,
            {
                id: String(announcementList.length),
                title: values.title,
                instructions: values.instructions,
            },
        ]);
        form.reset();
        setIsMakeAssessmentDialog(false);
    }

    return (
        <>
            <Dialog open={isMakeAssessmentDialog} onOpenChange={setIsMakeAssessmentDialog}>
                <DialogTrigger className="flex justify-end pr-4">
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        layoutVariant="default"
                        className="text-sm"
                    >
                        {t('trigger.makeAnnouncement')}
                    </MyButton>
                </DialogTrigger>
                <DialogContent className="!w-dialog-md p-0">
                    <h1 className="h-14 rounded-lg bg-primary-50 p-4 font-semibold text-primary-500">
                        {t('dialog.heading')}
                    </h1>
                    <FormProvider {...form}>
                        <form className="flex max-h-[40vh] flex-col gap-4 overflow-y-auto p-4 pt-0">{/* design-lint-ignore: inner form scroll region distinct from dialog max-height, no vh token fits this sub-area */}
                            <FormField
                                control={form.control}
                                name="title"
                                render={({ field: { onChange, value, ...field } }) => (
                                    <FormItem>
                                        <FormControl>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder={t('dialog.titlePlaceholder')}
                                                input={value}
                                                onChangeFunction={onChange}
                                                required={true}
                                                size="large"
                                                label={t('dialog.titleLabel')}
                                                labelStyle="!text-sm"
                                                {...field}
                                                className="w-full"
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <div>
                                <h1 className="mb-1 text-sm">{t('dialog.instructionsHeading')}</h1>
                                <FormField
                                    control={form.control}
                                    name="instructions"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <MainViewQuillEditor
                                                    onChange={field.onChange}
                                                    onBlur={field.onBlur}
                                                    value={field.value}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <div className="mt-4 flex justify-end">
                                <MyButton
                                    type="button"
                                    scale="large"
                                    buttonType="primary"
                                    layoutVariant="default"
                                    className="text-sm"
                                    onClick={form.handleSubmit(onSubmit)}
                                >
                                    {t('dialog.publishButton')}
                                </MyButton>
                            </div>
                        </form>
                    </FormProvider>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default AnnouncementComponent;
