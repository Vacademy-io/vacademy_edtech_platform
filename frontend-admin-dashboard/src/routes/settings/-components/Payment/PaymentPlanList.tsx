import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CreditCard, Calendar, CurrencyDollar, PencilSimple, Trash, Globe, Eye, Stack, CaretDown, CircleNotch } from '@phosphor-icons/react';
import { PaymentPlan, PaymentPlans } from '@/types/payment';
import { getCurrencySymbol } from './utils/utils';
import { useCPOFullDetails } from '@/routes/financial-management/fee-plans/-services/cpo-service';
import type { CPOPackage } from '@/routes/financial-management/fee-plans/-types/cpo-types';

const getTypeIcon = (type: string) => {
    switch (type) {
        case 'subscription':
        case 'SUBSCRIPTION':
            return <Calendar className="size-5" />;
        case 'upfront':
        case 'ONE_TIME':
            return <CurrencyDollar className="size-5" />;
        case 'free':
        case 'FREE':
            return <Globe className="size-5" />;
        case 'CPO':
            return <Stack className="size-5 text-purple-600" />;
        default:
            return <CreditCard className="size-5" />;
    }
};

const getPlanPriceDetails = (plan: PaymentPlan) => {
    const symbol = getCurrencySymbol(plan.currency);
    const details = [];

    // Handle case where config is undefined
    if (!plan.config) {
        details.push(i18next.t('settingsPaymentPlanList:priceDetails.noConfig'));
        return details;
    }

    switch (plan.type) {
        case PaymentPlans.SUBSCRIPTION: {
            if (plan.config?.subscription?.customIntervals?.length > 0) {
                plan.config.subscription.customIntervals.forEach(
                    (
                        interval: {
                            price: string;
                            originalPrice?: string;
                            title?: string;
                            value: number;
                            unit: string;
                        },
                        idx: number
                    ) => {
                        const originalPrice =
                            interval.originalPrice !== undefined
                                ? parseFloat(interval.originalPrice)
                                : parseFloat(interval.price || '0');
                        let discountedPrice = parseFloat(interval.price || '0');
                        const discount = plan.config?.planDiscounts?.[`interval_${idx}`];

                        if (discount && discount.type !== 'none' && discount.amount) {
                            let discountText = '';

                            if (discount.type === 'percentage') {
                                discountedPrice =
                                    originalPrice * (1 - parseFloat(discount.amount) / 100);
                                discountText = i18next.t('settingsPaymentPlanList:priceDetails.percentOff', {
                                    amount: discount.amount,
                                });
                            } else if (discount.type === 'fixed') {
                                discountedPrice = Math.max(
                                    0,
                                    originalPrice - parseFloat(discount.amount)
                                );
                                discountText = i18next.t('settingsPaymentPlanList:priceDetails.amountOff', {
                                    symbol,
                                    amount: discount.amount,
                                });
                            }

                            const intervalTitle =
                                interval.title || `${interval.value} ${interval.unit}`;
                            details.push(
                                <div key={idx} className="flex items-center gap-2">
                                    <span className="text-sm text-gray-600">{intervalTitle}:</span>
                                    <span className="text-sm font-medium text-gray-400 line-through">
                                        {symbol}
                                        {originalPrice.toFixed(2)}
                                    </span>
                                    <span className="text-sm font-bold text-green-600">
                                        {symbol}
                                        {discountedPrice.toFixed(2)}
                                    </span>
                                    <Badge
                                        variant="outline"
                                        className="border-green-200 text-xs text-green-600"
                                    >
                                        {discountText}
                                    </Badge>
                                </div>
                            );
                        } else {
                            const intervalTitle =
                                interval.title || `${interval.value} ${interval.unit}`;
                            details.push(
                                <div key={idx} className="text-sm text-gray-600">
                                    {intervalTitle}: {symbol}
                                    {originalPrice.toFixed(2)}
                                </div>
                            );
                        }
                    }
                );
            }
            break;
        }

        case PaymentPlans.UPFRONT: {
            const originalPrice = parseFloat(plan.config?.upfront?.fullPrice || '0');
            const upfrontDiscount = plan.config?.planDiscounts?.upfront;

            if (upfrontDiscount && upfrontDiscount.type !== 'none' && upfrontDiscount.amount) {
                let discountedPrice = originalPrice;
                let discountText = '';

                if (upfrontDiscount.type === 'percentage') {
                    discountedPrice =
                        originalPrice * (1 - parseFloat(upfrontDiscount.amount) / 100);
                    discountText = i18next.t('settingsPaymentPlanList:priceDetails.percentOff', {
                        amount: upfrontDiscount.amount,
                    });
                } else if (upfrontDiscount.type === 'fixed') {
                    discountedPrice = Math.max(
                        0,
                        originalPrice - parseFloat(upfrontDiscount.amount)
                    );
                    discountText = i18next.t('settingsPaymentPlanList:priceDetails.amountOff', {
                        symbol,
                        amount: upfrontDiscount.amount,
                    });
                }

                details.push(
                    <div key="upfront-discounted" className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">
                            {i18next.t('settingsPaymentPlanList:priceDetails.fullPriceLabel')}
                        </span>
                        <span className="text-sm font-medium text-gray-400 line-through">
                            {symbol}
                            {originalPrice.toFixed(2)}
                        </span>
                        <span className="text-sm font-bold text-green-600">
                            {symbol}
                            {discountedPrice.toFixed(2)}
                        </span>
                        <Badge
                            variant="outline"
                            className="border-green-200 text-xs text-green-600"
                        >
                            {discountText}
                        </Badge>
                    </div>
                );
            } else {
                details.push(
                    i18next.t('settingsPaymentPlanList:priceDetails.fullPriceValue', {
                        symbol,
                        price: originalPrice.toFixed(2),
                    })
                );
            }
            break;
        }

        case PaymentPlans.DONATION: {
            if (plan.config?.donation?.suggestedAmounts) {
                details.push(
                    i18next.t('settingsPaymentPlanList:priceDetails.suggestedAmounts', {
                        symbol,
                        amount: plan.config.donation.suggestedAmounts,
                    })
                );
            }
            if (plan.config?.donation?.minimumAmount) {
                details.push(
                    i18next.t('settingsPaymentPlanList:priceDetails.minimumAmount', {
                        symbol,
                        amount: plan.config.donation.minimumAmount,
                    })
                );
            }
            break;
        }

        case PaymentPlans.CPO: {
            // Summary shown beneath the name before the accordion is opened.
            // Full detail (fee types + installments) is loaded on-demand via CPOExpandedDetails.
            const cpoForm = plan.config?.cpoForm;
            if (cpoForm?.feeTypes?.length) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const total = cpoForm.feeTypes.reduce((s: number, ft: any) => s + (parseFloat(ft.amount ?? '0') || 0), 0);
                details.push(
                    i18next.t('settingsPaymentPlanList:priceDetails.feeTypeCount', {
                        count: cpoForm.feeTypes.length,
                    })
                );
                if (total > 0)
                    details.push(
                        i18next.t('settingsPaymentPlanList:priceDetails.total', {
                            total: total.toLocaleString('en-IN'),
                        })
                    );
                if (cpoForm.packageSessionIds?.length > 0) {
                    details.push(
                        i18next.t('settingsPaymentPlanList:priceDetails.batchLinked', {
                            count: cpoForm.packageSessionIds.length,
                        })
                    );
                }
            } else {
                details.push(i18next.t('settingsPaymentPlanList:priceDetails.clickViewDetails'));
            }
            break;
        }
    }

    return details;
};

