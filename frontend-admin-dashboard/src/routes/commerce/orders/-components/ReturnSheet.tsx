import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FilePdf } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { COMMERCE_ROLE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { formatDateTime } from '@/lib/formatters';
import { CommerceErrorState, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { exchangeableReturn } from '@/routes/commerce/orders/-shared/order-actions';
import { approveReturn, fetchCreditNotePdfUrl, rejectReturn } from '@/routes/commerce/orders/-shared/order-api';
import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { orderKeys, useReturnView } from '@/routes/commerce/orders/-shared/order-hooks';
import {
    RETURN_ACTION_CODES,
    type ReturnActionCode,
    type ReturnView,
    type StaffOrderDetail,
} from '@/routes/commerce/orders/-shared/order-types';
import { DetailRow } from './detail-bits';
import { RefundDialog } from './dialogs/RefundDialog';
import { useAnswerWrite } from './dialogs/use-answer-write';
import { ReturnReceiveForm } from './ReturnReceiveForm';
import { DialogButtons, OrderErrorAlert, OrderNotice, TextAreaField, money } from './order-ui';

const KNOWN: ReadonlySet<string> = new Set(RETURN_ACTION_CODES);

/** The return's own next steps: only codes the app knows, in the server's order. */
export function returnActions(view: Pick<ReturnView, 'next_actions'>): ReturnActionCode[] {
    return view.next_actions.filter((code): code is ReturnActionCode => KNOWN.has(code));
}

type Panel = 'APPROVE' | 'REJECT' | 'RECEIVE' | null;

/**
 * One return (contract §5.7.2): its lines, credit, refunds and policy notes,
 * and the steps its `next_actions` offers. A side sheet on a wide screen, the
 * whole screen on a phone.
 */
export function ReturnSheet({
    returnId,
    detail,
    open,
    onOpenChange,
}: {
    returnId: string | null;
    detail: StaffOrderDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const query = useReturnView(returnId, open && access.isResolved && access.canOpen('commerce-orders'));
    const view = query.data;
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full max-w-full overflow-y-auto sm:max-w-full md:max-w-xl">
                <SheetHeader className="text-start sm:text-start">
                    <SheetTitle className="text-title font-medium">
                        {t('orders.returnSheet.title', { number: view?.return_number ?? '' })}
                    </SheetTitle>
                    <SheetDescription>{t('orders.returnSheet.description', { number: detail.order.order_number })}</SheetDescription>
                </SheetHeader>
                <div className="mt-4 flex flex-col gap-4">
                    {query.isLoading && (
                        <div className="flex flex-col gap-3" aria-busy="true">
                            <Skeleton className="h-6 w-40" />
                            <Skeleton className="h-32 w-full" />
                        </div>
                    )}
                    {query.isError && (
                        <CommerceErrorState
                            message={t(readOrderError(query.error).key ?? 'orders.errors.generic', { amount: '', minutes: 1 })}
                            onRetry={() => void query.refetch()}
                        />
                    )}
                    {view && <ReturnBody key={view.id} view={view} detail={detail} onClose={() => onOpenChange(false)} />}
                </div>
            </SheetContent>
        </Sheet>
    );
}

function ReturnBody({ view, detail, onClose }: { view: ReturnView; detail: StaffOrderDetail; onClose: () => void }) {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const access = useCommerceAccess();
    const queryClient = useQueryClient();
    const currency = detail.order.currency;
    const [panel, setPanel] = useState<Panel>(null);
    const [refunding, setRefunding] = useState(false);
    const actions = returnActions(view);
    const canExchange = access.isManager && exchangeableReturn(view);
    const seesMoney = access.hasAnyRole([COMMERCE_ROLE.STORE_MANAGER, COMMERCE_ROLE.ACCOUNTANT]);
    const lineById = new Map(detail.lines.map((line) => [line.id, line]));

    const openCreditNote = async () => {
        if (!view.credit_note?.id) return;
        try {
            const url = await fetchCreditNotePdfUrl(view.credit_note.id);
            if (url) window.open(url, '_blank', 'noopener');
            else toast.error(t('orders.returnSheet.pdfNotReady'));
        } catch {
            toast.error(t('orders.returnSheet.pdfNotReady'));
        }
    };

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <CommerceStatusChip kind="return" value={view.status} />
                {view.reason && (
                    <span className="text-caption text-muted-foreground">
                        {t(`orders.returns.reasons.${view.reason}`, { defaultValue: view.reason })}
                    </span>
                )}
                {view.requested_via && (
                    <span className="text-caption text-muted-foreground">
                        · {t(`orders.returns.via.${view.requested_via}`, { defaultValue: view.requested_via })}
                    </span>
                )}
            </div>
            {view.reason_note && <p className="text-body text-foreground">{view.reason_note}</p>}

            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {view.lines.map((line) => {
                    const orderLine = lineById.get(line.order_line_id);
                    const quantity = (value: number | null) =>
                        formatQuantity(value ?? 0, orderLine?.qty_scale, orderLine?.unit, t);
                    return (
                        <li key={line.id} className="flex flex-col gap-1 p-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 flex-col">
                                    <span className="text-body font-medium text-foreground">{line.name ?? '—'}</span>
                                    {line.sku && <span className="text-caption text-muted-foreground">{line.sku}</span>}
                                </div>
                                <span className="text-body tabular-nums text-foreground">{quantity(line.quantity)}</span>
                            </div>
                            {(line.qty_resaleable !== null || line.qty_damaged !== null) && (
                                <span className="text-caption text-muted-foreground">
                                    {t('orders.returnSheet.conditionSplit', {
                                        resaleable: quantity(line.qty_resaleable),
                                        damaged: quantity(line.qty_damaged),
                                    })}
                                </span>
                            )}
                            {line.piece_codes.length > 0 && (
                                <span className="font-mono text-caption text-muted-foreground">{line.piece_codes.join(', ')}</span>
                            )}
                            {seesMoney && line.credited_value !== null && (
                                <DetailRow label={t('orders.returnSheet.credited')}>
                                    <MoneyCell value={line.credited_value} currency={currency} />
                                </DetailRow>
                            )}
                        </li>
                    );
                })}
            </ul>

            {seesMoney && (
                <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
                    <DetailRow label={t('orders.returnSheet.creditTotal')}>
                        <MoneyCell value={view.credit_total ?? 0} currency={currency} />
                    </DetailRow>
                    <DetailRow label={t('orders.returnSheet.refunded')}>
                        <MoneyCell value={view.refunded ?? 0} currency={currency} />
                    </DetailRow>
                    {view.credit_note && (
                        <div className="flex items-center justify-between gap-2 pt-1">
                            <span className="text-caption text-muted-foreground">
                                {t('orders.returnSheet.creditNote', { number: view.credit_note.number ?? '' })}
                            </span>
                            <MyButton type="button" buttonType="secondary" scale="small" onAsyncClick={openCreditNote}>
                                <FilePdf size={14} />
                                {t('orders.returnSheet.downloadCreditNote')}
                            </MyButton>
                        </div>
                    )}
                </div>
            )}

            {seesMoney && view.refunds.length > 0 && (
                <ul className="flex flex-col gap-1">
                    {view.refunds.map((refund) => (
                        <li key={refund.id} className="flex flex-wrap items-center justify-between gap-2 text-caption">
                            <span className="text-foreground">
                                {money(refund.amount, refund.currency ?? currency)} ·{' '}
                                {t(`orders.refund.methods.${refund.method ?? 'CASH'}`, { defaultValue: refund.method ?? '' })}
                            </span>
                            <CommerceStatusChip kind="refund" value={refund.status} />
                        </li>
                    ))}
                </ul>
            )}

            {view.policy_warnings.length > 0 && (
                <OrderNotice tone="warning">
                    <ul className="flex flex-col gap-0.5">
                        {view.policy_warnings.map((warning) => (
                            <li key={warning}>{t(`orders.returns.warnings.${warning}`, { defaultValue: warning })}</li>
                        ))}
                    </ul>
                    {view.override_reason && (
                        <p className="text-caption">{t('orders.returnSheet.overrideReason', { reason: view.override_reason })}</p>
                    )}
                </OrderNotice>
            )}
            {view.reject_reason && (
                <OrderNotice tone="danger">{t('orders.returnSheet.rejectReason', { reason: view.reject_reason })}</OrderNotice>
            )}

            <dl className="flex flex-col gap-1 text-caption">
                {(
                    [
                        ['created', view.created_at],
                        ['approved', view.approved_at],
                        ['rejected', view.rejected_at],
                        ['received', view.received_at],
                        ['closed', view.closed_at],
                    ] as const
                )
                    .filter(([, at]) => !!at)
                    .map(([key, at]) => (
                        <div key={key} className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">{t(`orders.returnSheet.times.${key}`)}</dt>
                            <dd className="text-foreground">{formatDateTime(at as string)}</dd>
                        </div>
                    ))}
            </dl>

            {panel === 'APPROVE' && <ApprovePanel view={view} currency={currency} onDone={() => setPanel(null)} />}
            {panel === 'REJECT' && <RejectPanel view={view} currency={currency} onDone={() => setPanel(null)} />}
            {panel === 'RECEIVE' && (
                <ReturnReceiveForm view={view} detail={detail} onDone={() => setPanel(null)} onCancel={() => setPanel(null)} />
            )}

            {panel === null && (actions.length > 0 || canExchange) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {actions.includes('RECEIVE') && (
                        <MyButton type="button" buttonType="primary" scale="medium" onClick={() => setPanel('RECEIVE')}>
                            {t('orders.returnSheet.receive')}
                        </MyButton>
                    )}
                    {actions.includes('APPROVE') && (
                        <MyButton type="button" buttonType={actions.includes('RECEIVE') ? 'secondary' : 'primary'} scale="medium" onClick={() => setPanel('APPROVE')}>
                            {t('orders.returnSheet.approve')}
                        </MyButton>
                    )}
                    {actions.includes('REFUND') && (
                        <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => setRefunding(true)}>
                            {t('orders.actions.REFUND')}
                        </MyButton>
                    )}
                    {canExchange && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => {
                                onClose();
                                void navigate({
                                    to: '/commerce/orders/new' as never,
                                    search: { exchangeReturn: view.id, exchangeOrder: view.order_id ?? detail.order.id } as never,
                                });
                            }}
                        >
                            {t('orders.actions.EXCHANGE')}
                        </MyButton>
                    )}
                    {actions.includes('REJECT') && (
                        <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => setPanel('REJECT')}>
                            {t('orders.returnSheet.reject')}
                        </MyButton>
                    )}
                </div>
            )}

            {refunding && (
                <RefundDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) {
                            setRefunding(false);
                            void queryClient.invalidateQueries({ queryKey: orderKeys.returnView(view.id) });
                        }
                    }}
                    detail={detail}
                    returnId={view.id}
                />
            )}
        </>
    );
}

