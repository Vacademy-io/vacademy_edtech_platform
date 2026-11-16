import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import {
    CommerceErrorState,
    CommerceLoadingRows,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import {
    useCollectionProductIds,
    useSaveCollectionProducts,
} from '@/routes/commerce/-shared/catalogue-hooks';
import { i18nName } from '@/routes/commerce/-shared/collection-tree';
import { COMMERCE_MAX_PAGE_SIZE } from '@/routes/commerce/-shared/commerce-api';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import { useProducts } from '@/routes/commerce/-shared/commerce-hooks';
import type { CommerceCollection, ProductSummary } from '@/routes/commerce/-shared/commerce-types';

/**
 * The products of one collection: see them in order, take one out, search the
 * catalogue and add. Saving replaces the stored set with the list shown.
 *
 * Names come from the product list filtered by this collection (first 100);
 * a product beyond that keeps its place and is shown by its id.
 */
export function CollectionProductsDialog({
    collection,
    onClose,
}: {
    collection: CommerceCollection | null;
    onClose: () => void;
}) {
    const { t } = useTranslation('commerce');
    const language = useAdminLanguage();
    const collectionId = collection?.id ?? null;
    const stored = useCollectionProductIds(collectionId);
    const members = useProducts(
        { collectionId: collectionId ?? undefined, size: COMMERCE_MAX_PAGE_SIZE },
        !!collectionId
    );
    const save = useSaveCollectionProducts();
    const [ids, setIds] = useState<string[]>([]);
    const [known, setKnown] = useState<Record<string, ProductSummary>>({});
    const [search, setSearch] = useState('');
    const [q, setQ] = useState('');
    const results = useProducts({ q, size: 20 }, !!collectionId && q.length >= 2);

    useEffect(() => {
        if (stored.data) setIds(stored.data);
    }, [stored.data]);
    useEffect(() => {
        setSearch('');
        setQ('');
    }, [collectionId]);
    useEffect(() => {
        const timer = setTimeout(() => setQ(search.trim()), 350);
        return () => clearTimeout(timer);
    }, [search]);
    useEffect(() => {
        const rows = [...(members.data?.content ?? []), ...(results.data?.content ?? [])];
        if (rows.length === 0) return;
        setKnown((current) => ({
            ...current,
            ...Object.fromEntries(rows.map((row) => [row.package_id, row])),
        }));
    }, [members.data, results.data]);

    const nameOf = (id: string) => {
        const product = known[id];
        return product ? i18nName(product.names, language, product.slug ?? id) : id;
    };
    const changed = useMemo(
        () => JSON.stringify(ids) !== JSON.stringify(stored.data ?? []),
        [ids, stored.data]
    );
    const candidates = (results.data?.content ?? []).filter((row) => !ids.includes(row.package_id));

    const submit = async () => {
        if (!collectionId) return;
        try {
            await save.mutateAsync({ collectionId, packageIds: ids });
            toast.success(t('collections.productsDialog.saved'));
            onClose();
        } catch (error) {
            toast.error(readCommerceError(error, t('collections.errors.products')).message);
        }
    };

    return (
        <MyDialog
            heading={t('collections.productsDialog.heading', {
                name: i18nName(collection?.name_i18n, language, collection?.slug ?? ''),
            })}
            open={collection !== null}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            dialogWidth="max-w-2xl"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton buttonType="secondary" scale="medium" type="button" onClick={onClose}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        disable={!changed || !stored.isSuccess}
                        onAsyncClick={submit}
                        loadingText={t('common.saving')}
                    >
                        {t('common.saveChanges')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <div className="relative">
                        <MagnifyingGlass
                            size={16}
                            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <MyInput
                            inputType="search"
                            input={search}
                            onChangeFunction={(event) => setSearch(event.target.value)}
                            inputPlaceholder={t('collections.productsDialog.search')}
                            aria-label={t('collections.productsDialog.search')}
                            className="ps-9 sm:w-full"
                        />
                    </div>
                    {q.length >= 2 && results.isSuccess && candidates.length === 0 && (
                        <p className="text-caption text-muted-foreground">
                            {t('collections.productsDialog.noMatch')}
                        </p>
                    )}
                    {candidates.length > 0 && (
                        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-1">
                            {candidates.map((row) => (
                                <li
                                    key={row.package_id}
                                    className="flex items-center justify-between gap-2 rounded-md p-2 hover:bg-muted"
                                >
                                    <span className="min-w-0 truncate text-body text-foreground">
                                        {nameOf(row.package_id)}
                                    </span>
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        type="button"
                                        onClick={() =>
                                            setIds((current) => [...current, row.package_id])
                                        }
                                    >
                                        <Plus size={14} />
                                        {t('collections.productsDialog.add')}
                                    </MyButton>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <p className="text-body font-medium text-foreground">
                        {t('collections.productsDialog.inCollection', { count: ids.length })}
                    </p>
                    {stored.isLoading && <CommerceLoadingRows rows={2} />}
                    {stored.isError && (
                        <CommerceErrorState
                            message={
                                readCommerceError(stored.error, t('collections.errors.products'))
                                    .message
                            }
                            onRetry={() => void stored.refetch()}
                        />
                    )}
                    {stored.isSuccess && ids.length === 0 && (
                        <p className="rounded-lg border border-dashed border-border p-4 text-center text-caption text-muted-foreground">
                            {t('collections.productsDialog.empty')}
                        </p>
                    )}
                    <ul className="flex flex-col gap-1">
                        {ids.map((id) => (
                            <li
                                key={id}
                                className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="min-w-0 truncate text-body text-foreground">
                                        {nameOf(id)}
                                    </span>
                                    {known[id] && (
                                        <CommerceStatusChip
                                            kind="product"
                                            value={known[id]?.status}
                                        />
                                    )}
                                </div>
                                <MyButton
                                    buttonType="text"
                                    layoutVariant="icon"
                                    scale="small"
                                    type="button"
                                    aria-label={t('collections.productsDialog.remove', {
                                        name: nameOf(id),
                                    })}
                                    onClick={() =>
                                        setIds((current) => current.filter((entry) => entry !== id))
                                    }
                                >
                                    <X size={14} />
                                </MyButton>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </MyDialog>
    );
}
