import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretDown, CaretUp, FolderOpen, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useFolderLibraryStore } from '../../-stores/folder-library-store';
import {
    folderLibrariesQueryKey,
    folderTreeQueryKey,
    getFolderTree,
    listFolderLibraries,
    type FolderNode,
} from '../../-services/folder-library-service';
import { LinkPicker } from '../LinkPicker';
import { HeaderToggle } from './HeaderEditorFields';
import {
    DEFAULT_CATEGORIES_HEADING,
    DEFAULT_CATEGORY_LINK_PATTERN,
    DEFAULT_CTA_LABEL_PATTERN,
    DEFAULT_STREAM_LINK_PATTERN,
    fromSitePath,
    isUsableHeaderLink,
    toSitePath,
    unknownPatternTokens,
    type MegaMenuConfig,
} from './header-editor-utils';

/**
 * Settings of a header nav item that opens a mega menu ("Knowledge Streams").
 * The streams are the top-level folders of a folder library and their
 * categories the folders inside them; images, colours, subtitles, taglines,
 * links and "coming soon" are set per folder in the Folders manager. This
 * panel picks the library and the menu's own words.
 */

const folders = (nodes: FolderNode[] | undefined) =>
    (Array.isArray(nodes) ? nodes : []).filter((n) => n?.node_type === 'FOLDER');

const Field = ({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: ReactNode;
}) => (
    <div className="space-y-1">
        <Label className="text-xs">{label}</Label>
        {children}
        {hint && <p className="text-caption text-neutral-500">{hint}</p>}
    </div>
);

const Warning = ({ children }: { children: ReactNode }) => (
    <p className="text-caption text-warning-600">{children}</p>
);

