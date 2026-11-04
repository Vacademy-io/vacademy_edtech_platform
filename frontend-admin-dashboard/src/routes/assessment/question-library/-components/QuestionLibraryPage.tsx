import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowsLeftRight,
    Books,
    FolderMinus,
    FolderPlus,
    Plus,
    Files,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getInstituteId } from '@/constants/helper';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import {
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
    reorderLibraryNodes,
    subtreeIds,
    updateLibraryNode,
    useLibraryRefresh,
    useLibraryQuestions,
    useLibraryTree,
    type LibraryFilters,
    type LibraryNode,
    type LibraryQuestion,
    type LibraryTreeNode,
} from '../-services/question-library-services';
import { ALL_QUESTIONS, PAGE_SIZE, UNSORTED } from './library-constants';
import { DifficultyBar, LibraryComingSoon, LibraryHeader } from './LibraryHeader';
import { TopicTree, type TopicAction } from './TopicTree';
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
    const maxDepth = tree.data?.max_depth ?? 4;
    // Read-only until the server says otherwise, so write buttons never flash at a reader.
    const readOnly = !tree.data?.can_manage;

    const [selected, setSelected] = useState<string>(ALL_QUESTIONS);
    const [search, setSearch] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [questionType, setQuestionType] = useState('');
    const [page, setPage] = useState(0);
    const [checked, setChecked] = useState<Set<string>>(new Set());

    const [topicForm, setTopicForm] = useState<TopicForm>(null);
    const [moveNode, setMoveNode] = useState<LibraryNode | null>(null);
    const [deleteNode, setDeleteNode] = useState<LibraryNode | null>(null);
    const [picker, setPicker] = useState<PickerJob>(null);
    const [editing, setEditing] = useState<LibraryQuestion | null>(null);
    const [paperOpen, setPaperOpen] = useState(false);
    const [tagsOpen, setTagsOpen] = useState(false);

    const selectedNode = nodes.find((node) => node.id === selected) ?? null;

    // A topic deleted elsewhere (or by us) must not leave the page pointing at nothing.
    useEffect(() => {
        if (selected !== ALL_QUESTIONS && selected !== UNSORTED && tree.data && !selectedNode) {
            setSelected(ALL_QUESTIONS);
        }
    }, [selected, selectedNode, tree.data]);

    const filters: LibraryFilters = useMemo(
        () => ({
            name: appliedSearch || undefined,
            difficulties: difficulty ? [difficulty] : undefined,
            question_types: questionType ? [questionType] : undefined,
            library_node_ids: selectedNode ? [selectedNode.id] : undefined,
            unsorted_only: selected === UNSORTED ? true : undefined,
        }),
        [appliedSearch, difficulty, questionType, selectedNode, selected]
    );
    const questions = useLibraryQuestions(instituteId, filters, page, PAGE_SIZE);
    const rows = questions.data?.content ?? [];
    const totals = pageTotals(questions.data);

    const resetPaging = () => {
        setPage(0);
        setChecked(new Set());
    };
    const select = (id: string) => {
        setSelected(id);
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
            select(created.id);
        } else {
            const renamed = await run(
                () => updateLibraryNode(instituteId, topicForm.node.id, { name }),
                () => t('toasts.topicRenamed', { name })
            );
            if (renamed === undefined) return;
            setTopicForm(null);
        }
    };

    const onTopicAction = async (
        action: TopicAction,
        node: LibraryTreeNode,
        siblings: LibraryTreeNode[]
    ) => {
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
        const fromNodeId = picker.mode === 'MOVE' && selectedNode ? selectedNode.id : null;
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
        if (!selectedNode) return;
        await run(
            () =>
                removeLibraryQuestions(instituteId, {
                    question_ids: questionIds,
                    node_id: selectedNode.id,
                }),
            () => t('toasts.removed', { count: questionIds.length, name: selectedNode.name })
        );
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

    const scopeTitle =
        selected === ALL_QUESTIONS
            ? t('scope.all')
            : selected === UNSORTED
              ? t('scope.unsorted')
              : selectedNode
                ? nodePath(selectedNode.id, nodes)
                : '';
    const hasFilters = !!(appliedSearch || difficulty || questionType);
    const clearFilters = () => {
        resetPaging();
        setSearch('');
        setAppliedSearch('');
        setDifficulty('');
        setQuestionType('');
    };

    // Nothing to browse yet. Stats of zero, filters and two empty lists only say that three times.
    if (readOnly && tree.data && nodes.length === 0 && tree.data.summary.total_questions === 0) {
        return <LibraryComingSoon />;
    }

    return (
        <div className="flex flex-col gap-6">
            <LibraryHeader
                summary={tree.data?.summary}
                nodes={nodes}
                loading={tree.isLoading}
                onNewTopic={() => setTopicForm({ mode: 'create', parent: null })}
                onImportPaper={() => setPaperOpen(true)}
                onImportTags={() => setTagsOpen(true)}
                onShowUnsorted={() => select(UNSORTED)}
                onOpenTopic={select}
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

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-4 xl:col-span-3">
                    <TopicTree
                        roots={roots}
                        loading={tree.isLoading}
                        selected={selected}
                        onSelect={select}
                        totalQuestions={tree.data?.summary.total_questions ?? 0}
                        unsortedQuestions={tree.data?.summary.unsorted_questions ?? 0}
                        maxDepth={maxDepth}
                        onAddTopic={() => setTopicForm({ mode: 'create', parent: null })}
                        onAction={(action, node, siblings) =>
                            void onTopicAction(action, node, siblings)
                        }
                        readOnly={readOnly}
                        searchable
                    />
                </div>

                <section className="flex min-w-0 flex-col gap-4 lg:col-span-8 xl:col-span-9">
                    {/* What the list below is showing, and how to narrow it down. */}
                    <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="truncate text-subtitle font-semibold text-neutral-700">
                                    {scopeTitle}
                                </span>
                                {selectedNode ? (
                                    <div className="max-w-sm">
                                        <DifficultyBar
                                            counts={{
                                                EASY: selectedNode.easy_count,
                                                MEDIUM: selectedNode.medium_count,
                                                HARD: selectedNode.hard_count,
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <span className="text-caption text-neutral-500">
                                        {readOnly
                                            ? t('readOnly.allHint')
                                            : selected === UNSORTED
                                              ? t('scope.unsortedHint')
                                              : t('scope.allHint')}
                                    </span>
                                )}
                            </div>
                            {selectedNode && !readOnly && (
                                <div className="flex flex-wrap gap-2">
                                    {selectedNode.depth < maxDepth && (
                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            className="gap-1"
                                            onClick={() =>
                                                setTopicForm({
                                                    mode: 'create',
                                                    parent: selectedNode,
                                                })
                                            }
                                        >
                                            <Plus size={14} />
                                            {t('scope.addSubtopic')}
                                        </MyButton>
                                    )}
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

                        <LibraryFilterBar
                            search={search}
                            onSearchChange={setSearch}
                            onSearchApply={() => {
                                resetPaging();
                                setAppliedSearch(search.trim());
                            }}
                            difficulty={difficulty}
                            onDifficultyChange={(value) => {
                                resetPaging();
                                setDifficulty(value);
                            }}
                            questionType={questionType}
                            onQuestionTypeChange={(value) => {
                                resetPaging();
                                setQuestionType(value);
                            }}
                            onClear={hasFilters ? clearFilters : undefined}
                        />
                    </div>

                    <LibraryPapersPanel
                        instituteId={instituteId}
                        nodeId={selectedNode?.id}
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
                                            setPicker({
                                                questionIds: Array.from(checked),
                                                mode: 'ADD',
                                            })
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
                                            setPicker({
                                                questionIds: Array.from(checked),
                                                mode: 'MOVE',
                                            })
                                        }
                                    >
                                        <ArrowsLeftRight size={14} />
                                        {t('bulk.moveToTopic')}
                                    </MyButton>
                                    {selectedNode && (
                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            className="gap-1"
                                            onClick={() =>
                                                void removeFromTopic(Array.from(checked))
                                            }
                                        >
                                            <FolderMinus size={14} />
                                            {t('bulk.removeFromTopic')}
                                        </MyButton>
                                    )}
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
                            <span className="ml-auto text-caption text-neutral-500">
                                {t('list.total', { count: totals.elements })}
                            </span>
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
                                      : selectedNode
                                        ? t('empty.topic')
                                        : selected === UNSORTED
                                          ? t('empty.unsorted')
                                          : t('empty.all')}
                            </p>
                            <p className="max-w-md text-caption text-neutral-500">
                                {hasFilters
                                    ? t('empty.filteredHint')
                                    : readOnly
                                      ? t('readOnly.emptyHint')
                                      : selectedNode
                                        ? t('empty.topicHint')
                                        : t('empty.allHint')}
                            </p>
                            {selectedNode && !hasFilters && !readOnly && (
                                <div className="flex flex-wrap justify-center gap-2">
                                    <MyButton
                                        buttonType="secondary"
                                        scale="medium"
                                        onClick={() => select(UNSORTED)}
                                    >
                                        {t('empty.fromUnsorted')}
                                    </MyButton>
                                    <MyButton
                                        buttonType="primary"
                                        scale="medium"
                                        onClick={() => setPaperOpen(true)}
                                    >
                                        {t('scope.addPaperHere')}
                                    </MyButton>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div
                            className={cn(
                                'flex flex-col gap-3',
                                questions.isFetching && 'opacity-70'
                            )}
                        >
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
                                              onRemoveFromTopic: selectedNode
                                                  ? () => void removeFromTopic([row.question.id])
                                                  : undefined,
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
                </section>
            </div>

            {/* Dialogs. Keyed so each opening starts from fresh state. */}
            {topicForm && (
                <TopicFormDialog
                    key={
                        topicForm.mode === 'rename'
                            ? `rename-${topicForm.node.id}`
                            : `create-${topicForm.parent?.id ?? 'root'}`
                    }
                    open
                    onOpenChange={(open) => !open && setTopicForm(null)}
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
                    onOpenChange={(open) => !open && setMoveNode(null)}
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
                onOpenChange={(open) => !open && setDeleteNode(null)}
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
                    if (doomed.has(selected)) select(ALL_QUESTIONS);
                    setDeleteNode(null);
                }}
            />
            {picker && (
                <TopicPickerDialog
                    open
                    onOpenChange={(open) => !open && setPicker(null)}
                    title={
                        picker.mode === 'MOVE'
                            ? t('picker.moveTitle', { count: picker.questionIds.length })
                            : t('picker.addTitle', { count: picker.questionIds.length })
                    }
                    confirmLabel={picker.mode === 'MOVE' ? t('picker.move') : t('picker.add')}
                    roots={roots}
                    multiple={picker.mode === 'ADD'}
                    excludeIds={
                        picker.mode === 'MOVE' && selectedNode ? [selectedNode.id] : undefined
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
                    onOpenChange={(open) => !open && setEditing(null)}
                />
            )}
            {paperOpen && (
                <AddPaperToTopicDialog
                    open
                    onOpenChange={setPaperOpen}
                    instituteId={instituteId}
                    roots={roots}
                    nodes={nodes}
                    defaultNodeId={selectedNode?.id}
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