// ─── CPO accordion helpers ────────────────────────────────────────────────────

interface NormalizedFeeType {
    id: string;
    name: string;
    code: string;
    description: string;
    totalAmount: number;
    hasInstallment: boolean;
    isRefundable: boolean;
    hasPenalty: boolean;
    penaltyPercentage: number | null;
    installments: { number: number; amount: number }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeFeeTypesFromAPI(cpoData: CPOPackage): NormalizedFeeType[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return cpoData.fee_types.map((ft: any, i: number) => {
        const afv = ft.assigned_fee_value ?? {};
        return {
            id: ft.id ?? String(i),
            name: ft.name,
            code: ft.code,
            description: ft.description,
            totalAmount: afv.amount ?? 0,
            hasInstallment: afv.has_installment ?? false,
            isRefundable: afv.is_refundable ?? false,
            hasPenalty: afv.has_penalty ?? false,
            penaltyPercentage: afv.penalty_percentage ?? null,
            installments: (afv.installments ?? []).map((inst: any) => ({
                number: inst.installment_number,
                amount: inst.amount,
            })),
        };
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeFeeTypesFromForm(cpoForm: any): NormalizedFeeType[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return cpoForm.feeTypes.map((ft: any) => ({
        id: String(ft.id),
        name: ft.name,
        code: ft.code,
        description: ft.description,
        totalAmount: parseFloat(ft.amount ?? '0') || 0,
        hasInstallment: ft.hasInstallment ?? false,
        isRefundable: ft.isRefundable ?? false,
        hasPenalty: ft.hasPenalty ?? false,
        penaltyPercentage: ft.penaltyPercentage ? parseFloat(ft.penaltyPercentage) : null,
        installments: (ft.installments ?? []).map((inst: any, idx: number) => ({
            number: idx + 1,
            amount: parseFloat(inst.amount ?? '0') || 0,
        })),
    }));
}

function CPOFeeTypeAccordion({ ft }: { ft: NormalizedFeeType }) {
    const { t } = useTranslation('settingsPaymentPlanList');
    const [open, setOpen] = useState(false);
    const installmentTotal = ft.installments.reduce((s, i) => s + i.amount, 0);

    return (
        <div className="overflow-hidden rounded-lg border border-gray-200">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full cursor-pointer items-center justify-between bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-gray-100"
            >
                <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-600">
                        {ft.code?.slice(0, 1) || 'F'}
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-gray-900">{ft.name}</p>
                        {ft.description && (
                            <p className="text-xs text-gray-400">{ft.description}</p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <p className="text-sm font-bold text-gray-800">
                            ₹{ft.totalAmount.toLocaleString('en-IN')}
                        </p>
                        {ft.hasInstallment && ft.installments.length > 0 && (
                            <p className="text-xs text-gray-400">
                                {t('cpo.installmentCount', { count: ft.installments.length })}
                            </p>
                        )}
                    </div>
                    <div className="flex gap-1">
                        {ft.isRefundable && (
                            <span className="rounded-md border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                                {t('cpo.refundable')}
                            </span>
                        )}
                        {ft.hasPenalty && ft.penaltyPercentage != null && (
                            <span className="rounded-md border border-red-100 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                                {t('cpo.penalty', { percent: ft.penaltyPercentage })}
                            </span>
                        )}
                    </div>
                    <CaretDown
                        className={`size-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                </div>
            </button>

            {open && (
                <div className="px-4 pb-3 pt-2">
                    {ft.hasInstallment && ft.installments.length > 0 ? (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="pb-1 text-start text-xs font-semibold uppercase text-gray-400">
                                        {t('cpo.columnNumber')}
                                    </th>
                                    <th className="pb-1 text-start text-xs font-semibold uppercase text-gray-400">
                                        {t('cpo.columnAmount')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {ft.installments.map((inst) => (
                                    <tr key={inst.number} className="border-b border-gray-50 last:border-0">
                                        <td className="py-1.5 text-gray-400">{inst.number}</td>
                                        <td className="py-1.5 font-medium text-gray-700">
                                            ₹{inst.amount.toLocaleString('en-IN')}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t border-gray-200">
                                    <td className="pt-1.5 font-bold text-gray-600">
                                        {t('cpo.totalLabel')}
                                    </td>
                                    <td className={`pt-1.5 font-bold ${installmentTotal === ft.totalAmount ? 'text-green-600' : 'text-gray-800'}`}>
                                        ₹{installmentTotal.toLocaleString('en-IN')}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    ) : (
                        <p className="text-sm text-gray-500">
                            {t('cpo.oneTimePayment', {
                                amount: ft.totalAmount.toLocaleString('en-IN'),
                            })}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

function CPOExpandedDetails({ plan, isOpen }: { plan: PaymentPlan; isOpen: boolean }) {
    const { t } = useTranslation('settingsPaymentPlanList');
    // cpoId is the ComplexPaymentOption ID (from complex_payment_option_id on the mirror).
    // plan.id is the mirror PaymentOption ID used for makeDefault — different from the CPO id.
    const cpoId = plan.config?.cpoId || null;
    const isSavedCpo = !!cpoId;
    const { data: fullCpo, isLoading } = useCPOFullDetails(
        isSavedCpo ? cpoId : null,
        isOpen
    );

    if (!isOpen) return null;

    let feeTypes: NormalizedFeeType[] = [];
    if (isSavedCpo) {
        if (fullCpo?.fee_types?.length) {
            feeTypes = normalizeFeeTypesFromAPI(fullCpo);
        }
    } else if (plan.config?.cpoForm?.feeTypes?.length) {
        feeTypes = normalizeFeeTypesFromForm(plan.config.cpoForm);
    }

    return (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-purple-100 bg-purple-50/40 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-purple-500">
                {t('cpo.feeTypesTitle')}
            </p>
            {isLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
                    <CircleNotch className="size-4 animate-spin" />
                    {t('cpo.loadingDetails')}
                </div>
            ) : feeTypes.length === 0 ? (
                <p className="py-2 text-sm text-gray-400">{t('cpo.noFeeTypes')}</p>
            ) : (
                feeTypes.map((ft) => <CPOFeeTypeAccordion key={ft.id} ft={ft} />)
            )}
        </div>
    );
}

interface PaymentPlanListProps {
    plans: PaymentPlan[];
    onEdit?: (plan: PaymentPlan) => void;
    onDelete?: (planId: string) => void;
    onSetDefault?: (planId: string) => void;
    onPreview?: (plan: PaymentPlan) => void;
    /** Opens regional (country-based) pricing for a paid, non-CPO option. */
    onRegionalPricing?: (plan: PaymentPlan) => void;
}

export const PaymentPlanList: React.FC<PaymentPlanListProps> = ({
    plans,
    onEdit,
    onDelete,
    onSetDefault,
    onPreview,
    onRegionalPricing,
}) => {
    const { t } = useTranslation('settingsPaymentPlanList');
    const { t: tRegional } = useTranslation('settingsRegionalPricing');
    const [expandedCpoIds, setExpandedCpoIds] = useState<Set<string>>(new Set());

    const toggleCpo = (id: string) => {
        setExpandedCpoIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <Card className="w-full">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <CreditCard className="size-5" />
                    {t('header.title')}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {plans.length === 0 ? (
                        <div className="py-8 text-center text-gray-500">
                            <CreditCard className="mx-auto mb-4 size-12 text-gray-300" />
                            <p>{t('emptyState.title')}</p>
                            <p className="text-sm">{t('emptyState.subtitle')}</p>
                        </div>
                    ) : (
                        plans.map((plan, index) => (
                            <React.Fragment key={plan.id}>
                                {index > 0 && <Separator className="my-4" />}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {getTypeIcon(plan.type)}
                                            <h3 className="text-lg font-medium">{plan.name}</h3>
                                            {plan.tag === 'DEFAULT' && (
                                                <Badge
                                                    variant="default"
                                                    className="bg-green-100 text-green-800"
                                                >
                                                    {t('badge.default')}
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="capitalize">
                                                {plan.type}
                                            </Badge>
                                            {plan.type === PaymentPlans.CPO && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => toggleCpo(plan.id)}
                                                    className="gap-1 text-purple-600 hover:text-purple-700"
                                                >
                                                    <CaretDown
                                                        className={`size-4 transition-transform ${expandedCpoIds.has(plan.id) ? 'rotate-180' : ''}`}
                                                    />
                                                    {expandedCpoIds.has(plan.id)
                                                        ? t('actions.hide')
                                                        : t('actions.viewDetails')}
                                                </Button>
                                            )}
                                            {onPreview &&
                                                plan.type !== PaymentPlans.CPO &&
                                                (plan.type === PaymentPlans.SUBSCRIPTION ||
                                                    plan.type === PaymentPlans.DONATION) && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => onPreview(plan)}
                                                        className="text-blue-600 hover:text-blue-700"
                                                    >
                                                        <Eye className="size-4" />
                                                    </Button>
                                                )}
                                            {onRegionalPricing &&
                                                (plan.type === PaymentPlans.SUBSCRIPTION ||
                                                    plan.type === PaymentPlans.UPFRONT) && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => onRegionalPricing(plan)}
                                                        title={tRegional('actions.openDialog')}
                                                        aria-label={tRegional('actions.openDialog')}
                                                    >
                                                        <Globe className="size-4" />
                                                    </Button>
                                                )}
                                            {onEdit && plan.type !== PaymentPlans.CPO && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => onEdit(plan)}
                                                >
                                                    <PencilSimple className="size-4" />
                                                </Button>
                                            )}
                                            {onSetDefault && plan.tag !== 'DEFAULT' && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        onSetDefault(plan.id);
                                                    }}
                                                >
                                                    {t('actions.makeDefault')}
                                                </Button>
                                            )}
                                            {onDelete && plan.type !== PaymentPlans.CPO && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => onDelete(plan.id)}
                                                    className="text-red-600 hover:text-red-700"
                                                >
                                                    <Trash className="size-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="ml-7 space-y-1">
                                        {getPlanPriceDetails(plan).map((detail, idx) => (
                                            <p key={idx} className="text-sm text-gray-600">
                                                {detail}
                                            </p>
                                        ))}
                                        {plan.type !== PaymentPlans.FREE && plan.type !== PaymentPlans.CPO && (
                                            <p className="mt-2 text-xs text-gray-500">
                                                {t('currency', { currency: plan.currency })}
                                            </p>
                                        )}
                                    </div>

                                    <CPOExpandedDetails
                                        plan={plan}
                                        isOpen={expandedCpoIds.has(plan.id)}
                                    />
                                </div>
                            </React.Fragment>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
