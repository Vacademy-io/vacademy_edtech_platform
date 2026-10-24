import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import {
    SearchableSelect,
    prefixFirstFilter,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { listProductPages } from '../../product-pages/-services/product-pages-service';
import type { ProductPageSummary } from '../../product-pages/-types/product-page-types';
import { ImageUploadField } from '../ImageUploadField';
import { FolderViewFields } from './FolderViewFields';
import { FolderNodeAdvancedFields } from './FolderNodeAdvancedFields';
import {
    buildAdvancedPatch,
    draftFromNode,
    hasAdvancedValues,
    validateAdvancedDraft,
    type FolderAdvancedDraft,
} from './folder-node-advanced';
import type { FolderNode, FolderNodeInput, FolderNodeType, FolderView } from '../../-services/folder-library-service';

/**
 * Create / edit one item of a folder library: a folder (title, description,
 * image, and optionally its own way of showing its contents) or a product
 * page leaf (which product page, plus an optional display title and image).
 */

interface FolderNodeEditorDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    nodeType: FolderNodeType;
    /** null = create. */
    node: FolderNode | null;
    /** Shown in the heading so the admin knows where the item lands. */
    parentLabel: string;
    onSubmit: (input: FolderNodeInput) => Promise<void>;
    /** Link keys other folders of the library already use → their names (duplicate warning). */
    takenSlugs?: Map<string, string>;
}

const NO_TAKEN_SLUGS = new Map<string, string>();

/** Every active/draft product page, newest first (the list endpoint pages at most 100 at a time). */
const fetchProductPagesNewestFirst = async (instituteId: string): Promise<ProductPageSummary[]> => {
    const all: ProductPageSummary[] = [];
    for (let page = 0; page < 50; page++) {
        const res = await listProductPages(instituteId, { status: 'ALL', sort: 'LATEST', page, size: 100 });
        all.push(...res.content);
        if (page + 1 >= res.total_pages || res.content.length === 0) break;
    }
    return all;
};

