import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    DotsThreeVertical,
    DownloadSimple,
    MagnifyingGlass,
    PencilSimple,
    Plus,
    UploadSimple,
    Warning,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDate } from '@/lib/formatters';
import { saveBlob } from '@/lib/save-blob';
import { PlainSelect, useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import {
    EXPORT_MAX_IDS,
    blobErrorMessage,
    downloadProductExport,
} from '@/routes/commerce/-shared/catalogue-api';
import {
    useChangeProductStatus,
    useCollectionTree,
} from '@/routes/commerce/-shared/catalogue-hooks';
import { flattenTree, i18nName } from '@/routes/commerce/-shared/collection-tree';
import { type ProductListFilters, fetchProducts } from '@/routes/commerce/-shared/commerce-api';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import { useProducts } from '@/routes/commerce/-shared/commerce-hooks';
import type { ProductStatus, ProductSummary } from '@/routes/commerce/-shared/commerce-types';
import { priceRange, productWarnings, serverFilterSupport } from '@/routes/commerce/-shared/product-list';
import { ProductBulkBar } from './ProductBulkBar';

/** 50 rows a page. */
const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 350;
const STATUSES: ProductStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
const STOCK_STATES = ['OUT_OF_STOCK', 'LOW_STOCK', 'IN_STOCK'] as const;

const useDebounced = (value: string, delayMs: number) => {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);
    return debounced;
};


/**
 * Products list: search by name, SKU or barcode; filter by
 * status, collection, stock state and "no tax class"; tick rows for the bulk
 * bar; open the editor.
 */
export function ProductsListPage() {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const openProduct = (productId: string) =>
        void navigate({ to: '/commerce/products/$productId', params: { productId } });
    return (
        <CommercePage
            navId="commerce-products"
            title={t('products.title')}
            description={t('products.description')}
            actions={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => void navigate({ to: '/commerce/products/import' })}
                    >
                        <UploadSimple size={16} />
                        {t('products.import')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        onClick={() => openProduct('new')}
                    >
                        <Plus size={16} />
                        {t('products.add')}
                    </MyButton>
                </>
            }
        >
            <ProductsListContent openProduct={openProduct} />
        </CommercePage>
    );
}

