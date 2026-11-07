import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UseFormReturn } from 'react-hook-form';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { Clock } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';

interface CustomInviteFormCardProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

/**
 * Plan types whose access window comes from the payment plan's validity, not from the
 * invite. For these the field below is a fallback the backend never reaches, so we say so
 * rather than letting an admin type a number that quietly does nothing.
 */
const PLAN_CONTROLLED_TYPES = ['subscription', 'one_time'];

const LearnerAccessDurationCard = ({ form }: CustomInviteFormCardProps) => {
    const { t } = useTranslation('manageStudentsLearnerAccessDurationCard');
    const planType = form.watch('selectedPlan')?.type?.toLowerCase() ?? '';
    const planControlsAccess = PLAN_CONTROLLED_TYPES.includes(planType);

    return (
        <Card className="mb-4">
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Clock size={22} />
                    <CardTitle className="text-2xl font-bold">{t('title')}</CardTitle>
                </div>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col gap-1">
                    <label htmlFor="access-duration-days" className="text-sm font-medium">
                        {t('durationLabel')}
                    </label>
                    <Input
                        id="access-duration-days"
                        type="number"
                        min={1}
                        value={form.watch('accessDurationDays')}
                        onChange={(e) => form.setValue('accessDurationDays', e.target.value)}
                        placeholder={t('durationPlaceholder')}
                        className="w-48"
                    />
                    <p className="text-xs text-neutral-500">
                        {planControlsAccess ? t('planControlledHelpText') : t('freeFormHelpText')}
                    </p>
                </div>
            </CardContent>
        </Card>
    );
};

export default LearnerAccessDurationCard;
