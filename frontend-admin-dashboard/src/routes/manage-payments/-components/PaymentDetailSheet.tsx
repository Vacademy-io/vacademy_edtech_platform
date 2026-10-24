import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusChip } from '@/components/design-system/status-chips';
import { MyButton } from '@/components/design-system/button';
import { Check, Clock, Copy, Prohibit, Trash, XCircle, UserCircle } from '@phosphor-icons/react';
import { isDeletablePayment, isVoidablePayment } from '@/services/payment-logs';
import { VoidPaymentDialog, type VoidPaymentTarget } from './VoidPaymentDialog';
import { PermanentDeleteDialog, type PermanentDeleteTarget } from './PermanentDeleteDialog';
import { useCanDeletePayments } from '../-hooks/useCanDeletePayments';
import { toast } from 'sonner';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import type { StudentTable } from '@/types/student-table-types';
import { formatDistanceToNow } from 'date-fns';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { formatMoney, resolveEntryCurrency } from '@/utils/payment-currency';
import { derivePaymentTypeLabel } from '../-utils/exportPaymentLogsCsv';
import { entryPaymentStatus, paymentStatusMeta } from '../-utils/paymentStatus';
import { GatewayBadge } from './GatewayBadge';
import { readRecordedPaymentDetails } from '@/services/offline-payment-modes';
import { getPublicUrl } from '@/services/upload_file';
import type { PaymentLogEntry } from '@/types/payment-logs';

interface PaymentDetailSheetProps {
    entry: PaymentLogEntry | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called once a payment has been voided from this sheet. */
    onVoided?: () => void;
}

/** When and why a payment was voided, from the audit keys the server writes on the log. */
const readVoidAudit = (raw?: string | null): { at?: string; reason?: string } => {
    if (!raw) return {};
    try {
        const data = JSON.parse(raw) as { voided_at?: string; void_reason?: string };
        return { at: data.voided_at, reason: data.void_reason };
    } catch {
        return {};
    }
};

const initials = (name?: string) =>
    (name || '?')
        .split(' ')
        .map((w) => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase();

const formatTimestamp = (raw?: string | null, hasTime?: boolean): string => {
    if (!raw) return '—';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : { timeZone: 'UTC' }),
    });
};

const relative = (raw?: string | null): string => {
    if (!raw) return '';
    try {
        return formatDistanceToNow(new Date(raw), { addSuffix: true });
    } catch {
        return '';
    }
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-4 py-2">
            <dt className="text-caption text-neutral-500">{label}</dt>
            <dd className="text-right text-body font-medium text-neutral-700">{children}</dd>
        </div>
    );
}

interface TimelineEvent {
    done: boolean;
    title: string;
    meta: string;
}

