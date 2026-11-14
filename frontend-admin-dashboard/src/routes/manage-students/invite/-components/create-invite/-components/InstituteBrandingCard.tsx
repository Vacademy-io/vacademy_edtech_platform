import { UseFormReturn } from 'react-hook-form';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building } from '@phosphor-icons/react';
import { FormField, FormItem, FormControl } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';

interface DiscountSettingsDialogProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

const InstituteBrandingCard = ({ form }: DiscountSettingsDialogProps) => {
    const { t } = useTranslation('manageStudentsInstituteBrandingCard');
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Building size={20} />
                    <span className="text-2xl font-bold">{t('title')}</span>
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <FormField
                    control={form.control}
                    name="includeInstituteLogo"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        id="institute-logo-switch"
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                    <span>{t('includeLogo.label')}</span>
                                </div>
                            </FormControl>
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="blendHeaderWithBackground"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            id="blend-header-switch"
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                        <span>{t('blendHeader.label')}</span>
                                    </div>
                                    <span className="text-caption text-neutral-500">
                                        {t('blendHeader.description')}
                                    </span>
                                </div>
                            </FormControl>
                        </FormItem>
                    )}
                />
            </CardContent>
        </Card>
    );
};

export default InstituteBrandingCard;
