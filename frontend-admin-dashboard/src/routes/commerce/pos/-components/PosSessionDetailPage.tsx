import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Printer } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { formatDateTime } from '@/lib/formatters';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceEmptyState,
    CommerceLoadingRows,
    CommerceNoAccessCard,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import { useSession, useSessionSales } from '../-shared/pos-hooks';
import { PosZReport80 } from './PosZReport80';
import { usePrintOnDemand } from './PosReceipt80';
import { useStaffNames } from './PosSessionsPage';
import { PosErrorNotice, rupees } from './pos-ui';

const PAGE_SIZE = 50;

/** P8 (contract §7.3): one counter session for the manager: day report, cash, bills. */
export function PosSessionDetailPage({ sessionId }: { sessionId: string }) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const query = useSession(sessionId);
    const session = query.data;
    const title = session ? `${session.register.code} · ${session.register.name}` : t('pos.sessions.title');
    return (
        <CommercePage
            navId="commerce-pos"
            title={title}
            backTo={{ to: '/commerce/pos/sessions', label: t('pos.sessions.title') }}
        >
            {access.isResolved && !access.isManager ? (
                <CommerceNoAccessCard className="mt-8" />
            ) : (
                <SessionDetail sessionId={sessionId} />
            )}
        </CommercePage>
    );
}

function SessionDetail({ sessionId }: { sessionId: string }) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const query = useSession(sessionId);
    const [page, setPage] = useState(0);
    const sales = useSessionSales(sessionId, page, PAGE_SIZE);
    const printer = usePrintOnDemand();
    const names = useStaffNames(true);
    const session = query.data;
    const report = session?.z_report ?? session?.summary ?? null;
    const canOpenOrders = access.canOpen('commerce-orders');

    if (query.isLoading) return <CommerceLoadingRows rows={4} />;
    if (query.isError || !session) return <PosErrorNotice error={query.error} />;

    const rows = sales.data?.rows ?? [];
    const total = sales.data?.total ?? 0;

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-2">
                <SectionCard
                    title={t('pos.sessions.summary')}
                    actions={<CommerceStatusChip kind="posSession" value={session.status} />}
                >
                    <dl className="grid grid-cols-2 gap-3 text-body">
                        <div>
                            <dt className="text-caption text-muted-foreground">{t('pos.sessions.cashier')}</dt>
                            <dd>{session.cashier_name ?? names.get(session.cashier_user_id ?? '') ?? '—'}</dd>
                        </div>
                        <div>
                            <dt className="text-caption text-muted-foreground">{t('pos.sessions.location')}</dt>
                            <dd>{session.location.name}</dd>
                        </div>
                        <div>
                            <dt className="text-caption text-muted-foreground">{t('pos.z.opened')}</dt>
                            <dd>{session.opened_at ? formatDateTime(session.opened_at) : '—'}</dd>
                        </div>
                        <div>
                            <dt className="text-caption text-muted-foreground">{t('pos.z.closed')}</dt>
                            <dd>{session.closed_at ? formatDateTime(session.closed_at) : '—'}</dd>
                        </div>
                        {session.opening_note && (
                            <div className="col-span-2">
                                <dt className="text-caption text-muted-foreground">{t('pos.start.openingNote')}</dt>
                                <dd>{session.opening_note}</dd>
                            </div>
                        )}
                        {session.close_note && (
                            <div className="col-span-2">
                                <dt className="text-caption text-muted-foreground">{t('pos.close.note')}</dt>
                                <dd>{session.close_note}</dd>
                            </div>
                        )}
                    </dl>
                </SectionCard>
                <SectionCard title={t('pos.sessions.cashMovements')}>
                    {session.cash_movements.length === 0 ? (
                        <p className="text-body text-muted-foreground">{t('pos.sessions.noCashMovements')}</p>
                    ) : (
                        <ul className="flex flex-col divide-y divide-border">
                            {session.cash_movements.map((m) => (
                                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                                    <span className="flex flex-col">
                                        <span className="text-body text-foreground">
                                            {m.type === 'CASH_OUT' ? t('pos.cash.out') : t('pos.cash.in')} · {m.reason}
                                        </span>
                                        <span className="text-caption text-muted-foreground">
                                            {[m.created_at ? formatDateTime(m.created_at) : null, names.get(m.actor_user_id ?? '')]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                    </span>
                                    <span className="tabular-nums text-body text-foreground">
                                        {m.type === 'CASH_OUT' ? '− ' : ''}
                                        {rupees(m.amount)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </SectionCard>
                <SectionCard title={t('pos.bills.title')}>
                    {sales.isLoading && <CommerceLoadingRows rows={3} />}
                    {sales.isError && <PosErrorNotice error={sales.error} />}
                    {sales.isSuccess && rows.length === 0 && <CommerceEmptyState title={t('pos.bills.empty')} />}
                    {rows.length > 0 && (
                        <ul className="flex flex-col divide-y divide-border">
                            {rows.map((row) => (
                                <li key={row.order_id} className="flex items-center justify-between gap-3 py-2">
                                    <span className="flex flex-col">
                                        {canOpenOrders ? (
                                            <Link
                                                to="/commerce/orders/$orderId"
                                                params={{ orderId: row.order_id }}
                                                className="text-body font-medium text-primary-500 hover:underline"
                                            >
                                                {row.invoice_number ?? row.order_number}
                                            </Link>
                                        ) : (
                                            <span className="text-body font-medium">{row.invoice_number ?? row.order_number}</span>
                                        )}
                                        <span className="text-caption text-muted-foreground">
                                            {row.customer_name ?? t('pos.sell.walkIn')}
                                        </span>
                                    </span>
                                    <span className="flex items-center gap-3">
                                        <CommerceStatusChip kind="order" value={row.status} />
                                        <span className="tabular-nums text-body">{rupees(row.total)}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {total > PAGE_SIZE && (
                        <MyPagination
                            currentPage={page}
                            totalPages={Math.ceil(total / PAGE_SIZE)}
                            totalElements={total}
                            pageSize={PAGE_SIZE}
                            onPageChange={setPage}
                            compactOnPhone
                        />
                    )}
                </SectionCard>
            </div>
            <div className="flex flex-col items-start gap-3">
                {report && (
                    <>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => printer.print(<PosZReport80 report={report} printable />)}
                        >
                            <Printer size={18} className="me-2" />
                            {t('pos.close.printZ')}
                        </MyButton>
                        <PosZReport80 report={report} />
                    </>
                )}
                {printer.portal}
            </div>
        </div>
    );
}
