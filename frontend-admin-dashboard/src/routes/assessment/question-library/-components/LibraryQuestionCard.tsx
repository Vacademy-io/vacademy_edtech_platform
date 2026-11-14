import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CaretDown,
    CaretUp,
    CheckCircle,
    Circle,
    ClipboardText,
    FolderMinus,
    FolderPlus,
    PencilSimpleLine,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { sanitizeRichHtml } from '@/lib/sanitize-html';
import { renderLatexDelimiters } from '@/lib/latex-delimiters';
import {
    nodePath,
    type LibraryNode,
    type LibraryQuestion,
    type LibraryTag,
} from '../-services/question-library-services';
import { difficultyTone } from './library-constants';
import { LibraryTagChip } from './LibraryQuestionFilters';

const richHtml = (html: string | null | undefined) =>
    sanitizeRichHtml(renderLatexDelimiters(html ?? ''));

interface EvaluationData {
    correctOptionIds?: string[];
    validAnswers?: (string | number)[];
    answer?: string | { content?: string };
}

const parseEvaluation = (json: string | null | undefined): EvaluationData => {
    if (!json) return {};
    try {
        return (JSON.parse(json)?.data ?? {}) as EvaluationData;
    } catch {
        return {};
    }
};

const MAX_TOPIC_CHIPS = 2;

