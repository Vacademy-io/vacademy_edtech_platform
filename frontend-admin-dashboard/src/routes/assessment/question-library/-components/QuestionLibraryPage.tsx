import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowsLeftRight,
    Books,
    CaretDown,
    ChartBar,
    EyeSlash,
    FolderMinus,
    FolderPlus,
    Files,
    Plus,
    Question,
    Tag,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyPagination } from '@/components/design-system/pagination';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { getInstituteId } from '@/constants/helper';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import {
    addLibraryTag,
    addPaperToLibraryNode,
    assignLibraryQuestions,
    buildTree,
    createLibraryNode,
    deleteLibraryNode,
    importLibrarySubjectTags,
    libraryErrorMessage,
    moveLibraryNode,
    nodePath,
    pageTotals,
    removeLibraryPaper,
    removeLibraryQuestions,
    removeLibraryTag,
    reorderLibraryNodes,
    setLibraryDifficulty,
    subtreeIds,
    updateLibraryNode,
    useLibraryQuestions,
    useLibraryRefresh,
    useLibraryTags,
    useLibraryTree,
    type LibraryFilters,
    type LibraryNode,
    type LibraryQuestion,
    type LibraryTagKind,
} from '../-services/question-library-services';
import { DIFFICULTIES, PAGE_SIZE } from './library-constants';
import { LibraryComingSoon, LibraryHeader } from './LibraryHeader';
import { CourseBreadcrumb, CourseCards, type CardAction } from './CourseBrowser';
import { DifficultyTabs, TagFilter } from './LibraryQuestionFilters';
import { AddTagDialog, InstituteAccessDialog } from './CurationDialogs';
import { AddQuestionsDialog } from './AddQuestionsDialog';
import { ImportExcelDialog } from './ImportExcelDialog';
import {
    DeleteTopicDialog,
    MoveTopicDialog,
    TopicFormDialog,
    TopicPickerDialog,
} from './TopicDialogs';
import { AddPaperToTopicDialog, ImportTagsDialog } from './ImportDialogs';
import { LibraryFilterBar } from './LibraryFilterBar';
import { LibraryQuestionCard } from './LibraryQuestionCard';
import { LibraryQuestionEditDialog } from './LibraryQuestionEditDialog';
import { LibraryPapersPanel } from './LibraryPapersPanel';

type TopicForm =
    | { mode: 'create'; parent: LibraryNode | null }
    | { mode: 'rename'; node: LibraryNode }
    | null;

/** Which questions a topic picker applies to, and how. */
type PickerJob = { questionIds: string[]; mode: 'ADD' | 'MOVE' } | null;

/** The tab strip of the Content Library. Questions is the only kind of content so far. */
const ContentLibraryTabs = () => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    return (
        <Tabs value="questions">
            <TabsList>
                <TabsTrigger value="questions" className="gap-2">
                    <Question size={16} />
                    {t('tabs.questions')}
                </TabsTrigger>
            </TabsList>
        </Tabs>
    );
};

/**
 * Content Library > Questions. Courses at the top as cards; opening one shows its topics as
 * cards and, under them, every question in it with difficulty tabs, tags and search.
 * An institute sees only the courses it was given; the owner sees and manages everything.
 */
