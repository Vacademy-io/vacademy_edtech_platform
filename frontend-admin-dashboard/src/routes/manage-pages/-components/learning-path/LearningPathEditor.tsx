import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import { getAllProductPages } from '../../product-pages/-services/product-pages-service';
import { useFolderLibraryStore } from '../../-stores/folder-library-store';
import { useEditorStore } from '../../-stores/editor-store';
import { activeEditingLocale } from '../../-hooks/use-localized-editing';
import {
    findNode,
    flattenFolders,
    folderLibrariesQueryKey,
    folderTreeQueryKey,
    getFolderTree,
    listFolderLibraries,
    nodeLabel,
    type FolderNode,
} from '../../-services/folder-library-service';
import type { LearningPathProps } from '../../-types/editor-types';
import { ColorPickerField } from '../ColorPickerField';
import { TextField, Toggle } from './learning-path-fields';
import { LearningPathFeaturedFields } from './LearningPathFeaturedFields';
import {
    featuredPathSiblings,
    findPathSection,
    isFeaturedPathList,
    sharedPathDifferences,
    sharedPathSource,
    syncSharedPathProps,
    withSectionProps,
} from './learning-path-shared';

/**
 * Property panel of a Learning Path section.
 *
 * One path = one product page shown as numbered steps (its courses in the
 * order set on the product page). List mode shows the product pages of a
 * folder library as path cards; "View path" opens one in place (?path=code).
 * Course data is always read live; only codes and ids are stored.
 */

interface LearningPathEditorProps {
    component: { id: string; props: LearningPathProps };
    pageId: string;
    updateComponent: (pageId: string, componentId: string, patch: { props: LearningPathProps }) => void;
}

/**
 * Codes of the paths the section lists, as the site collects them: under the
 * chosen folder (or the whole library), never inside a coming-soon folder.
 */
const libraryPageCodes = (roots: FolderNode[], folderId: string | undefined): Set<string> => {
    const codes = new Set<string>();
    const walk = (nodes: FolderNode[]) =>
        nodes.forEach((n) => {
            if (n.node_type === 'PRODUCT_PAGE') {
                const code = (n.product_page_code || '').trim();
                if (code) codes.add(code);
            } else if (!n.coming_soon) {
                walk(Array.isArray(n.children) ? n.children : []);
            }
        });
    if (!folderId) walk(roots);
    else {
        const start = findNode(roots, folderId);
        if (start && start.node_type === 'FOLDER' && !start.coming_soon) walk(start.children || []);
    }
    return codes;
};

