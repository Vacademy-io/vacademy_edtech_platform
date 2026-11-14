import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretRight, Folder, ShoppingCartSimple } from '@phosphor-icons/react';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import {
    findNode,
    folderTreeQueryKey,
    getFolderTree,
    nodeLabel,
    type FolderNode,
    type FolderView,
} from '../../-services/folder-library-service';
import { FOLDER_VIEW_DEFAULTS } from './FolderViewFields';

/**
 * Canvas preview of a Folder Browser section: the first level a visitor sees,
 * in the section's layout. Reads the admin tree (same query key as the folder
 * manager, so an edit there shows here at once) and applies the visitor rules
 * itself — hidden branches, inactive product pages and, if set, empty folders
 * drop out — so the canvas never shows something the live page will not.
 */

const ASPECT: Record<string, string> = {
    landscape: 'aspect-video',
    square: 'aspect-square',
    portrait: 'aspect-[3/4]',
};

const COLUMN_CLASSES: Record<number, string> = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
};

/** What a visitor would see under `nodes`. */
const visibleTo = (nodes: FolderNode[], hideEmpty: boolean): FolderNode[] =>
    nodes.flatMap((n) => {
        if (n.status === 'HIDDEN') return [];
        if (n.node_type === 'PRODUCT_PAGE') return n.product_page_status === 'ACTIVE' ? [n] : [];
        const children = visibleTo(n.children || [], hideEmpty);
        if (hideEmpty && children.length === 0) return [];
        return [{ ...n, children }];
    });

const countLine = (n: FolderNode) => {
    const folders = (n.children || []).filter((c) => c.node_type === 'FOLDER').length;
    const pages = (n.children || []).length - folders;
    const parts: string[] = [];
    if (folders) parts.push(`${folders} folder${folders === 1 ? '' : 's'}`);
    if (pages) parts.push(folders ? 'Courses inside' : 'View courses');
    return parts.join(' · ');
};

const Shell: React.FC<{ children: React.ReactNode; align?: string; title?: string; subtitle?: string }> = ({
    children,
    align,
    title,
    subtitle,
}) => (
    <div className="bg-catalogue-bg px-6 py-10">
        {(title || subtitle) && (
            <div className={cn('mb-6', align === 'center' && 'text-center')}>
                {title && <h2 className="text-2xl font-bold text-catalogue-text-primary">{title}</h2>}
                {subtitle && <p className="mt-1 text-sm text-catalogue-text-muted">{subtitle}</p>}
            </div>
        )}
        {children}
    </div>
);

