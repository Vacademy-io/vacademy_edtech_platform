// Bulk Content Uploading — preview tree with match badges and remap dropdowns.
//
// Match-only: folders map to EXISTING subjects/modules/chapters or get skipped.
// Folders with no existing match are created on commit when "create missing" is
// on; with it off they must be remapped or skipped before Confirm unlocks.

import { useMemo } from 'react';
import {
    FileDoc,
    FilePdf,
    Folder,
    Image as ImageIcon,
    LinkSimple,
    Package,
    PresentationChart,
    Video,
    Warning,
    YoutubeLogo,
} from '@phosphor-icons/react';
import { MyDropdown } from '@/components/design-system/dropdown';
import { cn } from '@/lib/utils';
import type { DropdownItem } from '@/components/design-system/utils/types/dropdown-types';
import { isSyntheticRootNode, normalizeName } from './conventions';
import {
    COLLISION_WARNING,
    existingTitlesForChapterNode,
    findExistingChapter,
    scopeEntitiesForNode,
} from './matching';
import type { NodeMapping } from './types';
import {
    getTerminologyPlural,
    getTerminology,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    groupItemsByChapter,
    useBulkContentUploadingStore,
} from './use-bulk-content-uploading-store';
import type { BulkItem, BulkItemKind, BulkNode } from './types';

const SKIP_VALUE = '__skip__';

const kindIcon = (kind: BulkItemKind) => {
    const cls = 'size-4 shrink-0 text-neutral-500';
    switch (kind) {
        case 'PDF':
            return <FilePdf className={cls} />;
        case 'DOC':
            return <FileDoc className={cls} />;
        case 'PPT':
            return <PresentationChart className={cls} />;
        case 'IMAGE':
            return <ImageIcon className={cls} />;
        case 'VIDEO_FILE':
            return <Video className={cls} />;
        case 'SCORM':
            return <Package className={cls} />;
        case 'YOUTUBE':
            return <YoutubeLogo className={cls} />;
        case 'EXTERNAL_LINK':
            return <LinkSimple className={cls} />;
    }
};

const MappingBadge = ({ node, createMissing }: { node: BulkNode; createMissing: boolean }) => {
    // The synthetic depth-2 root is not a real folder and has no remap dropdown;
    // Phase 0 always resolves it, so any badge here would just confuse.
    if (isSyntheticRootNode(node)) return null;
    if (node.mapping.action === 'match') {
        return (
            <span className="rounded-sm bg-success-50 px-2 py-0.5 text-caption text-success-700">
                Matched{node.mapping.targetName ? `: ${node.mapping.targetName}` : ''}
            </span>
        );
    }
    if (node.mapping.action === 'skip') {
        return (
            <span className="rounded-sm bg-neutral-100 px-2 py-0.5 text-caption text-neutral-500">
                Skipped
            </span>
        );
    }
    // action 'create' = no existing match. Auto-create makes that actionable;
    // with it off the user must remap or skip the folder.
    if (createMissing) {
        return (
            <span className="rounded-sm bg-primary-50 px-2 py-0.5 text-caption text-primary-600">
                Will create
            </span>
        );
    }
    return (
        <span className="rounded-sm bg-warning-50 px-2 py-0.5 text-caption text-warning-700">
            No match — select or skip
        </span>
    );
};

