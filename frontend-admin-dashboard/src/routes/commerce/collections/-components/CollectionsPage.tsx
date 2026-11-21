import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ListPlus, PencilSimple, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import { useCollectionTree, useSaveCollection } from '@/routes/commerce/-shared/catalogue-hooks';
import {
    flattenTree,
    i18nName,
    moveAmongSiblings,
    siblingsOf,
} from '@/routes/commerce/-shared/collection-tree';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import type { CommerceCollection } from '@/routes/commerce/-shared/commerce-types';
import { CollectionDialog } from './CollectionDialog';
import { CollectionProductsDialog } from './CollectionProductsDialog';

/** Indent per level of the tree; the deepest levels share the last step. */
const INDENT = ['ps-0', 'ps-5', 'ps-10', 'ps-14', 'ps-16'] as const;

/**
 * Collections: the category tree and the collections. Create,
 * nest (the parent is chosen in the dialog), reorder among siblings, archive,
 * and choose the products of a collection. A collection is retired by
 * archiving; it is never deleted.
 */
export function CollectionsPage() {
    const { t } = useTranslation('commerce');
    const [dialog, setDialog] = useState<{
        collection: CommerceCollection | null;
        parentId: string;
    } | null>(null);
    const [productsOf, setProductsOf] = useState<CommerceCollection | null>(null);
    const openCreate = (parentId = '') => setDialog({ collection: null, parentId });

    return (
        <CommercePage
            navId="commerce-collections"
            title={t('collections.title')}
            description={t('collections.description')}
            actions={
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    type="button"
                    onClick={() => openCreate()}
                >
                    <Plus size={16} />
                    {t('collections.add')}
                </MyButton>
            }
        >
            <CollectionsTree
                onCreate={openCreate}
                onEdit={(collection) =>
                    setDialog({ collection, parentId: collection.parent_id ?? '' })
                }
                onProducts={setProductsOf}
                dialog={dialog}
                closeDialog={() => setDialog(null)}
            />
            <CollectionProductsDialog collection={productsOf} onClose={() => setProductsOf(null)} />
        </CommercePage>
    );
}

function CollectionsTree({
    onCreate,
    onEdit,
    onProducts,
    dialog,
    closeDialog,
}: {
    onCreate: (parentId?: string) => void;
    onEdit: (collection: CommerceCollection) => void;
    onProducts: (collection: CommerceCollection) => void;
    dialog: { collection: CommerceCollection | null; parentId: string } | null;
    closeDialog: () => void;
}) {
    const { t } = useTranslation('commerce');
    const language = useAdminLanguage();
    const query = useCollectionTree();
    const save = useSaveCollection();
    const [moving, setMoving] = useState(false);
    const tree = useMemo(() => query.data ?? [], [query.data]);
    const flat = useMemo(() => flattenTree(tree), [tree]);

    const move = async (collection: CommerceCollection, direction: 'up' | 'down') => {
        const writes = moveAmongSiblings(siblingsOf(tree, collection.id), collection.id, direction);
        if (writes.length === 0) return;
        setMoving(true);
        try {
            // One write per sibling whose place changed; usually two.
            for (const write of writes) {
                await save.mutateAsync({ id: write.id, body: { position: write.position } });
            }
        } catch (error) {
            toast.error(readCommerceError(error, t('collections.errors.reorder')).message);
        } finally {
            setMoving(false);
        }
    };

    return (
        <>
            {query.isLoading && <CommerceLoadingRows rows={4} />}
            {query.isError && (
                <CommerceErrorState
                    message={readCommerceError(query.error, t('collections.errors.load')).message}
                    onRetry={() => void query.refetch()}
                />
            )}
            {query.isSuccess && flat.length === 0 && (
                <CommerceEmptyState
                    title={t('collections.empty.title')}
                    description={t('collections.empty.description')}
                >
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onCreate()}
                    >
                        {t('collections.add')}
                    </MyButton>
                </CommerceEmptyState>
            )}
            {flat.length > 0 && (
                <ul className="flex flex-col gap-2">
                    {flat.map(({ collection, depth, index, siblings }) => {
                        const name = i18nName(
                            collection.name_i18n,
                            language,
                            collection.slug ?? ''
                        );
                        return (
                            <li
                                key={collection.id}
                                className={INDENT[Math.min(depth, INDENT.length - 1)]}
                            >
                                <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-body font-medium text-foreground">
                                                {name}
                                            </span>
                                            <span className="rounded-md bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                                                {t(`collections.kinds.${collection.kind}`, {
                                                    defaultValue: collection.kind,
                                                })}
                                            </span>
                                            <CommerceStatusChip
                                                kind="collection"
                                                value={collection.status ?? 'ACTIVE'}
                                            />
                                        </div>
                                        <span className="truncate font-mono text-caption text-muted-foreground">
                                            {collection.slug}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1">
                                        <MyButton
                                            buttonType="secondary"
                                            layoutVariant="icon"
                                            scale="small"
                                            type="button"
                                            disable={moving || index === 0}
                                            aria-label={t('collections.moveUp', { name })}
                                            onClick={() => void move(collection, 'up')}
                                        >
                                            <ArrowUp size={14} />
                                        </MyButton>
                                        <MyButton
                                            buttonType="secondary"
                                            layoutVariant="icon"
                                            scale="small"
                                            type="button"
                                            disable={moving || index === siblings - 1}
                                            aria-label={t('collections.moveDown', { name })}
                                            onClick={() => void move(collection, 'down')}
                                        >
                                            <ArrowDown size={14} />
                                        </MyButton>
                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            type="button"
                                            onClick={() => onProducts(collection)}
                                        >
                                            <ListPlus size={14} />
                                            {t('collections.products')}
                                        </MyButton>
                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            type="button"
                                            onClick={() => onCreate(collection.id)}
                                        >
                                            <Plus size={14} />
                                            {t('collections.addInside')}
                                        </MyButton>
                                        <MyButton
                                            buttonType="secondary"
                                            layoutVariant="icon"
                                            scale="small"
                                            type="button"
                                            aria-label={t('collections.edit', { name })}
                                            onClick={() => onEdit(collection)}
                                        >
                                            <PencilSimple size={14} />
                                        </MyButton>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
            <CollectionDialog
                open={dialog !== null}
                onOpenChange={(open) => {
                    if (!open) closeDialog();
                }}
                collection={dialog?.collection ?? null}
                initialParentId={dialog?.parentId ?? ''}
                tree={tree}
            />
        </>
    );
}
