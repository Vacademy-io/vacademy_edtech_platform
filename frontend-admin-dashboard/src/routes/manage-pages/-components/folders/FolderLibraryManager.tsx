import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    CaretDown,
    CaretRight,
    DotsSixVertical,
    DotsThreeVertical,
    Eye,
    EyeSlash,
    Folder,
    FolderOpen,
    FolderSimplePlus,
    ArrowsOutCardinal,
    PencilSimple,
    ShoppingCartSimple,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { StatusChip } from '@/components/design-system/status-chips';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import { useCataloguePermissions } from '../../-hooks/use-catalogue-permissions';
import {
    createFolderNode,
    deleteFolderNode,
    findNode,
    flattenFolders,
    folderLibrariesQueryKey,
    folderTreeQueryKey,
    getFolderTree,
    moveFolderNode,
    nodeLabel,
    pathTo,
    subtreeIds,
    updateFolderLibrary,
    updateFolderNode,
    type FolderNode,
    type FolderNodeInput,
    type FolderNodeType,
    type FolderTree,
} from '../../-services/folder-library-service';
import { FolderNodeEditorDialog } from './FolderNodeEditorDialog';
import { isValidAccentColor, takenFolderSlugs } from './folder-node-advanced';

/**
 * Website Builder → Folders → one library: browse it the way a student will
 * (open a folder, go back up with the breadcrumb), and edit in place — add
 * folders and product pages, drag to reorder, move between folders, hide or
 * delete. Every change saves immediately and is live on the site within a
 * minute; "Visible to students" is how to stage something first.
 */

const apiError = (e: unknown, fallback: string) => {
    const data = (e as { response?: { data?: { ex?: string; message?: string } } })?.response?.data;
    return data?.ex || data?.message || fallback;
};

const childCounts = (n: FolderNode) => {
    let folders = 0;
    let pages = 0;
    for (const c of n.children || []) {
        if (c.node_type === 'FOLDER') folders++;
        else pages++;
    }
    return { folders, pages };
};

