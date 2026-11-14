import {
    Dialog as ShadDialog,
    DialogContent as ShadDialogContent,
    DialogHeader as ShadDialogHeader,
    DialogTitle as ShadDialogTitle,
    DialogDescription as ShadDialogDescription,
} from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Calendar,
    Clock,
    CreditCard,
    CurrencyDollar,
    Globe,
    MagnifyingGlass,
    Receipt,
    X,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { MyButton } from '@/components/design-system/button';
import { ChipToggleGroup, type ChipToggleOption } from '@/components/design-system/chips';
import { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { InviteLinkFormValues } from './GenerateInviteLinkSchema';
import { useSuspenseQuery } from '@tanstack/react-query';
import { handleGetPaymentDetails } from './-services/get-payments';
import { useEffect, useMemo, useState } from 'react';
import {
    filterPlans,
    getDefaultPlanFromPaymentsData,
    normalizePlanType,
    PLAN_TYPE_FILTERS,
    sortPlansNewestFirst,
    splitPlansByType,
    type PlanProvenance,
    type PlanTypeFilter,
} from './-utils/helper';
import { useCPOFullDetails } from '@/routes/financial-management/fee-plans/-services/cpo-service';
import type { CPOFeeType } from '@/routes/financial-management/fee-plans/-types/cpo-types';
import { formatPlanPrice } from '@/utils/finance-utils';
import { getCurrencySymbol } from '@/constants/currencies';

interface PaymentPlansDialogProps {
    form: UseFormReturn<InviteLinkFormValues>;
    /**
     * Keep a plan the admin has already chosen when the option list refetches.
     *
     * Without this, the seeding effect below resets `selectedPlan` to the institute
     * DEFAULT every time `GET_PAYMENT_DETAILS` changes identity — and AddPaymentPlanDialog
     * invalidates that key right after saving a new plan, so the admin's fresh choice is
     * wiped. GenerateInviteLinkDialog omits the prop and keeps its existing behaviour,
     * where its own prefill effect runs afterwards and re-applies the selection anyway.
     */
    preserveSelection?: boolean;
}

// Re-exported from the canonical currency source (kept here for existing import paths).
export { getCurrencySymbol };

export const getPaymentPlanIcon = (type: string) => {
    switch (type) {
        case 'subscription':
            return <Calendar className="size-5" />;
        case 'upfront':
            return <CurrencyDollar className="size-5" />;
        case 'free':
            return <Globe className="size-5" />;
        case 'cpo':
            return <Receipt className="size-5" />;
        default:
            return <CreditCard className="size-5" />;
    }
};

const countCpoInstallments = (feeTypes: CPOFeeType[] | undefined): number => {
    if (!Array.isArray(feeTypes)) return 0;
    let count = 0;
    for (const ft of feeTypes) {
        const afv = ft.assigned_fee_value;
        if (!afv) continue;
        const installments = afv.installments ?? [];
        // Single-bill CPO (no installments configured) → counts as one row.
        count += installments.length === 0 ? 1 : installments.length;
    }
    return count;
};

/**
 * "Created 11 Sep 2026 · by Neeraj" under every plan card. Renders nothing when
 * neither is known (rows that predate the created_by column) — a placeholder
 * note there just adds noise to a list the admin is scanning by name. The
 * creator falls back to the raw user id when auth_service could not resolve it.
 */
const PlanProvenanceLine = ({ plan }: { plan: PlanProvenance }) => {
    const { t, i18n } = useTranslation('manageStudentsPaymentPlansDialog');
    const parsed = plan.createdAt ? new Date(plan.createdAt) : null;
    const createdAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    const creator = plan.createdByName || plan.createdByUserId || null;
    if (!createdAt && !creator) return null;
    return (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-8 text-2xs text-neutral-500">
            <Clock className="size-3 shrink-0" />
            {createdAt && (
                <span>
                    {t('meta.created', {
                        date: createdAt.toLocaleDateString(i18n.language, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                        }),
                    })}
                </span>
            )}
            {creator && (
                <span className="truncate" title={plan.createdByUserId ?? undefined}>
                    {createdAt ? '· ' : ''}
                    {t('meta.createdBy', { name: creator })}
                </span>
            )}
        </div>
    );
};

