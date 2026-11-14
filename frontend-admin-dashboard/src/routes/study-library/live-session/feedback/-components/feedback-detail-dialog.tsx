import { useTranslation } from 'react-i18next';
import { Star, ChatText, User, Calendar } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import type { LiveClassFeedbackRow } from '../-types/types';
import {
    isStarQuestion,
    isTextQuestion,
    maxStarsFor,
    parseQuestions,
    parseResponses,
} from '../-utils/parse';

interface FeedbackDetailDialogProps {
    row: LiveClassFeedbackRow | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function StarValue({ value, max }: { value: number; max: number }) {
    return (
        <div className="flex items-center gap-1.5">
            <Star weight="fill" className="size-5 text-warning-500" />
            <span className="text-base font-semibold text-neutral-800">{value}</span>
            <span className="text-sm text-neutral-400">/ {max}</span>
        </div>
    );
}

export function FeedbackDetailDialog({ row, open, onOpenChange }: FeedbackDetailDialogProps) {
    const { t } = useTranslation('studyLibraryFeedbackDetailDialog');
    const questions = row ? parseQuestions(row) : [];
    const responses = row ? parseResponses(row) : {};
    const answered = questions.filter((q) => {
        const v = responses[q.id];
        return v != null && String(v).trim().length > 0;
    });

    return (
        <MyDialog
            heading={t('feedbackDetails')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
        >
            {row && (
                <div className="flex flex-col gap-4 p-6">
                    {/* Submission meta */}
                    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                        <h3 className="text-base font-semibold text-neutral-800">
                            {row.sessionTitle || t('liveClass')}
                        </h3>
                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-neutral-600">
                            <span className="flex items-center gap-1.5">
                                <User className="size-4 text-neutral-400" />
                                {row.learnerName || t('unknownLearner')}
                            </span>
                            {row.meetingDate && (
                                <span className="flex items-center gap-1.5">
                                    <Calendar className="size-4 text-neutral-400" />
                                    {row.meetingDate}
                                </span>
                            )}
                            {row.subject && (
                                <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-600">
                                    {row.subject}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Question → answer list */}
                    {answered.length === 0 ? (
                        <p className="py-6 text-center text-sm italic text-neutral-400">
                            {t('noAnswersRecorded')}
                        </p>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {questions.map((q) => {
                                const value = responses[q.id];
                                if (value == null || String(value).trim().length === 0) return null;

                                return (
                                    <div
                                        key={q.id}
                                        className="rounded-lg border border-neutral-200 p-3"
                                    >
                                        <p className="mb-2 text-sm font-medium text-neutral-700">
                                            {q.label}
                                        </p>
                                        {isStarQuestion(q) && !isNaN(parseFloat(String(value))) ? (
                                            <StarValue
                                                value={parseFloat(String(value))}
                                                max={maxStarsFor(q)}
                                            />
                                        ) : isTextQuestion(q) ? (
                                            <p className="flex items-start gap-2 text-sm text-neutral-600">
                                                <ChatText className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                                                <span className="whitespace-pre-wrap">
                                                    {String(value)}
                                                </span>
                                            </p>
                                        ) : (
                                            <p className="text-sm text-neutral-600">
                                                {String(value)}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </MyDialog>
    );
}