function ProductsListContent({ openProduct }: { openProduct: (productId: string) => void }) {
    const { t } = useTranslation('commerce');
    const language = useAdminLanguage();
    const [search, setSearch] = useState('');
    const q = useDebounced(search.trim(), SEARCH_DELAY_MS);
    const [status, setStatus] = useState('');
    const [collectionId, setCollectionId] = useState('');
    const [stockState, setStockState] = useState('');
    const [taxClassMissing, setTaxClassMissing] = useState(false);
    const [page, setPage] = useState(0);
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [exporting, setExporting] = useState(false);

    const filters = useMemo<ProductListFilters>(
        () => ({
            q,
            status,
            collectionId,
            stockState: (stockState || undefined) as ProductListFilters['stockState'],
            taxClassMissing,
            page,
            size: PAGE_SIZE,
        }),
        [q, status, collectionId, stockState, taxClassMissing, page]
    );
    const query = useProducts(filters);
    const collections = useCollectionTree();
    const changeStatus = useChangeProductStatus();

    // A new search or filter starts at the first page with nothing ticked.
    useEffect(() => {
        setPage(0);
        setSelected({});
    }, [q, status, collectionId, stockState, taxClassMissing]);

    const rows = useMemo(() => query.data?.content ?? [], [query.data]);
    const support = useMemo(() => serverFilterSupport(rows), [rows]);
    const filtered = !!(q || status || collectionId || stockState || taxClassMissing);
    const selectedIds = Object.keys(selected).filter((id) => selected[id]);
    const allTicked = rows.length > 0 && rows.every((row) => selected[row.package_id]);

    const nameOf = (product: ProductSummary) =>
        i18nName(product.names, language, product.slug ?? t('products.untitled'));
    const otherNameOf = (product: ProductSummary) =>
        product.names?.[language === 'hi' ? 'en' : 'hi'] ?? undefined;

    const collectionOptions = useMemo(
        () =>
            flattenTree(collections.data ?? []).map((entry) => ({
                value: entry.collection.id,
                label: `${'— '.repeat(entry.depth)}${i18nName(
                    entry.collection.name_i18n,
                    language,
                    entry.collection.slug ?? ''
                )}`,
            })),
        [collections.data, language]
    );

    const toggle = (id: string, on: boolean) =>
        setSelected((current) => ({ ...current, [id]: on }));
    const toggleAll = (on: boolean) =>
        setSelected(on ? Object.fromEntries(rows.map((row) => [row.package_id, true])) : {});

    const setOneStatus = async (product: ProductSummary, next: ProductStatus) => {
        try {
            await changeStatus.mutateAsync({ id: product.package_id, status: next });
            toast.success(t(`products.toast.status.${next}`, { name: nameOf(product) }));
        } catch (error) {
            toast.error(readCommerceError(error, t('products.errors.status')).message);
        }
    };

    /** A scanner types a code and presses Enter: one match opens the product. */
    const openSingleMatch = async () => {
        const code = search.trim();
        if (!code) return;
        try {
            const found = await fetchProducts({ q: code, size: 2 });
            const only = found.content[0];
            if (found.total_elements === 1 && only) openProduct(only.package_id);
        } catch {
            // The list below shows the error of the same search.
        }
    };

    const exportProducts = async (packageIds?: string[]) => {
        setExporting(true);
        try {
            // The server exports by status or by product ids; it has no search or collection filter.
            const file = await downloadProductExport({ status, packageIds });
            await saveBlob(file.blob, file.filename ?? t('products.exportFileName'));
        } catch (error) {
            toast.error(
                (await blobErrorMessage(error)) ??
                    readCommerceError(error, t('products.errors.export')).message
            );
        } finally {
            setExporting(false);
        }
    };

    const rowMenu = (product: ProductSummary) => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="small"
                    type="button"
                    aria-label={t('products.rowActions', { name: nameOf(product) })}
                >
                    <DotsThreeVertical size={14} />
                </MyButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {STATUSES.filter((next) => next !== product.status).map((next) => (
                    <DropdownMenuItem key={next} onSelect={() => void setOneStatus(product, next)}>
                        {t(`products.setStatus.${next}`)}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const nameCell = (product: ProductSummary) => {
        const warnings = productWarnings(product);
        return (
            <div className="flex min-w-0 items-start gap-2">
                <div className="flex min-w-0 flex-col">
                    <button
                        type="button"
                        title={otherNameOf(product)}
                        className="truncate text-start text-body font-medium text-foreground hover:text-primary-500"
                        onClick={() => openProduct(product.package_id)}
                    >
                        {nameOf(product)}
                    </button>
                    {product.brand && (
                        <span className="truncate text-caption text-muted-foreground">
                            {product.brand}
                        </span>
                    )}
                </div>
                {warnings.length > 0 && (
                    <span
                        role="img"
                        className="mt-0.5 shrink-0 text-warning-600"
                        title={warnings.map((w) => t(`products.warnings.${w}`)).join(' · ')}
                        aria-label={warnings.map((w) => t(`products.warnings.${w}`)).join(' · ')}
                    >
                        <Warning size={16} weight="fill" />
                    </span>
                )}
            </div>
        );
    };

    const tick = (product: ProductSummary) => (
        <Checkbox
            checked={selected[product.package_id] === true}
            aria-label={t('products.select', { name: nameOf(product) })}
            onCheckedChange={(checked) => toggle(product.package_id, checked === true)}
        />
    );

    const columns: ColumnDef<ProductSummary>[] = [
        {
            id: 'select',
            size: 44,
            header: () => (
                <Checkbox
                    checked={allTicked}
                    aria-label={t('products.selectAll')}
                    onCheckedChange={(checked) => toggleAll(checked === true)}
                />
            ),
            cell: ({ row }) => tick(row.original),
        },
        {
            id: 'name',
            header: t('products.columns.name'),
            size: 300,
            cell: ({ row }) => nameCell(row.original),
        },
        {
            id: 'status',
            header: t('products.columns.status'),
            size: 110,
            cell: ({ row }) => <CommerceStatusChip kind="product" value={row.original.status} />,
        },
        {
            id: 'variants',
            header: t('products.columns.variants'),
            size: 90,
            cell: ({ row }) => (
                <span className="block text-end text-body tabular-nums text-foreground">
                    {row.original.variant_count ?? '—'}
                </span>
            ),
        },
        {
            id: 'price',
            header: t('products.columns.price'),
            size: 180,
            cell: ({ row }) => (
                <span className="block text-end text-body tabular-nums text-foreground">
                    {priceRange(row.original, t)}
                </span>
            ),
        },
        {
            id: 'updated',
            header: t('products.columns.updated'),
            size: 120,
            cell: ({ row }) => (
                <span className="text-caption text-muted-foreground">
                    {row.original.updated_at ? formatDate(row.original.updated_at) : '—'}
                </span>
            ),
        },
        {
            id: 'actions',
            header: '',
            size: 90,
            cell: ({ row }) => (
                <div className="flex items-center justify-end gap-1">
                    <MyButton
                        buttonType="secondary"
                        layoutVariant="icon"
                        scale="small"
                        type="button"
                        aria-label={t('products.edit', { name: nameOf(row.original) })}
                        onClick={() => openProduct(row.original.package_id)}
                    >
                        <PencilSimple size={14} />
                    </MyButton>
                    {rowMenu(row.original)}
                </div>
            ),
        },
    ];

    const unsupported = [
        stockState && !support.stockState ? t('products.filters.stockState') : null,
        taxClassMissing && !support.taxClass ? t('products.filters.taxClassMissing') : null,
    ].filter((label): label is string => !!label);

    return (
        <>
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
                <div className="relative">
                    <MagnifyingGlass
                        size={16}
                        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <MyInput
                        inputType="search"
                        input={search}
                        onChangeFunction={(event) => setSearch(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') void openSingleMatch();
                        }}
                        inputPlaceholder={t('products.searchPlaceholder')}
                        aria-label={t('products.searchPlaceholder')}
                        className="ps-9 sm:w-full"
                    />
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <PlainSelect
                        label={t('products.filters.status')}
                        value={status}
                        onChange={setStatus}
                        noneLabel={t('products.filters.all')}
                        options={STATUSES.map((value) => ({
                            value,
                            label: t(`status.product.${value}`),
                        }))}
                    />
                    <PlainSelect
                        label={t('products.filters.collection')}
                        value={collectionId}
                        onChange={setCollectionId}
                        noneLabel={t('products.filters.all')}
                        options={collectionOptions}
                    />
                    <PlainSelect
                        label={t('products.filters.stockState')}
                        value={stockState}
                        onChange={setStockState}
                        noneLabel={t('products.filters.all')}
                        options={STOCK_STATES.map((value) => ({
                            value,
                            label: t(`products.stockState.${value}`),
                        }))}
                    />
                    <label className="flex items-center gap-2 self-end pb-2 text-body text-foreground">
                        <Checkbox
                            checked={taxClassMissing}
                            onCheckedChange={(checked) => setTaxClassMissing(checked === true)}
                        />
                        {t('products.filters.taxClassMissing')}
                    </label>
                </div>
                {unsupported.length > 0 && query.isSuccess && (
                    <p
                        role="status"
                        className="rounded-md bg-warning-50 p-2 text-caption text-warning-600"
                    >
                        {t('products.filters.notOnServer', { filters: unsupported.join(', ') })}
                    </p>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {(q || collectionId) && (
                        <span className="text-caption text-muted-foreground">
                            {t('products.exportIgnoresSearch')}
                        </span>
                    )}
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        type="button"
                        disable={exporting}
                        onClick={() => void exportProducts()}
                    >
                        <DownloadSimple size={14} />
                        {exporting ? t('products.exporting') : t('products.export')}
                    </MyButton>
                </div>
            </div>

            {selectedIds.length > 0 && (
                <ProductBulkBar
                    selectedIds={selectedIds}
                    nameOfId={(id) => {
                        const product = rows.find((row) => row.package_id === id);
                        return product ? nameOf(product) : id;
                    }}
                    collectionOptions={collectionOptions}
                    onDone={setSelected}
                    onClear={() => setSelected({})}
                    onExport={() => {
                        if (selectedIds.length > EXPORT_MAX_IDS) {
                            toast.error(t('products.bulk.exportTooMany', { max: EXPORT_MAX_IDS }));
                            return;
                        }
                        void exportProducts(selectedIds);
                    }}
                    exporting={exporting}
                />
            )}

            {query.isLoading && <CommerceLoadingRows rows={6} />}
            {query.isError && (
                <CommerceErrorState
                    message={readCommerceError(query.error, t('products.errors.load')).message}
                    onRetry={() => void query.refetch()}
                />
            )}
            {query.isSuccess && rows.length === 0 && (
                <CommerceEmptyState
                    title={filtered ? t('products.empty.filteredTitle') : t('products.empty.title')}
                    description={
                        filtered
                            ? t('products.empty.filteredDescription')
                            : t('products.empty.description')
                    }
                >
                    {!filtered && (
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            type="button"
                            onClick={() => openProduct('new')}
                        >
                            {t('products.add')}
                        </MyButton>
                    )}
                </CommerceEmptyState>
            )}
            {query.isSuccess && rows.length > 0 && (
                <>
                    {/* Phones: one card per product; the table needs more width than a phone has. */}
                    <ul className="flex flex-col gap-2 md:hidden">
                        <li className="flex items-center gap-2 px-1 text-caption text-muted-foreground">
                            <Checkbox
                                checked={allTicked}
                                aria-label={t('products.selectAll')}
                                onCheckedChange={(checked) => toggleAll(checked === true)}
                            />
                            {t('products.selectAll')}
                        </li>
                        {rows.map((product) => (
                            <li
                                key={product.package_id}
                                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                            >
                                <div className="pt-1">{tick(product)}</div>
                                <div className="flex min-w-0 flex-1 flex-col gap-2">
                                    {nameCell(product)}
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                        <CommerceStatusChip kind="product" value={product.status} />
                                        <span className="text-caption tabular-nums text-foreground">
                                            {priceRange(product, t)}
                                        </span>
                                        <span className="text-caption text-muted-foreground">
                                            {t('products.variantCount', {
                                                count: product.variant_count ?? 0,
                                            })}
                                        </span>
                                    </div>
                                </div>
                                {rowMenu(product)}
                            </li>
                        ))}
                    </ul>
                    <div className="hidden md:block">
                        <MyTable<ProductSummary>
                            data={query.data}
                            columns={columns}
                            isLoading={false}
                            error={null}
                            currentPage={page}
                            scrollable
                        />
                    </div>
                    <MyPagination
                        currentPage={page}
                        totalPages={query.data?.total_pages ?? 1}
                        totalElements={query.data?.total_elements}
                        pageSize={PAGE_SIZE}
                        onPageChange={(next) => {
                            setPage(next);
                            setSelected({});
                        }}
                        compactOnPhone
                    />
                </>
            )}
        </>
    );
}