export const MegaMenuEditor = ({
    value,
    onChange,
}: {
    value: MegaMenuConfig;
    onChange: (next: MegaMenuConfig) => void;
}) => {
    const instituteId = getCurrentInstituteId();
    const openForSection = useFolderLibraryStore((s) => s.openForSection);
    const [showLinks, setShowLinks] = useState(false);
    const libraryFieldId = useId();
    const set = <K extends keyof MegaMenuConfig>(key: K, next: MegaMenuConfig[K]) =>
        onChange({ ...value, [key]: next });

    const {
        data: libraries,
        isLoading,
        isError,
    } = useQuery({
        queryKey: folderLibrariesQueryKey(instituteId),
        queryFn: () => listFolderLibraries(instituteId!),
        enabled: !!instituteId,
        staleTime: 30_000,
    });
    const libraryId = value.libraryId || '';
    const { data: tree } = useQuery({
        queryKey: folderTreeQueryKey(instituteId, libraryId),
        queryFn: () => getFolderTree(instituteId!, libraryId),
        enabled: !!instituteId && !!libraryId,
    });
    const libraryList = Array.isArray(libraries) ? libraries : [];
    const selected = libraryList.find((l) => l.id === libraryId);
    const streams = folders(tree?.roots);
    const categoryCount = streams.reduce((n, s) => n + folders(s.children).length, 0);

    // A library created from here is wired into this menu straight away.
    const wireLibrary = (id: string, name: string) =>
        onChange({ ...value, libraryId: id, libraryName: name });

    const streamTokens = unknownPatternTokens(value.streamLinkPattern, ['stream']);
    const categoryTokens = unknownPatternTokens(value.categoryLinkPattern, ['stream', 'category']);

    return (
        <div className="space-y-4 rounded border border-neutral-200 bg-white p-3">
            <p className="text-caption text-neutral-500">
                Opens a panel of streams (the top-level folders of a library) and each
                stream&rsquo;s categories (the folders inside it). Images, colours, second lines,
                taglines and &ldquo;coming soon&rdquo; are set on each folder in the Folders
                manager.
            </p>

            {/* Library */}
            <div className="space-y-2">
                <Label className="text-xs" htmlFor={libraryFieldId}>
                    Folder library
                </Label>
                <select
                    id={libraryFieldId}
                    className="w-full rounded border px-2 py-1.5 text-xs"
                    value={libraryId}
                    onChange={(e) => {
                        const lib = libraryList.find((l) => l.id === e.target.value);
                        onChange({
                            ...value,
                            libraryId: e.target.value,
                            libraryName: lib?.name || '',
                        });
                    }}
                >
                    <option value="">
                        {isLoading ? 'Loading libraries…' : 'Select a library'}
                    </option>
                    {libraryList.map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.name}
                        </option>
                    ))}
                </select>
                {isError && (
                    <Warning>
                        Libraries could not be loaded. Check your connection and reopen this panel.
                    </Warning>
                )}
                {!libraryId && !isLoading && (
                    <p className="text-caption text-neutral-500">
                        Until a library is picked, this item works as a plain link to its route.
                    </p>
                )}
                {libraryId && !isLoading && !isError && !selected && (
                    <Warning>
                        This library{value.libraryName ? ` (“${value.libraryName}”)` : ''} was
                        deleted. Pick another one — until then the live item works as a plain link
                        to its route.
                    </Warning>
                )}
                {selected && tree && (
                    <p className="text-caption text-neutral-500">
                        {streams.length} stream{streams.length === 1 ? '' : 's'} · {categoryCount}{' '}
                        categor
                        {categoryCount === 1 ? 'y' : 'ies'}
                    </p>
                )}
                {selected && tree && streams.length === 0 && (
                    <Warning>
                        This library has no top-level folders yet, so the menu would be empty.
                    </Warning>
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
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => openForSection(null, wireLibrary)}
                    >
                        <Plus className="size-4" />{' '}
                        {libraryList.length ? 'New or other library' : 'Create a library'}
                    </MyButton>
                </div>
            </div>

            {/* Words */}
            <div className="space-y-3 border-t border-neutral-100 pt-3">
                <Field label="Eyebrow" hint="Small capitals above the tiles.">
                    <Input
                        value={value.eyebrow || ''}
                        placeholder="Six streams of knowledge"
                        onChange={(e) => set('eyebrow', e.target.value)}
                    />
                </Field>
                <Field
                    label="Help link text"
                    hint="Shown at the top right of the panel, with the link below."
                >
                    <Input
                        value={value.helpLabel || ''}
                        placeholder="Not sure where to begin? Find your path"
                        onChange={(e) => set('helpLabel', e.target.value)}
                    />
                </Field>
                <LinkPicker
                    label="Help link"
                    value={fromSitePath(value.helpRoute)}
                    onChange={(v) => set('helpRoute', toSitePath(v))}
                />
                {!isUsableHeaderLink(value.helpRoute) && (
                    <Warning>
                        Use a page of this site or an http(s) address — this link would not show.
                    </Warning>
                )}
                <Field
                    label="Button label"
                    hint="{stream} is the stream's name (its second line, else its title); {title} its title. A folder's own CTA label wins."
                >
                    <Input
                        value={value.ctaLabelPattern || ''}
                        placeholder={DEFAULT_CTA_LABEL_PATTERN}
                        onChange={(e) => set('ctaLabelPattern', e.target.value)}
                    />
                </Field>
                <Field
                    label="Categories heading"
                    hint="Above the selected stream's categories. Takes {stream} and {title}."
                >
                    <Input
                        value={value.categoriesHeading || ''}
                        placeholder={DEFAULT_CATEGORIES_HEADING}
                        onChange={(e) => set('categoriesHeading', e.target.value)}
                    />
                </Field>
                <HeaderToggle
                    label="Availability legend"
                    hint="● available ○ coming soon, next to the categories heading"
                    checked={value.showLegend === true}
                    onChange={(v) => set('showLegend', v)}
                />
                <Field label="Footnote" hint="Small print under the panel.">
                    <Textarea
                        rows={2}
                        value={value.footnote || ''}
                        placeholder="Coming soon subjects: click to be notified when they launch."
                        onChange={(e) => set('footnote', e.target.value)}
                    />
                </Field>
            </div>

            {/* Links */}
            <div className="border-t border-neutral-100 pt-3">
                <button
                    type="button"
                    aria-expanded={showLinks}
                    onClick={() => setShowLinks((v) => !v)}
                    className="flex w-full items-center justify-between text-start text-xs font-medium text-neutral-700"
                >
                    Where streams and categories link
                    {showLinks ? <CaretUp className="size-3" /> : <CaretDown className="size-3" />}
                </button>
                {showLinks && (
                    <div className="mt-2 space-y-3">
                        <p className="text-caption text-neutral-500">
                            {'{stream}'} and {'{category}'} are the folders&rsquo; URL keys (slugs).
                            A folder&rsquo;s own link wins over these. Leave empty for the Courses
                            page.
                        </p>
                        <Field label="Stream link">
                            <Input
                                value={value.streamLinkPattern || ''}
                                placeholder={DEFAULT_STREAM_LINK_PATTERN}
                                onChange={(e) => set('streamLinkPattern', e.target.value)}
                            />
                        </Field>
                        {!isUsableHeaderLink(value.streamLinkPattern) && (
                            <Warning>Start with / (a page of this site) or http(s)://.</Warning>
                        )}
                        {streamTokens.length > 0 && (
                            <Warning>
                                Unknown placeholder {streamTokens.map((t) => `{${t}}`).join(', ')} —
                                only {'{stream}'} is filled.
                            </Warning>
                        )}
                        <Field label="Category link">
                            <Input
                                value={value.categoryLinkPattern || ''}
                                placeholder={DEFAULT_CATEGORY_LINK_PATTERN}
                                onChange={(e) => set('categoryLinkPattern', e.target.value)}
                            />
                        </Field>
                        {!isUsableHeaderLink(value.categoryLinkPattern) && (
                            <Warning>Start with / (a page of this site) or http(s)://.</Warning>
                        )}
                        {categoryTokens.length > 0 && (
                            <Warning>
                                Unknown placeholder {categoryTokens.map((t) => `{${t}}`).join(', ')}{' '}
                                — only {'{stream}'} and {'{category}'} are filled.
                            </Warning>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MegaMenuEditor;
