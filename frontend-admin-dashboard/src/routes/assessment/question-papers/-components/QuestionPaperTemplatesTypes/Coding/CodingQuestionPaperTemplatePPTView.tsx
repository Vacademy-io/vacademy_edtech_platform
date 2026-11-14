import { useTranslation } from 'react-i18next';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { QuestionPaperTemplateFormProps } from '../../../-utils/question-paper-template-form';
import {
    CodingQuestionConfig,
    makeEmptyQuestion,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/utils/code-editor-types';
import { sanitizeRichHtml } from '@/lib/sanitize-html';

// PPT/preview rendering: show problem + sample tests + language list. Read-only.
export const CodingQuestionPaperTemplatePPTView = ({
    form,
    currentQuestionIndex,
    className,
}: QuestionPaperTemplateFormProps) => {
    const { t } = useTranslation('assessmentCodingPPTQP');
    const value =
        (form.getValues(`questions.${currentQuestionIndex}.codingConfig`) as
            | CodingQuestionConfig
            | undefined) || makeEmptyQuestion();

    const visibleTests = (value.testCases || []).filter((tc) => tc.visible);

    return (
        <div className={className}>
            <div className="flex w-full flex-col gap-3">
                <FormField
                    control={form.control}
                    name={`questions.${currentQuestionIndex}.codingConfig.problemHtml`}
                    render={() => (
                        <FormItem className="w-full">
                            <FormControl>
                                <div
                                    className="prose max-w-none rounded border bg-background p-3"
                                    dangerouslySetInnerHTML={{
                                        __html:
                                            sanitizeRichHtml(value.problemHtml) ||
                                            `<i>${t('noProblemStatement')}</i>`,
                                    }}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />

                <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded bg-muted px-2 py-1">
                        {t('languagesLabel', {
                            languages: (value.allowedLanguages || []).join(', ') || '—',
                        })}
                    </span>
                    <span className="rounded bg-muted px-2 py-1">
                        {t('maxPointsLabel', { points: value.maxPoints })}
                    </span>
                    <span className="rounded bg-muted px-2 py-1">
                        {t('testsLabel', { count: value.testCases?.length || 0 })}
                    </span>
                </div>

                {visibleTests.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="text-sm font-semibold">{t('sampleTestCasesHeading')}</h4>
                        {visibleTests.map((tc, i) => (
                            <div key={tc.id} className="rounded border p-2 text-xs">
                                <div className="font-medium">
                                    {tc.label || t('sampleLabel', { number: i + 1 })}
                                </div>
                                <div className="mt-1 grid grid-cols-2 gap-2">
                                    <div>
                                        <div className="text-muted-foreground">
                                            {t('inputLabel')}
                                        </div>
                                        <pre className="whitespace-pre-wrap">{tc.stdin}</pre>
                                    </div>
                                    <div>
                                        <div className="text-muted-foreground">
                                            {t('expectedLabel')}
                                        </div>
                                        <pre className="whitespace-pre-wrap">
                                            {tc.expectedStdout}
                                        </pre>
                                        {(tc.acceptedOutputs?.length ?? 0) > 1 && (
                                            <div className="mt-0.5 text-muted-foreground">
                                                {t('moreAccepted', {
                                                    count:
                                                        (tc.acceptedOutputs?.length ?? 1) - 1,
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