export const FolderBrowserPreview: React.FC<{ props: any }> = ({ props }) => {
    const instituteId = getCurrentInstituteId();
    const libraryId: string = props.libraryId || '';
    const { data: tree, isLoading, isError } = useQuery({
        queryKey: folderTreeQueryKey(instituteId, libraryId),
        queryFn: () => getFolderTree(instituteId!, libraryId),
        enabled: !!instituteId && !!libraryId,
        staleTime: 30_000,
    });

    if (!libraryId) {
        return (
            <Shell align={props.align} title={props.title} subtitle={props.subtitle}>
                <div className="rounded-xl border border-dashed border-catalogue-border p-8 text-center text-sm text-catalogue-text-muted">
                    Pick a folder library in this section&apos;s properties (or create one with the Folders button).
                </div>
            </Shell>
        );
    }
    if (isLoading) {
        return (
            <Shell align={props.align} title={props.title} subtitle={props.subtitle}>
                <div className="grid grid-cols-3 gap-4">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="aspect-video animate-pulse rounded-xl bg-catalogue-bg-muted" />
                    ))}
                </div>
            </Shell>
        );
    }
    if (isError || !tree) {
        return (
            <Shell align={props.align} title={props.title} subtitle={props.subtitle}>
                <div className="rounded-xl border border-dashed border-catalogue-border p-8 text-center text-sm text-catalogue-text-muted">
                    This folder library could not be loaded — it may have been deleted. Pick another one.
                </div>
            </Shell>
        );
    }

    // Same rule as the live page: a start folder that is hidden, deleted or
    // empty shows nothing rather than the whole library.
    const visible = visibleTo(tree.roots, props.hideEmptyFolders !== false);
    const start = props.rootFolderId ? findNode(visible, props.rootFolderId) : null;
    const base = start && start.node_type === 'FOLDER' ? start : null;
    const items = props.rootFolderId ? (base ? base.children || [] : []) : visible;
    const view: Required<FolderView> = {
        ...FOLDER_VIEW_DEFAULTS,
        ...Object.fromEntries(
            ['layout', 'imageShape', 'columns', 'showDescription', 'showCounts']
                .filter((k) => props[k] !== undefined)
                .map((k) => [k, props[k]])
        ),
        ...(base?.view || {}),
    } as Required<FolderView>;
    const columns = Math.min(Math.max(Number(view.columns) || 3, 2), 5);
    const shape = view.layout === 'tiles' && view.imageShape === 'none' ? 'landscape' : view.imageShape;

    if (items.length === 0) {
        return (
            <Shell align={props.align} title={props.title} subtitle={props.subtitle}>
                <div className="rounded-xl border border-dashed border-catalogue-border p-8 text-center text-sm text-catalogue-text-muted">
                    {props.rootFolderId
                        ? 'The start folder is hidden, empty or deleted, so students see nothing here. Pick another start folder or open the folder manager.'
                        : 'Nothing in this library is visible to students yet. Open the folder manager to add folders and product pages.'}
                </div>
            </Shell>
        );
    }

    const thumb = (n: FolderNode) =>
        n.image_url ? (
            <img src={n.image_url} alt="" className="size-full object-cover" />
        ) : (
            <div className="flex size-full items-center justify-center text-catalogue-text-muted">
                {n.node_type === 'FOLDER' ? (
                    <Folder className="size-8 opacity-60" weight="duotone" />
                ) : (
                    <ShoppingCartSimple className="size-8 opacity-60" weight="duotone" />
                )}
            </div>
        );

    const card = (n: FolderNode) => {
        const counts = view.showCounts ? countLine(n) : '';
        if (view.layout === 'tiles') {
            return (
                <div key={n.id} className={cn('relative overflow-hidden rounded-xl bg-catalogue-bg-muted', ASPECT[shape])}>
                    {thumb(n)}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 pt-8 text-white">
                        <p className="line-clamp-2 text-sm font-semibold">{nodeLabel(n)}</p>
                        {view.showDescription && n.description && <p className="line-clamp-1 text-xs opacity-90">{n.description}</p>}
                        {counts && <p className="text-xs opacity-80">{counts}</p>}
                    </div>
                </div>
            );
        }
        if (view.layout === 'list') {
            return (
                <div key={n.id} className="flex items-center gap-3 px-4 py-3">
                    {shape !== 'none' && (
                        <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-catalogue-bg-muted">{thumb(n)}</div>
                    )}
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-catalogue-text-primary">{nodeLabel(n)}</p>
                        {view.showDescription && n.description && (
                            <p className="truncate text-xs text-catalogue-text-muted">{n.description}</p>
                        )}
                        {counts && <p className="text-xs text-catalogue-text-muted">{counts}</p>}
                    </div>
                    <CaretRight className="size-4 text-catalogue-text-muted" />
                </div>
            );
        }
        return (
            <div key={n.id} className="overflow-hidden rounded-xl border border-catalogue-border bg-catalogue-bg-elevated">
                {shape !== 'none' && <div className={cn('bg-catalogue-bg-muted', ASPECT[shape])}>{thumb(n)}</div>}
                <div className="space-y-1 p-3">
                    <p className="line-clamp-2 text-sm font-semibold text-catalogue-text-primary">{nodeLabel(n)}</p>
                    {view.showDescription && n.description && (
                        <p className="line-clamp-2 text-xs text-catalogue-text-muted">{n.description}</p>
                    )}
                    {counts && <p className="pt-1 text-xs font-semibold text-catalogue-brand-ink">{counts} ›</p>}
                </div>
            </div>
        );
    };

    // Same grouping as the live page: consecutive folders share one grid, each
    // product page is its own block, all in the admin's order.
    const runs: ({ kind: 'folders'; nodes: FolderNode[] } | { kind: 'page'; node: FolderNode })[] = [];
    for (const n of items) {
        const last = runs[runs.length - 1];
        if (n.node_type === 'PRODUCT_PAGE') runs.push({ kind: 'page', node: n });
        else if (last && last.kind === 'folders') last.nodes.push(n);
        else runs.push({ kind: 'folders', nodes: [n] });
    }
    // Mirrors the live rule: the basket is offered only with ONE product page open.
    const cartOn = props.enableCart !== false && items.filter((n) => n.node_type === 'PRODUCT_PAGE').length === 1;

    return (
        <Shell align={props.align} title={props.title} subtitle={props.subtitle}>
            <div className="space-y-6">
                {runs.map((run, i) =>
                    run.kind === 'folders' ? (
                        view.layout === 'list' ? (
                            <div
                                key={`f${i}`}
                                className="divide-y divide-catalogue-border overflow-hidden rounded-xl border border-catalogue-border bg-catalogue-bg-elevated"
                            >
                                {run.nodes.map(card)}
                            </div>
                        ) : (
                            <div key={`f${i}`} className={cn('grid gap-4', COLUMN_CLASSES[columns])}>
                                {run.nodes.map(card)}
                            </div>
                        )
                    ) : (
                        <div
                            key={run.node.id}
                            className="flex items-center gap-3 rounded-xl border border-dashed border-catalogue-border p-4 text-sm text-catalogue-text-muted"
                        >
                            <ShoppingCartSimple className="size-5 shrink-0" />
                            <span>
                                Courses from <strong className="text-catalogue-text-primary">{nodeLabel(run.node)}</strong>{' '}
                                show here{cartOn ? ', with add to cart' : ''}.
                            </span>
                        </div>
                    )
                )}
            </div>
            <p className="mt-4 text-center text-2xs text-catalogue-text-muted">
                Students click a folder to open it. The canvas shows the first level.
            </p>
        </Shell>
    );
};
