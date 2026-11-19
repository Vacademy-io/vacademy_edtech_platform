import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { formatDate } from '@/lib/formatters';
import { PlainSelect, SectionCard, useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { Field, TextAreaField } from '@/routes/commerce/orders/-components/order-ui';
import { boxProblemText, lengthInputText, typedBoxProblem } from '@/routes/commerce/-shared/units';
import { useScanBurst } from '@/routes/commerce/-shared/use-scan-burst';
import { createReceipt } from '../-shared/inventory-api';
import { useInvalidateInventory, useReceipts } from '../-shared/inventory-hooks';
import { RECEIVE_SOURCES, type ReceiptView, type ReceiveSource, type VariantPick } from '../-shared/inventory-types';
import {
    addReceiveItem,
    badReceiptBox,
    type ReceiptLineDraft,
    type ReceiveItem,
    receiveProblem,
    setReceiveQuantity,
} from '../-shared/receive-lines';
import { type StockScan, useStockScan } from '../-shared/use-stock-scan';
import { pickName } from './ItemPicker';
import type { TabProps } from './InventoryPage';
import { ChoiceGroup, InventoryErrorNotice, ItemCell, parseDisplayQuantity, Qty, TOUCH, useInventoryErrorText } from './inventory-ui';
import { PrintLabelsDialog } from './PrintLabelsDialog';
import { QuickAddDialog } from './QuickAddDialog';
import { type ScanMessage, StockScanBox } from './StockScanBox';
import { useInventoryWrite } from './use-inventory-write';

const SOURCE_KEY: Record<ReceiveSource, string> = {
    OWN_SOURCE: 'inventory.receive.sourceOwn',
    OPENING: 'inventory.receive.sourceOpening',
    OTHER: 'inventory.receive.sourceOther',
};

const fromPick = (item: VariantPick, lang: 'hi' | 'en'): ReceiveItem => ({
    package_session_id: item.package_session_id,
    sku: item.sku,
    name: pickName(item, lang),
    variant_name: item.variant_name,
    stock_mode: item.stock_mode,
    stock_policy: item.stock_policy,
    unit: item.unit,
    qty_scale: item.qty_scale,
    qty_step: item.qty_step,
    draft: item.status === 'DRAFT',
});

/**
 * Receive tab (contract §7.3), one place: where the goods came from, the items
 * by scan or search (or quick add for a new one), quantities, one Save. No
 * cost anywhere on this tab. Save posts once: a double tap is held by the
 * button, a retry after no answer reuses the request id.
 */
export function ReceiveTab({ locationId, allPlaces }: TabProps) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    const errorText = useInventoryErrorText();
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('grn');
    const place = locationId as string;

    const [source, setSource] = useState<ReceiveSource | null>(null);
    const [sourceLocationId, setSourceLocationId] = useState('');
    const [note, setNote] = useState('');
    const [lines, setLines] = useState<ReceiptLineDraft[]>([]);
    const [typed, setTyped] = useState<Record<string, string>>({});
    const [message, setMessage] = useState<ScanMessage | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [quickAdd, setQuickAdd] = useState(false);
    const [done, setDone] = useState<ReceiptView | null>(null);
    const [printing, setPrinting] = useState(false);

    const sources = allPlaces.filter((p) => p.is_source && p.id !== place && p.status !== 'INACTIVE');

    const add = (item: ReceiveItem, scanned = false) => {
        const outcome = addReceiveItem(lines, item, { scanned });
        if (outcome.refusal === 'typeLength') {
            // A measured roll: no 0.1 m from a scan; the length box of its line waits for the typed length.
            setLines(outcome.lines);
            setTyped((previous) => ({ ...previous, [item.package_session_id]: previous[item.package_session_id] ?? '' }));
            setMessage({ tone: 'info', text: t('inventory.receive.refusals.typeLength', { item: item.name ?? item.sku ?? '' }) });
            setTimeout(() => document.getElementById(`qty-${item.package_session_id}`)?.focus(), 0);
            return;
        }
        if (outcome.refusal) {
            scan.refuse();
            setMessage({ tone: 'danger', text: t(`inventory.receive.refusals.${outcome.refusal}`) });
            return;
        }
        setLines(outcome.lines);
        setTyped((previous) => {
            const next = { ...previous };
            delete next[item.package_session_id];
            return next;
        });
        setMessage({ tone: 'success', text: t('inventory.receive.added', { item: item.name ?? item.sku ?? '' }) });
    };

    const onScan = (result: StockScan) => {
        if (result.kind === 'VARIANT') {
            const v = result.result.variant;
            add({
                package_session_id: v.package_session_id,
                sku: v.sku,
                name: v.product_name,
                variant_name: v.variant_name,
                stock_mode: v.stock_mode,
                stock_policy: v.stock_policy,
                unit: v.unit,
                qty_scale: v.qty_scale,
                qty_step: 1,
            }, true);
        } else if (result.kind === 'PIECE') {
            scan.refuse();
            setMessage({ tone: 'danger', text: t('inventory.receive.pieceAlready') });
        } else if (result.kind === 'NOT_FOUND') {
            // Keep the text: the search list under the box may know it by name.
            scan.setValue(result.code);
            setMessage({ tone: 'info', text: t('inventory.scan.notFound') });
        } else {
            setMessage({ tone: 'danger', text: errorText(result.error) });
        }
    };
    const scan = useStockScan(onScan, { paused: quickAdd || printing || write.pinOpen || !!done });
    // A label scanned into a quantity box is a scan, not a quantity (W6).
    const burst = useScanBurst((code) => scan.submit(code));

    const typeInto = (line: ReceiptLineDraft, text: string) => {
        setTyped((previous) => ({ ...previous, [line.package_session_id]: text }));
        const base = parseDisplayQuantity(text, line.qty_scale);
        setLines((current) => {
            const outcome = setReceiveQuantity(current, line.package_session_id, base);
            return outcome.refusal ? current : outcome.lines;
        });
    };

    // W5: Save waits while a box is blank or refused (the line holds the last good keystroke).
    const badBox = badReceiptBox(lines, typed);

    const save = async () => {
        setProblem(null);
        setError(null);
        if (badBox) {
            document.getElementById(`qty-${badBox}`)?.focus();
            return;
        }
        const blocked = receiveProblem({ source, sourceLocationId, note, lines });
        if (blocked) return setProblem(t(`inventory.receive.problems.${blocked}`));
        const body = {
            location_id: place,
            source_kind: source as ReceiveSource,
            ...(source === 'OWN_SOURCE' ? { source_location_id: sourceLocationId } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            lines: lines.map((l) => ({ package_session_id: l.package_session_id, quantity: l.quantity })),
        };
        try {
            await write.run({
                scope: `receipt:${place}`,
                body,
                send: (id) => createReceipt({ ...body, client_request_id: id }),
                onDone: (receipt) => {
                    setDone(receipt);
                    void invalidate();
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    /** The sentence under a quantity box: a refused, blank (once typed) or out-of-range quantity. */
    const boxError = (line: ReceiptLineDraft): string | null => {
        const max = (line.stock_mode ?? '').toUpperCase() === 'PIECE' ? 200 : undefined;
        const problem = typedBoxProblem(typed[line.package_session_id], line.qty_scale, { min: 1, max });
        if (!problem) return null;
        return boxProblemText(problem, line.qty_scale, t, t('inventory.receive.refusals.quantityRange'));
    };

    const restart = () => {
        setDone(null);
        setLines([]);
        setTyped({});
        setNote('');
        setMessage(null);
        setProblem(null);
        setError(null);
    };

    if (done) {
        return (
            <div className="flex flex-col gap-4">
                <div
                    role="status"
                    className="flex flex-col gap-4 rounded-lg border border-success-200 bg-success-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                    <div className="flex items-center gap-2 text-subtitle text-success-600">
                        <CheckCircle size={24} weight="fill" />
                        {t('inventory.receive.done', { number: done.receipt_number ?? '' })}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <MyButton type="button" buttonType="primary" scale="large" className={TOUCH} onClick={() => setPrinting(true)}>
                            {t('inventory.receive.printLabels')}
                        </MyButton>
                        <Link
                            to="/commerce/inventory/receipts/$receiptId"
                            params={{ receiptId: done.id }}
                            className="flex h-12 items-center justify-center rounded-md border border-neutral-300 px-4 text-body text-foreground hover:bg-neutral-50"
                        >
                            {t('inventory.receive.openReceipt')}
                        </Link>
                        <MyButton type="button" buttonType="secondary" scale="large" className={TOUCH} onClick={restart}>
                            {t('inventory.receive.more')}
                        </MyButton>
                    </div>
                </div>
                {printing && (
                    <PrintLabelsDialog open onOpenChange={setPrinting} receiptId={done.id} receiptLines={done.lines} locationId={place} />
                )}
                <RecentReceipts locationId={place} />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <SectionCard title={t('inventory.receive.from')} className="lg:col-span-1">
                    <ChoiceGroup<ReceiveSource>
                        name="receive-source"
                        label={t('inventory.receive.sourceLabel')}
                        value={source}
                        onChange={setSource}
                        columns={1}
                        options={RECEIVE_SOURCES.map((value) => ({ value, label: t(SOURCE_KEY[value]) }))}
                    />
                    {source === 'OWN_SOURCE' && (
                        <PlainSelect
                            label={t('inventory.receive.sourcePlace')}
                            value={sourceLocationId}
                            onChange={setSourceLocationId}
                            placeholder={sources.length ? undefined : t('inventory.receive.noSources')}
                            options={sources.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                        />
                    )}
                    <TextAreaField
                        id="receive-note"
                        label={t('inventory.receive.note')}
                        value={note}
                        onChange={setNote}
                        required={source === 'OTHER'}
                        maxLength={500}
                    />
                </SectionCard>
                <SectionCard
                    title={t('inventory.receive.items')}
                    className="lg:col-span-2"
                    actions={
                        <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onClick={() => setQuickAdd(true)}>
                            <Plus size={16} />
                            {t('inventory.receive.quickAdd')}
                        </MyButton>
                    }
                >
                    <StockScanBox
                        scan={scan}
                        message={message}
                        locationId={place}
                        onPick={(item) => add(fromPick(item, lang))}
                    />
                    {lines.length === 0 ? (
                        <p className="text-body text-muted-foreground">{t('inventory.receive.noLines')}</p>
                    ) : (
                        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="receive-lines">
                            {lines.map((line) => {
                                const piece = (line.stock_mode ?? '').toUpperCase() === 'PIECE';
                                const shown =
                                    typed[line.package_session_id] ?? lengthInputText(line.quantity, line.qty_scale);
                                return (
                                    <li
                                        key={line.package_session_id}
                                        className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                                    >
                                        <div className="flex min-w-0 flex-col gap-1">
                                            <ItemCell name={line.name} variant={line.variant_name} sku={line.sku} />
                                            {line.draft && (
                                                <span className="text-caption text-warning-600">{t('inventory.receive.draftItem')}</span>
                                            )}
                                            {piece && (
                                                <span className="text-caption text-muted-foreground">
                                                    {t('inventory.receive.piecesGetLabels')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-end gap-2">
                                            <Field
                                                label={t('inventory.receive.quantity')}
                                                htmlFor={`qty-${line.package_session_id}`}
                                                className="w-32"
                                                error={boxError(line)}
                                            >
                                                <input
                                                    id={`qty-${line.package_session_id}`}
                                                    inputMode={piece || line.qty_scale === 1 ? 'numeric' : 'decimal'}
                                                    value={shown}
                                                    onChange={(event) => typeInto(line, event.target.value)}
                                                    onKeyDown={(event) => {
                                                        const scanned = burst(event);
                                                        if (scanned) return typeInto(line, scanned.restore);
                                                        if (event.key === 'Enter' && badReceiptBox([line], typed) === null) {
                                                            event.preventDefault();
                                                            scan.inputRef.current?.focus();
                                                        }
                                                    }}
                                                    className="h-12 w-full rounded-md border border-neutral-300 bg-background px-3 text-end text-body tabular-nums focus:border-primary-500 focus:outline-none"
                                                />
                                            </Field>
                                            <span className="pb-3 text-caption text-muted-foreground">
                                                <Qty qty={line.quantity} scale={line.qty_scale} unit={line.unit} />
                                            </span>
                                            <button
                                                type="button"
                                                aria-label={t('inventory.receive.remove')}
                                                onClick={() =>
                                                    setLines(lines.filter((l) => l.package_session_id !== line.package_session_id))
                                                }
                                                className="flex size-12 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                                            >
                                                <Trash size={18} />
                                            </button>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </SectionCard>
            </div>
            {problem && (
                <p role="alert" className="text-body text-danger-600">
                    {problem}
                </p>
            )}
            <InventoryErrorNotice error={error} />
            {/* The one primary action; kept left of the assistant button's corner. */}
            <div className="flex justify-start pe-24 sm:justify-end">
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="large"
                    className="h-14 w-full sm:w-auto"
                    onAsyncClick={save}
                    disable={badBox ? true : undefined}
                    loadingText={t('common.saving')}
                    data-testid="receive-save"
                >
                    {t('inventory.receive.save')}
                </MyButton>
            </div>
            <RecentReceipts locationId={place} />
            {quickAdd && (
                <QuickAddDialog
                    open
                    onOpenChange={setQuickAdd}
                    onAdded={(item) => {
                        add(item);
                        setQuickAdd(false);
                    }}
                />
            )}
            {write.dialog}
        </div>
    );
}

function RecentReceipts({ locationId }: { locationId: string }) {
    const { t } = useTranslation('commerce');
    const receipts = useReceipts({ locationId, page: 0, size: 10 });
    return (
        <SectionCard title={t('inventory.receive.recent')}>
            {receipts.isLoading && <CommerceLoadingRows rows={2} />}
            {receipts.isError && <InventoryErrorNotice error={receipts.error} />}
            {receipts.isSuccess && receipts.data.rows.length === 0 && (
                <p className="text-body text-muted-foreground">{t('inventory.receive.noRecent')}</p>
            )}
            <ul className="flex flex-col divide-y divide-border">
                {(receipts.data?.rows ?? []).map((receipt) => (
                    <li key={receipt.id}>
                        <Link
                            to="/commerce/inventory/receipts/$receiptId"
                            params={{ receiptId: receipt.id }}
                            className="flex min-h-12 items-center justify-between gap-3 py-2 hover:bg-neutral-50"
                        >
                            <span className="text-body text-primary-500">{receipt.receipt_number ?? receipt.id}</span>
                            <span className="flex items-center gap-2 text-caption text-muted-foreground">
                                {receipt.received_date ? formatDate(receipt.received_date) : ''}
                                <CommerceStatusChip kind="receipt" value={receipt.status} />
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
        </SectionCard>
    );
}
