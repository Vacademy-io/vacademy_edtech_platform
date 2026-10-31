import { Card } from '@/components/ui/card';
import { UseFormReturn } from 'react-hook-form';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { Switch as ShadSwitch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';

interface DiscountSettingsDialogProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

const RestrictSameBatch = ({ form }: DiscountSettingsDialogProps) => {
    const { t } = useTranslation('manageStudentsRestrictSameBatch');
    return (
        <Card className="mb-4 flex flex-row items-center justify-between p-4">
            <div className="flex flex-col">
                <span className="font-semibold">{t('label')}</span>
                <span className="text-sm text-gray-600">{t('description')}</span>
            </div>
            <ShadSwitch
                checked={form.watch('restrictToSameBatch')}
                onCheckedChange={(value) => form.setValue('restrictToSameBatch', value)}
            />
        </Card>
    );
};

export default RestrictSameBatch;
