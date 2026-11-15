import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DownloadSimple, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { type PlainOption, PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import {
    changeProductStatus,
    fetchCollectionProductIds,
    saveCollectionProductIds,
} from '@/routes/commerce/-shared/catalogue-api';
import { catalogueKeys } from '@/routes/commerce/-shared/catalogue-hooks';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import type { ProductStatus } from '@/routes/commerce/-shared/commerce-types';
import { type BulkFailure, selectionAfterBulk } from '@/routes/commerce/-shared/product-list';

interface ProductBulkBarProps {
    selectedIds: string[];
    nameOfId: (id: string) => string;
    collectionOptions: PlainOption[];
    /** The selection to keep: only the rows that failed. */
    onDone: (selection: Record<string, boolean>) => void;
    onClear: () => void;
    onExport: () => void;
    exporting: boolean;
}

/**
 * The bar above the list while rows are ticked: publish,
 * archive, add to a collection, export.
 *
 * There is no bulk endpoint, so a status change is one call per product, one
 * after the other; the server checks each product by itself (a product
 * without a tax class is refused, the others go through). What failed stays
 * ticked and is listed with the server's reason.
 */
export function ProductBulkBar({
    selectedIds,
    nameOfId,
    collectionOptions,
    onDone,
    onClear,
    onExport,
    exporting,
}: ProductBulkBarProps) {
    const { t } = useTranslation('commerce');
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(0);
    const [failures, setFailures] = useState<BulkFailure[]>([]);
    const [collectionId, setCollectionId] = useState('');

    const refresh = () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: catalogueKeys.productsRoot() }),
            queryClient.invalidateQueries({ queryKey: catalogueKeys.collectionsRoot() }),
        ]);

    const setStatus = async (status: ProductStatus) => {
        setBusy(true);
        setFailures([]);
        setProgress(0);
        const failed: BulkFailure[] = [];
        for (const id of selectedIds) {
            try {
                await changeProductStatus(id, status);
            } catch (error) {
                failed.push({
                    id,
                    message: readCommerceError(error, t('products.errors.status')).message,
                });
            }
            setProgress((done) => done + 1);
        }
        await refresh();
        setBusy(false);
        setFailures(failed);
        const done = selectedIds.length - failed.length;
        if (done > 0) toast.success(t(`products.bulk.done.${status}`, { count: done }));
        if (failed.length > 0) toast.error(t('products.bulk.failed', { count: failed.length }));
        onDone(selectionAfterBulk(selectedIds, failed));
    };

    /** The endpoint replaces the collection's set, so the stored set is read first. */
    const addToCollection = async () => {
        if (!collectionId) return;
        setBusy(true);
        setFailures([]);
        try {
            const current = await fetchCollectionProductIds(collectionId);
            const merged = [...current, ...selectedIds.filter((id) => !current.includes(id))];
            await saveCollectionProductIds(collectionId, merged);
            await refresh();
            toast.success(
                t('products.bulk.addedToCollection', { count: merged.length - current.length })
            );
            setCollectionId('');
            onDone({});
        } catch (error) {
            toast.error(readCommerceError(error, t('products.errors.collection')).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            role="region"
            aria-label={t('products.bulk.label')}
            className="sticky top-2 z-10 flex flex-col gap-3 rounded-lg border border-primary-200 bg-primary-50 p-3"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body font-medium text-foreground" aria-live="polite">
                    {busy
                        ? t('products.bulk.working', {
                              done: progress,
                              total: selectedIds.length,
                          })
                        : t('products.bulk.selected', { count: selectedIds.length })}
                </p>
                <MyButton buttonType="text" scale="small" type="button" onClick={onClear}>
                    <X size={14} />
                    {t('products.bulk.clear')}
                </MyButton>
            </div>
            <div className="flex flex-wrap items-end gap-2">
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    type="button"
                    disable={busy}
                    onClick={() => void setStatus('ACTIVE')}
                >
                    {t('products.setStatus.ACTIVE')}
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    type="button"
                    disable={busy}
                    onClick={() => void setStatus('ARCHIVED')}
                >
                    {t('products.setStatus.ARCHIVED')}
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    type="button"
                    disable={busy || exporting}
                    onClick={onExport}
                >
                    <DownloadSimple size={14} />
                    {t('products.bulk.export')}
                </MyButton>
                <div className="flex min-w-0 flex-1 items-end gap-2 sm:max-w-sm">
                    <PlainSelect
                        className="flex-1"
                        label={t('products.bulk.collection')}
                        hideLabel
                        placeholder={t('products.bulk.collection')}
                        value={collectionId}
                        onChange={setCollectionId}
                        options={collectionOptions}
                        disabled={busy || collectionOptions.length === 0}
                    />
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        type="button"
                        disable={busy || !collectionId}
                        onClick={() => void addToCollection()}
                    >
                        {t('products.bulk.addToCollection')}
                    </MyButton>
                </div>
            </div>
            {failures.length > 0 && (
                <ul role="alert" className="flex flex-col gap-1 rounded-md bg-danger-50 p-2">
                    {failures.map((failure) => (
                        <li key={failure.id} className="text-caption text-danger-600">
                            <span className="font-medium">{nameOfId(failure.id)}</span>
                            {': '}
                            {failure.message}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
