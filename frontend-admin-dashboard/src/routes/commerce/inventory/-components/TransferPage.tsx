import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Printer, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { formatDate, formatDateTime } from '@/lib/formatters';
import { SectionCard, useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { OrderNotice, TextAreaField } from '@/routes/commerce/orders/-components/order-ui';
import { lengthInputText } from '@/routes/commerce/-shared/units';
import { cancelTransfer, updateTransfer } from '../-shared/inventory-api';
import {
    assignedLocations,
    useInvalidateInventory,
    useInventoryAccess,
    useInventoryLocations,
    useTransfer,
} from '../-shared/inventory-hooks';
import { SHORTFALL_REASONS, type TransferView } from '../-shared/inventory-types';
import {
    applyDraft,
    type DraftEvent,
    type DraftState,
    draftFromView,
    linesWithoutLength,
    toTransferLines,
} from '../-shared/transfer-lines';
import { type StockScan, useStockScan } from '../-shared/use-stock-scan';
import { DispatchDialog } from './DispatchDialog';
import { pickName } from './ItemPicker';
import {
    ConfirmDialog,
    InventoryErrorNotice,
    ItemCell,
    LengthProblem,
    parseDisplayQuantity,
    placeLabel,
    Qty,
    TOUCH,
    useInventoryErrorText,
} from './inventory-ui';
import { ReceiveTransferPanel } from './ReceiveTransferPanel';
import { type ScanMessage, StockScanBox } from './StockScanBox';
import { useChallanPrint } from './transfer-ui';
import { useInventoryWrite } from './use-inventory-write';

/** What this person may do with the transfer: the server's `next_actions`, else by status and place. */
export function transferActions(view: TransferView, myPlaceIds: ReadonlySet<string>): Set<string> {
    if (view.next_actions.length > 0) return new Set(view.next_actions);
    const atFrom = !!view.from && myPlaceIds.has(view.from.id);
    const atTo = !!view.to && myPlaceIds.has(view.to.id);
    const out = new Set<string>();
    if (view.status === 'DRAFT' && atFrom) ['EDIT', 'CANCEL', 'DISPATCH'].forEach((a) => out.add(a));
    if (view.status === 'DISPATCHED' && atTo) out.add('RECEIVE');
    if (view.status === 'DISPATCHED' || view.status === 'RECEIVED') out.add('PRINT_CHALLAN');
    return out;
}

/** I3 (contract §7.3): a transfer — draft editor, dispatch, receive, challan. */
export function TransferPage() {
    const { t } = useTranslation('commerce');
    const { transferId } = useParams({ from: '/commerce/inventory/transfers/$transferId/' });
    const query = useTransfer(transferId);
    return (
        <CommercePage
            navId="commerce-inventory"
            title={query.data?.transfer_number ?? t('inventory.transfers.title')}
            backTo={{ to: '/commerce/inventory', label: t('inventory.title') }}
        >
            {query.isLoading && <CommerceLoadingRows rows={4} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {query.data && <TransferBody view={query.data} />}
        </CommercePage>
    );
}

function TransferBody({ view }: { view: TransferView }) {
    const { t } = useTranslation('commerce');
    const access = useInventoryAccess();
    const locations = useInventoryLocations();
    const mine = new Set(assignedLocations(locations.data).map((p) => p.id));
    const actions = transferActions(view, mine);
    const challan = useChallanPrint();
    const canPrint = actions.has('PRINT_CHALLAN') && view.status !== 'DRAFT' && view.status !== 'CANCELLED';

    return (
        <div className="flex flex-col gap-4">
            <SectionCard
                title={`${placeLabel(view.from)} → ${placeLabel(view.to)}`}
                actions={
                    canPrint ? (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className={TOUCH}
                            onAsyncClick={() => challan.print(view)}
                            data-testid="print-challan"
                        >
                            <Printer size={16} />
                            {t('inventory.transfers.printChallan')}
                        </MyButton>
                    ) : undefined
                }
            >
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <Fact label={t('inventory.transfers.status')}>
                        <CommerceStatusChip kind="transfer" value={view.status} />
                    </Fact>
                    <Fact label={t('inventory.transfers.challan')}>
                        {view.document_number ?? '—'}
                        {view.document_type === 'EXTERNAL_INVOICE' && (
                            <span className="block text-caption text-muted-foreground">{t('inventory.dispatch.externalInvoice')}</span>
                        )}
                    </Fact>
                    <Fact label={t('inventory.transfers.dispatched')}>{view.dispatched_at ? formatDateTime(view.dispatched_at) : '—'}</Fact>
                    <Fact label={t('inventory.transfers.received')}>{view.received_at ? formatDateTime(view.received_at) : '—'}</Fact>
                    {view.document_date && <Fact label={t('inventory.transfers.documentDate')}>{formatDate(view.document_date)}</Fact>}
                    {view.eway_bill_no && <Fact label={t('inventory.transfers.ewayBill')}>{view.eway_bill_no}</Fact>}
                </dl>
                {view.overdue && <OrderNotice tone="warning">{t('inventory.transfers.overdue', { days: 7 })}</OrderNotice>}
                {view.warnings.includes('DESTINATION_INACTIVE') && (
                    <OrderNotice tone="warning">{t('inventory.transfers.warnings.DESTINATION_INACTIVE')}</OrderNotice>
                )}
                {view.status === 'DRAFT' && view.warnings.includes('NO_CHALLAN_SERIES') && (
                    <OrderNotice tone="warning">
                        {access.isManager
                            ? t('inventory.transfers.warnings.NO_CHALLAN_SERIES')
                            : t('inventory.transfers.askManagerSeries')}
                    </OrderNotice>
                )}
                {view.status === 'DRAFT' && view.gstin_differs && (
                    <OrderNotice tone="warning">{t('inventory.transfers.needsDocument')}</OrderNotice>
                )}
                <InventoryErrorNotice error={challan.error} />
            </SectionCard>
            {view.status === 'DRAFT' && actions.has('EDIT') ? (
                <DraftEditor
                    view={view}
                    // Different GSTINs: only a manager records the document and dispatches.
                    canDispatch={actions.has('DISPATCH') && (!view.gstin_differs || access.isManager)}
                    canCancel={actions.has('CANCEL')}
                />
            ) : view.status === 'DISPATCHED' && actions.has('RECEIVE') ? (
                <ReceiveTransferPanel view={view} />
            ) : (
                <TransferLinesView view={view} />
            )}
        </div>
    );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted-foreground">{label}</dt>
            <dd className="text-body text-foreground">{children}</dd>
        </div>
    );
}

/** The read view of the lines: sent, received and why short. */
export function TransferLinesView({ view }: { view: TransferView }) {
    const { t } = useTranslation('commerce');
    return (
        <SectionCard title={t('inventory.transfers.lines')}>
            <ul className="flex flex-col divide-y divide-border">
                {view.lines.map((line) => (
                    <li key={line.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <ItemCell name={line.item_name} variant={line.variant_name} sku={line.sku} code={line.piece_code} />
                        <span className="flex flex-wrap items-center gap-3 text-caption">
                            <span>
                                {t('inventory.transfers.sent')}: <Qty qty={line.qty_sent} scale={line.qty_scale} unit={line.unit} />
                            </span>
                            {line.qty_received !== null && (
                                <span>
                                    {t('inventory.transfers.receivedQty')}:{' '}
                                    <Qty qty={line.qty_received} scale={line.qty_scale} unit={line.unit} />
                                </span>
                            )}
                            {line.shortfall_reason && (SHORTFALL_REASONS as readonly string[]).includes(line.shortfall_reason) && (
                                <span className="text-danger-600">{t(`inventory.shortfall.${line.shortfall_reason}`)}</span>
                            )}
                        </span>
                    </li>
                ))}
            </ul>
            {view.receive_note && <p className="text-body text-muted-foreground">{view.receive_note}</p>}
        </SectionCard>
    );
}

/** The draft at the source: scan or pick lines, quantities, note; Save, Cancel, Dispatch. */
function DraftEditor({ view, canDispatch, canCancel }: { view: TransferView; canDispatch: boolean; canCancel: boolean }) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    const navigate = useNavigate();
    const errorText = useInventoryErrorText();
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('trf');
    const [draft, setDraft] = useState<DraftState>(() => draftFromView(view));
    const [note, setNote] = useState(view.note ?? '');
    const [typed, setTyped] = useState<Record<string, string>>({});
    const [dirty, setDirty] = useState(false);
    const [message, setMessage] = useState<ScanMessage | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [dispatching, setDispatching] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    useEffect(() => {
        if (!dirty) {
            setDraft(draftFromView(view));
            setNote(view.note ?? '');
        }
        // A fresh view from the server replaces the draft unless the person is editing it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);

    const askLength = (key: string, name: string) => {
        setTyped((previous) => ({ ...previous, [key]: previous[key] ?? '' }));
        setMessage({ tone: 'info', text: t('inventory.transferLines.typeLength', { item: name }) });
        setTimeout(() => document.getElementById(`transfer-qty-${key}`)?.focus(), 0);
    };

    const apply = (event: DraftEvent) => {
        const outcome = applyDraft(draft, event);
        if (outcome.refusal === 'typeLength' && event.type === 'ADD_VARIANT') {
            // A measured roll: the line waits at 0 for its typed length; a repeat scan reopens the box.
            setDraft(outcome.state);
            setDirty(true);
            askLength(`v:${event.item.package_session_id}`, event.item.product_name ?? event.item.sku ?? '');
            return false;
        }
        if (outcome.refusal) {
            scan.refuse();
            setMessage({ tone: 'danger', text: t(`inventory.transferLines.${outcome.refusal}`) });
            return false;
        }
        setDraft(outcome.state);
        setDirty(true);
        return true;
    };

    const onScan = (result: StockScan) => {
        if (result.kind === 'PIECE' && result.result.piece) {
            const v = result.result.variant;
            if (apply({ type: 'ADD_PIECE', item: { ...v, qty_step: 1 }, piece: result.result.piece })) {
                setMessage({ tone: 'success', text: t('inventory.receive.added', { item: result.result.piece.code }) });
            }
        } else if (result.kind === 'VARIANT' || result.kind === 'PIECE') {
            const v = result.result.variant;
            if (apply({ type: 'ADD_VARIANT', item: v })) {
                setMessage({ tone: 'success', text: t('inventory.receive.added', { item: v.product_name ?? v.sku ?? '' }) });
            }
        } else if (result.kind === 'NOT_FOUND') {
            scan.setValue(result.code);
            setMessage({ tone: 'info', text: t('inventory.scan.notFound') });
        } else {
            setMessage({ tone: 'danger', text: errorText(result.error) });
        }
    };
    const scan = useStockScan(onScan, { paused: dispatching || cancelling || write.pinOpen });

    const body = { ...(note.trim() ? { note: note.trim() } : {}), lines: toTransferLines(draft) };

    const save = async (): Promise<boolean> => {
        setError(null);
        const waiting = linesWithoutLength(draft)[0];
        if (waiting) {
            askLength(waiting.key, waiting.name ?? waiting.sku ?? '');
            return false;
        }
        let saved = false;
        try {
            await write.run({
                scope: `update:${view.id}`,
                body,
                send: (id) => updateTransfer(view.id, { ...body, client_request_id: id }),
                onDone: () => {
                    saved = true;
                    setDirty(false);
                    setTyped({});
                    void invalidate();
                },
            });
        } catch (e) {
            setError(e);
        }
        return saved;
    };

    const cancel = async () => {
        await write.run({
            scope: `cancel:${view.id}`,
            body: {},
            send: (id) => cancelTransfer(view.id, { client_request_id: id }),
            onDone: () => {
                void invalidate();
                void navigate({ to: '/commerce/inventory', search: { tab: 'transfers' } });
            },
        });
    };

    return (
        <SectionCard title={t('inventory.transfers.lines')}>
            <StockScanBox
                scan={scan}
                message={message}
                locationId={draft.fromLocationId}
                showOnHand
                onPick={(item) => {
                    if (apply({ type: 'ADD_VARIANT', item: { ...item, product_name: pickName(item, lang) } })) {
                        setMessage({ tone: 'success', text: t('inventory.receive.added', { item: pickName(item, lang) }) });
                    }
                }}
            />
            {draft.lines.length === 0 ? (
                <p className="text-body text-muted-foreground">{t('inventory.transfers.noLines')}</p>
            ) : (
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="transfer-lines">
                    {draft.lines.map((line) => (
                        <li key={line.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                            <ItemCell name={line.name} variant={line.variant_name} sku={line.sku} code={line.piece_code} />
                            <div className="flex items-center gap-2">
                                {line.piece_id ? (
                                    <span className="text-caption text-muted-foreground">{t('inventory.transfers.onePiece')}</span>
                                ) : (
                                    <div className="flex flex-col items-end gap-1">
                                        <input
                                            id={`transfer-qty-${line.key}`}
                                            aria-label={t('inventory.transfers.quantity')}
                                            inputMode={line.qty_scale > 1 ? 'decimal' : 'numeric'}
                                            value={typed[line.key] ?? lengthInputText(line.quantity, line.qty_scale)}
                                            onChange={(event) => {
                                                const text = event.target.value;
                                                setTyped({ ...typed, [line.key]: text });
                                                const base = parseDisplayQuantity(text, line.qty_scale);
                                                if (base !== null) {
                                                    const outcome = applyDraft(draft, { type: 'SET_QUANTITY', key: line.key, quantity: base });
                                                    if (!outcome.refusal) {
                                                        setDraft(outcome.state);
                                                        setDirty(true);
                                                    }
                                                }
                                            }}
                                            className="h-12 w-28 rounded-md border border-neutral-300 bg-background px-3 text-end text-body tabular-nums focus:border-primary-500 focus:outline-none"
                                        />
                                        <LengthProblem text={typed[line.key]} scale={line.qty_scale} />
                                    </div>
                                )}
                                <button
                                    type="button"
                                    aria-label={t('inventory.receive.remove')}
                                    onClick={() => apply({ type: 'REMOVE', key: line.key })}
                                    className="flex size-12 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                                >
                                    <Trash size={18} />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <TextAreaField
                id="transfer-note"
                label={t('inventory.transfers.note')}
                value={note}
                onChange={(value) => {
                    setNote(value);
                    setDirty(true);
                }}
                maxLength={500}
            />
            <InventoryErrorNotice error={error} />
            <div className="flex flex-col gap-2 pe-0 sm:flex-row sm:justify-end sm:pe-24">
                {canCancel && (
                    <MyButton type="button" buttonType="text" scale="medium" className={TOUCH} onClick={() => setCancelling(true)}>
                        {t('inventory.transfers.cancel')}
                    </MyButton>
                )}
                <MyButton type="button" buttonType="secondary" scale="large" className={TOUCH} disable={dirty ? undefined : true} onAsyncClick={async () => void (await save())}>
                    {t('common.save')}
                </MyButton>
                {canDispatch && (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="large"
                        className="h-14"
                        onAsyncClick={async () => {
                            if (dirty && !(await save())) return;
                            setDispatching(true);
                        }}
                        data-testid="open-dispatch"
                    >
                        {t('inventory.transfers.dispatch')}
                    </MyButton>
                )}
            </div>
            {dispatching && <DispatchDialog open onOpenChange={setDispatching} view={view} />}
            <ConfirmDialog
                open={cancelling}
                onOpenChange={setCancelling}
                heading={t('inventory.transfers.cancel')}
                confirmLabel={t('inventory.transfers.cancelConfirm')}
                onConfirm={cancel}
                danger
            >
                <p>{t('inventory.transfers.cancelQuestion')}</p>
            </ConfirmDialog>
            {write.dialog}
        </SectionCard>
    );
}