export const LearningPathEditor = ({ component, pageId, updateComponent }: LearningPathEditorProps) => {
    const instituteId = getCurrentInstituteId();
    const uid = useId();
    const { props } = component;
    const mode: 'single' | 'list' = props.mode === 'list' ? 'list' : 'single';
    const patch = (next: Partial<LearningPathProps>) =>
        updateComponent(pageId, component.id, { props: { ...props, ...next } });
    const set = <K extends keyof LearningPathProps>(key: K, value: LearningPathProps[K]) =>
        patch({ [key]: value } as Pick<LearningPathProps, K>);
    const openForSection = useFolderLibraryStore((s) => s.openForSection);
    const { t } = useTranslation('managePagesLearningPath');
    const featuredLayout = isFeaturedPathList(props);

    const { data: pages, isLoading: pagesLoading } = useQuery({
        queryKey: ['PRODUCT_PAGES_FOR_CATALOGUE', instituteId],
        queryFn: () => getAllProductPages(instituteId!),
        enabled: (mode === 'single' || featuredLayout) && !!instituteId,
        staleTime: 60_000,
    });
    const pageList = Array.isArray(pages) ? pages : [];
    const code: string = props.productPageCode || '';
    const selectedPage = pageList.find((p) => p.code === code);

    const { data: libraries, isLoading: librariesLoading } = useQuery({
        queryKey: folderLibrariesQueryKey(instituteId),
        queryFn: () => listFolderLibraries(instituteId!),
        enabled: mode === 'list' && !!instituteId,
        staleTime: 30_000,
    });
    const libraryList = Array.isArray(libraries) ? libraries : [];
    const libraryId: string = props.libraryId || '';
    const selectedLibrary = libraryList.find((l) => l.id === libraryId);
    const {
        data: tree,
        isLoading: treeLoading,
        isError: treeError,
        refetch: refetchTree,
    } = useQuery({
        queryKey: folderTreeQueryKey(instituteId, libraryId),
        queryFn: () => getFolderTree(instituteId!, libraryId),
        enabled: mode === 'list' && !!instituteId && !!libraryId,
    });
    // Why there are no folders yet: no library, still loading, or the load failed.
    const foldersState: 'ready' | 'noLibrary' | 'loading' | 'error' = !libraryId
        ? 'noLibrary'
        : treeLoading
          ? 'loading'
          : treeError
            ? 'error'
            : 'ready';
    // Guard the shape: an unexpected body must not take the whole property panel down.
    const roots = tree && Array.isArray(tree.roots) ? tree.roots : null;
    const folders = roots ? flattenFolders(roots) : [];
    const folderMissing = !!props.folderId && !!roots && !folders.some((f) => f.node.id === props.folderId);
    // The site does not open a coming-soon folder, so no path from it shows yet.
    const folderComingSoon = folders.some((f) => f.node.id === props.folderId && f.node.coming_soon);
    const wireLibrary = (id: string, name: string) => patch({ libraryId: id, libraryName: name, folderId: '' });

    // Featured layout: the product pages in the library are the paths it can feature.
    const libraryCodes = roots ? libraryPageCodes(roots, props.folderId) : null;
    const pageComponents = useEditorStore((s) => s.config?.pages.find((p) => p.id === pageId)?.components);
    const siblings = featuredLayout ? featuredPathSiblings(pageComponents, component) : [];
    const differs = siblings.length ? sharedPathDifferences(pageComponents, component.id) : [];
    const source = featuredLayout ? sharedPathSource(pageComponents, props) : null;
    const sharedFrom = source
        ? {
              title: (source.props as LearningPathProps).title?.trim() || '',
              position: findPathSection(pageComponents, source.id)?.position ?? 0,
              select: () => useEditorStore.getState().selectComponent(source.id),
          }
        : null;
    /**
     * Goals and the featured path: also copied to sibling sections that keep
     * their own copy, so a page split over two sections stays consistent.
     */
    const patchShared = (next: Partial<LearningPathProps>, keys: string[] = Object.keys(next)) => {
        if (!siblings.length) return patch(next);
        const store = useEditorStore.getState();
        if (store.config && !activeEditingLocale(store.config.globalSettings?.i18n, store.editingLocale)) {
            // Base language: the section and its copies in one undoable edit.
            const edited = withSectionProps(store.config, pageId, component.id, { ...props, ...next });
            store.updateConfig(syncSharedPathProps(edited, pageId, component.id, keys));
            return;
        }
        // Another language: a text edit is a translation (shared by every
        // copy); copy whatever the edit changed in the base, in the same undo
        // step. A refused edit changed nothing, so nothing is copied.
        const before = store.config;
        patch(next);
        const latest = useEditorStore.getState().config;
        if (!latest || latest === before) return;
        const synced = syncSharedPathProps(latest, pageId, component.id, keys);
        if (synced !== latest) useEditorStore.getState().amendLastEdit(synced);
    };
    // The featured layout draws the title above the goal chips only.
    const showTitle = !featuredLayout || props.showGoals !== false;

    return (
        <div className="space-y-5">
            <div className="rounded border border-neutral-200 bg-neutral-50 p-2 text-caption text-neutral-500">
                A learning path is a product page whose courses are taken in order. Show one path as numbered
                steps, or list the paths kept in a folder library so visitors can open one.
            </div>

            {/* Mode */}
            <div>
                <Label className="text-xs">Show</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                    {(
                        [
                            { value: 'single', label: 'One path' },
                            { value: 'list', label: 'A list of paths' },
                        ] as const
                    ).map((o) => (
                        <button
                            key={o.value}
                            type="button"
                            onClick={() => set('mode', o.value)}
                            className={cn(
                                'rounded px-2.5 py-1 text-caption font-medium',
                                mode === o.value ? 'bg-primary-100 text-primary-500' : 'bg-neutral-100 text-neutral-600'
                            )}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            </div>

            {mode === 'single' ? (
                <div className="space-y-2">
                    <Label htmlFor={`${uid}-page`} className="text-xs">
                        Product page (the path)
                    </Label>
                    <select
                        id={`${uid}-page`}
                        className="w-full rounded border px-2 py-1.5 text-xs"
                        value={selectedPage ? selectedPage.code : code}
                        onChange={(e) => {
                            const picked = pageList.find((p) => p.code === e.target.value);
                            patch({ productPageCode: picked?.code || '', productPageName: picked?.name || '' });
                        }}
                    >
                        <option value="">{pagesLoading ? 'Loading product pages…' : 'Select a product page'}</option>
                        {code && !selectedPage && !pagesLoading && (
                            <option value={code}>{props.productPageName || code} (not found)</option>
                        )}
                        {pageList.map((p) => (
                            <option key={p.id} value={p.code}>
                                {p.name}
                                {p.status !== 'ACTIVE' ? ` (${String(p.status).toLowerCase()})` : ''}
                            </option>
                        ))}
                    </select>
                    {code && !selectedPage && !pagesLoading && (
                        <p className="text-caption text-warning-600">
                            This product page was deleted, so the section shows nothing. Pick another.
                        </p>
                    )}
                    {selectedPage && selectedPage.status !== 'ACTIVE' && (
                        <p className="text-caption text-warning-600">
                            This product page is a draft. Visitors can still check out through it, but make it active
                            when the path is ready.
                        </p>
                    )}
                    <p className="text-caption text-neutral-500">
                        Steps follow the order of the courses on the product page — reorder them there with the
                        arrows. A course offered in several languages is one step.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="space-y-2">
                        <Label htmlFor={`${uid}-library`} className="text-xs">
                            Folder library
                        </Label>
                        <select
                            id={`${uid}-library`}
                            className="w-full rounded border px-2 py-1.5 text-xs"
                            value={libraryId}
                            onChange={(e) => {
                                const lib = libraryList.find((l) => l.id === e.target.value);
                                patch({ libraryId: e.target.value, libraryName: lib?.name || '', folderId: '' });
                            }}
                        >
                            <option value="">{librariesLoading ? 'Loading libraries…' : 'Select a library'}</option>
                            {libraryList.map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.name}
                                </option>
                            ))}
                        </select>
                        {libraryId && !librariesLoading && libraries && !selectedLibrary && (
                            <p className="text-caption text-warning-600">
                                This library was deleted. Pick another — the section shows nothing until you do.
                            </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                            {libraryId && selectedLibrary && (
                                <MyButton buttonType="primary" scale="small" onClick={() => openForSection(libraryId, wireLibrary)}>
                                    <FolderOpen className="size-4" /> Manage folders
                                </MyButton>
                            )}
                            <MyButton buttonType="secondary" scale="small" onClick={() => openForSection(null, wireLibrary)}>
                                <Plus className="size-4" /> {libraryList.length ? 'New or other library' : 'Create a library'}
                            </MyButton>
                        </div>
                        <p className="text-caption text-neutral-500">
                            Every product page in the library is a path. Put each under its stream folder.
                        </p>
                    </div>

                    {libraryId && selectedLibrary && (
                        <div>
                            <Label htmlFor={`${uid}-folder`} className="text-xs">
                                Paths from
                            </Label>
                            <select
                                id={`${uid}-folder`}
                                className="mt-1 w-full rounded border px-2 py-1.5 text-xs"
                                value={props.folderId || ''}
                                onChange={(e) => set('folderId', e.target.value)}
                            >
                                <option value="">Every stream</option>
                                {folders.map(({ node, depth }) => (
                                    <option key={node.id} value={node.id}>
                                        {`${'— '.repeat(depth + 1)}${nodeLabel(node)}${node.coming_soon ? ' (coming soon)' : ''}`}
                                    </option>
                                ))}
                            </select>
                            {folderMissing && (
                                <p className="mt-1 text-caption text-warning-600">
                                    That folder was deleted, so the section shows nothing. Pick another.
                                </p>
                            )}
                            {folderComingSoon && (
                                <p className="mt-1 text-caption text-warning-600">
                                    This folder is marked coming soon, so the site shows no paths from it until it
                                    launches.
                                </p>
                            )}
                        </div>
                    )}

                    <Toggle
                        label="Follow the stream tab"
                        hint="On /courses?stream=… show only that stream’s paths (the folder whose link key matches). Without a stream, the choice above applies."
                        checked={!!props.streamFromUrl}
                        onChange={(v) => set('streamFromUrl', v)}
                    />
                    <TextField
                        label="Address parameter for an open path"
                        value={props.pathParam ?? ''}
                        placeholder="path"
                        onChange={(v) => set('pathParam', v.replace(/[^\w.-]/g, ''))}
                        hint="“View path” opens a path in place as ?path=<code>. Change only if another section already uses ?path=."
                    />
                    {featuredLayout && (
                        <LearningPathFeaturedFields
                            props={props}
                            folders={folders}
                            foldersState={foldersState}
                            onRetryFolders={() => void refetchTree()}
                            libraryCodes={libraryCodes}
                            pages={pageList}
                            pagesLoading={pagesLoading}
                            patch={patch}
                            patchShared={patchShared}
                            siblingCount={siblings.length}
                            siblingDiffers={differs}
                            sharedFrom={sharedFrom}
                        />
                    )}
                </div>
            )}

            {/* Heading (the featured layout has no subtitle) */}
            {showTitle && (
                <div className="space-y-3 border-t border-neutral-100 pt-4">
                    <TextField
                        label={featuredLayout ? t('heading.goalsTitle') : 'Title'}
                        value={props.title || ''}
                        onChange={(v) => set('title', v)}
                    />
                    {!featuredLayout && (
                        <div>
                            <Label htmlFor={`${uid}-subtitle`} className="text-xs">
                                Subtitle
                            </Label>
                            <Textarea
                                id={`${uid}-subtitle`}
                                className="mt-1"
                                rows={2}
                                value={props.subtitle || ''}
                                onChange={(e) => set('subtitle', e.target.value)}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Steps */}
            <div className="space-y-3 border-t border-neutral-100 pt-4">
                <p className="text-sm font-semibold text-neutral-700">Steps</p>
                <Toggle
                    label="Step numbers"
                    checked={props.showStepNumbers !== false}
                    onChange={(v) => set('showStepNumbers', v)}
                />
                <Toggle
                    label="Path total"
                    hint="The sum of the steps’ prices."
                    checked={props.showTotal !== false}
                    onChange={(v) => set('showTotal', v)}
                />
            </div>

            {/* Labels */}
            <div className="space-y-3 border-t border-neutral-100 pt-4">
                <p className="text-sm font-semibold text-neutral-700">Button labels</p>
                <TextField
                    label="With the site cart on"
                    value={props.addAllLabel || ''}
                    placeholder="Add whole path to cart"
                    onChange={(v) => set('addAllLabel', v)}
                    hint="Adds every step to the site cart (Global Settings → Site cart)."
                />
                <TextField
                    label="Without a site cart"
                    value={props.enrolLabel || ''}
                    placeholder="Enrol in this path"
                    onChange={(v) => set('enrolLabel', v)}
                    hint="Opens the product page’s checkout with every step selected."
                />
                {mode === 'list' && (
                    <TextField
                        label="Path card button"
                        value={props.viewPathLabel || ''}
                        placeholder="View path"
                        onChange={(v) => set('viewPathLabel', v)}
                    />
                )}
                <TextField
                    label="When there is nothing to show"
                    value={props.emptyText || ''}
                    placeholder="New learning paths will appear here."
                    onChange={(v) => set('emptyText', v)}
                />
            </div>

            {/* Background */}
            <div className="space-y-2 border-t border-neutral-100 pt-4">
                {props.backgroundColor ? (
                    <>
                        <ColorPickerField
                            label="Background colour"
                            value={props.backgroundColor}
                            onChange={(c) => set('backgroundColor', c)}
                        />
                        <MyButton buttonType="text" scale="small" onClick={() => set('backgroundColor', '')}>
                            Use the page background
                        </MyButton>
                    </>
                ) : (
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <Label className="text-xs">Background colour</Label>
                            <p className="text-caption text-neutral-500">Same as the page.</p>
                        </div>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => set('backgroundColor', '#F8FAFC')} // design-lint-ignore: colour-editor seed value
                        >
                            Set colour
                        </MyButton>
                    </div>
                )}
            </div>
        </div>
    );
};
