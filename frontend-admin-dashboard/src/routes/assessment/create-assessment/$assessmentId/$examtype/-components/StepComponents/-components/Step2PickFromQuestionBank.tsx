import { useEffect, useMemo, useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { Archive, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyInput } from '@/components/design-system/input';
import { MyPagination } from '@/components/design-system/pagination';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { getInstituteId } from '@/constants/helper';
import { useKnowledgeBases } from '@/routes/knowledge-base/-hooks';
import { curriculumOnly, ownOnly } from '@/routes/knowledge-base/-components/curriculum/curriculum';
import {
    filterQuestionBank,
    parseSourceMeta,
    type QuestionBankQuestion,
} from '@/routes/assessment/question-papers/-utils/question-bank-services';
import {
    describeMerge,
    mergeSectionQuestions,
} from '@/routes/assessment/question-papers/-utils/merge-section-questions';
import sectionDetailsSchema from '../../../-utils/section-details-schema';
import { calculateTotalMarks } from '../../../-utils/helper';

type SectionFormType = z.infer<typeof sectionDetailsSchema>;

const PAGE_SIZE = 20;

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];
const QUESTION_TYPES = ['MCQS', 'MCQM', 'TRUE_FALSE', 'ONE_WORD', 'LONG_ANSWER', 'NUMERIC'];

