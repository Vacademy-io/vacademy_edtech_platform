import { useMemo, useState, useCallback, createContext, useContext } from 'react';
import { readRecordedPaymentDetails } from '@/services/offline-payment-modes';
import { ColumnDef } from '@tanstack/react-table';
import { MyTable, TableData } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import type { PaymentLogEntry, PaymentLogsResponse } from '@/types/payment-logs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { formatDistanceToNow } from 'date-fns';
import { PencilSimple, FloppyDisk, X, Eye } from '@phosphor-icons/react';
import { updatePaymentLogTracking } from '@/services/payment-logs';
import type { PaymentLogInvoiceDTO } from '@/services/invoice-service';
import { Skeleton } from '@/components/ui/skeleton';
import { orderColumnIds } from '@/components/shared/leads/use-lead-column-prefs';
import { useToast } from '@/hooks/use-toast';
import { formatMoney, resolveEntryCurrency } from '@/utils/payment-currency';
import { cn } from '@/lib/utils';
import { GatewayBadge } from './GatewayBadge';
import { derivePaymentTypeLabel } from '../-utils/exportPaymentLogsCsv';
import { daysUntil, dueState, formatPlanDate } from '../-utils/planDates';
import { paymentReceivedAt } from '../-utils/paymentReceivedAt';

// ─── Redesign cell primitives ──────────────────────────────────────────────────

/** Token-based avatar tints, picked deterministically from the name so a user keeps one colour. */
const AVATAR_TINTS = [
    'bg-primary-100 text-primary-600',
    'bg-info-100 text-info-600',
    'bg-success-100 text-success-600',
    'bg-warning-100 text-warning-600',
    'bg-danger-100 text-danger-600',
];

const avatarTint = (name: string): string =>
    AVATAR_TINTS[(name.charCodeAt(0) || 0) % AVATAR_TINTS.length]!;

const initialsOf = (name: string): string =>
    (name || '?')
        .split(' ')
        .map((w) => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase() || '?';

function UserAvatar({ name }: { name: string }) {
    return (
        <span
            className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full text-2xs font-bold',
                avatarTint(name)
            )}
        >
            {initialsOf(name)}
        </span>
    );
}

const PAYMENT_STATUS_PILL: Record<string, { label: string; cls: string; dot: string }> = {
    PAID: { label: 'Paid', cls: 'bg-success-100 text-success-700', dot: 'bg-success-600' },
    FAILED: { label: 'Failed', cls: 'bg-danger-100 text-danger-700', dot: 'bg-danger-600' },
    PAYMENT_PENDING: {
        label: 'Pending',
        cls: 'bg-warning-100 text-warning-700',
        dot: 'bg-warning-600',
    },
    NOT_INITIATED: {
        label: 'Not initiated',
        cls: 'bg-neutral-100 text-neutral-600',
        dot: 'bg-neutral-400',
    },
    // A checkout opened and never finished — the gateway order has long expired. Not money in
    // flight and not money owed; kept visible because it is a warm lead.
    ABANDONED: {
        label: 'Abandoned',
        cls: 'bg-neutral-100 text-neutral-500',
        dot: 'bg-neutral-400',
    },
    // A voided invoice. Visible for audit, excluded from every total.
    CANCELLED: {
        label: 'Cancelled',
        cls: 'bg-neutral-100 text-neutral-500',
        dot: 'bg-neutral-300',
    },
};

function PaymentStatusPill({ status }: { status?: string }) {
    const key = (status || '').toUpperCase();
    const meta = PAYMENT_STATUS_PILL[key] ?? {
        label: status ? status.replace(/_/g, ' ') : '—',
        cls: 'bg-neutral-100 text-neutral-600',
        dot: 'bg-neutral-400',
    };
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-bold',
                meta.cls
            )}
        >
            <span className={cn('size-1.5 rounded-full', meta.dot)} />
            {meta.label}
        </span>
    );
}

// ─── Order Status Constants ───────────────────────────────────────────────────

const ORDER_STATUS_OPTIONS = [
    { value: 'ORDERED', label: 'Ordered' },
    { value: 'PREPARING_TO_SHIP', label: 'Preparing to Ship' },
    { value: 'SHIPPED', label: 'Shipped' },
    { value: 'IN_TRANSIT', label: 'In Transit' },
    { value: 'DELIVERED', label: 'Delivered' },
] as const;

