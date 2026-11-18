import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bank, CheckCircle, CreditCard, Money, Printer, QrCode, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ManagerApproval } from '@/routes/commerce/-shared/commerce-types';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { useRequestId } from '@/routes/commerce/orders/-shared/request-id';
import { readAutoPrint, writeAutoPrint } from '../-shared/pos-catalogue';
import { type PosError, readPosError } from '../-shared/pos-errors';
import { printReceipt } from '../-shared/pos-receipt';
import {
    type TenderRow,
    change,
    creditApplied,
    newTenderRow,
    remaining,
    tenderProblem,
    toPaise,
    toTenderRequest,
} from '../-shared/pos-tenders';
import {
    EXCHANGE_REMAINDER_METHODS,
    type PosTenderMode,
    REFERENCE_REQUIRED_MODES,
    type SaleAnswer,
    type SaleRequest,
    type TenderRequest,
} from '../-shared/pos-types';
import { usePinGate } from './PosPinGate';
import { PosReceipt80, PrintPortal } from './PosReceipt80';
import { PosField, posInputClass, rupees, sanitizeAmount, usePosErrorText } from './pos-ui';

export interface PosPayDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The server's total of the bill (the last quote). */
    total: number;
    /** Exchange credit counted before any tender. */
    credit: number;
    /** The quote matches the bill on screen and the bill is complete. */
    ready: boolean;
    online: boolean;
    instituteId: string;
    registerId: string;
    heading?: string;
    /** The request body without `client_request_id` and `approval`. */
    buildBody: (tenders: TenderRequest[], remainder: { method: string; reference: string | null } | null) => SaleRequest;
    submit: (body: SaleRequest) => Promise<SaleAnswer>;
    /**
     * A refusal the screen handles (re-quote, mark a line, a field error).
     * Return true to close the dialog; false keeps it open with the sentence.
     */
    onRefused: (error: PosError) => boolean;
    /** After a bill is made: the screen clears the bill for the next customer. */
    onNewBill: () => void;
}

const MODE_ICON: Record<string, typeof Money> = {
    CASH: Money,
    UPI: QrCode,
    CARD: CreditCard,
    OTHER: Bank,
};

/** Notes a buyer often hands over for `amount`: the next 100, 500 and 2000 above it. */
export function cashSuggestions(amount: number): number[] {
    if (!(amount > 0)) return [];
    const out = new Set<number>();
    [100, 500, 2000].forEach((note) => {
        const up = Math.ceil(amount / note) * note;
        if (up > amount) out.add(up);
    });
    return [...out].sort((a, b) => a - b).slice(0, 3);
}

/**
 * Taking the money (contract §7.3 Pay dialog). Tenders are split freely
 * (cash + UPI…), Remaining and Change are worked out in paise, and Confirm
 * posts the sale ONCE: a second tap while it is on its way does nothing, and
 * a retry after a network failure sends the same body with the same
 * `client_request_id`, so the server replays instead of making a second bill.
 * A manager's PIN, when the server asks for one, goes with that same request.
 */