/** Rich text arrives as HTML; the picker only needs a readable one-liner. */
const plainText = (html: string | null | undefined): string => {
    if (!html) return '';
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const errorMessage = (error: unknown, fallback: string): string => {
    const detail = (error as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
    return typeof detail === 'string' && detail ? detail : fallback;
};

/**
 * Add questions this institute ALREADY has to a section.
 *
 * The other entry points on a section all create new questions — by hand, from a
 * document, or by paying an AI to write them. None of them can reach a question that was
 * generated last term from the same book, because until now questions were only
 * addressable through the paper that happened to contain them.
 *
 * This is the reuse path: filter the bank by knowledge base, topic, difficulty and type,
 * and link what comes back. No generation, no credits.
 */
const Step2PickFromQuestionBank = ({
    form,
    index,
}: {
    form: UseFormReturn<SectionFormType>;
    index: number;
}) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [kbId, setKbId] = useState<string>('');
    const [difficulty, setDifficulty] = useState<string>('');
    const [questionType, setQuestionType] = useState<string>('');
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [questions, setQuestions] = useState<QuestionBankQuestion[]>([]);
    const [totalPages, setTotalPages] = useState(0);
    const [selected, setSelected] = useState<Map<string, QuestionBankQuestion>>(new Map());

    const { data: allKnowledgeBases } = useKnowledgeBases();
    // Own bases stay chips; curriculum books (up to ~100 for an institute on
    // classes 1-12) go in one dropdown instead of a wall of chips.
    const knowledgeBases = useMemo(() => ownOnly(allKnowledgeBases), [allKnowledgeBases]);
    const curriculumBases = useMemo(() => curriculumOnly(allKnowledgeBases), [allKnowledgeBases]);
    const instituteId = getInstituteId();

    const sectionName = form.getValues(`section.${index}.sectionName`) || `Section ${index + 1}`;

    const load = async () => {
        if (!instituteId) return;
        setLoading(true);
        setError(null);
        try {
            // Read at call time, not from a memo: form.getValues is not reactive, so a
            // memo would either go stale or need `open` as a fake dependency.
            //
            // Questions already in this section are excluded server-side rather than
            // shown greyed out — the list is paginated, so a disabled row would take a
            // slot that could have held something the teacher can actually add.
            const alreadyInSection = (
                form.getValues(`section.${index}.adaptive_marking_for_each_question`) ?? []
            )
                .map((q) => q.questionId)
                .filter((id): id is string => Boolean(id));

            const result = await filterQuestionBank(
                instituteId,
                {
                    name: appliedSearch || undefined,
                    kb_ids: kbId ? [kbId] : undefined,
                    difficulties: difficulty ? [difficulty] : undefined,
                    question_types: questionType ? [questionType] : undefined,
                    exclude_question_ids: alreadyInSection.length ? alreadyInSection : undefined,
                },
                page,
                PAGE_SIZE
            );
            setQuestions(result.content ?? []);
            setTotalPages(result.total_pages ?? 0);
        } catch (err) {
            // A failed fetch must not render as "no questions" — that reads as an empty
            // bank and sends the teacher off to generate duplicates.
            setError(errorMessage(err, 'Could not load your question bank'));
            setQuestions([]);
            setTotalPages(0);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, page, appliedSearch, kbId, difficulty, questionType]);

    const close = (next: boolean) => {
        setOpen(next);
        if (!next) {
            setSearch('');
            setAppliedSearch('');
            setKbId('');
            setDifficulty('');
            setQuestionType('');
            setPage(0);
            setQuestions([]);
            setSelected(new Map());
            setError(null);
        }
    };

    const toggle = (question: QuestionBankQuestion) => {
        setSelected((prev) => {
            const next = new Map(prev);
            if (next.has(question.id)) next.delete(question.id);
            else next.set(question.id, question);
            return next;
        });
    };

    const addSelected = () => {
        if (selected.size === 0) return;
        const section = form.getValues(`section.${index}`);
        const marksPerQuestion = section?.marks_per_question || '1';
        const penalty = section?.negative_marking?.value || '0';
        const duration = section?.question_duration;

        const incoming = Array.from(selected.values()).map((question) => ({
            questionId: question.id,
            questionName: plainText(question.text?.content),
            questionType: question.question_type ?? 'MCQS',
            // Section defaults, matching what every other insert path applies.
            questionMark: marksPerQuestion,
            questionPenalty: penalty,
            questionDuration: { hrs: duration?.hrs ?? '0', min: duration?.min ?? '0' },
        }));

        const mergeResult = mergeSectionQuestions(
            form.getValues(`section.${index}.adaptive_marking_for_each_question`) as
                | typeof incoming
                | undefined,
            incoming
        );

        form.setValue(`section.${index}.adaptive_marking_for_each_question`, mergeResult.merged);
        form.setValue(
            `section.${index}.total_marks`,
            String(calculateTotalMarks(mergeResult.merged))
        );
        form.trigger(`section.${index}.adaptive_marking_for_each_question`);
        toast.success(describeMerge(mergeResult, sectionName));
        close(false);
    };

    const chip = (label: string, value: string, active: boolean, onClick: () => void) => (
        <button
            key={value || label}
            type="button"
            onClick={onClick}
            className={
                active
                    ? 'rounded-full border border-primary-400 bg-primary-50 px-3 py-1 text-caption text-primary-500'
                    : 'rounded-full border border-neutral-200 px-3 py-1 text-caption text-neutral-600 hover:border-primary-400'
            }
        >
            {label}
        </button>
    );

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-400 hover:shadow-md"
            >
                <div className="flex size-10 items-center justify-center rounded-lg bg-info-50 text-info-600 transition-colors group-hover:bg-info-500 group-hover:text-white">
                    <Archive size={20} weight="bold" />
                </div>
                <div className="flex-1">
                    <div className="text-sm font-semibold text-neutral-800">
                        Pick From Question Bank
                    </div>
                    <div className="text-xs text-neutral-500">
                        Reuse questions you already have — no AI credits
                    </div>
                </div>
            </button>

            <MyDialog
                heading={`Pick questions — ${sectionName}`}
                open={open}
                onOpenChange={close}
                dialogWidth="max-w-4xl"
                footer={
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => close(false)}
                        >
                            Cancel
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={selected.size === 0}
                            onClick={addSelected}
                        >
                            {selected.size === 0
                                ? 'Select questions to add'
                                : `Add ${selected.size} question${selected.size === 1 ? '' : 's'}`}
                        </MyButton>
                    </>
                }
            >
                <div className="flex flex-col gap-4 p-6">
                    <div className="flex items-end gap-3">
                        <MyInput
                            label="Search"
                            inputType="text"
                            inputPlaceholder="Search question text"
                            input={search}
                            onChangeFunction={(e) => setSearch(e.target.value)}
                            className="w-full"
                        />
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => {
                                setPage(0);
                                setAppliedSearch(search.trim());
                            }}
                        >
                            <MagnifyingGlass className="mr-1 size-4" />
                            Search
                        </MyButton>
                    </div>

                    {(knowledgeBases.length > 0 || curriculumBases.length > 0) && (
                        <div className="flex flex-col gap-1">
                            <p className="text-caption text-neutral-500">Knowledge base</p>
                            <div className="flex flex-wrap items-center gap-2">
                                {chip('Any', '', kbId === '', () => {
                                    setPage(0);
                                    setKbId('');
                                })}
                                {knowledgeBases.map((kb) =>
                                    chip(kb.name, kb.id, kbId === kb.id, () => {
                                        setPage(0);
                                        setKbId(kb.id);
                                    })
                                )}
                                {curriculumBases.length > 0 && (
                                    <MyDropdown
                                        currentValue={
                                            curriculumBases.find((kb) => kb.id === kbId)?.name ?? ''
                                        }
                                        placeholder="Curriculum book…"
                                        dropdownList={curriculumBases.map((kb) => ({
                                            label: kb.name,
                                            value: kb.id,
                                        }))}
                                        handleChange={(v) => {
                                            setPage(0);
                                            setKbId(v);
                                        }}
                                        contentClassName="max-h-72 overflow-y-auto"
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    <div className="flex flex-wrap gap-6">
                        <div className="flex flex-col gap-1">
                            <p className="text-caption text-neutral-500">Difficulty</p>
                            <div className="flex flex-wrap gap-2">
                                {chip('Any', '', difficulty === '', () => {
                                    setPage(0);
                                    setDifficulty('');
                                })}
                                {DIFFICULTIES.map((d) =>
                                    chip(d, d, difficulty === d, () => {
                                        setPage(0);
                                        setDifficulty(d);
                                    })
                                )}
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <p className="text-caption text-neutral-500">Type</p>
                            <div className="flex flex-wrap gap-2">
                                {chip('Any', '', questionType === '', () => {
                                    setPage(0);
                                    setQuestionType('');
                                })}
                                {QUESTION_TYPES.map((t) =>
                                    chip(t, t, questionType === t, () => {
                                        setPage(0);
                                        setQuestionType(t);
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    {loading && <Skeleton className="h-64 w-full rounded-lg" />}

                    {!loading && error && (
                        <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4">
                            <WarningCircle className="mt-0.5 size-4 shrink-0 text-danger-600" />
                            <div className="flex flex-col gap-2">
                                <p className="text-caption text-neutral-700">{error}</p>
                                <MyButton buttonType="secondary" scale="small" onClick={load}>
                                    Try again
                                </MyButton>
                            </div>
                        </div>
                    )}

                    {!loading && !error && questions.length === 0 && (
                        <div className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 p-8 text-center">
                            <Archive className="size-6 text-neutral-300" />
                            <p className="text-body text-neutral-600">
                                No questions match these filters
                            </p>
                            <p className="text-caption text-neutral-500">
                                Questions appear here once they have been saved to this
                                institute&apos;s bank.
                            </p>
                        </div>
                    )}

                    {!loading && !error && questions.length > 0 && (
                        <div className="flex flex-col gap-2">
                            {questions.map((question) => {
                                const meta = parseSourceMeta(question);
                                const isSelected = selected.has(question.id);
                                return (
                                    <button
                                        key={question.id}
                                        type="button"
                                        onClick={() => toggle(question)}
                                        className={
                                            isSelected
                                                ? 'flex items-start gap-3 rounded-lg border border-primary-400 bg-primary-50 p-4 text-left'
                                                : 'flex items-start gap-3 rounded-lg border border-neutral-200 p-4 text-left hover:border-primary-400'
                                        }
                                    >
                                        <Checkbox
                                            checked={isSelected}
                                            className="mt-1"
                                            aria-label="Select question"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <p className="break-words text-body text-neutral-700">
                                                {plainText(question.text?.content) ||
                                                    'Untitled question'}
                                            </p>
                                            <div className="mt-1 flex flex-wrap gap-2 text-caption text-neutral-500">
                                                <span>{question.question_type}</span>
                                                {question.ai_difficulty_level && (
                                                    <span>· {question.ai_difficulty_level}</span>
                                                )}
                                                {meta?.topic && <span>· {meta.topic}</span>}
                                                {meta?.source_page && (
                                                    <span>· p.{meta.source_page}</span>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                            {totalPages > 1 && (
                                <MyPagination
                                    currentPage={page}
                                    totalPages={totalPages}
                                    onPageChange={setPage}
                                />
                            )}
                        </div>
                    )}
                </div>
            </MyDialog>
        </>
    );
};

export default Step2PickFromQuestionBank;