const ORDER_STATUS_LABEL_MAP: Record<string, string> = Object.fromEntries(
    ORDER_STATUS_OPTIONS.map((o) => [o.value, o.label])
);

const ORDER_STATUS_COLOR_MAP: Record<string, string> = {
    ORDERED: 'bg-gray-100 text-neutral-600 border-gray-300',
    PREPARING_TO_SHIP: 'bg-amber-50 text-amber-700 border-amber-300',
    SHIPPED: 'bg-blue-50 text-blue-700 border-blue-300',
    IN_TRANSIT: 'bg-orange-50 text-orange-700 border-orange-300',
    DELIVERED: 'bg-green-50 text-green-700 border-green-300',
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentLogsTableProps {
    data: PaymentLogsResponse | undefined;
    isLoading: boolean;
    error: unknown;
    currentPage: number;
    onPageChange: (page: number) => void;
    packageSessions?: Record<string, string>;
    hasOrgAssociatedBatches: boolean;
    hideUserColumn?: boolean;
    /** Column ids the user has switched off (see PAYMENT_COLUMN_TOGGLES). */
    hiddenColumns?: Set<string>;
    /** The user's saved left-to-right column order; empty/absent means the natural order. */
    columnOrder?: string[];
    /** Fired when a header is dragged to a new position, with the full new id order. */
    onColumnOrderChange?: (orderedIds: string[]) => void;
    /** Invoice issued for each payment log, keyed by payment log id. */
    invoicesByPaymentLog?: Record<string, PaymentLogInvoiceDTO>;
    /** True while the invoice lookup for the current page is in flight. */
    isLoadingInvoices?: boolean;
    /** Open the invoice PDF preview for a row's invoice. */
    onPreviewInvoice?: (invoice: PaymentLogInvoiceDTO) => void;
    onRefresh?: () => void;
    /** Open the read-only detail slide-over for a row (fires on any non-editable cell). */
    onViewDetails?: (entry: PaymentLogEntry) => void;
}

/**
 * Columns whose cells host inline editing / actions — clicking them must NOT open the detail
 * slide-over, so the tracking editor and the row-click detail view don't fight over the same click.
 */
const NON_DETAIL_COLUMN_IDS = new Set([
    'tracking_id',
    'tracking_source',
    'order_status',
    'tracking_actions',
    // The invoice cell owns its own click (preview the PDF).
    'invoice',
]);

/**
 * Columns that carry the row's identity and are never hidden — a payment row without a date
 * or an amount isn't a payment row. They can still be dragged to a different position.
 */
const LOCKED_COLUMN_IDS = new Set(['payment_date', 'amount']);

interface EditingState {
    rowId: string;
    trackingId: string;
    trackingSource: string;
    orderStatus: string;
    isSaving: boolean;
}

// ─── Editing Context ──────────────────────────────────────────────────────────
// Cell components consume this context to read/write editing state.
// Because the cells are separate React components, they re-render independently
// when context changes — WITHOUT the column definitions needing to change.

interface EditingContextType {
    editing: EditingState | null;
    setEditing: (state: EditingState | null) => void;
    onSave: (entry: PaymentLogEntry) => void;
    onStartEdit: (entry: PaymentLogEntry) => void;
    onCancel: () => void;
}

const EditingContext = createContext<EditingContextType>({
    editing: null,
    setEditing: () => {},
    onSave: () => {},
    onStartEdit: () => {},
    onCancel: () => {},
});

// ─── Editable Cell Components ─────────────────────────────────────────────────
// These are standalone React components rendered inside column cells.
// They use useContext(EditingContext) so they re-render when editing state
// changes, but the column definitions themselves stay stable.

function TrackingIdCell({ entry }: { entry: PaymentLogEntry }) {
    const { editing, setEditing } = useContext(EditingContext);
    const isEditing = editing?.rowId === entry.payment_log.id;

    if (isEditing && editing) {
        return (
            <Input
                value={editing.trackingId}
                onChange={(e) => setEditing({ ...editing, trackingId: e.target.value })}
                placeholder="Enter tracking ID"
                className="h-8 text-xs"
                disabled={editing.isSaving}
            />
        );
    }

    return (
        <div className="font-mono text-xs text-neutral-600">
            {entry.payment_log.tracking_id || '—'}
        </div>
    );
}

function TrackingSourceCell({ entry }: { entry: PaymentLogEntry }) {
    const { editing, setEditing } = useContext(EditingContext);
    const isEditing = editing?.rowId === entry.payment_log.id;

    if (isEditing && editing) {
        return (
            <Input
                value={editing.trackingSource}
                onChange={(e) => setEditing({ ...editing, trackingSource: e.target.value })}
                placeholder="Enter source"
                className="h-8 text-xs"
                disabled={editing.isSaving}
            />
        );
    }

    return (
        <div className="text-xs text-neutral-600">{entry.payment_log.tracking_source || '—'}</div>
    );
}

function OrderStatusCell({ entry }: { entry: PaymentLogEntry }) {
    const { editing, setEditing } = useContext(EditingContext);
    const isEditing = editing?.rowId === entry.payment_log.id;

    if (isEditing && editing) {
        return (
            <Select
                value={editing.orderStatus}
                onValueChange={(val) => setEditing({ ...editing, orderStatus: val })}
                disabled={editing.isSaving}
            >
                <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                    {ORDER_STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    const status = entry.payment_log.order_status;
    if (!status) {
        return <span className="text-xs text-neutral-400">—</span>;
    }

    const colorClasses =
        ORDER_STATUS_COLOR_MAP[status] || 'bg-gray-100 text-neutral-600 border-gray-300';
    const label = ORDER_STATUS_LABEL_MAP[status] || status.replace(/_/g, ' ');

    return (
        <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colorClasses}`}
        >
            {label}
        </span>
    );
}

function ActionsCell({ entry }: { entry: PaymentLogEntry }) {
    const { editing, onSave, onStartEdit, onCancel } = useContext(EditingContext);
    const isPaid = entry.current_payment_status === 'PAID';
    const isEditing = editing?.rowId === entry.payment_log.id;

    if (!isPaid) {
        return <span className="text-xs text-neutral-300">—</span>;
    }

    if (isEditing && editing) {
        return (
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 p-0 text-green-600 hover:bg-green-50 hover:text-green-700"
                    onClick={() => onSave(entry)}
                    disabled={editing.isSaving}
                    title="Save"
                >
                    <FloppyDisk size={16} weight="bold" />
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 p-0 text-neutral-500 hover:bg-gray-100 hover:text-neutral-600"
                    onClick={onCancel}
                    disabled={editing.isSaving}
                    title="Cancel"
                >
                    <X size={16} weight="bold" />
                </Button>
            </div>
        );
    }

    return (
        <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0 text-neutral-500 hover:bg-gray-100 hover:text-neutral-600"
            onClick={() => onStartEdit(entry)}
            title="Edit tracking info"
        >
            <PencilSimple size={16} />
        </Button>
    );
}

// ─── Invoice Cell ─────────────────────────────────────────────────────────────
// Same context trick as the editing cells above: the invoice lookup resolves after the
// rows render, and routing it through context keeps the column definitions stable.

interface InvoiceContextType {
    /** Invoice per payment log id. A payment log with no invoice is simply absent. */
    invoices: Record<string, PaymentLogInvoiceDTO>;
    isLoading: boolean;
    onPreview?: (invoice: PaymentLogInvoiceDTO) => void;
}

const InvoiceContext = createContext<InvoiceContextType>({
    invoices: {},
    isLoading: false,
});

/** Invoice date in the same short form the rest of the table uses. */
const formatInvoiceDate = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

function InvoiceCell({ entry }: { entry: PaymentLogEntry }) {
    const { invoices, isLoading, onPreview } = useContext(InvoiceContext);
    const paymentLogId = entry?.payment_log?.id;
    // Rows that ARE an invoice carry it inline — no lookup needed, and none was made.
    const invoice = entry?.invoice ?? (paymentLogId ? invoices[paymentLogId] : undefined);

    if (!invoice) {
        // Still resolving: a placeholder rather than a dash, so a row that DOES have an
        // invoice doesn't flash "no invoice" before the lookup lands.
        if (isLoading) return <Skeleton className="h-4 w-24 bg-neutral-100" />;
        return <span className="text-xs text-neutral-400">—</span>;
    }

    const isVoided = invoice.status?.toUpperCase() === 'REJECTED';
    const subLabel = [formatInvoiceDate(invoice.invoice_date), isVoided ? 'Voided' : null]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
                <div
                    className={cn(
                        'truncate font-mono text-xs font-medium text-neutral-700',
                        isVoided && 'text-neutral-400 line-through'
                    )}
                    title={invoice.invoice_number}
                >
                    {invoice.invoice_number}
                </div>
                {subLabel && <div className="truncate text-2xs text-neutral-500">{subLabel}</div>}
            </div>
            {onPreview && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 shrink-0 p-0 text-neutral-500 hover:bg-primary-50 hover:text-primary-600"
                    onClick={(e) => {
                        e.stopPropagation();
                        onPreview(invoice);
                    }}
                    title={`Preview invoice ${invoice.invoice_number}`}
                >
                    <Eye size={16} />
                </Button>
            )}
        </div>
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatCurrency = (amount: number, currency: string) =>
    formatMoney(amount, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDate = (dateString: string, hasTime: boolean) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        // Date-only fallback: pin to UTC so the UTC-midnight marker never renders as the
        // previous day for admins west of UTC.
        ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : { timeZone: 'UTC' }),
    });
};

const formatRelativeTime = (dateString: string) => {
    if (!dateString) return '-';
    try {
        return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch {
        return '-';
    }
};

/** Next Due Date: the day, and under it whether it has passed, is today, or how far off it is. */
function NextDueCell({ value }: { value?: string | null }) {
    const label = formatPlanDate(value);
    if (!label) return <span className="text-xs text-neutral-400">—</span>;
    const state = dueState(value);
    const days = daysUntil(value) ?? 0;
    return (
        <div className="space-y-1">
            <div
                className={cn(
                    'text-sm font-medium',
                    state === 'overdue' ? 'text-danger-600' : 'text-neutral-700'
                )}
            >
                {label}
            </div>
            <div
                className={cn(
                    'text-xs',
                    state === 'overdue'
                        ? 'text-danger-500'
                        : state === 'today'
                          ? 'text-warning-600'
                          : 'text-neutral-500'
                )}
            >
                {state === 'overdue'
                    ? `Overdue by ${-days} day${days === -1 ? '' : 's'}`
                    : state === 'today'
                      ? 'Due today'
                      : `In ${days} day${days === 1 ? '' : 's'}`}
            </div>
        </div>
    );
}

// ─── Static Columns (defined outside component — never recreated) ─────────

const trackingIdColumn: ColumnDef<PaymentLogEntry> = {
    id: 'tracking_id',
    header: 'Tracking ID',
    accessorFn: (row) => row?.payment_log?.tracking_id || '',
    cell: ({ row }) => <TrackingIdCell entry={row.original} />,
    size: 150,
};

const trackingSourceColumn: ColumnDef<PaymentLogEntry> = {
    id: 'tracking_source',
    header: 'Tracking Source',
    accessorFn: (row) => row?.payment_log?.tracking_source || '',
    cell: ({ row }) => <TrackingSourceCell entry={row.original} />,
    size: 140,
};

const orderStatusColumn: ColumnDef<PaymentLogEntry> = {
    id: 'order_status',
    header: 'Order Status',
    accessorFn: (row) => row?.payment_log?.order_status || '',
    cell: ({ row }) => <OrderStatusCell entry={row.original} />,
    size: 160,
};

const invoiceColumn: ColumnDef<PaymentLogEntry> = {
    id: 'invoice',
    header: 'Invoice',
    // The invoice number isn't on the row — it arrives from a separate lookup the cell reads
    // out of context — so the accessor keys on the payment log the invoice belongs to.
    accessorFn: (row) => row?.payment_log?.id || '',
    cell: ({ row }) => <InvoiceCell entry={row.original} />,
    size: 190,
};

const actionsColumn: ColumnDef<PaymentLogEntry> = {
    id: 'tracking_actions',
    header: 'Actions',
    cell: ({ row }) => <ActionsCell entry={row.original} />,
    size: 80,
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function PaymentLogsTable({
    data,
    isLoading,
    error,
    currentPage,
    onPageChange,
    hasOrgAssociatedBatches,
    hideUserColumn = false,
    hiddenColumns,
    columnOrder,
    onColumnOrderChange,
    invoicesByPaymentLog,
    isLoadingInvoices = false,
    onPreviewInvoice,
    onRefresh,
    onViewDetails,
}: PaymentLogsTableProps) {
    const { toast } = useToast();
    const [editing, setEditing] = useState<EditingState | null>(null);

    const onStartEdit = useCallback((entry: PaymentLogEntry) => {
        setEditing({
            rowId: entry.payment_log.id,
            trackingId: entry.payment_log.tracking_id || '',
            trackingSource: entry.payment_log.tracking_source || '',
            orderStatus: entry.payment_log.order_status || '',
            isSaving: false,
        });
    }, []);

    const onCancel = useCallback(() => {
        setEditing(null);
    }, []);

    const onSave = useCallback(
        async (entry: PaymentLogEntry) => {
            // Read latest editing state directly — no stale closures
            setEditing((currentEditing) => {
                if (!currentEditing) return null;

                const originalTrackingId = entry.payment_log.tracking_id || '';
                const originalTrackingSource = entry.payment_log.tracking_source || '';
                const originalOrderStatus = entry.payment_log.order_status || '';

                const hasChanges =
                    currentEditing.trackingId !== originalTrackingId ||
                    currentEditing.trackingSource !== originalTrackingSource ||
                    currentEditing.orderStatus !== originalOrderStatus;

                if (!hasChanges) {
                    return null; // exit edit mode
                }

                // Validate — only order status is required (tracking info can be added later)
                if (!currentEditing.orderStatus) {
                    toast({
                        title: 'Validation Error',
                        description: 'Order Status must be selected.',
                        variant: 'destructive',
                    });
                    return currentEditing;
                }

                // Fire the API call (async, outside the setState)
                const doSave = async () => {
                    try {
                        await updatePaymentLogTracking({
                            payment_log_id: entry.payment_log.id,
                            tracking_id: currentEditing.trackingId.trim(),
                            tracking_source: currentEditing.trackingSource.trim(),
                            order_status: currentEditing.orderStatus,
                        });

                        toast({
                            title: 'Success',
                            description: 'Tracking info updated successfully.',
                        });

                        setEditing(null);
                        onRefresh?.();
                    } catch (err: unknown) {
                        const message =
                            err instanceof Error ? err.message : 'Failed to update tracking info.';
                        toast({
                            title: 'Error',
                            description: message,
                            variant: 'destructive',
                        });
                        setEditing((prev) => (prev ? { ...prev, isSaving: false } : null));
                    }
                };

                doSave();

                // Set isSaving immediately
                return { ...currentEditing, isSaving: true };
            });
        },
        [toast, onRefresh]
    );

    // Context value — cell components consume this
    const editingContextValue = useMemo<EditingContextType>(
        () => ({ editing, setEditing, onSave, onStartEdit, onCancel }),
        [editing, onSave, onStartEdit, onCancel]
    );

    const invoiceContextValue = useMemo<InvoiceContextType>(
        () => ({
            invoices: invoicesByPaymentLog ?? {},
            isLoading: isLoadingInvoices,
            onPreview: onPreviewInvoice,
        }),
        [invoicesByPaymentLog, isLoadingInvoices, onPreviewInvoice]
    );

    // Transform API response to TableData format
    const tableData: TableData<PaymentLogEntry> | undefined = useMemo(() => {
        if (!data) return undefined;
        return {
            content: data.content,
            total_pages: data.totalPages,
            page_no: data.number,
            page_size: data.size,
            total_elements: data.totalElements,
            last: data.last,
        };
    }, [data]);

    // Columns — only depends on layout flags, NOT editing state
    const columns = useMemo<ColumnDef<PaymentLogEntry>[]>(
        () => [
            {
                id: 'payment_date',
                header: 'Date & Time',
                accessorFn: (row) => paymentReceivedAt(row?.payment_log).value,
                cell: ({ row }) => {
                    const { value, hasTime } = paymentReceivedAt(row.original?.payment_log);
                    return (
                        <div className="space-y-1">
                            <div className="font-medium text-neutral-700">
                                {formatDate(value, hasTime)}
                            </div>
                            <div className="text-xs text-neutral-500">
                                {formatRelativeTime(value)}
                            </div>
                        </div>
                    );
                },
                size: 180,
            },
            ...(!hideUserColumn
                ? [
                      {
                          id: 'user_info',
                          header: 'User',
                          accessorFn: (row: PaymentLogEntry) =>
                              row?.user?.full_name || row?.user?.email || '',
                          cell: ({ row }: { row: { original: PaymentLogEntry } }) => {
                              const user = row.original?.user;
                              const name = user?.full_name || user?.email || '-';
                              return (
                                  <div className="flex items-center gap-2.5">
                                      <UserAvatar name={name} />
                                      <div className="min-w-0">
                                          <div className="truncate font-medium text-neutral-700">
                                              {user?.full_name || '-'}
                                          </div>
                                          <div className="truncate text-xs text-neutral-500">
                                              {user?.email || '-'}
                                          </div>
                                      </div>
                                  </div>
                              );
                          },
                          size: 220,
                      } as ColumnDef<PaymentLogEntry>,
                  ]
                : []),
            ...(hasOrgAssociatedBatches
                ? [
                      {
                          id: 'org_name',
                          header: 'Organization Name',
                          accessorFn: (row: PaymentLogEntry) =>
                              row?.user_plan?.sub_org_details?.name || '',
                          cell: ({ row }: { row: { original: PaymentLogEntry } }) => {
                              const userPlan = row.original?.user_plan;
                              const source = userPlan?.source;
                              const orgDetails = userPlan?.sub_org_details;

                              if (source === 'SUB_ORG') {
                                  if (orgDetails?.name) {
                                      return (
                                          <div className="space-y-1">
                                              <div className="font-medium text-neutral-700">
                                                  {orgDetails.name}
                                              </div>
                                              {orgDetails.address && (
                                                  <div className="text-xs text-neutral-500">
                                                      {orgDetails.address}
                                                  </div>
                                              )}
                                          </div>
                                      );
                                  }
                              }
                              return <div className="text-xs italic text-neutral-500">N/A</div>;
                          },
                          size: 200,
                      } as ColumnDef<PaymentLogEntry>,
                  ]
                : []),
            {
                id: 'amount',
                header: 'Amount',
                accessorFn: (row) => row?.payment_log?.payment_amount || 0,
                cell: ({ row }) => {
                    const amount = row.original?.payment_log?.payment_amount || 0;
                    const currency = resolveEntryCurrency(row.original);
                    return (
                        <div>
                            <div className="font-bold tabular-nums text-neutral-800">
                                {formatCurrency(amount, currency)}
                            </div>
                            <div className="text-xs text-neutral-500">
                                {derivePaymentTypeLabel(row.original)}
                            </div>
                        </div>
                    );
                },
                size: 150,
            },
            {
                id: 'current_payment_status',
                header: 'Payment',
                accessorFn: (row) => row?.current_payment_status || '',
                cell: ({ row }) => (
                    <PaymentStatusPill status={row.original?.current_payment_status} />
                ),
                size: 130,
            },
            {
                id: 'vendor',
                header: 'Payment Method',
                accessorFn: (row) => row?.payment_log?.vendor || '',
                cell: ({ row }) => {
                    const vendor = row.original?.payment_log?.vendor;
                    // Offline payments show how they were paid ("UPI · PhonePe") under the badge.
                    const paidVia = readRecordedPaymentDetails(row.original?.payment_log)?.label;
                    return <GatewayBadge vendor={vendor} showLabel size="sm" subLabel={paidVia ?? undefined} />;
                },
                size: 160,
            },
            {
                id: 'user_plan_status',
                header: 'Plan Status',
                accessorFn: (row) => row?.user_plan?.status || '',
                cell: ({ row }) => {
                    const status = row.original?.user_plan?.status;
                    if (!status) return <span className="text-xs text-neutral-400">—</span>;
                    return (
                        <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-2xs font-semibold text-neutral-600">
                            {status.replace(/_/g, ' ')}
                        </span>
                    );
                },
                size: 130,
            },
            {
                id: 'enroll_invite',
                header: `${getTerminology(ContentTerms.Course, SystemTerms.Course)}/Membership`,
                accessorFn: (row) => row?.user_plan?.enroll_invite?.name || '',
                cell: ({ row }) => {
                    const enrollInvite = row.original?.user_plan?.enroll_invite;
                    return (
                        <div className="space-y-1">
                            <div className="font-medium text-neutral-700">
                                {enrollInvite?.name || '-'}
                            </div>
                            <div className="text-xs text-neutral-500">
                                Code: {enrollInvite?.invite_code || '-'}
                            </div>
                        </div>
                    );
                },
                size: 200,
            },
            {
                id: 'enrolled_date',
                header: 'Enrollment Date',
                accessorFn: (row) => row?.enrolled_date || '',
                cell: ({ row }) => {
                    const label = formatPlanDate(row.original?.enrolled_date);
                    if (!label) return <span className="text-xs text-neutral-400">—</span>;
                    return <span className="text-sm text-neutral-700">{label}</span>;
                },
                size: 150,
            },
            {
                id: 'next_due_date',
                header: 'Next Due Date',
                accessorFn: (row) => row?.next_due_on || '',
                cell: ({ row }) => <NextDueCell value={row.original?.next_due_on} />,
                size: 160,
            },
            invoiceColumn,
            {
                id: 'transaction_id',
                header: 'Transaction ID',
                accessorFn: (row) => row?.payment_log?.transaction_id || '',
                cell: ({ row }) => {
                    const transactionId = row.original?.payment_log?.transaction_id;
                    return (
                        <div className="font-mono text-xs text-neutral-500">
                            {transactionId || '-'}
                        </div>
                    );
                },
                size: 140,
            },

            // ─── Tracking columns (rendered by context-aware components) ────
            trackingIdColumn,
            trackingSourceColumn,
            orderStatusColumn,
            actionsColumn,

            {
                id: 'payment_plan',
                header: 'Payment Plan',
                accessorFn: (row) => row?.user_plan?.payment_plan_dto?.name || '',
                cell: ({ row }) => {
                    const paymentPlan = row.original?.user_plan?.payment_plan_dto;
                    return (
                        <div className="space-y-1">
                            <div className="text-sm text-neutral-700">
                                {paymentPlan?.name || '-'}
                            </div>
                            <div className="text-xs text-neutral-500">
                                {paymentPlan?.validity_in_days
                                    ? `${paymentPlan.validity_in_days} days`
                                    : ''}
                            </div>
                        </div>
                    );
                },
                size: 180,
            },
        ],
        [hasOrgAssociatedBatches, hideUserColumn]
    );

    // The user's layout choice: which columns are on, and in what order. Date & Time and
    // Amount are never hidden — a payment row without them isn't a payment row — but they can
    // still be dragged, so the order is applied to every column.
    const visibleColumns = useMemo(() => {
        const shown =
            hiddenColumns && hiddenColumns.size > 0
                ? columns.filter(
                      (c) => !c.id || LOCKED_COLUMN_IDS.has(c.id) || !hiddenColumns.has(c.id)
                  )
                : columns;

        if (!columnOrder || columnOrder.length === 0) return shown;

        const byId = new Map(shown.map((c) => [c.id as string, c]));
        return orderColumnIds([...byId.keys()], columnOrder)
            .map((id) => byId.get(id))
            .filter((c): c is ColumnDef<PaymentLogEntry> => !!c);
    }, [columns, hiddenColumns, columnOrder]);

    if (error) {
        return (
            <div className="rounded-lg border border-danger-200 bg-danger-50 p-8 text-center">
                <p className="font-medium text-danger-700">Error loading payment logs</p>
                <p className="mt-2 text-body text-danger-600">
                    {error instanceof Error ? error.message : 'Unknown error occurred'}
                </p>
            </div>
        );
    }

    const isEmpty = !isLoading && !!tableData && tableData.content.length === 0;

    return (
        <EditingContext.Provider value={editingContextValue}>
            <InvoiceContext.Provider value={invoiceContextValue}>
                <div className="space-y-4">
                    {isEmpty ? (
                        <div className="rounded-lg border border-border bg-card p-12 text-center">
                            <p className="text-title font-medium text-neutral-700">
                                No payment records found
                            </p>
                            <p className="mt-2 text-body text-neutral-500">
                                Try adjusting your filters to see more results
                            </p>
                        </div>
                    ) : (
                        <MyTable
                            data={tableData}
                            columns={visibleColumns}
                            isLoading={isLoading}
                            error={null}
                            currentPage={currentPage}
                            scrollable={true}
                            enableColumnResizing={true}
                            enableColumnPinning={false}
                            enableColumnReorder={!!onColumnOrderChange}
                            onColumnOrderChange={onColumnOrderChange}
                            onCellClick={
                                onViewDetails
                                    ? (row, column) => {
                                          if (column.id && NON_DETAIL_COLUMN_IDS.has(column.id))
                                              return;
                                          onViewDetails(row);
                                      }
                                    : undefined
                            }
                        />
                    )}

                    {tableData && tableData.total_pages > 1 && (
                        <MyPagination
                            currentPage={currentPage}
                            totalPages={tableData.total_pages}
                            onPageChange={onPageChange}
                        />
                    )}
                </div>
            </InvoiceContext.Provider>
        </EditingContext.Provider>
    );
}
