import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField, FormItem, FormControl, FormMessage } from '@/components/ui/form';
import { QuestionPaperTemplateFormProps } from '../../../-utils/question-paper-template-form';
import { QuestionEditor } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/coding-question/QuestionEditor';
import {
    CodingQuestionConfig,
    makeEmptyQuestion,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/utils/code-editor-types';

// Merge whatever the form currently has (possibly an empty object after a type
// switch) over a complete default so QuestionEditor never receives undefined
// nested fields.
function ensureCompleteConfig(
    raw: Partial<CodingQuestionConfig> | undefined | null
): CodingQuestionConfig {
    const defaults = makeEmptyQuestion();
    return {
        ...defaults,
        ...(raw ?? {}),
        allowedLanguages:
            raw?.allowedLanguages && raw.allowedLanguages.length > 0
                ? raw.allowedLanguages
                : defaults.allowedLanguages,
        starterCode: raw?.starterCode ?? defaults.starterCode,
        testCases: raw?.testCases ?? defaults.testCases,
        perRunLimits: raw?.perRunLimits ?? defaults.perRunLimits,
        sessionTimeMinutes:
            raw?.sessionTimeMinutes === undefined
                ? defaults.sessionTimeMinutes
                : raw.sessionTimeMinutes,
        problemHtml: raw?.problemHtml ?? defaults.problemHtml,
        maxPoints: typeof raw?.maxPoints === 'number' ? raw.maxPoints : defaults.maxPoints,
    };
}

export const CodingQuestionPaperTemplateMainView = ({
    form,
    currentQuestionIndex,
    className,
    examType,
}: QuestionPaperTemplateFormProps) => {
    const { t } = useTranslation('assessmentCodingMainQP');
    const allQuestions = form.getValues('questions') || [];
    const fieldName = `questions.${currentQuestionIndex}.codingConfig` as const;

    // Backfill the form value once when this question is first rendered as
    // CODING, so reloads + downstream readers see a complete config.
    useEffect(() => {
        const current = form.getValues(fieldName) as
            | Partial<CodingQuestionConfig>
            | undefined;
        const complete = ensureCompleteConfig(current);
        if (!current || JSON.stringify(current) !== JSON.stringify(complete)) {
            form.setValue(
                fieldName,
                { ...complete, evaluationMode: 'AUTO' } as never,
                {
                    shouldDirty: false,
                    shouldTouch: false,
                    shouldValidate: false,
                }
            );
        }
        // Intentionally only on mount per question index.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentQuestionIndex]);

    if (allQuestions.length === 0) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <h1>{t('emptyState.noQuestions')}</h1>
            </div>
        );
    }

    if (examType === 'SURVEY') {
        return (
            <div className={className}>
                <p className="text-sm text-muted-foreground">
                    {t('survey.notSupported')}
                </p>
            </div>
        );
    }

    return (
        <div className={className}>
            <FormField
                control={form.control}
                name={fieldName}
                render={({ field }) => (
                    <FormItem className="w-full">
                        <FormControl>
                            <QuestionEditor
                                question={ensureCompleteConfig(
                                    field.value as Partial<CodingQuestionConfig> | undefined
                                )}
                                onChange={(next) => {
                                    field.onChange(next);
                                    // Mirror problem statement into the
                                    // schema-level questionName so the
                                    // "Question isn't complete" tooltip
                                    // resolves once the admin writes the
                                    // problem in the Problem tab.
                                    form.setValue(
                                        `questions.${currentQuestionIndex}.questionName`,
                                        next.problemHtml || '',
                                        {
                                            shouldDirty: true,
                                            shouldTouch: true,
                                            shouldValidate: true,
                                        }
                                    );
                                }}
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </div>
    );
};
