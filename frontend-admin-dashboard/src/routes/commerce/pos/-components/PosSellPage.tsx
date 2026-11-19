import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Broom, PauseCircle, Receipt, Tag, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { getInstituteId } from '@/constants/helper';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { todayIso } from '@/routes/commerce/orders/-shared/order-format';
import { buzz, useScanInput } from '@/routes/commerce/orders/-shared/use-scan-input';
import { fetchCatalogue, scanAtRegister } from '../-shared/pos-api';
import {
    type CartEvent,
    type CartExchange,
    type CartState,
    cartGross,
    cartStep,
    emptyCart,
    hasDiscount,
    lineGross,
    pickText,
    toQuoteRequest,
    toSaleRequest,
} from '../-shared/pos-cart';
import {
    indexCatalogue,
    lookupCode,
    readCachedCatalogue,
    replaceCatalogueItem,
    searchCatalogue,
    writeCachedCatalogue,
} from '../-shared/pos-catalogue';
import { LINE_STOCK_CODES, type PosError, REQUOTE_CODES, readPosError } from '../-shared/pos-errors';
import { type HeldBill, dropHeld, holdBill, readHeld, refreshHeldItem, takeHeld } from '../-shared/pos-held-bills';
import { readExchange, useAttemptStore, writeExchange } from '../-shared/pos-session-store';
import {
    invalidatePos,
    posKeys,
    useCatalogue,
    useCatalogueSearch,
    useCreateBillBookEntry,
    useCreateSale,
    useDebounced,
    usePosSettings,
    useQuote,
} from '../-shared/pos-hooks';
import { toPaise } from '../-shared/pos-tenders';
import type { BillBookRequest, CatalogueItem, PosCatalogue, ScanPiece, SessionView } from '../-shared/pos-types';
import { PosAddCreditDialog } from './PosAddCreditDialog';
import { PosCartLines } from './PosCartLines';
import { PosCustomerPanel, customerProblem } from './PosCustomerPanel';
import { type DiscountTarget, PosDiscountDialog } from './PosDiscountDialog';
import { PosHeldBillsSheet } from './PosHeldBillsSheet';
import { PosLengthInput } from './PosLengthInput';
import { PosPayDialog } from './PosPayDialog';
import { PosScanBox } from './PosScanBox';
import { PosSearchResults } from './PosSearchResults';
import { PosShell } from './PosShell';
import { PosTotals } from './PosTotals';
import { PosErrorNotice, PosField, posInputClass, rupees, usePosErrorText, usePosLang } from './pos-ui';

/** P2: the bill (contract §7.3). */
export function PosSellPage({ sessionId, exchange }: { sessionId: string; exchange?: CartExchange | null }) {
    const [heldOpen, setHeldOpen] = useState(false);
    return (
        <PosShell sessionId={sessionId} active="sell" onHeldBills={() => setHeldOpen(true)}>
            {(session, online) => (
                <PosBillingWorkspace
                    mode="sale"
                    session={session}
                    online={online}
                    heldOpen={heldOpen}
                    onHeldOpenChange={setHeldOpen}
                    initialExchange={exchange ?? null}
                />
            )}
        </PosShell>
    );
}

/** Paper bill numbers are digits only (§3.10). */
const BOOK_NUMBER = /^[0-9]{1,9}$/;
export const BILL_BOOK_MAX_AGE_DAYS = 3;
const BILL_BOOK_FIELD_CODES = new Set([
    'BILL_BOOK_NOT_REGISTERED',
    'BILL_BOOK_NUMBER_USED',
    'BILL_DATE_INVALID',
    'PERIOD_LOCKED',
]);

const daysAgoIso = (days: number, now = new Date()) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return todayIso(d);
};

/** The cart as React state with a synchronous view of the latest value (refusals are read at once). */
function useCart(initial: () => CartState) {
    const [cart, setCart] = useState(initial);
    const ref = useRef(cart);
    const apply = useCallback((event: CartEvent) => {
        const result = cartStep(ref.current, event);
        ref.current = result.state;
        setCart(result.state);
        return result;
    }, []);
    return { cart, ref, apply };
}

/**
 * The billing workspace shared by Sell (P2) and the paper bill entry (P5):
 * scan box and lines on the left, customer, server totals and Pay on the
 * right. Pay sits above the bottom 96 px of the right column, clear of the
 * assistant's floating button.
 */
