import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TipTapEditor } from '@/components/tiptap/TipTapEditor';
import { TestCaseList } from './TestCaseList';
import { QuestionSettingsForm } from './QuestionSettingsForm';
import { StarterCodeEditor } from './StarterCodeEditor';
import { SubmissionsReport } from './SubmissionsReport';
import type { CodingQuestionConfig, CodingTestCase } from '../utils/code-editor-types';

interface Props {
    question: CodingQuestionConfig;
    onChange: (next: CodingQuestionConfig) => void;
    disabled?: boolean;
    // The slide id this question belongs to. When present, the Submissions tab
    // is rendered (admin reporting). Absent on brand-new slides that haven't
    // been saved yet — the tab simply hides itself.
    slideId?: string;
}

export function QuestionEditor({ question, onChange, disabled, slideId }: Props) {
    const { t } = useTranslation('studyLibraryQuestionEditor');

    const setProblemHtml = useCallback(
        (html: string) => {
            onChange({ ...question, problemHtml: html });
        },
        [question, onChange]
    );

    const setTestCases = useCallback(
        (testCases: CodingTestCase[]) => {
            onChange({ ...question, testCases });
        },
        [question, onChange]
    );

    return (
        <div className="border-t bg-muted/30 p-3">
            <Tabs defaultValue="problem">
                <TabsList>
                    <TabsTrigger value="problem">{t('tabs.problem')}</TabsTrigger>
                    <TabsTrigger value="testcases">
                        {t('tabs.testCases', { count: question.testCases.length })}
                    </TabsTrigger>
                    <TabsTrigger value="settings">{t('tabs.settings')}</TabsTrigger>
                    <TabsTrigger value="starter">{t('tabs.starterCode')}</TabsTrigger>
                    {slideId && <TabsTrigger value="submissions">{t('tabs.submissions')}</TabsTrigger>}
                </TabsList>

                <TabsContent value="problem" className="mt-3">
                    <div className="rounded border bg-background p-2">
                        <TipTapEditor
                            value={question.problemHtml}
                            onChange={setProblemHtml}
                            placeholder={t('problemPlaceholder')}
                            minHeight={200}
                            editable={!disabled}
                        />
                    </div>
                </TabsContent>

                <TabsContent value="testcases" className="mt-3">
                    <TestCaseList
                        testCases={question.testCases}
                        onChange={setTestCases}
                        maxPoints={question.maxPoints}
                        disabled={disabled}
                    />
                </TabsContent>

                <TabsContent value="settings" className="mt-3">
                    <QuestionSettingsForm
                        question={question}
                        onChange={onChange}
                        disabled={disabled}
                    />
                </TabsContent>

                <TabsContent value="starter" className="mt-3">
                    <StarterCodeEditor
                        question={question}
                        onChange={onChange}
                        disabled={disabled}
                    />
                </TabsContent>

                {slideId && (
                    <TabsContent value="submissions" className="mt-3">
                        <SubmissionsReport slideId={slideId} />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}
