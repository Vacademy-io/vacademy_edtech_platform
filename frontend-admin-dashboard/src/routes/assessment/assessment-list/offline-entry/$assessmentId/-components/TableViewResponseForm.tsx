import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OfflineResponseState, QuestionResponseState } from '../-utils/types';
import { RichContentRenderer } from './RichContentRenderer';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Section } from '@/types/assessments/assessment-steps';

interface OptionItem {
    id: string;
    text?: { content?: string };
}

interface QuestionWithOptions {
    question_id: string;
    question: { id: string; type: string; content: string };
    question_type: string;
    marking_json: string;
    options?: OptionItem[];
    options_with_explanation?: OptionItem[];
}

interface TableViewResponseFormProps {
    sections: Section[];
    questionsMap: Record<string, QuestionWithOptions[]>;
    responses: OfflineResponseState;
    onResponseChange: (questionId: string, response: QuestionResponseState) => void;
    onSubmit: () => void;
}

export const TableViewResponseForm = ({
    sections,
    questionsMap,
    responses,
    onResponseChange,
    onSubmit,
}: TableViewResponseFormProps) => {
    const { t } = useTranslation('assessmentTableViewResponseForm');
    const [viewingQuestion, setViewingQuestion] = useState<QuestionWithOptions | null>(null);

    const handleOptionClick = (question: QuestionWithOptions, optionId: string) => {
        const current = responses[question.question_id] ?? { selectedOptionIds: [] };
        const isSingleChoice = question.question_type === 'MCQS' || question.question_type === 'TRUE_FALSE';

        let newOptionIds: string[];
        if (isSingleChoice) {
            newOptionIds = current.selectedOptionIds.includes(optionId) ? [] : [optionId];
        } else {
            newOptionIds = current.selectedOptionIds.includes(optionId)
                ? current.selectedOptionIds.filter((id) => id !== optionId)
                : [...current.selectedOptionIds, optionId];
        }

        onResponseChange(question.question_id, {
            ...current,
            selectedOptionIds: newOptionIds,
        });
    };

    const handleMarksChange = (questionId: string, marks: number) => {
        const current = responses[questionId] ?? { selectedOptionIds: [] };
        onResponseChange(questionId, { ...current, marks });
    };

    let globalIndex = 0;

    return (
        <div className="flex flex-col gap-4">
            {sections.map((section) => {
                const questions = (questionsMap[section.id] ?? []) as QuestionWithOptions[];
                if (questions.length === 0) return null;

                return (
                    <div key={section.id}>
                        {sections.length > 1 && (
                            <div className="mb-2 rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold">
                                {section.name}
                            </div>
                        )}
                        <div className="overflow-x-auto rounded-lg border">
                            <table className="w-full text-sm">
                                <thead className="border-b bg-gray-50 text-xs font-medium uppercase text-gray-500">
                                    <tr>
                                        <th className="w-16 px-3 py-2 text-start">{t('table.headers.number')}</th>
                                        <th className="w-16 px-3 py-2 text-center">{t('table.headers.view')}</th>
                                        <th className="px-3 py-2 text-start">{t('table.headers.options')}</th>
                                        <th className="w-24 px-3 py-2 text-center">{t('table.headers.marks')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {questions.map((question) => {
                                        globalIndex++;
                                        const qNum = globalIndex;
                                        const options: OptionItem[] =
                                            question.options_with_explanation?.length
                                                ? question.options_with_explanation
                                                : question.options ?? [];
                                        const currentResponse = responses[question.question_id] ?? { selectedOptionIds: [] };
                                        const isSingleChoice = question.question_type === 'MCQS' || question.question_type === 'TRUE_FALSE';

                                        return (
                                            <tr key={question.question_id} className="hover:bg-gray-50">
                                                {/* Question Number */}
                                                <td className="px-3 py-2 font-semibold text-gray-700">
                                                    {t('table.questionNumber', { number: qNum })}
                                                </td>

                                                {/* View Button */}
                                                <td className="px-3 py-2 text-center">
                                                    <button
                                                        onClick={() => setViewingQuestion(question)}
                                                        className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
                                                    >
                                                        {t('table.viewButton')}
                                                    </button>
                                                </td>

                                                {/* Option Bubbles */}
                                                <td className="px-3 py-2">
                                                    <div className="flex flex-wrap gap-2">
                                                        {options.map((option, idx) => {
                                                            const isSelected = currentResponse.selectedOptionIds.includes(option.id);
                                                            const label = String.fromCharCode(97 + idx); // a, b, c, d...

                                                            return (
                                                                <button
                                                                    key={option.id}
                                                                    onClick={() => handleOptionClick(question, option.id)}
                                                                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all ${
                                                                        isSelected
                                                                            ? 'bg-primary-500 text-white ring-2 ring-primary-300'
                                                                            : 'border border-gray-300 text-gray-600 hover:border-primary-400 hover:bg-primary-50'
                                                                    }`}
                                                                    title={
                                                                        option.text?.content?.replace(/<[^>]*>/g, '') ||
                                                                        t('table.optionFallback', { label })
                                                                    }
                                                                >
                                                                    {label}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </td>

                                                {/* Marks Input */}
                                                <td className="px-3 py-2 text-center">
                                                    <input
                                                        type="number"
                                                        step="0.5"
                                                        value={currentResponse.marks ?? ''}
                                                        onChange={(e) =>
                                                            handleMarksChange(
                                                                question.question_id,
                                                                parseFloat(e.target.value) || 0
                                                            )
                                                        }
                                                        className="w-16 rounded border px-2 py-1 text-center text-sm"
                                                        placeholder={t('table.marksPlaceholder')}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}

            {/* Submit Button */}
            <div className="flex justify-end">
                <button
                    onClick={onSubmit}
                    className="rounded-md bg-green-600 px-8 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                    {t('actions.submit')}
                </button>
            </div>

            {/* Question Preview Dialog */}
            <Dialog open={!!viewingQuestion} onOpenChange={() => setViewingQuestion(null)}>
                <DialogContent className="max-h-dialog-tall max-w-2xl overflow-y-auto">
                    {viewingQuestion && (
                        <div className="flex flex-col gap-4 pt-4">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-gray-500">
                                    {viewingQuestion.question_type}
                                </span>
                            </div>
                            <RichContentRenderer
                                html={viewingQuestion.question?.content || ''}
                                className="prose prose-sm max-w-none"
                            />
                            <div className="flex flex-col gap-2">
                                {(viewingQuestion.options_with_explanation?.length
                                    ? viewingQuestion.options_with_explanation
                                    : viewingQuestion.options ?? []
                                ).map((option: OptionItem, idx: number) => (
                                    <div
                                        key={option.id}
                                        className="rounded-md border p-2 text-sm"
                                    >
                                        <span className="mr-2 font-medium text-gray-500">
                                            {String.fromCharCode(65 + idx)}.
                                        </span>
                                        <RichContentRenderer
                                            html={option.text?.content || ''}
                                            className="inline"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};
