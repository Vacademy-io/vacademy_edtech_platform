import { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { MyButton } from '@/components/design-system/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendUp, Gear, Plus, CheckCircle, Clock } from '@phosphor-icons/react';
import { getAllPlanIdsFromSelectedPlan, getPlanDisplayName } from '../-utils/helper';

interface PlanReferralMappingCardProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

const PlanReferralMappingCard = ({ form }: PlanReferralMappingCardProps) => {
    const { t } = useTranslation('manageStudentsPlanReferralMappingCard');
    const selectedPlan = form.watch('selectedPlan');
    const planReferralMappings = form.watch('planReferralMappings');
    const referralPrograms = form.watch('referralPrograms');

    // Get all plan IDs from the selected plan
    const planIds = getAllPlanIdsFromSelectedPlan(selectedPlan || null);

    // Helper function to get referral name by ID
    const getReferralNameById = (referralId: string) => {
        const referral = referralPrograms?.find((r) => r.id === referralId);
        return referral?.name || t('planList.unknownReferral');
    };

    // Helper function to check if all plans have referral configured
    const getConfigurationStatus = () => {
        const configuredCount = planIds.filter((planId) => planReferralMappings[planId]).length;
        return { configured: configuredCount, total: planIds.length };
    };

    const { configured, total } = getConfigurationStatus();

    // Function to apply same referral to all plans
    const handleApplyToAllPlans = () => {
        if (planIds.length === 0) return;

        // Find the first configured plan's referral or use default
        const firstConfiguredPlan = planIds.find((planId) => planReferralMappings[planId]);
        const referralIdToApply = firstConfiguredPlan
            ? planReferralMappings[firstConfiguredPlan]
            : referralPrograms?.[0]?.id || '';

        if (!referralIdToApply) return;

        // Apply the same referral to all plans
        const newMappings = { ...planReferralMappings };
        planIds.forEach((planId) => {
            newMappings[planId] = referralIdToApply;
        });

        form.setValue('planReferralMappings', newMappings);
    };

    return (
        <>
            <div className="flex flex-col">
                <div className="flex flex-col">
                    <span className="font-medium">{t('header.title')}</span>
                    <span className="text-sm">{t('header.description')}</span>
                </div>
            </div>

            <Card className="mb-4">
                <CardHeader className="-mb-5 flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="flex items-center gap-2 text-lg font-semibold">
                            <TrendUp size={20} />
                            <span>{t('card.title')}</span>
                        </span>
                        <Badge
                            variant={configured === total && total > 0 ? 'default' : 'secondary'}
                            className="ml-2"
                        >
                            {t('card.configuredBadge', { configured, total })}
                        </Badge>
                    </div>
                    <div className="flex gap-2">
                        {planIds.length > 1 && (
                            <MyButton
                                type="button"
                                scale="small"
                                buttonType="secondary"
                                className="p-4"
                                onClick={handleApplyToAllPlans}
                                disable={planIds.length === 0}
                            >
                                {t('card.applyToAll')}
                            </MyButton>
                        )}
                        <MyButton
                            type="button"
                            scale="small"
                            buttonType="secondary"
                            className="p-4"
                            onClick={() => form.setValue('showPlanReferralDialog', true)}
                            disable={!selectedPlan}
                        >
                            {t('card.configureReferrals')}
                        </MyButton>
                    </div>
                </CardHeader>

                <CardContent className="space-y-4">
                    {!selectedPlan ? (
                        <div className="flex items-center justify-center py-8 text-gray-500">
                            <div className="text-center">
                                <Gear size={32} className="mx-auto mb-2 opacity-50" />
                                <p>{t('emptyStates.noPlanSelected')}</p>
                            </div>
                        </div>
                    ) : planIds.length === 0 ? (
                        <div className="flex items-center justify-center py-8 text-gray-500">
                            <div className="text-center">
                                <Gear size={32} className="mx-auto mb-2 opacity-50" />
                                <p>{t('emptyStates.noPaymentOptions')}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="text-sm font-medium text-gray-700">
                                {t('planList.heading')}
                            </div>
                            {planIds.map((planId) => {
                                const planName = getPlanDisplayName(selectedPlan, planId);
                                const referralId = planReferralMappings[planId];
                                const isConfigured = !!referralId;

                                return (
                                    <div
                                        key={planId}
                                        className="flex items-center justify-between rounded-lg border p-3"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="shrink-0">
                                                {isConfigured ? (
                                                    <CheckCircle
                                                        size={20}
                                                        className="text-green-600"
                                                    />
                                                ) : (
                                                    <Clock size={20} className="text-gray-400" />
                                                )}
                                            </div>
                                            <div>
                                                <div className="font-medium">{planName}</div>
                                                {isConfigured ? (
                                                    <div className="text-sm text-gray-600">
                                                        {t('planList.referralLabel', {
                                                            name: getReferralNameById(referralId),
                                                        })}
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-gray-400">
                                                        {t('planList.noReferralConfigured')}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <MyButton
                                            type="button"
                                            scale="small"
                                            buttonType={isConfigured ? 'secondary' : 'primary'}
                                            className="p-2"
                                            onClick={() => {
                                                form.setValue('selectedPlanForReferral', planId);
                                                form.setValue('showPlanReferralDialog', true);
                                            }}
                                        >
                                            {isConfigured ? <Gear size={16} /> : <Plus size={16} />}
                                        </MyButton>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </>
    );
};

export default PlanReferralMappingCard;
