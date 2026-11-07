import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
import { CpoInstallmentsEditor } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-payment-history/cpo-installments-editor';
// react-query imports consolidated below to avoid a duplicate-import lint.
import {
    getInvoicesByUser,
    downloadInvoicePdf,
    buildInvoiceFilename,
    triggerInvoiceReminderForSfp,
    sendInvoiceReminder,
    type InvoiceSummary,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getInvoiceDownloadUrl } from '@/services/invoice-service';
import { isCallerSubOrgAdmin } from '@/lib/auth/facultyAccessUtils';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { CreateInvoiceDialog } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-payment-history/create-invoice-dialog';
import { MarkPaidDialog } from './mark-paid-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Bell, Copy, Plus } from '@phosphor-icons/react';
import { BookOpen, CircleCheck, Download, ExternalLink, FileText, Lock } from 'lucide-react';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/**
 * Resolve a working URL for the invoice. Mirrors manage-students payment-history:
 *  - if `pdf_url` is present, use it directly (already a presigned S3 link)
 *  - otherwise, if `pdf_file_id` exists, fall back to the backend's download endpoint
 *    which 302-redirects to a freshly-presigned URL
 *  - returns null when neither is present (truly no PDF on this row)
 */
function resolveInvoiceUrl(inv: InvoiceSummary): string | null {
    const direct = inv.pdf_url || inv.pdfUrl;
    if (direct) return direct;
    const fileId = inv.pdf_file_id || inv.pdfFileId || inv.file_id || inv.fileId;
    if (fileId) return getInvoiceDownloadUrl(inv.id);
    // Synthetic SFP rows that link to a real Invoice expose its id on `inv.id` —
    // call the canonical endpoint which regenerates the PDF when missing. Rows
    // still keyed by "sfp:..." have no payment yet → leave as No PDF.
    if (typeof inv.id === 'string' && !inv.id.startsWith('sfp:')) {
        const status = String(inv.status || '').toUpperCase();
        if (status === 'PAID' || status === 'PARTIAL' || status === 'PARTIAL_PAID') {
            return getInvoiceDownloadUrl(inv.id);
        }
    }
    return null;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userId: string | null;
    userName?: string | null;
    /** Short context line ("Sub-org admin", "Learner — Class · 2026-2027", "Team member"). */
    subtitle?: string;
    /** Courses the member is enrolled into (id + resolved "Course · Level · Session" label).
     *  Rendered as a read-only list at the top of the drawer when non-empty. Optional —
     *  callers that don't have course data (e.g. the admin "Open history") simply omit it. */
    courses?: { id: string; label: string }[];
    /** When true, the installment editor is visually disabled. The parent-institute
     *  admin is the only role that can edit a sub-org admin's CPO ledger; sub-org
     *  admins must NOT edit their own finance agreement. Backend also enforces. */
    readOnly?: boolean;
}

/**
 * Right-side drawer that surfaces CPO installments + invoices for any user — same component
 * the learners-list side-view uses. `CpoInstallmentsEditor` silently renders nothing for
 * users without a CPO UserPlan, so it's safe to mount for FREE learners / team members too.
 */
