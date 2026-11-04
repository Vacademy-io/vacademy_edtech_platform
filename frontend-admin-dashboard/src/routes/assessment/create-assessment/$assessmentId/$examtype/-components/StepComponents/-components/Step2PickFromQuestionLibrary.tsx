import { useMemo, useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { toast } from 'sonner';
import { Books, Files, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyDropdown } from '@/components/design-system/dropdown';
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
    flattenTree,
    libraryErrorMessage,
    nodePath,
    useLibraryPapers,
    useLibraryQuestions,
    useLibraryTree,
    type LibraryCopyResult,
} from '@/routes/assessment/question-library/-services/question-library-services';
import { LibraryQuestionCard } from '@/routes/assessment/question-library/-components/LibraryQuestionCard';
import {
    DIFFICULTIES,
    PAGE_SIZE,
    plainText,
    QUESTION_TYPES,
} from '@/routes/assessment/question-library/-components/library-constants';
import sectionDetailsSchema from '../../../-utils/section-details-schema';
import { calculateTotalMarks } from '../../../-utils/helper';

type SectionFormType = z.infer<typeof sectionDetailsSchema>;
type PickMode = 'questions' | 'papers';

/**
 * Add ready-made questions, or a whole paper, from the Question Library to a section.
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

    const sectionName = form.getValues(`section.${index}.sectionName`) || `Section ${index + 1}`;

    // Nothing is fetched until the dialog opens: a test has many sections.
    const tree = useLibraryTree(open ? instituteId : undefined);
    const nodes = useMemo(() => tree.data?.nodes ?? [], [tree.data]);
    const topicOptions = useMemo(
        () =>
            flattenTree(buildTree(nodes)).map((node) => ({
                label: `${nodePath(node.id, nodes)} (${node.question_count})`,
                value: node.id,
            })),
        [nodes]
    );

    const inSection = () =>
        (form.getValues(`section.${index}.adaptive_marking_for_each_question`) ?? [])
            .map((question) => question.questionId)
            .filter((id): id is string => Boolean(id));

    const filters = useMemo(
        () => {
            const ids = open ? inSection() : [];
            return {
                name: appliedSearch || undefined,
                library_node_ids: topicId ? [topicId] : undefined,
                difficulties: difficulty ? [difficulty] : undefined,
                question_types: questionType ? [questionType] : undefined,
                exclude_question_ids: ids.length ? ids : undefined,
            };
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the section is read as the dialog opens
        [open, appliedSearch, topicId, difficulty, questionType]
    );
    const questions = useLibraryQuestions(
        open && mode === 'questions' ? instituteId : undefined,
        filters,
        page,
        PAGE_SIZE
    );
    const papers = useLibraryPapers(
        open && mode === 'papers' ? instituteId : undefined,
        topicId || undefined
    );
    const active = mode === 'questions' ? questions : papers;
    const rows = questions.data?.content ?? [];
    const paperRows = papers.data ?? [];

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

    const chip = (label: string, isActive: boolean, onClick: () => void, key: string) => (
        <button
            key={key}
            type="button"
            onClick={onClick}
            className={cn(
                'rounded-full border px-3 py-1 text-caption',
                isActive
                    ? 'border-primary-400 bg-primary-50 text-primary-500'
                    : 'border-neutral-200 text-neutral-600 hover:border-primary-400'
            )}
        >
            {label}
        </button>
    );

    const toggleQuestion = (id: string) =>
        setPickedQuestions((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const switchMode = (next: PickMode) => {
        setMode(next);
        setPage(0);
        setPickedQuestions(new Set());
        setPickedPaper(null);
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
    const isEmpty = mode === 'questions' ? rows.length === 0 : paperRows.length === 0;

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
                dialogWidth="max-w-4xl"
                footer={
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            disable={adding}
                            onClick={() => onOpenChange(false)}
                        >
                            {t('common.cancel')}
                        </MyButton>
                        <MyButton
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
                <div className="flex flex-col gap-4 p-6">
                    <div className="flex flex-wrap items-center gap-2">
                        {chip(
                            t('pick.questions'),
                            mode === 'questions',
                            () => switchMode('questions'),
                            'questions'
                        )}
                        {chip(
                            t('pick.papers'),
                            mode === 'papers',
                            () => switchMode('papers'),
                            'papers'
                        )}
                    </div>

                    {topicOptions.length > 0 && (
                        <div className="flex flex-col gap-1">
                            <p className="text-caption text-neutral-500">{t('pick.topic')}</p>
                            <div className="flex flex-wrap items-center gap-2">
                                {chip(
                                    t('filters.any'),
                                    topicId === '',
                                    () => {
                                        setPage(0);
                                        setTopicId('');
                                    },
                                    'any-topic'
                                )}
                                <MyDropdown
                                    currentValue={topicId ? nodePath(topicId, nodes) : ''}
                                    placeholder={t('pick.chooseTopic')}
                                    dropdownList={topicOptions}
                                    handleChange={(value) => {
                                        setPage(0);
                                        setTopicId(value);
                                        setPickedPaper(null);
                                    }}
                                    contentClassName="max-h-72 overflow-y-auto"
                                />
                            </div>
                        </div>
                    )}

                    {mode === 'questions' && (
                        <>
                            <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <MyInput
                                        inputType="text"
                                        inputPlaceholder={t('filters.search')}
                                        input={search}
                                        onChangeFunction={(e) => setSearch(e.target.value)}
                                        className="sm:w-full"
                                    />
                                </div>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    layoutVariant="icon"
                                    aria-label={t('filters.searchButton')}
                                    onClick={() => {
                                        setPage(0);
                                        setAppliedSearch(search.trim());
                                    }}
                                >
                                    <MagnifyingGlass size={16} />
                                </MyButton>
                            </div>
                            <div className="flex flex-wrap gap-6">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-caption text-neutral-500">
                                        {t('filters.difficulty')}
                                    </span>
                                    {chip(
                                        t('filters.any'),
                                        difficulty === '',
                                        () => {
                                            setPage(0);
                                            setDifficulty('');
                                        },
                                        'any-difficulty'
                                    )}
                                    {DIFFICULTIES.map((level) =>
                                        chip(
                                            t(`difficulty.${level}`),
                                            difficulty === level,
                                            () => {
                                                setPage(0);
                                                setDifficulty(level);
                                            },
                                            level
                                        )
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-caption text-neutral-500">
                                        {t('filters.type')}
                                    </span>
                                    {chip(
                                        t('filters.any'),
                                        questionType === '',
                                        () => {
                                            setPage(0);
                                            setQuestionType('');
                                        },
                                        'any-type'
                                    )}
                                    {QUESTION_TYPES.map((type) =>
                                        chip(
                                            t(`types.${type}`),
                                            questionType === type,
                                            () => {
                                                setPage(0);
                                                setQuestionType(type);
                                            },
                                            type
                                        )
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {active.isLoading ? (
                        <Skeleton className="h-64 w-full rounded-lg" />
                    ) : active.isError ? (
                        <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4">
                            <WarningCircle className="mt-0.5 size-4 shrink-0 text-danger-600" />
                            <div className="flex flex-col gap-2">
                                <p className="text-caption text-neutral-700">
                                    {libraryErrorMessage(active.error, t('pick.loadFailed'))}
                                </p>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => active.refetch()}
                                >
                                    {t('common.retry')}
                                </MyButton>
                            </div>
                        </div>
                    ) : isEmpty ? (
                        <div className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 p-8 text-center">
                            <Books size={24} className="text-neutral-300" />
                            <p className="text-body text-neutral-600">
                                {mode === 'papers' ? t('pick.noPapers') : t('pick.noQuestions')}
                            </p>
                            <p className="text-caption text-neutral-500">{t('pick.emptyHint')}</p>
                        </div>
                    ) : mode === 'papers' ? (
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
                                        <Files size={18} className="shrink-0 text-primary-500" />
                                        <span className="min-w-0 flex-1 truncate text-body text-neutral-700">
                                            {paper.title}
                                        </span>
                                        <span className="shrink-0 text-caption text-neutral-500">
                                            {t('list.total', { count: paper.question_count })}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="flex flex-col gap-2">
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
                            {(questions.data?.total_pages ?? 0) > 1 && (
                                <MyPagination
                                    currentPage={page}
                                    totalPages={questions.data?.total_pages ?? 0}
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

export default Step2PickFromQuestionLibrary;
