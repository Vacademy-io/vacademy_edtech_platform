import { useMemo, useState, type ReactNode } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { toast } from 'sonner';
import { Books, Files, ListChecks, Shuffle, WarningCircle, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { MyPagination } from '@/components/design-system/pagination';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { getInstituteId } from '@/constants/helper';
import { cn } from '@/lib/utils';
import {
    describeMerge,
    mergeSectionQuestions,
} from '@/routes/assessment/question-papers/-utils/merge-section-questions';
import {
    buildTree,
    copyLibraryQuestions,
    fetchLibraryQuestions,
    libraryErrorMessage,
    pageTotals,
    randomPickLibraryQuestions,
    useLibraryAvailability,
    useLibraryPapers,
    useLibraryQuestions,
    useLibraryTree,
    type LibraryCopyResult,
    type LibraryQuestion,
} from '@/routes/assessment/question-library/-services/question-library-services';
import { LibraryFilterBar } from '@/routes/assessment/question-library/-components/LibraryFilterBar';
import { LibraryQuestionCard } from '@/routes/assessment/question-library/-components/LibraryQuestionCard';
import { TopicTree } from '@/routes/assessment/question-library/-components/TopicTree';
import {
    ALL_QUESTIONS,
    DIFFICULTIES,
    difficultyTone,
    PAGE_SIZE,
    plainText,
} from '@/routes/assessment/question-library/-components/library-constants';
import sectionDetailsSchema from '../../../-utils/section-details-schema';
import { calculateTotalMarks } from '../../../-utils/helper';

type SectionFormType = z.infer<typeof sectionDetailsSchema>;
type PickMode = 'questions' | 'random' | 'papers';
type Level = (typeof DIFFICULTIES)[number];

/** What the copy endpoint accepts in one call. */
const MAX_ADD = 500;
const SELECT_ALL_PAGE_SIZE = 100;

const toCount = (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
};

/**
 * Add ready-made questions, or a whole paper, from the Question Library to a section.
 *
 * Pick a folder on the left. On the right choose questions by hand, select them all, take a
 * random number per difficulty, or take a whole paper.
 *
 * Adding makes the server copy them into this institute and the section links to the
 * copies. So an edit made in this test stays in this test: the library and every other
 * test keep their own version.
 */
const Step2PickFromQuestionLibrary = ({
    form,
    index,
}: {
    form: UseFormReturn<SectionFormType>;
    index: number;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const instituteId = getInstituteId() ?? undefined;
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<PickMode>('questions');
    const [topicId, setTopicId] = useState('');
    const [search, setSearch] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [questionType, setQuestionType] = useState('');
    const [page, setPage] = useState(0);
    const [pickedQuestions, setPickedQuestions] = useState<Set<string>>(new Set());
    const [pickedPaper, setPickedPaper] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [selectingAll, setSelectingAll] = useState(false);
    const [counts, setCounts] = useState<Record<Level, string>>({
        EASY: '5',
        MEDIUM: '5',
        HARD: '5',
    });
    const [randomRows, setRandomRows] = useState<LibraryQuestion[]>([]);
    const [picking, setPicking] = useState(false);

    const sectionName = form.getValues(`section.${index}.sectionName`) || `Section ${index + 1}`;

    // Nothing is fetched until the dialog opens: a test has many sections.
    const tree = useLibraryTree(open ? instituteId : undefined);
    const nodes = useMemo(() => tree.data?.nodes ?? [], [tree.data]);
    const roots = useMemo(() => buildTree(nodes), [nodes]);
    // "All" means what the library offers: everything placed on a topic. The owner's other
    // questions cannot be copied from here, so they must not be listed either.
    const scopeNodeIds = useMemo(
        () => (topicId ? [topicId] : nodes.map((node) => node.id)),
        [topicId, nodes]
    );
    const hasTopics = nodes.length > 0;

    const inSection = () =>
        (form.getValues(`section.${index}.adaptive_marking_for_each_question`) ?? [])
            .map((question) => question.questionId)
            .filter((id): id is string => Boolean(id));

    const filters = useMemo(
        () => {
            const ids = open ? inSection() : [];
            return {
                name: appliedSearch || undefined,
                library_node_ids: scopeNodeIds,
                difficulties: difficulty ? [difficulty] : undefined,
                question_types: questionType ? [questionType] : undefined,
                exclude_question_ids: ids.length ? ids : undefined,
            };
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the section is read as the dialog opens
        [open, appliedSearch, scopeNodeIds, difficulty, questionType]
    );
    const questions = useLibraryQuestions(
        open && mode === 'questions' && hasTopics ? instituteId : undefined,
        filters,
        page,
        PAGE_SIZE
    );
    const papers = useLibraryPapers(
        open && mode === 'papers' && hasTopics ? instituteId : undefined,
        topicId || undefined
    );
    const availability = useLibraryAvailability(
        open && mode === 'random' && hasTopics ? instituteId : undefined,
        {
            library_node_ids: scopeNodeIds,
            question_types: filters.question_types,
            exclude_question_ids: filters.exclude_question_ids,
        }
    );
    const rows = questions.data?.content ?? [];
    const paperRows = papers.data ?? [];
    const totals = pageTotals(questions.data);
    const available = availability.data?.available;

    const reset = () => {
        setMode('questions');
        setTopicId('');
        setSearch('');
        setAppliedSearch('');
        setDifficulty('');
        setQuestionType('');
        setPage(0);
        setPickedQuestions(new Set());
        setPickedPaper(null);
        setRandomRows([]);
    };

    const onOpenChange = (next: boolean) => {
        if (adding) return;
        setOpen(next);
        if (!next) reset();
    };

    const addToSection = (result: LibraryCopyResult) => {
        const section = form.getValues(`section.${index}`);
        const marksPerQuestion = section?.marks_per_question || '1';
        const penalty = section?.negative_marking?.value || '0';
        const duration = section?.question_duration;

        const incoming = result.copied.map((question) => ({
            questionId: question.question_id,
            libraryCopy: true,
            questionName: plainText(question.text),
            questionType: question.question_type ?? 'MCQS',
            // Section defaults, matching what every other insert path applies.
            questionMark: marksPerQuestion,
            questionPenalty: penalty,
            questionDuration: { hrs: duration?.hrs ?? '0', min: duration?.min ?? '0' },
        }));
        const merged = mergeSectionQuestions(
            form.getValues(`section.${index}.adaptive_marking_for_each_question`) as
                | typeof incoming
                | undefined,
            incoming
        );
        form.setValue(`section.${index}.adaptive_marking_for_each_question`, merged.merged);
        form.setValue(`section.${index}.total_marks`, String(calculateTotalMarks(merged.merged)));
        form.trigger(`section.${index}.adaptive_marking_for_each_question`);
        return merged;
    };

    const add = async () => {
        if (!instituteId) return;
        setAdding(true);
        try {
            const result = await copyLibraryQuestions(instituteId, {
                ...(mode === 'papers' && pickedPaper
                    ? { question_paper_id: pickedPaper }
                    : { question_ids: Array.from(pickedQuestions) }),
                exclude_question_ids: inSection(),
            });
            if (result.copied.length > 0) {
                toast.success(describeMerge(addToSection(result), sectionName));
            }
            if (result.already_in_section > 0) {
                toast.info(t('pick.alreadyInSection', { count: result.already_in_section }));
            }
            if (result.failed > 0) {
                toast.warning(t('pick.someFailed', { count: result.failed }));
            }
            setOpen(false);
            reset();
        } catch (error) {
            toast.error(libraryErrorMessage(error, t('toasts.failed')));
        } finally {
            setAdding(false);
        }
    };

    const toggleQuestion = (id: string) =>
        setPickedQuestions((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const pageIds = rows.map((row) => row.question.id);
    const allOnPage = pageIds.length > 0 && pageIds.every((id) => pickedQuestions.has(id));
    const togglePage = () =>
        setPickedQuestions((prev) => {
            const next = new Set(prev);
            pageIds.forEach((id) => (allOnPage ? next.delete(id) : next.add(id)));
            return next;
        });

    const selectAllMatching = async () => {
        if (!instituteId) return;
        setSelectingAll(true);
        try {
            const ids: string[] = [];
            for (let pageNo = 0; ids.length < MAX_ADD; pageNo += 1) {
                const result = await fetchLibraryQuestions(
                    instituteId,
                    filters,
                    pageNo,
                    SELECT_ALL_PAGE_SIZE
                );
                result.content.forEach((row) => ids.push(row.question.id));
                if (result.content.length < SELECT_ALL_PAGE_SIZE) break;
            }
            setPickedQuestions((prev) => new Set([...prev, ...ids.slice(0, MAX_ADD)]));
            if (totals.elements > MAX_ADD) toast.info(t('pick.tooMany', { count: MAX_ADD }));
        } catch (error) {
            toast.error(libraryErrorMessage(error, t('pick.loadFailed')));
        } finally {
            setSelectingAll(false);
        }
    };

    const askedTotal = DIFFICULTIES.reduce(
        (sum, level) => sum + Math.min(toCount(counts[level]), available?.[level] ?? 0),
        0
    );

    const pickRandom = async () => {
        if (!instituteId) return;
        setPicking(true);
        try {
            const result = await randomPickLibraryQuestions(instituteId, {
                library_node_ids: scopeNodeIds,
                question_types: filters.question_types,
                exclude_question_ids: filters.exclude_question_ids,
                easy: toCount(counts.EASY),
                medium: toCount(counts.MEDIUM),
                hard: toCount(counts.HARD),
            });
            // A new pick replaces the last one. Questions chosen by hand stay chosen.
            setPickedQuestions((prev) => {
                const next = new Set(prev);
                randomRows.forEach((row) => next.delete(row.question.id));
                result.questions.forEach((row) => next.add(row.question.id));
                return next;
            });
            setRandomRows(result.questions);
        } catch (error) {
            toast.error(libraryErrorMessage(error, t('pick.loadFailed')));
        } finally {
            setPicking(false);
        }
    };

    const selectTopic = (id: string) => {
        setTopicId(id === ALL_QUESTIONS ? '' : id);
        setPage(0);
        setPickedPaper(null);
        setRandomRows([]);
    };

    const clearFilters = () => {
        setPage(0);
        setSearch('');
        setAppliedSearch('');
        setDifficulty('');
        setQuestionType('');
    };

    const canAdd = mode === 'papers' ? !!pickedPaper : pickedQuestions.size > 0;
    const addLabel =
        mode === 'papers'
            ? pickedPaper
                ? t('pick.addPaper')
                : t('pick.selectPaper')
            : pickedQuestions.size > 0
              ? t('pick.addQuestions', { count: pickedQuestions.size })
              : t('pick.selectQuestions');

    const errorBox = (error: unknown, retry: () => void) => (
        <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4">
            <WarningCircle className="mt-0.5 size-4 shrink-0 text-danger-600" />
            <div className="flex flex-col gap-2">
                <p className="text-caption text-neutral-700">
                    {libraryErrorMessage(error, t('pick.loadFailed'))}
                </p>
                <MyButton type="button" buttonType="secondary" scale="small" onClick={retry}>
                    {t('common.retry')}
                </MyButton>
            </div>
        </div>
    );

    const emptyBox = (title: string) => (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 p-8 text-center">
            <Books size={24} className="text-neutral-300" />
            <p className="text-body text-neutral-600">{title}</p>
            <p className="text-caption text-neutral-500">{t('pick.emptyHint')}</p>
        </div>
    );

    const tab = (value: PickMode, icon: ReactNode, label: string) => (
        <button
            key={value}
            type="button"
            onClick={() => {
                setMode(value);
                setPage(0);
            }}
            className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-body transition-colors',
                mode === value
                    ? 'bg-white font-semibold text-primary-500 shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-700'
            )}
        >
            {icon}
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
                <div className="flex size-10 items-center justify-center rounded-lg bg-success-50 text-success-600 transition-colors group-hover:bg-success-500 group-hover:text-white">
                    <Books size={20} weight="bold" />
                </div>
                <div className="flex-1">
                    <div className="text-sm font-semibold text-neutral-800">
                        {t('pick.cardTitle')}
                    </div>
                    <div className="text-xs text-neutral-500">{t('pick.cardHint')}</div>
                </div>
            </button>

            <MyDialog
                heading={t('pick.dialogTitle', { name: sectionName })}
                open={open}
                onOpenChange={onOpenChange}
                dialogWidth="max-w-6xl"
                footer={
                    <>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            disable={adding}
                            onClick={() => onOpenChange(false)}
                        >
                            {t('common.cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            disable={!canAdd || adding}
                            onClick={() => void add()}
                        >
                            {adding ? t('pick.adding') : addLabel}
                        </MyButton>
                    </>
                }
            >
                {tree.isLoading ? (
                    <div className="p-6">
                        <Skeleton className="h-64 w-full rounded-lg" />
                    </div>
                ) : tree.isError ? (
                    <div className="p-6">{errorBox(tree.error, () => tree.refetch())}</div>
                ) : !hasTopics ? (
                    <div className="flex flex-col items-center gap-2 p-12 text-center">
                        <Books size={32} className="text-neutral-300" />
                        <p className="text-subtitle text-neutral-600">{t('comingSoon.title')}</p>
                        <p className="text-caption text-neutral-500">{t('comingSoon.text')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-12 md:p-6">
                        <div className="min-w-0 md:col-span-4">
                            <TopicTree
                                roots={roots}
                                loading={false}
                                selected={topicId || ALL_QUESTIONS}
                                onSelect={selectTopic}
                                totalQuestions={roots.reduce(
                                    (sum, node) => sum + node.question_count,
                                    0
                                )}
                                unsortedQuestions={0}
                                maxDepth={tree.data?.max_depth ?? 4}
                                onAddTopic={() => undefined}
                                onAction={() => undefined}
                                readOnly
                                searchable
                                scrollBody
                            />
                        </div>

                        <div className="flex min-w-0 flex-col gap-3 md:col-span-8">
                            <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
                                {tab('questions', <ListChecks size={16} />, t('pick.questions'))}
                                {tab('random', <Shuffle size={16} />, t('pick.random'))}
                                {tab('papers', <Files size={16} />, t('pick.papers'))}
                            </div>

                            {mode !== 'papers' && pickedQuestions.size > 0 && (
                                <div className="flex items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2">
                                    <span className="flex-1 text-body font-semibold text-primary-500">
                                        {t('bulk.selected', { count: pickedQuestions.size })}
                                    </span>
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        scale="small"
                                        className="gap-1"
                                        onClick={() => setPickedQuestions(new Set())}
                                    >
                                        <X size={14} />
                                        {t('bulk.clear')}
                                    </MyButton>
                                </div>
                            )}

                            {mode === 'questions' && (
                                <>
                                    <LibraryFilterBar
                                        search={search}
                                        onSearchChange={setSearch}
                                        onSearchApply={() => {
                                            setPage(0);
                                            setAppliedSearch(search.trim());
                                        }}
                                        difficulty={difficulty}
                                        onDifficultyChange={(value) => {
                                            setPage(0);
                                            setDifficulty(value);
                                        }}
                                        questionType={questionType}
                                        onQuestionTypeChange={(value) => {
                                            setPage(0);
                                            setQuestionType(value);
                                        }}
                                        onClear={
                                            appliedSearch || difficulty || questionType
                                                ? clearFilters
                                                : undefined
                                        }
                                    />

                                    {questions.isLoading ? (
                                        <Skeleton className="h-64 w-full rounded-lg" />
                                    ) : questions.isError ? (
                                        errorBox(questions.error, () => questions.refetch())
                                    ) : rows.length === 0 ? (
                                        emptyBox(t('pick.noQuestions'))
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 px-4 py-2">
                                                <label className="flex cursor-pointer items-center gap-2 text-body text-neutral-600">
                                                    <Checkbox
                                                        checked={allOnPage}
                                                        onCheckedChange={togglePage}
                                                    />
                                                    {t('bulk.selectPage')}
                                                </label>
                                                <MyButton
                                                    type="button"
                                                    buttonType="secondary"
                                                    scale="small"
                                                    disable={selectingAll}
                                                    onClick={() => void selectAllMatching()}
                                                >
                                                    {t('pick.selectAll', {
                                                        count: Math.min(totals.elements, MAX_ADD),
                                                    })}
                                                </MyButton>
                                                <span className="ml-auto text-caption text-neutral-500">
                                                    {t('list.total', { count: totals.elements })}
                                                </span>
                                            </div>
                                            {rows.map((row, i) => (
                                                <LibraryQuestionCard
                                                    key={row.question.id}
                                                    item={row}
                                                    index={page * PAGE_SIZE + i + 1}
                                                    nodes={nodes}
                                                    checked={pickedQuestions.has(row.question.id)}
                                                    onCheck={() => toggleQuestion(row.question.id)}
                                                />
                                            ))}
                                            {totals.pages > 1 && (
                                                <MyPagination
                                                    currentPage={page}
                                                    totalPages={totals.pages}
                                                    onPageChange={setPage}
                                                />
                                            )}
                                        </div>
                                    )}
                                </>
                            )}

                            {mode === 'random' && (
                                <>
                                    <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4">
                                        <p className="text-caption text-neutral-500">
                                            {t('pick.randomHint')}
                                        </p>
                                        <LibraryFilterBar
                                            questionType={questionType}
                                            onQuestionTypeChange={setQuestionType}
                                        />
                                        {availability.isError ? (
                                            errorBox(availability.error, () =>
                                                availability.refetch()
                                            )
                                        ) : (
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                                {DIFFICULTIES.map((level) => {
                                                    const count = available?.[level] ?? 0;
                                                    return (
                                                        <div
                                                            key={level}
                                                            className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3"
                                                        >
                                                            <span
                                                                className={cn(
                                                                    'self-start rounded-full px-2 py-0.5 text-caption font-semibold',
                                                                    difficultyTone[level]
                                                                )}
                                                            >
                                                                {t(`difficulty.${level}`)}
                                                            </span>
                                                            <MyInput
                                                                inputType="number"
                                                                input={counts[level]}
                                                                disabled={count === 0}
                                                                aria-label={t(
                                                                    `difficulty.${level}`
                                                                )}
                                                                onChangeFunction={(e) =>
                                                                    setCounts((prev) => ({
                                                                        ...prev,
                                                                        [level]: e.target.value,
                                                                    }))
                                                                }
                                                                className="sm:w-full"
                                                            />
                                                            <span
                                                                className={cn(
                                                                    'text-caption',
                                                                    available &&
                                                                        toCount(counts[level]) >
                                                                            count
                                                                        ? 'text-warning-600'
                                                                        : 'text-neutral-500'
                                                                )}
                                                            >
                                                                {availability.isLoading
                                                                    ? '…'
                                                                    : t('pick.available', {
                                                                          count,
                                                                      })}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        <MyButton
                                            type="button"
                                            buttonType="primary"
                                            scale="medium"
                                            className="gap-2 self-start"
                                            disable={askedTotal === 0 || picking}
                                            onClick={() => void pickRandom()}
                                        >
                                            <Shuffle size={16} />
                                            {randomRows.length > 0
                                                ? t('pick.pickAgain')
                                                : t('pick.pickNow', { count: askedTotal })}
                                        </MyButton>
                                    </div>
                                    {randomRows.map((row, i) => (
                                        <LibraryQuestionCard
                                            key={row.question.id}
                                            item={row}
                                            index={i + 1}
                                            nodes={nodes}
                                            checked={pickedQuestions.has(row.question.id)}
                                            onCheck={() => toggleQuestion(row.question.id)}
                                        />
                                    ))}
                                </>
                            )}

                            {mode === 'papers' &&
                                (papers.isLoading ? (
                                    <Skeleton className="h-64 w-full rounded-lg" />
                                ) : papers.isError ? (
                                    errorBox(papers.error, () => papers.refetch())
                                ) : paperRows.length === 0 ? (
                                    emptyBox(t('pick.noPapers'))
                                ) : (
                                    <ul className="flex flex-col gap-2">
                                        {paperRows.map((paper) => (
                                            <li key={paper.id}>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setPickedPaper((current) =>
                                                            current === paper.id ? null : paper.id
                                                        )
                                                    }
                                                    className={cn(
                                                        'flex w-full items-center gap-3 rounded-lg border p-4 text-left',
                                                        pickedPaper === paper.id
                                                            ? 'border-primary-400 bg-primary-50'
                                                            : 'border-neutral-200 hover:border-primary-400'
                                                    )}
                                                >
                                                    <Checkbox
                                                        checked={pickedPaper === paper.id}
                                                        aria-label={paper.title}
                                                    />
                                                    <Files
                                                        size={18}
                                                        className="shrink-0 text-primary-500"
                                                    />
                                                    <span className="min-w-0 flex-1 truncate text-body text-neutral-700">
                                                        {paper.title}
                                                    </span>
                                                    <span className="shrink-0 text-caption text-neutral-500">
                                                        {t('list.total', {
                                                            count: paper.question_count,
                                                        })}
                                                    </span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ))}
                        </div>
                    </div>
                )}
            </MyDialog>
        </>
    );
};

export default Step2PickFromQuestionLibrary;
