import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link, useBlocker } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowSquareOut, Barcode, CheckCircle, Circle, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { COMMERCE_ROLE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { cn } from '@/lib/utils';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceErrorState,
    CommerceNoAccessCard,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import {
    fetchInvoicePdfUrl,
    fetchOrders,
    packOrder,
    scanCode,
} from '@/routes/commerce/orders/-shared/order-api';
import { type OrderError, readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import {
    codToCollect,
    formatQuantity,
    paymentLabel,
} from '@/routes/commerce/orders/-shared/order-format';
import { useOrderDetail, useOrderWrite } from '@/routes/commerce/orders/-shared/order-hooks';
import type {
    StaffOrderDetail,
    StaffOrderRow,
} from '@/routes/commerce/orders/-shared/order-types';
import {
    type PackEvent,
    type PackLine,
    type PackSession,
    initPackSession,
    isComplete,
    lineNoFromServer,
    packReducer,
    pieceCodeFromServer,
    toPackRequest,
} from '@/routes/commerce/orders/-shared/pack-session';
import { useRequestId } from '@/routes/commerce/orders/-shared/request-id';
import { buzz, useScanInput } from '@/routes/commerce/orders/-shared/use-scan-input';
import { ShipDialog } from './dialogs/ShipDialog';
import {
    OrderErrorAlert,
    OrderNotice,
    inputClass,
    money,
    useOrderErrorHandler,
    useOrderErrorText,
} from './order-ui';

/**
 * Pack station (contract §5.3): find the order by its packing slip or number,
 * scan every item (or tick counted items), then Pack — which issues the
 * invoice. Built for the packing table: a scanner types into the focused box,
 * and on a phone the box sits at the top and Pack at the bottom.
 */

const { STORE_MANAGER: M, WAREHOUSE_STAFF: W, ACCOUNTANT: AC } = COMMERCE_ROLE;

const MAX_WEIGHT_GRAMS = 1_000_000;

export function PackStationPage({ initialOrderId }: { initialOrderId?: string }) {
    const { t } = useTranslation('commerce');
    const [dirty, setDirty] = useState(false);

    // Leaving with scans in progress asks first.
    useBlocker({
        shouldBlockFn: () => dirty && !window.confirm(t('orders.pack.leaveConfirm')),
        enableBeforeUnload: () => dirty,
    });

    return (
        <CommercePage
            navId="commerce-orders"
            title={t('orders.packStation')}
            description={t('orders.pack.description')}
            backTo={{ to: '/commerce/orders', label: t('orders.backToDesk') }}
        >
            <PackStationBody initialOrderId={initialOrderId} onDirtyChange={setDirty} />
        </CommercePage>
    );
}

/** The role rule of the screen (M, W, ADMIN); an accountant's deep link gets "no access". */
export function PackStationBody({
    initialOrderId,
    onDirtyChange,
}: {
    initialOrderId?: string;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const access = useCommerceAccess();
    if (!access.isResolved) return null;
    if (!access.canOpen('commerce-orders') || !access.hasAnyRole([M, W])) {
        return <CommerceNoAccessCard className="mt-8" />;
    }
    return <PackStationContent initialOrderId={initialOrderId} onDirtyChange={onDirtyChange} />;
}

type FindResult =
    | { kind: 'pick'; rows: StaffOrderRow[] }
    | { kind: 'elsewhere'; row: StaffOrderRow }
    | { kind: 'notFound'; text: string }
    | { kind: 'error'; error: OrderError };

type SessionAction = PackEvent | { type: 'INIT'; detail: StaffOrderDetail } | { type: 'CLEAR' };

const sessionReducer = (state: PackSession | null, action: SessionAction): PackSession | null => {
    if (action.type === 'INIT') return initPackSession(action.detail);
    if (action.type === 'CLEAR') return null;
    return state ? packReducer(state, action) : state;
};

export function PackStationContent({
    initialOrderId,
    onDirtyChange,
}: {
    initialOrderId?: string;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const errorText = useOrderErrorText();
    const handleError = useOrderErrorHandler();

    const [orderId, setOrderId] = useState<string | null>(initialOrderId ?? null);
    const [find, setFind] = useState<FindResult | null>(null);
    const [finding, setFinding] = useState(false);
    const [session, dispatch] = useReducer(sessionReducer, null);
    const [scanError, setScanError] = useState<OrderError | null>(null);
    const [packError, setPackError] = useState<OrderError | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [weight, setWeight] = useState('');
    const [done, setDone] = useState<StaffOrderDetail | null>(null);
    const [shipOpen, setShipOpen] = useState(false);
    const [invoiceBusy, setInvoiceBusy] = useState(false);

    const detailQuery = useOrderDetail(orderId, !done);
    const detail = detailQuery.data ?? null;
    const canPack = !!detail && detail.next_actions.includes('PACK');

    const pack = useOrderWrite(packOrder);
    const { idFor, reset: resetRequestId } = useRequestId('p');

    // A new order (or the first load of one) starts a fresh session.
    const initFor = useRef<string | null>(null);
    useEffect(() => {
        if (!detail || done) return;
        if (initFor.current === detail.order.id) return;
        initFor.current = detail.order.id;
        dispatch({ type: 'INIT', detail });
        setWeight(detail.shipments.find((s) => s.status !== 'CANCELLED')?.weight_grams?.toString() ?? '');
    }, [detail, done]);

    const dirty = !done && !!session && session.lines.some((line) => line.packed > 0);
    useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

    // A refused scan buzzes once per outcome.
    const lastSeq = useRef(0);
    useEffect(() => {
        const last = session?.last;
        if (!last || last.seq === lastSeq.current) return;
        lastSeq.current = last.seq;
        if (!last.ok) buzz();
    }, [session?.last]);

    const findOrder = useCallback(async (text: string) => {
        setFind(null);
        setFinding(true);
        try {
            const toPack = await fetchOrders({ search: text, queue: 'TO_PACK', page: 0, pageSize: 5 });
            const exact = toPack.orders.filter(
                (row) => row.order_number.toUpperCase() === text.toUpperCase()
            );
            const only = exact[0];
            if (exact.length === 1 && only) {
                setOrderId(only.id);
                return;
            }
            if (toPack.orders.length > 0) {
                setFind({ kind: 'pick', rows: exact.length > 1 ? exact : toPack.orders });
                return;
            }
            const anywhere = await fetchOrders({ search: text, page: 0, pageSize: 5 });
            const match =
                anywhere.orders.find((row) => row.order_number.toUpperCase() === text.toUpperCase()) ??
                (anywhere.orders.length === 1 ? anywhere.orders[0] : undefined);
            setFind(match ? { kind: 'elsewhere', row: match } : { kind: 'notFound', text });
        } catch (error) {
            setFind({ kind: 'error', error: readOrderError(error) });
        } finally {
            setFinding(false);
        }
    }, []);

    const scanItem = useCallback(async (code: string) => {
        setScanError(null);
        try {
            const result = await scanCode(code);
            dispatch(result ? { type: 'SCAN_RESULT', result } : { type: 'SCAN_NOT_FOUND' });
        } catch (raw) {
            const error = readOrderError(raw);
            if (error.code === 'FEATURE_DISABLED') {
                dispatch({ type: 'SCAN_UNAVAILABLE' });
                setNotice(t('orders.pack.scanOff'));
                return;
            }
            setScanError(error);
            buzz();
        }
    }, [t]);

    const packing = !!orderId && !done && canPack && !!session;
    const scan = useScanInput((code) => {
        if (packing) void scanItem(code);
        else if (!orderId) void findOrder(code);
    }, { paused: shipOpen });

    const reloadAndReset = useCallback(
        async (message?: string) => {
            initFor.current = null;
            dispatch({ type: 'CLEAR' });
            resetRequestId();
            if (message) setNotice(message);
            const fresh = await detailQuery.refetch();
            if (fresh.data) {
                initFor.current = fresh.data.order.id;
                dispatch({ type: 'INIT', detail: fresh.data });
            }
        },
        [detailQuery, resetRequestId]
    );

    const weightNumber = weight.trim() === '' ? null : Number(weight);
    const weightInvalid =
        weightNumber !== null &&
        (!Number.isInteger(weightNumber) || weightNumber < 1 || weightNumber > MAX_WEIGHT_GRAMS);
    const complete = !!session && isComplete(session);

    const submitPack = async () => {
        if (!session || !complete || weightInvalid) return;
        setPackError(null);
        setNotice(null);
        const payload = toPackRequest(session, '', weightNumber ?? undefined);
        const body = { ...payload, client_request_id: idFor(payload) };
        try {
            const answer = await pack.mutateAsync(body);
            resetRequestId();
            setDone(answer);
        } catch (raw) {
            const error = handleError(raw, {
                close: () => void reloadAndReset(),
                resetRequestId,
            });
            if (!error) return;
            if (error.code === 'PIECE_SCAN_REQUIRED') {
                const lineNo = lineNoFromServer(error.message);
                if (lineNo !== null) dispatch({ type: 'SERVER_PIECE_SCAN_REQUIRED', lineNo });
            } else if (error.code === 'PIECE_NOT_AVAILABLE') {
                const known = session.lines.flatMap((line) => line.pieceCodes);
                dispatch({
                    type: 'SERVER_PIECE_NOT_AVAILABLE',
                    code: pieceCodeFromServer(error.message, known),
                });
            } else if (error.code === 'NOT_FULLY_PACKED') {
                void reloadAndReset();
            }
            setPackError(error);
        }
    };

    const nextOrder = () => {
        initFor.current = null;
        dispatch({ type: 'CLEAR' });
        setOrderId(null);
        setDone(null);
        setFind(null);
        setScanError(null);
        setPackError(null);
        setNotice(null);
        setWeight('');
        resetRequestId();
        setTimeout(() => scan.refocus(), 0);
    };

    const downloadInvoice = async (invoiceId: string) => {
        setInvoiceBusy(true);
        try {
            const url = await fetchInvoicePdfUrl(invoiceId);
            if (url) window.open(url, '_blank', 'noopener');
            else toast.error(t('orders.errors.generic'));
        } catch (raw) {
            toast.error(errorText(readOrderError(raw)));
        } finally {
            setInvoiceBusy(false);
        }
    };

    const printSlip = (id: string) =>
        window.open(`/commerce/orders/print?ids=${encodeURIComponent(id)}`, '_blank', 'noopener');

    // ─── Done ───
    if (done) {
        return (
            <div className="flex flex-col gap-4">
                <OrderNotice tone="success">
                    <p className="text-subtitle font-medium">{t('orders.pack.done')}</p>
                    <p>{t('orders.pack.doneOrder', { number: done.order.order_number })}</p>
                </OrderNotice>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {access.hasAnyRole([M, W]) && done.next_actions.includes('SHIP') && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="large"
                            className="h-12 w-full sm:w-auto"
                            onClick={() => setShipOpen(true)}
                        >
                            {t('orders.pack.shipNow')}
                        </MyButton>
                    )}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="large"
                        className="h-12 w-full sm:w-auto"
                        onClick={() => printSlip(done.order.id)}
                    >
                        {t('orders.actions.PRINT_SLIP')}
                    </MyButton>
                    {access.hasAnyRole([M, AC]) && done.invoice_id && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="large"
                            className="h-12 w-full sm:w-auto"
                            disable={invoiceBusy}
                            onClick={() => void downloadInvoice(done.invoice_id as string)}
                        >
                            {t('orders.actions.DOWNLOAD_INVOICE')}
                        </MyButton>
                    )}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="large"
                        className="h-12 w-full sm:w-auto"
                        onClick={nextOrder}
                    >
                        {t('orders.pack.next')}
                    </MyButton>
                </div>
                <ShipDialog
                    open={shipOpen}
                    onOpenChange={(open) => {
                        setShipOpen(open);
                        if (!open) setTimeout(() => scan.refocus(), 0);
                    }}
                    detail={done}
                />
            </div>
        );
    }

    const scanBox = (
        <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-background py-3 lg:static lg:border-0 lg:py-0">
            <label htmlFor="pack-scan" className="flex items-center gap-2 text-body font-medium text-foreground">
                <Barcode size={20} />
                {packing ? t('orders.pack.scanItems') : t('orders.pack.scanPrompt')}
            </label>
            <div className="flex items-stretch gap-2">
                <div className="min-w-0 flex-1">
                    <MyInput
                        id="pack-scan"
                        ref={scan.inputRef}
                        input={scan.value}
                        onChangeFunction={(event) => scan.setValue(event.target.value)}
                        onKeyDown={scan.inputProps.onKeyDown}
                        inputMode="text"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        enterKeyHint="go"
                        maxLength={scan.inputProps.maxLength}
                        inputPlaceholder={packing ? t('orders.pack.scanItems') : t('orders.pack.scanPrompt')}
                        aria-label={packing ? t('orders.pack.scanItems') : t('orders.pack.scanPrompt')}
                        className="h-12 text-subtitle sm:w-full"
                        disabled={!!orderId && !packing}
                    />
                </div>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="large"
                    className="h-12 shrink-0"
                    disable={!!orderId && !packing}
                    onClick={() => scan.submit()}
                >
                    {t('orders.pack.add')}
                </MyButton>
            </div>
        </div>
    );

    // ─── Step 1: find the order ───
    if (!orderId) {
        return (
            <div className="flex flex-col gap-4">
                {scanBox}
                {finding && <p className="text-body text-muted-foreground">{t('orders.pack.finding')}</p>}
                {find?.kind === 'error' && <OrderErrorAlert error={find.error} />}
                {find?.kind === 'notFound' && (
                    <OrderNotice tone="warning">
                        <p>{t('orders.pack.notFound', { text: find.text })}</p>
                    </OrderNotice>
                )}
                {find?.kind === 'elsewhere' && (
                    <OrderNotice
                        tone="warning"
                        action={
                            <Link
                                to="/commerce/orders/$orderId"
                                params={{ orderId: find.row.id }}
                                className="text-body text-primary-500 hover:underline"
                            >
                                {t('orders.pack.openOrder')}
                            </Link>
                        }
                    >
                        <p>{t('orders.pack.elsewhere', { number: find.row.order_number })}</p>
                        <div>
                            <CommerceStatusChip kind="order" value={find.row.status} />
                        </div>
                    </OrderNotice>
                )}
                {find?.kind === 'pick' && (
                    <div className="flex flex-col gap-2">
                        <p className="text-body text-muted-foreground">{t('orders.pack.pick')}</p>
                        <ul className="flex flex-col gap-2">
                            {find.rows.map((row) => (
                                <li key={row.id}>
                                    <button
                                        type="button"
                                        onClick={() => setOrderId(row.id)}
                                        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-start hover:border-primary-500"
                                    >
                                        <span className="flex flex-col">
                                            <span className="text-body font-medium text-foreground">
                                                {row.order_number}
                                            </span>
                                            <span className="text-caption text-muted-foreground">
                                                {row.customer_name ?? '—'}
                                            </span>
                                        </span>
                                        <CommerceStatusChip kind="order" value={row.status} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        );
    }

    // ─── Step 2: load ───
    if (detailQuery.isLoading || (!detail && !detailQuery.isError)) {
        return (
            <div className="flex flex-col gap-3" aria-busy="true">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-32 w-full" />
            </div>
        );
    }
    if (detailQuery.isError || !detail) {
        return (
            <div className="flex flex-col gap-3">
                <CommerceErrorState
                    message={errorText(readOrderError(detailQuery.error))}
                    onRetry={() => void detailQuery.refetch()}
                />
                <MyButton type="button" buttonType="secondary" scale="medium" onClick={nextOrder}>
                    {t('orders.pack.changeOrder')}
                </MyButton>
            </div>
        );
    }

    const header = (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-title font-medium text-foreground">{detail.order.order_number}</span>
                <CommerceStatusChip kind="order" value={detail.order.status} />
                <Link
                    to="/commerce/orders/$orderId"
                    params={{ orderId: detail.order.id }}
                    className="flex items-center gap-1 text-caption text-primary-500 hover:underline"
                >
                    {t('orders.pack.openOrder')}
                    <ArrowSquareOut size={14} />
                </Link>
            </div>
            <MyButton type="button" buttonType="secondary" scale="medium" onClick={nextOrder}>
                {t('orders.pack.changeOrder')}
            </MyButton>
        </div>
    );

    if (!canPack) {
        return (
            <div className="flex flex-col gap-4">
                {header}
                {notice && <OrderNotice tone="info">{notice}</OrderNotice>}
                <OrderNotice tone="warning">
                    <p>{t('orders.pack.cannotPack')}</p>
                </OrderNotice>
            </div>
        );
    }

    if (!session) {
        return <Skeleton className="h-32 w-full" />;
    }

    const last = session.last;
    const row = detail.order;
    const isCod = (row.payment_method ?? '').toUpperCase() === 'COD';

    const packButton = (extra: string) => (
        <MyButton
            type="button"
            buttonType="primary"
            scale="large"
            className={cn('h-12 w-full', extra)}
            disable={!complete || weightInvalid || pack.isPending}
            onAsyncClick={submitPack}
            loadingText={t('orders.pack.packing')}
        >
            {t('orders.actions.PACK')}
        </MyButton>
    );

    return (
        <div className="flex flex-col gap-4">
            {header}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
                    {scanBox}
                    {notice && <OrderNotice tone="info">{notice}</OrderNotice>}
                    {last && !last.ok && (
                        <OrderNotice tone="danger">
                            <p>
                                {t(`orders.pack.scan.${last.refusal}`, {
                                    status: last.status ?? '',
                                })}
                            </p>
                        </OrderNotice>
                    )}
                    {scanError && <OrderErrorAlert error={scanError} />}
                    <ul className="flex flex-col gap-2" aria-label={t('orders.pack.items')}>
                        {session.lines.map((line) => (
                            <PackLineRow
                                key={line.lineId}
                                line={line}
                                flash={!!last && last.ok && last.lineId === line.lineId}
                                tickable={line.mode !== 'PIECE' || session.scanUnavailable}
                                dispatch={dispatch}
                            />
                        ))}
                    </ul>
                    {packError && <OrderErrorAlert error={packError} currency={row.currency} />}
                </div>
                <aside className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                    <dl className="flex flex-col gap-2 text-body">
                        <div className="flex flex-col">
                            <dt className="text-caption text-muted-foreground">{t('orders.pack.customer')}</dt>
                            <dd className="text-foreground">{row.customer_name ?? '—'}</dd>
                        </div>
                        <div className="flex flex-col">
                            <dt className="text-caption text-muted-foreground">{t('orders.pack.city')}</dt>
                            <dd className="text-foreground">
                                {[detail.shipping_address?.city, detail.shipping_address?.pincode]
                                    .filter(Boolean)
                                    .join(' ') || '—'}
                            </dd>
                        </div>
                        <div className="flex flex-col gap-1">
                            <dt className="text-caption text-muted-foreground">{t('orders.pack.payment')}</dt>
                            <dd className="flex flex-wrap items-center gap-2 text-foreground">
                                {paymentLabel(row, t)}
                                <CommerceStatusChip kind="paymentStatus" value={row.payment_status} />
                            </dd>
                        </div>
                    </dl>
                    {isCod && (
                        <p className="rounded-md bg-warning-50 p-2 text-subtitle font-medium text-warning-600">
                            {t('orders.pack.collectOnDelivery', {
                                amount: money(codToCollect(row), row.currency),
                            })}
                        </p>
                    )}
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="pack-weight" className="text-caption text-muted-foreground">
                            {t('orders.ship.weight')} ({t('orders.optional')})
                        </label>
                        <input
                            id="pack-weight"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={MAX_WEIGHT_GRAMS}
                            step={1}
                            value={weight}
                            onChange={(event) => setWeight(event.target.value)}
                            aria-invalid={weightInvalid || undefined}
                            className={cn(inputClass, 'h-12')}
                        />
                        {weightInvalid && (
                            <p role="alert" className="text-caption text-danger-600">
                                {t('orders.pack.weightInvalid')}
                            </p>
                        )}
                    </div>
                    {!complete && (
                        <p className="text-caption text-muted-foreground">{t('orders.pack.incomplete')}</p>
                    )}
                    {packButton('hidden lg:flex')}
                </aside>
            </div>
            <div className="sticky bottom-0 z-10 border-t border-border bg-background py-3 lg:hidden">
                {packButton('')}
            </div>
        </div>
    );
}

function PackLineRow({
    line,
    flash,
    tickable,
    dispatch,
}: {
    line: PackLine;
    flash: boolean;
    tickable: boolean;
    dispatch: (event: PackEvent) => void;
}) {
    const { t } = useTranslation('commerce');
    const full = line.packed >= line.needed;
    const tickId = `pack-tick-${line.lineId}`;
    return (
        <li
            data-testid={`pack-line-${line.lineNo}`}
            data-mode={line.mode}
            className={cn(
                'flex flex-col gap-3 rounded-lg border p-3 transition-colors md:flex-row md:flex-wrap md:items-center',
                flash ? 'border-success-200 bg-success-50' : 'border-border bg-card'
            )}
        >
            <div className="flex min-w-0 flex-1 items-start gap-2">
                {full ? (
                    <CheckCircle size={24} weight="fill" className="shrink-0 text-success-600" />
                ) : (
                    <Circle size={24} className="shrink-0 text-muted-foreground" />
                )}
                <div className="flex min-w-0 flex-col">
                    <span className="text-body font-medium text-foreground">{line.name}</span>
                    <span className="text-caption text-muted-foreground">
                        {[line.variantLabel, line.sku].filter(Boolean).join(' · ')}
                    </span>
                    {line.mode === 'PIECE' && !full && (
                        <span className="text-caption text-warning-600">{t('orders.pack.pieceLine')}</span>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-4">
                <span className="flex flex-col text-end">
                    <span className="text-caption text-muted-foreground">{t('orders.pack.packedOfNeeded')}</span>
                    <span data-testid={`pack-count-${line.lineNo}`} className="text-title font-medium tabular-nums text-foreground">
                        {formatQuantity(line.packed, line.qtyScale, line.unit, t)} /{' '}
                        {formatQuantity(line.needed, line.qtyScale, line.unit, t)}
                    </span>
                </span>
                {tickable && (
                    <label htmlFor={tickId} className="flex min-h-12 items-center gap-2 text-body text-foreground">
                        <Checkbox
                            id={tickId}
                            className="size-6"
                            checked={full}
                            onCheckedChange={(checked) =>
                                dispatch(
                                    checked === true
                                        ? { type: 'TICK', lineId: line.lineId }
                                        : { type: 'UNTICK', lineId: line.lineId }
                                )
                            }
                        />
                        {t('orders.pack.allPacked')}
                    </label>
                )}
            </div>
            {line.pieceCodes.length > 0 && (
                <ul className="flex flex-wrap gap-2 md:basis-full" aria-label={t('orders.pack.pieces')}>
                    {line.pieceCodes.map((code) => (
                        <li
                            key={code}
                            className="flex items-center gap-1 rounded-md border border-border bg-background ps-2 text-caption text-foreground"
                        >
                            {code}
                            <button
                                type="button"
                                className="flex size-12 items-center justify-center text-muted-foreground hover:text-danger-600 md:size-8"
                                aria-label={t('orders.pack.removePiece', { code })}
                                onClick={() => dispatch({ type: 'REMOVE_PIECE', code })}
                            >
                                <X size={14} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}
