import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArrowUUpLeft, CheckCircle, MagnifyingGlass, Minus, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { RETURN_WARNINGS } from '@/routes/commerce/orders/-components/dialogs/ReturnCreateDialog';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { buzz, useScanInput } from '@/routes/commerce/orders/-shared/use-scan-input';
import { lookupSales } from '../-shared/pos-api';
import { useCreatePosReturn, useDebounced, useReturnPreview, useSale } from '../-shared/pos-hooks';
import {
    POS_RETURN_REASONS,
    POS_RETURN_SETTLE,
    type PosReturnAnswer,
    type PosReturnBody,
    type PosReturnLineRequest,
    type PosReturnSettle,
    type SaleDetail,
    type SaleDetailLine,
    type SaleRow,
    type SessionView,
} from '../-shared/pos-types';
import { usePinWrite } from './PosPinGate';
import { PosScanBox } from './PosScanBox';
import { PosShell } from './PosShell';
import { PosErrorNotice, PosField, posInputClass, rupees } from './pos-ui';

/** P4 (contract §7.3): return or exchange at the counter. */
export function PosReturnPage({ sessionId, initialOrderId }: { sessionId: string; initialOrderId?: string }) {
    return (
        <PosShell sessionId={sessionId} active="returns">
            {(session, online) => <PosReturnBody session={session} online={online} initialOrderId={initialOrderId} />}
        </PosShell>
    );
}

/** What is being returned of one line: resaleable and damaged counts, or picked pieces. */
interface Pick {
    good: number;
    damaged: number;
    /** Piece id → condition, for one-of-a-kind lines. */
    pieces: Record<string, 'RESALEABLE' | 'DAMAGED'>;
}

const EMPTY_PICK: Pick = { good: 0, damaged: 0, pieces: {} };
const pickCount = (pick: Pick | undefined) =>
    pick ? pick.good + pick.damaged + Object.keys(pick.pieces).length : 0;

/** The return's lines as the server takes them: one entry per line and condition (§4.4). */
export function toReturnLines(lines: SaleDetailLine[], picks: Record<string, Pick>): PosReturnLineRequest[] {
    const out: PosReturnLineRequest[] = [];
    lines.forEach((line) => {
        const pick = picks[line.order_line_id];
        if (!pick) return;
        if (line.piece_ids.length > 0) {
            (['RESALEABLE', 'DAMAGED'] as const).forEach((condition) => {
                const ids = Object.entries(pick.pieces)
                    .filter(([, c]) => c === condition)
                    .map(([id]) => id);
                if (ids.length > 0) {
                    out.push({ order_line_id: line.order_line_id, quantity: ids.length, condition, piece_ids: ids });
                }
            });
            return;
        }
        if (pick.good > 0) out.push({ order_line_id: line.order_line_id, quantity: pick.good, condition: 'RESALEABLE' });
        if (pick.damaged > 0) out.push({ order_line_id: line.order_line_id, quantity: pick.damaged, condition: 'DAMAGED' });
    });
    return out;
}

/**
 * The return's settle as the server takes it: EXCHANGE alone; a REFUND with its method and, for UPI and bank
 * transfer only, the reference (the server refuses a reference on CASH).
 */
export const PREVIEW_REFERENCE = 'PREVIEW';

export function settleBody(settle: PosReturnSettle, reference: string | null): PosReturnBody['settle'] {
    if (settle === 'EXCHANGE') return { kind: 'EXCHANGE' };
    return { kind: 'REFUND', method: settle, ...(settle !== 'CASH' && reference ? { reference } : {}) };
}