function ApprovePanel({ view, currency, onDone }: { view: ReturnView; currency: string; onDone: () => void }) {
    const { t } = useTranslation('commerce');
    const queryClient = useQueryClient();
    const [note, setNote] = useState('');
    const write = useAnswerWrite(
        (body: { client_request_id: string; from_status: string; note?: string }) => approveReturn(view.id, body),
        {
            open: true,
            onOpenChange: (open) => {
                if (!open) onDone();
            },
            currency,
            prefix: 'rap',
            onAnswer: (answer) => queryClient.setQueryData(orderKeys.returnView(view.id), answer),
        }
    );
    const submit = async () => {
        const answer = await write.submit({ from_status: 'REQUESTED', ...(note.trim() ? { note: note.trim() } : {}) });
        if (answer) {
            toast.success(t('orders.returnSheet.approved'));
            onDone();
        }
    };
    return (
        <section className="flex flex-col gap-3 rounded-lg border border-primary-200 p-3">
            <TextAreaField id="return-approve-note" label={t('orders.note')} value={note} onChange={setNote} maxLength={500} />
            <OrderErrorAlert error={write.error} currency={currency} />
            <DialogButtons onCancel={onDone}>
                <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={submit}>
                    {t('orders.returnSheet.approve')}
                </MyButton>
            </DialogButtons>
        </section>
    );
}

