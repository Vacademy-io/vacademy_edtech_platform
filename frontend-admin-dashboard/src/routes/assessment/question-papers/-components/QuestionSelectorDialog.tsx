import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { MyQuestion } from '@/types/assessments/question-paper-form';
import { sanitizeRichHtml } from '@/lib/sanitize-html';

interface QuestionSelectorDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    questions: MyQuestion[];
    /**
     * Unused by this component — nothing reads it. Optional so callers are not
     * forced to invent a value (Step2SectionInfo was passing a hardcoded "").
     */
    paperId?: string;
    onConfirm: (selected: MyQuestion[]) => void;
}

function stripHtml(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent ?? div.innerText ?? '';
}

const QuestionSelectorDialog: React.FC<QuestionSelectorDialogProps> = ({
    open,
    onOpenChange,
    questions,
    onConfirm,
}) => {
    const { t } = useTranslation('assessmentQuestionSelectorDialog');
    const [search, setSearch] = useState('');
    const [checked, setChecked] = useState<Set<string>>(() => new Set());
    const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set());
    const scrollRef = useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (open) {
            setChecked(new Set());
            setSearch('');
            setSelectedTags(new Set());
        }
    }, [open]);

    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        questions.forEach((q) => (q.tags ?? []).forEach((tg) => tagSet.add(tg)));
        return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
    }, [questions]);

    const toggleTag = (tag: string) => {
        setSelectedTags((prev) => {
            const next = new Set(prev);
            if (next.has(tag)) next.delete(tag);
            else next.add(tag);
            return next;
        });
    };

    const filtered = useMemo(() => {
        let result = questions;
        if (search.trim()) {
            const term = search.toLowerCase();
            result = result.filter((q) =>
                stripHtml(q.questionName).toLowerCase().includes(term)
            );
        }
        if (selectedTags.size > 0) {
            result = result.filter((q) => (q.tags ?? []).some((tg) => selectedTags.has(tg)));
        }
        return result;
    }, [questions, search, selectedTags]);

    const allChecked =
        filtered.length > 0 && filtered.every((q) => q.questionId && checked.has(q.questionId));

    const toggleAll = () => {
        setChecked((prev) => {
            const next = new Set(prev);
            if (allChecked) {
                filtered.forEach((q) => q.questionId && next.delete(q.questionId));
            } else {
                filtered.forEach((q) => q.questionId && next.add(q.questionId));
            }
            return next;
        });
    };

    const toggleOne = (questionId: string) => {
        setChecked((prev) => {
            const next = new Set(prev);
            if (next.has(questionId)) next.delete(questionId);
            else next.add(questionId);
            return next;
        });
    };

    const virtualizer = useVirtualizer({
        count: filtered.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 60,
        overscan: 8,
    });

    const handleConfirm = () => {
        const selected = questions.filter((q) => q.questionId && checked.has(q.questionId));
        onConfirm(selected);
    };

    const selectedCount = checked.size;

    return (
        <MyDialog
            heading={t('dialog.heading', { count: questions.length })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-3xl"
            footer={
                <div className="flex w-full items-center justify-between">
                    <span className="text-sm text-neutral-500">
                        {t('footer.selectedCount', { count: selectedCount })}
                    </span>
                    <div className="flex items-center gap-3">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => onOpenChange(false)}
                        >
                            {t('actions.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={handleConfirm}
                            disable={selectedCount === 0}
                        >
                            {t('actions.addQuestions', { count: selectedCount })}
                        </MyButton>
                    </div>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <MyInput
                    inputType="text"
                    inputPlaceholder={t('search.placeholder')}
                    input={search}
                    onChangeFunction={(e) => setSearch(e.target.value)}
                    size="medium"
                />

                {allTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-caption text-neutral-500">
                            {t('tags.filterLabel')}
                        </span>
                        {allTags.map((tag) => {
                            const isActive = selectedTags.has(tag);
                            return (
                                <button
                                    key={tag}
                                    type="button"
                                    onClick={() => toggleTag(tag)}
                                    className={cn(
                                        'rounded-full border px-3 py-1 text-caption transition-colors',
                                        isActive
                                            ? 'border-primary-200 bg-primary-100 text-primary-600'
                                            : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100'
                                    )}
                                >
                                    {tag}
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                        <Checkbox checked={allChecked} onCheckedChange={toggleAll} id="sel-all" />
                        <label
                            htmlFor="sel-all"
                            className="cursor-pointer text-sm font-medium text-neutral-700"
                        >
                            {t('list.selectAll', { count: filtered.length })}
                        </label>
                    </div>
                    <span className="text-xs text-neutral-400">
                        {filtered.length !== questions.length &&
                            t('list.matchingCount', { count: filtered.length })}
                    </span>
                </div>

                {/* Virtualized question list */}
                <div
                    ref={scrollRef}
                    className="h-96 overflow-y-auto rounded-lg border border-neutral-200"
                >
                    {filtered.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-neutral-400">
                            {t('list.emptyState')}
                        </div>
                    ) : (
                        <div
                            style={{
                                height: `${virtualizer.getTotalSize()}px`,
                                position: 'relative',
                            }}
                        >
                            {virtualizer.getVirtualItems().map((virtualRow) => {
                                const question = filtered[virtualRow.index];
                                if (!question) return null;
                                const id = question.questionId ?? `q-${virtualRow.index}`;
                                const isChecked =
                                    !!question.questionId && checked.has(question.questionId);

                                return (
                                    <div
                                        key={id}
                                        data-index={virtualRow.index}
                                        ref={virtualizer.measureElement}
                                        /* isolate: absolute position + translateY driven by virtualizer */
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            transform: `translateY(${virtualRow.start}px)`,
                                        }}
                                        className={cn(
                                            'flex cursor-pointer items-start gap-3 border-b border-neutral-100 px-4 py-3 transition-colors hover:bg-primary-50',
                                            isChecked && 'bg-primary-50'
                                        )}
                                        onClick={() =>
                                            question.questionId && toggleOne(question.questionId)
                                        }
                                    >
                                        <Checkbox
                                            checked={isChecked}
                                            onCheckedChange={() =>
                                                question.questionId &&
                                                toggleOne(question.questionId)
                                            }
                                            onClick={(e) => e.stopPropagation()}
                                            className="mt-0.5 shrink-0"
                                        />
                                        <div className="flex min-w-0 flex-col gap-1">
                                            <div className="flex items-start gap-2">
                                                <span className="w-8 shrink-0 text-sm font-medium text-neutral-400">
                                                    {virtualRow.index + 1}.
                                                </span>
                                                <div
                                                    className="line-clamp-2 text-sm leading-relaxed text-neutral-800"
                                                    dangerouslySetInnerHTML={{
                                                        __html: sanitizeRichHtml(
                                                            question.questionName
                                                        ),
                                                    }}
                                                />
                                            </div>
                                            {(question.tags?.length ?? 0) > 0 && (
                                                <div className="flex flex-wrap gap-1 pl-10">
                                                    {question.tags?.map((tag) => (
                                                        <span
                                                            key={tag}
                                                            className="rounded-full bg-primary-50 px-2 py-0.5 text-caption text-primary-600"
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </MyDialog>
    );
};

export default QuestionSelectorDialog;
