import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Barcode, MagnifyingGlass, Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { formatMoney } from '@/components/design-system/money-cell';
import { getInstituteId } from '@/constants/helper';
import { SectionCard, useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { fetchProduct } from '@/routes/commerce/-shared/catalogue-api';
import type { ProductDetail } from '@/routes/commerce/-shared/catalogue-types';
import { i18nName } from '@/routes/commerce/-shared/collection-tree';
import { fetchProducts } from '@/routes/commerce/-shared/commerce-api';
import {
    type LineSource,
    MAX_ORDER_LINES,
    type NewOrderLine,
    type NewOrderProblems,
    addItem,
    addPiece,
} from '@/routes/commerce/orders/-shared/new-order';
import { scanCode } from '@/routes/commerce/orders/-shared/order-api';
import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import type { ScanResult } from '@/routes/commerce/orders/-shared/order-types';
import { buzz, useScanInput } from '@/routes/commerce/orders/-shared/use-scan-input';
import { Field, OrderNotice, inputClass, useOrderErrorText } from './order-ui';

const productName = (product: ProductDetail, language: string, fallback: string): string => {
    const names = Object.fromEntries(product.translations.map((tr) => [tr.locale, tr.name]));
    return i18nName(names, language, product.slug ?? fallback);
};

/**
 * Items of a new staff order: scan a label, search the catalogue, or type a
 * SKU. A piece label adds that very piece only when the customer takes the
 * items now (it is handed over at once); otherwise it adds its product.
 */
export function NewOrderLines({
    lines,
    onChange,
    handOverNow,
    problems,
    enabled,
}: {
    lines: NewOrderLine[];
    onChange: (lines: NewOrderLine[]) => void;
    handOverNow: boolean;
    problems: NewOrderProblems;
    enabled: boolean;
}) {
    const { t } = useTranslation('commerce');
    const language = useAdminLanguage();
    const errorText = useOrderErrorText();
    const latest = useRef(lines);
    latest.current = lines;
    const [notice, setNotice] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [q, setQ] = useState('');
    const [picked, setPicked] = useState<string | null>(null);
    const [sku, setSku] = useState('');

    const apply = (next: NewOrderLine[] | null | 'duplicate') => {
        if (next === null) {
            setNotice(t('orders.new.lines.tooMany', { count: MAX_ORDER_LINES }));
            buzz();
            return;
        }
        if (next === 'duplicate') {
            setNotice(t('orders.new.lines.pieceTwice'));
            buzz();
            return;
        }
        setNotice(null);
        onChange(next);
    };

    const sourceFromScan = async (result: ScanResult): Promise<LineSource> => {
        const variant = result.variant;
        let listPrice: number | null = null;
        let name = variant.product_name ?? variant.sku ?? '';
        if (variant.package_id) {
            try {
                const product = await fetchProduct(variant.package_id);
                listPrice =
                    product.variants.find((v) => v.package_session_id === variant.package_session_id)?.price ?? null;
                name = productName(product, language, name);
            } catch {
                // The price stays unknown; the server prices the order anyway.
            }
        }
        return {
            variantId: variant.package_session_id,
            sku: variant.sku,
            name,
            variantName: variant.variant_name,
            qtyScale: variant.qty_scale > 1 ? variant.qty_scale : 1,
            unit: variant.unit,
            listPrice,
        };
    };

    const onScan = async (code: string) => {
        setNotice(null);
        try {
            const result = await scanCode(code);
            if (!result) {
                setNotice(t('orders.new.scan.notFound'));
                buzz();
                return;
            }
            const source = await sourceFromScan(result);
            if (result.kind === 'PIECE' && result.piece && handOverNow) {
                apply(addPiece(latest.current, source, result.piece.code));
            } else {
                apply(addItem(latest.current, source));
            }
        } catch (error) {
            const read = readOrderError(error);
            setNotice(read.code === 'FEATURE_DISABLED' ? t('orders.new.scan.unavailable') : errorText(read));
            buzz();
        }
    };
    const scan = useScanInput((code) => void onScan(code), { autoFocus: false });

    const instituteId = getInstituteId() ?? 'none';
    const products = useQuery({
        queryKey: ['commerce', instituteId, 'new-order', 'products', q],
        queryFn: () => fetchProducts({ q, status: 'ACTIVE', size: 20 }),
        enabled: enabled && q.length > 0,
        staleTime: 30 * 1000,
    });
    const product = useQuery({
        queryKey: ['commerce', instituteId, 'new-order', 'product', picked ?? ''],
        queryFn: () => fetchProduct(picked as string),
        enabled: enabled && !!picked,
        staleTime: 30 * 1000,
    });

    const addVariant = (detail: ProductDetail, variantId: string) => {
        const variant = detail.variants.find((v) => v.package_session_id === variantId);
        if (!variant) return;
        apply(
            addItem(latest.current, {
                variantId: variant.package_session_id,
                sku: variant.sku,
                name: productName(detail, language, variant.sku ?? ''),
                variantName: variant.name,
                qtyScale: detail.qty_scale && detail.qty_scale > 1 ? detail.qty_scale : 1,
                unit: detail.unit,
                listPrice: variant.price,
            })
        );
    };

    const addSku = () => {
        const typed = sku.trim().slice(0, 100);
        if (!typed) return;
        apply(
            addItem(latest.current, {
                variantId: null,
                sku: typed,
                name: typed,
                variantName: null,
                qtyScale: 1,
                unit: null,
                listPrice: null,
            })
        );
        setSku('');
    };

    const change = (key: string, patch: Partial<NewOrderLine>) =>
        onChange(latest.current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    const remove = (key: string) => onChange(latest.current.filter((line) => line.key !== key));

    return (
        <SectionCard title={t('orders.new.lines.title')} description={t('orders.new.lines.description')}>
            <div className="grid gap-3 lg:grid-cols-2">
                <Field label={t('orders.new.scan.label')} htmlFor="new-order-scan" hint={handOverNow ? t('orders.new.scan.pieceHint') : undefined}>
                    <div className="flex gap-2">
                        <input
                            id="new-order-scan"
                            {...scan.inputProps}
                            placeholder={t('orders.new.scan.placeholder')}
                            className={inputClass}
                        />
                        <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => scan.submit()}>
                            <Barcode size={16} />
                            {t('orders.new.scan.add')}
                        </MyButton>
                    </div>
                </Field>
                <Field label={t('orders.new.sku.label')} htmlFor="new-order-sku">
                    <div className="flex gap-2">
                        <input
                            id="new-order-sku"
                            value={sku}
                            maxLength={100}
                            autoComplete="off"
                            onChange={(event) => setSku(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    addSku();
                                }
                            }}
                            className={inputClass}
                        />
                        <MyButton type="button" buttonType="secondary" scale="medium" onClick={addSku}>
                            <Plus size={16} />
                            {t('orders.new.sku.add')}
                        </MyButton>
                    </div>
                </Field>
            </div>

            <div className="flex flex-col gap-2">
                <Field label={t('orders.new.search.label')} htmlFor="new-order-search">
                    <div className="flex gap-2">
                        <input
                            id="new-order-search"
                            type="search"
                            value={query}
                            maxLength={64}
                            autoComplete="off"
                            placeholder={t('orders.new.search.placeholder')}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    setPicked(null);
                                    setQ(query.trim());
                                }
                            }}
                            className={inputClass}
                        />
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => {
                                setPicked(null);
                                setQ(query.trim());
                            }}
                        >
                            <MagnifyingGlass size={16} />
                            {t('orders.new.search.go')}
                        </MyButton>
                    </div>
                </Field>
                {products.isFetching && <p className="text-caption text-muted-foreground">{t('orders.new.search.loading')}</p>}
                {products.isError && <OrderNotice tone="danger">{errorText(readOrderError(products.error))}</OrderNotice>}
                {products.isSuccess && q && !picked && (
                    products.data.content.length === 0 ? (
                        <p className="text-caption text-muted-foreground">{t('orders.new.search.none')}</p>
                    ) : (
                        <ul className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
                            {products.data.content.map((item) => (
                                <li key={item.package_id}>
                                    <button
                                        type="button"
                                        onClick={() => setPicked(item.package_id)}
                                        className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-start text-body text-foreground hover:bg-muted"
                                    >
                                        <span className="truncate">{i18nName(item.names, language, item.slug ?? '')}</span>
                                        <span className="shrink-0 text-caption text-muted-foreground">
                                            {t('orders.new.search.variants', { count: item.variant_count ?? 0 })}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )
                )}
                {picked && (
                    <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
                        {product.isLoading && <p className="text-caption text-muted-foreground">{t('orders.new.search.loading')}</p>}
                        {product.isError && <OrderNotice tone="danger">{errorText(readOrderError(product.error))}</OrderNotice>}
                        {product.data && (
                            <>
                                <p className="px-1 text-caption text-muted-foreground">
                                    {t('orders.new.search.pickVariant', { name: productName(product.data, language, '') })}
                                </p>
                                <ul className="flex flex-col divide-y divide-border">
                                    {product.data.variants.map((variant) => (
                                        <li key={variant.package_session_id}>
                                            <button
                                                type="button"
                                                onClick={() => addVariant(product.data as ProductDetail, variant.package_session_id)}
                                                className="flex min-h-12 w-full items-center justify-between gap-2 px-2 text-start text-body text-foreground hover:bg-muted"
                                            >
                                                <span className="flex min-w-0 flex-col">
                                                    <span className="truncate">{variant.name ?? variant.sku ?? '—'}</span>
                                                    {variant.sku && <span className="text-caption text-muted-foreground">{variant.sku}</span>}
                                                </span>
                                                <span className="shrink-0 text-caption tabular-nums text-foreground">
                                                    {variant.price !== null ? formatMoney(variant.price, variant.currency ?? 'INR') : '—'}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                                <MyButton type="button" buttonType="text" scale="small" onClick={() => setPicked(null)}>
                                    {t('orders.new.search.back')}
                                </MyButton>
                            </>
                        )}
                    </div>
                )}
            </div>

            {notice && <OrderNotice tone="danger">{notice}</OrderNotice>}
            {problems.lines && <OrderNotice tone="danger">{t(problems.lines, { count: MAX_ORDER_LINES })}</OrderNotice>}

            {lines.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-body text-muted-foreground">
                    {t('orders.new.lines.empty')}
                </p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {lines.map((line) => {
                        const measured = line.qtyScale > 1;
                        const quantityProblem = problems[`line.${line.key}.quantity`];
                        const priceProblem = problems[`line.${line.key}.price`];
                        return (
                            <li key={line.key} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 flex-col">
                                        <span className="text-body font-medium text-foreground">{line.name || line.sku}</span>
                                        <span className="text-caption text-muted-foreground">
                                            {[line.variantName, line.sku].filter(Boolean).join(' · ')}
                                        </span>
                                        {line.pieceCodes.length > 0 && (
                                            <span className="text-caption text-muted-foreground">
                                                {t('orders.new.lines.pieces', { codes: line.pieceCodes.join(', ') })}
                                            </span>
                                        )}
                                    </div>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        layoutVariant="icon"
                                        scale="medium"
                                        aria-label={t('orders.new.lines.remove', { name: line.name || line.sku || '' })}
                                        onClick={() => remove(line.key)}
                                    >
                                        <Trash size={16} />
                                    </MyButton>
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    <Field
                                        label={measured ? t('orders.new.lines.quantityMeasured', { unit: line.unit || t('orders.units.metre') }) : t('orders.new.lines.quantity')}
                                        htmlFor={`qty-${line.key}`}
                                        error={quantityProblem ? t(quantityProblem) : null}
                                    >
                                        <input
                                            id={`qty-${line.key}`}
                                            inputMode="decimal"
                                            value={line.quantity}
                                            disabled={line.pieceCodes.length > 0}
                                            onChange={(event) => change(line.key, { quantity: event.target.value })}
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label={t('orders.new.lines.listPrice')}>
                                        <p className="flex h-12 items-center text-body tabular-nums text-foreground md:h-9">
                                            {line.listPrice !== null ? formatMoney(line.listPrice) : t('orders.new.lines.priceBySystem')}
                                        </p>
                                    </Field>
                                    <Field
                                        label={t('orders.new.lines.priceOverride')}
                                        htmlFor={`price-${line.key}`}
                                        hint={t('orders.new.lines.priceOverrideHint')}
                                        error={priceProblem ? t(priceProblem) : null}
                                    >
                                        <input
                                            id={`price-${line.key}`}
                                            inputMode="decimal"
                                            value={line.priceOverride}
                                            onChange={(event) => change(line.key, { priceOverride: event.target.value })}
                                            className={inputClass}
                                        />
                                    </Field>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </SectionCard>
    );
}
