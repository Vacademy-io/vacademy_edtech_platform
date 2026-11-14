import { useQuery } from '@tanstack/react-query';
import {
    Wallet,
    Users,
    FileText,
    BookOpen,
    GraduationCap,
    CaretDown,
    CheckCircle,
    DownloadSimple,
} from '@phosphor-icons/react';
import {
    getSubOrgFinanceDetail,
    getScopedInvites,
    getInvoicesByUser,
    type SubOrgFinanceDetail,
    type InvoiceSummary,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import {
    getInvoiceDownloadUrl,
    fetchInvoiceById,
    fetchUserAccountSummary,
    fetchUserAccountLedger,
    rejectInvoice,
    type InvoiceDTO,
    type UserAccountSummaryDTO,
    type UserAccountLedgerEntryDTO,
} from '@/services/invoice-service';
import { downloadInvoicePdf as downloadNamedInvoicePdf } from '@/services/invoice-pdf';
import { InvoicePreviewDialog } from '@/components/common/invoice/invoice-preview-dialog';
import { getPaymentOptions } from '@/services/payment-options';
import type { PaymentOptionApi } from '@/types/payment';
import { getCurrencySymbol } from '@/routes/settings/-components/Payment/utils/utils';
import { formatPlanPrice } from '@/utils/finance-utils';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { subOrgPermission } from '@/lib/display-settings/sub-org-module';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import { isCallerSubOrgAdmin } from '@/lib/auth/facultyAccessUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Copy, CopySimple, Eye, PencilSimple, Plus, XCircle, ArrowCircleUp, ArrowCircleDown, ClockCounterClockwise } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { MyButton } from '@/components/design-system/button';
import { MemberHistoryDrawer } from '@/routes/manage-custom-teams/sub-orgs/-components/member-history-drawer';
import { RecordSubOrgPaymentDialog } from '@/routes/manage-custom-teams/sub-orgs/-components/record-sub-org-payment-dialog';
import {
    triggerInvoiceReminderForSfp,
    sendInvoiceReminder,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import { CreateInvoiceDialog } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-payment-history/create-invoice-dialog';

// Add-admin-user form (CPO installment editor + discount card). Used to be mounted
// at deep-page level which made it visible on every tab; it now lives inside the
// Admin Payment tab where the admin enrollment context belongs.
import { AddUserToSubOrgSection } from '@/routes/manage-custom-teams/sub-orgs/-components/sub-org-detail-modal';
import { MarkPaidDialog } from '@/routes/manage-custom-teams/sub-orgs/-components/mark-paid-dialog';
import { CustomTeamsList } from '@/routes/manage-custom-teams/-components/custom-teams-list';

interface Props {
    subOrgId: string;
    subOrgName?: string;
    /**
     * When true, the panel only renders the **Admin payment** + **Team** tabs
     * (and their corresponding KPI tile). Used by the sub-org-admin route
     * `/manage-suborg-teams` — sub-org admins don't need to browse course/learner/
     * invoice detail; only their own payment status and their team members.
     *
     * Defaults to `false` (full 5-tab + 4-tile view) so the institute-admin deep
     * route `/manage-custom-teams/sub-orgs/$slug` stays unaffected.
     */
    restrictedView?: boolean;
    /**
     * Page chrome. `'panel'` (default) is the compact card the institute-admin deep
     * route embeds. `'page'` matches the Manage <SubOrgs> list: the underlined strip of
     * filled tab pills, and no tile row — on that layout the headline figures live in
     * the page header (`SubOrgStatCards`) instead, so keeping the tiles here would
     * print the same numbers twice.
     */
    variant?: 'panel' | 'page';
}

/**
 * Pick a working URL for an invoice. Direct `pdf_url` first; otherwise the canonical
 * /v1/invoices/{invoiceId}/download endpoint (which regenerates the PDF on the fly).
 * Synthetic SFP rows with no payment yet return null → "No PDF".
 */
function resolveInvoiceUrl(inv: InvoiceSummary): string | null {
    const direct = inv.pdf_url || inv.pdfUrl;
    if (direct) return direct;
    const fileId = inv.pdf_file_id || inv.pdfFileId || inv.file_id || inv.fileId;
    if (fileId) return getInvoiceDownloadUrl(inv.id);
    if (typeof inv.id === 'string' && !inv.id.startsWith('sfp:')) {
        const status = String(inv.status || '').toUpperCase();
        if (status === 'PAID' || status === 'PARTIAL' || status === 'PARTIAL_PAID') {
            return getInvoiceDownloadUrl(inv.id);
        }
    }
    return null;
}

/**
 * Analytics dashboard for /manage-suborg-teams.
 *
 * Aggregates four data sources (all already endpoints we built earlier):
 *  - `getSubOrgFinanceDetail`  → admin payment + learners
 *  - `getScopedInvites`        → which package sessions the sub-org has access to
 *  - `getInvoicesByUser`       → invoices generated for the admin (per-user list)
 *
 * Renders four tiles + a learner roster + an invoice list. Click "View ledger"
 * to expand the admin's CPO installment table.
 */
export function SubOrgAnalyticsPanel({
    subOrgId,
    subOrgName,
    restrictedView = false,
    variant = 'panel',
}: Props) {
    const { t } = useTranslation('manageSuborgTeamsSubOrgAnalyticsPanel');
    const pageChrome = variant === 'page';
    // Institutes rename this concept via Settings → Naming (Channel Partner,
    // Branch, Franchise, VLE …); user-facing labels must follow that.
    const subOrgTerm = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const instituteId = getCurrentInstituteId();

    const { data: finance, isLoading: financeLoading } = useQuery<SubOrgFinanceDetail>({
        queryKey: ['sub-org-finance-detail', subOrgId],
        queryFn: () => getSubOrgFinanceDetail(subOrgId, instituteId || undefined),
        enabled: !!subOrgId,
    });

    const { data: scopedInvites = [] } = useQuery<any[]>({
        queryKey: ['sub-org-scoped-invites', subOrgId],
        queryFn: () => getScopedInvites(subOrgId),
        enabled: !!subOrgId,
    });

    // The org-level SUB_ORG invite carries the configured admin payment option —
    // i.e. the plan a *future* admin will pay via, even before anyone redeems the
    // invite. Used to show the configured plan in the Admin payment tile instead of
    // a bare "No plan" when no admin has enrolled yet.
    const orgInvite = (scopedInvites as any[]).find((r) => r?.tag === 'SUB_ORG')
        || (scopedInvites as any[])[0];

    // Institute payment options (same source as the Edit Sub-Org modal) so we can
    // resolve the configured option's name + price. Gated to the institute-admin
    // (full) view — sub-org admins can't read the parent institute's options.
    const { data: institutePaymentOptions = [] } = useQuery<PaymentOptionApi[]>({
        queryKey: ['sub-org-institute-payment-options', instituteId],
        queryFn: () =>
            getPaymentOptions({
                types: ['ONE_TIME', 'SUBSCRIPTION', 'FREE'],
                source: 'INSTITUTE',
                source_id: instituteId || '',
                require_approval: true,
                not_require_approval: true,
            }),
        enabled: !!instituteId && !restrictedView,
        staleTime: 30000,
    });
    const configuredOption = institutePaymentOptions.find(
        (o) => o.id === orgInvite?.payment_option_id
    );
    const configuredPlan = configuredOption?.payment_plans?.[0];
    const configuredPriceLabel =
        configuredOption?.type === 'FREE'
            ? t('tiles.free')
            : configuredPlan
              ? `${getCurrencySymbol(configuredPlan.currency || '')}${formatPlanPrice(
                    configuredPlan.actual_price
                )}`
              : '';

    const adminUserId = finance?.admin_payment?.user_id;
    const { data: invoices = [] } = useQuery<InvoiceSummary[]>({
        queryKey: ['sub-org-admin-invoices', adminUserId],
        queryFn: () => getInvoicesByUser(adminUserId!),
        enabled: !!adminUserId,
    });

    // Ledger summary for the sub-org admin — total accrued / paid / balance / overdue.
    // Only fetched once we know the admin's userId and the parent instituteId.
    const { data: adminAccountSummary } = useQuery<UserAccountSummaryDTO>({
        queryKey: ['sub-org-admin-account-summary', adminUserId, instituteId],
        queryFn: () => fetchUserAccountSummary(adminUserId!, instituteId!),
        enabled: !!adminUserId && !!instituteId,
        staleTime: 60000,
    });

    const admin = finance?.admin_payment;
    const learners = finance?.learners || [];
    const totals = finance?.totals;

    // Distinct package sessions across all scoped invites.
    const psList = collectPackageSessions(scopedInvites);

    // PS-id → "Course · Level · Session" label for the Learners tab. Primary source is the
    // sub-org's scoped invites (already fetched above and enriched with names); falls back
    // to the institute store, then the raw id for the rare PS not in either.
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const psLabelById = new Map<string, string>(
        psList.map((ps) => [ps.id, ps.label] as [string, string])
    );
    const courseLabelFor = (psId: string): string => {
        const fromInvites = psLabelById.get(psId);
        if (fromInvites) return fromInvites;
        const d = getDetailsFromPackageSessionId({ packageSessionId: psId });
        if (d) {
            return buildPsLabel(
                d.package_dto?.package_name,
                d.level?.level_name,
                d.session?.session_name,
                psId
            );
        }
        return psId;
    };

    // Effective account summary — ledger data when available, client-side fallback otherwise.
    // Computed here (component level) so it's accessible both above the tabs and inside them.
    const effectiveAdminSummary: UserAccountSummaryDTO | null = (() => {
        const hasLedger =
            adminAccountSummary
            && (adminAccountSummary.total_accrued > 0 || adminAccountSummary.total_paid > 0);
        if (hasLedger) return adminAccountSummary!;
        // Fallback: derive totals from the invoices list (covers old invoices / pre-migration installs)
        if (invoices.length === 0) return null;
        const currency = (invoices[0]?.currency as string | undefined) || 'INR';
        const totalAccrued = invoices
            .filter((inv) => String(inv.status || '').toUpperCase() !== 'REJECTED')
            .reduce((s, inv) => s + ((inv.total_amount ?? inv.totalAmount ?? 0) as number), 0);
        const totalPaid = invoices
            .filter((inv) => String(inv.status || '').toUpperCase() === 'PAID')
            .reduce((s, inv) => s + ((inv.total_amount ?? inv.totalAmount ?? 0) as number), 0);
        const balance = Math.max(0, totalAccrued - totalPaid);
        const now = Date.now();
        const overdue = invoices
            .filter((inv) => {
                const st = String(inv.status || '').toUpperCase();
                const isPending = st === 'PENDING_PAYMENT' || st === 'GENERATED' || st === 'SENT';
                const pastDue = inv.due_date
                    ? new Date(String(inv.due_date)).getTime() < now
                    : false;
                return isPending && pastDue;
            })
            .reduce((s, inv) => s + ((inv.total_amount ?? inv.totalAmount ?? 0) as number), 0);
        return {
            user_id: adminUserId || '',
            institute_id: instituteId || '',
            total_accrued: totalAccrued,
            total_paid: totalPaid,
            balance,
            overdue,
            currency,
        } as UserAccountSummaryDTO;
    })();

    const [ledgerPage, setLedgerPage] = useState(0);
    const LEDGER_PAGE_SIZE = 10;
    const { data: ledgerData } = useQuery({
        queryKey: ['sub-org-admin-ledger', adminUserId, instituteId, ledgerPage],
        queryFn: () => fetchUserAccountLedger(adminUserId!, instituteId!, ledgerPage, LEDGER_PAGE_SIZE),
        enabled: !!adminUserId && !!instituteId,
        staleTime: 60000,
    });
    const ledgerEntries: UserAccountLedgerEntryDTO[] = ledgerData?.content ?? [];
    const ledgerTotalPages = ledgerData?.totalPages ?? 1;

    const [showLedger, setShowLedger] = useState(false);
    const [activeTab, setActiveTab] = useState<
        'admin' | 'courses' | 'learners' | 'invoices' | 'team'
    >('admin');
    const [drawer, setDrawer] = useState<{
        userId: string;
        name?: string;
        subtitle?: string;
        courses?: { id: string; label: string }[];
    } | null>(null);
    const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
    // Create Invoice CTA in the Invoices tab — surfaces the same dialog the drawer
    // uses, but pre-targeted at the sub-org admin user. Without this the only way
    // to raise an admin invoice was to open the per-user drawer first.
    const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);
    // Per-row PENDING_PAYMENT actions on the Invoices tab.
    //   copiedLinkId   — flips the Copy Link button to "Copied" for 2s
    //   markPaidTarget — opens MarkPaidDialog scoped to one invoice
    const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
    const [markPaidTarget, setMarkPaidTarget] = useState<{ id: string; number?: string } | null>(null);
    // "Duplicate" — fetches the full invoice (line items aren't on the summary row) and
    // opens the same Create Invoice dialog pre-filled from it.
    const [duplicateSource, setDuplicateSource] = useState<InvoiceDTO | null>(null);
    const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
    // Which row is currently being rejected (per-row disable while the mutation is in flight).
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    // Pending confirm for the destructive Reject action (AlertDialog, not window.confirm).
    const [rejectTarget, setRejectTarget] = useState<{ id: string; number: string } | null>(null);
    // Inline PDF preview (view the invoice without downloading it).
    const [previewTarget, setPreviewTarget] = useState<InvoiceSummary | null>(null);
    // "Edit" — like Duplicate, needs the full invoice (line items) before opening the dialog.
    const [editSource, setEditSource] = useState<InvoiceDTO | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);

    const handleCopyInvoiceLink = async (invoiceId: string, link: string) => {
        try {
            await navigator.clipboard.writeText(link);
            setCopiedLinkId(invoiceId);
            toast.success(t('toasts.linkCopied'));
            window.setTimeout(() => {
                setCopiedLinkId((prev) => (prev === invoiceId ? null : prev));
            }, 2000);
        } catch (_err) {
            toast.error(t('toasts.copyFailed'));
        }
    };

    const queryClient = useQueryClient();
    // Track which row is currently sending a reminder so we can show a per-row spinner
    // instead of disabling every Remind button on the page. One id space serves both
    // the SFP reminder and the admin-invoice reminder — only one row can be in flight
    // at a time per click.
    const [remindingId, setRemindingId] = useState<string | null>(null);
    const remindMutation = useMutation({
        mutationFn: (sfpId: string) => triggerInvoiceReminderForSfp(sfpId),
        onMutate: (sfpId) => setRemindingId(sfpId),
        onSettled: () => setRemindingId(null),
        onSuccess: (data) => {
            toast.success(
                data?.recipient_email
                    ? t('toasts.reminderSentTo', { email: data.recipient_email })
                    : t('toasts.reminderFired')
            );
            if (adminUserId) {
                queryClient.invalidateQueries({
                    queryKey: ['sub-org-admin-invoices', adminUserId],
                });
            }
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || t('toasts.reminderFailed'));
        },
    });

    // Separate mutation for the admin-invoice reminder (POST /v1/invoices/{id}/send-reminder).
    // Different endpoint + payload shape than the SFP reminder, but shares the
    // remindingId state so the UI only spins one row at a time.
    const invoiceReminderMutation = useMutation({
        mutationFn: (invoiceId: string) => sendInvoiceReminder(invoiceId),
        onMutate: (invoiceId) => setRemindingId(invoiceId),
        onSettled: () => setRemindingId(null),
        onSuccess: (data) => {
            // Report channels honestly — email may be off in INVOICE_SETTING, in
            // which case only the in-app alert fired; admin should know that.
            const channels: string[] = [];
            if (data.alert_sent) channels.push(t('toasts.channelInApp'));
            if (data.email_sent) channels.push(t('toasts.channelEmail'));
            const email = data.recipient_email;
            toast.success(
                channels.length > 0
                    ? email
                        ? t('toasts.reminderSentToEmail', { email, channels: channels.join(' + ') })
                        : t('toasts.reminderSentPlain', { channels: channels.join(' + ') })
                    : email
                      ? t('toasts.reminderNoChannelsToEmail', { email })
                      : t('toasts.reminderNoChannelsPlain')
            );
            if (adminUserId) {
                queryClient.invalidateQueries({
                    queryKey: ['sub-org-admin-invoices', adminUserId],
                });
            }
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || t('toasts.invoiceReminderFailed'));
        },
    });

    // "Duplicate" — the row list only carries a summary, so fetch the full invoice
    // (line items + notes) before opening the Create Invoice dialog pre-filled from it.
    const handleDuplicateInvoice = async (invoiceId: string) => {
        setDuplicatingId(invoiceId);
        try {
            const full = await fetchInvoiceById(invoiceId);
            setDuplicateSource(full);
            setCreateInvoiceOpen(true);
        } catch {
            toast.error(t('toasts.duplicateLoadFailed'));
        } finally {
            setDuplicatingId(null);
        }
    };

    // "Edit" — the row is only a summary, so fetch the full invoice (line items + notes)
    // before opening the Create-Invoice dialog in edit mode.
    const handleEditInvoice = async (invoiceId: string) => {
        setEditingId(invoiceId);
        try {
            const full = await fetchInvoiceById(invoiceId);
            setEditSource(full);
            setCreateInvoiceOpen(true);
        } catch {
            toast.error(t('toasts.editLoadFailed'));
        } finally {
            setEditingId(null);
        }
    };

    // Voids a mistaken PENDING_PAYMENT invoice. Terminal — confirm before firing.
    const rejectMutation = useMutation({
        mutationFn: (invoiceId: string) => rejectInvoice(invoiceId, instituteId || '', undefined),
        onMutate: (invoiceId) => setRejectingId(invoiceId),
        onSettled: () => setRejectingId(null),
        onSuccess: () => {
            toast.success(t('toasts.invoiceRejected'));
            if (adminUserId) {
                queryClient.invalidateQueries({ queryKey: ['sub-org-admin-invoices', adminUserId] });
            }
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || t('toasts.rejectFailed'));
        },
    });

    const handleRejectInvoice = () => {
        if (!rejectTarget) return;
        rejectMutation.mutate(rejectTarget.id);
        setRejectTarget(null);
    };

    // The CTAs only make sense for the parent institute admin — sub-org admins can't
    // edit their own CPO ledger or fire reminders against themselves.
    // Finance capabilities for role-granted users. Admins and sub-org admins are
    // unaffected: subOrgPermission returns true for them, so the existing conditions
    // (restrictedView / isCallerSubOrgAdmin) remain the deciding factors.
    const canViewFinance = subOrgPermission('canViewFinance');
    const canEditLedger =
        !restrictedView && !isCallerSubOrgAdmin() && subOrgPermission('canManageFinance');

    // 'admin' is the initial tab, but it is a finance tab. A role without finance
    // access would otherwise land on a tab whose trigger is hidden and see an empty
    // panel, so fall back to the first tab that is actually rendered for them.
    useEffect(() => {
        if (canViewFinance) return;
        if (activeTab === 'admin' || activeTab === 'invoices') {
            setActiveTab(restrictedView ? 'team' : 'courses');
        }
    }, [canViewFinance, activeTab, restrictedView]);
    const adminUserPlanId = admin?.user_plan_id || null;
    const nextDueRemaining = admin?.next_due
        ? (admin.next_due.amount_expected ?? 0) - (admin.next_due.amount_paid ?? 0)
        : 0;
    const suggestedAmount = nextDueRemaining > 0
        ? nextDueRemaining
        : (admin?.outstanding_amount ?? undefined);

    /**
     * Tab trigger classes. Under page chrome these are the Manage <SubOrgs> pills — a
     * filled primary tab sitting on the strip's bottom border.
     *
     * Both colours need `!`. The shared TabsTrigger ships `data-[state=active]:bg-background`
     * and `data-[state=active]:text-foreground`, and a `data-*` variant compiles to an
     * attribute selector — specificity (0,2,0) against a bare utility's (0,1,0) — so an
     * unprefixed `text-white` loses and the label renders near-black on the primary fill.
     * tailwind-merge won't save you either: different modifiers are different class groups,
     * so it keeps both and lets the cascade decide.
     */
    const tabTriggerClass = (value: string) =>
        pageChrome
            ? cn(
                  'flex gap-1.5 rounded-t-md px-10 py-2.5 !shadow-none',
                  activeTab === value
                      ? '!bg-primary-500 !text-white'
                      : 'border-none bg-transparent text-neutral-600'
              )
            : 'gap-2';

    /**
     * Count badge on a tab. The outline badge draws border + foreground text, which
     * disappears once the trigger is a filled primary pill — so the active tab's badge
     * borrows white at reduced alpha instead.
     */
    const tabBadgeClass = (value: string) =>
        cn(
            'ms-1 h-4 px-1.5 text-caption',
            pageChrome && activeTab === value && 'border-white/40 !text-white'
        );

    if (financeLoading) {
        return (
            <div className="rounded-lg border bg-white p-6 text-sm text-muted-foreground">
                {t('loadingAnalytics', { term: subOrgTerm.toLowerCase() })}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Tile row — full view shows all 4 tiles, restricted view (sub-org admin)
                shows only the Admin payment tile since the other tabs are hidden. Page
                chrome drops the row entirely: SubOrgStatCards already prints plan,
                status, learners, seats and outstanding beside the page title. */}
            <div
                className={cn(
                    restrictedView
                        ? 'grid gap-3 sm:grid-cols-1'
                        : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4',
                    pageChrome && 'hidden'
                )}
            >
                <Tile
                    icon={<Wallet className="h-4 w-4 text-emerald-600" />}
                    label={t('tiles.adminPayment')}
                    // When an admin has redeemed the invite, show their actual plan.
                    // Otherwise surface the *configured* payment option (what a future
                    // admin will pay via) instead of a confusing bare "No plan".
                    primary={
                        admin?.payment_type ||
                        configuredOption?.name ||
                        orgInvite?.payment_type ||
                        t('tiles.noPlan')
                    }
                    secondary={
                        admin?.payment_type
                            ? admin.payment_type === 'CPO'
                                ? t('tiles.outstanding', { amount: fmtMoney(admin?.outstanding_amount) })
                                : admin?.user_plan_status || '—'
                            : configuredOption || orgInvite?.payment_type
                              ? configuredPriceLabel
                                    ? t('tiles.priceAwaitingAdmin', { price: configuredPriceLabel })
                                    : t('tiles.awaitingAdmin')
                              : '—'
                    }
                />
                {!restrictedView && (
                    <>
                        <Tile
                            icon={<Users className="h-4 w-4 text-blue-600" />}
                            label={(() => {
                                const seat = finance?.seat_usage;
                                if (!seat || seat.total == null) return t('tiles.learners');
                                return t('tiles.learnersWithSeats', {
                                    used: seat.used ?? 0,
                                    total: seat.total,
                                });
                            })()}
                            primary={String(totals?.learner_count ?? 0)}
                            secondary={(() => {
                                const seat = finance?.seat_usage;
                                const outstanding = t('tiles.totalOutstanding', {
                                    amount: fmtMoney(totals?.total_outstanding),
                                });
                                if (seat && seat.remaining != null) {
                                    return `${outstanding} · ${t('tiles.seatsLeft', {
                                        count: seat.remaining,
                                    })}`;
                                }
                                return outstanding;
                            })()}
                        />
                        <Tile
                            icon={<FileText className="h-4 w-4 text-purple-600" />}
                            label={t('tiles.invoices')}
                            primary={String(invoices.length)}
                            secondary={
                                adminUserId ? t('tiles.generatedForAdmin') : t('tiles.noAdminLinked')
                            }
                        />
                        <Tile
                            icon={<BookOpen className="h-4 w-4 text-amber-600" />}
                            label={getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)}
                            primary={String(psList.length)}
                            secondary={t('tiles.scopedInvite', { count: scopedInvites.length })}
                        />
                    </>
                )}
            </div>

            {/* Account Summary — always visible above tabs so it's reachable from any tab.
                Ledger data is authoritative; falls back to client-side totals from invoices. */}
            {effectiveAdminSummary && (
                <div className="rounded-lg border bg-white p-4">
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Wallet className="h-3.5 w-3.5" />
                        {t('accountSummary')}
                    </h4>
                    <AccountSummaryGrid summary={effectiveAdminSummary} />
                </div>
            )}

            {/* Transaction History — append-only ledger entries, always visible below summary. */}
            {adminUserId && instituteId && (
                <div className="rounded-lg border bg-white p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <ClockCounterClockwise className="h-3.5 w-3.5" />
                        {t('transactionHistory')}
                    </h4>
                    {ledgerEntries.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t('noTransactions')}</p>
                    ) : (
                        <div className="space-y-2">
                            <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200">
                                {ledgerEntries.map((entry) => {
                                    const LEDGER_META = buildLedgerMeta(t);
                                    const meta = LEDGER_META[entry.event_type] ?? {
                                        label: entry.event_type,
                                        cls: 'bg-gray-50 text-gray-600 border-gray-200',
                                        isCredit: false,
                                    };
                                    const sym = entry.currency === 'USD' ? '$' : entry.currency === 'EUR' ? '€' : '₹';
                                    const amtStr = `${sym}${Number(entry.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                                    return (
                                        <li key={entry.id} className="flex items-start gap-2.5 px-3 py-2 text-xs hover:bg-neutral-50">
                                            <span className="mt-0.5 shrink-0">
                                                {meta.isCredit
                                                    ? <ArrowCircleUp className="size-4 text-green-600" weight="duotone" />
                                                    : <ArrowCircleDown className="size-4 text-red-500" weight="duotone" />
                                                }
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-caption font-medium ${meta.cls}`}>
                                                        {meta.label}
                                                    </span>
                                                    {entry.remarks && (
                                                        <span className="truncate text-caption text-muted-foreground" title={entry.remarks}>
                                                            {entry.remarks}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="mt-0.5 text-caption text-muted-foreground">
                                                    {fmtDate(entry.created_at)}
                                                    {entry.source_type && <> · {entry.source_type.replace(/_/g, ' ')}</>}
                                                </p>
                                            </div>
                                            <span className={`shrink-0 font-semibold tabular-nums ${meta.isCredit ? 'text-green-700' : 'text-red-600'}`}>
                                                {meta.isCredit ? '+' : '-'}{amtStr}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                            {ledgerTotalPages > 1 && (
                                <div className="flex items-center justify-between px-1">
                                    <span className="text-caption text-muted-foreground">
                                        {t('pageOf', { page: ledgerPage + 1, total: ledgerTotalPages })}
                                    </span>
                                    <div className="flex gap-1">
                                        <button
                                            type="button"
                                            onClick={() => setLedgerPage((p) => Math.max(0, p - 1))}
                                            disabled={ledgerPage === 0}
                                            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                                        >
                                            <CaretDown className="h-3.5 w-3.5 rotate-90" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setLedgerPage((p) => Math.min(ledgerTotalPages - 1, p + 1))}
                                            disabled={ledgerPage >= ledgerTotalPages - 1}
                                            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                                        >
                                            <CaretDown className="h-3.5 w-3.5 -rotate-90" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Horizontal tabs — each tab renders its own dataset lazily on click. */}
            <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as typeof activeTab)}
                className="w-full"
            >
                <TabsList
                    className={
                        pageChrome
                            ? 'mb-4 inline-flex h-auto w-full justify-start gap-2 overflow-x-auto rounded-none border-b !bg-transparent p-0'
                            : 'w-full justify-start gap-1 overflow-x-auto rounded-md border bg-white p-1'
                    }
                >
                    {canViewFinance && (
                        <TabsTrigger value="admin" className={tabTriggerClass('admin')}>
                            <Wallet className="h-3.5 w-3.5" />
                            {t('tabs.adminPayment')}
                        </TabsTrigger>
                    )}
                    {!restrictedView && (
                        <>
                            <TabsTrigger value="courses" className={tabTriggerClass('courses')}>
                                <BookOpen className="h-3.5 w-3.5" />
                                {t('tabs.courses')}
                                <Badge variant="outline" className={tabBadgeClass('courses')}>
                                    {psList.length}
                                </Badge>
                            </TabsTrigger>
                            <TabsTrigger value="learners" className={tabTriggerClass('learners')}>
                                <GraduationCap className="h-3.5 w-3.5" />
                                {t('tabs.learners')}
                                <Badge variant="outline" className={tabBadgeClass('learners')}>
                                    {learners.length}
                                </Badge>
                            </TabsTrigger>
                            {canViewFinance && (
                                <TabsTrigger
                                    value="invoices"
                                    className={tabTriggerClass('invoices')}
                                >
                                    <FileText className="h-3.5 w-3.5" />
                                    {t('tabs.invoices')}
                                    <Badge variant="outline" className={tabBadgeClass('invoices')}>
                                        {invoices.length}
                                    </Badge>
                                </TabsTrigger>
                            )}
                        </>
                    )}
                    <TabsTrigger value="team" className={tabTriggerClass('team')}>
                        <Users className="h-3.5 w-3.5" />
                        {t('tabs.team')}
                    </TabsTrigger>
                </TabsList>

                {/* Admin payment */}
                <TabsContent value="admin" className="mt-3">
                    <section className="rounded-lg border bg-white p-4">
                        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                                <Wallet className="h-4 w-4" />
                                {subOrgName
                                    ? t('adminPaymentSection.headingWithName', { name: subOrgName })
                                    : t('adminPaymentSection.heading')}
                            </h3>
                            <div className="flex flex-wrap items-center gap-2">
                                {admin?.payment_type === 'CPO' && (
                                    <Badge variant="secondary">
                                        {t('adminPaymentSection.pending', {
                                            count: admin.pending_installments_count ?? 0,
                                        })}
                                    </Badge>
                                )}
                                {/* Record an arbitrary amount and FIFO-fill it across the
                                    admin's pending CPO installments. Same dialog the
                                    Invoices tab exposes — surfaced here too because the
                                    installment buckets visually live on this tab, so
                                    "Record payment against these installments" is the
                                    natural CTA next to them. */}
                                {canEditLedger && adminUserPlanId && (
                                    <MyButton
                                        type="button"
                                        buttonType="primary"
                                        scale="small"
                                        onClick={() => setRecordPaymentOpen(true)}
                                    >
                                        <Plus className="size-4" />
                                        {t('adminPaymentSection.recordOfflinePayment')}
                                    </MyButton>
                                )}
                            </div>
                        </header>
                        {admin?.user_id ? (
                            <>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium">
                                            {admin.full_name || admin.user_id}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {admin.payment_type || t('adminPaymentSection.unknownPlan')}
                                            {admin.user_plan_status
                                                ? ` · ${admin.user_plan_status}`
                                                : ''}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setDrawer({
                                                userId: admin.user_id!,
                                                name: admin.full_name || admin.user_id,
                                                subtitle: t('adminPaymentSection.termAdmin', {
                                                    term: getTerminology(
                                                        OtherTerms.SubOrg,
                                                        SystemTerms.SubOrg
                                                    ),
                                                }),
                                            })
                                        }
                                        className="shrink-0 rounded border px-2 py-1 text-caption uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
                                    >
                                        {t('adminPaymentSection.openHistory')}
                                    </button>
                                </div>
                                {admin.payment_type === 'CPO' && (
                                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                                        <Metric
                                            label={t('adminPaymentSection.metricTotal')}
                                            value={fmtMoney(admin.total_amount)}
                                        />
                                        <Metric
                                            label={t('adminPaymentSection.metricPaid')}
                                            value={fmtMoney(admin.paid_amount)}
                                        />
                                        <Metric
                                            label={t('adminPaymentSection.metricOutstanding')}
                                            value={fmtMoney(admin.outstanding_amount)}
                                        />
                                    </div>
                                )}
                                {admin.next_due && (
                                    <div className="mt-2 rounded bg-muted/40 p-2 text-xs">
                                        <span className="text-muted-foreground">
                                            {t('adminPaymentSection.nextDue')}{' '}
                                        </span>
                                        <span className="font-medium">
                                            {fmtMoney(admin.next_due.amount_expected)}
                                        </span>
                                        {admin.next_due.due_date && (
                                            <span className="text-muted-foreground">
                                                {' '}
                                                {t('adminPaymentSection.onDate', {
                                                    date: fmtDate(admin.next_due.due_date),
                                                })}
                                            </span>
                                        )}
                                        <span className="text-muted-foreground">
                                            {' '}
                                            ({admin.next_due.status})
                                        </span>
                                    </div>
                                )}
                                {admin.installments && admin.installments.length > 0 && (
                                    <button
                                        type="button"
                                        className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                        onClick={() => setShowLedger((v) => !v)}
                                    >
                                        <CaretDown
                                            className={`h-3 w-3 transition-transform ${
                                                showLedger ? 'rotate-180' : ''
                                            }`}
                                        />
                                        {showLedger
                                            ? t('adminPaymentSection.hideLedger', {
                                                  count: admin.installments.length,
                                              })
                                            : t('adminPaymentSection.viewLedger', {
                                                  count: admin.installments.length,
                                              })}
                                    </button>
                                )}
                                {showLedger && admin.installments && (
                                    <div className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded bg-muted/30 p-2 text-xs">
                                        {admin.installments.map((inst, idx) => (
                                            <div
                                                key={inst.student_fee_payment_id}
                                                className="flex items-center justify-between border-b border-muted py-1 last:border-b-0"
                                            >
                                                <span className="text-muted-foreground">
                                                    #{idx + 1}
                                                    {inst.due_date
                                                        ? ` · ${fmtDate(inst.due_date)}`
                                                        : ''}
                                                </span>
                                                <span className="flex items-center gap-2">
                                                    <span>{fmtMoney(inst.amount_expected)}</span>
                                                    <Badge
                                                        variant={
                                                            inst.status === 'PAID'
                                                                ? 'default'
                                                                : 'secondary'
                                                        }
                                                        className="h-4 px-1.5 text-caption"
                                                    >
                                                        {inst.status}
                                                    </Badge>
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                {t('adminPaymentSection.noAdminRedeemed')}
                            </p>
                        )}
                    </section>


                    {/* Direct "Add admin user" form — CPO installment editor + discount
                        card live in this section. Lets the institute admin enroll the
                        sub-org admin directly (with installment overrides) instead of
                        waiting for them to accept the invite link. Hidden from sub-org
                        admins via the restrictedView gate so they don't see an admin-
                        management form on their own /manage-suborg-teams page. */}
                    {!restrictedView && instituteId && (
                        <div className="mt-4 rounded-lg border bg-white p-4">
                            <AddUserToSubOrgSection
                                subOrgId={subOrgId}
                                instituteId={instituteId}
                                scopedInvites={scopedInvites}
                            />
                        </div>
                    )}
                </TabsContent>

                {/* Courses / Learners / Invoices — hidden in restricted (sub-org-admin) view. */}
                {!restrictedView && <>
                <TabsContent value="courses" className="mt-3">
                    <section className="rounded-lg border bg-white p-4">
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                            <BookOpen className="h-4 w-4" />
                            {t('coursesTab.heading', {
                                term: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course),
                                count: psList.length,
                            })}
                        </h3>
                        {psList.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                {t('coursesTab.noScopedInvites')}
                            </p>
                        ) : (
                            <ul className="grid gap-2 sm:grid-cols-2">
                                {psList.map((ps) => (
                                    <li
                                        key={ps.id}
                                        className="flex items-center gap-2 rounded border px-3 py-2 text-xs"
                                    >
                                        <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                        <span className="truncate">{ps.label}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </TabsContent>

                {/* Learners */}
                <TabsContent value="learners" className="mt-3">
                    <section className="rounded-lg border bg-white p-4">
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                            <GraduationCap className="h-4 w-4" />
                            {t('learnersTab.heading', { count: learners.length })}
                        </h3>
                        {learners.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                {t('learnersTab.noLearners')}
                            </p>
                        ) : (
                            <div className="max-h-list-scroll space-y-1 overflow-y-auto rounded-md border">
                                {learners.map((l) => {
                                    const hasDues =
                                        (l.pending_installments_count ?? 0) > 0
                                        || (l.outstanding_amount ?? 0) > 0;
                                    return (
                                        <button
                                            type="button"
                                            key={l.user_id}
                                            onClick={() => {
                                                const psIds =
                                                    l.package_session_ids &&
                                                    l.package_session_ids.length > 0
                                                        ? l.package_session_ids
                                                        : l.package_session_id
                                                          ? [l.package_session_id]
                                                          : [];
                                                setDrawer({
                                                    userId: l.user_id,
                                                    name: l.full_name || l.user_id,
                                                    subtitle: t('learnersTab.learnerSubtitle'),
                                                    courses: psIds.map((psId) => ({
                                                        id: psId,
                                                        label: courseLabelFor(psId),
                                                    })),
                                                });
                                            }}
                                            className="flex w-full items-center justify-between border-b border-muted px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-xs font-medium">
                                                    {l.full_name || l.user_id}
                                                </p>
                                                {l.enrolled_date && (
                                                    <p className="text-caption text-muted-foreground">
                                                        {t('learnersTab.enrolled', {
                                                            date: fmtDate(l.enrolled_date),
                                                        })}
                                                    </p>
                                                )}
                                                {(() => {
                                                    const psIds =
                                                        l.package_session_ids &&
                                                        l.package_session_ids.length > 0
                                                            ? l.package_session_ids
                                                            : l.package_session_id
                                                              ? [l.package_session_id]
                                                              : [];
                                                    if (psIds.length === 0) return null;
                                                    return (
                                                        <div className="mt-1 flex flex-wrap gap-1">
                                                            {psIds.map((psId) => (
                                                                <span
                                                                    key={psId}
                                                                    title={courseLabelFor(psId)}
                                                                    className="inline-flex max-w-56 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground"
                                                                >
                                                                    <BookOpen className="h-2.5 w-2.5 shrink-0" />
                                                                    <span className="truncate">
                                                                        {courseLabelFor(psId)}
                                                                    </span>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                            {hasDues ? (
                                                <div className="text-right text-xs">
                                                    <span className="font-medium text-amber-700">
                                                        {fmtMoney(l.outstanding_amount)}
                                                    </span>
                                                    <span className="ms-1 text-muted-foreground">
                                                        {t('learnersTab.dueCount', {
                                                            count: l.pending_installments_count,
                                                        })}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                </TabsContent>

                {/* Invoices */}
                <TabsContent value="invoices" className="mt-3">
                    <section className="rounded-lg border bg-white p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                                <FileText className="h-4 w-4" />
                                {t('invoicesTab.heading', { count: invoices.length })}
                            </h3>
                            <div className="flex flex-wrap items-center gap-2">
                                {adminUserId && (
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => setCreateInvoiceOpen(true)}
                                    >
                                        <Plus className="size-4" />
                                        {t('invoicesTab.createInvoice')}
                                    </MyButton>
                                )}
                                {canEditLedger && adminUserPlanId && (
                                    <MyButton
                                        type="button"
                                        buttonType="primary"
                                        scale="small"
                                        onClick={() => setRecordPaymentOpen(true)}
                                    >
                                        <Plus className="size-4" />
                                        {t('adminPaymentSection.recordOfflinePayment')}
                                    </MyButton>
                                )}
                            </div>
                        </div>
                        {invoices.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                {t('invoicesTab.noInvoices')}
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {invoices.map((inv) => {
                                    const number = inv.invoice_number || inv.invoiceNumber || inv.id;
                                    const date = inv.invoice_date || inv.invoiceDate;
                                    const amount = inv.total_amount ?? inv.totalAmount;
                                    const url = resolveInvoiceUrl(inv);
                                    const status = String(inv.status || '').toUpperCase();
                                    const source = (inv.source as string | null | undefined) || null;

                                    // ── Row classification ────────────────────────────────────
                                    // 1. SFP rows (sfp: prefix) = CPO installments from the
                                    //    user_plan installment schedule. Actions: Remind only.
                                    // 2. ADMIN_MANUAL = institute admin created via Create Invoice.
                                    //    Actions: Copy Link · Mark Paid · Remind · Reject · Duplicate.
                                    // 3. USER_PLAN = auto-generated on plan subscription/renewal.
                                    //    Actions: Copy Link only (gateway owns the payment flow;
                                    //    mark-paid would leave the subscription state out of sync).
                                    // 4. Other real rows (legacy / unknown source) = Copy Link + PDF only.
                                    const isSfpRow = typeof inv.id === 'string' && inv.id.startsWith('sfp:');
                                    const sfpId = isSfpRow ? inv.id.slice('sfp:'.length) : null;
                                    const isAdminManual = !isSfpRow && (source === 'ADMIN_MANUAL' || source === null);
                                    const isUserPlan = !isSfpRow && source === 'USER_PLAN';
                                    const isPending =
                                        status === 'PENDING_PAYMENT'
                                        || status === 'GENERATED'
                                        || status === 'SENT';

                                    const isSfpRemindable =
                                        canEditLedger
                                        && !!sfpId
                                        && (status === 'PENDING' || status === 'UNPAID'
                                            || status === 'OVERDUE' || status === 'PARTIAL'
                                            || status === 'PARTIAL_PAID');
                                    const isAdminInvoicePending = isAdminManual && isPending && typeof inv.id === 'string';
                                    const isUserPlanPending = isUserPlan && isPending && typeof inv.id === 'string';
                                    const paymentLink = inv.payment_link || inv.paymentLink;

                                    // Source badge colours / labels
                                    const sourceMeta = isSfpRow
                                        ? { label: t('invoicesTab.sourceCpoInstallment'), cls: 'bg-amber-50 text-amber-700 border-amber-200' }
                                        : source === 'ADMIN_MANUAL'
                                          ? { label: t('invoicesTab.sourceAdminInvoice'), cls: 'bg-purple-50 text-purple-700 border-purple-200' }
                                          : source === 'USER_PLAN'
                                            ? { label: t('invoicesTab.sourceSubscription'), cls: 'bg-blue-50 text-blue-700 border-blue-200' }
                                            : source === 'STUDENT_FEE_PAYMENT'
                                              ? { label: t('invoicesTab.sourceFeePayment'), cls: 'bg-teal-50 text-teal-700 border-teal-200' }
                                              : null;

                                    return (
                                        <li
                                            key={inv.id}
                                            className="flex flex-col gap-1.5 rounded border px-3 py-2.5 text-xs"
                                        >
                                            {/* Row header: number + amount + source badge */}
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                                        <p className="truncate font-medium">{number}</p>
                                                        {sourceMeta && (
                                                            <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-caption font-medium ${sourceMeta.cls}`}>
                                                                {sourceMeta.label}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="mt-0.5 text-caption text-muted-foreground">
                                                        {date ? fmtDate(date) : '—'}
                                                        {inv.status ? ` · ${inv.status}` : ''}
                                                    </p>
                                                </div>
                                                <span className="shrink-0 font-semibold">
                                                    {fmtMoney(amount)}
                                                </span>
                                            </div>

                                            {/* Action row — source-specific buttons */}
                                            <div className="flex flex-wrap items-center gap-1.5">

                                                {/* CPO installment — Remind + Copy Link + Record Offline */}
                                                {isSfpRemindable && sfpId && (
                                                    <button
                                                        type="button"
                                                        onClick={() => remindMutation.mutate(sfpId)}
                                                        disabled={remindingId === sfpId}
                                                        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-caption uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                                        title={t('invoicesTab.remindTitleSfp')}
                                                    >
                                                        <Bell className="size-3" />
                                                        {remindingId === sfpId
                                                            ? t('invoicesTab.remindSending')
                                                            : t('invoicesTab.remind')}
                                                    </button>
                                                )}
                                                {isSfpRow && paymentLink && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyInvoiceLink(inv.id, paymentLink)}
                                                        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-caption uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
                                                        title={t('invoicesTab.copyLinkTitle')}
                                                    >
                                                        {copiedLinkId === inv.id ? (
                                                            <><CheckCircle className="size-3" /> {t('invoicesTab.copied')}</>
                                                        ) : (
                                                            <><Copy className="size-3" /> {t('invoicesTab.copyLink')}</>
                                                        )}
                                                    </button>
                                                )}

                                                {/* ADMIN_MANUAL pending — full action set */}
                                                {isAdminInvoicePending && (
                                                    <button
                                                        type="button"
                                                        onClick={() => invoiceReminderMutation.mutate(inv.id)}
                                                        disabled={remindingId === inv.id}
                                                        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-caption uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                                        title={t('invoicesTab.remindTitleAdmin')}
                                                    >
                                                        <Bell className="size-3" />
                                                        {remindingId === inv.id
                                                            ? t('invoicesTab.remindSending')
                                                            : t('invoicesTab.remind')}
                                                    </button>
                                                )}
                                                {isAdminInvoicePending && paymentLink && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyInvoiceLink(inv.id, paymentLink)}
                                                        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-caption uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
                                                        title={t('invoicesTab.copyLinkTitle')}
                                                    >
                                                        {copiedLinkId === inv.id ? (
                                                            <><CheckCircle className="size-3" /> {t('invoicesTab.copied')}</>
                                                        ) : (
                                                            <><Copy className="size-3" /> {t('invoicesTab.copyLink')}</>
                                                        )}
                                                    </button>
                                                )}
                                                {isAdminInvoicePending && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setMarkPaidTarget({
                                                                id: inv.id,
                                                                number: inv.invoice_number || inv.invoiceNumber || inv.id,
                                                            })
                                                        }
                                                        className="inline-flex items-center gap-1 rounded border border-primary-300 bg-primary-50 px-2 py-1 text-caption uppercase tracking-wide text-primary-700 hover:bg-primary-100"
                                                        title={t('invoicesTab.markPaidTitle')}
                                                    >
                                                        {t('invoicesTab.markPaid')}
                                                    </button>
                                                )}
                                                {isAdminInvoicePending && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setRejectTarget({
                                                                id: inv.id,
                                                                number: inv.invoice_number || inv.invoiceNumber || inv.id,
                                                            })
                                                        }
                                                        disabled={rejectingId === inv.id}
                                                        className="inline-flex items-center gap-1 rounded border border-danger-300 bg-danger-50 px-2 py-1 text-2xs uppercase tracking-wide text-danger-700 hover:bg-danger-100 disabled:opacity-50"
                                                        title={t('invoicesTab.rejectTitle')}
                                                    >
                                                        <XCircle className="size-3" />
                                                        {rejectingId === inv.id
                                                            ? t('invoicesTab.rejecting')
                                                            : t('invoicesTab.reject')}
                                                    </button>
                                                )}
                                                {/* ADMIN_MANUAL pending — Edit in place (same invoice number) */}
                                                {isAdminInvoicePending && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleEditInvoice(inv.id)}
                                                        disabled={editingId === inv.id}
                                                        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-2xs uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                                        title={t('invoicesTab.editTitle')}
                                                    >
                                                        <PencilSimple className="size-3" />
                                                        {editingId === inv.id
                                                            ? t('invoicesTab.loading')
                                                            : t('invoicesTab.edit')}
                                                    </button>
                                                )}
                                                {/* ADMIN_MANUAL — Duplicate (available on any status, not just pending) */}
                                                {isAdminManual && !isSfpRow && typeof inv.id === 'string' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleDuplicateInvoice(inv.id)}
                                                        disabled={duplicatingId === inv.id}
                                                        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-2xs uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                                        title={t('invoicesTab.duplicateTitle')}
                                                    >
                                                        <CopySimple className="size-3" />
                                                        {duplicatingId === inv.id
                                                            ? t('invoicesTab.loading')
                                                            : t('invoicesTab.duplicate')}
                                                    </button>
                                                )}

                                                {/* USER_PLAN pending — payment link only (gateway owns the flow) */}
                                                {isUserPlanPending && paymentLink && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyInvoiceLink(inv.id, paymentLink)}
                                                        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-caption uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
                                                        title={t('invoicesTab.copySubscriptionLinkTitle')}
                                                    >
                                                        {copiedLinkId === inv.id ? (
                                                            <><CheckCircle className="size-3" /> {t('invoicesTab.copied')}</>
                                                        ) : (
                                                            <><Copy className="size-3" /> {t('invoicesTab.copyLink')}</>
                                                        )}
                                                    </button>
                                                )}

                                                {/* PDF view / download — all row types when available */}
                                                {url ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => setPreviewTarget(inv)}
                                                            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-caption uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
                                                            title={t('invoicesTab.previewTitle')}
                                                        >
                                                            <Eye className="h-3 w-3" />
                                                            {t('invoicesTab.preview')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => void downloadNamedInvoicePdf(inv)}
                                                            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-caption uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
                                                            title={t('invoicesTab.downloadTitle')}
                                                        >
                                                            <DownloadSimple className="h-3 w-3" />
                                                            {t('invoicesTab.save')}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <span className="text-caption text-muted-foreground">{t('invoicesTab.noPdf')}</span>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                </TabsContent>

                </>}

                {/* Team members — the existing list with role + status + remove */}
                <TabsContent value="team" className="mt-3">
                    <section className="rounded-lg border bg-white p-4">
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                            <Users className="h-4 w-4" />
                            {t('teamTab.heading')}
                        </h3>
                        <CustomTeamsList mode="subOrg" subOrgId={subOrgId} />
                    </section>
                </TabsContent>
            </Tabs>

            <MemberHistoryDrawer
                open={!!drawer}
                onOpenChange={(o) => !o && setDrawer(null)}
                userId={drawer?.userId || null}
                userName={drawer?.name}
                subtitle={drawer?.subtitle}
                courses={drawer?.courses}
                readOnly={isCallerSubOrgAdmin()}
            />

            {canEditLedger && adminUserPlanId && (
                <RecordSubOrgPaymentDialog
                    open={recordPaymentOpen}
                    onOpenChange={setRecordPaymentOpen}
                    userPlanId={adminUserPlanId}
                    adminUserId={adminUserId || undefined}
                    contextLabel={
                        subOrgName
                            ? t('adminCpoContextWithName', { name: subOrgName })
                            : t('adminCpoContextTerm', { term: subOrgTerm })
                    }
                    suggestedAmount={suggestedAmount}
                />
            )}

            {/* Create Invoice from the Invoices tab — pre-targeted at the sub-org admin
                user so an institute admin can raise an ad-hoc invoice without first
                opening the per-user drawer. Invalidates the same query the tab reads
                from so the new row appears immediately. */}
            {adminUserId && instituteId && (
                <CreateInvoiceDialog
                    userId={adminUserId}
                    userName={
                        admin?.full_name || subOrgName || t('adminPaymentSection.termAdmin', { term: subOrgTerm })
                    }
                    instituteId={instituteId}
                    open={createInvoiceOpen}
                    onOpenChange={(o) => {
                        setCreateInvoiceOpen(o);
                        if (!o) {
                            setDuplicateSource(null);
                            setEditSource(null);
                        }
                    }}
                    duplicateFrom={duplicateSource}
                    editInvoice={editSource}
                    onSuccess={() => {
                        queryClient.invalidateQueries({
                            queryKey: ['sub-org-admin-invoices', adminUserId],
                        });
                    }}
                />
            )}

            {/* Mark Paid on any PENDING_PAYMENT row in the Invoices tab. markPaidTarget
                carries the invoice id (for the API call) and the human invoice number
                (for the dialog title + success toast). Refresh the same query the tab
                reads from so the row flips to PAID in place. */}
            <MarkPaidDialog
                open={!!markPaidTarget}
                onOpenChange={(o) => !o && setMarkPaidTarget(null)}
                invoiceId={markPaidTarget?.id || ''}
                invoiceNumber={markPaidTarget?.number}
                onSuccess={() => {
                    if (adminUserId) {
                        queryClient.invalidateQueries({
                            queryKey: ['sub-org-admin-invoices', adminUserId],
                        });
                        queryClient.invalidateQueries({
                            queryKey: ['sub-org-admin-account-summary', adminUserId, instituteId],
                        });
                    }
                }}
            />

            {/* Inline PDF preview — view the invoice without downloading it. */}
            <InvoicePreviewDialog
                invoice={previewTarget}
                onClose={() => setPreviewTarget(null)}
            />

            {/* Reject confirm — a terminal, money-voiding action, so it's gated behind an
                explicit AlertDialog rather than a native window.confirm. */}
            <AlertDialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('rejectDialog.title', { number: rejectTarget?.number })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('rejectDialog.description')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('rejectDialog.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleRejectInvoice}
                            className="bg-danger-600 hover:bg-danger-700"
                        >
                            {t('rejectDialog.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function Tile({
    icon,
    label,
    primary,
    secondary,
}: {
    icon: React.ReactNode;
    label: string;
    primary: string;
    secondary: string;
}) {
    return (
        <div className="rounded-lg border bg-white p-4">
            <div className="mb-1 flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground">
                {icon}
                {label}
            </div>
            <p className="text-lg font-semibold text-gray-900">{primary}</p>
            <p className="text-xs text-muted-foreground">{secondary}</p>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded bg-muted/30 p-2">
            <p className="text-caption uppercase tracking-wide text-muted-foreground">
                {label}
            </p>
            <p className="text-sm font-medium">{value}</p>
        </div>
    );
}

/**
 * Builds a human label for a package session, dropping the implicit "DEFAULT"
 * placeholder level/session that carry no meaning for the admin — so a course
 * reads as "Functional Literacy" instead of "Functional Literacy · default · DEFAULT".
 * Falls back to the raw id when nothing meaningful remains.
 */
function buildPsLabel(
    packageName?: string | null,
    levelName?: string | null,
    sessionName?: string | null,
    fallback?: string
): string {
    const parts = [packageName, levelName, sessionName]
        .filter(Boolean)
        .filter((s) => String(s).trim().toLowerCase() !== 'default');
    return parts.join(' · ') || fallback || '';
}

/** Ledger event-type → badge label/colour/credit-sign, translated via the caller's `t`. */
function buildLedgerMeta(
    t: TFunction
): Record<string, { label: string; cls: string; isCredit: boolean }> {
    return {
        DEBIT_ACCRUAL: {
            label: t('ledger.invoiceRaised'),
            cls: 'bg-red-50 text-red-700 border-red-200',
            isCredit: false,
        },
        CREDIT_PAYMENT: {
            label: t('ledger.paymentReceived'),
            cls: 'bg-green-50 text-green-700 border-green-200',
            isCredit: true,
        },
        CREDIT_WAIVER: {
            label: t('ledger.waiver'),
            cls: 'bg-blue-50 text-blue-700 border-blue-200',
            isCredit: true,
        },
        CREDIT_ADJUSTMENT: {
            label: t('ledger.adjustment'),
            cls: 'bg-amber-50 text-amber-700 border-amber-200',
            isCredit: true,
        },
        DEBIT_PENALTY: {
            label: t('ledger.penalty'),
            cls: 'bg-orange-50 text-orange-700 border-orange-200',
            isCredit: false,
        },
    };
}

function collectPackageSessions(invites: any[]): { id: string; label: string }[] {
    const seen = new Set<string>();
    const out: { id: string; label: string }[] = [];
    for (const inv of invites || []) {
        // Primary shape (current `/scoped-invites` response): each invite carries a
        // `package_sessions: [{ id, package_name, level_name, session_name }]` array
        // — that's the enriched payload the FE Courses card already uses.
        const enriched = (inv?.package_sessions || []) as any[];
        for (const ps of enriched) {
            if (!ps?.id || seen.has(ps.id)) continue;
            seen.add(ps.id);
            const label = buildPsLabel(
                ps.package_name,
                ps.level_name,
                ps.session_name,
                ps.id
            );
            out.push({ id: ps.id, label });
        }

        // Legacy shape (kept as a fallback in case any caller still returns the old
        // PSLIPO-mappings array). Skipped when the enriched array is populated.
        if (enriched.length > 0) continue;
        const legacyLinks =
            inv?.package_session_to_payment_options
            || inv?.packageSessionToPaymentOptions
            || [];
        for (const link of legacyLinks) {
            const psId = link?.package_session_id || link?.packageSessionId;
            if (!psId || seen.has(psId)) continue;
            seen.add(psId);
            const label =
                link?.package_session?.name
                || inv?.name
                || inv?.invite_name
                || psId;
            out.push({ id: psId, label });
        }
    }
    return out;
}

/** 4-cell grid: total accrued / paid / balance / overdue from the ledger. */
function AccountSummaryGrid({ summary }: { summary: UserAccountSummaryDTO }) {
    // Same namespace as the parent panel — this is a small sub-component of it, not
    // an independently-routed piece of UI, so it doesn't need its own catalog.
    const { t } = useTranslation('manageSuborgTeamsSubOrgAnalyticsPanel');
    const sym = summary.currency === 'USD' ? '$' : summary.currency === 'EUR' ? '€' : '₹';
    const fmt = (v: number) =>
        `${sym}${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    const cells = [
        { label: t('accountSummaryGrid.totalAccrued'), value: fmt(summary.total_accrued), danger: false },
        { label: t('accountSummaryGrid.totalPaid'), value: fmt(summary.total_paid), danger: false, success: true },
        { label: t('accountSummaryGrid.due'), value: fmt(summary.balance), danger: summary.balance > 0 },
        { label: t('accountSummaryGrid.pastDue'), value: fmt(summary.overdue), danger: summary.overdue > 0 },
    ];
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cells.map(({ label, value, danger, success }) => (
                <div key={label} className="rounded border bg-muted/30 p-2">
                    <p className="text-caption uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className={`mt-0.5 text-sm font-semibold ${danger ? 'text-danger-600' : success ? 'text-emerald-600' : 'text-gray-900'}`}>
                        {value}
                    </p>
                </div>
            ))}
        </div>
    );
}

/** Shared with the header stat cards so both render an amount the same way. */
export function fmtMoney(v: number | null | undefined): string {
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
