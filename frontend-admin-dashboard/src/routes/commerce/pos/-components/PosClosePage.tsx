import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Lock, Printer, Wallet } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { useCloseSession } from '../-shared/pos-hooks';
import { toPaise } from '../-shared/pos-tenders';
import { DENOMINATIONS, type SessionView, type ZReport } from '../-shared/pos-types';
import { PosCashMovementDialog } from './PosCashMovementDialog';
import { usePinWrite } from './PosPinGate';
import { PosZReport80 } from './PosZReport80';
import { usePrintOnDemand } from './PosReceipt80';
import { PosShell } from './PosShell';
import { PosErrorNotice, PosFigure, PosField, isAmount, posInputClass, rupees, sanitizeAmount, signedRupees } from './pos-ui';

export type DenominationCounts = Record<string, string>;

/** Σ note × count, in rupees; counts that are not whole numbers count as 0. */
export function denominationTotal(counts: DenominationCounts): number {
    const paise = DENOMINATIONS.reduce((sum, note) => {
        const n = Number(counts[String(note)] ?? '');
        return Number.isInteger(n) && n > 0 ? sum + note * 100 * n : sum;
    }, 0);
    return paise / 100;
}

/** The counts as the server takes them: every note, whole counts 0..100000. */
export const denominationsBody = (counts: DenominationCounts): Record<string, number> =>
    Object.fromEntries(
        DENOMINATIONS.map((note) => {
            const n = Number(counts[String(note)] ?? '');
            return [String(note), Number.isInteger(n) && n > 0 ? Math.min(n, 100_000) : 0];
        })
    );

/** P6 (contract §7.3): count the drawer, close the counter, print the day report. */
export function PosClosePage({ sessionId }: { sessionId: string }) {
    return (
        <PosShell sessionId={sessionId} active="close">
            {(session, online) => <PosCloseBody session={session} online={online} />}
        </PosShell>
    );
}

