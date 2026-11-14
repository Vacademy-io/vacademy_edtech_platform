import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderSimple, MagnifyingGlass } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
    flattenTree,
    subtreeHeight,
    subtreeIds,
    type LibraryNode,
    type LibraryTreeNode,
} from '../-services/question-library-services';

const INDENT = ['pl-2', 'pl-6', 'pl-10', 'pl-14', 'pl-16'];
const indentFor = (depth: number) => INDENT[Math.min(Math.max(depth, 1), INDENT.length) - 1];

/** Create a topic (under parentName, or at the top) or rename one. */
export const TopicFormDialog = ({
    open,
    onOpenChange,
    mode,
    parentName,
    initialName = '',
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: 'create' | 'rename';
    parentName?: string | null;
    initialName?: string;
    onSubmit: (name: string) => Promise<void>;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const [name, setName] = useState(initialName);
    const trimmed = name.trim();

    return (
        <MyDialog
            heading={mode === 'create' ? t('topicForm.createTitle') : t('topicForm.renameTitle')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={!trimmed || trimmed === initialName.trim()}
                        onAsyncClick={async () => onSubmit(trimmed)}
                    >
                        {mode === 'create' ? t('topicForm.create') : t('topicForm.save')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                {mode === 'create' && (
                    <p className="text-caption text-neutral-500">
                        {parentName
                            ? t('topicForm.underParent', { parent: parentName })
                            : t('topicForm.topLevel')}
                    </p>
                )}
                <MyInput
                    label={t('topicForm.name')}
                    required
                    inputType="text"
                    inputPlaceholder={t('topicForm.namePlaceholder')}
                    input={name}
                    onChangeFunction={(e) => setName(e.target.value)}
                    className="w-full"
                />
            </div>
        </MyDialog>
    );
};

/** Choose a new parent for a topic. Its own subtree and too-deep spots are not offered. */
export const MoveTopicDialog = ({
    open,
    onOpenChange,
    node,
    nodes,
    roots,
    maxDepth,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    node: LibraryNode | null;
    nodes: LibraryNode[];
    roots: LibraryTreeNode[];
    maxDepth: number;
    onSubmit: (parentId: string | null) => Promise<void>;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const [target, setTarget] = useState<string | null | undefined>(undefined);

    const options = useMemo(() => {
        if (!node) return [];
        const own = subtreeIds(node.id, nodes);
        const height = subtreeHeight(node.id, nodes);
        return flattenTree(roots).filter(
            (candidate) =>
                !own.has(candidate.id) &&
                candidate.id !== node.parent_id &&
                candidate.depth + height <= maxDepth
        );
    }, [node, nodes, roots, maxDepth]);

    const canGoTop = !!node?.parent_id;

    return (
        <MyDialog
            heading={t('moveTopic.title', { name: node?.name ?? '' })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={target === undefined}
                        onAsyncClick={async () => onSubmit(target ?? null)}
                    >
                        {t('moveTopic.move')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-1">
                {canGoTop && (
                    <TargetRow
                        label={t('moveTopic.topLevel')}
                        depth={1}
                        active={target === null}
                        onClick={() => setTarget(null)}
                    />
                )}
                {options.map((option) => (
                    <TargetRow
                        key={option.id}
                        label={option.name}
                        depth={option.depth}
                        active={target === option.id}
                        onClick={() => setTarget(option.id)}
                    />
                ))}
                {!canGoTop && options.length === 0 && (
                    <p className="py-6 text-center text-body text-neutral-500">
                        {t('moveTopic.nowhere')}
                    </p>
                )}
            </div>
        </MyDialog>
    );
};

const TargetRow = ({
    label,
    depth,
    active,
    onClick,
}: {
    label: string;
    depth: number;
    active: boolean;
    onClick: () => void;
}) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            'flex items-center gap-2 rounded-md py-2 pr-3 text-left text-body',
            indentFor(depth),
            active
                ? 'bg-primary-50 font-semibold text-primary-500'
                : 'text-neutral-600 hover:bg-neutral-50'
        )}
    >
        <FolderSimple size={16} className="shrink-0" />
        <span className="truncate">{label}</span>
    </button>
);

/** Confirm deleting a topic. Questions are never deleted, only taken off it. */
export const DeleteTopicDialog = ({
    open,
    onOpenChange,
    node,
    subtopicCount,
    onConfirm,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    node: LibraryNode | null;
    subtopicCount: number;
    onConfirm: () => Promise<void>;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const [busy, setBusy] = useState(false);
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t('deleteTopic.title', { name: node?.name ?? '' })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {subtopicCount > 0
                            ? t('deleteTopic.withChildren', { count: subtopicCount })
                            : t('deleteTopic.body')}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={busy}
                        className="bg-danger-500 hover:bg-danger-600"
                        onClick={async (event) => {
                            event.preventDefault();
                            setBusy(true);
                            try {
                                await onConfirm();
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        {t('deleteTopic.confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

/** Pick one or more topics for selected questions (add to / move to). */
export const TopicPickerDialog = ({
    open,
    onOpenChange,
    title,
    confirmLabel,
    roots,
    multiple,
    excludeIds,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    confirmLabel: string;
    roots: LibraryTreeNode[];
    multiple: boolean;
    excludeIds?: string[];
    onSubmit: (nodeIds: string[]) => Promise<void>;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');

    const flat = useMemo(() => {
        const excluded = new Set(excludeIds ?? []);
        const term = search.trim().toLowerCase();
        return flattenTree(roots).filter(
            (node) => !excluded.has(node.id) && (!term || node.name.toLowerCase().includes(term))
        );
    }, [roots, excludeIds, search]);

    const toggle = (id: string) =>
        setPicked((prev) => {
            const next = multiple ? new Set(prev) : new Set<string>();
            if (prev.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <MyDialog
            heading={title}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={picked.size === 0}
                        onAsyncClick={async () => onSubmit(Array.from(picked))}
                    >
                        {confirmLabel}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <MagnifyingGlass size={16} className="text-neutral-400" />
                    <MyInput
                        inputType="text"
                        inputPlaceholder={t('picker.search')}
                        input={search}
                        onChangeFunction={(e) => setSearch(e.target.value)}
                        className="w-full"
                    />
                </div>
                {flat.length === 0 ? (
                    <p className="py-6 text-center text-body text-neutral-500">
                        {roots.length === 0 ? t('picker.noTopics') : t('picker.noMatch')}
                    </p>
                ) : (
                    <div className="flex flex-col gap-1">
                        {flat.map((node) => (
                            <label
                                key={node.id}
                                className={cn(
                                    'flex cursor-pointer items-center gap-2 rounded-md py-2 pr-3 text-body',
                                    search.trim() ? 'pl-2' : indentFor(node.depth),
                                    picked.has(node.id)
                                        ? 'bg-primary-50 text-primary-500'
                                        : 'text-neutral-600 hover:bg-neutral-50'
                                )}
                            >
                                <Checkbox
                                    checked={picked.has(node.id)}
                                    onCheckedChange={() => toggle(node.id)}
                                />
                                <span className="flex-1 truncate">{node.name}</span>
                                <span className="text-caption text-neutral-500">
                                    {node.question_count}
                                </span>
                            </label>
                        ))}
                    </div>
                )}
            </div>
        </MyDialog>
    );
};
