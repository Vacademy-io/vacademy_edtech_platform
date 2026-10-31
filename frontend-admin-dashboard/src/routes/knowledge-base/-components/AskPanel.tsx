import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChatCircleDots, Quotes, Sparkle, Spinner } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import { AnswerMarkdown } from './AnswerMarkdown';
import { useAskKnowledgeBase } from '../-hooks';
import type { AskResponse } from '../-types';

interface AskPanelProps {
    kbId: string;
    kbName: string;
    /** Suggested openers derived from the corpus, so a blank box isn't the first thing shown. */
    suggestions?: string[];
    hasContent: boolean;
}

interface Turn {
    question: string;
    response: AskResponse | null;
    error?: string;
}

/**
 * "Ask this knowledge base" — the Phase 1 trust-builder.
 *
 * Every answer is grounded in retrieved chunks and shows the page it came from,
 * because the point is not the answer: it is letting an admin confirm the corpus
 * was read correctly before courses and question papers get built on top of it.
 */
export const AskPanel = ({ kbId, kbName, suggestions = [], hasContent }: AskPanelProps) => {
    const { t } = useTranslation('knowledgeBaseAskPanel');
    const [question, setQuestion] = useState('');
    const [turns, setTurns] = useState<Turn[]>([]);
    const ask = useAskKnowledgeBase(kbId);
    const scrollRef = useRef<HTMLDivElement>(null);

    const submit = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setQuestion('');
        const index = turns.length;
        setTurns((prev) => [...prev, { question: trimmed, response: null }]);

        try {
            const response = await ask.mutateAsync({
                question: trimmed,
                // Send prior turns so follow-ups like "and in Tamil?" work.
                history: turns.flatMap((t) =>
                    t.response
                        ? [
                              { role: 'user', content: t.question },
                              { role: 'assistant', content: t.response.answer },
                          ]
                        : []
                ),
            });
            setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, response } : t)));
            requestAnimationFrame(() =>
                scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
            );
        } catch (error) {
            const response = (
                error as { response?: { status?: number; data?: { detail?: unknown } } }
            )?.response;
            const detail = response?.data?.detail;
            let message = t('errors.default');
            if (response?.status === 402) {
                message =
                    typeof detail === 'object' && detail !== null && 'message' in detail
                        ? String((detail as { message: unknown }).message)
                        : t('errors.insufficientCredits');
                toast.error(message);
            }
            setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, error: message } : t)));
        }
    };

    if (!hasContent) {
        return (
            <Card className="flex flex-col items-center gap-2 p-8 text-center">
                <ChatCircleDots className="size-6 text-neutral-300" />
                <p className="text-body text-neutral-500">{t('emptyState.noContent')}</p>
            </Card>
        );
    }

    return (
        <Card className="flex flex-col">
            <div className="flex items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3">
                <div className="flex min-w-0 items-start gap-2">
                    <Sparkle className="mt-0.5 size-5 shrink-0 text-primary-500" />
                    <div className="min-w-0">
                        <p className="text-subtitle font-semibold text-neutral-700">
                            {t('title')}
                        </p>
                        <p className="break-words text-caption text-neutral-500">
                            {t('subtitle', { kbName })}
                        </p>
                    </div>
                </div>
                {turns.length > 0 && (
                    <MyButton
                        buttonType="text"
                        scale="medium"
                        onClick={() => setTurns([])}
                        disable={ask.isPending}
                    >
                        {t('actions.clear')}
                    </MyButton>
                )}
            </div>

            <div ref={scrollRef} className="max-h-96 min-w-0 overflow-y-auto p-4">
                {turns.length === 0 && (
                    <div className="flex flex-col gap-3">
                        <p className="text-caption text-neutral-500">{t('emptyState.prompt')}</p>
                        {suggestions.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {suggestions.slice(0, 3).map((s) => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => void submit(s)}
                                        className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-left text-caption text-neutral-600 transition-colors hover:border-primary-200 hover:bg-primary-50"
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div className="flex flex-col gap-5">
                    {turns.map((turn, i) => (
                        <div key={`${i}-${turn.question}`} className="flex flex-col gap-2">
                            <div className="flex items-start gap-2 rounded-md bg-neutral-50 px-3 py-2">
                                <ChatCircleDots className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                                <p className="min-w-0 break-words text-body font-medium text-neutral-700">
                                    {turn.question}
                                </p>
                            </div>

                            {!turn.response && !turn.error && (
                                <p className="flex items-center gap-2 text-body text-neutral-500">
                                    <Spinner className="size-4 animate-spin" />
                                    {t('status.searching')}
                                </p>
                            )}

                            {turn.error && (
                                <p className="break-words text-body text-danger-600">
                                    {turn.error}
                                </p>
                            )}

                            {turn.response && (
                                <>
                                    <AnswerMarkdown>{turn.response.answer}</AnswerMarkdown>

                                    {!turn.response.grounded && (
                                        <p className="text-caption text-warning-600">
                                            {t('status.notGrounded')}
                                        </p>
                                    )}

                                    {turn.response.citations.length > 0 && (
                                        <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                                            <p className="flex items-center gap-1.5 text-caption font-semibold text-neutral-600">
                                                <Quotes className="size-3.5" />
                                                {t('citations.heading')}
                                            </p>
                                            {turn.response.citations.map((c, ci) => (
                                                <div
                                                    key={`${c.source_id}-${ci}`}
                                                    className="flex flex-col gap-1.5"
                                                >
                                                    <p className="flex flex-wrap items-center gap-1.5 text-caption text-neutral-600">
                                                        <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-medium text-neutral-500">
                                                            {ci + 1}
                                                        </span>
                                                        <span className="min-w-0 break-words">
                                                            {c.label}
                                                        </span>
                                                    </p>
                                                    {c.figures.length > 0 && (
                                                        <div className="flex flex-wrap gap-2">
                                                            {c.figures
                                                                .filter((f) => f.image_url)
                                                                .slice(0, 4)
                                                                .map((f) => (
                                                                    <img
                                                                        key={f.id}
                                                                        src={f.image_url}
                                                                        alt={
                                                                            f.caption ||
                                                                            f.alt_text ||
                                                                            t('citations.figureAlt')
                                                                        }
                                                                        className="h-20 w-auto max-w-full rounded border border-neutral-200 bg-white object-contain"
                                                                    />
                                                                ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {(turn.response.follow_up_questions?.length ?? 0) > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {turn.response.follow_up_questions
                                                ?.slice(0, 3)
                                                .map((q) => (
                                                    <button
                                                        key={q}
                                                        type="button"
                                                        onClick={() => void submit(q)}
                                                        className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-caption text-neutral-600 transition-colors hover:border-primary-200 hover:bg-primary-50"
                                                    >
                                                        {q}
                                                        <ArrowRight className="size-3" />
                                                    </button>
                                                ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex items-end gap-2 border-t border-neutral-200 p-3">
                <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void submit(question);
                        }
                    }}
                    rows={2}
                    placeholder={t('input.placeholder')}
                    aria-label={t('input.ariaLabel')}
                    className="flex-1 resize-none rounded-md border border-neutral-300 px-3 py-2 text-body focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-100"
                />
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={() => void submit(question)}
                    disable={ask.isPending || !question.trim()}
                >
                    {ask.isPending ? t('actions.asking') : t('actions.ask')}
                </MyButton>
            </div>
        </Card>
    );
};
