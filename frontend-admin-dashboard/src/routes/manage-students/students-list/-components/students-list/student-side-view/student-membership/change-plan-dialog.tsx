import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, CheckCircle, Info, Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getCurrencySymbol } from '@/constants/currencies';
import { cn } from '@/lib/utils';
import {
    PLAN_CHANGE_OPTIONS_QUERY_KEY,
    changeUserPlan,
    getPlanChangeOptions,
    type PlanChangeTarget,
} from '@/services/user-plan';

interface ChangePlanDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userPlanId: string | null;
    instituteId: string;
    /** Called after the change lands, so the caller can refresh its plan list. */
    onChanged: () => void;
}

const formatPrice = (amount?: number | null, currency?: string | null): string => {
    if (amount == null) return '';
    return `${getCurrencySymbol(currency || 'INR')}${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
};

/**
 * Admin override for moving a learner between payment plans.
 *
 * <p>Deliberately different from the learner-facing dialog: this one takes **no payment**.
 * It is for comps, corrections and negotiated moves, so it shows what the learner would
 * have paid only as context, and states plainly that the access window is untouched — the
 * new price starts billing at the next renewal.
 *
 * <p>Eligibility is identical to the learner flow: only plans the institute flagged as
 * switchable, on payment options reachable from this learner's own package sessions.
 */
export const ChangePlanDialog = ({
    open,
    onOpenChange,
    userPlanId,
    instituteId,
    onChanged,
}: ChangePlanDialogProps) => {
    const { t } = useTranslation('manageStudentsPlanDetails');
    const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [notifyLearner, setNotifyLearner] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { data, isLoading, isError } = useQuery({
        queryKey: [PLAN_CHANGE_OPTIONS_QUERY_KEY, userPlanId, instituteId],
        queryFn: () => getPlanChangeOptions(userPlanId as string, instituteId),
        enabled: open && Boolean(userPlanId) && Boolean(instituteId),
    });

    // Reset per-open so a selection or a reason never carries onto another learner.
    useEffect(() => {
        if (!open) return;
        setSelectedPlanId(null);
        setReason('');
        setNotifyLearner(false);
    }, [open, userPlanId]);

    const targets = useMemo(() => data?.targets ?? [], [data]);

    /** Grouped by payment option — the option is what an admin recognises by name. */
    const grouped = useMemo(() => {
        const byOption = new Map<string, { name: string; targets: PlanChangeTarget[] }>();
        targets.forEach((target) => {
            const existing = byOption.get(target.payment_option_id);
            if (existing) {
                existing.targets.push(target);
            } else {
                byOption.set(target.payment_option_id, {
                    name: target.option_name || t('fallback.paymentOption'),
                    targets: [target],
                });
            }
        });
        return Array.from(byOption.entries()).map(([id, group]) => ({ id, ...group }));
    }, [targets, t]);

    const selected = targets.find((target) => target.plan_id === selectedPlanId) ?? null;

    const handleSubmit = async () => {
        if (!selected || !userPlanId) return;
        try {
            setIsSubmitting(true);
            await changeUserPlan(userPlanId, instituteId, {
                target_plan_id: selected.plan_id,
                reason: reason.trim() || undefined,
                notify_learner: notifyLearner,
            });
            toast.success(t('changePlan.successToast', { plan: selected.plan_name }));
            onOpenChange(false);
            onChanged();
        } catch (error) {
            console.error('Error changing plan:', error);
            toast.error(t('changePlan.failedToast'));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-dialog-tall max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('changePlan.title')}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-1">
                    <div className="flex items-start gap-2 rounded-md bg-warning-50 p-3 text-xs text-warning-700 ring-1 ring-warning-200">
                        <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
                        <span>{t('changePlan.noChargeWarning')}</span>
                    </div>

                    {isLoading && (
                        <div className="flex items-center justify-center py-6">
                            <DashboardLoader />
                        </div>
                    )}

                    {!isLoading && isError && (
                        <div className="flex items-start gap-2 rounded-md bg-danger-50 p-3 text-xs text-danger-700 ring-1 ring-danger-200">
                            <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
                            <span>{t('changePlan.loadFailed')}</span>
                        </div>
                    )}

                    {!isLoading && !isError && targets.length === 0 && (
                        <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-xs text-info-700 ring-1 ring-info-200">
                            <Info className="mt-0.5 size-4 shrink-0" />
                            <span>
                                {data?.blocked_reason === 'CHANGE_ALREADY_IN_PROGRESS'
                                    ? t('changePlan.alreadyInProgress')
                                    : data?.blocked_reason === 'PLAN_NOT_ACTIVE'
                                      ? t('changePlan.planNotActive')
                                      : t('changePlan.noOptions')}
                            </span>
                        </div>
                    )}

                    {!isLoading && !isError && targets.length > 0 && (
                        <>
                            {data?.current_plan_name && (
                                <p className="text-xs text-neutral-600">
                                    {t('changePlan.currentlyOn', {
                                        plan: data.current_plan_name,
                                        price: formatPrice(
                                            data.current_plan_price,
                                            data.currency
                                        ),
                                    })}
                                </p>
                            )}

                            <div className="space-y-4">
                                {grouped.map((group) => (
                                    <div key={group.id} className="space-y-2">
                                        {grouped.length > 1 && (
                                            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                                {group.name}
                                            </p>
                                        )}
                                        {group.targets.map((target) => {
                                            const isSelected =
                                                target.plan_id === selectedPlanId;
                                            const isUpgrade = target.direction === 'UPGRADE';
                                            return (
                                                <button
                                                    key={target.plan_id}
                                                    type="button"
                                                    onClick={() =>
                                                        setSelectedPlanId(target.plan_id)
                                                    }
                                                    className={cn(
                                                        'w-full rounded-lg border p-3 text-left transition-colors',
                                                        isSelected
                                                            ? 'border-primary-300 bg-primary-50'
                                                            : 'border-neutral-200 bg-white hover:border-primary-200'
                                                    )}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="truncate text-sm font-semibold text-neutral-900">
                                                                    {target.plan_name}
                                                                </span>
                                                                <span
                                                                    className={cn(
                                                                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                                                                        isUpgrade
                                                                            ? 'bg-success-50 text-success-700'
                                                                            : 'bg-neutral-100 text-neutral-600'
                                                                    )}
                                                                >
                                                                    {isUpgrade ? (
                                                                        <ArrowUp
                                                                            className="size-3"
                                                                            weight="bold"
                                                                        />
                                                                    ) : (
                                                                        <ArrowDown
                                                                            className="size-3"
                                                                            weight="bold"
                                                                        />
                                                                    )}
                                                                    {isUpgrade
                                                                        ? t('changePlan.upgrade')
                                                                        : t(
                                                                              'changePlan.downgrade'
                                                                          )}
                                                                </span>
                                                            </div>
                                                            <p className="mt-0.5 text-xs text-neutral-500">
                                                                {target.validity_in_days
                                                                    ? t('changePlan.cadence', {
                                                                          price: formatPrice(
                                                                              target.price,
                                                                              target.currency
                                                                          ),
                                                                          days: target.validity_in_days,
                                                                      })
                                                                    : formatPrice(
                                                                          target.price,
                                                                          target.currency
                                                                      )}
                                                            </p>
                                                            {/* A cross-option move also
                                                                repoints the enrolment
                                                                invite — say so, because it
                                                                changes gateway, currency
                                                                and autopay settings. */}
                                                            {target.cross_option && (
                                                                <p className="mt-1 flex items-start gap-1 text-xs text-warning-700">
                                                                    <Warning
                                                                        className="mt-0.5 size-3 shrink-0"
                                                                        weight="fill"
                                                                    />
                                                                    {t(
                                                                        'changePlan.crossOptionNote',
                                                                        { option: group.name }
                                                                    )}
                                                                </p>
                                                            )}
                                                        </div>
                                                        {isSelected && (
                                                            <CheckCircle
                                                                className="size-5 shrink-0 text-primary-500"
                                                                weight="fill"
                                                            />
                                                        )}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>

                            <div className="space-y-1">
                                <label
                                    htmlFor="planChangeReason"
                                    className="text-xs font-medium text-neutral-700"
                                >
                                    {t('changePlan.reasonLabel')}
                                </label>
                                <Textarea
                                    id="planChangeReason"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder={t('changePlan.reasonPlaceholder')}
                                    rows={2}
                                />
                            </div>

                            <label className="flex cursor-pointer items-start gap-2 text-xs text-neutral-700">
                                <Checkbox
                                    className="mt-0.5"
                                    checked={notifyLearner}
                                    onCheckedChange={(checked) =>
                                        setNotifyLearner(checked === true)
                                    }
                                />
                                <span>{t('changePlan.notifyLearner')}</span>
                            </label>
                        </>
                    )}
                </div>

                <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => onOpenChange(false)}
                        disable={isSubmitting}
                    >
                        {t('changePlan.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        onClick={handleSubmit}
                        disable={!selected || isSubmitting}
                    >
                        {isSubmitting ? t('changePlan.applying') : t('changePlan.apply')}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
};