export const LibraryQuestionCard = ({
    item,
    index,
    nodes,
    checked,
    onCheck,
    onEdit,
    onAddToTopic,
    onRemoveFromTopic,
    onRemoveTag,
    hideTopics = false,
}: {
    item: LibraryQuestion;
    /** 1-based position across pages. */
    index: number;
    nodes: LibraryNode[];
    checked: boolean;
    /** Leave out for a card that cannot be selected. */
    onCheck?: () => void;
    /** Leave out, with onAddToTopic, for a card that cannot be changed. */
    onEdit?: () => void;
    onAddToTopic?: () => void;
    /** Present only while a topic is selected. */
    onRemoveFromTopic?: () => void;
    /** Owner only: takes one tag off this question. */
    onRemoveTag?: (tag: LibraryTag) => void;
    /** A draft not saved yet has no topics to show. */
    hideTopics?: boolean;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const [open, setOpen] = useState(false);
    const question = item.question;
    const evaluation = parseEvaluation(question.auto_evaluation_json);
    const correct = new Set(evaluation.correctOptionIds ?? []);
    const difficulty = (question.ai_difficulty_level ?? '').toUpperCase();
    const type = question.question_type ?? '';
    const topics = item.node_ids.map((id) => nodePath(id, nodes)).filter(Boolean);
    const options = question.options ?? [];
    const textAnswer =
        typeof evaluation.answer === 'string' ? evaluation.answer : evaluation.answer?.content;

    return (
        <article
            className={cn(
                'flex gap-3 rounded-lg border bg-white p-4 transition-colors',
                checked ? 'border-primary-400 bg-primary-50' : 'border-neutral-200'
            )}
        >
            {onCheck && (
                <Checkbox
                    checked={checked}
                    onCheckedChange={onCheck}
                    className="mt-1"
                    aria-label={t('list.select')}
                />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-caption font-semibold text-neutral-400">
                        Q{index}
                    </span>
                    <div
                        className={cn(
                            'prose-sm min-w-0 flex-1 break-words text-body text-neutral-700',
                            !open && 'line-clamp-3'
                        )}
                        dangerouslySetInnerHTML={{
                            __html: richHtml(question.text?.content) || t('list.untitled'),
                        }}
                    />
                    <div className="flex shrink-0 items-center gap-1">
                        {onEdit && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                aria-label={t('list.edit')}
                                onClick={onEdit}
                            >
                                <PencilSimpleLine size={16} />
                            </MyButton>
                        )}
                        {onAddToTopic && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                aria-label={t('list.addToTopic')}
                                onClick={onAddToTopic}
                            >
                                <FolderPlus size={16} />
                            </MyButton>
                        )}
                        {onRemoveFromTopic && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                aria-label={t('list.removeFromTopic')}
                                onClick={onRemoveFromTopic}
                            >
                                <FolderMinus size={16} />
                            </MyButton>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-caption">
                    {type && (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
                            {t(`types.${type}`, { defaultValue: type })}
                        </span>
                    )}
                    {difficulty && (
                        <span
                            className={cn(
                                'rounded-full px-2 py-0.5 font-semibold',
                                difficultyTone[difficulty] ?? 'bg-neutral-100 text-neutral-600'
                            )}
                        >
                            {t(`difficulty.${difficulty}`, { defaultValue: difficulty })}
                        </span>
                    )}
                    {question.source_type && (
                        <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-neutral-500">
                            {t(`source.${question.source_type}`, {
                                defaultValue: question.source_type,
                            })}
                        </span>
                    )}
                    {item.assessment_count > 0 && (
                        <span className="flex items-center gap-1 rounded-full bg-info-50 px-2 py-0.5 text-info-600">
                            <ClipboardText size={12} />
                            {t('list.usedIn', { count: item.assessment_count })}
                        </span>
                    )}
                    {topics.slice(0, MAX_TOPIC_CHIPS).map((path) => (
                        <span
                            key={path}
                            className="max-w-xs truncate rounded-full bg-primary-50 px-2 py-0.5 text-primary-500"
                        >
                            {path}
                        </span>
                    ))}
                    {topics.length > MAX_TOPIC_CHIPS && (
                        <span className="text-neutral-500">
                            {t('list.moreTopics', { count: topics.length - MAX_TOPIC_CHIPS })}
                        </span>
                    )}
                    {topics.length === 0 && !hideTopics && (
                        <span className="text-neutral-400">{t('list.noTopic')}</span>
                    )}
                    {(item.tags ?? []).map((tag) => (
                        <span key={tag.tag_id} className="inline-flex items-center gap-0.5">
                            <LibraryTagChip tag={tag} />
                            {onRemoveTag && (
                                <button
                                    type="button"
                                    onClick={() => onRemoveTag(tag)}
                                    aria-label={t('tags.removeOne', { name: tag.tag_name })}
                                    className="flex size-5 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-danger-600"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </span>
                    ))}
                </div>

                {open && (
                    <div className="flex flex-col gap-3 rounded-md bg-neutral-50 p-3">
                        {options.length > 0 && (
                            <ul className="flex flex-col gap-2">
                                {options.map((option, i) => {
                                    const isCorrect =
                                        (option.id && correct.has(option.id)) ||
                                        (option.preview_id && correct.has(option.preview_id));
                                    return (
                                        <li
                                            key={option.id ?? option.preview_id ?? i}
                                            className={cn(
                                                'flex items-start gap-2 rounded-md px-2 py-1 text-body',
                                                isCorrect
                                                    ? 'bg-success-50 text-success-600'
                                                    : 'text-neutral-600'
                                            )}
                                        >
                                            {isCorrect ? (
                                                <CheckCircle
                                                    size={16}
                                                    weight="fill"
                                                    className="mt-0.5 shrink-0"
                                                />
                                            ) : (
                                                <Circle size={16} className="mt-0.5 shrink-0" />
                                            )}
                                            <span
                                                className="min-w-0 break-words"
                                                dangerouslySetInnerHTML={{
                                                    __html: richHtml(option.text?.content),
                                                }}
                                            />
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        {options.length === 0 &&
                            (evaluation.validAnswers?.length || textAnswer) && (
                                <div className="text-body text-neutral-700">
                                    <span className="font-semibold text-success-600">
                                        {t('list.answer')}{' '}
                                    </span>
                                    {evaluation.validAnswers?.length ? (
                                        evaluation.validAnswers.join(', ')
                                    ) : (
                                        <span
                                            dangerouslySetInnerHTML={{
                                                __html: richHtml(textAnswer),
                                            }}
                                        />
                                    )}
                                </div>
                            )}
                        {question.explanation_text?.content && (
                            <div className="flex flex-col gap-1 border-t border-neutral-200 pt-2">
                                <span className="text-caption font-semibold text-neutral-500">
                                    {t('list.explanation')}
                                </span>
                                <div
                                    className="break-words text-body text-neutral-600"
                                    dangerouslySetInnerHTML={{
                                        __html: richHtml(question.explanation_text.content),
                                    }}
                                />
                            </div>
                        )}
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    className="flex items-center gap-1 self-start text-caption font-semibold text-primary-500"
                >
                    {open ? <CaretUp size={14} /> : <CaretDown size={14} />}
                    {open ? t('list.hideAnswer') : t('list.showAnswer')}
                </button>
            </div>
        </article>
    );
};
