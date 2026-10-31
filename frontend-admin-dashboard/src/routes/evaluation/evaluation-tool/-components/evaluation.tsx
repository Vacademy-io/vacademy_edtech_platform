'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MyDialog } from '@/components/design-system/dialog';

import { useTimerStore } from '@/stores/evaluation/timer-store';
import { useMarksStore, feedbackKey } from '@/stores/evaluation/marks-store';
import { ArrowSquareOut } from '@phosphor-icons/react';

interface QuestionData {
    question_id: string;
    question_order: number;
    marking_json: string;
    section_id: string;
    question: {
        content: string;
    };
}

interface EvaluationProps {
    questionData?: Record<string, QuestionData[]>; // Section-wise question data
    totalPages: number; // Total number of pages
    pagesVisited: number[]; // Array of visited page numbers
}

// Resolve the max mark from marking_json defensively — slide-created placeholder
// questions or legacy rows may have missing/invalid JSON, which previously threw.
const parseMaxMark = (markingJson: string): number => {
    try {
        const value = JSON.parse(markingJson)?.data?.totalMark;
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
    } catch {
        return 0;
    }
};

// Stable reference (not a fresh `{}` per render) — questionData feeds a
// useMemo dependency array, and the standalone free tool never passes one.
const EMPTY_QUESTION_DATA: Record<string, QuestionData[]> = {};

