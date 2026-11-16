import { useTranslation } from 'react-i18next';
import {
    ArrowDown,
    ArrowUp,
    ArrowsOutCardinal,
    CaretRight,
    DotsThreeVertical,
    EyeSlash,
    FolderSimple,
    PencilSimple,
    Plus,
    Trash,
    Tray,
} from '@phosphor-icons/react';
import { MyDropdown } from '@/components/design-system/dropdown';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { nodeTrail, type LibraryNode } from '../-services/question-library-services';
import { DifficultyBar } from './LibraryHeader';

export type CardAction = 'addChild' | 'rename' | 'move' | 'up' | 'down' | 'delete' | 'institutes';

/** "All courses › UPSC › Polity". Every part but the last opens that level. */
export const CourseBreadcrumb = ({
    nodes,
    currentId,
    onOpen,
    unsorted = false,
}: {
    nodes: LibraryNode[];
    currentId: string | null;
    onOpen: (id: string | null) => void;
    /** The owner's "Not in a topic" view sits right under All courses. */
    unsorted?: boolean;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const trail = nodeTrail(currentId, nodes);
    const atRoot = trail.length === 0 && !unsorted;
    return (
        <nav aria-label={t('browse.breadcrumb')} className="flex flex-wrap items-center gap-1">
            {atRoot ? (
                <span className="text-subtitle font-semibold text-neutral-700">
                    {t('browse.allCourses')}
                </span>
            ) : (
                <button
                    type="button"
                    onClick={() => onOpen(null)}
                    className="text-body text-primary-500 hover:underline"
                >
                    {t('browse.allCourses')}
                </button>
            )}
            {unsorted && (
                <>
                    <CaretRight size={14} className="text-neutral-400" />
                    <span className="text-subtitle font-semibold text-neutral-700">
                        {t('scope.unsorted')}
                    </span>
                </>
            )}
            {trail.map((node, i) => {
                const last = i === trail.length - 1;
                return (
                    <span key={node.id} className="flex min-w-0 items-center gap-1">
                        <CaretRight size={14} className="shrink-0 text-neutral-400" />
                        {last ? (
                            <span className="truncate text-subtitle font-semibold text-neutral-700">
                                {node.name}
                            </span>
                        ) : (
                            <button
                                type="button"
                                onClick={() => onOpen(node.id)}
                                className="truncate text-body text-primary-500 hover:underline"
                            >
                                {node.name}
                            </button>
                        )}
                    </span>
                );
            })}
        </nav>
    );
};

const TopicCard = ({
    node,
    childCount,
    index,
    siblingCount,
    maxDepth,
    readOnly,
    onOpen,
    onAction,
}: {
    node: LibraryNode;
    childCount: number;
    index: number;
    siblingCount: number;
    maxDepth: number;
    readOnly: boolean;
    onOpen: () => void;
    onAction: (action: CardAction) => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const actions = [
        {
            label: t('browse.institutes'),
            value: 'institutes',
            icon: <EyeSlash size={16} />,
        },
        ...(node.depth < maxDepth
            ? [{ label: t('tree.addSubtopic'), value: 'addChild', icon: <Plus size={16} /> }]
            : []),
        { label: t('tree.rename'), value: 'rename', icon: <PencilSimple size={16} /> },
        { label: t('tree.move'), value: 'move', icon: <ArrowsOutCardinal size={16} /> },
        ...(index > 0
            ? [{ label: t('tree.moveUp'), value: 'up', icon: <ArrowUp size={16} /> }]
            : []),
        ...(index < siblingCount - 1
            ? [{ label: t('tree.moveDown'), value: 'down', icon: <ArrowDown size={16} /> }]
            : []),
        { label: t('tree.delete'), value: 'delete', icon: <Trash size={16} /> },
    ];
    const institutes = node.hidden_count ?? 0;

    return (
        <article className="flex items-start gap-1 rounded-lg border border-neutral-200 bg-white shadow-sm transition-colors hover:border-primary-300">
            <button
                type="button"
                onClick={onOpen}
                className="flex min-w-0 flex-1 flex-col gap-3 p-4 text-left"
            >
                <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                        <FolderSimple size={18} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-subtitle font-semibold text-neutral-700">
                            {node.name}
                        </span>
                        <span className="text-caption text-neutral-500">
                            {t('browse.questionCount', { count: node.question_count })}
                            {childCount > 0 &&
                                ` · ${t('browse.topicCount', { count: childCount })}`}
                        </span>
                    </div>
                </div>
                <DifficultyBar
                    compact
                    counts={{
                        EASY: node.easy_count,
                        MEDIUM: node.medium_count,
                        HARD: node.hard_count,
                    }}
                />
                {!readOnly && (
                    <span
                        className={cn(
                            'flex items-center gap-1 self-start rounded-full px-2 py-0.5 text-caption',
                            institutes > 0
                                ? 'bg-warning-50 text-warning-600'
                                : 'bg-neutral-100 text-neutral-500'
                        )}
                    >
                        <EyeSlash size={12} />
                        {institutes > 0
                            ? t('browse.instituteCount', { count: institutes })
                            : t('browse.noInstitutes')}
                    </span>
                )}
            </button>
            {!readOnly && (
                <div className="p-2">
                    <MyDropdown
                        dropdownList={actions}
                        handleChange={(value) => onAction(value as CardAction)}
                    >
                        <span
                            className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                            aria-label={t('tree.actions')}
                        >
                            <DotsThreeVertical size={18} weight="bold" />
                        </span>
                    </MyDropdown>
                </div>
            )}
        </article>
    );
};

/**
 * The courses at the top, or the topics inside the open one, as cards. Opening a card goes
 * one level down; the question list under it always shows everything below the open level.
 */
export const CourseCards = ({
    nodes,
    currentId,
    loading,
    maxDepth,
    readOnly,
    unsortedCount,
    onOpen,
    onOpenUnsorted,
    onAdd,
    onAction,
}: {
    nodes: LibraryNode[];
    currentId: string | null;
    loading: boolean;
    maxDepth: number;
    readOnly: boolean;
    /** Owner only, at the top level. */
    unsortedCount: number;
    onOpen: (id: string) => void;
    onOpenUnsorted: () => void;
    onAdd: (parent: LibraryNode | null) => void;
    onAction: (action: CardAction, node: LibraryNode, siblings: LibraryNode[]) => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const current = currentId ? nodes.find((node) => node.id === currentId) ?? null : null;
    const children = nodes
        .filter((node) => (node.parent_id ?? null) === currentId)
        .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
    const childCounts = new Map<string, number>();
    nodes.forEach((node) => {
        if (node.parent_id)
            childCounts.set(node.parent_id, (childCounts.get(node.parent_id) ?? 0) + 1);
    });
    const canAdd = !readOnly && (!current || current.depth < maxDepth);
    const showUnsorted = !readOnly && !currentId && unsortedCount > 0;

    if (loading) {
        return (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-36 w-full rounded-lg" />
                ))}
            </div>
        );
    }
    // A leaf topic: nothing to open, the questions below say it all.
    if (children.length === 0 && !canAdd && !showUnsorted) return null;

    return (
        <section className="flex flex-col gap-3">
            <span className="text-caption font-semibold uppercase text-neutral-500">
                {current ? t('browse.insideTopic', { name: current.name }) : t('browse.courses')}
            </span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {children.map((node, i) => (
                    <TopicCard
                        key={node.id}
                        node={node}
                        childCount={childCounts.get(node.id) ?? 0}
                        index={i}
                        siblingCount={children.length}
                        maxDepth={maxDepth}
                        readOnly={readOnly}
                        onOpen={() => onOpen(node.id)}
                        onAction={(action) => onAction(action, node, children)}
                    />
                ))}
                {showUnsorted && (
                    <button
                        type="button"
                        onClick={onOpenUnsorted}
                        className="flex items-center gap-3 rounded-lg border border-warning-200 bg-warning-50 p-4 text-left hover:border-warning-400"
                    >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white text-warning-600">
                            <Tray size={18} />
                        </span>
                        <span className="flex min-w-0 flex-col gap-1">
                            <span className="text-subtitle font-semibold text-neutral-700">
                                {t('scope.unsorted')}
                            </span>
                            <span className="text-caption text-neutral-600">
                                {t('browse.unsortedHint', { count: unsortedCount })}
                            </span>
                        </span>
                    </button>
                )}
                {canAdd && (
                    <button
                        type="button"
                        onClick={() => onAdd(current)}
                        className="flex min-h-24 items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white p-4 text-body font-semibold text-primary-500 hover:border-primary-400 hover:bg-primary-50"
                    >
                        <Plus size={16} />
                        {current ? t('browse.addTopic') : t('browse.addCourse')}
                    </button>
                )}
            </div>
        </section>
    );
};