/** Read-only detail panel for a single payment row: identity, key facts, and a status timeline. */
export function PaymentDetailSheet({
    entry,
    open,
    onOpenChange,
    onVoided,
}: PaymentDetailSheetProps) {
    // Opens the same full-screen student profile overlay the students list uses.
    const { openOverlay } = useStudentSidebar();
    const [voidTarget, setVoidTarget] = useState<VoidPaymentTarget | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<PermanentDeleteTarget | null>(null);
    // Display Settings permission — off unless the institute turned it on for this role.
    const canDeletePayments = useCanDeletePayments();

    if (!entry) return <Sheet open={open} onOpenChange={onOpenChange} />;

    const { payment_log: log, user, user_plan: plan } = entry;
    // How an offline payment was made, as the admin recorded it (null for gateway payments).
    const recorded = readRecordedPaymentDetails(log);
    const openProof = async (fileId: string) => {
        const url = await getPublicUrl(fileId);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        else toast.error('Could not open the proof file.');
    };

    const openStudentProfile = () => {
        if (!user?.id) {
            toast.error('No student is linked to this payment.');
            return;
        }
        // The overlay hydrates the rest of the profile from the user id; we only seed the header.
        const seed = {
            id: user.id,
            user_id: user.id,
            full_name: user.full_name ?? '',
            email: user.email ?? '',
            mobile_number: user.mobile_number ?? '',
            status: 'INACTIVE',
        } as unknown as StudentTable;
        onOpenChange(false);
        openOverlay(seed);
    };
    const isVoided = (log?.payment_status || '').toUpperCase() === 'VOIDED';
    const meta = paymentStatusMeta(entryPaymentStatus(entry));
    // Invoice rows carry the invoice id in payment_log.id, so only real payment rows qualify.
    const canVoid =
        !entry.invoice && !!log?.id && isVoidablePayment(log.vendor, log.payment_status);
    const canDelete =
        canDeletePayments &&
        !entry.invoice &&
        !!log?.id &&
        isDeletablePayment(log.vendor, log.payment_status);
    // An invoice row (raised, never paid against) can be deleted too, under the same switch. A paid
    // invoice has a live payment behind it and is refused by the server, so it is not offered.
    const canDeleteInvoice =
        canDeletePayments &&
        !!entry.invoice?.invoice_id &&
        (entry.invoice.status || '').toUpperCase() !== 'PAID';
    const currency = resolveEntryCurrency(entry);
    const amount = log?.payment_amount || 0;
    const hasTime = Boolean(log?.created_at);
    const timestamp = log?.created_at || log?.date;
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);

    const timeline: TimelineEvent[] = [
        {
            done: true,
            title: 'Payment initiated',
            meta: `${formatTimestamp(timestamp, hasTime)}${
                relative(timestamp) ? ` · ${relative(timestamp)}` : ''
            }`,
        },
    ];
    if (isVoided) {
        const audit = readVoidAudit(log?.payment_specific_data);
        timeline.push({ done: true, title: 'Payment recorded', meta: log?.vendor || 'Offline' });
        timeline.push({
            done: false,
            title: 'Voided — not counted as collected',
            meta: [audit.at ? formatTimestamp(audit.at, true) : '', audit.reason || '']
                .filter(Boolean)
                .join(' · '),
        });
    } else if (meta.chip === 'SUCCESS') {
        timeline.push({ done: true, title: 'Payment captured', meta: log?.vendor || 'Gateway' });
        timeline.push({
            done: true,
            title: `${courseTerm} / membership activated`,
            meta: plan?.enroll_invite?.name || '—',
        });
    } else if (meta.chip === 'DANGER') {
        timeline.push({ done: false, title: 'Attempt failed', meta: log?.vendor || 'Gateway' });
    } else {
        timeline.push({
            done: false,
            title: 'Awaiting confirmation',
            meta: 'Not yet captured by the gateway',
        });
    }

    const copyId = async () => {
        const id = log?.transaction_id || log?.id || '';
        try {
            await navigator.clipboard.writeText(id);
            toast.success('Transaction ID copied');
        } catch {
            toast.error('Could not copy to clipboard');
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
                <SheetHeader className="border-b border-neutral-200 p-5 text-left">
                    <SheetTitle className="text-title">Payment details</SheetTitle>
                    <p className="font-mono text-caption text-neutral-500">
                        {log?.transaction_id || log?.id || '—'}
                    </p>
                </SheetHeader>

                <div className="flex-1 space-y-5 p-5">
                    {/* Hero */}
                    <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-subtitle font-semibold text-primary-600">
                            {initials(user?.full_name || user?.email)}
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-body font-semibold text-neutral-700">
                                {user?.full_name || '—'}
                            </div>
                            <div className="truncate text-caption text-neutral-500">
                                {user?.email || '—'}
                            </div>
                            <button
                                type="button"
                                onClick={openStudentProfile}
                                className="mt-1 inline-flex items-center gap-1 text-caption font-semibold text-primary-600 hover:text-primary-700"
                            >
                                <UserCircle size={14} weight="fill" />
                                View profile
                            </button>
                        </div>
                        <div className="text-right">
                            <div className="text-title font-semibold text-neutral-800">
                                {formatMoney(amount, currency, { maximumFractionDigits: 2 })}
                            </div>
                            <div className="mt-1 flex justify-end">
                                <StatusChip
                                    text={meta.label}
                                    textSize="text-caption"
                                    status={meta.chip}
                                    showIcon={false}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Key-value facts */}
                    <dl className="divide-y divide-neutral-100">
                        <Row label="Payment gateway">
                            <GatewayBadge
                                vendor={log?.vendor}
                                showLabel
                                size="sm"
                                className="justify-end"
                            />
                        </Row>
                        {recorded?.label && <Row label="Paid via">{recorded.label}</Row>}
                        {recorded?.reference && <Row label="Payment reference">{recorded.reference}</Row>}
                        {recorded?.extra.cheque_date && <Row label="Cheque date">{recorded.extra.cheque_date}</Row>}
                        {recorded?.extra.bank_name && <Row label="Bank">{recorded.extra.bank_name}</Row>}
                        {recorded?.extra.payer_name && <Row label="Paid by">{recorded.extra.payer_name}</Row>}
                        {recorded?.custom.map((c) => (
                            <Row key={c.key} label={c.label}>
                                {c.value}
                            </Row>
                        ))}
                        {recorded?.notes && <Row label="Notes">{recorded.notes}</Row>}
                        {recorded?.proofFileId && (
                            <Row label="Proof">
                                <button
                                    type="button"
                                    onClick={() => void openProof(recorded.proofFileId!)}
                                    className="font-medium text-primary-600 hover:underline"
                                >
                                    View proof
                                </button>
                            </Row>
                        )}
                        <Row label="Payment type">{derivePaymentTypeLabel(entry)}</Row>
                        <Row label="Phone">{user?.mobile_number || '—'}</Row>
                        <Row label={`${courseTerm} / membership`}>
                            {plan?.enroll_invite?.name || '—'}
                        </Row>
                        <Row label="Invite code">{plan?.enroll_invite?.invite_code || '—'}</Row>
                        <Row label="Plan status">
                            {plan?.status ? plan.status.replace(/_/g, ' ') : '—'}
                        </Row>
                        <Row label="Payment plan">{plan?.payment_plan_dto?.name || '—'}</Row>
                        {plan?.source === 'SUB_ORG' && plan?.sub_org_details?.name && (
                            <Row label="Organization">{plan.sub_org_details.name}</Row>
                        )}
                    </dl>

                    {/* Activity timeline */}
                    <div>
                        <div className="mb-3 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                            Activity
                        </div>
                        <ol className="space-y-3">
                            {timeline.map((ev, i) => (
                                <li key={i} className="flex gap-3">
                                    <span
                                        className={
                                            ev.done
                                                ? 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success-100 text-success-600'
                                                : meta.chip === 'DANGER'
                                                  ? 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-danger-100 text-danger-600'
                                                  : 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-warning-100 text-warning-600'
                                        }
                                    >
                                        {ev.done ? (
                                            <Check size={12} weight="bold" />
                                        ) : meta.chip === 'DANGER' ? (
                                            <XCircle size={12} weight="bold" />
                                        ) : (
                                            <Clock size={12} weight="bold" />
                                        )}
                                    </span>
                                    <div>
                                        <div className="text-body font-medium text-neutral-700">
                                            {ev.title}
                                        </div>
                                        <div className="text-caption text-neutral-500">
                                            {ev.meta}
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </div>
                </div>

                <div className="space-y-2 border-t border-neutral-200 p-4">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        className="w-full gap-2"
                        onClick={copyId}
                    >
                        <Copy size={16} />
                        Copy transaction ID
                    </MyButton>
                    {/* Offline / manual payments only — a gateway payment is refunded, not voided. */}
                    {canVoid && (
                        <MyButton
                            buttonType="text"
                            scale="medium"
                            className="w-full gap-2 text-danger-600"
                            onClick={() =>
                                setVoidTarget({
                                    paymentLogId: log?.id ?? '',
                                    amount: log?.payment_amount,
                                    currency,
                                })
                            }
                        >
                            <Prohibit size={16} />
                            Void payment (recorded by mistake)
                        </MyButton>
                    )}
                    {canDelete && (
                        <MyButton
                            buttonType="text"
                            scale="medium"
                            className="w-full gap-2 text-danger-600"
                            onClick={() =>
                                setDeleteTarget({
                                    kind: 'payment',
                                    id: log?.id ?? '',
                                    label: formatMoney(amount, currency, {
                                        maximumFractionDigits: 2,
                                    }),
                                })
                            }
                        >
                            <Trash size={16} />
                            Delete permanently
                        </MyButton>
                    )}
                    {canDeleteInvoice && entry.invoice && (
                        <MyButton
                            buttonType="text"
                            scale="medium"
                            className="w-full gap-2 text-danger-600"
                            onClick={() =>
                                setDeleteTarget({
                                    kind: 'invoice',
                                    id: entry.invoice?.invoice_id ?? '',
                                    label: entry.invoice?.invoice_number ?? '',
                                })
                            }
                        >
                            <Trash size={16} />
                            Delete invoice permanently
                        </MyButton>
                    )}
                </div>
            </SheetContent>
            <PermanentDeleteDialog
                target={deleteTarget}
                onOpenChange={(o) => !o && setDeleteTarget(null)}
                onDeleted={() => {
                    onOpenChange(false);
                    onVoided?.();
                }}
            />
            <VoidPaymentDialog
                target={voidTarget}
                onOpenChange={(o) => !o && setVoidTarget(null)}
                onVoided={() => {
                    onOpenChange(false);
                    onVoided?.();
                }}
            />
        </Sheet>
    );
}
