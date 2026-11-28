// @ts-nocheck
import React, { useState, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
    CaretDown,
    ChalkboardTeacher,
    MagnifyingGlass,
    Plus,
    Receipt,
    Scales,
    Stack,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { QuickViews, StatStrip } from '@/components/shared/crm-enhance';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/finance-utils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useCPOFullDetails, useCreateCPO, useInstituteCPOList } from '../-services/cpo-service';
import type { CPOPackage, CPOFeeType } from '../-types/cpo-types';
import CreateCPODialog from './CreateCPODialog';
import { buildCreateCPOPayload } from './CreateCPODialog';

// Radix Select cannot hold an empty value, so "All classes" uses a sentinel.
const ALL_CLASSES = '__all__';
const ALL_STATUSES = 'ALL';

const planTotal = (pkg: CPOPackage) =>
    (pkg.fee_types ?? []).reduce((sum, ft) => sum + (ft.assigned_fee_value?.amount ?? 0), 0);

// ─── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const isActive = status === 'ACTIVE';
    return (
        <StatusChip
            text={status}
            textSize="text-caption"
            status={isActive ? 'SUCCESS' : 'WARNING'}
            showIcon={false}
        />
    );
}

function FeeTypeCard({
    feeType,
    index,
    isExpanded,
    onToggle,
    isLoadingInstallments = false,
}: {
    feeType: CPOFeeType;
    index: number;
    isExpanded: boolean;
    onToggle: () => void;
    isLoadingInstallments?: boolean;
}) {
    const { t } = useTranslation('financialManagementInstallmentPlansTab');
    const assigned_fee_value = feeType.assigned_fee_value ?? {
        amount: 0,
        no_of_installments: 0,
        has_installment: false,
        is_refundable: false,
        has_penalty: false,
        penalty_percentage: null,
        installments: [],
        status: 'ACTIVE',
    };
    const installments = assigned_fee_value.installments ?? [];
    const hasInstallments = assigned_fee_value.has_installment && installments.length > 0;

    return (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            {/* Fee Type Header */}
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={isExpanded}
                className="flex w-full cursor-pointer flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
            >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-600">
                    {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-semibold text-neutral-800">
                        {feeType.name}
                    </div>
                    <div className="mt-0.5 truncate text-caption text-neutral-500">
                        {feeType.code} · {feeType.description}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {assigned_fee_value.is_refundable && (
                        <span className="rounded-md border border-info-100 bg-info-50 px-2 py-0.5 text-caption font-medium text-info-600">
                            {t('feeType.refundable')}
                        </span>
                    )}
                    {assigned_fee_value.has_penalty && (
                        <span className="rounded-md border border-danger-100 bg-danger-50 px-2 py-0.5 text-caption font-medium text-danger-600">
                            {t('feeType.penalty', {
                                percent: assigned_fee_value.penalty_percentage,
                            })}
                        </span>
                    )}
                </div>
                <div className="text-right">
                    <div className="text-body font-bold tabular-nums text-neutral-800">
                        ₹{assigned_fee_value.amount.toLocaleString('en-IN')}
                    </div>
                    <div className="text-caption text-neutral-500">
                        {t('feeType.installmentCount', {
                            count: assigned_fee_value.no_of_installments,
                        })}
                    </div>
                </div>
                <CaretDown
                    size={16}
                    className={cn(
                        'shrink-0 text-neutral-400 transition-transform',
                        isExpanded && 'rotate-180'
                    )}
                />
            </button>

            {/* Installment Details */}
            {isExpanded && isLoadingInstallments && (
                <div className="border-t border-neutral-100 px-4 py-3 text-body text-neutral-500">
                    {t('feeType.loadingInstallments')}
                </div>
            )}

            {isExpanded && !isLoadingInstallments && hasInstallments && (
                <div className="overflow-x-auto border-t border-neutral-100 px-4 py-3">
                    <table className="w-full text-body">
                        <thead>
                            <tr className="border-b border-neutral-100">
                                <th className="p-2 text-left text-caption font-semibold uppercase text-neutral-500">
                                    {t('feeType.columns.number')}
                                </th>
                                <th className="p-2 text-right text-caption font-semibold uppercase text-neutral-500">
                                    {t('feeType.columns.amount')}
                                </th>
                                <th className="p-2 text-left text-caption font-semibold uppercase text-neutral-500">
                                    {t('feeType.columns.startDate')}
                                </th>
                                <th className="p-2 text-left text-caption font-semibold uppercase text-neutral-500">
                                    {t('feeType.columns.endDate')}
                                </th>
                                <th className="p-2 text-left text-caption font-semibold uppercase text-neutral-500">
                                    {t('feeType.columns.dueDate')}
                                </th>
                                <th className="p-2 text-left text-caption font-semibold uppercase text-neutral-500">
                                    {t('feeType.columns.status')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {installments.map((inst) => (
                                <tr key={inst.id} className="border-b border-neutral-50">
                                    <td className="p-2 font-medium text-neutral-500">
                                        {inst.installment_number}
                                    </td>
                                    <td className="p-2 text-right font-semibold tabular-nums text-neutral-800">
                                        ₹{inst.amount.toLocaleString('en-IN')}
                                    </td>
                                    <td className="p-2 text-neutral-600">
                                        {inst.start_date
                                            ? new Date(inst.start_date).toLocaleDateString(
                                                  'en-IN',
                                                  {
                                                      day: '2-digit',
                                                      month: 'short',
                                                      year: 'numeric',
                                                  }
                                              )
                                            : '-'}
                                    </td>
                                    <td className="p-2 text-neutral-600">
                                        {inst.end_date
                                            ? new Date(inst.end_date).toLocaleDateString('en-IN', {
                                                  day: '2-digit',
                                                  month: 'short',
                                                  year: 'numeric',
                                              })
                                            : '-'}
                                    </td>
                                    <td className="p-2 font-semibold text-neutral-700">
                                        {new Date(inst.due_date).toLocaleDateString('en-IN', {
                                            day: '2-digit',
                                            month: 'short',
                                            year: 'numeric',
                                        })}
                                    </td>
                                    <td className="px-2 py-2">
                                        <span
                                            className={cn(
                                                'rounded px-2 py-0.5 text-caption font-medium',
                                                inst.status === 'PAID'
                                                    ? 'bg-success-50 text-success-700'
                                                    : inst.status === 'PENDING'
                                                      ? 'bg-warning-50 text-warning-700'
                                                      : 'bg-neutral-50 text-neutral-600'
                                            )}
                                        >
                                            {inst.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-neutral-50">
                                <td className="p-2 font-bold text-neutral-700">
                                    {t('feeType.total')}
                                </td>
                                <td className="p-2 text-right font-bold tabular-nums text-neutral-800">
                                    ₹
                                    {installments
                                        .reduce((sum, i) => sum + i.amount, 0)
                                        .toLocaleString('en-IN')}
                                </td>
                                <td colSpan={4} />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {isExpanded && !isLoadingInstallments && !hasInstallments && (
                <div className="border-t border-neutral-100 px-4 py-3 text-body text-neutral-500">
                    {t('feeType.noSchedule', {
                        amount: `₹${assigned_fee_value.amount.toLocaleString('en-IN')}`,
                    })}
                </div>
            )}
        </div>
    );
}

function PackageCard({ pkg, allBatches = [] }: { pkg: CPOPackage; allBatches?: any[] }) {
    const { t } = useTranslation('financialManagementInstallmentPlansTab');
    const { t: tFlex } = useTranslation('financialManagementFlexibleSchedule');
    const [expandedFeeTypes, setExpandedFeeTypes] = useState<Set<string>>(new Set());
    const shouldFetchFullDetails = expandedFeeTypes.size > 0;

    const {
        data: fullCPO,
        isLoading: isLoadingFullCPO,
        isFetching: isFetchingFullCPO,
    } = useCPOFullDetails(pkg.id, shouldFetchFullDetails);

    const feeTypesForRender = fullCPO?.fee_types?.length ? fullCPO.fee_types : pkg.fee_types ?? [];

    const totalAmount = feeTypesForRender.reduce(
        (sum, ft) => sum + (ft.assigned_fee_value?.amount ?? 0),
        0
    );

    const toggleFeeType = (id: string) => {
        setExpandedFeeTypes((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const linkedClasses = (pkg.package_session_links ?? []).filter((link) => {
        const batch = allBatches.find((b) => b.id === link.package_session_id);
        return !batch || batch.is_parent === true || !batch.parent_id;
    });

    return (
        <Card className="overflow-hidden rounded-xl border-neutral-200 shadow-sm transition-shadow hover:shadow-md">
            {/* Package Header */}
            <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <Receipt size={18} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-subtitle font-bold text-neutral-900">{pkg.name}</h3>
                            <StatusBadge status={pkg.status} />
                            {pkg.schedule_mode === 'FLEXIBLE' && (
                                <span className="rounded-full bg-primary-50 px-2 py-0.5 text-caption font-medium text-primary-600">
                                    {tFlex('badge')}
                                </span>
                            )}
                        </div>
                        {/* Linked class badges */}
                        {linkedClasses.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {linkedClasses.map((link) => {
                                    const batch = allBatches.find(
                                        (b) => b.id === link.package_session_id
                                    );
                                    const label = batch
                                        ? `${batch.level.level_name}${batch.name ? ` – ${batch.name}` : ''}`
                                        : link.package_session_id.slice(0, 8);
                                    return (
                                        <span
                                            key={link.package_session_id}
                                            className="inline-flex items-center rounded-md border border-info-100 bg-info-50 px-2 py-0.5 text-caption font-medium text-info-700"
                                        >
                                            {label}
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-body text-neutral-500">
                        <Trans
                            i18nKey="package.totalLabel"
                            ns="financialManagementInstallmentPlansTab"
                            values={{ amount: `₹${totalAmount.toLocaleString('en-IN')}` }}
                            components={{
                                b: (
                                    <span className="text-subtitle font-bold tabular-nums text-neutral-900" />
                                ),
                            }}
                        />
                    </div>
                    <div className="mt-0.5 text-caption text-neutral-500">
                        {t('package.feeTypeCount', { count: feeTypesForRender.length })}
                    </div>
                </div>
            </div>

            {/* Fee Types List */}
            <div className="flex flex-col gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-4">
                <div className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                    <Stack size={14} />
                    {t('redesign.feeTypesHeading')}
                </div>
                {feeTypesForRender.map((ft, i) => (
                    <FeeTypeCard
                        key={ft.id}
                        feeType={ft}
                        index={i}
                        isExpanded={expandedFeeTypes.has(ft.id)}
                        onToggle={() => toggleFeeType(ft.id)}
                        isLoadingInstallments={
                            expandedFeeTypes.has(ft.id) && (isLoadingFullCPO || isFetchingFullCPO)
                        }
                    />
                ))}
            </div>
        </Card>
    );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function InstallmentPlansTab() {
    const { t } = useTranslation('financialManagementInstallmentPlansTab');
    const terms = instituteTerms();
    const [selectedSessionId, setSelectedSessionId] = useState<string>('');
    const [selectedPackageSessionId, setSelectedPackageSessionId] = useState<string | null>(null);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    // View-only refinements of the already-loaded list (no request).
    const [statusView, setStatusView] = useState<string>(ALL_STATUSES);
    const [search, setSearch] = useState('');

    // Get batches (classes) from institute store
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    const batches = useMemo(() => {
        return instituteDetails?.batches_for_sessions ?? [];
    }, [instituteDetails]);

    // Derive unique sessions from batches
    const sessions = useMemo(() => {
        const map = new Map<string, { id: string; name: string }>();
        batches.forEach((b) => {
            if (!map.has(b.session.id)) {
                map.set(b.session.id, { id: b.session.id, name: b.session.session_name });
            }
        });
        return Array.from(map.values());
    }, [batches]);

    // Default to first session
    React.useEffect(() => {
        if (!selectedSessionId && sessions.length > 0) {
            setSelectedSessionId(sessions[0].id);
        }
    }, [sessions, selectedSessionId]);

    // Build dropdown options from batches (parent/standalone only, filtered by session)
    const batchOptions = useMemo(() => {
        return batches
            .filter((batch) => batch.is_parent === true || !batch.parent_id)
            .filter((batch) => !selectedSessionId || batch.session.id === selectedSessionId)
            .map((batch) => ({
                id: batch.id,
                label: `${batch.package_dto.package_name} – ${batch.level.level_name}${batch.name ? ` – ${batch.name}` : ''}`,
            }));
    }, [batches, selectedSessionId]);

    // Reset package session filter when session changes
    React.useEffect(() => {
        setSelectedPackageSessionId(null);
    }, [selectedSessionId]);

    // Fetch ALL CPOs for the institute (paginated)
    const { data: cpoListResponse, isLoading, isError, error } = useInstituteCPOList(0, 500);

    // Filter by selected session via package_session_links
    const cpoPackages: CPOPackage[] = useMemo(() => {
        const all = (cpoListResponse?.content ?? []).map((pkg) => ({
            ...pkg,
            fee_types: (pkg.fee_types ?? []).map((ft) => ({
                ...ft,
                assigned_fee_value: {
                    ...(ft.assigned_fee_value ?? {}),
                    installments: ft.assigned_fee_value?.installments ?? [],
                },
            })),
            package_session_links: pkg.package_session_links ?? [],
        }));
        if (!selectedPackageSessionId) return all;
        return all.filter((pkg) =>
            pkg.package_session_links?.some(
                (link) => link.package_session_id === selectedPackageSessionId
            )
        );
    }, [cpoListResponse, selectedPackageSessionId]);

    // Cheap numbers for the summary, from the list already on screen.
    const stats = useMemo(() => {
        const active = cpoPackages.filter((p) => p.status === 'ACTIVE').length;
        const totals = cpoPackages.map(planTotal).filter((v) => v > 0);
        const feeTypeNames = new Set<string>();
        const classIds = new Set<string>();
        let unlinked = 0;
        cpoPackages.forEach((p) => {
            (p.fee_types ?? []).forEach((ft) => feeTypeNames.add(ft.name));
            const links = p.package_session_links ?? [];
            if (links.length === 0) unlinked += 1;
            links.forEach((l) => classIds.add(l.package_session_id));
        });
        const statuses = Array.from(new Set(cpoPackages.map((p) => p.status).filter(Boolean)));
        return {
            active,
            avg: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null,
            priced: totals.length,
            feeTypes: feeTypeNames.size,
            classes: classIds.size,
            unlinked,
            statuses,
        };
    }, [cpoPackages]);

    const visiblePackages = useMemo(() => {
        const q = search.trim().toLowerCase();
        return cpoPackages.filter((pkg) => {
            if (statusView !== ALL_STATUSES && pkg.status !== statusView) return false;
            if (!q) return true;
            return [pkg.name, ...(pkg.fee_types ?? []).map((ft) => ft.name)]
                .filter(Boolean)
                .some((v) => v.toLowerCase().includes(q));
        });
    }, [cpoPackages, statusView, search]);

    // Create CPO mutation
    const createCPOMutation = useCreateCPO();

    const handleCreateSave = (formData: Parameters<typeof buildCreateCPOPayload>[0]) => {
        const payload = buildCreateCPOPayload(formData, batches);
        createCPOMutation.mutate(payload, {
            onSuccess: () => {
                setShowCreateDialog(false);
            },
        });
    };

    const hasPlans = !isLoading && !isError && cpoPackages.length > 0;

    return (
        <div className="flex flex-col gap-5 duration-300 animate-in fade-in">
            {/* ─── Page Header ─────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <Receipt size={20} weight="duotone" />
                    </span>
                    <div>
                        <h1 className="text-h3 font-semibold text-neutral-900">
                            {t('header.title')}
                        </h1>
                        <p className="mt-0.5 text-body text-neutral-500">{t('header.subtitle')}</p>
                    </div>
                </div>

                {/* Create Package button */}
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={() => setShowCreateDialog(true)}
                >
                    <Plus className="mr-1 size-4" />
                    {t('actions.createPlan')}
                </MyButton>
            </div>

            {/* ─── Summary ─────────────────────────────────────────────────────── */}
            {(isLoading || hasPlans) && (
                <StatStrip
                    items={[
                        {
                            key: 'plans',
                            icon: Receipt,
                            label: t('redesign.stats.plans'),
                            value: cpoPackages.length,
                            detail: t('redesign.stats.plansDetail', { count: stats.active }),
                            loading: isLoading,
                        },
                        {
                            key: 'avg',
                            icon: Scales,
                            tint: 'success',
                            label: t('redesign.stats.avg'),
                            value: stats.avg === null ? '—' : formatCurrency(Math.round(stats.avg)),
                            detail: t('redesign.stats.avgDetail', { count: stats.priced }),
                            loading: isLoading,
                        },
                        {
                            key: 'feeTypes',
                            icon: Stack,
                            tint: 'info',
                            label: t('redesign.stats.feeTypes'),
                            value: stats.feeTypes,
                            detail: t('redesign.stats.feeTypesDetail'),
                            loading: isLoading,
                        },
                        {
                            key: 'classes',
                            icon: stats.unlinked > 0 ? WarningCircle : ChalkboardTeacher,
                            tint: stats.unlinked > 0 ? 'warning' : 'primary',
                            label: t('redesign.stats.classes', { batches: terms.batches }),
                            value: stats.classes,
                            detail:
                                stats.unlinked > 0
                                    ? t('redesign.stats.unlinked', {
                                          count: stats.unlinked,
                                          batch: terms.batch,
                                      })
                                    : t('redesign.stats.classesDetail'),
                            loading: isLoading,
                        },
                    ]}
                />
            )}

            {hasPlans && stats.statuses.length > 1 && (
                <QuickViews
                    views={[
                        {
                            key: ALL_STATUSES,
                            label: t('redesign.views.all'),
                            count: cpoPackages.length,
                            active: statusView === ALL_STATUSES,
                            onSelect: () => setStatusView(ALL_STATUSES),
                        },
                        ...stats.statuses.map((s) => ({
                            key: s,
                            label: s,
                            count: cpoPackages.filter((p) => p.status === s).length,
                            tone: s === 'ACTIVE' ? ('success' as const) : ('warning' as const),
                            active: statusView === s,
                            onSelect: () => setStatusView(s),
                        })),
                    ]}
                />
            )}

            {/* ─── Toolbar: search + session + class ───────────────────────────── */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full sm:w-72">
                    <MagnifyingGlass className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                    <Input
                        value={search}
                        placeholder={t('redesign.searchPlaceholder')}
                        className="bg-white pl-9"
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                {/* Session selector */}
                <Select value={selectedSessionId} onValueChange={(v) => setSelectedSessionId(v)}>
                    <SelectTrigger
                        className="w-full bg-white sm:w-48"
                        aria-label={t('redesign.sessionAria')}
                    >
                        <SelectValue placeholder={t('redesign.sessionAria')} />
                    </SelectTrigger>
                    <SelectContent>
                        {sessions.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                                {s.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/* Class selector */}
                <Select
                    value={selectedPackageSessionId ?? ALL_CLASSES}
                    onValueChange={(v) => setSelectedPackageSessionId(v === ALL_CLASSES ? null : v)}
                >
                    <SelectTrigger
                        className="w-full bg-white sm:w-64"
                        aria-label={t('filters.allClasses')}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL_CLASSES}>{t('filters.allClasses')}</SelectItem>
                        {batchOptions.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {hasPlans && (
                    <span className="text-caption text-neutral-500 sm:ml-auto">
                        {t('summary.packageCount', { count: visiblePackages.length })}
                    </span>
                )}
            </div>

            {/* ─── Loading ──────────────────────────────────────────────────────── */}
            {isLoading && (
                <div className="flex flex-col gap-4" aria-label={t('loading')}>
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-32 w-full rounded-xl" />
                    ))}
                </div>
            )}

            {/* ─── Error ────────────────────────────────────────────────────────── */}
            {isError && (
                <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4 text-body text-danger-700">
                    <WarningCircle size={18} className="mt-0.5 shrink-0" />
                    <span>
                        {t('error.prefix')}{' '}
                        {error instanceof Error ? error.message : t('error.genericMessage')}
                    </span>
                </div>
            )}

            {/* ─── Empty state ──────────────────────────────────────────────────── */}
            {!isLoading && !isError && cpoPackages.length === 0 && (
                <Card className="flex flex-col items-center gap-2 rounded-xl border-dashed border-neutral-300 px-6 py-14 text-center">
                    <Receipt size={40} weight="duotone" className="text-neutral-300" />
                    <p className="text-subtitle font-medium text-neutral-600">{t('empty.title')}</p>
                    <p className="text-body text-neutral-500">
                        <Trans
                            i18nKey="empty.hint"
                            ns="financialManagementInstallmentPlansTab"
                            values={{ createPlan: t('actions.createPlan') }}
                            components={{ b: <strong /> }}
                        />
                    </p>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        className="mt-2"
                        onClick={() => setShowCreateDialog(true)}
                    >
                        <Plus className="mr-1 size-4" />
                        {t('actions.createPlan')}
                    </MyButton>
                </Card>
            )}

            {/* Search / status left nothing on screen. */}
            {hasPlans && visiblePackages.length === 0 && (
                <Card className="rounded-xl p-8 text-center text-body text-neutral-500">
                    {t('redesign.noMatch')}
                </Card>
            )}

            {/* ─── Package cards ─────────────────────────────────────────────────── */}
            {visiblePackages.length > 0 && (
                <div className="flex flex-col gap-4">
                    {visiblePackages.map((pkg) => (
                        <PackageCard key={pkg.id} pkg={pkg} allBatches={batches} />
                    ))}
                </div>
            )}

            {/* ─── Create CPO Dialog ─────────────────────────────────────────────── */}
            {showCreateDialog && (
                <CreateCPODialog
                    batchOptions={batchOptions}
                    defaultPackageSessionId={selectedPackageSessionId ?? undefined}
                    isSaving={createCPOMutation.isPending}
                    onSave={handleCreateSave}
                    onClose={() => setShowCreateDialog(false)}
                />
            )}
        </div>
    );
}