export default function Evaluation({
    questionData = EMPTY_QUESTION_DATA,
    totalPages,
    pagesVisited,
}: EvaluationProps) {
    const { t } = useTranslation('evaluationTool');
    const [activeSection, setActiveSection] = useState<string>(Object.keys(questionData)[0] || '');
    const { elapsedTime } = useTimerStore();
    const { addOrUpdateMark, setQuestionFeedback, marksData, feedbackByQuestion } = useMarksStore();
    const [previewQuestionContent, setPreviewQuestionContent] = useState<string>('');

    const pageData = {
        totalPages,
        pagesVisited: new Set(pagesVisited),
        pagesNotVisited: Array.from({ length: totalPages }, (_, i) => i + 1).filter(
            (page) => !pagesVisited.includes(page)
        ),
    };

    const sections = useMemo(() => {
        return Object.entries(questionData).map(([sectionId, questions]) => ({
            sectionId,
            questions: questions.map((question) => {
                const existingMark = marksData.find(
                    (mark) =>
                        mark.section_id === sectionId && mark.question_id === question.question_id
                );

                return {
                    sectionId,
                    questionId: question.question_id,
                    questionNo: question.question_order,
                    scoredMarks:
                        existingMark?.marks !== undefined ? existingMark.marks.toString() : '',
                    maxMarks: parseMaxMark(question.marking_json),
                    content: question.question?.content ?? '',
                };
            }),
        }));
    }, [questionData, marksData]);

    // Flatten across sections so we can offer a single "overall marks" control when
    // the assessment is just one question (the assessment-as-a-slide shape).
    const allQuestions = useMemo(
        () => sections.flatMap((section) => section.questions),
        [sections]
    );
    // Overall-marks layout only when the assessment is exactly one section + one
    // question (the slide shape); anything else keeps the per-question table.
    const isSingleQuestion = sections.length === 1 && allQuestions.length === 1;
    const primaryQuestion = allQuestions[0];

    // Running totals so the evaluator can see scored-vs-max at a glance.
    const totals = useMemo(() => {
        let scored = 0;
        let max = 0;
        allQuestions.forEach((q) => {
            scored += Number(q.scoredMarks) || 0;
            max += Number(q.maxMarks) || 0;
        });
        return { scored: Math.round(scored * 100) / 100, max: Math.round(max * 100) / 100 };
    }, [allQuestions]);

    // The overall remark is keyed to the primary question (the only one for a slide
    // assessment); it's merged into the marks payload at submit time.
    const primaryFeedback = primaryQuestion
        ? feedbackByQuestion[
              feedbackKey(primaryQuestion.sectionId, primaryQuestion.questionId)
          ] ?? ''
        : '';

    const handleScoreChange = (sectionId: string, questionId: string, maxMarks: number, value: string) => {
        // Clamp to [0, maxMarks] instead of a blocking alert — the cap is shown
        // next to the field, so over-typing simply snaps to the maximum.
        const parsed = parseFloat(value);
        const marks = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), maxMarks) : 0;

        addOrUpdateMark({
            section_id: sectionId,
            question_id: questionId,
            status: 'evaluated',
            marks,
        });
    };

    const handleFeedbackChange = (value: string) => {
        if (!primaryQuestion) return;
        setQuestionFeedback(primaryQuestion.sectionId, primaryQuestion.questionId, value);
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return t('timeFormat', { mins, secs });
    };

    return (
        // Natural (content) height, not h-full: the parent panel body scrolls,
        // so blocks flow top-to-bottom instead of compressing and overlapping on
        // short/small screens.
        <div className="flex w-full flex-col gap-4">
            {/* Running total — the figure the evaluator most wants to track */}
            <div className="flex items-center justify-between rounded-md border border-primary-100 bg-primary-50 px-3 py-2">
                <span className="text-xs font-medium text-neutral-600">{t('totalAwarded')}</span>
                <span className="text-sm font-bold tabular-nums text-primary-500">
                    {totals.scored} <span className="text-neutral-400">/ {totals.max}</span>
                </span>
            </div>

            {/* Marks entry — single overall field for one-question (slide) assessments,
                otherwise the per-question table. */}
            {isSingleQuestion && primaryQuestion ? (
                <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-neutral-700">
                            {t('marksAwarded')}
                        </span>
                        {primaryQuestion.content && (
                            <button
                                type="button"
                                onClick={() => setPreviewQuestionContent(primaryQuestion.content)}
                                className="flex items-center gap-1 text-xs text-primary-500 hover:text-primary-400"
                            >
                                <ArrowSquareOut className="size-3.5" /> {t('viewTask')}
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Input
                            type="number"
                            value={primaryQuestion.scoredMarks}
                            min={0}
                            max={String(primaryQuestion.maxMarks)}
                            step="0.5"
                            onChange={(e) =>
                                handleScoreChange(
                                    primaryQuestion.sectionId,
                                    primaryQuestion.questionId,
                                    primaryQuestion.maxMarks,
                                    e.target.value
                                )
                            }
                            // No placeholder: a greyed-out "0" read as an
                            // already-awarded zero, so evaluators who genuinely
                            // meant 0 never typed it — leaving Submit disabled
                            // and the evaluation unsaved. An empty box is honest.
                            className="w-24 text-center"
                        />
                        <span className="text-sm text-neutral-500">
                            {t('outOf', { max: primaryQuestion.maxMarks })}
                        </span>
                    </div>
                    <p className="text-xs text-neutral-400">{t('enterOverallScoreHint')}</p>
                </div>
            ) : (
                <Tabs>
                    <TabsList>
                        {sections.map((section, index) => (
                            <TabsTrigger
                                key={section.sectionId}
                                onClick={() => setActiveSection(section.sectionId)}
                                value={section.sectionId}
                            >
                                {t('sectionNumber', { number: index + 1 })}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    {sections.map((section) => (
                        <TabsContent
                            key={section.sectionId}
                            hidden={activeSection !== section.sectionId}
                            value={activeSection}
                        >
                            <ScrollArea className="h-64 rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-fit">
                                                {t('questionNo')}
                                            </TableHead>
                                            <TableHead className="text-center">
                                                {t('scoredMarks')}
                                            </TableHead>
                                            <TableHead className="text-center">
                                                {t('maxMarks')}
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {section.questions.map((question) => (
                                            <TableRow key={question.questionNo}>
                                                <TableCell className="flex cursor-pointer items-center space-x-2 text-base font-medium">
                                                    <strong>{question.questionNo}</strong>
                                                    <ArrowSquareOut
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setPreviewQuestionContent(
                                                                question.content
                                                            );
                                                        }}
                                                    />
                                                </TableCell>

                                                <TableCell className="text-center">
                                                    <Input
                                                        type="number"
                                                        value={question.scoredMarks}
                                                        max={String(question.maxMarks)}
                                                        onChange={(e) =>
                                                            handleScoreChange(
                                                                question.sectionId,
                                                                question.questionId,
                                                                question.maxMarks,
                                                                e.target.value
                                                            )
                                                        }
                                                        className="mx-auto w-fit p-0.5 text-center"
                                                        min={0}
                                                        step="0.5"
                                                    />
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {question.maxMarks}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </TabsContent>
                    ))}
                </Tabs>
            )}

            {/* Remarks for the learner (optional). Fixed minimum height so it never
                collapses into / overlaps the stats footer on short screens; the
                panel body scrolls when everything doesn't fit. */}
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
                <span className="text-sm font-medium text-neutral-700">{t('remarks')}</span>
                <Textarea
                    value={primaryFeedback}
                    onChange={(e) => handleFeedbackChange(e.target.value)}
                    placeholder={t('addRemarksPlaceholder')}
                    disabled={!primaryQuestion}
                    className="min-h-24 resize-none"
                />
            </div>

            {/* Evaluation meta — de-emphasised */}
            <div className="space-y-1.5 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500">
                <div className="flex items-center justify-between">
                    <span>{t('pagesReviewed')}</span>
                    <span className="font-medium text-neutral-700">
                        {pageData.pagesVisited.size} / {pageData.totalPages}
                    </span>
                </div>
                {pageData.pagesNotVisited.length > 0 && (
                    <div className="flex items-center justify-between">
                        <span>{t('notVisited')}</span>
                        <span className="text-neutral-600">
                            {pageData.pagesNotVisited.join(', ')}
                        </span>
                    </div>
                )}
                <div className="flex items-center justify-between">
                    <span>{t('timeOnEvaluation')}</span>
                    <span className="font-medium text-neutral-700">{formatTime(elapsedTime)}</span>
                </div>
            </div>

            <MyDialog
                heading={t('previewQuestionHeading')}
                open={!!previewQuestionContent}
                onOpenChange={() => setPreviewQuestionContent('')}
            >
                <strong className="-mt-10">{t('questionLabel')}</strong>
                <div
                    className="mb-5 mt-2 text-sm"
                    dangerouslySetInnerHTML={{ __html: previewQuestionContent }}
                />
            </MyDialog>
        </div>
    );
}