export function PosCloseBody({ session, online }: { session: SessionView; online: boolean }) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const write = useCloseSession();
    const pin = usePinWrite(session.register.id, 'posclose');
    const printer = usePrintOnDemand();
    const [typeTotal, setTypeTotal] = useState(false);
    const [counts, setCounts] = useState<DenominationCounts>({});
    const [typed, setTyped] = useState('');
    const [note, setNote] = useState('');
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [closed, setClosed] = useState<SessionView | null>(null);
    const [cashOpen, setCashOpen] = useState(false);
    const printedFor = useRef<string | null>(null);
    const { print } = printer;

    const report: ZReport | null = closed?.z_report ?? session.z_report ?? null;
    const isClosed = !!closed || session.status === 'CLOSED';

    // The day report prints once, as soon as the close went through.
    useEffect(() => {
        if (!closed?.z_report || printedFor.current === closed.id) return;
        printedFor.current = closed.id;
        print(<PosZReport80 report={closed.z_report} printable />);
    }, [closed, print]);

    if (isClosed) {
        return (
            <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto p-6 pb-24">
                <CheckCircle size={48} weight="fill" className="text-success-600" />
                <p className="text-h3 font-medium text-foreground">{t('pos.close.done')}</p>
                {report && <PosZReport80 report={report} />}
                <div className="flex flex-wrap justify-center gap-2">
                    {report && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="large" className="h-12"
                            onClick={() => printer.print(<PosZReport80 report={report} printable />)}
                        >
                            <Printer size={20} className="me-2" />
                            {t('pos.close.printZ')}
                        </MyButton>
                    )}
                    <Link to="/commerce/pos">
                        <MyButton type="button" buttonType="primary" scale="large" className="h-12">
                            {t('pos.nav.counters')}
                        </MyButton>
                    </Link>
                </div>
                {printer.portal}
            </div>
        );
    }

    const summary = session.summary;
    const expected = summary?.expected_cash ?? session.expected_cash ?? null;
    const counted = typeTotal ? (isAmount(typed, { allowZero: true }) ? Number(typed) : null) : denominationTotal(counts);
    const difference = counted !== null && expected !== null ? (toPaise(counted) - toPaise(expected)) / 100 : null;
    const noteNeeded = difference !== null && difference !== 0;
    const noteOk = !noteNeeded || (note.trim().length > 0 && note.trim().length <= 500);
    const canClose = session.next_actions.includes('CLOSE');
    const upi = summary?.by_mode.find((m) => m.mode === 'UPI');
    const card = summary?.by_mode.find((m) => m.mode === 'CARD');

    const submit = async () => {
        setTouched(true);
        if (counted === null || !noteOk) return;
        setError(null);
        const body = {
            ...(typeTotal ? { counted_cash: counted.toFixed(2) } : { denominations: denominationsBody(counts) }),
            ...(note.trim() ? { note: note.trim() } : {}),
        };
        try {
            await pin.run(body, (full) => write.mutateAsync([session.id, full]), (answer) => setClosed(answer));
        } catch (raw) {
            setError(raw);
        }
    };

    return (
        <div className="grid min-h-0 flex-1 grid-cols-5 overflow-y-auto">
            <section className="col-span-3 flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-h3 font-medium text-foreground">{t('pos.close.count')}</h2>
                    <MyButton type="button" buttonType="text" scale="large" className="h-12" onClick={() => setTypeTotal((v) => !v)}>
                        {typeTotal ? t('pos.close.useNotes') : t('pos.close.typeTotal')}
                    </MyButton>
                </div>
                {typeTotal ? (
                    <PosField
                        label={t('pos.close.counted')}
                        htmlFor="pos-close-total"
                        required
                        error={touched && counted === null ? t('pos.validation.amountOrZero') : null}
                    >
                        <input
                            id="pos-close-total"
                            inputMode="decimal"
                            autoFocus
                            className={posInputClass}
                            value={typed}
                            onChange={(event) => setTyped(sanitizeAmount(event.target.value))}
                        />
                    </PosField>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {DENOMINATIONS.map((note) => {
                            const key = String(note);
                            const n = Number(counts[key] ?? '');
                            return (
                                <label
                                    key={note}
                                    className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card px-3"
                                >
                                    <span className="w-16 tabular-nums text-subtitle font-medium text-foreground">
                                        {rupees(note).replace(/\.00$/, '')}
                                    </span>
                                    <span className="text-caption text-muted-foreground">×</span>
                                    <input
                                        aria-label={t('pos.close.countOf', { note: rupees(note) })}
                                        data-testid={`pos-den-${note}`}
                                        inputMode="numeric"
                                        maxLength={6}
                                        className="h-12 w-20 rounded-md border border-neutral-300 px-2 text-end text-subtitle tabular-nums focus:border-primary-500 focus:outline-none"
                                        value={counts[key] ?? ''}
                                        onChange={(event) =>
                                            setCounts((prev) => ({ ...prev, [key]: event.target.value.replace(/\D/g, '') }))
                                        }
                                    />
                                    <span className="flex-1 text-end tabular-nums text-body text-neutral-600">
                                        {Number.isInteger(n) && n > 0 ? rupees(note * n) : ''}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                )}
            </section>
            <aside className="col-span-2 flex flex-col gap-3 border-s border-border bg-card p-4 pb-24">
                <div className="flex flex-col gap-1.5 rounded-lg bg-neutral-50 p-3">
                    <PosFigure label={t('pos.close.expected')} value={expected !== null ? rupees(expected) : '—'} />
                    <PosFigure
                        label={t('pos.close.counted')}
                        value={counted !== null ? rupees(counted) : '—'}
                        testId="pos-close-counted"
                    />
                    <PosFigure
                        label={t('pos.close.difference')}
                        value={difference !== null ? signedRupees(difference) : '—'}
                        strong
                        tone={difference ? 'danger' : 'success'}
                        testId="pos-close-difference"
                    />
                    <p className="text-caption text-muted-foreground">{t('pos.close.serverDecides')}</p>
                </div>
                {(upi || card) && (
                    <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
                        <p className="text-caption text-muted-foreground">{t('pos.close.matchHint')}</p>
                        {upi && <PosFigure label={`${t('orders.tender.UPI')} (${upi.count})`} value={rupees(upi.amount)} />}
                        {card && <PosFigure label={`${t('orders.tender.CARD')} (${card.count})`} value={rupees(card.amount)} />}
                    </div>
                )}
                <PosField
                    label={t('pos.close.note')}
                    htmlFor="pos-close-note"
                    required={noteNeeded}
                    error={touched && !noteOk ? t('pos.close.noteRequired') : null}
                >
                    <input
                        id="pos-close-note"
                        maxLength={500}
                        className={posInputClass}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                    />
                </PosField>
                {!canClose && (
                    <OrderNotice tone="info">
                        <p>{t('pos.close.notYours')}</p>
                    </OrderNotice>
                )}
                <PosErrorNotice error={error} />
                {access.isManager && session.next_actions.includes('CASH_MOVEMENT') && (
                    <MyButton type="button" buttonType="secondary" scale="large" className="h-12 w-full" onClick={() => setCashOpen(true)}>
                        <Wallet size={20} className="me-2" />
                        {t('pos.cash.heading')}
                    </MyButton>
                )}
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="large"
                    className="h-14 w-full"
                    data-testid="pos-close-submit"
                    disable={!online || !canClose}
                    onAsyncClick={submit}
                >
                    <Lock size={20} className="me-2" />
                    {t('pos.close.title')}
                </MyButton>
            </aside>
            {pin.dialog}
            <PosCashMovementDialog sessionId={session.id} open={cashOpen} onOpenChange={setCashOpen} />
        </div>
    );
}
