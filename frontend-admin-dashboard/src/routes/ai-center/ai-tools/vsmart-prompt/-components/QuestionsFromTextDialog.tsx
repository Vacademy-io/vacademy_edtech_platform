import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useRef } from 'react';
import { FormProvider, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { QuestionsFromTextData } from './GenerateQuestionsFromText';
import SelectField from '@/components/design-system/select-field';
import { languageSupport } from '@/constants/dummy-data';
import { ModelSelector } from '../../-components/ModelSelector';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// languageSupport (shared constant) holds raw enum values like 'ENGLISH' /
// 'HINDI'; map them to translation keys for display only. The underlying
// option value (used for form state / API payload) stays untouched.
const LANGUAGE_LABEL_KEYS: Record<string, string> = {
    ENGLISH: 'languages.english',
    HINDI: 'languages.hindi',
};

export const QuestionsFromTextDialog = ({
    open,
    onOpenChange,
    onSubmitSuccess,
    submitButton,
    submitForm,
    trigger,
    form,
    taskId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmitSuccess: (data: QuestionsFromTextData, taskId: string) => void;
    submitButton: JSX.Element;
    handleDisableSubmitBtn: (value: boolean) => void;
    submitForm: (submitFn: () => void) => void;
    trigger?: JSX.Element;
    form: UseFormReturn<{
        taskName: string;
        text: string;
        num: number;
        class_level: string;
        topics: string;
        question_type: string;
        question_language: string;
        preferredModel?: string;
    }>;
    taskId: string;
}) => {
    const { t } = useTranslation('aiCenterQuestionsFromTextDialog');
    const formRef = useRef<HTMLFormElement>(null);

    const requestSubmitFn = () => {
        if (formRef.current) {
            formRef.current.requestSubmit();
        }
    };

    useEffect(() => {
        if (submitForm) {
            submitForm(requestSubmitFn);
        }
    }, [submitForm]);

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            footer={submitButton}
            trigger={trigger || undefined}
            dialogWidth="max-w-lg"
        >
            <FormProvider {...form}>
                <form
                    onSubmit={form.handleSubmit((data) => onSubmitSuccess(data, taskId))}
                    className="flex flex-col gap-4"
                    ref={formRef}
                >
                    <FormField
                        control={form.control}
                        name="topics"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <MyInput
                                        input={field.value?.toString() || ''}
                                        onChangeFunction={(e) => field.onChange(e.target.value)}
                                        label={t('fields.topics.label')}
                                        required={true}
                                        inputType="text"
                                        inputPlaceholder={t('fields.topics.placeholder')}
                                        className="w-full"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="text"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <div className="flex flex-col gap-2">
                                        <FormLabel>
                                            {t('fields.detailsOfTopics.label')}{' '}
                                            <span className="text-red-500">*</span>
                                        </FormLabel>
                                        <Textarea
                                            placeholder={t('fields.detailsOfTopics.placeholder')}
                                            className="h-24 w-full"
                                            value={field.value}
                                            onChange={(e) => field.onChange(e.target.value)}
                                        />
                                    </div>
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="num"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <MyInput
                                        min={0}
                                        input={field.value?.toString() || ''}
                                        onChangeFunction={(e) => {
                                            // Convert to number for validation, floor it
                                            const numValue = Math.floor(Number(e.target.value));
                                            // Only update if it's a valid number
                                            if (!isNaN(numValue)) {
                                                field.onChange(numValue); // Store as number in form
                                            }
                                        }}
                                        onWheel={(e) => e.currentTarget.blur()}
                                        label={t('fields.numQuestions.label')}
                                        required={true}
                                        inputType="number"
                                        inputPlaceholder={t('fields.numQuestions.placeholder')}
                                        className="w-full"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="class_level"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <MyInput
                                        input={field.value?.toString() || ''}
                                        onChangeFunction={(e) => field.onChange(e.target.value)}
                                        label={getTerminology(ContentTerms.Level, SystemTerms.Level)}
                                        required={true}
                                        inputType="text"
                                        inputPlaceholder={t('fields.classLevel.placeholder')}
                                        className="w-full"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="question_type"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <MyInput
                                        input={field.value?.toString() || ''}
                                        onChangeFunction={(e) => field.onChange(e.target.value)}
                                        label={t('fields.questionType.label')}
                                        required={true}
                                        inputType="text"
                                        inputPlaceholder={t('fields.questionType.placeholder')}
                                        className="w-full"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <SelectField
                        label={t('fields.questionLanguage.label')}
                        labelStyle="font-semibold"
                        name="question_language"
                        options={languageSupport.map((option, index) => ({
                            value: option,
                            label: LANGUAGE_LABEL_KEYS[option]
                                ? t(LANGUAGE_LABEL_KEYS[option])
                                : option,
                            _id: index,
                        }))}
                        control={form.control}
                        required
                        className="w-56 font-thin"
                    />

                    {/* AI Model Selection */}
                    <FormField
                        control={form.control}
                        name="preferredModel"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <ModelSelector
                                        value={field.value}
                                        onChange={field.onChange}
                                        showAdvanced={true}
                                        className="w-full"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                </form>
            </FormProvider>
        </MyDialog>
    );
};
