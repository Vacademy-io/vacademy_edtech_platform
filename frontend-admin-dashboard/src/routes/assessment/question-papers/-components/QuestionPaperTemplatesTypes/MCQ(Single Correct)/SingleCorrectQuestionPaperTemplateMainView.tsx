import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import 'react-quill/dist/quill.snow.css';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { QuestionPaperTemplateFormProps } from '../../../-utils/question-paper-template-form';
import { formatStructure } from '../../../-utils/helper';
import { Badge } from '@/components/ui/badge';
import { AnswerOptionsEditor, QuestionSectionHeader } from '../QuestionEditorParts';
import { useTranslation } from 'react-i18next';

export const SingleCorrectQuestionPaperTemplateMainView = ({
    form,
    currentQuestionIndex,
    className,
    showQuestionNumber = true,
    examType,
    enableOptionModalCompose = false,
}: QuestionPaperTemplateFormProps) => {
    const { t } = useTranslation('assessmentSingleCorrectMainQP');
    const { control, getValues } = form;
    const answersType = getValues('answersType') || t('defaults.answer');
    const explanationsType = getValues('explanationsType') || t('defaults.explanation');
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

    const questionNumberText = questionsType
        ? formatStructure(questionsType, currentQuestionIndex + 1)
        : String(currentQuestionIndex + 1);

    const questionTitle = showQuestionNumber
        ? t('questionLabel', { number: questionNumberText })
        : t('question');

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
                    title={questionTitle}
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
                                    placeholder={t('writeQuestionPlaceholder')}
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
                optionsKey="singleChoiceOptions"
                selectionMode="single"
                title={answersType}
                optionsType={optionsType}
                examType={examType}
                enableOptionModalCompose={enableOptionModalCompose}
            />
            <div className="flex w-full flex-col !flex-nowrap items-start gap-2">
                <QuestionSectionHeader title={explanationsType} hint={t('explanationHint')} />
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