export function PosBillingWorkspace({
    mode,
    session,
    online,
    heldOpen = false,
    onHeldOpenChange,
    initialExchange = null,
}: {
    mode: 'sale' | 'billBook';
    session: SessionView;
    online: boolean;
    heldOpen?: boolean;
    onHeldOpenChange?: (open: boolean) => void;
    initialExchange?: CartExchange | null;
}) {
    const { t } = useTranslation('commerce');
    const lang = usePosLang();
    const access = useCommerceAccess();
    const errorText = usePosErrorText();
    const queryClient = useQueryClient();
    const saleWrite = useCreateSale();
    const bookWrite = useCreateBillBookEntry();
    const instituteId = getInstituteId() ?? '';
    const registerId = session.register.id;
    const isBook = mode === 'billBook';
    // An exchange credit stays on this session's till (this tab) until a bill uses it or the
    // cashier removes it: a reload, Clear bill or a trip to another screen keeps it.
    const { cart, ref: cartRef, apply } = useCart(() => {
        const exchange = isBook ? null : (initialExchange ?? readExchange(instituteId, session.id));
        return exchange ? { ...emptyCart(), exchange } : emptyCart();
    });
    useEffect(() => {
        if (!isBook) writeExchange(instituteId, session.id, cart.exchange);
    }, [cart.exchange, instituteId, session.id, isBook]);

    // The sale (or paper bill) whose answer never came keeps its request id across the Pay dialog
    // closing, changed tenders and a reload, so a retry can never make a second bill.
    const attempts = useAttemptStore(instituteId, session.id, 'pos');
    const attemptScope = isBook ? 'billBook' : 'sale';
    const maybeSaved = attempts.isUncertain(attemptScope);

    // ── Catalogue: the server's copy, else this device's copy (offline). ──
    const catalogueQuery = useCatalogue(registerId);
    const [cached] = useState(() => readCachedCatalogue(instituteId, registerId));
    useEffect(() => {
        if (catalogueQuery.data) writeCachedCatalogue(instituteId, registerId, catalogueQuery.data);
    }, [catalogueQuery.data, instituteId, registerId]);
    const catalogue = catalogueQuery.data ?? cached;
    const index = useMemo(() => indexCatalogue(catalogue?.items ?? []), [catalogue]);

    // ── Dialogs (the scan box pauses while one is open). ──
    const [payOpen, setPayOpen] = useState(false);
    const [discountTarget, setDiscountTarget] = useState<DiscountTarget | null>(null);
    const [lengthRef, setLengthRef] = useState<string | null>(null);
    /** The open length box is for a line just added (a ref: Save and the close run in one tick). */
    const lengthIsNew = useRef(false);
    const [clearOpen, setClearOpen] = useState(false);
    const [removeCreditOpen, setRemoveCreditOpen] = useState(false);
    const [addCreditOpen, setAddCreditOpen] = useState(false);
    const [held, setHeld] = useState<HeldBill[]>([]);
    const [message, setMessage] = useState<{ tone: 'danger' | 'info'; text: string } | null>(null);
    const allowLeave = useRef(false);

    // ── Bill book (P5) fields. ──
    const [bookNumber, setBookNumber] = useState('');
    const [bookDate, setBookDate] = useState(() => todayIso());
    const [bookError, setBookError] = useState<{ field: 'number' | 'date'; text: string } | null>(null);
    const [bookTouched, setBookTouched] = useState(false);

    const blocker = useBlocker({
        shouldBlockFn: () => cartRef.current.lines.length > 0 && !allowLeave.current,
        enableBeforeUnload: () => cartRef.current.lines.length > 0,
        withResolver: true,
    });
    const blocked = blocker?.status === 'blocked';

    const paused =
        payOpen ||
        !!discountTarget ||
        !!lengthRef ||
        clearOpen ||
        heldOpen ||
        blocked ||
        removeCreditOpen ||
        addCreditOpen;

    const say = (tone: 'danger' | 'info', text: string) => {
        setMessage({ tone, text });
        if (tone === 'danger') buzz();
    };

    const addItem = (item: CatalogueItem) => {
        // W8: a paper bill records what was already sold by hand; the sale step does not apply to it.
        const result = apply({ type: 'ADD_VARIANT', item: isBook ? { ...item, qty_step: 1 } : item });
        if (result.refusal) {
            say('danger', t(`pos.cart.${result.refusal}`));
            return;
        }
        if (result.openLengthFor) {
            // A label scanned while another roll's box waited for its first length (W6): that
            // line never got a length, so it leaves the bill as a closed box would take it off.
            if (lengthRef && lengthRef !== result.openLengthFor && lengthIsNew.current) {
                apply({ type: 'REMOVE_LINE', lineRef: lengthRef });
            }
            setLengthRef(result.openLengthFor);
            lengthIsNew.current = !!result.openLengthIsNew;
        }
        say('info', t('pos.sell.added', { name: pickText(item.names, lang) || item.sku || '' }));
    };

    const addPiece = (item: CatalogueItem, piece: ScanPiece) => {
        const result = apply({ type: 'ADD_PIECE', item, piece });
        if (result.refusal) {
            say('danger', t(`pos.cart.${result.refusal}`));
            return;
        }
        say('info', t('pos.sell.added', { name: `${pickText(item.names, lang) || item.sku || ''} · ${piece.code}` }));
    };

    const scanRef = useRef<ReturnType<typeof useScanInput> | null>(null);
    const onScan = async (code: string) => {
        setMessage(null);
        const local = lookupCode(index, code);
        if (local) {
            addItem(local);
            return;
        }
        const pieceLike = /^p/i.test(code);
        const searchable = !pieceLike && searchCatalogue(index, code, lang).length > 0;
        if (!online) {
            if (pieceLike) say('danger', t('pos.sell.pieceNeedsInternet'));
            else if (searchable) scanRef.current?.setValue(code);
            else say('danger', t('pos.errors.CODE_NOT_FOUND'));
            return;
        }
        try {
            const answer = await scanAtRegister(registerId, code);
            if (!answer) {
                if (searchable) scanRef.current?.setValue(code);
                else say('danger', t('pos.errors.CODE_NOT_FOUND'));
                return;
            }
            if (answer.kind === 'PIECE' && answer.piece) addPiece(answer.item, answer.piece);
            else {
                addItem(answer.item);
                // The server knows a code this device's catalogue copy does not: fetch it again.
                void queryClient.invalidateQueries({ queryKey: posKeys.catalogue(registerId) });
            }
        } catch (error) {
            say('danger', errorText(readPosError(error)));
        }
    };
    const scan = useScanInput((code) => void onScan(code), { paused });
    scanRef.current = scan;

    // ── Typed search. ──
    const typed = scan.value.trim();
    const debouncedTyped = useDebounced(typed, 250);
    const truncated = !!catalogue?.truncated;
    const serverSearch = useCatalogueSearch(registerId, debouncedTyped, truncated && online);
    const results = useMemo(() => {
        if (!typed) return [];
        if (truncated && serverSearch.data) return serverSearch.data.items.slice(0, 30);
        return searchCatalogue(index, typed, lang);
    }, [typed, truncated, serverSearch.data, index, lang]);

    // ── Server price of the bill. ──
    const quoteBody = useMemo(
        () => (cart.lines.length > 0 ? toQuoteRequest(cart, session.id) : null),
        [cart, session.id]
    );
    const debouncedQuote = useDebounced(quoteBody, 300);
    const quote = useQuote(debouncedQuote);
    const quoteKey = JSON.stringify(quoteBody);
    const quoteCurrent =
        !!quote.data && !quote.isPlaceholderData && JSON.stringify(debouncedQuote) === quoteKey && !quote.isFetching;
    const quoteData = cart.lines.length > 0 ? (quote.data ?? null) : null;
    const quoteLines = useMemo(
        () => new Map((quoteData?.lines ?? []).map((line) => [line.line_ref, line])),
        [quoteData]
    );

    // ── A QUANTITY_STEP: this till holds an old sale step for the item (a held bill, the device's
    // catalogue copy). Read the item again from the server, once per item and step, and give the
    // bill, the held bills and both catalogue copies its step, so the length box uses it. ──
    const stepRefreshed = useRef(new Set<string>());
    const refreshStep = async (lineRef: string | null | undefined) => {
        if (isBook || !lineRef || !online) return;
        const line = cartRef.current.lines.find((l) => l.lineRef === lineRef);
        if (!line) return;
        const key = `${line.variantId}:${line.qtyStep}`;
        if (stepRefreshed.current.has(key)) return;
        stepRefreshed.current.add(key);
        let fresh: CatalogueItem | null = null;
        try {
            const answer = line.sku ? await scanAtRegister(registerId, line.sku) : null;
            if (answer?.item.variant_id === line.variantId) fresh = answer.item;
            if (!fresh) {
                const all = await fetchCatalogue(registerId);
                queryClient.setQueryData<PosCatalogue>(posKeys.catalogue(registerId), all);
                fresh = all.items.find((entry) => entry.variant_id === line.variantId) ?? null;
            }
        } catch {
            // Not read now: the quote keeps the line marked, and the next QUANTITY_STEP of a new step tries again.
            stepRefreshed.current.delete(key);
            return;
        }
        if (!fresh) return;
        const item = fresh;
        apply({ type: 'REFRESH_ITEM', item });
        refreshHeldItem(instituteId, registerId, item);
        queryClient.setQueryData<PosCatalogue>(posKeys.catalogue(registerId), (old) =>
            old ? replaceCatalogueItem(old, item) : old
        );
        const copy = readCachedCatalogue(instituteId, registerId);
        if (copy) writeCachedCatalogue(instituteId, registerId, replaceCatalogueItem(copy, item));
    };
    const refreshStepRef = useRef(refreshStep);
    refreshStepRef.current = refreshStep;

    // A quote that names a moved price or an unsellable line marks the line.
    useEffect(() => {
        if (!quote.data || quote.isPlaceholderData) return;
        quote.data.changes.forEach((change) => {
            // Only a price change moves the echoed price; UNAVAILABLE entries come in `unavailable` too.
            if ((change.type === null || change.type === 'PRICE_CHANGED') && change.unit_price !== null) {
                apply({ type: 'SET_PRICE', lineRef: change.line_ref, unitPrice: change.unit_price });
            }
        });
        // W8: a paper bill is recorded as written; the sale step is not its refusal.
        const refused = new Map(
            quote.data.unavailable
                .filter((u) => !(isBook && u.reason === 'QUANTITY_STEP'))
                .map((u) => [u.line_ref, u.reason])
        );
        cartRef.current.lines.forEach((line) => {
            const reason = refused.get(line.lineRef);
            if (reason !== undefined) {
                apply({ type: 'MARK_LINE', lineRef: line.lineRef, mark: { code: reason || 'UNAVAILABLE', source: 'quote' } });
                if (reason === 'QUANTITY_STEP') void refreshStepRef.current(line.lineRef);
            } else if (line.mark?.source === 'quote') {
                apply({ type: 'MARK_LINE', lineRef: line.lineRef, mark: null });
            }
        });
    }, [quote.data, quote.isPlaceholderData, apply, cartRef, isBook]);

    const settings = usePosSettings(!access.isManager);
    // The quote names the credit when this cashier may use it; without a number it needs a manager's
    // PIN (asked when the bill is paid) and the amount found with the return counts meanwhile.
    const creditNeedsPin = !!cart.exchange && !!quoteData && quoteCurrent && quoteData.exchange_credit === null;
    const credit = cart.exchange ? (quoteData?.exchange_credit ?? cart.exchange.credit) : 0;
    const total = quoteData?.totals.total ?? 0;
    const toPay = Math.max(0, (toPaise(total) - toPaise(credit)) / 100);
    const custProblem = customerProblem(cart.customer);
    const reasonMissing = hasDiscount(cart) && cart.discountReason.trim() === '';
    const unavailable = (quoteData?.unavailable.length ?? 0) > 0;

    const bookNumberOk = BOOK_NUMBER.test(bookNumber);
    const minDate = daysAgoIso(BILL_BOOK_MAX_AGE_DAYS);
    const maxDate = todayIso();
    const bookDateOk = /^\d{4}-\d{2}-\d{2}$/.test(bookDate) && bookDate >= minDate && bookDate <= maxDate;
    const bookOk = mode === 'sale' || (bookNumberOk && bookDateOk);

    const ready =
        cart.lines.length > 0 && quoteCurrent && !unavailable && !custProblem && !reasonMissing && bookOk;

    const openPay = () => {
        setBookTouched(true);
        if (!bookOk) return;
        setPayOpen(true);
    };

    // ── What the server refused: re-quote, mark the line, or a field. ──
    const onRefused = (error: PosError): boolean => {
        const code = error.code ?? '';
        if (code === 'QUANTITY_STEP') void refreshStep(error.lineRef);
        if (REQUOTE_CODES.has(code)) {
            void queryClient.invalidateQueries({ queryKey: posKeys.catalogue(registerId) });
            void quote.refetch();
            if (error.lineRef) apply({ type: 'MARK_LINE', lineRef: error.lineRef, mark: { code: 'PRICE_CHANGED' } });
            toast.error(errorText(error));
            return true;
        }
        if (LINE_STOCK_CODES.has(code)) {
            const named = (needle: string | null | undefined) =>
                !!needle && error.message.toLowerCase().includes(needle.toLowerCase());
            const line =
                cartRef.current.lines.find((l) => l.lineRef === error.lineRef) ??
                cartRef.current.lines.find((l) => named(l.sku) || l.pieceCodes.some((c) => named(c)));
            if (line) apply({ type: 'MARK_LINE', lineRef: line.lineRef, mark: { code, time: error.time } });
            toast.error(errorText(error));
            return true;
        }
        if (mode === 'billBook' && BILL_BOOK_FIELD_CODES.has(code)) {
            setBookError({
                field: code === 'BILL_DATE_INVALID' || code === 'PERIOD_LOCKED' ? 'date' : 'number',
                text: errorText(error),
            });
            return true;
        }
        if (code === 'SESSION_NOT_OPEN' || code === 'SESSION_NOT_YOURS') {
            void invalidatePos(queryClient);
            toast.error(errorText(error));
            return true;
        }
        return false;
    };

    /** After a bill is made (its exchange credit is used up), or the cashier cleared it (the credit stays). */
    const newBill = (afterSale = true) => {
        apply({ type: 'CLEAR', keepExchange: !afterSale });
        setMessage(null);
        if (mode === 'billBook') {
            setBookNumber('');
            setBookError(null);
            setBookTouched(false);
        }
        setTimeout(() => scan.refocus(), 0);
    };

    const hold = () => {
        if (cartRef.current.lines.length === 0) return false;
        const saved = holdBill(instituteId, registerId, cartRef.current, new Date(), session.id);
        if (!saved) {
            toast.error(t('pos.held.failed'));
            return false;
        }
        apply({ type: 'CLEAR', keepExchange: true });
        toast.success(t('pos.held.saved'));
        return true;
    };

    useEffect(() => {
        if (heldOpen) setHeld(readHeld(instituteId, registerId, { sessionId: session.id }));
    }, [heldOpen, instituteId, registerId, session.id]);

    const recall = (bill: HeldBill) => {
        if (cartRef.current.lines.length > 0 && !window.confirm(t('pos.held.replaceConfirm'))) return;
        const taken = takeHeld(instituteId, registerId, bill.id, { sessionId: session.id });
        if (taken) apply({ type: 'RESTORE', state: taken.cart });
        onHeldOpenChange?.(false);
    };

    const lengthLine = cart.lines.find((line) => line.lineRef === lengthRef) ?? null;

    return (
        <div className="flex min-h-0 flex-1">
            {/* Left: scan, search, lines. */}
            <section className="flex min-h-0 w-3/5 flex-col gap-3 p-4">
                <PosScanBox
                    inputProps={scan.inputProps}
                    onClear={() => {
                        scan.setValue('');
                        scan.refocus();
                    }}
                    message={message}
                />
                {!catalogue && catalogueQuery.isError && <PosErrorNotice error={catalogueQuery.error} />}
                {typed && !/^p\d/i.test(typed) && (
                    <PosSearchResults
                        items={results}
                        loading={truncated && serverSearch.isFetching}
                        onPick={(item) => {
                            addItem(item);
                            scan.setValue('');
                            scan.refocus();
                        }}
                    />
                )}
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PosCartLines
                        lines={cart.lines}
                        quoteLines={quoteLines}
                        onQuantity={(line, quantity) => {
                            const result = apply({ type: 'SET_QUANTITY', lineRef: line.lineRef, quantity });
                            if (result.refusal) say('danger', t(`pos.cart.${result.refusal}`));
                        }}
                        onLength={(line) => {
                            setLengthRef(line.lineRef);
                            lengthIsNew.current = false;
                        }}
                        onRemovePiece={(line, pieceId) => apply({ type: 'REMOVE_PIECE', lineRef: line.lineRef, pieceId })}
                        onRemoveLine={(line) => apply({ type: 'REMOVE_LINE', lineRef: line.lineRef })}
                        onDiscount={(line) =>
                            setDiscountTarget({
                                kind: 'line',
                                lineRef: line.lineRef,
                                name: pickText(line.names, lang) || line.sku || '',
                                gross: lineGross(line),
                                current: line.lineDiscount,
                            })
                        }
                    />
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                    {!isBook && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="large" className="h-12"
                            disable={cart.lines.length === 0}
                            onClick={() => hold()}
                        >
                            <PauseCircle size={20} className="me-2" />
                            {t('pos.sell.hold')}
                        </MyButton>
                    )}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="large" className="h-12"
                        disable={cart.lines.length === 0 && !maybeSaved}
                        onClick={() => setClearOpen(true)}
                    >
                        <Broom size={20} className="me-2" />
                        {t('pos.sell.clear')}
                    </MyButton>
                </div>
            </section>

            {/* Right: who, money, pay. */}
            <aside className="flex min-h-0 w-2/5 flex-col border-s border-border bg-card">
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
                    {isBook && (
                        <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
                            <p className="text-subtitle font-medium text-foreground">{t('pos.billBook.title')}</p>
                            <p className="text-caption text-muted-foreground">{t('pos.billBook.hint')}</p>
                            <div className="grid grid-cols-2 gap-3">
                                <PosField
                                    label={t('pos.billBook.number')}
                                    htmlFor="pos-book-number"
                                    required
                                    error={
                                        bookError?.field === 'number'
                                            ? bookError.text
                                            : bookTouched && !bookNumberOk
                                              ? t('pos.billBook.numberInvalid')
                                              : null
                                    }
                                >
                                    <input
                                        id="pos-book-number"
                                        inputMode="numeric"
                                        maxLength={9}
                                        className={posInputClass}
                                        value={bookNumber}
                                        onChange={(event) => {
                                            setBookNumber(event.target.value.replace(/\D/g, ''));
                                            setBookError(null);
                                        }}
                                    />
                                </PosField>
                                <PosField
                                    label={t('pos.billBook.date')}
                                    htmlFor="pos-book-date"
                                    required
                                    error={
                                        bookError?.field === 'date'
                                            ? bookError.text
                                            : bookTouched && !bookDateOk
                                              ? t('pos.billBook.dateInvalid', { days: BILL_BOOK_MAX_AGE_DAYS })
                                              : null
                                    }
                                >
                                    <input
                                        id="pos-book-date"
                                        type="date"
                                        min={minDate}
                                        max={maxDate}
                                        className={posInputClass}
                                        value={bookDate}
                                        onChange={(event) => {
                                            setBookDate(event.target.value);
                                            setBookError(null);
                                        }}
                                    />
                                </PosField>
                            </div>
                        </section>
                    )}
                    {cart.exchange && (
                        <OrderNotice
                            tone="info"
                            action={
                                <button
                                    type="button"
                                    aria-label={t('pos.sell.removeExchange')}
                                    onClick={() => setRemoveCreditOpen(true)}
                                    className="flex size-12 items-center justify-center rounded-md hover:bg-info-100"
                                >
                                    <X size={18} />
                                </button>
                            }
                        >
                            <p>
                                {t('pos.returns.credit', {
                                    amount: rupees(credit),
                                    number: cart.exchange.number ?? '',
                                })}
                            </p>
                            {creditNeedsPin && (
                                <p className="text-caption" data-testid="pos-credit-needs-pin">
                                    {t('pos.sell.creditNeedsPin')}
                                </p>
                            )}
                        </OrderNotice>
                    )}
                    {!isBook && !cart.exchange && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="large"
                            className="h-12 w-full"
                            data-testid="pos-add-credit"
                            disable={!online}
                            onClick={() => setAddCreditOpen(true)}
                        >
                            <Receipt size={20} className="me-2" />
                            {t('pos.sell.addCredit')}
                        </MyButton>
                    )}
                    {maybeSaved && !payOpen && (
                        <OrderNotice tone="warning">
                            <p data-testid="pos-maybe-saved">{t('pos.sell.maybeSaved')}</p>
                            <Link
                                to="/commerce/pos/$sessionId/bills"
                                params={{ sessionId: session.id }}
                                className="text-body font-medium text-primary-500 underline"
                            >
                                {t('pos.sell.checkBills')}
                            </Link>
                        </OrderNotice>
                    )}
                    <PosCustomerPanel
                        sessionId={session.id}
                        customer={cart.customer}
                        online={online}
                        onChange={(customer) => apply({ type: 'SET_CUSTOMER', customer })}
                    />
                    <PosTotals
                        quote={quoteData}
                        updating={cart.lines.length > 0 && (!quoteCurrent || quote.isFetching)}
                        credit={credit}
                    />
                    {quote.isError && cart.lines.length > 0 && <PosErrorNotice error={quote.error} />}
                    {!access.isManager && quoteData?.needs_approval.includes('POS_DISCOUNT') && (
                        <OrderNotice tone="warning">
                            <p>{t('pos.sell.discountNeedsPin')}</p>
                        </OrderNotice>
                    )}
                    {reasonMissing && (
                        <OrderNotice tone="warning">
                            <p>{t('pos.sell.reasonMissing')}</p>
                        </OrderNotice>
                    )}
                </div>
                <div className="flex shrink-0 flex-col gap-2 border-t border-border p-4 pb-24">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="large"
                        className="h-12 w-full"
                        disable={cart.lines.length === 0}
                        onClick={() =>
                            setDiscountTarget({ kind: 'bill', gross: cartGross(cart), current: cart.billDiscount })
                        }
                    >
                        <Tag size={20} className="me-2" />
                        {cart.billDiscount
                            ? t('pos.sell.billDiscountSet', {
                                  value:
                                      cart.billDiscount.kind === 'PERCENT'
                                          ? `${cart.billDiscount.value}%`
                                          : rupees(cart.billDiscount.value),
                              })
                            : t('pos.sell.billDiscount')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="large"
                        className="h-14 w-full text-title"
                        data-testid="pos-pay"
                        disable={!online || !ready}
                        onClick={openPay}
                    >
                        {isBook
                            ? t('pos.billBook.save', { amount: rupees(toPay) })
                            : t('pos.sell.pay', { amount: rupees(toPay) })}
                    </MyButton>
                </div>
            </aside>

            <PosPayDialog
                open={payOpen}
                onOpenChange={setPayOpen}
                total={total}
                roundOff={quoteData?.totals.round_off ?? 0}
                credit={credit}
                ready={ready}
                online={online}
                instituteId={instituteId}
                registerId={registerId}
                heading={isBook ? t('pos.billBook.title') : undefined}
                buildBody={(tenders, remainder) => {
                    const body = toSaleRequest(cartRef.current, session.id, tenders, !isBook, remainder);
                    if (!isBook) return body;
                    const book: BillBookRequest = { ...body, book_number: bookNumber, document_date: bookDate };
                    return book;
                }}
                submit={(body) =>
                    isBook ? bookWrite.mutateAsync([body as BillBookRequest]) : saleWrite.mutateAsync([body])
                }
                onRefused={onRefused}
                onNewBill={() => newBill(true)}
                attempts={attempts}
                attemptScope={attemptScope}
                onTotalMoved={() => toast.error(t('pos.errors.PRICE_CHANGED'))}
            />
            <PosAddCreditDialog
                open={addCreditOpen}
                onOpenChange={setAddCreditOpen}
                sessionId={session.id}
                online={online}
                onPick={(exchange) => apply({ type: 'SET_EXCHANGE', exchange })}
            />
            <MyDialog
                heading={t('pos.sell.removeExchangeTitle')}
                open={removeCreditOpen}
                onOpenChange={setRemoveCreditOpen}
                dialogWidth="max-w-md"
                footer={
                    <div className="flex w-full justify-end gap-2">
                        <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => setRemoveCreditOpen(false)}>
                            {t('pos.leave.stay')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="large"
                            className="h-12"
                            data-testid="pos-remove-credit-confirm"
                            onClick={() => {
                                apply({ type: 'SET_EXCHANGE', exchange: null });
                                setRemoveCreditOpen(false);
                            }}
                        >
                            {t('pos.sell.removeExchange')}
                        </MyButton>
                    </div>
                }
            >
                <p className="text-body text-foreground">
                    {t('pos.sell.removeExchangeConfirm', { number: cart.exchange?.number ?? '' })}
                </p>
            </MyDialog>
            <PosDiscountDialog
                target={discountTarget}
                reason={cart.discountReason}
                limitPercent={access.isManager ? null : (settings.data?.cashier_discount_percent ?? null)}
                onOpenChange={(open) => !open && setDiscountTarget(null)}
                onSave={(value) => {
                    if (!discountTarget) return;
                    if (discountTarget.kind === 'line') {
                        const result = apply({
                            type: 'SET_LINE_DISCOUNT',
                            lineRef: discountTarget.lineRef,
                            amount: value ? value.amount : 0,
                        });
                        if (result.refusal) say('danger', t(`pos.cart.${result.refusal}`));
                    } else {
                        const result = apply({
                            type: 'SET_BILL_DISCOUNT',
                            discount: value ? { kind: value.kind, value: value.amount } : null,
                        });
                        if (result.refusal) say('danger', t(`pos.cart.${result.refusal}`));
                    }
                    if (value) apply({ type: 'SET_DISCOUNT_REASON', reason: value.reason });
                }}
            />
            {lengthLine && (
                <PosLengthInput
                    open={!!lengthLine}
                    onOpenChange={(open) => {
                        if (open) return;
                        // Closed without a length: a line the scan just added leaves the bill again.
                        if (lengthIsNew.current) apply({ type: 'REMOVE_LINE', lineRef: lengthLine.lineRef });
                        lengthIsNew.current = false;
                        setLengthRef(null);
                    }}
                    name={pickText(lengthLine.names, lang) || lengthLine.sku || ''}
                    unit={lengthLine.unit}
                    qtyScale={lengthLine.qtyScale}
                    qtyStep={lengthLine.qtyStep}
                    quantity={lengthLine.quantity}
                    unitPrice={lengthLine.unitPrice}
                    lineDiscount={lengthLine.lineDiscount}
                    onHand={lengthLine.onHand}
                    onSave={(stored) => {
                        const result = apply({ type: 'SET_QUANTITY', lineRef: lengthLine.lineRef, quantity: stored });
                        if (result.refusal) {
                            // n8: the box stays open on its line; nothing is saved.
                            say('danger', t(`pos.cart.${result.refusal}`));
                            return false;
                        }
                        // Saved: the line stays even when the box closes right after.
                        lengthIsNew.current = false;
                        return true;
                    }}
                    onScan={(code) => void onScan(code)}
                />
            )}
            {onHeldOpenChange && (
                <PosHeldBillsSheet
                    open={heldOpen}
                    onOpenChange={onHeldOpenChange}
                    bills={held}
                    onRecall={recall}
                    onDrop={(bill) => setHeld(dropHeld(instituteId, registerId, bill.id))}
                />
            )}
            <MyDialog
                heading={t('pos.sell.clear')}
                open={clearOpen}
                onOpenChange={setClearOpen}
                dialogWidth="max-w-md"
                footer={
                    <div className="flex w-full justify-end gap-2">
                        <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => setClearOpen(false)}>
                            {t('pos.leave.stay')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="large" className="h-12"
                            onClick={() => {
                                // The cashier checked the bills: an unanswered payment is forgotten with the bill.
                                attempts.clear(attemptScope);
                                newBill(false);
                                setClearOpen(false);
                            }}
                        >
                            {t('pos.sell.clear')}
                        </MyButton>
                    </div>
                }
            >
                <p className="text-body text-foreground">{t('pos.sell.clearConfirm')}</p>
                {maybeSaved && <p className="mt-2 text-body text-danger-600">{t('pos.sell.clearMaybeSaved')}</p>}
                {cart.exchange && <p className="mt-2 text-body text-neutral-600">{t('pos.sell.clearKeepsCredit')}</p>}
            </MyDialog>
            <MyDialog
                heading={t('pos.sell.leave')}
                open={blocked}
                onOpenChange={(open) => !open && blocker?.reset?.()}
                dialogWidth="max-w-md"
                footer={
                    <div className="flex w-full flex-wrap justify-end gap-2">
                        <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => blocker?.reset?.()}>
                            {t('pos.leave.stay')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="large" className="h-12"
                            onClick={() => {
                                allowLeave.current = true;
                                blocker?.proceed?.();
                            }}
                        >
                            {t('pos.leave.leave')}
                        </MyButton>
                        {/* Never hold a bill whose payment is open or on its way: if it is saved, recalling it would sell the goods twice. */}
                        {!isBook && !payOpen && (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="large" className="h-12"
                                onClick={() => {
                                    if (hold()) {
                                        allowLeave.current = true;
                                        blocker?.proceed?.();
                                    }
                                }}
                            >
                                {t('pos.sell.hold')}
                            </MyButton>
                        )}
                    </div>
                }
            >
                <p className="text-body text-foreground">{t('pos.leave.description')}</p>
            </MyDialog>
        </div>
    );
}
