import { useQuery } from '@tanstack/react-query';
import { FolderOpen, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import { useFolderLibraryStore } from '../../-stores/folder-library-store';
import {
    flattenFolders,
    folderLibrariesQueryKey,
    folderTreeQueryKey,
    getFolderTree,
    listFolderLibraries,
    nodeLabel,
    type FolderView,
} from '../../-services/folder-library-service';
import { FolderViewFields } from './FolderViewFields';

/**
 * Property panel of a Folder Browser section. The folders themselves live in
 * a shared library (edited in the Folders manager, opened from here); this
 * panel only picks the library, where to start, and how it looks.
 */

interface FolderBrowserEditorProps {
    component: { id: string; props: Record<string, any> };
    pageId: string;
    updateComponent: (pageId: string, componentId: string, patch: { props: Record<string, any> }) => void;
}

const Toggle = ({
    label,
    hint,
    checked,
    onChange,
}: {
    label: string;
    hint?: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) => (
    <div className="flex items-start justify-between gap-3">
        <div>
            <Label className="text-xs">{label}</Label>
            {hint && <p className="text-caption text-neutral-500">{hint}</p>}
        </div>
        <Switch checked={checked} onCheckedChange={onChange} />
    </div>
);

const Choice = <T extends string | number>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (v: T) => void;
}) => (
    <div>
        <Label className="text-xs">{label}</Label>
        <div className="mt-1 flex flex-wrap gap-1">
            {options.map((o) => (
                <button
                    key={String(o.value)}
                    type="button"
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'rounded px-2.5 py-1 text-caption font-medium',
                        value === o.value ? 'bg-primary-100 text-primary-500' : 'bg-neutral-100 text-neutral-600'
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    </div>
);

export const FolderBrowserEditor = ({ component, pageId, updateComponent }: FolderBrowserEditorProps) => {
    const instituteId = getCurrentInstituteId();
    const { props } = component;
    const openForSection = useFolderLibraryStore((s) => s.openForSection);
    const patch = (next: Record<string, any>) =>
        updateComponent(pageId, component.id, { props: { ...props, ...next } });
    const set = (key: string, value: any) => patch({ [key]: value });

    const { data: libraries, isLoading } = useQuery({
        queryKey: folderLibrariesQueryKey(instituteId),
        queryFn: () => listFolderLibraries(instituteId!),
        enabled: !!instituteId,
        staleTime: 30_000,
    });
    const libraryId: string = props.libraryId || '';
    const { data: tree } = useQuery({
        queryKey: folderTreeQueryKey(instituteId, libraryId),
        queryFn: () => getFolderTree(instituteId!, libraryId),
        enabled: !!instituteId && !!libraryId,
    });
    const selected = (libraries || []).find((l) => l.id === libraryId);
    const folders = tree ? flattenFolders(tree.roots) : [];
    const startMissing = !!props.rootFolderId && !!tree && !folders.some((f) => f.node.id === props.rootFolderId);

    // A library created from this panel is wired into this section straight
    // away. The manager is modal, so `props` cannot change while it is open.
    const wireLibrary = (id: string, name: string) => patch({ libraryId: id, libraryName: name, rootFolderId: '' });

    const view: FolderView = {
        layout: props.layout,
        imageShape: props.imageShape,
        columns: props.columns,
        showDescription: props.showDescription,
        showCounts: props.showCounts,
    };

    return (
        <div className="space-y-5">
            <div className="rounded border border-neutral-200 bg-neutral-50 p-2 text-caption text-neutral-500">
                Students open folders (Class → Subject → …) until they reach a product page, whose courses show right
                there with add to cart. The folders live in a shared library, so editing it updates every section that
                shows it.
            </div>

            {/* Library */}
            <div className="space-y-2">
                <Label className="text-xs">Folder library</Label>
                <select
                    className="w-full rounded border px-2 py-1.5 text-xs"
                    value={libraryId}
                    onChange={(e) => {
                        const lib = (libraries || []).find((l) => l.id === e.target.value);
                        patch({ libraryId: e.target.value, libraryName: lib?.name || '', rootFolderId: '' });
                    }}
                >
                    <option value="">{isLoading ? 'Loading libraries…' : 'Select a library'}</option>
                    {(libraries || []).map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.name} ({l.node_count} item{l.node_count === 1 ? '' : 's'})
                        </option>
                    ))}
                </select>
                {libraryId && !isLoading && !selected && (
                    <p className="text-caption text-warning-600">
                        This library was deleted. Pick another one — the section shows nothing until you do.
                    </p>
                )}
                <div className="flex flex-wrap gap-2">
                    {libraryId && selected && (
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            onClick={() => openForSection(libraryId, wireLibrary)}
                        >
                            <FolderOpen className="size-4" /> Manage folders
                        </MyButton>
                    )}
                    <MyButton buttonType="secondary" scale="small" onClick={() => openForSection(null, wireLibrary)}>
                        <Plus className="size-4" /> {libraries && libraries.length ? 'New or other library' : 'Create a library'}
                    </MyButton>
                </div>
            </div>

            {libraryId && selected && (
                <div>
                    <Label className="text-xs">Start in</Label>
                    <select
                        className="mt-1 w-full rounded border px-2 py-1.5 text-xs"
                        value={props.rootFolderId || ''}
                        onChange={(e) => set('rootFolderId', e.target.value)}
                    >
                        <option value="">{selected.name} (top level)</option>
                        {folders.map(({ node, depth }) => (
                            <option key={node.id} value={node.id}>
                                {`${'— '.repeat(depth + 1)}${nodeLabel(node)}`}
                            </option>
                        ))}
                    </select>
                    <p className="mt-1 text-caption text-neutral-500">
                        Show just one branch here, e.g. a &ldquo;Class 10&rdquo; page that starts inside the Class 10
                        folder.
                    </p>
                    {startMissing && (
                        <p className="mt-1 text-caption text-warning-600">
                            The start folder was deleted, so this section shows nothing. Pick another start folder.
                        </p>
                    )}
                </div>
            )}

            {/* Heading */}
            <div className="space-y-3 border-t border-neutral-100 pt-4">
                <div>
                    <Label className="text-xs">Title</Label>
                    <Input className="mt-1" value={props.title || ''} onChange={(e) => set('title', e.target.value)} />
                </div>
                <div>
                    <Label className="text-xs">Subtitle</Label>
                    <Textarea
                        className="mt-1"
                        rows={2}
                        value={props.subtitle || ''}
                        onChange={(e) => set('subtitle', e.target.value)}
                    />
                </div>
                <p className="text-caption text-neutral-500">
                    Inside a folder, its own title and description replace these.
                </p>
                <Choice
                    label="Heading alignment"
                    value={props.align || 'left'}
                    options={[
                        { value: 'left', label: 'Left' },
                        { value: 'center', label: 'Center' },
                    ]}
                    onChange={(v) => set('align', v)}
                />
            </div>

            {/* Folder look */}
            <div className="space-y-3 border-t border-neutral-100 pt-4">
                <div>
                    <p className="text-sm font-semibold text-neutral-700">How folders look</p>
                    <p className="text-caption text-neutral-500">
                        The default for every level. A folder can set its own look in the folder manager.
                    </p>
                </div>
                <FolderViewFields value={view} onChange={(v) => patch({ ...v })} />
                <Toggle
                    label="Breadcrumb trail"
                    hint="All › Class 10 › Science, so students can jump back up"
                    checked={props.showBreadcrumbs !== false}
                    onChange={(v) => set('showBreadcrumbs', v)}
                />
                <Toggle
                    label="Search box"
                    hint="Searches every folder and product page; appears once there are 8+ items"
                    checked={props.showSearch !== false}
                    onChange={(v) => set('showSearch', v)}
                />
                <Toggle
                    label="Hide empty folders"
                    hint="Folders with nothing visible inside are left out"
                    checked={props.hideEmptyFolders !== false}
                    onChange={(v) => set('hideEmptyFolders', v)}
                />
            </div>

            {/* Courses */}
            <div className="space-y-3 border-t border-neutral-100 pt-4">
                <div>
                    <p className="text-sm font-semibold text-neutral-700">Courses inside a product page</p>
                    <p className="text-caption text-neutral-500">
                        What students see when they open a folder holding a product page.
                    </p>
                </div>
                <Toggle
                    label="Add to cart"
                    hint="Collect several courses and check out together. Works in folders holding one product page; where a folder holds several, each course enrols on its own."
                    checked={props.enableCart !== false}
                    onChange={(v) => set('enableCart', v)}
                />
                <Toggle label="Show prices" checked={props.showPrice !== false} onChange={(v) => set('showPrice', v)} />
                <Toggle
                    label="“View course” button"
                    hint="Opens the course details page before buying"
                    checked={props.showViewCourse !== false}
                    onChange={(v) => set('showViewCourse', v)}
                />
                <Choice
                    label="Courses per row"
                    value={Number(props.courseColumns) || 3}
                    options={[2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
                    onChange={(v) => set('courseColumns', v)}
                />
                <Choice
                    label="Courses per page"
                    value={Number(props.coursePageSize ?? 9)}
                    options={[
                        { value: 6, label: '6' },
                        { value: 9, label: '9' },
                        { value: 12, label: '12' },
                        { value: 0, label: 'All' },
                    ]}
                    onChange={(v) => set('coursePageSize', v)}
                />
            </div>
        </div>
    );
};
