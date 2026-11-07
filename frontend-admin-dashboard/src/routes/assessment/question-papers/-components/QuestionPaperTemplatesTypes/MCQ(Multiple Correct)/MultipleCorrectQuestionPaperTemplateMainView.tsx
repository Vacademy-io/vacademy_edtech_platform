import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import 'react-quill/dist/quill.snow.css';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { QuestionPaperTemplateFormProps } from '../../../-utils/question-paper-template-form';
import { formatStructure } from '../../../-utils/helper';
import { Badge } from '@/components/ui/badge';
import { AnswerOptionsEditor, QuestionSectionHeader } from '../QuestionEditorParts';
import { useTranslation } from 'react-i18next';

export const MultipleCorrectQuestionPaperTemplateMainView = ({
    form,
    currentQuestionIndex,
    className,
    showQuestionNumber = true,
    examType,
    enableOptionModalCompose = false,
}: QuestionPaperTemplateFormProps) => {
    const { t } = useTranslation('assessmentMultipleCorrectMainQP');
    const { control, getValues } = form;
    const answersType = getValues('answersType') || 'Answer';
    const explanationsType = getValues('explanationsType') || 'Explanation';
    const optionsType = getValues('optionsType') || '';
    const questionsType = getValues('questionsType') || '';
    const allQuestions = getValues('questions') || [];

    const tags = getValues(`questions.${currentQuestionIndex}.tags`) || [];
    const level = getValues(`questions.${currentQuestionIndex}.level`) || '';

    if (allQuestions.length === 0) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <p className="text-body text-neutral-500">{t('emptyState')}</p>
            </div>
        );
    }

    return (
        <div className={className}>
            {getValues(`questions.${currentQuestionIndex}.parentRichTextContent`) && (
                <div className="flex w-full flex-col !flex-nowrap items-start gap-2">
                    <QuestionSectionHeader title={t('comprehensionText')} />
                    <FormField
                        control={control}
                        name={`questions.${currentQuestionIndex}.parentRichTextContent`}
                        render={({ field }) => (
                            <FormItem className="w-full">
                                <FormControl>
                                    <RichTextEditor
                                        value={field.value}
                                        onBlur={field.onBlur}
                                        onChange={field.onChange}
                                        minHeight={100}
                                        placeholder={t('comprehensionText')}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
            )}
            <div className="flex w-full flex-col !flex-nowrap items-start gap-2">
                <QuestionSectionHeader
                    title={
                        showQuestionNumber
                            ? t('questionLabelNumbered', {
                                  number: questionsType
                                      ? formatStructure(questionsType, currentQuestionIndex + 1)
                                      : currentQuestionIndex + 1,
                              })
                            : t('questionLabel')
                    }
                    action={level ? <Badge variant="outline">{level}</Badge> : undefined}
                />
                <FormField
                    control={control}
                    name={`questions.${currentQuestionIndex}.questionName`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <RichTextEditor
                                    value={field.value}
                                    onBlur={field.onBlur}
                                    onChange={field.onChange}
                                    minHeight={100}
                                    placeholder={t('questionPlaceholder')}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                {tags?.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        {tags.map((tag, idx) => (
                            <Badge variant="outline" key={idx}>
                                {tag}
                            </Badge>
                        ))}
                    </div>
                )}
            </div>
            <AnswerOptionsEditor
                form={form}
                currentQuestionIndex={currentQuestionIndex}
                optionsKey="multipleChoiceOptions"
                selectionMode="multiple"
                title={answersType}
                optionsType={optionsType}
                examType={examType}
                enableOptionModalCompose={enableOptionModalCompose}
            />
            <div className="flex w-full flex-col !flex-nowrap items-start gap-2">
                <QuestionSectionHeader
                    title={explanationsType}
                    hint={t('explanationHint')}
                />
                <FormField
                    control={control}
                    name={`questions.${currentQuestionIndex}.explanation`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <RichTextEditor
                                    value={field.value}
                                    onBlur={field.onBlur}
                                    onChange={field.onChange}
                                    minHeight={80}
                                    placeholder={t('explanationPlaceholder')}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};
