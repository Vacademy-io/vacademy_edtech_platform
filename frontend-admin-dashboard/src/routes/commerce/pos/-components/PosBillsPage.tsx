import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArrowUUpLeft, Printer, Prohibit, Swap } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatDateTime } from '@/lib/formatters';
import { CommerceEmptyState, CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { fetchReceipt } from '../-shared/pos-api';
import { useSale, useSessionSales } from '../-shared/pos-hooks';
import { modeLabel } from '../-shared/pos-receipt';
import type { SaleDetail, SaleTender, SessionView } from '../-shared/pos-types';
import { PosReceipt80, usePrintOnDemand } from './PosReceipt80';
import { PosShell } from './PosShell';
import { PosTenderChangeDialog } from './PosTenderChangeDialog';
import { PosVoidDialog } from './PosVoidDialog';
import { PosErrorNotice, PosFigure, rupees } from './pos-ui';

const PAGE_SIZE = 50;

/** P3 (contract §7.3): the bills of this counter session, newest first. */
export function PosBillsPage({ sessionId }: { sessionId: string }) {
    return (
        <PosShell sessionId={sessionId} active="bills">
            {(session) => <PosBillsBody session={session} />}
        </PosShell>
    );
}

export function PosBillsBody({ session }: { session: SessionView }) {
    const { t } = useTranslation('commerce');
    const [page, setPage] = useState(0);
    const [openId, setOpenId] = useState<string | null>(null);
    const sales = useSessionSales(session.id, page, PAGE_SIZE);
    const rows = sales.data?.rows ?? [];
    const total = sales.data?.total ?? 0;

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 pb-24">
            <h2 className="text-h3 font-medium text-foreground">{t('pos.bills.title')}</h2>
            {sales.isLoading && <CommerceLoadingRows rows={5} />}
            {sales.isError && <PosErrorNotice error={sales.error} />}
            {sales.isSuccess && rows.length === 0 && <CommerceEmptyState title={t('pos.bills.empty')} />}
            {rows.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border bg-card">
                    <table className="w-full min-w-table-sm text-body">
                        <thead className="bg-neutral-50 text-caption text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 text-start font-normal">{t('pos.bills.time')}</th>
                                <th className="px-3 py-2 text-start font-normal">{t('pos.bills.number')}</th>
                                <th className="px-3 py-2 text-start font-normal">{t('pos.bills.customer')}</th>
                                <th className="px-3 py-2 text-end font-normal">{t('pos.totals.total')}</th>
                                <th className="px-3 py-2 text-start font-normal">{t('pos.bills.modes')}</th>
                                <th className="px-3 py-2 text-start font-normal">{t('pos.bills.status')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr
                                    key={row.order_id}
                                    tabIndex={0}
                                    data-testid={`pos-bill-${row.order_id}`}
                                    onClick={() => setOpenId(row.order_id)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') setOpenId(row.order_id);
                                    }}
                                    className="h-14 cursor-pointer border-t border-border hover:bg-primary-50"
                                >
                                    <td className="px-3">{row.created_at ? formatDateTime(row.created_at) : (row.document_date ?? '—')}</td>
                                    <td className="px-3 font-medium">{row.invoice_number ?? row.order_number}</td>
                                    <td className="px-3">
                                        {row.customer_name ?? (row.phone_last4 ? `••${row.phone_last4}` : t('pos.sell.walkIn'))}
                                    </td>
                                    <td className="px-3 text-end tabular-nums">{rupees(row.total)}</td>
                                    <td className="px-3">{row.modes.map((m) => modeLabel(m, t)).join(', ') || '—'}</td>
                                    <td className="px-3">
                                        <CommerceStatusChip kind="order" value={row.status} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {total > PAGE_SIZE && (
                <MyPagination
                    currentPage={page}
                    totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
                    totalElements={total}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage}
                    compactOnPhone
                />
            )}
            <SaleSheet session={session} orderId={openId} onClose={() => setOpenId(null)} />
        </div>
    );
}