function PosReturnBody({
    session,
    online,
    initialOrderId,
}: {
    session: SessionView;
    online: boolean;
    initialOrderId?: string;
}) {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const [orderId, setOrderId] = useState<string | null>(initialOrderId ?? null);
    const [found, setFound] = useState<SaleRow[] | null>(null);
    const [findError, setFindError] = useState<unknown>(null);
    const [message, setMessage] = useState<{ tone: 'danger' | 'info'; text: string } | null>(null);
    const [answer, setAnswer] = useState<PosReturnAnswer | null>(null);

    const find = async (q: string) => {
        setFindError(null);
        setMessage(null);
        if (!online) {
            setMessage({ tone: 'danger', text: t('pos.offline') });
            return;
        }
        try {
            const rows = await lookupSales(session.id, q);
            if (rows.length === 1 && rows[0]) {
                setOrderId(rows[0].order_id);
                setFound(null);
            } else {
                setFound(rows);
                if (rows.length === 0) {
                    buzz();
                    setMessage({ tone: 'danger', text: t('pos.returns.notFound') });
                }
            }
        } catch (error) {
            setFindError(error);
        }
    };
    const scan = useScanInput((code) => void find(code), { paused: !!orderId || !!answer });

    const sale = useSale(orderId, session.id);

    if (answer) {
        return (
            <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 p-8 pb-24 text-center">
                <CheckCircle size={48} weight="fill" className="text-success-600" />
                <p className="text-h3 font-medium text-foreground">
                    {t('pos.returns.doneTitle', { number: answer.return_number ?? '' })}
                </p>
                {answer.credit_note_number && (
                    <p className="text-body text-neutral-600">
                        {t('pos.returns.creditNote', { number: answer.credit_note_number, amount: rupees(answer.credit) })}
                    </p>
                )}
                {answer.replayed && <p className="text-caption text-muted-foreground">{t('pos.done.replayed')}</p>}
                {answer.refund && (
                    <p data-testid="pos-refund" className="text-h2 font-medium text-foreground">
                        {answer.refund.method === 'CASH'
                            ? t('pos.tender.change', { amount: rupees(answer.refund.amount) })
                            : t('pos.returns.refunded', {
                                  amount: rupees(answer.refund.amount),
                                  method: t(`orders.tender.${answer.refund.method}`),
                              })}
                    </p>
                )}
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="large" className="h-12"
                    onClick={() => {
                        setAnswer(null);
                        setOrderId(null);
                        setFound(null);
                    }}
                >
                    {t('pos.returns.another')}
                </MyButton>
            </div>
        );
    }

    if (!orderId) {
        return (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 pb-24">
                <h2 className="text-h3 font-medium text-foreground">{t('pos.returns.title')}</h2>
                <PosScanBox
                    inputProps={scan.inputProps}
                    label={t('pos.returns.find')}
                    onClear={() => scan.setValue('')}
                    message={message}
                />
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="large"
                    className="h-12 w-fit"
                    disable={scan.value.trim().length < 2}
                    onClick={() => scan.submit()}
                >
                    <MagnifyingGlass size={20} className="me-2" />
                    {t('pos.returns.search')}
                </MyButton>
                <PosErrorNotice error={findError} />
                {found && found.length > 0 && (
                    <ul className="flex flex-col gap-2">
                        {found.map((row) => (
                            <li key={row.order_id}>
                                <button
                                    type="button"
                                    onClick={() => setOrderId(row.order_id)}
                                    className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2 text-start hover:border-primary-500"
                                >
                                    <span className="flex flex-col">
                                        <span className="text-body font-medium text-foreground">
                                            {row.invoice_number ?? row.order_number}
                                        </span>
                                        <span className="text-caption text-muted-foreground">
                                            {[
                                                row.document_date ? formatDate(row.document_date) : null,
                                                row.location_name,
                                                row.customer_name,
                                                row.phone_last4 ? `••${row.phone_last4}` : null,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                    </span>
                                    <span className="tabular-nums text-body text-foreground">{rupees(row.total)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {sale.isLoading && (
                <div className="p-4">
                    <CommerceLoadingRows rows={3} />
                </div>
            )}
            {sale.isError && (
                <div className="flex flex-col gap-3 p-4">
                    <PosErrorNotice error={sale.error} />
                    <MyButton type="button" buttonType="secondary" scale="large" className="h-12 w-fit" onClick={() => setOrderId(null)}>
                        {t('pos.returns.findAnother')}
                    </MyButton>
                </div>
            )}
            {sale.data && (
                <ReturnForm
                    key={sale.data.order_id}
                    session={session}
                    online={online}
                    sale={sale.data}
                    onBack={() => setOrderId(null)}
                    onDone={(result, settle) => {
                        if (settle === 'EXCHANGE') {
                            void navigate({
                                to: '/commerce/pos/$sessionId',
                                params: { sessionId: session.id },
                                search: {
                                    exchange: result.return_id,
                                    exchangeNumber: result.return_number ?? undefined,
                                    exchangeCredit: result.exchange_credit ?? result.credit,
                                },
                            });
                            return;
                        }
                        setAnswer(result);
                    }}
                />
            )}
        </div>
    );
}

function ReturnForm({
    session,
    online,
    sale,
    onBack,
    onDone,
}: {
    session: SessionView;
    online: boolean;
    sale: SaleDetail;
    onBack: () => void;
    onDone: (answer: PosReturnAnswer, settle: PosReturnSettle) => void;
}) {
    const { t } = useTranslation('commerce');
    const write = useCreatePosReturn();
    const pin = usePinWrite(session.register.id, 'posret');
    const [picks, setPicks] = useState<Record<string, Pick>>({});
    const [reason, setReason] = useState<string>('');
    const [note, setNote] = useState('');
    const [override, setOverride] = useState('');
    const [settle, setSettle] = useState<PosReturnSettle>('CASH');
    const [reference, setReference] = useState('');
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState<unknown>(null);

    const returnable = sale.lines.filter((line) => line.returnable > 0);
    const lines = useMemo(() => toReturnLines(sale.lines, picks), [sale.lines, picks]);
    const previewBody = useMemo(() => {
        const sums = new Map<string, number>();
        lines.forEach((l) => sums.set(l.order_line_id, (sums.get(l.order_line_id) ?? 0) + l.quantity));
        // The reason (when picked) and the settle go along: the server's warnings and PIN list depend on them.
        return lines.length > 0
            ? {
                  session_id: session.id,
                  order_id: sale.order_id,
                  lines: [...sums.entries()].map(([order_line_id, quantity]) => ({ order_line_id, quantity })),
                  ...(reason ? { reason } : {}),
                  // The preview drops a settle it finds invalid and then assumes cash; a UPI or bank refund has
                  // no reference typed yet, so a fixed one stands in (the preview stores nothing).
                  settle: settleBody(settle, PREVIEW_REFERENCE),
              }
            : null;
    }, [lines, session.id, sale.order_id, reason, settle]);
    const debounced = useDebounced(previewBody, 300);
    const preview = useReturnPreview(debounced);
    const warnings = preview.data?.warnings ?? [];

    useEffect(() => {
        setError(null);
    }, [picks, settle]);

    const setPick = (lineId: string, change: (pick: Pick) => Pick) =>
        setPicks((prev) => ({ ...prev, [lineId]: change(prev[lineId] ?? EMPTY_PICK) }));

    const needsRef = settle === 'UPI' || settle === 'BANK_TRANSFER';
    const refOk = !needsRef || /^[A-Za-z0-9 /_.:#-]{1,100}$/.test(reference.trim());
    const overrideOk = warnings.length === 0 || override.trim().length > 0;
    const canSubmit = online && lines.length > 0 && !!reason && refOk && overrideOk;

    const submit = async () => {
        setTouched(true);
        if (!canSubmit) return;
        setError(null);
        const body = {
            session_id: session.id,
            order_id: sale.order_id,
            lines,
            reason,
            reason_note: note.trim() || null,
            override_reason: warnings.length > 0 ? override.trim() : null,
            settle: settleBody(settle, needsRef ? reference.trim() : null),
        };
        try {
            await pin.run(body, (full) => write.mutateAsync([full]), (answer) => onDone(answer, settle));
        } catch (raw) {
            setError(raw);
        }
    };

    return (
        <div className="grid min-h-0 flex-1 grid-cols-5 gap-0">
            <section className="col-span-3 flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col">
                        <span className="text-title font-medium text-foreground">
                            {sale.document?.number ?? sale.order_number}
                        </span>
                        <span className="text-caption text-muted-foreground">
                            {[sale.document?.date ? formatDate(sale.document.date) : null, sale.customer?.name]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                    </div>
                    <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={onBack}>
                        {t('pos.returns.findAnother')}
                    </MyButton>
                </div>
                {returnable.length === 0 && (
                    <OrderNotice tone="info">
                        <p>{t('pos.returns.nothing')}</p>
                    </OrderNotice>
                )}
                <ul className="flex flex-col gap-2">
                    {returnable.map((line) => (
                        <ReturnLine
                            key={line.order_line_id}
                            line={line}
                            pick={picks[line.order_line_id] ?? EMPTY_PICK}
                            onChange={(change) => setPick(line.order_line_id, change)}
                        />
                    ))}
                </ul>
            </section>
            <aside className="col-span-2 flex flex-col gap-3 border-s border-border bg-card p-4 pb-24">
                <PlainSelect
                    label={t('pos.returns.reason')}
                    value={reason}
                    onChange={setReason}
                    placeholder={t('pos.returns.reasonPick')}
                    invalid={touched && !reason}
                    options={POS_RETURN_REASONS.map((r) => ({ value: r, label: t(`orders.returns.reasons.${r}`) }))}
                />
                <PosField label={t('pos.returns.note')} htmlFor="pos-return-note">
                    <input
                        id="pos-return-note"
                        maxLength={500}
                        className={posInputClass}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                    />
                </PosField>
                {warnings.length > 0 && (
                    <OrderNotice tone="warning">
                        {warnings.map((w) => (
                            <p key={w}>
                                {(RETURN_WARNINGS as readonly string[]).includes(w) ? t(`orders.returns.warnings.${w}`) : w}
                            </p>
                        ))}
                    </OrderNotice>
                )}
                {warnings.length > 0 && (
                    <PosField
                        label={t('pos.returns.override')}
                        htmlFor="pos-return-override"
                        required
                        error={touched && !overrideOk ? t('pos.validation.reason') : null}
                    >
                        <input
                            id="pos-return-override"
                            maxLength={500}
                            className={posInputClass}
                            value={override}
                            onChange={(event) => setOverride(event.target.value)}
                        />
                    </PosField>
                )}
                <div className="flex flex-col gap-1 rounded-lg bg-neutral-50 p-3">
                    <span className="text-caption text-muted-foreground">{t('pos.returns.creditEstimate')}</span>
                    <span className="tabular-nums text-h3 font-medium text-foreground" data-testid="pos-return-credit">
                        {preview.data?.credit_estimate !== null && preview.data?.credit_estimate !== undefined
                            ? rupees(preview.data.credit_estimate)
                            : '—'}
                    </span>
                    {preview.isFetching && <span className="text-caption text-muted-foreground">{t('pos.totals.updating')}</span>}
                </div>
                {preview.isError && <PosErrorNotice error={preview.error} />}
                {(preview.data?.needs_approval.length ?? 0) > 0 && (
                    <p className="text-caption text-warning-600">{t('pos.returns.needsPin')}</p>
                )}
                <div role="radiogroup" aria-label={t('pos.returns.settle')} className="grid grid-cols-2 gap-2">
                    {POS_RETURN_SETTLE.map((option) => (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={settle === option}
                            onClick={() => setSettle(option)}
                            className={cn(
                                'min-h-12 rounded-md border px-2 text-body',
                                settle === option
                                    ? 'border-primary-500 bg-primary-50 text-primary-500'
                                    : 'border-neutral-300 text-neutral-600'
                            )}
                        >
                            {t(`pos.returns.settleOptions.${option}`)}
                        </button>
                    ))}
                </div>
                {needsRef && (
                    <PosField
                        label={t('pos.returns.reference')}
                        htmlFor="pos-return-ref"
                        required
                        error={touched && !refOk ? t('pos.validation.reference') : null}
                    >
                        <input
                            id="pos-return-ref"
                            maxLength={100}
                            className={posInputClass}
                            value={reference}
                            onChange={(event) => setReference(event.target.value)}
                        />
                    </PosField>
                )}
                <PosErrorNotice error={error} />
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="large"
                    className="h-14 w-full"
                    disable={!online || lines.length === 0}
                    onAsyncClick={submit}
                >
                    <ArrowUUpLeft size={20} className="me-2" />
                    {settle === 'EXCHANGE' ? t('pos.returns.exchangeSubmit') : t('pos.returns.submit')}
                </MyButton>
            </aside>
            {pin.dialog}
        </div>
    );
}

function ReturnLine({
    line,
    pick,
    onChange,
}: {
    line: SaleDetailLine;
    pick: Pick;
    onChange: (change: (pick: Pick) => Pick) => void;
}) {
    const { t } = useTranslation('commerce');
    const count = pickCount(pick);
    const max = line.returnable;
    const stepper = (label: string, value: number, key: 'good' | 'damaged') => (
        <div className="flex items-center gap-2">
            <span className="min-w-24 text-caption text-muted-foreground">{label}</span>
            <button
                type="button"
                aria-label={`${label} −`}
                disabled={value <= 0}
                onClick={() => onChange((p) => ({ ...p, [key]: p[key] - 1 }))}
                className="flex size-12 items-center justify-center rounded-md border border-neutral-300 disabled:opacity-40"
            >
                <Minus size={18} />
            </button>
            <span className="min-w-12 text-center tabular-nums text-subtitle">{formatQuantity(value, line.qty_scale, line.unit, t)}</span>
            <button
                type="button"
                aria-label={`${label} +`}
                disabled={count >= max}
                onClick={() => onChange((p) => ({ ...p, [key]: p[key] + 1 }))}
                className="flex size-12 items-center justify-center rounded-md border border-neutral-300 disabled:opacity-40"
            >
                <Plus size={18} />
            </button>
        </div>
    );
    return (
        <li className={cn('flex flex-col gap-2 rounded-lg border bg-card p-3', count > 0 ? 'border-primary-500' : 'border-border')}>
            <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col">
                    <span className="text-subtitle font-medium text-foreground">
                        {line.name}
                        {line.variant_label ? ` · ${line.variant_label}` : ''}
                    </span>
                    <span className="text-caption text-muted-foreground">
                        {t('pos.returns.canReturn', { quantity: formatQuantity(max, line.qty_scale, line.unit, t) })}
                    </span>
                </div>
                <span className="tabular-nums text-body text-foreground">{rupees(line.line_total)}</span>
            </div>
            {line.piece_ids.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {line.piece_ids.map((id, index) => {
                        const condition = pick.pieces[id];
                        const code = line.piece_codes[index] ?? id;
                        return (
                            <button
                                key={id}
                                type="button"
                                aria-pressed={!!condition}
                                disabled={!condition && count >= max}
                                onClick={() =>
                                    onChange((p) => {
                                        const pieces = { ...p.pieces };
                                        // Tap cycles: not returned → resaleable → damaged → not returned.
                                        if (!pieces[id]) pieces[id] = 'RESALEABLE';
                                        else if (pieces[id] === 'RESALEABLE') pieces[id] = 'DAMAGED';
                                        else delete pieces[id];
                                        return { ...p, pieces };
                                    })
                                }
                                className={cn(
                                    'flex min-h-12 items-center gap-2 rounded-md border px-3 text-body disabled:opacity-40',
                                    condition === 'RESALEABLE' && 'border-primary-500 bg-primary-50 text-primary-500',
                                    condition === 'DAMAGED' && 'border-danger-200 bg-danger-50 text-danger-600',
                                    !condition && 'border-neutral-300 text-neutral-600'
                                )}
                            >
                                {code}
                                {condition && <span className="text-caption">{t(`orders.condition.${condition}`)}</span>}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {stepper(t('orders.condition.RESALEABLE'), pick.good, 'good')}
                    {stepper(t('orders.condition.DAMAGED'), pick.damaged, 'damaged')}
                </div>
            )}
        </li>
    );
}
