import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowDown,
    ArrowUp,
    ArrowsOutCardinal,
    CaretDown,
    CaretRight,
    DotsThreeVertical,
    FolderSimple,
    PencilSimple,
    Plus,
    Stack,
    Trash,
    Tray,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyInput } from '@/components/design-system/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { filterTree, type LibraryTreeNode } from '../-services/question-library-services';
import { ALL_QUESTIONS, UNSORTED } from './library-constants';

/** Indent per tree level (depth 1..5). */
const INDENT = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16'];

export type TopicAction = 'addChild' | 'rename' | 'move' | 'up' | 'down' | 'delete';

interface TopicTreeProps {
    roots: LibraryTreeNode[];
    loading: boolean;
    selected: string;
    onSelect: (id: string) => void;
    totalQuestions: number;
    unsortedQuestions: number;
    maxDepth: number;
    onAddTopic: () => void;
    onAction: (action: TopicAction, node: LibraryTreeNode, siblings: LibraryTreeNode[]) => void;
    /** Browsing only: no topic actions and no "not in a topic" row. */
    readOnly?: boolean;
    /** Adds a search box over the topics. */
    searchable?: boolean;
    /** Scrolls the topics inside the panel, for use in a dialog. */
    scrollBody?: boolean;
}

/** Left panel: All questions, Unsorted, then the topic tree with live counts. */
export const TopicTree = ({
    roots,
    loading,
    selected,
    onSelect,
    totalQuestions,
    unsortedQuestions,
    maxDepth,
    onAddTopic,
    onAction,
    readOnly = false,
    searchable = false,
    scrollBody = false,
}: TopicTreeProps) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState('');
    const searching = query.trim().length > 0;
    const visibleRoots = useMemo(() => filterTree(roots, query), [roots, query]);

    const toggle = (id: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const fixedRow = (id: string, icon: ReactNode, label: string, count: number) => (
        <button
            type="button"
            onClick={() => onSelect(id)}
            className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-body',
                selected === id
                    ? 'bg-primary-50 font-semibold text-primary-500'
                    : 'text-neutral-600 hover:bg-neutral-50'
            )}
        >
            {icon}
            <span className="flex-1 truncate">{label}</span>
            <span className="text-caption text-neutral-500">{count}</span>
        </button>
    );

    const renderNode = (node: LibraryTreeNode, siblings: LibraryTreeNode[], index: number) => {
        const hasChildren = node.children.length > 0;
        // A search result must be visible, whatever was collapsed before it.
        const isOpen = searching || !collapsed.has(node.id);
        const actions = [
            ...(node.depth < maxDepth
                ? [{ label: t('tree.addSubtopic'), value: 'addChild', icon: <Plus size={16} /> }]
                : []),
            { label: t('tree.rename'), value: 'rename', icon: <PencilSimple size={16} /> },
            { label: t('tree.move'), value: 'move', icon: <ArrowsOutCardinal size={16} /> },
            ...(index > 0
                ? [{ label: t('tree.moveUp'), value: 'up', icon: <ArrowUp size={16} /> }]
                : []),
            ...(index < siblings.length - 1
                ? [{ label: t('tree.moveDown'), value: 'down', icon: <ArrowDown size={16} /> }]
                : []),
            { label: t('tree.delete'), value: 'delete', icon: <Trash size={16} /> },
        ];
        return (
            <li key={node.id}>
                <div
                    className={cn(
                        'group flex items-center gap-1 rounded-md pr-1',
                        INDENT[Math.min(node.depth, INDENT.length) - 1],
                        selected === node.id ? 'bg-primary-50' : 'hover:bg-neutral-50'
                    )}
                >
                    <button
                        type="button"
                        aria-label={isOpen ? t('tree.collapse') : t('tree.expand')}
                        onClick={() => hasChildren && toggle(node.id)}
                        className={cn(
                            'flex size-6 shrink-0 items-center justify-center rounded-sm text-neutral-400',
                            hasChildren ? 'hover:text-neutral-600' : 'invisible'
                        )}
                    >
                        {isOpen ? <CaretDown size={14} /> : <CaretRight size={14} />}
                    </button>
                    <button
                        type="button"
                        onClick={() => onSelect(node.id)}
                        className={cn(
                            'flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-body',
                            selected === node.id
                                ? 'font-semibold text-primary-500'
                                : 'text-neutral-600'
                        )}
                    >
                        <FolderSimple
                            size={16}
                            weight={selected === node.id ? 'fill' : 'regular'}
                            className="shrink-0"
                        />
                        <span className="truncate">{node.name}</span>
                        <span
                            className={cn(
                                'ml-auto rounded-full px-2 text-caption',
                                node.question_count > 0
                                    ? 'bg-neutral-100 text-neutral-600'
                                    : 'text-neutral-400'
                            )}
                        >
                            {node.question_count}
                        </span>
                    </button>
                    {!readOnly && (
                        <MyDropdown
                            dropdownList={actions}
                            handleChange={(value) => onAction(value as TopicAction, node, siblings)}
                        >
                            <span
                                className="flex size-7 items-center justify-center rounded-sm text-neutral-500 hover:bg-neutral-100"
                                aria-label={t('tree.actions')}
                            >
                                <DotsThreeVertical size={18} weight="bold" />
                            </span>
                        </MyDropdown>
                    )}
                </div>
                {hasChildren && isOpen && (
                    <ul>{node.children.map((child, i) => renderNode(child, node.children, i))}</ul>
                )}
            </li>
        );
    };

    return (
        <aside className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3">
            <div className="flex items-center justify-between px-1">
                <span className="text-subtitle font-semibold text-neutral-700">
                    {t('tree.title')}
                </span>
                {!readOnly && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        className="gap-1"
                        onClick={onAddTopic}
                    >
                        <Plus size={14} />
                        {t('tree.addTopic')}
                    </MyButton>
                )}
            </div>
            {searchable && roots.length > 0 && (
                <MyInput
                    inputType="text"
                    inputPlaceholder={t('picker.search')}
                    input={query}
                    onChangeFunction={(e) => setQuery(e.target.value)}
                    className="sm:w-full"
                />
            )}
            <div className="flex flex-col gap-1">
                {fixedRow(ALL_QUESTIONS, <Stack size={16} />, t('tree.all'), totalQuestions)}
                {!readOnly &&
                    fixedRow(UNSORTED, <Tray size={16} />, t('tree.unsorted'), unsortedQuestions)}
            </div>
            <div className="border-t border-neutral-100" />
            {loading ? (
                <div className="flex flex-col gap-2">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-8 w-full rounded-md" />
                    ))}
                </div>
            ) : roots.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                    <FolderSimple size={28} className="text-neutral-300" />
                    <p className="text-body text-neutral-600">{t('tree.emptyTitle')}</p>
                    <p className="text-caption text-neutral-500">
                        {readOnly ? t('readOnly.emptyHint') : t('tree.emptyHint')}
                    </p>
                </div>
            ) : visibleRoots.length === 0 ? (
                <p className="px-3 py-4 text-center text-caption text-neutral-500">
                    {t('picker.noMatch')}
                </p>
            ) : (
                <ul className={cn('flex flex-col', scrollBody && 'max-h-96 overflow-y-auto')}>
                    {visibleRoots.map((node, i) => renderNode(node, visibleRoots, i))}
                </ul>
            )}
        </aside>
    );
};