const countLabel = (n: FolderNode) => {
    const { folders, pages } = childCounts(n);
    const parts: string[] = [];
    if (folders) parts.push(`${folders} folder${folders === 1 ? '' : 's'}`);
    if (pages) parts.push(`${pages} product page${pages === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' · ') : 'Empty';
};

const productPageWarning = (n: FolderNode): string | null => {
    if (n.node_type !== 'PRODUCT_PAGE') return null;
    if (n.product_page_status === 'MISSING' || n.product_page_status === 'DELETED') {
        return 'Product page deleted — hidden from students';
    }
    if (n.product_page_status && n.product_page_status !== 'ACTIVE') {
        return 'Product page not active — hidden from students';
    }
    return null;
};

/* ── outline (left rail) ─────────────────────────────────────────────── */

const OutlineBranch = ({
    nodes,
    depth,
    currentId,
    expanded,
    onToggle,
    onOpen,
}: {
    nodes: FolderNode[];
    depth: number;
    currentId: string | null;
    expanded: Set<string>;
    onToggle: (id: string) => void;
    onOpen: (id: string) => void;
}) => (
    <ul>
        {nodes
            .filter((n) => n.node_type === 'FOLDER')
            .map((n) => {
                const hasFolders = (n.children || []).some((c) => c.node_type === 'FOLDER');
                const isOpen = expanded.has(n.id);
                return (
                    <li key={n.id}>
                        <div
                            className={cn(
                                'group flex items-center gap-1 rounded-md py-1 pe-2 text-sm',
                                currentId === n.id ? 'bg-primary-50 text-primary-500' : 'text-neutral-700 hover:bg-neutral-100'
                            )}
                            style={{ paddingInlineStart: `${depth * 14 + 4}px` }} // design-lint-ignore: nesting depth is data-driven
                        >
                            <button
                                type="button"
                                aria-label={isOpen ? 'Collapse' : 'Expand'}
                                className={cn('rounded p-0.5 text-neutral-400 hover:text-neutral-700', !hasFolders && 'invisible')}
                                onClick={() => onToggle(n.id)}
                            >
                                {isOpen ? <CaretDown className="size-3" /> : <CaretRight className="size-3" />}
                            </button>
                            <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
                                onClick={() => onOpen(n.id)}
                            >
                                {currentId === n.id ? (
                                    <FolderOpen className="size-4 shrink-0" weight="fill" />
                                ) : (
                                    <Folder className="size-4 shrink-0" />
                                )}
                                <span className={cn('truncate', n.status === 'HIDDEN' && 'text-neutral-400 line-through')}>
                                    {nodeLabel(n)}
                                </span>
                            </button>
                        </div>
                        {isOpen && hasFolders && (
                            <OutlineBranch
                                nodes={n.children}
                                depth={depth + 1}
                                currentId={currentId}
                                expanded={expanded}
                                onToggle={onToggle}
                                onOpen={onOpen}
                            />
                        )}
                    </li>
                );
            })}
    </ul>
);

/* ── one item card ───────────────────────────────────────────────────── */

const ItemCard = ({
    node,
    canWrite,
    onOpen,
    onEdit,
    onMove,
    onToggleHidden,
    onDelete,
}: {
    node: FolderNode;
    canWrite: boolean;
    onOpen: () => void;
    onEdit: () => void;
    onMove: () => void;
    onToggleHidden: () => void;
    onDelete: () => void;
}) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: node.id,
        disabled: !canWrite,
    });
    const style = { transform: CSS.Transform.toString(transform), transition };
    const isFolder = node.node_type === 'FOLDER';
    const warning = productPageWarning(node);
    const hidden = node.status === 'HIDDEN';
    // The colour the live site paints behind this item's image or icon.
    const accent = isValidAccentColor(node.accent_color) ? node.accent_color!.trim() : null;
    const comingSoon = isFolder && !!node.coming_soon;
    const subtitle = (node.subtitle || '').trim();

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'group relative flex flex-col overflow-hidden rounded-xl border bg-white transition-shadow',
                isDragging ? 'z-10 border-primary-300 shadow-lg' : 'border-neutral-200 hover:border-neutral-300 hover:shadow-sm',
                hidden && 'opacity-60'
            )}
        >
            <button
                type="button"
                // Read-only viewers can still browse folders, but not open the editor.
                onClick={isFolder ? onOpen : canWrite ? onEdit : undefined}
                className={cn('block text-start', !isFolder && !canWrite && 'cursor-default')}
            >
                <div
                    className="relative flex aspect-video items-center justify-center bg-neutral-100"
                    style={accent ? { backgroundColor: accent } : undefined} // design-lint-ignore: admin-chosen accent colour
                >
                    {node.image_url ? (
                        <img src={node.image_url} alt="" className="size-full object-cover" loading="lazy" />
                    ) : isFolder ? (
                        <Folder className="size-10 text-primary-300" weight="duotone" />
                    ) : (
                        <ShoppingCartSimple className="size-10 text-primary-300" weight="duotone" />
                    )}
                    <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-caption font-medium text-neutral-700">
                        {isFolder ? <Folder className="size-3" /> : <ShoppingCartSimple className="size-3" />}
                        {isFolder ? 'Folder' : 'Product page'}
                    </span>
                </div>
                <div className="space-y-1 p-3">
                    <p className="line-clamp-2 text-sm font-semibold text-neutral-800">{nodeLabel(node)}</p>
                    {subtitle && (
                        <p className="truncate text-caption uppercase tracking-wide text-neutral-500">{subtitle}</p>
                    )}
                    <p className="truncate text-caption text-neutral-500">
                        {isFolder ? countLabel(node) : node.product_page_name || 'Product page'}
                    </p>
                    <div className="flex flex-wrap gap-1">
                        {hidden && <StatusChip text="Hidden" textSize="text-xs" status="INFO" showIcon={false} />}
                        {comingSoon && (
                            <StatusChip text="Coming soon" textSize="text-xs" status="WARNING" showIcon={false} />
                        )}
                        {isFolder && node.view && Object.keys(node.view).length > 0 && (
                            <StatusChip text="Custom look" textSize="text-xs" status="INFO" showIcon={false} />
                        )}
                    </div>
                    {warning && (
                        <p className="flex items-center gap-1 text-caption text-warning-600">
                            <WarningCircle className="size-3.5 shrink-0" /> {warning}
                        </p>
                    )}
                </div>
            </button>

            {canWrite && (
                <div className="absolute end-2 top-2 flex gap-1">
                    <button
                        type="button"
                        aria-label="Drag to reorder"
                        className="cursor-grab rounded-md bg-white/90 p-1 text-neutral-500 hover:text-neutral-800 active:cursor-grabbing"
                        {...attributes}
                        {...listeners}
                    >
                        <DotsSixVertical className="size-4" weight="bold" />
                    </button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="Item actions"
                                className="rounded-md bg-white/90 p-1 text-neutral-500 hover:text-neutral-800"
                            >
                                <DotsThreeVertical className="size-4" weight="bold" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {isFolder && (
                                <DropdownMenuItem onClick={onOpen}>
                                    <FolderOpen className="me-2 size-4" /> Open
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={onEdit}>
                                <PencilSimple className="me-2 size-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onMove}>
                                <ArrowsOutCardinal className="me-2 size-4" /> Move to…
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onToggleHidden}>
                                {hidden ? <Eye className="me-2 size-4" /> : <EyeSlash className="me-2 size-4" />}
                                {hidden ? 'Show to students' : 'Hide from students'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-danger-600 focus:text-danger-600" onClick={onDelete}>
                                <Trash className="me-2 size-4" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}
        </div>
    );
};

/* ── manager ─────────────────────────────────────────────────────────── */

interface FolderLibraryManagerProps {
    libraryId: string;
    initialFolderId?: string | null;
    onBack: () => void;
}

export const FolderLibraryManager = ({ libraryId, initialFolderId = null, onBack }: FolderLibraryManagerProps) => {
    const instituteId = getCurrentInstituteId();
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const { canWrite } = useCataloguePermissions();
    const treeKey = folderTreeQueryKey(instituteId, libraryId);

    const { data: tree, isLoading, isError, refetch } = useQuery({
        queryKey: treeKey,
        queryFn: () => getFolderTree(instituteId!, libraryId),
        enabled: !!instituteId,
    });

    const [currentId, setCurrentId] = useState<string | null>(initialFolderId);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [editor, setEditor] = useState<{ nodeType: FolderNodeType; node: FolderNode | null } | null>(null);
    const [moving, setMoving] = useState<FolderNode | null>(null);
    const [deleting, setDeleting] = useState<FolderNode | null>(null);
    const [renaming, setRenaming] = useState(false);

    const roots = tree?.roots || [];
    const trail = useMemo(() => pathTo(roots, currentId), [roots, currentId]);
    const current = trail.length ? trail[trail.length - 1]! : null;
    const items = current ? current.children || [] : roots;
    // Link keys every other folder answers to, so the editor can flag a duplicate.
    const editingId = editor?.node?.id ?? null;
    const takenSlugs = useMemo(() => takenFolderSlugs(roots, editingId, nodeLabel), [roots, editingId]);

    // The folder being viewed was deleted (here or by another admin): go to the top.
    useEffect(() => {
        if (tree && currentId && !current) setCurrentId(null);
    }, [tree, currentId, current]);

    // Keep the outline open down to wherever the admin is.
    useEffect(() => {
        if (!trail.length) return;
        setExpanded((prev) => {
            const next = new Set(prev);
            trail.forEach((n) => next.add(n.id));
            return next;
        });
    }, [trail]);

    const applyTree = (next: FolderTree) => {
        queryClient.setQueryData(treeKey, next);
        queryClient.invalidateQueries({ queryKey: folderLibrariesQueryKey(instituteId) });
    };

    const fail = (e: unknown, title: string) => {
        toast({ title, description: apiError(e, 'Please try again.'), variant: 'destructive' });
        queryClient.invalidateQueries({ queryKey: treeKey });
    };

    const update = useMutation({
        mutationFn: ({ id, input }: { id: string; input: FolderNodeInput }) => updateFolderNode(instituteId!, id, input),
        onSuccess: applyTree,
        onError: (e) => fail(e, 'Could not update the item'),
    });

    const move = useMutation({
        mutationFn: ({ id, parentId, index }: { id: string; parentId: string | null; index?: number }) =>
            moveFolderNode(instituteId!, id, { parent_id: parentId, index }),
        onSuccess: applyTree,
        onError: (e) => fail(e, 'Could not move the item'),
    });

    const remove = useMutation({
        mutationFn: (id: string) => deleteFolderNode(instituteId!, id),
        onSuccess: (res) => {
            applyTree(res.tree);
            toast({ title: res.deleted > 1 ? `Deleted ${res.deleted} items` : 'Deleted' });
        },
        onError: (e) => fail(e, 'Could not delete the item'),
    });

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const onDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id || !tree) return;
        const from = items.findIndex((n) => n.id === active.id);
        const to = items.findIndex((n) => n.id === over.id);
        if (from < 0 || to < 0) return;
        // Optimistic: reorder in the cache now, then take the server's tree.
        const reordered = arrayMove(items, from, to);
        const patch = (nodes: FolderNode[]): FolderNode[] =>
            current
                ? nodes.map((n) =>
                      n.id === current.id ? { ...n, children: reordered } : { ...n, children: patch(n.children || []) }
                  )
                : reordered;
        queryClient.setQueryData<FolderTree>(treeKey, { ...tree, roots: current ? patch(tree.roots) : reordered });
        move.mutate({ id: String(active.id), parentId: current?.id ?? null, index: to });
    };

    const openFolder = (id: string | null) => setCurrentId(id);
    const toggleOutline = (id: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const submitEditor = async (input: FolderNodeInput) => {
        if (!editor) return;
        const next = editor.node
            ? await updateFolderNode(instituteId!, editor.node.id, input)
            : await createFolderNode(instituteId!, libraryId, {
                  ...input,
                  node_type: editor.nodeType,
                  parent_id: current?.id ?? null,
              });
        applyTree(next);
    };

    if (!instituteId) return <div className="p-6 text-neutral-500">No institute selected</div>;

    const libraryName = tree?.library.name || 'Folders';
    const here = current ? nodeLabel(current) : libraryName;

    return (
        <div className="flex h-full min-h-0 flex-col">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-5 py-3 pe-12">
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={onBack}
                        className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                        aria-label="All folder libraries"
                    >
                        <ArrowLeft className="size-4" />
                    </button>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <h2 className="truncate text-base font-semibold text-neutral-800">{libraryName}</h2>
                            {canWrite && tree && (
                                <button
                                    type="button"
                                    aria-label="Rename library"
                                    className="rounded p-1 text-neutral-400 hover:text-neutral-700"
                                    onClick={() => setRenaming(true)}
                                >
                                    <PencilSimple className="size-3.5" />
                                </button>
                            )}
                        </div>
                        <p className="text-caption text-neutral-500">
                            Changes save as you go and reach your site within a minute.
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex min-h-0 flex-1">
                {/* Outline */}
                <aside className="hidden w-64 shrink-0 overflow-y-auto border-e border-neutral-200 bg-white p-2 md:block">
                    <button
                        type="button"
                        onClick={() => openFolder(null)}
                        className={cn(
                            'mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium',
                            currentId === null ? 'bg-primary-50 text-primary-500' : 'text-neutral-700 hover:bg-neutral-100'
                        )}
                    >
                        <FolderOpen className="size-4" /> {libraryName}
                    </button>
                    {isLoading ? (
                        <div className="space-y-2 p-2">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-4 w-1/2" />
                            <Skeleton className="h-4 w-2/3" />
                        </div>
                    ) : (
                        <OutlineBranch
                            nodes={roots}
                            depth={0}
                            currentId={currentId}
                            expanded={expanded}
                            onToggle={toggleOutline}
                            onOpen={openFolder}
                        />
                    )}
                </aside>

                {/* Contents */}
                <section className="min-w-0 flex-1 overflow-y-auto bg-neutral-50 p-5">
                    <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-sm">
                        <button
                            type="button"
                            onClick={() => openFolder(null)}
                            className={cn('rounded px-1', current ? 'text-primary-500 hover:underline' : 'font-semibold text-neutral-800')}
                        >
                            {libraryName}
                        </button>
                        {trail.map((n, i) => (
                            <span key={n.id} className="flex items-center gap-1">
                                <CaretRight className="size-3 text-neutral-400" />
                                <button
                                    type="button"
                                    onClick={() => openFolder(n.id)}
                                    className={cn(
                                        'rounded px-1',
                                        i === trail.length - 1 ? 'font-semibold text-neutral-800' : 'text-primary-500 hover:underline'
                                    )}
                                >
                                    {nodeLabel(n)}
                                </button>
                            </span>
                        ))}
                    </nav>

                    {canWrite && (
                        <div className="mb-4 flex flex-wrap items-center gap-2">
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={() => setEditor({ nodeType: 'FOLDER', node: null })}
                                disable={!tree}
                            >
                                <FolderSimplePlus className="size-4" /> New folder
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => setEditor({ nodeType: 'PRODUCT_PAGE', node: null })}
                                disable={!tree}
                            >
                                <ShoppingCartSimple className="size-4" /> Add product page
                            </MyButton>
                            {current && (
                                <MyButton
                                    buttonType="text"
                                    scale="medium"
                                    onClick={() => setEditor({ nodeType: 'FOLDER', node: current })}
                                >
                                    <PencilSimple className="size-4" /> Edit this folder
                                </MyButton>
                            )}
                        </div>
                    )}

                    {isError ? (
                        <div className="rounded-xl border border-danger-200 bg-white px-6 py-10 text-center">
                            <p className="text-sm font-medium text-neutral-700">Could not load this library.</p>
                            <MyButton className="mt-3" buttonType="secondary" scale="medium" onClick={() => refetch()}>
                                Try again
                            </MyButton>
                        </div>
                    ) : isLoading ? (
                        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton key={i} className="aspect-video w-full rounded-xl" />
                            ))}
                        </div>
                    ) : items.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center">
                            <Folder className="mx-auto size-10 text-neutral-300" weight="duotone" />
                            <p className="mt-2 text-sm font-medium text-neutral-700">
                                {current ? `${here} is empty` : 'This library is empty'}
                            </p>
                            <p className="mx-auto mt-1 max-w-md text-xs text-neutral-500">
                                Add folders to group things (Class 10, Science…), and add a product page where students
                                should see courses they can buy.
                            </p>
                        </div>
                    ) : (
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                            <SortableContext items={items.map((n) => n.id)} strategy={rectSortingStrategy}>
                                <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
                                    {items.map((n) => (
                                        <ItemCard
                                            key={n.id}
                                            node={n}
                                            canWrite={canWrite}
                                            onOpen={() => openFolder(n.id)}
                                            onEdit={() => setEditor({ nodeType: n.node_type, node: n })}
                                            onMove={() => setMoving(n)}
                                            onToggleHidden={() =>
                                                update.mutate({
                                                    id: n.id,
                                                    input: { status: n.status === 'HIDDEN' ? 'ACTIVE' : 'HIDDEN' },
                                                })
                                            }
                                            onDelete={() => setDeleting(n)}
                                        />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    )}
                    {items.length > 1 && canWrite && (
                        <p className="mt-3 text-caption text-neutral-500">
                            Drag the ⋮⋮ handle to change the order students see.
                        </p>
                    )}
                </section>
            </div>

            <FolderNodeEditorDialog
                open={!!editor}
                onOpenChange={(o) => !o && setEditor(null)}
                nodeType={editor?.nodeType || 'FOLDER'}
                node={editor?.node || null}
                parentLabel={here}
                onSubmit={submitEditor}
                takenSlugs={takenSlugs}
            />

            {moving && (
                <MoveDialog
                    node={moving}
                    roots={roots}
                    libraryName={libraryName}
                    onClose={() => setMoving(null)}
                    onMove={(parentId) => {
                        move.mutate({ id: moving.id, parentId });
                        setMoving(null);
                    }}
                />
            )}

            {tree && renaming && (
                <RenameLibraryDialog
                    tree={tree}
                    onClose={() => setRenaming(false)}
                    onSaved={(lib) => applyTree({ ...tree, library: { ...tree.library, ...lib } })}
                />
            )}

            <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete “{deleting ? nodeLabel(deleting) : ''}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleting && deleting.node_type === 'FOLDER' && subtreeIds(deleting).size > 1
                                ? `This also deletes the ${subtreeIds(deleting).size - 1} item(s) inside it. `
                                : ''}
                            It disappears from every page that shows this library. Product pages themselves are not
                            deleted. This cannot be undone — to take it down temporarily, hide it instead.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 hover:bg-danger-700"
                            onClick={() => {
                                if (deleting) remove.mutate(deleting.id);
                                setDeleting(null);
                            }}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

/* ── move picker ─────────────────────────────────────────────────────── */

const MoveDialog = ({
    node,
    roots,
    libraryName,
    onClose,
    onMove,
}: {
    node: FolderNode;
    roots: FolderNode[];
    libraryName: string;
    onClose: () => void;
    onMove: (parentId: string | null) => void;
}) => {
    // A folder cannot go inside itself or anything under it, and "here" is a no-op.
    const blocked = subtreeIds(node);
    const currentParent = node.parent_id ?? null;
    const targets = flattenFolders(roots).filter(({ node: f }) => !blocked.has(f.id));

    const Row = ({ id, label, depth }: { id: string | null; label: string; depth: number }) => {
        const isHere = id === currentParent;
        return (
            <button
                type="button"
                disabled={isHere}
                onClick={() => onMove(id)}
                className="flex w-full items-center gap-2 rounded-md py-1.5 pe-2 text-start text-sm text-neutral-700 hover:bg-primary-50 disabled:cursor-default disabled:text-neutral-400 disabled:hover:bg-transparent"
                style={{ paddingInlineStart: `${depth * 16 + 8}px` }} // design-lint-ignore: nesting depth is data-driven
            >
                <Folder className="size-4 shrink-0" />
                <span className="truncate">{label}</span>
                {isHere && <span className="ms-auto text-caption">(here now)</span>}
            </button>
        );
    };

    return (
        <MyDialog open onOpenChange={(o) => !o && onClose()} heading={`Move “${nodeLabel(node)}” to…`} dialogWidth="max-w-md">
            <div className="max-h-list-md overflow-y-auto p-1">
                <Row id={null} label={`${libraryName} (top level)`} depth={0} />
                {targets.map(({ node: f, depth }) => (
                    <Row key={f.id} id={f.id} label={nodeLabel(f)} depth={depth + 1} />
                ))}
            </div>
        </MyDialog>
    );
};

/* ── rename library ──────────────────────────────────────────────────── */

const RenameLibraryDialog = ({
    tree,
    onClose,
    onSaved,
}: {
    tree: FolderTree;
    onClose: () => void;
    onSaved: (lib: { name: string; description?: string | null }) => void;
}) => {
    const instituteId = getCurrentInstituteId();
    const [name, setName] = useState(tree.library.name);
    const [description, setDescription] = useState(tree.library.description || '');
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        if (!name.trim()) {
            setError('Give the library a name.');
            return;
        }
        try {
            const lib = await updateFolderLibrary(instituteId!, tree.library.id, {
                name: name.trim(),
                description: description.trim(),
            });
            onSaved(lib);
            onClose();
        } catch (e) {
            setError(apiError(e, 'Could not save. Please try again.'));
        }
    };

    return (
        <MyDialog
            open
            onOpenChange={(o) => !o && onClose()}
            heading="Library details"
            dialogWidth="max-w-md"
            footerLeft={error ? <p className="text-xs text-danger-600">{error}</p> : undefined}
            footer={
                <div className="flex gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                        Cancel
                    </MyButton>
                    <MyButton buttonType="primary" scale="medium" onAsyncClick={save} loadingText="Saving…">
                        Save
                    </MyButton>
                </div>
            }
        >
            <div className="space-y-3 p-1">
                <div>
                    <Label className="text-xs">Name</Label>
                    <Input className="mt-1" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                    <Label className="text-xs">Description (only you see this)</Label>
                    <Textarea
                        className="mt-1"
                        rows={2}
                        value={description}
                        maxLength={2000}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </div>
            </div>
        </MyDialog>
    );
};
