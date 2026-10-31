import { CheckCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface QuestionOptionView {
    id?: string;
    /** Option text as HTML (the option editor stores rich text). */
    name: string;
    isCorrect?: boolean;
}

/** {"data":{"correctOptionIds":[...]}} for choice questions; empty for everything else. */
export const correctOptionIdsOf = (evaluationJson?: string | null): Set<string> => {
    if (!evaluationJson) return new Set();
    try {
        const ids = JSON.parse(evaluationJson)?.data?.correctOptionIds;
        return new Set(Array.isArray(ids) ? ids.map(String) : []);
    } catch {
        return new Set();
    }
};

/**
 * Options of a question as the backend lists them, with the key marked.
 * `questions-of-sections` fills `options_with_explanation` and leaves
 * `options` empty; the question-paper DTO does the reverse, so both are read.
 */
export const optionsFromQuestionData = (q: {
    evaluation_json?: string | null;
    auto_evaluation_json?: string | null;
    options?: Array<{ id?: string | null; text?: { content?: string | null } | null }> | null;
    options_with_explanation?: Array<{
        id?: string | null;
        text?: { content?: string | null } | null;
    }> | null;
}): QuestionOptionView[] => {
    const key = correctOptionIdsOf(q.evaluation_json ?? q.auto_evaluation_json);
    const raw = q.options_with_explanation?.length ? q.options_with_explanation : q.options ?? [];
    return raw.map((opt) => ({
        id: opt.id ?? undefined,
        name: opt.text?.content ?? '',
        isCorrect: opt.id != null && key.has(String(opt.id)),
    }));
};

/**
 * Read-only list of a question's choices, lettered, the correct one(s) in
 * green with a tick. A stem alone does not tell a teacher which option the
 * AI will grade against; this sits under the question wherever it is listed.
 */
export const QuestionOptionsList = ({
    options,
    className,
}: {
    options?: QuestionOptionView[] | null;
    className?: string;
}) => {
    const { t } = useTranslation('assessmentStep2SectionInfo');
    if (!options?.length) return null;
    return (
        <ol className={cn('mt-2 flex flex-col gap-1 text-sm', className)}>
            {options.map((opt, idx) => (
                <li
                    key={opt.id ?? idx}
                    className={cn(
                        'flex items-start gap-2 rounded-md border px-2.5 py-1.5',
                        opt.isCorrect
                            ? 'border-success-200 bg-success-50 text-success-700'
                            : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                    )}
                >
                    <span className="mt-px shrink-0 text-caption font-semibold">
                        ({String.fromCharCode(97 + idx)})
                    </span>
                    <span
                        className="custom-html-content min-w-0 flex-1 [&>p]:m-0"
                        dangerouslySetInnerHTML={{ __html: opt.name }}
                    />
                    {opt.isCorrect && (
                        <CheckCircle
                            size={16}
                            weight="fill"
                            className="mt-px shrink-0 text-success-600"
                            aria-label={t('table.correctOption')}
                        />
                    )}
                </li>
            ))}
        </ol>
    );
};