const NodeRow = ({ node, depth }: { node: BulkNode; depth: number }) => {
    const allNodes = useBulkContentUploadingStore((state) => state.nodes);
    const singleSnapshot = useBulkContentUploadingStore((state) => state.existingSnapshot);
    const context = useBulkContentUploadingStore((state) => state.context);
    const courseSections = useBulkContentUploadingStore((state) => state.courseSections);
    const sectionSnapshots = useBulkContentUploadingStore((state) => state.sectionSnapshots);
    const createMissing = useBulkContentUploadingStore((state) => state.options.createMissing);
    const { remapNode } = useBulkContentUploadingStore();

    // Multi-course: snapshot/depth come from this node's section, not the
    // single-mode wizard context.
    const snapshot = node.sectionId ? sectionSnapshots[node.sectionId] ?? null : singleSnapshot;
    const courseDepth = node.sectionId
        ? courseSections[node.sectionId]?.courseDepth ?? 5
        : context?.courseDepth ?? 5;
    const nodes = useMemo(
        () =>
            node.sectionId
                ? Object.fromEntries(
                      Object.entries(allNodes).filter(([, n]) => n.sectionId === node.sectionId)
                  )
                : allNodes,
        [allNodes, node.sectionId]
    );

    const scope = useMemo(
        () => (snapshot ? scopeEntitiesForNode(node, nodes, snapshot, courseDepth) : []),
        [node, nodes, snapshot, courseDepth]
    );

    // For matched chapters: tell the user where the new slides will land.
    const existingSlideCount = useMemo(() => {
        if (node.kind !== 'chapter' || !snapshot) return 0;
        if (courseDepth === 2 && isSyntheticRootNode(node)) return snapshot.directSlides.length;
        if (node.mapping.action === 'match' && node.mapping.targetId) {
            return findExistingChapter(snapshot, node.mapping.targetId)?.slides.length ?? 0;
        }
        return 0;
    }, [node, snapshot, courseDepth]);

    const claimedByOthers = useMemo(() => {
        const claimed = new Set<string>();
        Object.values(nodes).forEach((other) => {
            if (
                other.id !== node.id &&
                other.kind === node.kind &&
                other.parentId === node.parentId &&
                other.mapping.action === 'match' &&
                other.mapping.targetId
            ) {
                claimed.add(other.mapping.targetId);
            }
        });
        return claimed;
    }, [nodes, node]);

    const dropdownList: DropdownItem[] = [
        ...scope
            .filter((entity) => !claimedByOthers.has(entity.id))
            .map((entity) => ({ label: `Map to: ${entity.name}`, value: entity.id })),
        { label: 'Skip this folder', value: SKIP_VALUE },
    ];

    const currentLabel =
        node.mapping.action === 'match'
            ? `Map to: ${node.mapping.targetName ?? ''}`
            : node.mapping.action === 'skip'
              ? 'Skip this folder'
              : 'Select…';

    // Keep duplicate-title warnings in sync with the CURRENT mapping — a chapter
    // remapped to "Create new" has no existing slides, so stale warnings must go
    // (otherwise "skip duplicates" would silently skip everything in it).
    const refreshCollisionWarnings = (newMapping: NodeMapping) => {
        if (node.kind !== 'chapter' || !snapshot) return;
        const titles = existingTitlesForChapterNode(
            { ...node, mapping: newMapping },
            snapshot,
            courseDepth
        );
        const storeNow = useBulkContentUploadingStore.getState();
        Object.values(storeNow.items)
            .filter((item) => item.chapterNodeId === node.id)
            .forEach((item) => {
                const collides = titles?.has(normalizeName(item.title)) ?? false;
                const hadWarning = item.warnings.includes(COLLISION_WARNING);
                if (collides === hadWarning) return;
                const without = item.warnings.filter((w) => w !== COLLISION_WARNING);
                storeNow.patchItem(item.id, {
                    warnings: collides ? [...without, COLLISION_WARNING] : without,
                });
            });
    };

    const handleRemap = (value: string) => {
        let newMapping: NodeMapping | null = null;
        if (value === SKIP_VALUE) {
            newMapping = { action: 'skip' };
        } else {
            const target = scope.find((entity) => entity.id === value);
            if (target) {
                newMapping = { action: 'match', targetId: target.id, targetName: target.name };
            }
        }
        if (!newMapping) return;
        remapNode(node.id, newMapping);
        refreshCollisionWarnings(newMapping);
    };

    const isSyntheticRoot = isSyntheticRootNode(node);

    return (
        <div
            className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-50"
            // dynamic tree-depth indent — depth is data-driven, not a design token
            style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
            <Folder className="size-4 shrink-0 text-primary-400" weight="fill" />
            <span
                className={cn(
                    'text-subtitle font-medium text-neutral-700',
                    node.mapping.action === 'skip' && 'text-neutral-400 line-through'
                )}
            >
                {isSyntheticRoot
                    ? `${getTerminology(ContentTerms.Course, SystemTerms.Course)} content (flat zip)`
                    : node.displayName}
            </span>
            <MappingBadge node={node} createMissing={createMissing} />
            {existingSlideCount > 0 && (
                <span className="rounded-sm bg-neutral-100 px-2 py-0.5 text-caption text-neutral-500">
                    new {getTerminologyPlural(ContentTerms.Slide, SystemTerms.Slide).toLowerCase()}{' '}
                    go after the {existingSlideCount} existing
                </span>
            )}
            {!isSyntheticRoot && (
                <span className="ml-auto">
                    <MyDropdown
                        currentValue={currentLabel}
                        dropdownList={dropdownList}
                        onSelect={handleRemap}
                        className="h-7 !py-1 text-caption"
                        contentClassName="max-h-72 overflow-y-auto"
                    />
                </span>
            )}
        </div>
    );
};

