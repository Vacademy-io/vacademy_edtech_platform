/**
 * Quiz / feedback slide, presentation only. A copy of the presentation branch of
 * slidesTypes/QuizSlides.tsx (from line 173) without react-hook-form, the
 * RichTextEditor/TipTap path, the slide store or hover effects, scaled for a
 * classroom screen. Correct answers are not revealed (same as the admin view).
 *
 * The question timer is not drawn here: in a live session ResponseOverlay shows
 * it from slide_start_timestamp; a local preview has no timer.
 */
import { ChatCircleText, CheckCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { sanitizeRichHtml } from '@/lib/sanitize-html';
import { cn } from '@/lib/utils';
import type { PanelQuestionData } from './types';

export interface QuizSlideViewProps {
    kind: 'quiz' | 'feedback';
    question: PanelQuestionData;
    className?: string;
}

export function QuizSlideView({ kind, question, className }: QuizSlideViewProps) {
    const { t } = useTranslation('volt');
    const options = kind === 'quiz' ? question.singleChoiceOptions : [];
    const hasContent = !!question.questionName || options.length > 0;

    return (
        <div
            className={cn(
                'size-full overflow-y-auto rounded-md bg-card px-12 py-10 text-card-foreground',
                className
            )}
        >
            <div className="mx-auto max-w-5xl space-y-8 pb-32 text-center">
                <span className="inline-flex items-center space-x-2 rounded-md bg-primary-50 px-4 py-2 text-title font-semibold text-primary-500">
                    {kind === 'quiz' ? (
                        <CheckCircle size={28} aria-hidden />
                    ) : (
                        <ChatCircleText size={28} aria-hidden />
                    )}
                    <span>{kind === 'quiz' ? t('slide.quizLabel') : t('slide.feedbackLabel')}</span>
                </span>

                {question.questionName ? (
                    <h2
                        className="text-h1 font-semibold text-neutral-800"
                        // Sanitised rich text from the question bank.
                        dangerouslySetInnerHTML={{
                            __html: sanitizeRichHtml(question.questionName),
                        }}
                    />
                ) : null}

                {options.length > 0 && (
                    <ol className="grid grid-cols-1 gap-4 text-left xl:grid-cols-2">
                        {options.map((option, index) => (
                            <li
                                key={option.id || `option-${index}`}
                                className="flex items-start rounded-lg border border-border bg-background p-5 shadow-sm"
                            >
                                <span className="mr-4 flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-500 text-h3 font-semibold text-neutral-50">
                                    {String.fromCharCode(65 + index)}
                                </span>
                                <span
                                    className="min-w-0 whitespace-normal break-words pt-2 text-h3 text-neutral-700"
                                    dangerouslySetInnerHTML={{
                                        __html:
                                            sanitizeRichHtml(option.name) ||
                                            t('slide.optionMissing'),
                                    }}
                                />
                            </li>
                        ))}
                    </ol>
                )}

                {kind === 'feedback' && (
                    <div className="rounded-lg border-2 border-dashed border-border bg-background p-10">
                        <ChatCircleText
                            size={56}
                            className="mx-auto text-neutral-400"
                            aria-hidden
                        />
                        <p className="pt-3 text-h3 text-neutral-500">{t('slide.feedbackHint')}</p>
                    </div>
                )}

                {!hasContent && kind === 'quiz' && (
                    <p className="text-h3 text-neutral-500">{t('slide.awaitingContent')}</p>
                )}
            </div>
        </div>
    );
}

export default QuizSlideView;
