import { useEffect, useMemo, useState } from 'react';
import { OfflinePaymentFields } from '@/components/common/payments/OfflinePaymentFields';
import { toOfflinePaymentDetailsPayload, type OfflinePaymentDetails } from '@/services/offline-payment-modes';
import { useTranslation } from 'react-i18next';
import { MemberHistoryDrawer } from './member-history-drawer';
import { isCallerSubOrgAdmin } from '@/lib/auth/facultyAccessUtils';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getSubscriptionStatus,
    getScopedInvites,
    addSubOrgMember,
    getSubOrgFinanceDetail,
    updateSubOrgTeamRoles,
    getAllRoles,
    type SubOrgSubscriptionStatus,
    type AddSubOrgMemberRequest,
    type SubOrgFinanceDetail,
} from '../../-services/custom-team-services';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL, GET_SUB_ORG_ALL_ADMINS } from '@/constants/urls';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { Copy, Link2, BookOpen, ShieldCheck, ExternalLink, UserPlus, Loader2, Wallet, GraduationCap } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import createInviteLink from '@/routes/manage-students/invite/-utils/createInviteLink';
import PhoneInput from 'react-phone-input-2';
import { validatePhoneField } from '@/lib/phone-validation';
import 'react-phone-input-2/lib/bootstrap.css';
import { getPreferredPhoneCountries } from '@/services/domain-routing';

interface SubOrgDetailModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    org: any;
}