export const FolderNodeEditorDialog = ({
    open,
    onOpenChange,
    nodeType,
    node,
    parentLabel,
    onSubmit,
    takenSlugs = NO_TAKEN_SLUGS,
}: FolderNodeEditorDialogProps) => {
    const instituteId = getCurrentInstituteId();
    const isFolder = nodeType === 'FOLDER';
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [productPageId, setProductPageId] = useState('');
    const [visible, setVisible] = useState(true);
    const [customView, setCustomView] = useState(false);
    const [view, setView] = useState<FolderView>({});
    const [advanced, setAdvanced] = useState<FolderAdvancedDraft>(() => draftFromNode(null));
    const [error, setError] = useState<string | null>(null);

    // Re-seed every time the dialog opens, so a cancelled edit never leaks into the next one.
    useEffect(() => {
        if (!open) return;
        setTitle(node?.title || '');
        setDescription(node?.description || '');
        setImageUrl(node?.image_url || '');
        setProductPageId(node?.product_page_id || '');
        setVisible((node?.status || 'ACTIVE') === 'ACTIVE');
        const hasView = !!node?.view && Object.keys(node.view).length > 0;
        setCustomView(hasView);
        // Only what the admin sets is stored; everything else keeps following the section.
        setView(node?.view || {});
        setAdvanced(draftFromNode(node));
        setError(null);
    }, [open, node]);

    // Newest product page first (server-sorted), fetched fresh on open so a page
    // made a minute ago is already at the top.
    const { data: pages, isLoading: pagesLoading } = useQuery({
        queryKey: ['PRODUCT_PAGE_PICKER_NEWEST_FIRST', instituteId],
        queryFn: () => fetchProductPagesNewestFirst(instituteId!),
        enabled: open && !isFolder && !!instituteId,
        staleTime: 0,
    });
    const selectedPage = (pages || []).find((p) => p.id === productPageId);

    // Labels must be unique (the picker matches on them), so a repeated name gets its code.
    const pageOptions = useMemo<SearchableSelectOption[]>(() => {
        const list = pages || [];
        const nameCount = new Map<string, number>();
        list.forEach((p) => nameCount.set(p.name, (nameCount.get(p.name) || 0) + 1));
        return list.map((p) => ({
            value: p.id,
            label:
                p.name +
                ((nameCount.get(p.name) || 0) > 1 ? ` · ${p.code}` : '') +
                (p.status !== 'ACTIVE' ? ` (${p.status.toLowerCase()})` : ''),
            keywords: [p.code],
        }));
    }, [pages]);

    const submit = async () => {
        if (isFolder && !title.trim()) {
            setError('Give the folder a title.');
            return;
        }
        if (!isFolder && !productPageId) {
            setError('Choose a product page.');
            return;
        }
        // Only fields this save sends are checked: an untouched value stored by
        // another client never blocks renaming the item.
        const advancedProblem = validateAdvancedDraft(advanced, nodeType, node);
        if (advancedProblem) {
            setError(advancedProblem);
            return;
        }
        setError(null);
        const input: FolderNodeInput = {
            title: title.trim(),
            description: description.trim(),
            image_url: imageUrl.trim(),
            status: visible ? 'ACTIVE' : 'HIDDEN',
            // Only Advanced fields that changed — untouched items send what they always sent.
            ...buildAdvancedPatch(node, advanced, nodeType),
        };
        // Only a changed link is sent: re-sending one whose product page was
        // deleted would be rejected, and the item could not even be renamed.
        if (!isFolder && productPageId !== (node?.product_page_id || '')) input.product_page_id = productPageId;
        // {} clears an existing override; omitting `view` would keep it.
        if (isFolder) input.view = customView ? view : {};
        try {
            await onSubmit(input);
            onOpenChange(false);
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { ex?: string; message?: string } } })?.response?.data;
            setError(msg?.ex || msg?.message || 'Could not save. Please try again.');
        }
    };

    const heading = node
        ? isFolder
            ? 'Edit folder'
            : 'Edit product page item'
        : isFolder
          ? `New folder in ${parentLabel}`
          : `Add a product page to ${parentLabel}`;

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={heading}
            dialogWidth="max-w-xl"
            footerLeft={error ? <p className="text-xs text-danger-600">{error}</p> : undefined}
            footer={
                <div className="flex gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                        Cancel
                    </MyButton>
                    <MyButton buttonType="primary" scale="medium" onAsyncClick={submit} loadingText="Saving…">
                        {node ? 'Save' : isFolder ? 'Create folder' : 'Add'}
                    </MyButton>
                </div>
            }
        >
            <div className="space-y-4 p-1">
                {!isFolder && (
                    <div>
                        <Label className="text-xs">Product page</Label>
                        <SearchableSelect
                            className="mt-1"
                            options={pageOptions}
                            value={productPageId}
                            onChange={setProductPageId}
                            placeholder={pagesLoading ? 'Loading product pages…' : 'Select a product page'}
                            searchPlaceholder="Search product pages…"
                            emptyText="No product page matches."
                            disabled={pagesLoading}
                            portal={false}
                            filter={prefixFirstFilter}
                        />
                        {selectedPage && selectedPage.status !== 'ACTIVE' && (
                            <p className="mt-1 text-caption text-warning-600">
                                This product page is not active yet, so students will not see it here until it is.
                            </p>
                        )}
                        {!pagesLoading && (pages || []).length === 0 && (
                            <p className="mt-1 text-caption text-neutral-500">
                                No product pages yet. Create one under Manage Pages → Product pages first.
                            </p>
                        )}
                        <p className="mt-1 text-caption text-neutral-500">
                            Opening this folder shows the product page&apos;s courses, with add to cart and checkout.
                        </p>
                    </div>
                )}

                <div>
                    <Label className="text-xs">{isFolder ? 'Title' : 'Display title (optional)'}</Label>
                    <Input
                        className="mt-1"
                        value={title}
                        maxLength={255}
                        autoFocus={isFolder}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={isFolder ? 'e.g. Class 10' : selectedPage?.name || 'Uses the product page name'}
                    />
                </div>
                <div>
                    <Label className="text-xs">Description (optional)</Label>
                    <Textarea
                        className="mt-1"
                        rows={2}
                        maxLength={2000}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={isFolder ? 'One line on what is inside' : 'Shown above the courses'}
                    />
                </div>
                <ImageUploadField slot="card"
                    label="Image (optional)"
                    value={imageUrl}
                    onChange={setImageUrl}
                    placeholder="Upload or paste an image address"
                />
                <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2">
                    <div>
                        <p className="text-sm font-medium text-neutral-700">Visible to students</p>
                        <p className="text-caption text-neutral-500">
                            Hidden {isFolder ? 'folders (and everything inside them)' : 'items'} stay here for you but
                            disappear from your site.
                        </p>
                    </div>
                    <Switch checked={visible} onCheckedChange={setVisible} />
                </div>

                {isFolder && (
                    <div className="rounded-md border border-neutral-200 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-medium text-neutral-700">Custom look for this folder</p>
                                <p className="text-caption text-neutral-500">
                                    Off: its contents use the section&apos;s layout. On: change any of these just for
                                    this folder&apos;s contents — anything you leave alone still follows the section.
                                </p>
                            </div>
                            <Switch checked={customView} onCheckedChange={setCustomView} />
                        </div>
                        {customView && (
                            <div className="mt-3 border-t border-neutral-100 pt-3">
                                <FolderViewFields value={view} onChange={setView} />
                            </div>
                        )}
                    </div>
                )}

                {open && (
                    <FolderNodeAdvancedFields
                        // A fresh section per item: its open/closed state never carries over.
                        key={node?.id || `new-${nodeType}`}
                        nodeType={nodeType}
                        nodeId={node?.id || ''}
                        title={title}
                        draft={advanced}
                        onChange={(patch) => setAdvanced((prev) => ({ ...prev, ...patch }))}
                        takenSlugs={takenSlugs}
                        defaultOpen={hasAdvancedValues(node)}
                    />
                )}
            </div>
        </MyDialog>
    );
};
