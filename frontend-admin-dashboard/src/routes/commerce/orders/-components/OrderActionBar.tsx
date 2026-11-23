import { type ComponentType, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { DotsThreeVertical } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { CommerceErrorState } from '@/routes/commerce/-components/CommerceStates';
import {
    type ActionItem,
    type ClientActionId,
    exchangeableReturn,
    orderButtons,
    serverActions,
} from '@/routes/commerce/orders/-shared/order-actions';
import { fetchInvoicePdfUrl } from '@/routes/commerce/orders/-shared/order-api';
import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { useOrderDetail } from '@/routes/commerce/orders/-shared/order-hooks';
import type {
    OrderActionCode,
    ReturnView,
    StaffOrderDetail,
} from '@/routes/commerce/orders/-shared/order-types';
import { CancelLineDialog } from './dialogs/CancelLineDialog';
import { CancelOrderDialog } from './dialogs/CancelOrderDialog';
import { ConfirmCodDialog } from './dialogs/ConfirmCodDialog';
import { DeliverDialog } from './dialogs/DeliverDialog';
import type { OrderDialogProps } from './dialogs/dialog-types';
import { EditTrackingDialog } from './dialogs/EditTrackingDialog';
import { ReasonDialog } from './dialogs/ReasonDialog';
import { ReceiptDialog } from './dialogs/ReceiptDialog';
import { ReissueB2bDialog } from './dialogs/ReissueB2bDialog';
import { RemittanceDialog } from './dialogs/RemittanceDialog';
import { RevokeLinksDialog } from './dialogs/RevokeLinksDialog';
import { RtoDialog } from './dialogs/RtoDialog';
import { RtoReceiveDialog } from './dialogs/RtoReceiveDialog';
import { ShipDialog } from './dialogs/ShipDialog';
import { OrderNotice, useOrderErrorHandler, useOrderErrorText } from './order-ui';

/**
 * Dialogs another part plugs in for a server code (Part 3: CREATE_RETURN and
 * REFUND). A code without a dialog keeps its button (the server offered it) and
 * its click opens nothing.
 */
export type ExtraOrderDialogs = Partial<Record<OrderActionCode, ComponentType<OrderDialogProps>>>;

type OpenDialog = OrderActionCode | 'REISSUE_B2B' | 'REVOKE_LINKS' | 'RECORD_REMITTANCE';

/** Opens a print page or an invoice in a new tab without giving it this window. */
const openInNewTab = (url: string) => window.open(url, '_blank', 'noopener');

/**
 * The one dialog that is open for an order. CONFIRM's "Customer said no" moves
 * on to Cancel order with the reason filled in.
 */
export function OrderDialogSwitch({
    code,
    detail,
    onClose,
    extraDialogs,
}: {
    code: OpenDialog;
    detail: StaffOrderDetail;
    onClose: () => void;
    extraDialogs?: ExtraOrderDialogs;
}) {
    const { t } = useTranslation('commerce');
    const [current, setCurrent] = useState<OpenDialog>(code);
    const [cancelReason, setCancelReason] = useState<string | undefined>(undefined);
    const common = {
        open: true,
        detail,
        onOpenChange: (open: boolean) => {
            if (!open) onClose();
        },
    };
    switch (current) {
        case 'CONFIRM':
            return (
                <ConfirmCodDialog
                    {...common}
                    onDecline={() => {
                        setCancelReason(t('orders.dialogs.confirm.declineReason'));
                        setCurrent('CANCEL');
                    }}
                />
            );
        case 'SHIP':
            return <ShipDialog {...common} />;
        case 'DELIVER':
            return <DeliverDialog {...common} />;
        case 'RTO':
            return <RtoDialog {...common} />;
        case 'RTO_RECEIVE':
            return <RtoReceiveDialog {...common} />;
        case 'EDIT_TRACKING':
            return <EditTrackingDialog {...common} />;
        case 'UNPACK':
        case 'UNDO_SHIP':
        case 'UNDO_DELIVERY':
        case 'CLEAR_STOCK_SHORT':
            return <ReasonDialog {...common} code={current} />;
        case 'CANCEL':
            return <CancelOrderDialog {...common} defaultReason={cancelReason} />;
        case 'CANCEL_LINE':
            return <CancelLineDialog {...common} />;
        case 'RECORD_RECEIPT':
            return <ReceiptDialog {...common} />;
        case 'REISSUE_B2B':
            return <ReissueB2bDialog {...common} />;
        case 'REVOKE_LINKS':
            return <RevokeLinksDialog {...common} />;
        case 'RECORD_REMITTANCE':
            return <RemittanceDialog open onOpenChange={common.onOpenChange} initialOrders={[detail.order]} />;
        default: {
            const Extra = extraDialogs?.[current];
            return Extra ? <Extra {...common} /> : null;
        }
    }
}

interface OrderActionBarProps {
    detail: StaffOrderDetail;
    /** Returns read with GET /returns/{id} (for the Exchange action). */
    returnViews?: readonly ReturnView[];
    extraDialogs?: ExtraOrderDialogs;
    /** Opens this code's dialog once (a deep link from the desk). */
    initialAction?: string;
}

/**
 * The order's buttons (contract §5.2.2–§5.2.3): one primary, up to two
 * secondary, the rest in "More actions". Server codes come from
 * `next_actions` only; client actions follow the role and the data.
 */
export function OrderActionBar({ detail, returnViews = [], extraDialogs, initialAction }: OrderActionBarProps) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const navigate = useNavigate();
    const handle = useOrderErrorHandler();
    const text = useOrderErrorText();
    const [openCode, setOpenCode] = useState<OpenDialog | null>(() =>
        initialAction && serverActions(detail).includes(initialAction as OrderActionCode)
            ? (initialAction as OrderActionCode)
            : null
    );
    const [inlineError, setInlineError] = useState<string | null>(null);

    if (!access.isResolved) return null;
    const buttons = orderButtons(detail, access, returnViews);

    const runClient = async (code: ClientActionId) => {
        const id = detail.order.id;
        switch (code) {
            case 'PRINT_SLIP':
                openInNewTab(`/commerce/orders/print?ids=${encodeURIComponent(id)}`);
                return;
            case 'DOWNLOAD_INVOICE':
                if (!detail.invoice_id) return;
                setInlineError(null);
                try {
                    const url = await fetchInvoicePdfUrl(detail.invoice_id);
                    if (url) openInNewTab(url);
                    else setInlineError(t('orders.detail.documents.pdfNotReady'));
                } catch (raw) {
                    const left = handle(raw);
                    if (left) setInlineError(text(left));
                }
                return;
            case 'EXCHANGE': {
                const view = returnViews.find(exchangeableReturn);
                if (!view) return;
                void navigate({
                    to: '/commerce/orders/new',
                    search: { exchangeReturn: view.id, exchangeOrder: id },
                } as never);
                return;
            }
            default:
                setOpenCode(code);
        }
    };

    const run = (item: ActionItem) => {
        if (item.kind === 'client') {
            void runClient(item.code);
            return;
        }
        if (item.code === 'PACK') {
            void navigate({ to: '/commerce/orders/pack', search: { order: detail.order.id } } as never);
            return;
        }
        setOpenCode(item.code);
    };

    const label = (item: ActionItem) => t(`orders.actions.${item.code}`);

    return (
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
                {buttons.secondary.map((item) => (
                    <MyButton
                        key={item.code}
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => run(item)}
                    >
                        {label(item)}
                    </MyButton>
                ))}
                {buttons.primary && (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={() => buttons.primary && run(buttons.primary)}
                    >
                        {label(buttons.primary)}
                    </MyButton>
                )}
                {buttons.overflow.length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                layoutVariant="icon"
                                aria-label={t('orders.actions.more')}
                            >
                                <DotsThreeVertical size={18} />
                            </MyButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {buttons.overflow.map((item) => (
                                <DropdownMenuItem key={`${item.kind}-${item.code}`} onSelect={() => run(item)}>
                                    {label(item)}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
            {inlineError && <OrderNotice tone="danger">{inlineError}</OrderNotice>}
            {openCode && (
                <OrderDialogSwitch
                    key={openCode}
                    code={openCode}
                    detail={detail}
                    extraDialogs={extraDialogs}
                    onClose={() => setOpenCode(null)}
                />
            )}
        </div>
    );
}

export type RowDialogAction = 'CONFIRM' | 'SHIP' | 'DELIVER' | 'RECORD_RECEIPT';

/**
 * A desk row's button: reads the order, then opens the same dialog the detail
 * would, only when the server still offers the step.
 */
export function OrderRowActionDialog({
    orderId,
    action,
    onClose,
}: {
    orderId: string;
    action: RowDialogAction;
    onClose: () => void;
}) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const query = useOrderDetail(orderId, access.isResolved && access.canOpen('commerce-orders'));
    const text = useOrderErrorText();
    const onOpenChange = (open: boolean) => {
        if (!open) onClose();
    };

    if (query.data && serverActions(query.data).includes(action)) {
        return <OrderDialogSwitch code={action} detail={query.data} onClose={onClose} />;
    }
    return (
        <MyDialog
            heading={t(`orders.actions.${action}`)}
            open
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
        >
            {query.isLoading && (
                <div className="flex flex-col gap-3" aria-busy="true">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-20 w-full" />
                </div>
            )}
            {query.isError && (
                <CommerceErrorState
                    message={text(readOrderError(query.error))}
                    onRetry={() => void query.refetch()}
                />
            )}
            {query.data && (
                <div className="flex flex-col gap-3">
                    <OrderNotice tone="warning">{t('orders.errors.ORDER_TRANSITION_NOT_ALLOWED')}</OrderNotice>
                    <Link
                        to="/commerce/orders/$orderId"
                        params={{ orderId }}
                        className="text-body text-primary-500 hover:underline"
                    >
                        {t('orders.detail.openOrder', { number: query.data.order.order_number })}
                    </Link>
                </div>
            )}
        </MyDialog>
    );
}