interface CpoPlanCardProps {
    plan: PlanProvenance & {
        id: string;
        name: string;
        price?: string;
        currency?: string;
        cpoId?: string;
    };
    isSelected: boolean;
    onSelect: () => void;
}

const CpoPlanCard = ({ plan, isSelected, onSelect }: CpoPlanCardProps) => {
    const { t } = useTranslation('manageStudentsPaymentPlansDialog');
    const { data, isLoading } = useCPOFullDetails(plan.cpoId ?? null, !!plan.cpoId);
    const installmentCount = useMemo(() => countCpoInstallments(data?.fee_types), [data]);
    const currencySymbol = getCurrencySymbol(plan.currency || 'INR');

    return (
        <Card
            className={`cursor-pointer border-2 ${
                isSelected ? 'border-primary' : 'border-gray-200'
            } transition-all`}
            onClick={onSelect}
        >
            <div className="flex flex-col items-start gap-3 p-4">
                <div className="flex w-full items-center gap-3">
                    {getPaymentPlanIcon('cpo')}
                    <div className="flex flex-1 flex-col">
                        <span className="font-semibold">{plan.name}</span>
                    </div>
                    <Badge
                        variant="secondary"
                        className="bg-amber-100 text-2xs font-semibold text-amber-800"
                    >
                        {t('badge.cpo')}
                    </Badge>
                    {isSelected && (
                        <Badge variant="default" className="ml-auto">
                            {t('badge.default')}
                        </Badge>
                    )}
                </div>
                <div className="flex flex-col gap-1 pl-8 text-xs text-neutral-600">
                    <span>
                        {t('cpo.totalAmount', {
                            amount: `${currencySymbol}${formatPlanPrice(plan.price) || '—'}`,
                        })}
                    </span>
                    <span>
                        {t('cpo.installmentsLabel')}:{' '}
                        {isLoading ? (
                            <span className="text-neutral-400">
                                {t('cpo.installmentsLoading')}
                            </span>
                        ) : installmentCount > 0 ? (
                            installmentCount
                        ) : (
                            '—'
                        )}
                    </span>
                    <span>{t('common.currency', { currency: plan.currency || 'INR' })}</span>
                </div>
                <PlanProvenanceLine plan={plan} />
            </div>
        </Card>
    );
};