/** One bill: lines, money, payments; Reprint, Void, Change payment mode, Return. */
export function SaleSheet({
    session,
    orderId,
    onClose,
}: {
    session: SessionView;
    orderId: string | null;
    onClose: () => void;
}) {
    const { t } = useTranslation('commerce');
    const sale = useSale(orderId, session.id);
    const printer = usePrintOnDemand();
    const [voidOpen, setVoidOpen] = useState(false);
    const [changing, setChanging] = useState<SaleTender | null>(null);
    const [printError, setPrintError] = useState<unknown>(null);
    const detail: SaleDetail | undefined = sale.data;
    const canVoid = !!detail?.next_actions.includes('VOID');
    const canChange = !!detail?.next_actions.includes('CHANGE_TENDER');
    const canReturn = !!detail?.next_actions.includes('RETURN') && session.status === 'OPEN';

    const reprint = async () => {
        if (!orderId) return;
        setPrintError(null);
        try {
            const receipt = await fetchReceipt(orderId);
            printer.print(<PosReceipt80 receipt={receipt} printable />);
        } catch (error) {
            setPrintError(error);
        }
    };

    return (
        <>
            <Sheet open={!!orderId} onOpenChange={(open) => !open && onClose()}>
                <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
                    <SheetHeader>
                        <SheetTitle>
                            {detail ? (detail.document?.number ?? detail.order_number) : t('pos.bills.loading')}
                        </SheetTitle>
                    </SheetHeader>
                    {sale.isLoading && <CommerceLoadingRows rows={3} />}
                    {sale.isError && <PosErrorNotice error={sale.error} />}
                    {detail && (
                        <div className="flex flex-col gap-4 pb-24">
                            <div className="flex flex-wrap items-center gap-2">
                                <CommerceStatusChip kind="order" value={detail.status} />
                                {detail.document?.cancelled && <span className="text-body text-danger-600">{t('pos.receipt.void')}</span>}
                            </div>
                            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                                {detail.lines.map((line) => (
                                    <li key={line.order_line_id} className="flex justify-between gap-3 p-3">
                                        <div className="flex min-w-0 flex-col">
                                            <span className="text-body font-medium text-foreground">
                                                {line.name}
                                                {line.variant_label ? ` · ${line.variant_label}` : ''}
                                            </span>
                                            <span className="text-caption text-muted-foreground">
                                                {[
                                                    formatQuantity(line.quantity, line.qty_scale, line.unit, t),
                                                    line.piece_codes.join(', ') || null,
                                                ]
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                            </span>
                                        </div>
                                        <span className="tabular-nums text-body text-foreground">{rupees(line.line_total)}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="flex flex-col gap-1">
                                <PosFigure label={t('pos.totals.subtotal')} value={rupees(detail.totals.subtotal)} />
                                {detail.totals.discount > 0 && (
                                    <PosFigure label={t('pos.totals.discount')} value={`− ${rupees(detail.totals.discount)}`} />
                                )}
                                <PosFigure label={t('pos.totals.tax')} value={rupees(detail.totals.tax)} />
                                <PosFigure label={t('pos.totals.total')} value={rupees(detail.totals.total)} strong />
                            </div>
                            <div className="flex flex-col gap-2">
                                <p className="text-subtitle font-medium text-foreground">{t('pos.bills.payments')}</p>
                                {detail.tenders.map((tender) => (
                                    <div
                                        key={tender.id}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                                    >
                                        <div className="flex flex-col">
                                            <span className="text-body text-foreground">
                                                {modeLabel(tender.mode, t)}
                                                {tender.reference ? ` · ${tender.reference}` : ''}
                                            </span>
                                            <span className="tabular-nums text-caption text-muted-foreground">{rupees(tender.amount)}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <CommerceStatusChip kind="tender" value={tender.status} />
                                            {canChange && tender.status === 'RECEIVED' && tender.mode !== 'CREDIT_NOTE' && (
                                                <MyButton
                                                    type="button"
                                                    buttonType="secondary"
                                                    scale="large" className="h-12"
                                                    onClick={() => setChanging(tender)}
                                                >
                                                    <Swap size={18} className="me-2" />
                                                    {t('pos.tenderChange.action')}
                                                </MyButton>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <PosErrorNotice error={printError} />
                            <div className="flex flex-wrap gap-2">
                                <MyButton type="button" buttonType="primary" scale="large" className="h-12" onAsyncClick={reprint}>
                                    <Printer size={20} className="me-2" />
                                    {t('pos.receipt.reprint')}
                                </MyButton>
                                {canVoid && (
                                    <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => setVoidOpen(true)}>
                                        <Prohibit size={20} className="me-2" />
                                        {t('pos.void.action')}
                                    </MyButton>
                                )}
                                {canReturn && (
                                    <Link
                                        to="/commerce/pos/$sessionId/returns"
                                        params={{ sessionId: session.id }}
                                        search={{ order: detail.order_id }}
                                    >
                                        <MyButton type="button" buttonType="secondary" scale="large" className="h-12">
                                            <ArrowUUpLeft size={20} className="me-2" />
                                            {t('pos.returns.title')}
                                        </MyButton>
                                    </Link>
                                )}
                            </div>
                        </div>
                    )}
                </SheetContent>
            </Sheet>
            {detail && (
                <PosVoidDialog
                    sale={detail}
                    registerId={session.register.id}
                    open={voidOpen}
                    onOpenChange={setVoidOpen}
                    onDone={() => undefined}
                />
            )}
            {detail && (
                <PosTenderChangeDialog
                    orderId={detail.order_id}
                    tender={changing}
                    registerId={session.register.id}
                    onOpenChange={(open) => !open && setChanging(null)}
                    onDone={() => undefined}
                />
            )}
            {printer.portal}
        </>
    );
}
