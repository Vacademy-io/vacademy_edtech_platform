import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INVITE_LINKS, GET_SINGLE_INVITE_DETAILS } from '@/constants/urls';
import type {
    CpoEnrollmentConfig,
    EnrollInviteProjection,
    EnrollInviteDTO,
    PaymentOption,
    PaymentPlan,
} from '@/routes/manage-students/students-list/-types/bulk-assign-types';
import { CpoEnrollmentConfigPanel } from '@/routes/manage-students/students-list/-components/enroll-bulk/components/CpoEnrollmentConfigPanel';
import { useResolvedInviteDetails } from '@/routes/manage-students/students-list/-hooks/useResolvedInviteDetails';
import { formatPlanPrice } from '@/utils/finance-utils';

// ── Per-PS config state (exposed to parent) ──
export interface PackageSessionConfig {
    packageSessionId: string;
    packageSessionName: string;

    selectedInvite: EnrollInviteDTO | null;   // null = auto mode
    isAutoMode: boolean;

    resolvedPaymentOption: PaymentOption | null;
    resolvedPaymentPlan: PaymentPlan | null;

    accessDaysOverride: number | null;

    /**
     * CPO-only structured config, populated when the resolved payment option is a
     * CPO mirror. Carries per-installment date/amount/discount overrides, the
     * whole-CPO discount, and the offline-payment fields. Sent verbatim as
     * `cpo_config` on the AssignmentItem.
     */
    cpoConfig?: CpoEnrollmentConfig;
}

interface InvitePickerRowProps {
    config: PackageSessionConfig;
    onChange: (updated: PackageSessionConfig) => void;
}