export function MemberHistoryDrawer({
    open,
    onOpenChange,
    userId,
    userName,
    subtitle,
    courses,
    readOnly = false,
}: Props) {
    const { t } = useTranslation('manageCustomTeamsMemberHistoryDrawer');
    // Institutes rename this concept via Settings → Naming (Channel Partner,
    // Branch, Franchise, VLE …); user-facing labels must follow that.
    const subOrgTerm = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="flex w-full flex-col gap-0 p-0 sm:max-w-[640px]"
            >
                <SheetHeader className="border-b px-6 py-4">
                    <SheetTitle className="text-lg">
                        {userName || t('defaultMemberName')}
                    </SheetTitle>
                    {subtitle && (
                        <SheetDescription>{subtitle}</SheetDescription>
                    )}
                </SheetHeader>

                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {userId ? (
                        <div className="space-y-6">
                            {courses && courses.length > 0 && (
                                <section>
                                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
                                        <BookOpen className="h-4 w-4" />
                                        {t('enrolledCourses', { count: courses.length })}
                                    </h3>
                                    <ul className="space-y-1 rounded-md border">
                                        {courses.map((c) => (
                                            <li
                                                key={c.id}
                                                className="flex items-center gap-2 border-b border-muted px-3 py-2 text-xs last:border-b-0"
                                            >
                                                <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                <span className="truncate">{c.label}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}
                            {readOnly && (
                                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <div>
                                        <p className="font-medium">{t('readOnlyLedger.title')}</p>
                                        <p>
                                            {t('readOnlyLedger.body', {
                                                org: subOrgTerm.toLowerCase(),
                                            })}
                                        </p>
                                    </div>
                                </div>
                            )}
                            {/*
                              CpoInstallmentsEditor doesn't expose a readOnly prop, so we
                              gate it visually + interactively at the wrapper. The backend
                              also enforces — PUT installment / cpo-discount / record
                              offline-payment endpoints return 403 for sub-org admins.
                            */}
                            <div
                                className={
                                    readOnly
                                        ? 'pointer-events-none select-none opacity-60'
                                        : ''
                                }
                                aria-disabled={readOnly}
                            >
                                <CpoInstallmentsEditor userId={userId} />
                            </div>

                            {/* Invoices list. The Create Invoice CTA is intentionally
                                NOT gated by `readOnly` — sub-org admins are allowed to
                                raise ad-hoc invoices against their members. The CPO
                                ledger above stays read-only for them as before. */}
                            <InvoicesSection userId={userId} userName={userName} />
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">{t('noMemberSelected')}</p>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}

function InvoicesSection({ userId, userName }: { userId: string; userName?: string | null }) {
    const { t } = useTranslation('manageCustomTeamsMemberHistoryDrawer');
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() || '';
    const { data: invoices = [], isLoading } = useQuery<InvoiceSummary[]>({
        queryKey: ['member-invoices', userId],
        queryFn: () => getInvoicesByUser(userId),
        enabled: !!userId,
    });
    const canRemind = !isCallerSubOrgAdmin();
    const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);
    const [remindingId, setRemindingId] = useState<string | null>(null);
    // Two parallel UI states for the per-row PENDING_PAYMENT actions:
    //   - copiedLinkId   → flips a row's Copy Link button to "Copied" for 2s
    //   - markPaidTarget → opens the MarkPaidDialog scoped to one invoice at a time
    const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
    const [markPaidTarget, setMarkPaidTarget] = useState<{ id: string; number?: string } | null>(null);

    const handleCopyLink = async (invoiceId: string, link: string) => {
        try {
            await navigator.clipboard.writeText(link);
            setCopiedLinkId(invoiceId);
            toast.success(t('toast.linkCopied'));
            window.setTimeout(() => {
                setCopiedLinkId((prev) => (prev === invoiceId ? null : prev));
            }, 2000);
        } catch (_err) {
            toast.error(t('toast.copyFailed'));
        }
    };
    const remindMutation = useMutation({
        mutationFn: (sfpId: string) => triggerInvoiceReminderForSfp(sfpId),
        onMutate: (sfpId) => setRemindingId(sfpId),
        onSettled: () => setRemindingId(null),
        onSuccess: (data) => {
            toast.success(
                data?.recipient_email
                    ? t('toast.reminderSentTo', { email: data.recipient_email })
                    : t('toast.reminderFired')
            );
            queryClient.invalidateQueries({ queryKey: ['member-invoices', userId] });
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || t('toast.reminderFailed'));
        },
    });
    // Separate mutation for admin-invoice reminders. Different endpoint + payload
    // than the SFP reminder; shares the remindingId state so only one row spins.
    const invoiceReminderMutation = useMutation({
        mutationFn: (invoiceId: string) => sendInvoiceReminder(invoiceId),
        onMutate: (invoiceId) => setRemindingId(invoiceId),
        onSettled: () => setRemindingId(null),
        onSuccess: (data) => {
            const channels: string[] = [];
            if (data.alert_sent) channels.push(t('channels.inApp'));
            if (data.email_sent) channels.push(t('channels.email'));
            const where = data.recipient_email ? ` ${t('toast.toRecipient', { email: data.recipient_email })}` : '';
            toast.success(
                channels.length > 0
                    ? t('toast.invoiceReminderSentVia', { where, channels: channels.join(' + ') })
                    : t('toast.invoiceReminderNoChannels', { where })
            );
            queryClient.invalidateQueries({ queryKey: ['member-invoices', userId] });
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || t('toast.invoiceReminderFailed'));
        },
    });

    if (isLoading) {
        return (
            <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <FileText className="h-4 w-4" />
                    {t('invoices.heading')}
                </h3>
                <p className="text-xs text-muted-foreground">{t('invoices.loading')}</p>
            </section>
        );
    }

    // No early-return on empty list — we still need to render the section so the
    // Create Invoice CTA is reachable when the member has zero invoices yet.

    return (
        <section>
            <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <FileText className="h-4 w-4" />
                    {t('invoices.headingWithCount', { count: invoices.length })}
                </h3>
                {!!userId && !!instituteId && (
                    <button
                        type="button"
                        onClick={() => setCreateInvoiceOpen(true)}
                        className="inline-flex items-center gap-1 rounded border border-primary-300 bg-primary-50 px-2 py-1 text-[11px] font-medium text-primary-700 hover:bg-primary-100"
                    >
                        <Plus className="h-3 w-3" />
                        {t('invoices.createInvoice')}
                    </button>
                )}
            </div>
            {invoices.length === 0 && (
                <p className="mb-2 text-xs text-muted-foreground">
                    {t('invoices.noInvoicesYet')}
                </p>
            )}
            <ul className="space-y-1 rounded-md border">
                {invoices.map((inv) => {
                    const number =
                        inv.invoice_number || inv.invoiceNumber || inv.id;
                    const date = inv.invoice_date || inv.invoiceDate;
                    const amount = inv.total_amount ?? inv.totalAmount;
                    const url = resolveInvoiceUrl(inv);
                    const status = String(inv.status || '').toUpperCase();
                    const isSfpRow = typeof inv.id === 'string' && inv.id.startsWith('sfp:');
                    const sfpId = isSfpRow ? inv.id.slice('sfp:'.length) : null;
                    const isRemindable =
                        canRemind
                        && !!sfpId
                        && (status === 'PENDING'
                            || status === 'UNPAID'
                            || status === 'OVERDUE'
                            || status === 'PARTIAL'
                            || status === 'PARTIAL_PAID');
                    // Admin invoices that are pending payment carry a payment_link +
                    // are eligible for Mark Paid. SFP synthetic rows never carry these.
                    const paymentLink = inv.payment_link || inv.paymentLink;
                    const isPendingAdminInvoice =
                        !isSfpRow && status === 'PENDING_PAYMENT' && typeof inv.id === 'string';
                    return (
                        <li
                            key={inv.id}
                            className="flex items-center justify-between gap-2 border-b border-muted px-3 py-2 text-xs last:border-b-0"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">{number}</p>
                                <p className="text-[10px] text-muted-foreground">
                                    {date ? fmtDate(date) : '—'}
                                    {inv.status ? ` · ${inv.status}` : ''}
                                </p>
                            </div>
                            <span className="shrink-0 font-medium">{fmtMoney(amount)}</span>
                            {isRemindable && sfpId && (
                                <button
                                    type="button"
                                    onClick={() => remindMutation.mutate(sfpId)}
                                    disabled={remindingId === sfpId}
                                    className="inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                    title={t('invoices.sendInstallmentReminderTitle')}
                                >
                                    <Bell className="size-3" />
                                    {remindingId === sfpId ? t('invoices.sending') : t('invoices.remind')}
                                </button>
                            )}
                            {isPendingAdminInvoice && (
                                <button
                                    type="button"
                                    onClick={() => invoiceReminderMutation.mutate(inv.id)}
                                    disabled={remindingId === inv.id}
                                    className="inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                    title={t('invoices.resendPaymentReminderTitle')}
                                >
                                    <Bell className="size-3" />
                                    {remindingId === inv.id ? t('invoices.sending') : t('invoices.remind')}
                                </button>
                            )}
                            {isPendingAdminInvoice && paymentLink && (
                                <button
                                    type="button"
                                    onClick={() => handleCopyLink(inv.id, paymentLink)}
                                    className="inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
                                    title={t('invoices.copyPaymentLinkTitle')}
                                >
                                    {copiedLinkId === inv.id ? (
                                        <>
                                            <CircleCheck className="size-3" />
                                            {t('invoices.copied')}
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="size-3" />
                                            {t('invoices.copyLink')}
                                        </>
                                    )}
                                </button>
                            )}
                            {isPendingAdminInvoice && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        setMarkPaidTarget({
                                            id: inv.id,
                                            number:
                                                inv.invoice_number || inv.invoiceNumber || inv.id,
                                        })
                                    }
                                    className="inline-flex shrink-0 items-center gap-1 rounded border border-primary-300 bg-primary-50 px-2 py-1 text-[10px] uppercase tracking-wide text-primary-700 hover:bg-primary-100"
                                    title={t('invoices.markPaidTitle')}
                                >
                                    {t('invoices.markPaid')}
                                </button>
                            )}
                            {url ? (
                                <div className="flex shrink-0 items-center gap-1">
                                    <a
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
                                        title={t('invoices.viewPdfTitle')}
                                    >
                                        <ExternalLink className="h-3 w-3" />
                                        {t('invoices.view')}
                                    </a>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            downloadInvoicePdf(url, buildInvoiceFilename(inv))
                                        }
                                        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
                                        title={t('invoices.downloadPdfTitle')}
                                    >
                                        <Download className="h-3 w-3" />
                                        {t('invoices.save')}
                                    </button>
                                </div>
                            ) : (
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                    {t('invoices.noPdf')}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
            {/* Same dialog manage-students uses on the learner side-view payment-history.
                Reused as-is so behaviour (line items, currency, due-date, gateway link,
                PDF generation) is identical across both surfaces. Successful create
                invalidates this section's `member-invoices` cache so the new row
                appears immediately. */}
            <CreateInvoiceDialog
                userId={userId}
                userName={userName || t('defaultMemberName')}
                instituteId={instituteId}
                open={createInvoiceOpen}
                onOpenChange={setCreateInvoiceOpen}
                onSuccess={() => {
                    queryClient.invalidateQueries({ queryKey: ['member-invoices', userId] });
                }}
            />
            {/* Per-row Mark Paid action. Opens only when the user clicks Mark Paid on a
                PENDING_PAYMENT row — markPaidTarget carries both the id (for the API
                call) and the human invoice number (for the dialog title + toast). */}
            <MarkPaidDialog
                open={!!markPaidTarget}
                onOpenChange={(o) => !o && setMarkPaidTarget(null)}
                invoiceId={markPaidTarget?.id || ''}
                invoiceNumber={markPaidTarget?.number}
                onSuccess={() =>
                    queryClient.invalidateQueries({ queryKey: ['member-invoices', userId] })
                }
            />
        </section>
    );
}

function fmtMoney(v: number | null | undefined): string {
    if (v == null) return '—';
    return `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null | undefined): string {
    if (!d) return '—';
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) return d;
    return parsed.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}