const ItemRow = ({
    item,
    depth,
    position,
}: {
    item: BulkItem;
    depth: number;
    position: number;
}) => (
    <div
        className="flex flex-wrap items-center gap-2 px-2 py-1"
        // dynamic tree-depth indent — depth is data-driven, not a design token
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
    >
        <span className="w-6 shrink-0 text-right font-mono text-caption text-neutral-400">
            {position}.
        </span>
        {kindIcon(item.kind)}
        <span className="truncate text-subtitle text-neutral-600">{item.title}</span>
        <span className="text-caption text-neutral-400">
            {item.kind === 'YOUTUBE' || item.kind === 'EXTERNAL_LINK' ? item.url : item.fileName}
        </span>
        {item.warnings.map((warning) => (
            <span
                key={warning}
                className="flex items-center gap-1 rounded-sm bg-warning-50 px-2 py-0.5 text-caption text-warning-700"
            >
                <Warning className="size-3" />
                {warning}
            </span>
        ))}
    </div>
);

export const PreviewTree = ({ sectionId }: { sectionId?: string }) => {
    const allNodes = useBulkContentUploadingStore((state) => state.nodes);
    const items = useBulkContentUploadingStore((state) => state.items);

    const nodes = useMemo(
        () =>
            sectionId
                ? Object.fromEntries(
                      Object.entries(allNodes).filter(([, n]) => n.sectionId === sectionId)
                  )
                : allNodes,
        [allNodes, sectionId]
    );
    const itemsByChapter = useMemo(() => groupItemsByChapter(items), [items]);

    const sortChildren = (list: BulkNode[]) =>
        [...list].sort((a, b) => {
            if (a.orderHint !== null || b.orderHint !== null) {
                if (a.orderHint === null) return 1;
                if (b.orderHint === null) return -1;
                if (a.orderHint !== b.orderHint) return a.orderHint - b.orderHint;
            }
            return a.displayName.localeCompare(b.displayName);
        });

    const renderNode = (node: BulkNode, depth: number): JSX.Element => {
        const children = sortChildren(Object.values(nodes).filter((n) => n.parentId === node.id));
        const skipped = node.mapping.action === 'skip';
        return (
            <div key={node.id}>
                <NodeRow node={node} depth={depth} />
                {!skipped && children.map((child) => renderNode(child, depth + 1))}
                {!skipped &&
                    node.kind === 'chapter' &&
                    (itemsByChapter.get(node.id) ?? []).map((item, index) => (
                        <ItemRow key={item.id} item={item} depth={depth + 1} position={index + 1} />
                    ))}
            </div>
        );
    };

    const roots = sortChildren(Object.values(nodes).filter((n) => n.parentId === null));

    return (
        <div className="max-h-96 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-2">
            {roots.map((root) => renderNode(root, 0))}
        </div>
    );
};