export function PosPayDialog({
    open,
    onOpenChange,
    total,
    credit,
    ready,
    online,
    instituteId,
    registerId,
    heading,
    buildBody,
    submit,
    onRefused,
    onNewBill,
}: PosPayDialogProps) {
    const { t } = useTranslation('commerce');
    const errorText = usePosErrorText();
    const { idFor, reset } = useRequestId('pos');
    const pin = usePinGate(registerId);
    const [rows, setRows] = useState<TenderRow[]>([]);
    const [remainderMethod, setRemainderMethod] = useState<string>('CASH');
    const [remainderRef, setRemainderRef] = useState('');
    const [error, setError] = useState<PosError | null>(null);
    const [busy, setBusy] = useState(false);
    const [answer, setAnswer] = useState<SaleAnswer | null>(null);
    const [autoPrint, setAutoPrint] = useState(true);
    const pending = useRef(false);
    const printed = useRef(false);

    const applied = creditApplied(total, credit);
    const due = Math.max(0, (toPaise(total) - toPaise(applied)) / 100);
    const giveBack = Math.max(0, (toPaise(credit) - toPaise(total)) / 100);

    useEffect(() => {
        if (!open) return;
        setRows(due > 0 ? [newTenderRow('CASH', due)] : []);
        setRemainderMethod('CASH');
        setRemainderRef('');
        setError(null);
        setAnswer(null);
        setAutoPrint(readAutoPrint(instituteId, registerId));
        printed.current = false;
        pending.current = false;
        reset();
        // Opening starts a new payment; `due` is read once at that moment.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Print once, automatically, when the device setting is on.
    useEffect(() => {
        if (!answer || printed.current || !autoPrint) return;
        printed.current = true;
        const timer = setTimeout(() => printReceipt(), 150);
        return () => clearTimeout(timer);
    }, [answer, autoPrint]);

    const rest = remaining(total, credit, rows);
    const changeDue = change(rows);
    const problem = tenderProblem(total, credit, rows);
    const remainderOk = giveBack === 0 || remainderMethod === 'CASH' || remainderRef.trim() !== '';
    const canConfirm = online && ready && !busy && problem === null && remainderOk;

    const finish = (result: SaleAnswer) => {
        setAnswer(result);
        setError(null);
    };

    /** A failed attempt: ask for a PIN, hand a refusal to the screen, or show it here. */
    const fail = (raw: unknown, body: SaleRequest) => {
        const read = readPosError(raw);
        if (read.code === 'APPROVAL_REQUIRED') {
            pin.ask(read.action, async (approval: ManagerApproval) => {
                await attempt(body, approval, true);
            });
            return;
        }
        if (read.code === 'IDEMPOTENCY_MISMATCH') reset();
        if (!read.network && onRefused(read)) {
            onOpenChange(false);
            return;
        }
        setError(read);
    };

    const attempt = async (body: SaleRequest, approval?: ManagerApproval, fromPin = false) => {
        const id = idFor(body);
        try {
            const result = await submit({ ...body, client_request_id: id, ...(approval ? { approval } : {}) });
            finish(result);
        } catch (raw) {
            const read = readPosError(raw);
            // A wrong or locked PIN, or a dropped line, keeps the PIN dialog open with the sentence.
            if (fromPin && (read.code === 'PIN_INVALID' || read.code === 'PIN_LOCKED' || read.network)) throw raw;
            fail(raw, body);
        }
    };

    const confirm = async () => {
        if (pending.current || !canConfirm) return;
        pending.current = true;
        setBusy(true);
        setError(null);
        const remainder =
            giveBack > 0
                ? { method: remainderMethod, reference: remainderMethod === 'CASH' ? null : remainderRef.trim() }
                : null;
        const body = buildBody(toTenderRequest(rows), remainder);
        try {
            await attempt(body);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    };

    const update = (key: string, change: Partial<TenderRow>) =>
        setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...change } : row)));

    const addMode = (mode: PosTenderMode) => {
        if (mode === 'CASH' && rows.some((row) => row.mode === 'CASH')) return;
        const left = remaining(total, credit, rows);
        setRows((prev) => {
            // One tap on a mode with a single untouched cash row switches it instead of splitting.
            if (prev.length === 1 && prev[0]?.mode === 'CASH' && prev[0].cashTendered === '' && mode !== 'CASH' && toPaise(prev[0].amount) === toPaise(due)) {
                return [newTenderRow(mode, due)];
            }
            return [...prev, newTenderRow(mode, left)];
        });
    };

    const close = (next: boolean) => {
        if (next) return;
        if (busy) return; // never close under a request on its way
        if (answer) onNewBill();
        onOpenChange(false);
    };

    const done = answer !== null;
    const docNumber = answer?.receipt.document.number ?? answer?.sale.document?.number ?? answer?.sale.order_number ?? '';
    const answerChange = answer?.receipt.change ?? answer?.sale.change_due ?? changeDue;

    return (
        <>
            <MyDialog
                heading={done ? t('pos.done.title', { number: docNumber }) : (heading ?? t('pos.pay.title'))}
                open={open}
                onOpenChange={close}
                dialogWidth="w-dialog-lg"
                className="max-h-dialog-tall"
                footer={
                    done ? (
                        <div className="flex w-full flex-wrap items-center justify-end gap-2 pe-24 sm:pe-0">
                            <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => printReceipt()}>
                                <Printer size={20} className="me-2" />
                                {t('pos.receipt.print')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="large" className="h-12"
                                data-testid="pos-new-bill"
                                onClick={() => {
                                    onNewBill();
                                    onOpenChange(false);
                                }}
                            >
                                {t('pos.done.newBill')}
                            </MyButton>
                        </div>
                    ) : (
                        <div className="flex w-full flex-wrap items-center justify-end gap-2">
                            <MyButton type="button" buttonType="secondary" scale="large" className="h-12" disable={busy} onClick={() => close(false)}>
                                {t('common.cancel')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="large" className="h-12"
                                data-testid="pos-confirm-pay"
                                disable={!canConfirm}
                                onAsyncClick={confirm}
                                loadingText={t('pos.pay.saving')}
                            >
                                {error?.network ? t('pos.notSaved') : t('pos.tender.confirm')}
                            </MyButton>
                        </div>
                    )
                }
            >
                {done && answer ? (
                    <div className="flex flex-col items-center gap-4">
                        <CheckCircle size={48} weight="fill" className="text-success-600" />
                        {answerChange > 0 && (
                            <p data-testid="pos-change" className="text-h2 font-medium text-foreground">
                                {t('pos.tender.change', { amount: rupees(answerChange) })}
                            </p>
                        )}
                        {answer.replayed && <p className="text-caption text-muted-foreground">{t('pos.done.replayed')}</p>}
                        <PosReceipt80 receipt={answer.receipt} />
                        <label className="flex min-h-12 items-center gap-3 text-body text-foreground">
                            <Switch
                                checked={autoPrint}
                                onCheckedChange={(checked) => {
                                    setAutoPrint(checked);
                                    writeAutoPrint(instituteId, registerId, checked);
                                }}
                                aria-label={t('pos.done.autoPrint')}
                            />
                            {t('pos.done.autoPrint')}
                        </label>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="grid grid-cols-3 gap-3 rounded-lg bg-neutral-50 p-3">
                            <div className="flex flex-col">
                                <span className="text-caption text-muted-foreground">{t('pos.totals.total')}</span>
                                <span className="tabular-nums text-h3 font-medium text-foreground" data-testid="pos-pay-total">
                                    {rupees(total)}
                                </span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-caption text-muted-foreground">{t('pos.pay.remainingLabel')}</span>
                                <span
                                    data-testid="pos-remaining"
                                    className={cn(
                                        'tabular-nums text-h3 font-medium',
                                        toPaise(rest) === 0 ? 'text-success-600' : 'text-danger-600'
                                    )}
                                >
                                    {rupees(rest)}
                                </span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-caption text-muted-foreground">{t('pos.pay.changeLabel')}</span>
                                <span className="tabular-nums text-h3 font-medium text-foreground">{rupees(changeDue)}</span>
                            </div>
                        </div>
                        {applied > 0 && (
                            <OrderNotice tone="info">
                                <p>{t('pos.pay.creditUsed', { amount: rupees(applied) })}</p>
                            </OrderNotice>
                        )}
                        {due > 0 && (
                            <div className="grid grid-cols-4 gap-2" role="group" aria-label={t('pos.pay.addMode')}>
                                {(['CASH', 'UPI', 'CARD', 'OTHER'] as const).map((mode) => {
                                    const Icon = MODE_ICON[mode] ?? Money;
                                    return (
                                        <button
                                            key={mode}
                                            type="button"
                                            disabled={mode === 'CASH' && rows.some((row) => row.mode === 'CASH')}
                                            onClick={() => addMode(mode === 'OTHER' ? 'BANK_TRANSFER' : mode)}
                                            className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border border-neutral-300 text-body text-foreground hover:border-primary-500 hover:bg-primary-50 disabled:opacity-40"
                                        >
                                            <Icon size={22} />
                                            {mode === 'OTHER' ? t('pos.tender.OTHER') : t(`orders.tender.${mode}`)}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        <ul className="flex flex-col gap-3">
                            {rows.map((row) => (
                                <TenderRowEditor
                                    key={row.key}
                                    row={row}
                                    onChange={(change) => update(row.key, change)}
                                    onRemove={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                                />
                            ))}
                        </ul>
                        {giveBack > 0 && (
                            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                                <p className="text-body text-foreground">
                                    {t('pos.pay.giveBackCredit', { amount: rupees(giveBack) })}
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    {EXCHANGE_REMAINDER_METHODS.map((method) => (
                                        <button
                                            key={method}
                                            type="button"
                                            aria-pressed={remainderMethod === method}
                                            onClick={() => setRemainderMethod(method)}
                                            className={cn(
                                                'min-h-12 rounded-md border text-body',
                                                remainderMethod === method
                                                    ? 'border-primary-500 bg-primary-50 text-primary-500'
                                                    : 'border-neutral-300 text-neutral-600'
                                            )}
                                        >
                                            {t(`orders.tender.${method}`)}
                                        </button>
                                    ))}
                                </div>
                                {remainderMethod === 'UPI' && (
                                    <PosField label={t('pos.tender.reference')} htmlFor="pos-remainder-ref" required>
                                        <input
                                            id="pos-remainder-ref"
                                            maxLength={100}
                                            className={posInputClass}
                                            value={remainderRef}
                                            onChange={(event) => setRemainderRef(event.target.value)}
                                        />
                                    </PosField>
                                )}
                            </div>
                        )}
                        {problem && problem !== 'short' && rows.length > 0 && (
                            <p className="text-body text-danger-600">{t(`pos.pay.problems.${problem}`)}</p>
                        )}
                        {!online && (
                            <OrderNotice tone="warning">
                                <p>{t('pos.offline')}</p>
                            </OrderNotice>
                        )}
                        {!ready && online && (
                            <OrderNotice tone="info">
                                <p>{t('pos.pay.waitQuote')}</p>
                            </OrderNotice>
                        )}
                        {error && (
                            <OrderNotice tone="danger">
                                <p data-testid="pos-pay-error">{error.network ? t('pos.pay.notSavedHint') : errorText(error)}</p>
                                {!error.network && error.message && !error.posKey && (
                                    <p className="text-caption">{error.message}</p>
                                )}
                            </OrderNotice>
                        )}
                    </div>
                )}
            </MyDialog>
            {pin.dialog}
            {answer && (
                <PrintPortal>
                    <PosReceipt80 receipt={answer.receipt} printable />
                </PrintPortal>
            )}
        </>
    );
}

function TenderRowEditor({
    row,
    onChange,
    onRemove,
}: {
    row: TenderRow;
    onChange: (change: Partial<TenderRow>) => void;
    onRemove: () => void;
}) {
    const { t } = useTranslation('commerce');
    const needsRef = REFERENCE_REQUIRED_MODES.has(row.mode);
    const isOther = row.mode === 'BANK_TRANSFER' || row.mode === 'CHEQUE';
    const amountNumber = Number(row.amount);
    return (
        <li data-testid={`pos-tender-${row.mode}`} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
                {isOther ? (
                    <div role="radiogroup" aria-label={t('pos.tender.OTHER')} className="flex gap-2">
                        {(['BANK_TRANSFER', 'CHEQUE'] as const).map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                role="radio"
                                aria-checked={row.mode === mode}
                                onClick={() => onChange({ mode })}
                                className={cn(
                                    'min-h-12 rounded-md border px-3 text-body',
                                    row.mode === mode
                                        ? 'border-primary-500 bg-primary-50 text-primary-500'
                                        : 'border-neutral-300 text-neutral-600'
                                )}
                            >
                                {t(`orders.tender.${mode}`)}
                            </button>
                        ))}
                    </div>
                ) : (
                    <span className="text-subtitle font-medium text-foreground">{t(`orders.tender.${row.mode}`)}</span>
                )}
                <button
                    type="button"
                    aria-label={t('pos.pay.removeTender')}
                    onClick={onRemove}
                    className="flex size-12 items-center justify-center rounded-md text-neutral-500 hover:bg-danger-50 hover:text-danger-600"
                >
                    <Trash size={20} />
                </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <PosField label={t('pos.pay.amount')} htmlFor={`amount-${row.key}`}>
                    <input
                        id={`amount-${row.key}`}
                        inputMode="decimal"
                        className={posInputClass}
                        value={row.amount}
                        onChange={(event) => onChange({ amount: sanitizeAmount(event.target.value) })}
                    />
                </PosField>
                {row.mode === 'CASH' ? (
                    <PosField label={t('pos.tender.cashReceived')} htmlFor={`given-${row.key}`}>
                        <input
                            id={`given-${row.key}`}
                            inputMode="decimal"
                            placeholder={row.amount}
                            className={posInputClass}
                            value={row.cashTendered}
                            onChange={(event) => onChange({ cashTendered: sanitizeAmount(event.target.value) })}
                        />
                    </PosField>
                ) : (
                    <PosField
                        label={t('pos.tender.reference')}
                        htmlFor={`ref-${row.key}`}
                        required={needsRef}
                    >
                        <input
                            id={`ref-${row.key}`}
                            maxLength={100}
                            className={posInputClass}
                            value={row.reference}
                            onChange={(event) =>
                                onChange({ reference: event.target.value.replace(/[^A-Za-z0-9 /_.:#-]/g, '') })
                            }
                        />
                    </PosField>
                )}
            </div>
            {row.mode === 'CASH' && (
                <div className="flex flex-wrap gap-2">
                    {cashSuggestions(amountNumber).map((note) => (
                        <button
                            key={note}
                            type="button"
                            onClick={() => onChange({ cashTendered: note.toFixed(2) })}
                            className="min-h-12 rounded-md border border-neutral-300 px-4 text-body text-foreground hover:border-primary-500"
                        >
                            {rupees(note)}
                        </button>
                    ))}
                </div>
            )}
        </li>
    );
}