export function PaymentPlansDialog({ form, preserveSelection = false }: PaymentPlansDialogProps) {
    const { t } = useTranslation('manageStudentsPaymentPlansDialog');
    const { data: paymentsData } = useSuspenseQuery(handleGetPaymentDetails());
    const isOpen = form.watch('showPlansDialog');
    const [query, setQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<PlanTypeFilter | null>(null);

    useEffect(() => {
        const currentSelection = form.getValues('selectedPlan');
        form.reset({
            ...form.getValues(),
            freePlans: splitPlansByType(paymentsData).freePlans,
            paidPlans: splitPlansByType(paymentsData).paidPlans,
            selectedPlan:
                preserveSelection && currentSelection?.id
                    ? currentSelection
                    : getDefaultPlanFromPaymentsData(paymentsData),
        });
    }, [paymentsData]);

    // A reopened picker starts clean — a filter left over from the last visit
    // would make the list look mysteriously short.
    useEffect(() => {
        if (!isOpen) {
            setQuery('');
            setTypeFilter(null);
        }
    }, [isOpen]);

    // watch(), not getValues(): AddPaymentPlanDialog appends the new plan to these
    // arrays, and the list has to re-render for it to show up without a refetch.
    const watchedFreePlans = form.watch('freePlans');
    const watchedPaidPlans = form.watch('paidPlans');
    const allFreePlans = useMemo(() => watchedFreePlans ?? [], [watchedFreePlans]);
    const allPaidPlans = useMemo(() => watchedPaidPlans ?? [], [watchedPaidPlans]);

    const freePlans = useMemo(
        () => filterPlans(sortPlansNewestFirst(allFreePlans), query, typeFilter),
        [allFreePlans, query, typeFilter]
    );
    const paidPlans = useMemo(
        () => filterPlans(sortPlansNewestFirst(allPaidPlans), query, typeFilter),
        [allPaidPlans, query, typeFilter]
    );
    const countsByType = useMemo(() => {
        const counts: Record<PlanTypeFilter, number> = {
            FREE: 0,
            ONE_TIME: 0,
            DONATION: 0,
            SUBSCRIPTION: 0,
            CPO: 0,
        };
        for (const plan of [...allFreePlans, ...allPaidPlans]) {
            const key = normalizePlanType(plan.type);
            if (key) counts[key] += 1;
        }
        return counts;
    }, [allFreePlans, allPaidPlans]);
    const totalPlans = allFreePlans.length + allPaidPlans.length;
    const isFiltering = query.trim().length > 0 || typeFilter !== null;
    const nothingMatches = isFiltering && freePlans.length === 0 && paidPlans.length === 0;

    // 'ALL' is the group's "no filter" value; the count rides in the label so an
    // admin can see at a glance how many plans each pill hides.
    const typeOptions: ChipToggleOption<'ALL' | PlanTypeFilter>[] = [
        { value: 'ALL', label: `${t('filters.all')} · ${totalPlans}` },
        ...PLAN_TYPE_FILTERS.map((type) => ({
            value: type,
            label: `${t(`filters.${type}`)} · ${countsByType[type]}`,
        })),
    ];

    return (
        <ShadDialog
            open={form.watch('showPlansDialog')}
            onOpenChange={(open) => form.setValue('showPlansDialog', open)}
        >
            <ShadDialogContent className="flex max-h-dialog-tall w-dialog-md flex-col overflow-auto">
                <ShadDialogHeader>
                    <ShadDialogTitle className="font-bold">{t('dialog.title')}</ShadDialogTitle>
                    <ShadDialogDescription className="mt-1">
                        {t('dialog.description')}
                    </ShadDialogDescription>
                </ShadDialogHeader>
                <div className="flex flex-col gap-2">
                    <div className="relative">
                        <MagnifyingGlass
                            size={15}
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                        />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('search.placeholder')}
                            aria-label={t('search.placeholder')}
                            className="h-9 w-full pl-9 pr-8 text-sm"
                        />
                        {query && (
                            <button
                                type="button"
                                aria-label={t('search.clear')}
                                onClick={() => setQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <ChipToggleGroup
                        value={typeFilter ?? 'ALL'}
                        onChange={(value) => setTypeFilter(value === 'ALL' ? null : value)}
                        options={typeOptions}
                        ariaLabel={t('filters.all')}
                    />
                </div>
                <div className="flex-1 overflow-auto">
                    {nothingMatches && (
                        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-neutral-500">
                            <span>{t('search.noResults')}</span>
                            <MyButton
                                type="button"
                                scale="small"
                                buttonType="text"
                                onClick={() => {
                                    setQuery('');
                                    setTypeFilter(null);
                                }}
                            >
                                {t('search.clear')}
                            </MyButton>
                        </div>
                    )}
                    {freePlans.length > 0 && (
                    <div className="mb-4">
                        <div className="my-2 font-semibold">{t('sections.freePlans')}</div>
                        <div className="flex flex-col gap-4">
                            {freePlans.map((plan) => (
                                <Card
                                    key={plan.id}
                                    className={`cursor-pointer border-2 ${form.watch('selectedPlan')?.id === plan.id ? 'border-primary' : 'border-gray-200'} transition-all`}
                                    onClick={() => {
                                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                                        // @ts-expect-error
                                        form.setValue('selectedPlan', plan);
                                        form.setValue('showPlansDialog', false);
                                    }}
                                >
                                    <div className="flex flex-col items-start gap-3 p-4">
                                        <div className="flex items-center gap-3">
                                            {getPaymentPlanIcon(plan.type?.toLowerCase() || '')}
                                            <div className="flex flex-1 flex-col font-semibold">
                                                <span>{plan.name}</span>
                                            </div>
                                            {form.watch('selectedPlan')?.id === plan.id && (
                                                <Badge variant="default" className="ml-auto">
                                                    {t('badge.default')}
                                                </Badge>
                                            )}
                                        </div>
                                        {plan.type?.toLowerCase() === 'donation' ? (
                                            <div className="flex flex-col gap-2 pl-8 text-xs text-neutral-600">
                                                <span>
                                                    {t('donation.suggestedAmounts', {
                                                        amount: `${getCurrencySymbol(plan.currency || '')}${plan.suggestedAmount?.join(',')}`,
                                                    })}
                                                </span>
                                                <span>
                                                    {t('donation.minimumAmount', {
                                                        amount: `${getCurrencySymbol(plan.currency || '')}${plan.minAmount}`,
                                                    })}
                                                </span>
                                                <span>
                                                    {t('common.currency', {
                                                        currency: plan.currency || '',
                                                    })}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col gap-2 pl-8 text-xs text-neutral-600">
                                                <span>
                                                    {t('freePlan.days', { count: plan.days })}
                                                </span>
                                            </div>
                                        )}
                                        <PlanProvenanceLine plan={plan} />
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </div>
                    )}
                    {paidPlans.length > 0 && (
                    <div>
                        <div className="mb-2 font-semibold">{t('sections.paidPlans')}</div>
                        <div className="flex flex-col gap-4">
                            {paidPlans.map((plan) => {
                                if (plan.type?.toLowerCase() === 'cpo') {
                                    return (
                                        <CpoPlanCard
                                            key={plan.id}
                                            plan={plan}
                                            isSelected={form.watch('selectedPlan')?.id === plan.id}
                                            onSelect={() => {
                                                form.setValue('selectedPlan', plan);
                                                form.setValue('showPlansDialog', false);
                                            }}
                                        />
                                    );
                                }
                                return (
                                <Card
                                    key={plan.id}
                                    className={`cursor-pointer border-2 ${form.watch('selectedPlan')?.id === plan.id ? 'border-primary' : 'border-gray-200'} transition-all`}
                                    onClick={() => {
                                        form.setValue('selectedPlan', plan);
                                        form.setValue('showPlansDialog', false);
                                    }}
                                >
                                    <div className="flex flex-col items-start gap-3 p-4">
                                        <div className="flex items-center gap-3">
                                            {getPaymentPlanIcon(plan.type?.toLowerCase() || '')}
                                            <div className="flex flex-1 flex-col">
                                                <span>{plan.name}</span>
                                            </div>
                                            {form.watch('selectedPlan')?.id === plan.id && (
                                                <Badge variant="default" className="ml-auto">
                                                    {t('badge.default')}
                                                </Badge>
                                            )}
                                        </div>
                                        {plan.type?.toLowerCase() === 'upfront' ||
                                        plan.type?.toLowerCase() === 'one_time' ? (
                                            <div className="flex flex-col gap-2 pl-8 text-xs text-neutral-600">
                                                <span>
                                                    {t('upfront.fullPrice', {
                                                        amount: `${getCurrencySymbol(plan.currency || '')}${formatPlanPrice(plan.price)}`,
                                                    })}
                                                </span>
                                                <span>
                                                    {t('common.currency', {
                                                        currency: plan.currency || '',
                                                    })}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col gap-2 pl-8 text-xs text-neutral-600">
                                                {plan.paymentOption?.map((payment, idx) => {
                                                    return (
                                                        <div key={idx} className="flex">
                                                            <span>
                                                                {payment.title}:{' '}
                                                                {getCurrencySymbol(
                                                                    plan.currency || ''
                                                                )}
                                                                {formatPlanPrice(payment.price)}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                                <span>
                                                    {t('common.currency', {
                                                        currency: plan.currency || '',
                                                    })}
                                                </span>
                                            </div>
                                        )}
                                        <PlanProvenanceLine plan={plan} />
                                    </div>
                                </Card>
                                );
                            })}
                        </div>
                    </div>
                    )}
                </div>
                <div className="-mb-2 flex justify-center border-t bg-white pt-4">
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        onClick={() => form.setValue('showAddPlanDialog', true)}
                        className="p-4"
                    >
                        {t('actions.addNewPaymentPlan')}
                    </MyButton>
                </div>
            </ShadDialogContent>
        </ShadDialog>
    );
}