/** A collapsible card that lets the admin optionally pick an invite for one package session. */
export const InvitePickerRow = ({ config, onChange }: InvitePickerRowProps) => {
    const { t, i18n } = useTranslation('manageStudentsInvitePickerRow');
    const instituteId = getInstituteId() || '';
    const [expanded, setExpanded] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [invites, setInvites] = useState<EnrollInviteProjection[]>([]);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Resolves the effective PaymentOption — works for both manual (admin picked an invite)
    // and Auto mode (looks up the package session's DEFAULT invite, matching what the
    // backend's DefaultInviteResolver does). Drives the CPO installment panel below.
    const { data: resolvedFromHook } = useResolvedInviteDetails({
        instituteId,
        packageSessionId: config.packageSessionId,
        enrollInviteId: config.selectedInvite?.id ?? null,
    });
    const effectivePaymentOption = config.resolvedPaymentOption ?? resolvedFromHook?.paymentOption ?? null;
    const effectiveCpoId =
        effectivePaymentOption?.type === 'CPO'
            ? effectivePaymentOption.complex_payment_option_id ?? null
            : null;

    // Fetch invite list when the card is expanded
    useEffect(() => {
        if (expanded) {
            fetchInviteList();
        }
    }, [expanded]);

    const fetchInviteList = useCallback(async () => {
        try {
            setIsLoading(true);
            const params = new URLSearchParams({
                instituteId,
                pageNo: '0',
                pageSize: '20',
            });
            const response = await authenticatedAxiosInstance.post(
                `${GET_INVITE_LINKS}?${params}`,
                {
                    search_name: searchQuery || null,
                    package_session_ids: [config.packageSessionId],
                    payment_option_ids: null,
                    sort_columns: { created_at: 'desc' },
                    tags: null,
                }
            );
            setInvites(
                (response.data?.content || []).filter((inv: EnrollInviteProjection) => {
                    const tag = (inv.tag ?? '').trim().toUpperCase();
                    // Hide only the bare SUB_ORG admin/scoped invites — enrolling a
                    // learner through those makes them a ROOT_ADMIN. SUBORG_LEARNER
                    // (the sub-org learner invite) stays selectable.
                    return tag !== 'SUB_ORG';
                })
            );
        } catch {
            setInvites([]);
        } finally {
            setIsLoading(false);
        }
    }, [instituteId, config.packageSessionId, searchQuery]);

    // Fetch full invite details when user clicks on a specific invite
    const selectSpecificInvite = async (projection: EnrollInviteProjection) => {
        try {
            setIsLoadingDetail(true);
            const url = GET_SINGLE_INVITE_DETAILS
                .replace('{instituteId}', instituteId)
                .replace('{enrollInviteId}', projection.id);
            const response = await authenticatedAxiosInstance.get<EnrollInviteDTO>(url);
            const invite = response.data;

            // Auto-resolve payment option + plan
            const matchingPSO = invite.package_session_to_payment_options?.find(
                (pso) =>
                    pso.package_session_id === config.packageSessionId &&
                    pso.status === 'ACTIVE'
            );

            let resolvedOption: PaymentOption | null = null;
            let resolvedPlan: PaymentPlan | null = null;

            if (matchingPSO?.payment_option) {
                resolvedOption = matchingPSO.payment_option;
                const plans = resolvedOption.payment_plans || [];
                const defaultPlan = plans.find(
                    (p) => p.tag === 'DEFAULT' && p.status === 'ACTIVE'
                );
                resolvedPlan =
                    defaultPlan || plans.find((p) => p.status === 'ACTIVE') || null;
            }

            const nextIsCpo = resolvedOption?.type === 'CPO';
            onChange({
                ...config,
                selectedInvite: invite,
                isAutoMode: false,
                resolvedPaymentOption: resolvedOption,
                resolvedPaymentPlan: resolvedPlan,
                // Reset CPO state on each invite change; defaults to SKIP.
                cpoConfig: nextIsCpo
                    ? {
                          installment_overrides: [],
                          cpo_discount: null,
                          payment_mode: 'SKIP',
                          payment_amount: null,
                          payment_reference: null,
                      }
                    : undefined,
            });
            setExpanded(false);
        } catch {
            toast.error(t('errors.loadInviteDetailsFailed'));
        } finally {
            setIsLoadingDetail(false);
        }
    };

    const resetToAuto = () => {
        onChange({
            ...config,
            selectedInvite: null,
            isAutoMode: true,
            resolvedPaymentOption: null,
            resolvedPaymentPlan: null,
            cpoConfig: undefined,
        });
        setExpanded(false);
    };

    const handleSearchChange = (val: string) => {
        setSearchQuery(val);
    };

    // Re-fetch when search changes (debounce-ish via key press + expand)
    useEffect(() => {
        if (!expanded || searchQuery === '') return;
        const timer = setTimeout(() => fetchInviteList(), 300);
        return () => clearTimeout(timer);
    }, [searchQuery, expanded]);

    return (
        <div className="rounded-xl border border-neutral-200 bg-white transition-shadow hover:shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-800">
                        {config.packageSessionName}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                        {config.isAutoMode ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-2xs font-medium text-blue-700">
                                🔄 {t('badge.auto')}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-2xs font-medium text-purple-700">
                                ✦ {config.selectedInvite?.name || t('badge.selectedFallback')}
                            </span>
                        )}
                        {config.resolvedPaymentOption && !config.isAutoMode && (
                            <span className="text-2xs text-neutral-400">
                                · {config.resolvedPaymentOption.name}
                                {config.resolvedPaymentPlan
                                    ? ` → ₹${formatPlanPrice(config.resolvedPaymentPlan.actual_price)}`
                                    : ''}
                            </span>
                        )}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    className="ml-2 shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50"
                >
                    {expanded ? t('actions.close') : t('actions.change')}
                </button>
            </div>

            {/* Expanded invite picker */}
            {expanded && (
                <div className="border-t border-neutral-100 px-4 py-3">
                    {/* Auto option */}
                    <button
                        type="button"
                        onClick={resetToAuto}
                        className={`mb-2 flex w-full items-center gap-2 rounded-lg border p-2.5 text-left text-xs transition-all ${
                            config.isAutoMode
                                ? 'border-blue-300 bg-blue-50/60'
                                : 'border-neutral-200 hover:border-blue-200'
                        }`}
                    >
                        <span className="text-base">🔄</span>
                        <div>
                            <p className="font-medium text-neutral-800">{t('autoOption.title')}</p>
                            <p className="text-2xs text-neutral-500">
                                {t('autoOption.description')}
                            </p>
                        </div>
                    </button>

                    {/* Divider */}
                    <div className="my-2 flex items-center gap-2">
                        <div className="h-px flex-1 bg-neutral-200" />
                        <span className="text-2xs font-medium uppercase text-neutral-400">
                            {t('divider')}
                        </span>
                        <div className="h-px flex-1 bg-neutral-200" />
                    </div>

                    {/* Search */}
                    <input
                        type="text"
                        placeholder={t('search.placeholder')}
                        value={searchQuery}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="mb-2 w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-200"
                    />

                    {/* Invite list */}
                    {isLoading ? (
                        <div className="py-3">
                            <DashboardLoader />
                        </div>
                    ) : invites.length === 0 ? (
                        <p className="py-3 text-center text-xs text-neutral-400">
                            {t('list.empty')}
                        </p>
                    ) : (
                        <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                            {invites.map((inv) => {
                                const isSelected =
                                    !config.isAutoMode &&
                                    config.selectedInvite?.id === inv.id;
                                const dateRange = [
                                    inv.start_date
                                        ? new Date(inv.start_date).toLocaleDateString()
                                        : null,
                                    inv.end_date
                                        ? new Date(inv.end_date).toLocaleDateString()
                                        : null,
                                ]
                                    .filter(Boolean)
                                    .join(' → ');
                                return (
                                    <button
                                        key={inv.id}
                                        type="button"
                                        disabled={isLoadingDetail}
                                        onClick={() => selectSpecificInvite(inv)}
                                        className={`flex w-full items-center gap-2 rounded-lg border p-2.5 text-left text-xs transition-all ${
                                            isSelected
                                                ? 'border-purple-300 bg-purple-50/60'
                                                : 'border-neutral-200 hover:border-purple-200 hover:bg-purple-50/20'
                                        } ${isLoadingDetail ? 'cursor-wait opacity-50' : ''}`}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <p className="truncate font-medium text-neutral-800">
                                                    {inv.name}
                                                </p>
                                                {inv.tag && (
                                                    <span
                                                        className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-bold ${
                                                            inv.tag === 'DEFAULT'
                                                                ? 'bg-amber-100 text-amber-700'
                                                                : 'bg-slate-100 text-slate-600'
                                                        }`}
                                                    >
                                                        {inv.tag}
                                                    </span>
                                                )}
                                                <span
                                                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-medium ${
                                                        inv.status === 'ACTIVE'
                                                            ? 'bg-green-100 text-green-700'
                                                            : 'bg-neutral-100 text-neutral-500'
                                                    }`}
                                                >
                                                    {inv.status}
                                                </span>
                                            </div>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-neutral-500">
                                                <span>{t('codeLabel', { code: inv.invite_code })}</span>
                                                {dateRange && <span>· {dateRange}</span>}
                                                {inv.package_session_ids?.length > 1 && (
                                                    <span className="text-indigo-500">
                                                        ·{' '}
                                                        {t('list.bundled', {
                                                            count: inv.package_session_ids.length,
                                                        })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {isSelected && (
                                            <span className="shrink-0 text-purple-600">✓</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Resolved config summary (when a specific invite is selected) */}
            {!config.isAutoMode && config.selectedInvite && !expanded && (
                <div className="border-t border-neutral-100 bg-neutral-50/60 px-4 py-3">
                    {/* Invite details row */}
                    <div className="mb-2 grid grid-cols-1 gap-x-4 gap-y-2 text-2xs sm:grid-cols-2">
                        {/* Invite info */}
                        <div>
                            <span className="text-2xs font-semibold uppercase tracking-wide text-neutral-400">
                                {t('summary.invite.label')}
                            </span>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                <span className="font-medium text-neutral-800">
                                    {config.selectedInvite.name}
                                </span>
                                {config.selectedInvite.tag && (
                                    <span
                                        className={`rounded px-1.5 py-0.5 text-2xs font-bold ${
                                            config.selectedInvite.tag === 'DEFAULT'
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-slate-100 text-slate-600'
                                        }`}
                                    >
                                        {config.selectedInvite.tag}
                                    </span>
                                )}
                            </div>
                            <p className="mt-0.5 text-2xs text-neutral-500">
                                {t('codeLabel', { code: config.selectedInvite.invite_code })}
                                {config.selectedInvite.status && (
                                    <span
                                        className={`ms-1 inline-block rounded-full px-1.5 py-0.5 text-2xs font-medium ${
                                            config.selectedInvite.status === 'ACTIVE'
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-neutral-100 text-neutral-500'
                                        }`}
                                    >
                                        {config.selectedInvite.status}
                                    </span>
                                )}
                            </p>
                            {config.selectedInvite.is_bundled && (
                                <p className="mt-0.5 text-2xs text-indigo-500">
                                    📦 {t('summary.invite.bundled')}
                                </p>
                            )}
                        </div>

                        {/* Payment option info */}
                        <div>
                            <span className="text-2xs font-semibold uppercase tracking-wide text-neutral-400">
                                {t('summary.paymentOption.label')}
                            </span>
                            {config.resolvedPaymentOption ? (
                                <>
                                    <p className="mt-0.5 font-medium text-neutral-800">
                                        {config.resolvedPaymentOption.name}
                                    </p>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                        <span
                                            className={`rounded-full px-1.5 py-0.5 text-2xs font-bold ${
                                                config.resolvedPaymentOption.type === 'FREE'
                                                    ? 'bg-emerald-100 text-emerald-700'
                                                    : config.resolvedPaymentOption.type === 'CPO'
                                                      ? 'bg-amber-100 text-amber-800'
                                                      : 'bg-orange-100 text-orange-700'
                                            }`}
                                        >
                                            {config.resolvedPaymentOption.type}
                                        </span>
                                        {config.resolvedPaymentOption.require_approval && (
                                            <span className="rounded-full bg-yellow-100 px-1.5 py-0.5 text-2xs font-medium text-yellow-700">
                                                {t('summary.paymentOption.approvalRequired')}
                                            </span>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <p className="mt-0.5 text-2xs text-neutral-400">
                                    {t('summary.paymentOption.none')}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Plan details row */}
                    <div className="grid grid-cols-1 gap-x-4 gap-y-2 text-2xs sm:grid-cols-2">
                        <div>
                            <span className="text-2xs font-semibold uppercase tracking-wide text-neutral-400">
                                {t('summary.plan.label')}
                            </span>
                            {config.resolvedPaymentPlan ? (
                                <>
                                    <p className="mt-0.5 font-medium text-neutral-800">
                                        {config.resolvedPaymentPlan.name}
                                    </p>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-neutral-500">
                                        <span>
                                            {t('summary.plan.priceLabel')} ₹
                                            {formatPlanPrice(config.resolvedPaymentPlan.actual_price)}
                                            {config.resolvedPaymentPlan.elevated_price > config.resolvedPaymentPlan.actual_price && (
                                                <span className="ml-1 text-neutral-400 line-through">
                                                    ₹{formatPlanPrice(config.resolvedPaymentPlan.elevated_price)}
                                                </span>
                                            )}
                                        </span>
                                        {config.resolvedPaymentPlan.validity_in_days && (
                                            <span>
                                                ·{' '}
                                                {t('summary.plan.validity', {
                                                    count: config.resolvedPaymentPlan.validity_in_days,
                                                })}
                                            </span>
                                        )}
                                    </div>
                                </>
                            ) : (
                                /* No plan means this invite CANNOT enrol anyone — the backend
                                   rejects it at preview. Say so here, where the choice is made,
                                   instead of letting it fail two steps later. */
                                <p className="mt-0.5 text-2xs font-medium text-warning-600">
                                    {t('summary.plan.none')}
                                </p>
                            )}
                        </div>

                        <div>
                            <span className="text-2xs font-semibold uppercase tracking-wide text-neutral-400">
                                {t('summary.access.label')}
                            </span>
                            <p className="mt-0.5 text-neutral-700">
                                {config.selectedInvite.learner_access_days
                                    ? t('summary.access.days', {
                                          count: config.selectedInvite.learner_access_days,
                                      })
                                    : t('summary.access.unlimited')}
                            </p>
                            {config.selectedInvite.start_date && (
                                <p className="mt-0.5 text-2xs text-neutral-500">
                                    {t('summary.access.from', {
                                        date: new Date(config.selectedInvite.start_date).toLocaleDateString(i18n.language),
                                    })}
                                    {config.selectedInvite.end_date &&
                                        ` ${t('summary.access.to', {
                                            date: new Date(config.selectedInvite.end_date).toLocaleDateString(i18n.language),
                                        })}`}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Access days override */}
                    <div className="mt-3 flex items-center gap-2 border-t border-neutral-200 pt-2.5">
                        <label className="text-2xs font-medium text-neutral-500">
                            {t('summary.access.overrideLabel')}
                        </label>
                        <input
                            type="number"
                            min={1}
                            placeholder="—"
                            value={config.accessDaysOverride ?? ''}
                            onChange={(e) =>
                                onChange({
                                    ...config,
                                    accessDaysOverride: e.target.value
                                        ? parseInt(e.target.value, 10)
                                        : null,
                                })
                            }
                            className="w-20 rounded border border-neutral-200 px-2 py-1 text-2xs outline-none focus:border-primary-300"
                        />
                    </div>

                </div>
            )}

            {/* CPO per-learner config: per-installment date/amount/discount overrides,
                whole-CPO discount, optional offline payment. Renders whether the admin picked
                a specific invite or left Auto mode — effectiveCpoId comes from useResolvedInviteDetails
                which auto-falls-back to DEFAULT. */}
            {effectiveCpoId && (
                <div className="border-t border-neutral-100 px-4 pb-3">
                    <CpoEnrollmentConfigPanel
                        cpoId={effectiveCpoId}
                        value={config.cpoConfig}
                        onChange={(v) => onChange({ ...config, cpoConfig: v })}
                    />
                </div>
            )}
        </div>
    );
};