export function SubOrgDetailModal({ open, onOpenChange, org }: SubOrgDetailModalProps) {
    const { t } = useTranslation('manageCustomTeamsSubOrgDetailModal');
    const subOrgId =
        org?.sub_org_id || org?.suborgId || org?.subOrgId || org?.suborg_id || org?.id;
    const name =
        org?.name ||
        org?.institute_name ||
        org?.instituteName ||
        org?.subOrgName ||
        'Unknown';
    const instituteId = getCurrentInstituteId();

    // Fetch subscription status (invite link, seat usages)
    const { data: subscriptionStatus, isLoading: isLoadingStatus } =
        useQuery<SubOrgSubscriptionStatus>({
            queryKey: ['sub-org-subscription-status', subOrgId],
            queryFn: () => getSubscriptionStatus(subOrgId),
            enabled: !!subOrgId && open,
        });

    // Fetch scoped invites (courses linked to this sub-org)
    const { data: scopedInvites = [], isLoading: isLoadingInvites } = useQuery<any[]>({
        queryKey: ['sub-org-scoped-invites', subOrgId],
        queryFn: () => getScopedInvites(subOrgId),
        enabled: !!subOrgId && open,
    });

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        toast.success(t('inviteLink.copiedToast', { label }));
    };

    const isLoading = isLoadingStatus || isLoadingInvites;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] w-[95vw] flex-col overflow-hidden sm:max-w-[700px]">
                <DialogHeader className="shrink-0">
                    <DialogTitle>{name}</DialogTitle>
                    <DialogDescription>{t('dialog.description')}</DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="py-8">
                        <DashboardLoader />
                    </div>
                ) : (
                    <div className="-mx-2 flex-1 overflow-y-auto px-2">
                        <div className="space-y-6 pb-2">
                            {/* Invite Link Section */}
                            <div className="space-y-2">
                                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                                    <Link2 className="h-4 w-4" />
                                    {t('inviteLink.heading')}
                                </h3>
                                {subscriptionStatus?.invite_code ? (
                                    <div className="space-y-2 rounded-md border bg-muted/50 p-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium text-muted-foreground">
                                                {t('inviteLink.label')}
                                            </span>
                                            {subscriptionStatus.org_user_plan_status && (
                                                <Badge
                                                    variant={
                                                        subscriptionStatus.org_user_plan_status ===
                                                        'ACTIVE'
                                                            ? 'default'
                                                            : 'secondary'
                                                    }
                                                >
                                                    {subscriptionStatus.org_user_plan_status}
                                                </Badge>
                                            )}
                                        </div>
                                        {/* Full invite link */}
                                        <div className="flex items-center gap-2 rounded bg-white p-2">
                                            <span className="min-w-0 flex-1 truncate text-xs font-mono text-primary select-all">
                                                {subscriptionStatus.short_url ||
                                                    createInviteLink(subscriptionStatus.invite_code)}
                                            </span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 shrink-0 gap-1 px-2"
                                                onClick={() =>
                                                    copyToClipboard(
                                                        subscriptionStatus.short_url ||
                                                            createInviteLink(subscriptionStatus.invite_code),
                                                        t('inviteLink.copyLinkLabel')
                                                    )
                                                }
                                            >
                                                <Copy className="h-3 w-3" />
                                                {t('inviteLink.copy')}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 shrink-0 gap-1 px-2"
                                                onClick={() =>
                                                    window.open(
                                                        subscriptionStatus.short_url ||
                                                            createInviteLink(subscriptionStatus.invite_code),
                                                        '_blank'
                                                    )
                                                }
                                            >
                                                <ExternalLink className="h-3 w-3" />
                                                {t('inviteLink.open')}
                                            </Button>
                                        </div>
                                        {/* Invite code (secondary) */}
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span>{t('inviteLink.codeLabel')}</span>
                                            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">
                                                {subscriptionStatus.invite_code}
                                            </code>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 w-5 p-0"
                                                onClick={() =>
                                                    copyToClipboard(
                                                        subscriptionStatus.invite_code,
                                                        t('inviteLink.copyCodeLabel')
                                                    )
                                                }
                                            >
                                                <Copy className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        {t('inviteLink.empty')}
                                    </p>
                                )}
                            </div>

                            {/* Courses Section — flattened package sessions across all
                                active invites for this sub-org, deduped by PS id. */}
                            {(() => {
                                const psMap = new Map<string, { id: string; label: string }>();
                                for (const inv of scopedInvites as any[]) {
                                    for (const ps of (inv?.package_sessions || []) as any[]) {
                                        if (!ps?.id || psMap.has(ps.id)) continue;
                                        const label = [
                                            ps.package_name,
                                            ps.level_name,
                                            ps.session_name,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ') || ps.id;
                                        psMap.set(ps.id, { id: ps.id, label });
                                    }
                                }
                                const psList = Array.from(psMap.values());
                                return (
                                    <div className="space-y-2">
                                        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                                            <BookOpen className="h-4 w-4" />
                                            {t('courses.heading', { count: psList.length })}
                                        </h3>
                                        {psList.length > 0 ? (
                                            <div className="space-y-2">
                                                {psList.map((ps) => (
                                                    <div
                                                        key={ps.id}
                                                        className="flex items-center justify-between rounded-md border p-3"
                                                    >
                                                        <p className="text-sm font-medium">
                                                            {ps.label}
                                                        </p>
                                                        <Badge variant="outline" className="text-[10px]">
                                                            {t('courses.psBadge')}
                                                        </Badge>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">
                                                {t('courses.empty')}
                                            </p>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* Seat Usage Section */}
                            {subscriptionStatus?.seat_usages &&
                                subscriptionStatus.seat_usages.length > 0 && (
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-semibold text-gray-700">
                                            {t('seatUsage.heading')}
                                        </h3>
                                        <div className="space-y-2">
                                            {subscriptionStatus.seat_usages.map((su) => (
                                                <div
                                                    key={su.package_session_id}
                                                    className="flex items-center justify-between rounded-md border p-3"
                                                >
                                                    <span className="text-sm">
                                                        {su.package_name ||
                                                            su.package_session_id}
                                                    </span>
                                                    <span className="text-sm font-medium">
                                                        {t('seatUsage.usedOfTotal', {
                                                            used: su.used_seats,
                                                            total: su.total_seats,
                                                            count: su.total_seats,
                                                        })}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                            {/* Admins Section */}
                            {/* Allowed team roles — parent admin can edit which custom
                                roles the sub-org admin may assign on /manage-suborg-teams. */}
                            <AllowedTeamRolesSection
                                subOrgId={subOrgId}
                                scopedInvites={scopedInvites}
                            />

                            <SubOrgAdminsSection subOrgId={subOrgId} />

                            {/* Finance Section — admin's CPO ledger + learner outstanding dues */}
                            <SubOrgFinanceSection subOrgId={subOrgId} />

                            {/* Add User Section — kept inside the scroll area so the dialog
                                doesn't grow past the viewport when the form expands. */}
                            <AddUserToSubOrgSection
                                subOrgId={subOrgId}
                                instituteId={instituteId || ''}
                                scopedInvites={scopedInvites}
                            />
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

export function AddUserToSubOrgSection({
    subOrgId,
    instituteId,
    scopedInvites,
}: {
    subOrgId: string;
    instituteId: string;
    scopedInvites: any[];
}) {
    const { t } = useTranslation('manageCustomTeamsSubOrgDetailModal');
    const queryClient = useQueryClient();
    const [showForm, setShowForm] = useState(false);
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [mobileNumber, setMobileNumber] = useState('');
    // (Course + role pickers removed — both are inherited from sub-org creation.)

    // Institute preference first, then the country this portal is being used
    // from. Resolved once — the answer cannot change while the modal is open.
    const {
        defaultCountry: phoneDefaultCountry,
        preferredCountries: phonePreferredCountries,
    } = useMemo(() => getPreferredPhoneCountries(), []);

    // Per-learner payment-option override. "FREE" → no override (default).
    // A CPO mirror id → backend generates SFPs + applies cpoConfig + FIFO-allocates payment.
    const [selectedPaymentOptionId, setSelectedPaymentOptionId] = useState<string>('FREE');

    // Default the admin-payment selection to whatever was picked at sub-org creation
    // (the org-level invite carries the CPO id). Falls back to FREE when the sub-org
    // was created without a CPO. Admin can flip it manually afterwards.
    const subOrgDefaultCpoId = useMemo<string | null>(() => {
        for (const inv of scopedInvites as any[]) {
            if (inv?.payment_type === 'CPO' && inv?.complex_payment_option_id) {
                return String(inv.complex_payment_option_id);
            }
        }
        return null;
    }, [scopedInvites]);
    // Seed once the CPO id actually shows up in the scoped-invites response. The
    // previous one-shot guard marked the form "seeded" before the query had loaded,
    // so the dropdown stayed on "FREE" even when the sub-org was CPO-backed — and
    // the installment editor (gated on selectedPaymentOptionId !== 'FREE') never
    // rendered. Re-seed only if the user hasn't manually touched the dropdown.
    useEffect(() => {
        if (!showForm) return;
        if (!subOrgDefaultCpoId) return; // data not loaded yet OR sub-org isn't CPO
        if (selectedPaymentOptionId !== 'FREE') return; // user already picked something
        setSelectedPaymentOptionId(subOrgDefaultCpoId);
    }, [showForm, subOrgDefaultCpoId, selectedPaymentOptionId]);
    // Per-installment edits keyed by aft_installment_id.
    type InstallmentEdit = {
        amount?: string;
        dueDate?: string;
        discountValue?: string;
        discountType?: 'PERCENTAGE' | 'FLAT';
    };
    const [installmentEdits, setInstallmentEdits] = useState<Record<string, InstallmentEdit>>({});
    const [cpoDiscountValue, setCpoDiscountValue] = useState<string>('');
    const [cpoDiscountType, setCpoDiscountType] = useState<'PERCENTAGE' | 'FLAT'>('PERCENTAGE');

    // Optional manual offline-payment recording for the new member.
    const [paymentMode, setPaymentMode] = useState<'SKIP' | 'OFFLINE'>('SKIP');
    const [offlineAmount, setOfflineAmount] = useState<string>('');
    const [offlineCurrency, setOfflineCurrency] = useState<string>('INR');
    const [offlineDetails, setOfflineDetails] = useState<OfflinePaymentDetails>({});
    const [offlineDetailsError, setOfflineDetailsError] = useState<string | null>(null);
    const [offlineDate, setOfflineDate] = useState<string>(''); // yyyy-mm-dd
    // Default ON — admin recording an offline payment almost always wants the
    // invoice as a paper trail. Was previously `false`, which silently dropped
    // the invoice unless the admin explicitly ticked the box (easy to miss).
    const [generateInvoice, setGenerateInvoice] = useState<boolean>(true);

    // Fetch the institute's CPO list so the admin can pick a per-learner CPO.
    const { data: cpoListResponse } = useQuery({
        queryKey: ['sub-org-add-user-cpo-list', instituteId],
        queryFn: async () => {
            const url = `${BASE_URL}/admin-core-service/v1/fee-management/cpo/${instituteId}`;
            const resp = await authenticatedAxiosInstance({
                method: 'GET',
                url,
                params: { pageNo: 0, pageSize: 100 },
            });
            return resp.data;
        },
        enabled: showForm && !!instituteId,
        staleTime: 30000,
    });
    const cpoList: Array<{ id: string; name: string; status?: string }> =
        (cpoListResponse?.content || []).filter((c: any) => c.status === 'ACTIVE');

    // Fetch the full CPO template when admin picks one. Used to render the installment editor.
    const { data: cpoFullDetails, isLoading: isLoadingCpoTemplate } = useQuery({
        queryKey: ['sub-org-add-user-cpo-full', selectedPaymentOptionId],
        queryFn: async () => {
            // selectedPaymentOptionId is the PaymentOption mirror id; we need the CPO id.
            // Find the matching cpo in cpoList — they share the same id-space via mirror.
            const url = `${BASE_URL}/admin-core-service/v1/fee-management/cpo/${selectedPaymentOptionId}/full`;
            const resp = await authenticatedAxiosInstance({ method: 'GET', url });
            return resp.data;
        },
        enabled: showForm && selectedPaymentOptionId !== 'FREE' && !!selectedPaymentOptionId,
        staleTime: 30000,
    });

    // Flatten the CPO template into a per-installment list for the editor.
    type InstallmentRow = {
        aftInstallmentId: string;
        feeTypeName: string;
        installmentNumber: number;
        defaultAmount: number;
        defaultDueDate?: string;
    };
    const installmentRows: InstallmentRow[] = ((): InstallmentRow[] => {
        const rows: InstallmentRow[] = [];
        const feeTypes = (cpoFullDetails as any)?.feeTypes
            || (cpoFullDetails as any)?.fee_types
            || [];
        for (const ft of feeTypes) {
            const afv = ft?.assignedFeeValue || ft?.assigned_fee_value;
            const installments = afv?.installments || [];
            for (const inst of installments) {
                rows.push({
                    aftInstallmentId: inst.id,
                    feeTypeName: ft.name || 'Fee',
                    installmentNumber: inst.installmentNumber ?? inst.installment_number,
                    defaultAmount: Number(inst.amount ?? 0),
                    defaultDueDate: inst.dueDate || inst.due_date,
                });
            }
        }
        rows.sort((a, b) => a.installmentNumber - b.installmentNumber);
        return rows;
    })();

    // Auto-derive every PS this sub-org owns + the auth role for the admin — both were
    // chosen at sub-org creation, so the admin shouldn't be re-asked here.
    type AdminPs = { id: string; label: string };
    const adminPsList: AdminPs[] = ((): AdminPs[] => {
        const seen = new Map<string, AdminPs>();
        for (const inv of scopedInvites as any[]) {
            for (const ps of (inv?.package_sessions || []) as any[]) {
                if (!ps?.id || seen.has(ps.id)) continue;
                const label = [ps.package_name, ps.level_name, ps.session_name]
                    .filter(Boolean)
                    .join(' · ') || ps.id;
                seen.set(ps.id, { id: ps.id, label });
            }
        }
        return Array.from(seen.values());
    })();

    // First auth role from any invite's setting_json (e.g. {"setting":{"SUB_ORG_SETTING":
    // {"AUTH_ROLES":["TEACHER"]}}}). Falls back to STUDENT if absent.
    const derivedRoleName: string = ((): string => {
        for (const inv of scopedInvites as any[]) {
            const raw = inv?.setting_json;
            if (!raw) continue;
            try {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                const roles = parsed?.setting?.SUB_ORG_SETTING?.AUTH_ROLES;
                if (Array.isArray(roles) && roles.length > 0) return String(roles[0]);
            } catch {
                /* fall through */
            }
        }
        return 'STUDENT';
    })();

    const mutation = useMutation({
        mutationFn: addSubOrgMember,
        onSuccess: (data) => {
            const parts: string[] = [data.message || t('addUser.addSuccessDefault')];
            if (data.payment_log_id) parts.push(t('addUser.paymentRecorded'));
            if (data.invoice_id) parts.push(t('addUser.invoiceGenerated'));
            toast.success(parts.join(' · '));
            queryClient.invalidateQueries({ queryKey: ['sub-org-admins-detail', subOrgId] });
            queryClient.invalidateQueries({
                queryKey: ['sub-org-subscription-status', subOrgId],
            });
            queryClient.invalidateQueries({ queryKey: ['sub-org-finance-detail', subOrgId] });
            resetForm();
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message || t('addUser.addError'));
        },
    });

    const resetForm = () => {
        setFullName('');
        setEmail('');
        setMobileNumber('');
        setPaymentMode('SKIP');
        setOfflineAmount('');
        setOfflineCurrency('INR');
        setOfflineDetails({});
        setOfflineDate('');
        // Match the useState initial default — ON, so admins don't lose their invoice
        // paper trail on the next Add User submit.
        setGenerateInvoice(true);
        setSelectedPaymentOptionId('FREE');
        // hasSeededPaymentOption was removed when the auto-seed race fix landed; the
        // new effect (in this file above) re-seeds whenever subOrgDefaultCpoId becomes
        // available AND the current selection is still 'FREE', so no manual reset is
        // needed here. Leaving the stale setter call would throw inside the mutation's
        // onSuccess (the form HAS been added on the backend, but the UI surfaces the
        // generic "Failed to add user" toast).
        setInstallmentEdits({});
        setCpoDiscountValue('');
        setCpoDiscountType('PERCENTAGE');
        setShowForm(false);
    };

    const handleSubmit = () => {
        if (!fullName.trim()) {
            toast.error(t('addUser.fullNameRequired'));
            return;
        }
        if (!email.trim()) {
            toast.error(t('addUser.emailRequired'));
            return;
        }
        // Note: validatePhoneField is a shared, non-i18n-aware utility (out of
        // scope for this file) — its 'Mobile number' label arg feeds an
        // English-only wrapper message, so it isn't translated here.
        const mobileError = validatePhoneField(mobileNumber, { label: 'Mobile number' });
        if (mobileError) {
            toast.error(mobileError);
            return;
        }
        if (adminPsList.length === 0) {
            toast.error(t('addUser.noPackageSessions'));
            return;
        }

        // Manual offline payment validation.
        let amountNum: number | undefined;
        if (paymentMode === 'OFFLINE') {
            amountNum = Number(offlineAmount);
            if (!offlineAmount.trim() || Number.isNaN(amountNum) || amountNum <= 0) {
                toast.error(t('addUser.offlineAmountInvalid'));
                return;
            }
            if (offlineDetailsError) {
                toast.error(offlineDetailsError);
                return;
            }
        }
        const offlinePaymentDetails =
            paymentMode === 'OFFLINE' ? toOfflinePaymentDetailsPayload(offlineDetails) : null;

        const request: AddSubOrgMemberRequest = {
            user: {
                email: email.trim(),
                full_name: fullName.trim(),
                mobile_number: mobileNumber.trim() || undefined,
                roles: [derivedRoleName],
            },
            // Multi-PS — admin gets access to every PS this sub-org owns in one call.
            package_session_ids: adminPsList.map((p) => p.id),
            sub_org_id: subOrgId,
            institute_id: instituteId,
            comma_separated_org_roles: 'ROOT_ADMIN',
            payment_mode: paymentMode,
            offline_payment_amount: paymentMode === 'OFFLINE' ? amountNum : undefined,
            offline_payment_currency:
                paymentMode === 'OFFLINE' ? (offlineCurrency || 'INR') : undefined,
            offline_payment_reference: offlinePaymentDetails?.reference ?? undefined,
            offline_payment_details: offlinePaymentDetails,
            offline_payment_date:
                paymentMode === 'OFFLINE' && offlineDate
                    ? new Date(offlineDate).toISOString()
                    : undefined,
            generate_invoice: paymentMode === 'OFFLINE' ? generateInvoice : undefined,
        };

        if (selectedPaymentOptionId !== 'FREE') {
            request.payment_option_id = selectedPaymentOptionId;

            // Build cpo_config from per-installment edits + CPO-level discount, but only
            // include rows the admin actually touched.
            const overrides: AddSubOrgMemberRequest['cpo_config'] = {};
            const edits: NonNullable<AddSubOrgMemberRequest['cpo_config']>['installment_overrides'] = [];
            for (const row of installmentRows) {
                const edit = installmentEdits[row.aftInstallmentId];
                if (!edit) continue;
                const amount =
                    edit.amount && edit.amount.trim() !== '' ? Number(edit.amount) : undefined;
                const dueDate = edit.dueDate || undefined;
                const discountVal =
                    edit.discountValue && edit.discountValue.trim() !== ''
                        ? Number(edit.discountValue)
                        : undefined;
                const hasEdit =
                    amount !== undefined || dueDate || discountVal !== undefined;
                if (!hasEdit) continue;
                edits.push({
                    aft_installment_id: row.aftInstallmentId,
                    amount,
                    due_date: dueDate,
                    discount:
                        discountVal !== undefined
                            ? {
                                  type: edit.discountType || 'PERCENTAGE',
                                  value: discountVal,
                              }
                            : undefined,
                });
            }
            if (edits.length > 0) overrides.installment_overrides = edits;
            if (cpoDiscountValue.trim() !== '') {
                overrides.cpo_discount = {
                    type: cpoDiscountType,
                    value: Number(cpoDiscountValue),
                };
            }
            if (overrides.installment_overrides || overrides.cpo_discount) {
                request.cpo_config = overrides;
            }
        }
        mutation.mutate(request);
    };

    // Hide only if there are literally no courses to assign — otherwise show the form,
    // even when the only invite is the bundled org-level SUB_ORG one.
    if (adminPsList.length === 0) return null;

    return (
        <div className="space-y-3 border-t pt-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <UserPlus className="h-4 w-4" />
                {t('addUser.heading')}
            </h3>
            {!showForm && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowForm(true)}
                >
                    <UserPlus className="mr-1 h-3 w-3" />
                    {t('addUser.toggleButton')}
                </Button>
            )}

            {showForm && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label className="text-xs">{t('addUser.fullNameLabel')}</Label>
                            <Input
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder={t('addUser.fullNamePlaceholder')}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">{t('addUser.emailLabel')}</Label>
                            <Input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={t('addUser.emailPlaceholder')}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">{t('addUser.phoneLabel')}</Label>
                            <PhoneInput
                                country={phoneDefaultCountry}
                                preferredCountries={phonePreferredCountries}
                                enableSearch
                                placeholder={t('addUser.phonePlaceholder')}
                                value={mobileNumber}
                                onChange={(value) => setMobileNumber(value)}
                                inputClass="!w-full h-8"
                            />
                        </div>
                    </div>

                    {/* Inherited from sub-org creation — admin lands on all PSes + the
                        auth role chosen at creation time. Shown read-only so the operator
                        can verify what's being granted. */}
                    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
                        <p className="font-medium text-muted-foreground">
                            {t('addUser.inheritedHeading')}
                        </p>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="text-muted-foreground">{t('addUser.roleLabel')}</span>
                            <Badge variant="outline">{derivedRoleName}</Badge>
                        </div>
                        <div>
                            <p className="text-muted-foreground">
                                {t('addUser.coursesLabel', { count: adminPsList.length })}
                            </p>
                            <ul className="ml-3 mt-1 list-disc space-y-0.5">
                                {adminPsList.map((p) => (
                                    <li key={p.id}>{p.label}</li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Admin payment — the sub-org admin pays via this CPO. Each sub-org's
                        admin can have a different CPO + per-installment discount. */}
                    <div className="space-y-3 rounded-md border bg-white p-3">
                        <div className="flex items-center gap-2">
                            <Wallet className="h-4 w-4 text-muted-foreground" />
                            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {t('addUser.adminPaymentLabel')}
                            </Label>
                        </div>
                        <Select
                            value={selectedPaymentOptionId}
                            onValueChange={setSelectedPaymentOptionId}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('addUser.pickPlanPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="FREE">{t('addUser.freeOption')}</SelectItem>
                                {cpoList.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                        {t('addUser.cpoOption', { name: c.name })}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {selectedPaymentOptionId !== 'FREE' && (
                            <p className="text-[10px] text-muted-foreground">
                                {t('addUser.cpoHelper')}
                            </p>
                        )}
                    </div>

                    {/* Installment editor — shows when a CPO is picked above. Per-installment
                        amount + due-date + discount overrides, plus a CPO-level discount.
                        Applied to the admin's own SFP rows via CpoEnrollmentConfigApplier. */}
                    {selectedPaymentOptionId !== 'FREE' && (
                        <div className="space-y-3 rounded-md border bg-white p-3">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {t('addUser.installmentsLabel')}
                            </Label>
                            {isLoadingCpoTemplate ? (
                                <p className="text-xs text-muted-foreground">
                                    {t('addUser.loadingTemplate')}
                                </p>
                            ) : installmentRows.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    {t('addUser.noInstallments')}
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {installmentRows.map((row) => {
                                        const edit = installmentEdits[row.aftInstallmentId] || {};
                                        const updateEdit = (patch: InstallmentEdit) =>
                                            setInstallmentEdits((prev) => ({
                                                ...prev,
                                                [row.aftInstallmentId]: { ...prev[row.aftInstallmentId], ...patch },
                                            }));
                                        return (
                                            <div
                                                key={row.aftInstallmentId}
                                                className="space-y-1 rounded border bg-muted/20 p-2 text-xs"
                                            >
                                                <p className="font-medium">
                                                    {t('addUser.installmentRowTitle', {
                                                        number: row.installmentNumber,
                                                        feeType: row.feeTypeName,
                                                    })}
                                                </p>
                                                <div className="grid gap-2 sm:grid-cols-3">
                                                    <div>
                                                        <Label className="text-[10px]">{t('addUser.amountLabel')}</Label>
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            placeholder={row.defaultAmount.toFixed(2)}
                                                            value={edit.amount ?? ''}
                                                            onChange={(e) =>
                                                                updateEdit({ amount: e.target.value })
                                                            }
                                                            className="h-7 text-xs"
                                                        />
                                                    </div>
                                                    <div>
                                                        <Label className="text-[10px]">{t('addUser.dueDateLabel')}</Label>
                                                        <Input
                                                            type="date"
                                                            value={edit.dueDate ?? ''}
                                                            onChange={(e) =>
                                                                updateEdit({ dueDate: e.target.value })
                                                            }
                                                            className="h-7 text-xs"
                                                        />
                                                    </div>
                                                    <div className="flex gap-1">
                                                        <div className="flex-1">
                                                            <Label className="text-[10px]">{t('addUser.discountLabel')}</Label>
                                                            <Input
                                                                type="number"
                                                                step="0.01"
                                                                placeholder="0"
                                                                value={edit.discountValue ?? ''}
                                                                onChange={(e) =>
                                                                    updateEdit({
                                                                        discountValue: e.target.value,
                                                                    })
                                                                }
                                                                className="h-7 text-xs"
                                                            />
                                                        </div>
                                                        <div className="w-[80px]">
                                                            <Label className="text-[10px]">{t('addUser.typeLabel')}</Label>
                                                            <Select
                                                                value={edit.discountType || 'PERCENTAGE'}
                                                                onValueChange={(v) =>
                                                                    updateEdit({
                                                                        discountType: v as
                                                                            | 'PERCENTAGE'
                                                                            | 'FLAT',
                                                                    })
                                                                }
                                                            >
                                                                <SelectTrigger className="h-7 text-xs">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="PERCENTAGE">
                                                                        %
                                                                    </SelectItem>
                                                                    <SelectItem value="FLAT">
                                                                        ₹
                                                                    </SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                </div>
                                                {row.defaultDueDate && (
                                                    <p className="text-[10px] text-muted-foreground">
                                                        {t('addUser.defaultDue', {
                                                            date: row.defaultDueDate,
                                                        })}
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {/* CPO-level discount applied proportionally across all installments */}
                                    <div className="space-y-1 rounded border bg-muted/10 p-2 text-xs">
                                        <p className="font-medium">{t('addUser.cpoDiscountHeading')}</p>
                                        <p className="text-[10px] text-muted-foreground">
                                            {t('addUser.cpoDiscountHelper')}
                                        </p>
                                        <div className="flex gap-2">
                                            <Input
                                                type="number"
                                                step="0.01"
                                                placeholder="0"
                                                value={cpoDiscountValue}
                                                onChange={(e) =>
                                                    setCpoDiscountValue(e.target.value)
                                                }
                                                className="h-7 text-xs"
                                            />
                                            <Select
                                                value={cpoDiscountType}
                                                onValueChange={(v) =>
                                                    setCpoDiscountType(v as 'PERCENTAGE' | 'FLAT')
                                                }
                                            >
                                                <SelectTrigger className="h-7 w-[80px] text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="PERCENTAGE">%</SelectItem>
                                                    <SelectItem value="FLAT">₹</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Manual offline-payment recording — mirrors bulk/v3/assign skip/offline pattern.
                        For CPO admins, the recorded payment FIFO-allocates across the SFP rows. */}
                    <div className="space-y-3 rounded-md border bg-white p-3">
                        <div className="flex items-center gap-2">
                            <Wallet className="h-4 w-4 text-muted-foreground" />
                            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {t('addUser.recordPaymentHeading')}
                            </Label>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant={paymentMode === 'SKIP' ? 'default' : 'outline'}
                                onClick={() => setPaymentMode('SKIP')}
                                disabled={mutation.isPending}
                                className="flex-1"
                            >
                                {t('addUser.skip')}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={paymentMode === 'OFFLINE' ? 'default' : 'outline'}
                                onClick={() => setPaymentMode('OFFLINE')}
                                disabled={mutation.isPending}
                                className="flex-1"
                            >
                                {t('addUser.recordOfflinePayment')}
                            </Button>
                        </div>
                        {paymentMode === 'OFFLINE' && (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">{t('addUser.amountRequiredLabel')}</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={offlineAmount}
                                        onChange={(e) => setOfflineAmount(e.target.value)}
                                        placeholder="0.00"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">{t('addUser.currencyLabel')}</Label>
                                    <Select
                                        value={offlineCurrency}
                                        onValueChange={setOfflineCurrency}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="INR">INR</SelectItem>
                                            <SelectItem value="USD">USD</SelectItem>
                                            <SelectItem value="AUD">AUD</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">{t('addUser.paymentDateLabel')}</Label>
                                    <Input
                                        type="date"
                                        value={offlineDate}
                                        onChange={(e) => setOfflineDate(e.target.value)}
                                    />
                                </div>
                                {/* How it was paid: mode, option (e.g. PhonePe), reference, proof. */}
                                <div className="sm:col-span-2">
                                    <OfflinePaymentFields
                                        value={offlineDetails}
                                        onChange={setOfflineDetails}
                                        onErrorChange={setOfflineDetailsError}
                                    />
                                </div>
                                <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
                                    <input
                                        type="checkbox"
                                        checked={generateInvoice}
                                        onChange={(e) => setGenerateInvoice(e.target.checked)}
                                        className="h-4 w-4"
                                    />
                                    <span className="text-xs">
                                        {t('addUser.generateInvoiceLabel')}
                                    </span>
                                </label>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={resetForm}
                            disabled={mutation.isPending}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleSubmit}
                            disabled={mutation.isPending}
                        >
                            {mutation.isPending && (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            )}
                            {t('addUser.submitButton')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

function SubOrgFinanceSection({ subOrgId }: { subOrgId: string }) {
    const { t } = useTranslation('manageCustomTeamsSubOrgDetailModal');
    const instituteId = getCurrentInstituteId();
    const { data, isLoading, isError } = useQuery<SubOrgFinanceDetail>({
        queryKey: ['sub-org-finance-detail', subOrgId],
        queryFn: () => getSubOrgFinanceDetail(subOrgId, instituteId || undefined),
        enabled: !!subOrgId,
    });

    // Right-side drawer state — opens with CpoInstallmentsEditor + invoices for the
    // clicked row. The editor is safe for non-CPO members (renders nothing).
    const [drawer, setDrawer] = useState<{
        userId: string;
        name?: string;
        subtitle?: string;
    } | null>(null);

    if (isLoading) {
        return (
            <div className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Wallet className="h-4 w-4" />
                    {t('finance.heading')}
                </h3>
                <p className="text-sm text-muted-foreground">{t('finance.loading')}</p>
            </div>
        );
    }

    if (isError || !data) {
        return (
            <div className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Wallet className="h-4 w-4" />
                    {t('finance.heading')}
                </h3>
                <p className="text-sm text-muted-foreground">
                    {t('finance.loadError')}
                </p>
            </div>
        );
    }

    const admin = data.admin_payment;
    const learners = data.learners || [];
    const totals = data.totals;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Wallet className="h-4 w-4" />
                    {t('finance.heading')}
                </h3>
                {totals && (
                    <span className="text-xs text-muted-foreground">
                        {t('finance.summary', {
                            count: totals.learner_count,
                            outstanding: fmtMoney(totals.total_outstanding),
                        })}
                    </span>
                )}
            </div>

            {/* Admin payment block */}
            {admin?.user_id ? (
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                        setDrawer({
                            userId: admin.user_id!,
                            name: admin.full_name || admin.user_id,
                            subtitle: t('finance.subOrgAdmin'),
                        })
                    }
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setDrawer({
                                userId: admin.user_id!,
                                name: admin.full_name || admin.user_id,
                                subtitle: t('finance.subOrgAdmin'),
                            });
                        }
                    }}
                    className="cursor-pointer space-y-2 rounded-md border bg-muted/30 p-3 transition-colors hover:bg-muted/50"
                    title={t('finance.viewInstallmentsTitle')}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium">
                                {t('finance.adminLabel', {
                                    name: admin.full_name || admin.user_id,
                                })}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {admin.payment_type || t('finance.unknownPaymentType')}
                                {admin.user_plan_status ? ` · ${admin.user_plan_status}` : ''}
                            </p>
                        </div>
                        {admin.payment_type === 'CPO' && (
                            <Badge variant="secondary">
                                {t('finance.pendingBadge', {
                                    count: admin.pending_installments_count ?? 0,
                                })}
                            </Badge>
                        )}
                    </div>
                    {admin.payment_type === 'CPO' && (
                        <>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                                <Metric label={t('finance.metricTotal')} value={fmtMoney(admin.total_amount)} />
                                <Metric label={t('finance.metricPaid')} value={fmtMoney(admin.paid_amount)} />
                                <Metric
                                    label={t('finance.metricOutstanding')}
                                    value={fmtMoney(admin.outstanding_amount)}
                                />
                            </div>
                            {admin.next_due && (
                                <div className="rounded bg-white p-2 text-xs">
                                    <span className="text-muted-foreground">{t('finance.nextDue')} </span>
                                    <span className="font-medium">
                                        {fmtMoney(admin.next_due.amount_expected)}
                                    </span>
                                    {admin.next_due.due_date && (
                                        <span className="text-muted-foreground">
                                            {' '}
                                            {t('finance.onDate', {
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
                                <details
                                    className="text-xs"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
                                        {t('finance.viewFullLedger', {
                                            count: admin.installments.length,
                                        })}
                                    </summary>
                                    <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded bg-white p-2">
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
                                                        className="h-4 px-1.5 text-[10px]"
                                                    >
                                                        {inst.status}
                                                    </Badge>
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )}
                        </>
                    )}
                </div>
            ) : (
                <p className="text-xs text-muted-foreground">
                    {t('finance.noAdminPayment')}
                </p>
            )}

            {/* Learner roster */}
            <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                    <GraduationCap className="h-3.5 w-3.5" />
                    {t('finance.learnersHeading', { count: learners.length })}
                </h4>
                {learners.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('finance.noLearners')}</p>
                ) : (
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border">
                        {learners.map((l) => {
                            const hasDues =
                                (l.pending_installments_count ?? 0) > 0
                                || (l.outstanding_amount ?? 0) > 0;
                            return (
                                <button
                                    type="button"
                                    key={l.user_id}
                                    onClick={() =>
                                        setDrawer({
                                            userId: l.user_id,
                                            name: l.full_name || l.user_id,
                                            subtitle: t('finance.learnerSubtitle'),
                                        })
                                    }
                                    className="flex w-full items-center justify-between border-b border-muted px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-medium">
                                            {l.full_name || l.user_id}
                                        </p>
                                        {l.enrolled_date && (
                                            <p className="text-[10px] text-muted-foreground">
                                                {t('finance.enrolled', {
                                                    date: fmtDate(l.enrolled_date),
                                                })}
                                            </p>
                                        )}
                                    </div>
                                    {hasDues ? (
                                        <div className="text-right text-xs">
                                            <span className="font-medium text-amber-700">
                                                {fmtMoney(l.outstanding_amount)}
                                            </span>
                                            <span className="ms-1 text-muted-foreground">
                                                {t('finance.dueCount', {
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
            </div>

            <MemberHistoryDrawer
                open={!!drawer}
                onOpenChange={(o) => !o && setDrawer(null)}
                userId={drawer?.userId || null}
                userName={drawer?.name}
                subtitle={drawer?.subtitle}
                readOnly={isCallerSubOrgAdmin()}
            />
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded bg-white p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-sm font-medium">{value}</p>
        </div>
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
    return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function AllowedTeamRolesSection({
    subOrgId,
    scopedInvites,
}: {
    subOrgId: string;
    scopedInvites: any[];
}) {
    const { t } = useTranslation('manageCustomTeamsSubOrgDetailModal');
    const queryClient = useQueryClient();
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState<string[]>([]);

    // Seed draft from scopedInvites[].allowed_team_roles (first non-empty).
    const persistedRoles: string[] = (() => {
        for (const inv of scopedInvites as any[]) {
            const list = inv?.allowed_team_roles;
            if (Array.isArray(list)) return list;
        }
        return [];
    })();

    const { data: rolesList = [] } = useQuery<{ id: string; name: string }[]>({
        queryKey: ['roles'],
        queryFn: getAllRoles,
        staleTime: 1000 * 60 * 5,
        enabled: isEditing,
    });

    const mutation = useMutation({
        mutationFn: (roles: string[]) => updateSubOrgTeamRoles(subOrgId, roles),
        onSuccess: () => {
            toast.success(t('allowedTeamRoles.updateSuccess'));
            queryClient.invalidateQueries({ queryKey: ['sub-org-scoped-invites', subOrgId] });
            queryClient.invalidateQueries({ queryKey: ['sub-org-scoped-invites-for-roles', subOrgId] });
            setIsEditing(false);
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || err?.message || t('allowedTeamRoles.updateError'));
        },
    });

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <ShieldCheck className="h-4 w-4" />
                    {t('allowedTeamRoles.heading')}
                    {persistedRoles.length > 0 && (
                        <Badge variant="secondary">{persistedRoles.length}</Badge>
                    )}
                </h3>
                {!isEditing && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            setDraft(persistedRoles);
                            setIsEditing(true);
                        }}
                    >
                        {t('common.edit')}
                    </Button>
                )}
            </div>

            {!isEditing && (
                persistedRoles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        {t('allowedTeamRoles.noRestriction')}
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {persistedRoles.map((r) => (
                            <Badge key={r} variant="outline" className="text-xs">
                                {r}
                            </Badge>
                        ))}
                    </div>
                )
            )}

            {isEditing && (
                <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">
                        {t('allowedTeamRoles.helper')}
                    </p>
                    <div className="flex flex-wrap gap-2 rounded-md border bg-white p-2">
                        {rolesList.map((role) => (
                            <label
                                key={role.id}
                                className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-muted"
                            >
                                <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5"
                                    checked={draft.includes(role.name)}
                                    onChange={(e) => {
                                        setDraft((prev) =>
                                            e.target.checked
                                                ? [...prev, role.name]
                                                : prev.filter((r) => r !== role.name)
                                        );
                                    }}
                                />
                                {role.name}
                            </label>
                        ))}
                        {rolesList.length === 0 && (
                            <span className="text-xs text-muted-foreground">
                                {t('allowedTeamRoles.loadingRoles')}
                            </span>
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsEditing(false)}
                            disabled={mutation.isPending}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => mutation.mutate(draft)}
                            disabled={mutation.isPending}
                        >
                            {mutation.isPending && (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            )}
                            {t('common.save')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

function SubOrgAdminsSection({ subOrgId }: { subOrgId: string }) {
    const { t } = useTranslation('manageCustomTeamsSubOrgDetailModal');
    const { data: adminsData, isLoading } = useQuery<{
        admins: { user_id: string; name: string; role: string }[];
    }>({
        queryKey: ['sub-org-admins-detail', subOrgId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.get(GET_SUB_ORG_ALL_ADMINS, {
                params: { subOrgId },
            });
            return response.data;
        },
        enabled: !!subOrgId,
    });

    const admins = adminsData?.admins || [];

    return (
        <div className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <ShieldCheck className="h-4 w-4" />
                {t('admins.heading', { count: admins.length })}
            </h3>
            {isLoading ? (
                <p className="text-sm text-muted-foreground">{t('admins.loading')}</p>
            ) : admins.length > 0 ? (
                <div className="space-y-2">
                    {admins.map((admin, idx) => (
                        <div
                            key={admin.user_id || idx}
                            className="flex items-center justify-between rounded-md border p-3"
                        >
                            <div>
                                <p className="text-sm font-medium">{admin.name}</p>
                                <p className="text-xs text-muted-foreground">{admin.role}</p>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">
                    {t('admins.empty')}
                </p>
            )}
        </div>
    );
}