export const QuestionLibraryPage = () => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const { setNavHeading } = useNavHeadingStore();
    const instituteId = getInstituteId() ?? '';

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('heading')}</h1>);
    }, [setNavHeading, t]);

    const tree = useLibraryTree(instituteId);
    const nodes = useMemo(() => tree.data?.nodes ?? [], [tree.data]);
    const roots = useMemo(() => buildTree(nodes), [nodes]);
    const maxDepth = tree.data?.max_depth ?? 5;
    // Read-only until the server says otherwise, so write buttons never flash at a reader.
    const readOnly = !tree.data?.can_manage;

    const [current, setCurrent] = useState<string | null>(null);
    const [unsorted, setUnsorted] = useState(false);
    const [search, setSearch] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [questionType, setQuestionType] = useState('');
    const [tagId, setTagId] = useState('');
    const [page, setPage] = useState(0);
    const [checked, setChecked] = useState<Set<string>>(new Set());

    const [topicForm, setTopicForm] = useState<TopicForm>(null);
    const [moveNode, setMoveNode] = useState<LibraryNode | null>(null);
    const [deleteNode, setDeleteNode] = useState<LibraryNode | null>(null);
    const [accessNode, setAccessNode] = useState<LibraryNode | null>(null);
    const [picker, setPicker] = useState<PickerJob>(null);
    const [editing, setEditing] = useState<LibraryQuestion | null>(null);
    const [paperOpen, setPaperOpen] = useState(false);
    const [tagsOpen, setTagsOpen] = useState(false);
    const [addTagOpen, setAddTagOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [excelOpen, setExcelOpen] = useState(false);

    const currentNode = current ? nodes.find((node) => node.id === current) ?? null : null;

    // A topic deleted elsewhere (or by us) must not leave the page pointing at nothing.
    useEffect(() => {
        if (current && tree.data && !currentNode) setCurrent(null);
    }, [current, currentNode, tree.data]);

    const tags = useLibraryTags(instituteId, unsorted ? undefined : current ?? undefined);
    const tagList = useMemo(() => tags.data ?? [], [tags.data]);
    // A tag picked in one course may not exist in the next one.
    const activeTag = tagList.some((tag) => tag.tag_id === tagId) ? tagId : '';

    const filters: LibraryFilters = useMemo(
        () => ({
            name: appliedSearch || undefined,
            difficulties: difficulty ? [difficulty] : undefined,
            question_types: questionType ? [questionType] : undefined,
            library_node_ids: !unsorted && currentNode ? [currentNode.id] : undefined,
            unsorted_only: unsorted ? true : undefined,
            tag_ids: activeTag ? [activeTag] : undefined,
        }),
        [appliedSearch, difficulty, questionType, currentNode, unsorted, activeTag]
    );
    const questions = useLibraryQuestions(instituteId, filters, page, PAGE_SIZE);
    const rows = questions.data?.content ?? [];
    const totals = pageTotals(questions.data);

    const resetPaging = () => {
        setPage(0);
        setChecked(new Set());
    };
    const open = (id: string | null) => {
        setCurrent(id);
        setUnsorted(false);
        setTagId('');
        resetPaging();
    };
    const openUnsorted = () => {
        setCurrent(null);
        setUnsorted(true);
        setTagId('');
        resetPaging();
    };

    // ------------------------------------------------------------ writes

    const refresh = useLibraryRefresh();

    /** Runs one write, toasts the outcome and refreshes. Undefined means it failed. */
    const run = async <T,>(
        work: () => Promise<T>,
        success: (result: T) => string
    ): Promise<T | undefined> => {
        try {
            const result = await work();
            refresh();
            toast.success(success(result));
            return result;
        } catch (error) {
            toast.error(libraryErrorMessage(error, t('toasts.failed')));
            return undefined;
        }
    };

    const submitTopicForm = async (name: string) => {
        if (!topicForm) return;
        if (topicForm.mode === 'create') {
            const created = await run(
                () =>
                    createLibraryNode(instituteId, {
                        name,
                        parent_id: topicForm.parent?.id ?? null,
                    }),
                () => t('toasts.topicCreated', { name })
            );
            if (!created) return;
            setTopicForm(null);
        } else {
            const renamed = await run(
                () => updateLibraryNode(instituteId, topicForm.node.id, { name }),
                () => t('toasts.topicRenamed', { name })
            );
            if (renamed === undefined) return;
            setTopicForm(null);
        }
    };

    const onCardAction = async (action: CardAction, node: LibraryNode, siblings: LibraryNode[]) => {
        if (action === 'institutes') setAccessNode(node);
        if (action === 'addChild') setTopicForm({ mode: 'create', parent: node });
        if (action === 'rename') setTopicForm({ mode: 'rename', node });
        if (action === 'move') setMoveNode(node);
        if (action === 'delete') setDeleteNode(node);
        if (action === 'up' || action === 'down') {
            const ids = siblings.map((sibling) => sibling.id);
            const from = ids.indexOf(node.id);
            const to = action === 'up' ? from - 1 : from + 1;
            if (from < 0 || to < 0 || to >= ids.length) return;
            [ids[from], ids[to]] = [ids[to]!, ids[from]!];
            await run(
                () => reorderLibraryNodes(instituteId, node.parent_id, ids),
                () => t('toasts.reordered')
            );
        }
    };

    const assign = async (nodeIds: string[]) => {
        if (!picker) return;
        const fromNodeId = picker.mode === 'MOVE' && currentNode ? currentNode.id : null;
        const done = await run(
            () =>
                assignLibraryQuestions(instituteId, {
                    question_ids: picker.questionIds,
                    node_ids: nodeIds,
                    mode: picker.mode,
                    from_node_id: fromNodeId,
                }),
            () =>
                picker.mode === 'MOVE'
                    ? t('toasts.moved', { count: picker.questionIds.length })
                    : t('toasts.added', { count: picker.questionIds.length })
        );
        if (!done) return;
        setPicker(null);
        setChecked(new Set());
    };

    const removeFromTopic = async (questionIds: string[]) => {
        if (!currentNode) return;
        await run(
            () =>
                removeLibraryQuestions(instituteId, {
                    question_ids: questionIds,
                    node_id: currentNode.id,
                }),
            () => t('toasts.removed', { count: questionIds.length, name: currentNode.name })
        );
        setChecked(new Set());
    };

    const applyDifficulty = async (level: string) => {
        const ids = Array.from(checked);
        const done = await run(
            () => setLibraryDifficulty(instituteId, { question_ids: ids, difficulty: level }),
            (result) =>
                t('toasts.difficultySet', {
                    count: result.affected,
                    level: t(`difficulty.${level}`),
                })
        );
        if (done) setChecked(new Set());
    };

    const applyTag = async (kind: LibraryTagKind, name: string) => {
        const ids = Array.from(checked);
        const done = await run(
            () => addLibraryTag(instituteId, { question_ids: ids, kind, name }),
            (result) => t('toasts.tagAdded', { count: result.affected, name })
        );
        if (!done) return;
        setAddTagOpen(false);
        setChecked(new Set());
    };

    // ------------------------------------------------------------ render helpers

    const toggleChecked = (id: string) =>
        setChecked((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const pageIds = rows.map((row) => row.question.id);
    const allOnPage = pageIds.length > 0 && pageIds.every((id) => checked.has(id));

    const difficultyCounts: Record<string, number> | undefined = unsorted
        ? undefined
        : currentNode
          ? {
                EASY: currentNode.easy_count,
                MEDIUM: currentNode.medium_count,
                HARD: currentNode.hard_count,
            }
          : tree.data?.summary.by_difficulty;
    const scopeTitle = unsorted
        ? t('scope.unsorted')
        : currentNode
          ? t('browse.questionsIn', { name: currentNode.name })
          : t('browse.allQuestions');
    const hasFilters = !!(appliedSearch || difficulty || questionType || activeTag);
    const clearFilters = () => {
        resetPaging();
        setSearch('');
        setAppliedSearch('');
        setDifficulty('');
        setQuestionType('');
        setTagId('');
    };

    // Given nothing yet: one message, not empty stats, filters and lists.
    if (readOnly && tree.data && nodes.length === 0) {
        return (
            <div className="flex flex-col gap-6">
                <ContentLibraryTabs />
                <LibraryComingSoon />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <ContentLibraryTabs />

            <LibraryHeader
                summary={tree.data?.summary}
                nodes={nodes}
                loading={tree.isLoading}
                onNewTopic={() => setTopicForm({ mode: 'create', parent: null })}
                onImportPaper={() => setPaperOpen(true)}
                onImportTags={() => setTagsOpen(true)}
                onImportExcel={() => setExcelOpen(true)}
                onShowUnsorted={openUnsorted}
                onOpenTopic={open}
                readOnly={readOnly}
            />

            {tree.isError && (
                <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4 text-body text-neutral-700">
                    <WarningCircle size={18} className="text-danger-600" />
                    <span className="flex-1">{t('errors.tree')}</span>
                    <MyButton buttonType="secondary" scale="small" onClick={() => tree.refetch()}>
                        {t('common.retry')}
                    </MyButton>
                </div>
            )}

            {/* Where we are, and the owner's tools for this level. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                    <CourseBreadcrumb
                        nodes={nodes}
                        currentId={unsorted ? null : current}
                        onOpen={open}
                        unsorted={unsorted}
                    />
                </div>
                {currentNode && !readOnly && (
                    <div className="flex flex-wrap gap-2">
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            className="gap-1"
                            onClick={() => setAddOpen(true)}
                        >
                            <Plus size={14} />
                            {t('browse.addQuestions')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            className="gap-1"
                            onClick={() => setAccessNode(currentNode)}
                        >
                            <EyeSlash size={14} />
                            {t('browse.institutesWithCount', {
                                count: currentNode.hidden_count ?? 0,
                            })}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            className="gap-1"
                            onClick={() => setPaperOpen(true)}
                        >
                            <Files size={14} />
                            {t('scope.addPaperHere')}
                        </MyButton>
                    </div>
                )}
            </div>

            {!unsorted && (
                <CourseCards
                    nodes={nodes}
                    currentId={current}
                    loading={tree.isLoading}
                    maxDepth={maxDepth}
                    readOnly={readOnly}
                    unsortedCount={tree.data?.summary.unsorted_questions ?? 0}
                    onOpen={open}
                    onOpenUnsorted={openUnsorted}
                    onAdd={(parent) => setTopicForm({ mode: 'create', parent })}
                    onAction={(action, node, siblings) => void onCardAction(action, node, siblings)}
                />
            )}

            {/* The questions of this level, and how to narrow them down. */}
            <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                    <span className="truncate text-subtitle font-semibold text-neutral-700">
                        {scopeTitle}
                    </span>
                    <span className="text-caption text-neutral-500">
                        {t('list.total', { count: totals.elements })}
                    </span>
                </div>
                <DifficultyTabs
                    value={difficulty}
                    counts={difficultyCounts}
                    onChange={(value) => {
                        resetPaging();
                        setDifficulty(value);
                    }}
                />
                <TagFilter
                    tags={tagList}
                    selected={activeTag}
                    onSelect={(value) => {
                        resetPaging();
                        setTagId(value);
                    }}
                />
                <LibraryFilterBar
                    search={search}
                    onSearchChange={setSearch}
                    onSearchApply={() => {
                        resetPaging();
                        setAppliedSearch(search.trim());
                    }}
                    questionType={questionType}
                    onQuestionTypeChange={(value) => {
                        resetPaging();
                        setQuestionType(value);
                    }}
                    onClear={hasFilters ? clearFilters : undefined}
                />
            </section>

            {!unsorted && (
                <LibraryPapersPanel
                    instituteId={instituteId}
                    nodeId={currentNode?.id}
                    readOnly={readOnly}
                    onRemove={(paper) =>
                        void run(
                            () =>
                                removeLibraryPaper(instituteId, {
                                    question_paper_id: paper.id,
                                    node_id: paper.node_id,
                                }),
                            () => t('toasts.paperRemoved', { name: paper.title })
                        )
                    }
                />
            )}

            {/* Bulk bar */}
            {!readOnly && rows.length > 0 && (
                <div
                    className={cn(
                        'flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2',
                        checked.size > 0
                            ? 'border-primary-200 bg-primary-50'
                            : 'border-neutral-200 bg-white'
                    )}
                >
                    <label className="flex cursor-pointer items-center gap-2 text-body text-neutral-600">
                        <Checkbox
                            checked={allOnPage}
                            onCheckedChange={() =>
                                setChecked((prev) => {
                                    const next = new Set(prev);
                                    pageIds.forEach((id) =>
                                        allOnPage ? next.delete(id) : next.add(id)
                                    );
                                    return next;
                                })
                            }
                        />
                        {checked.size > 0
                            ? t('bulk.selected', { count: checked.size })
                            : t('bulk.selectPage')}
                    </label>
                    {checked.size > 0 && (
                        <div className="flex flex-wrap gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                className="gap-1"
                                onClick={() =>
                                    setPicker({ questionIds: Array.from(checked), mode: 'ADD' })
                                }
                            >
                                <FolderPlus size={14} />
                                {t('bulk.addToTopic')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                className="gap-1"
                                onClick={() =>
                                    setPicker({ questionIds: Array.from(checked), mode: 'MOVE' })
                                }
                            >
                                <ArrowsLeftRight size={14} />
                                {t('bulk.moveToTopic')}
                            </MyButton>
                            {currentNode && (
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    className="gap-1"
                                    onClick={() => void removeFromTopic(Array.from(checked))}
                                >
                                    <FolderMinus size={14} />
                                    {t('bulk.removeFromTopic')}
                                </MyButton>
                            )}
                            <MyDropdown
                                dropdownList={DIFFICULTIES.map((level) => ({
                                    label: t(`difficulty.${level}`),
                                    value: level,
                                }))}
                                handleChange={(value) => void applyDifficulty(value)}
                            >
                                <span className="flex h-6 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-caption font-semibold text-neutral-600 hover:border-primary-300">
                                    <ChartBar size={14} />
                                    {t('bulk.setDifficulty')}
                                    <CaretDown size={12} />
                                </span>
                            </MyDropdown>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                className="gap-1"
                                onClick={() => setAddTagOpen(true)}
                            >
                                <Tag size={14} />
                                {t('bulk.addTag')}
                            </MyButton>
                            <MyButton
                                buttonType="text"
                                scale="small"
                                className="gap-1"
                                onClick={() => setChecked(new Set())}
                            >
                                <X size={14} />
                                {t('bulk.clear')}
                            </MyButton>
                        </div>
                    )}
                </div>
            )}

            {/* List */}
            {questions.isLoading ? (
                <div className="flex flex-col gap-3">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-28 w-full rounded-lg" />
                    ))}
                </div>
            ) : questions.isError ? (
                <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4 text-body text-neutral-700">
                    <WarningCircle size={18} className="text-danger-600" />
                    <span className="flex-1">
                        {libraryErrorMessage(questions.error, t('errors.questions'))}
                    </span>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => questions.refetch()}
                    >
                        {t('common.retry')}
                    </MyButton>
                </div>
            ) : rows.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center">
                    <Books size={32} className="text-neutral-300" />
                    <p className="text-subtitle font-semibold text-neutral-600">
                        {hasFilters
                            ? t('empty.filtered')
                            : readOnly
                              ? t('readOnly.emptyTitle')
                              : currentNode
                                ? t('empty.topic')
                                : unsorted
                                  ? t('empty.unsorted')
                                  : t('empty.all')}
                    </p>
                    <p className="max-w-md text-caption text-neutral-500">
                        {hasFilters
                            ? t('empty.filteredHint')
                            : readOnly
                              ? t('readOnly.emptyHint')
                              : currentNode
                                ? t('empty.topicHint')
                                : t('empty.allHint')}
                    </p>
                    {currentNode && !hasFilters && !readOnly && (
                        <div className="flex flex-wrap justify-center gap-2">
                            <MyButton buttonType="secondary" scale="medium" onClick={openUnsorted}>
                                {t('empty.fromUnsorted')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => setPaperOpen(true)}
                            >
                                {t('scope.addPaperHere')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={() => setAddOpen(true)}
                            >
                                {t('browse.addQuestions')}
                            </MyButton>
                        </div>
                    )}
                </div>
            ) : (
                <div className={cn('flex flex-col gap-3', questions.isFetching && 'opacity-70')}>
                    {rows.map((row, i) => (
                        <LibraryQuestionCard
                            key={row.question.id}
                            item={row}
                            index={page * PAGE_SIZE + i + 1}
                            nodes={nodes}
                            checked={checked.has(row.question.id)}
                            {...(readOnly
                                ? {}
                                : {
                                      onCheck: () => toggleChecked(row.question.id),
                                      onEdit: () => setEditing(row),
                                      onAddToTopic: () =>
                                          setPicker({
                                              questionIds: [row.question.id],
                                              mode: 'ADD',
                                          }),
                                      onRemoveFromTopic: currentNode
                                          ? () => void removeFromTopic([row.question.id])
                                          : undefined,
                                      onRemoveTag: (tag) =>
                                          void run(
                                              () =>
                                                  removeLibraryTag(instituteId, {
                                                      question_ids: [row.question.id],
                                                      tag_id: tag.tag_id,
                                                  }),
                                              () => t('toasts.tagRemoved', { name: tag.tag_name })
                                          ),
                                  })}
                        />
                    ))}
                    {totals.pages > 1 && (
                        <MyPagination
                            currentPage={page}
                            totalPages={totals.pages}
                            totalElements={totals.elements}
                            pageSize={PAGE_SIZE}
                            onPageChange={(next) => {
                                setPage(next);
                                setChecked(new Set());
                            }}
                        />
                    )}
                </div>
            )}

            {/* Dialogs. Keyed so each opening starts from fresh state. */}
            {topicForm && (
                <TopicFormDialog
                    key={
                        topicForm.mode === 'rename'
                            ? `rename-${topicForm.node.id}`
                            : `create-${topicForm.parent?.id ?? 'root'}`
                    }
                    open
                    onOpenChange={(value) => !value && setTopicForm(null)}
                    mode={topicForm.mode}
                    parentName={
                        topicForm.mode === 'create' && topicForm.parent
                            ? nodePath(topicForm.parent.id, nodes)
                            : null
                    }
                    initialName={topicForm.mode === 'rename' ? topicForm.node.name : ''}
                    onSubmit={submitTopicForm}
                />
            )}
            {moveNode && (
                <MoveTopicDialog
                    key={moveNode.id}
                    open
                    onOpenChange={(value) => !value && setMoveNode(null)}
                    node={moveNode}
                    nodes={nodes}
                    roots={roots}
                    maxDepth={maxDepth}
                    onSubmit={async (parentId) => {
                        const moved = await run(
                            () => moveLibraryNode(instituteId, moveNode.id, parentId),
                            () => t('toasts.topicMoved', { name: moveNode.name })
                        );
                        if (moved !== undefined) setMoveNode(null);
                    }}
                />
            )}
            <DeleteTopicDialog
                open={!!deleteNode}
                onOpenChange={(value) => !value && setDeleteNode(null)}
                node={deleteNode}
                subtopicCount={deleteNode ? subtreeIds(deleteNode.id, nodes).size - 1 : 0}
                onConfirm={async () => {
                    if (!deleteNode) return;
                    const doomed = subtreeIds(deleteNode.id, nodes);
                    const deleted = await run(
                        () => deleteLibraryNode(instituteId, deleteNode.id),
                        () => t('toasts.topicDeleted', { name: deleteNode.name })
                    );
                    if (!deleted) return;
                    if (current && doomed.has(current)) open(deleteNode.parent_id);
                    setDeleteNode(null);
                }}
            />
            {accessNode && (
                <InstituteAccessDialog
                    key={accessNode.id}
                    open
                    onOpenChange={(value) => !value && setAccessNode(null)}
                    instituteId={instituteId}
                    node={accessNode}
                />
            )}
            {addOpen && currentNode && (
                <AddQuestionsDialog
                    key={currentNode.id}
                    open
                    onOpenChange={setAddOpen}
                    instituteId={instituteId}
                    node={currentNode}
                    nodes={nodes}
                    onSaved={refresh}
                />
            )}
            {excelOpen && (
                <ImportExcelDialog
                    open
                    onOpenChange={setExcelOpen}
                    instituteId={instituteId}
                    onSaved={refresh}
                />
            )}
            {addTagOpen && (
                <AddTagDialog
                    open
                    onOpenChange={setAddTagOpen}
                    count={checked.size}
                    existing={tagList}
                    onSubmit={applyTag}
                />
            )}
            {picker && (
                <TopicPickerDialog
                    open
                    onOpenChange={(value) => !value && setPicker(null)}
                    title={
                        picker.mode === 'MOVE'
                            ? t('picker.moveTitle', { count: picker.questionIds.length })
                            : t('picker.addTitle', { count: picker.questionIds.length })
                    }
                    confirmLabel={picker.mode === 'MOVE' ? t('picker.move') : t('picker.add')}
                    roots={roots}
                    multiple={picker.mode === 'ADD'}
                    excludeIds={
                        picker.mode === 'MOVE' && currentNode ? [currentNode.id] : undefined
                    }
                    onSubmit={assign}
                />
            )}
            {editing && (
                <LibraryQuestionEditDialog
                    key={editing.question.id}
                    instituteId={instituteId}
                    item={editing}
                    open
                    onOpenChange={(value) => !value && setEditing(null)}
                />
            )}
            {paperOpen && (
                <AddPaperToTopicDialog
                    open
                    onOpenChange={setPaperOpen}
                    instituteId={instituteId}
                    roots={roots}
                    nodes={nodes}
                    defaultNodeId={currentNode?.id}
                    onSubmit={async (paperId, nodeId) => {
                        const added = await run(
                            () =>
                                addPaperToLibraryNode(instituteId, {
                                    question_paper_id: paperId,
                                    node_id: nodeId,
                                }),
                            (result) =>
                                t('toasts.paperAdded', {
                                    count: result.affected,
                                    name: nodePath(nodeId, nodes),
                                })
                        );
                        if (added) setPaperOpen(false);
                    }}
                />
            )}
            {tagsOpen && (
                <ImportTagsDialog
                    open
                    onOpenChange={setTagsOpen}
                    instituteId={instituteId}
                    onSubmit={async (tagIds) => {
                        const imported = await run(
                            () => importLibrarySubjectTags(instituteId, { tag_ids: tagIds }),
                            (result) =>
                                t('toasts.tagsImported', {
                                    topics: result.nodes_created,
                                    count: result.affected,
                                })
                        );
                        if (imported) setTagsOpen(false);
                    }}
                />
            )}
        </div>
    );
};