function RejectPanel({ view, currency, onDone }: { view: ReturnView; currency: string; onDone: () => void }) {
    const { t } = useTranslation('commerce');
    const queryClient = useQueryClient();
    const [reason, setReason] = useState('');
    const [touched, setTouched] = useState(false);
    const write = useAnswerWrite(
        (body: { client_request_id: string; from_status: string; reason: string }) => rejectReturn(view.id, body),
        {
            open: true,
            onOpenChange: (open) => {
                if (!open) onDone();
            },
            currency,
            prefix: 'rrj',
            onAnswer: (answer) => queryClient.setQueryData(orderKeys.returnView(view.id), answer),
        }
    );
    const reasonError = !reason.trim() ? t('orders.dialogs.reasonRequired') : null;
    const submit = async () => {
        setTouched(true);
        if (reasonError) return;
        const answer = await write.submit({ from_status: view.status ?? 'REQUESTED', reason: reason.trim() });
        if (answer) {
            toast.success(t('orders.returnSheet.rejected'));
            onDone();
        }
    };
    return (
        <section className="flex flex-col gap-3 rounded-lg border border-danger-200 p-3">
            <TextAreaField
                id="return-reject-reason"
                label={t('orders.reason')}
                value={reason}
                onChange={setReason}
                required
                maxLength={500}
                error={touched ? reasonError : null}
            />
            <OrderErrorAlert error={write.error} currency={currency} />
            <DialogButtons onCancel={onDone}>
                <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={submit}>
                    {t('orders.returnSheet.reject')}
                </MyButton>
            </DialogButtons>
        </section>
    );
}
