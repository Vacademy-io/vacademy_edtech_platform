import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    CheckCircle,
    ListNumbers,
    Tag,
    CaretLeft,
    CaretRight,
    ArrowsLeftRight,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { QuizGenerationResponse } from '@/services/instructor-copilot';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useTranslation } from 'react-i18next';

interface QuizViewProps {
    data: QuizGenerationResponse;
}

// Helper component to render HTML content safely and handle math
const HtmlContent = ({ content, className }: { content: string; className?: string }) => {
    const processedContent = useMemo(() => {
        if (!content) return '';

        // Simple pass to render math if sticking to standard HTML isn't enough
        // Block math $$...$$
        const newContent = content.replace(/\$\$([^$]+)\$\$/g, (match, tex) => {
            try {
                return katex.renderToString(tex, { throwOnError: false, displayMode: true });
            } catch (e) {
                return match;
            }
        });

        // Inline math $...$
        return newContent.replace(/\$([^$]+)\$/g, (match, tex) => {
            try {
                return katex.renderToString(tex, { throwOnError: false, displayMode: false });
            } catch (e) {
                return match;
            }
        });
    }, [content]);

    return (
        <div
            className={cn(
                'prose prose-sm dark:prose-invert max-w-none [&_img]:my-2 [&_img]:rounded-lg [&_img]:border',
                className
            )}
            dangerouslySetInnerHTML={{ __html: processedContent }}
        />
    );
};

export const QuizView = ({ data }: QuizViewProps) => {
    const { t } = useTranslation('instructorCopilotQuizView');
    const [currentIndex, setCurrentIndex] = useState(0);

    if (!data || !data.questions || data.questions.length === 0) {
        return (
            <div className="text-center text-slate-500">
                <p>{t('noQuestionsAvailable')}</p>
            </div>
        );
    }

    const currentQuestion = data.questions[currentIndex];

    if (!currentQuestion) {
        return (
            <div className="text-center text-slate-500">
                <p>{t('questionNotFound')}</p>
            </div>
        );
    }

    const getCorrectOptionIds = (autoEvalJson: string): string[] => {
        try {
            const parsed = JSON.parse(autoEvalJson);
            return parsed.data?.correctOptionIds || [];
        } catch {
            return [];
        }
    };

    const correctIds = getCorrectOptionIds(currentQuestion.auto_evaluation_json);

    const handleNext = () => {
        setCurrentIndex((prev) => (prev + 1) % data.questions.length);
    };

    const handlePrev = () => {
        setCurrentIndex((prev) => (prev - 1 + data.questions.length) % data.questions.length);
    };

    return (
        <div className="space-y-6">
            {/* Quiz Header */}
            <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 dark:border-slate-700 dark:from-blue-900/20 dark:to-indigo-900/20">
                <h2 className="mb-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {data.title}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="gap-1">
                        <ListNumbers size={14} />
                        {t('questionsCount', { count: data.questions.length })}
                    </Badge>
                    <Badge variant="outline">{data.difficulty}</Badge>
                    {data.subjects.slice(0, 2).map((subject, idx) => (
                        <Badge key={idx} variant="outline">
                            {subject}
                        </Badge>
                    ))}
                    {data.classes.slice(0, 2).map((cls, idx) => (
                        <Badge key={idx} variant="secondary">
                            {cls}
                        </Badge>
                    ))}
                </div>
            </div>

            {/* Question Card */}
            <Card>
                <CardHeader className="border-b">
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <CardTitle className="text-lg">
                                {t('questionOf', {
                                    current: currentIndex + 1,
                                    total: data.questions.length,
                                })}
                            </CardTitle>
                            <CardDescription className="mt-2 text-base text-slate-700 dark:text-slate-300">
                                <HtmlContent content={currentQuestion.text.content} />
                            </CardDescription>
                        </div>
                        <div className="flex gap-2">
                            <Badge
                                variant={
                                    currentQuestion.level === 'easy'
                                        ? 'default'
                                        : currentQuestion.level === 'medium'
                                          ? 'secondary'
                                          : 'destructive'
                                }
                            >
                                {currentQuestion.level}
                            </Badge>
                            <Badge variant="outline">{currentQuestion.question_type}</Badge>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    {/* Options */}
                    {currentQuestion.options && currentQuestion.options.length > 0 && (
                        <div className="mb-6 space-y-3">
                            <h4 className="mb-3 font-semibold text-slate-700 dark:text-slate-300">
                                {t('options')}
                            </h4>
                            {currentQuestion.options.map((option) => {
                                const isCorrect = correctIds.includes(option.preview_id);
                                return (
                                    <div
                                        key={option.preview_id}
                                        className={cn(
                                            'rounded-lg border-2 p-4 transition-all',
                                            isCorrect
                                                ? 'border-green-500 bg-green-50/50 dark:bg-green-900/10'
                                                : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/50'
                                        )}
                                    >
                                        <div className="flex items-start gap-3">
                                            <span
                                                className={cn(
                                                    'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                                                    isCorrect
                                                        ? 'bg-green-500 text-white'
                                                        : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                                                )}
                                            >
                                                {option.preview_id}
                                            </span>
                                            <div className="flex-1">
                                                <HtmlContent
                                                    content={option.text.content}
                                                    className="text-slate-800 dark:text-slate-200"
                                                />
                                            </div>
                                            {isCorrect && (
                                                <CheckCircle
                                                    size={20}
                                                    className="shrink-0 text-green-600"
                                                    weight="fill"
                                                />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Explanation */}
                    {currentQuestion.explanation_text &&
                        currentQuestion.explanation_text.content && (
                            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                                <h4 className="mb-2 flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-300">
                                    <ArrowsLeftRight size={18} />
                                    {t('explanation')}
                                </h4>
                                <div className="text-sm text-blue-800 dark:text-blue-200">
                                    <HtmlContent
                                        content={currentQuestion.explanation_text.content}
                                    />
                                </div>
                            </div>
                        )}

                    {/* Tags */}
                    {currentQuestion.tags && currentQuestion.tags.length > 0 && (
                        <div className="mt-4">
                            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-400">
                                <Tag size={16} />
                                {t('tags')}
                            </h4>
                            <div className="flex flex-wrap gap-2">
                                {currentQuestion.tags.map((tag, idx) => (
                                    <Badge key={idx} variant="secondary" className="text-xs">
                                        {tag}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Navigation */}
            <div className="flex items-center justify-between">
                <Button
                    variant="outline"
                    onClick={handlePrev}
                    disabled={data.questions.length <= 1}
                    className="gap-2"
                >
                    <CaretLeft size={16} />
                    {t('previous')}
                </Button>

                <span className="text-sm font-medium text-slate-500">
                    {t('questionOf', {
                        current: currentIndex + 1,
                        total: data.questions.length,
                    })}
                </span>

                <Button
                    variant="outline"
                    onClick={handleNext}
                    disabled={data.questions.length <= 1}
                    className="gap-2"
                >
                    {t('next')}
                    <CaretRight size={16} />
                </Button>
            </div>
        </div>
    );
};
