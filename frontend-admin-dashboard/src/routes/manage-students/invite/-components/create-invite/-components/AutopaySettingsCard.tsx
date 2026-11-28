import { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField, FormItem, FormControl } from '@/components/ui/form';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';

interface AutopaySettingsCardProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

/**
 * Autopay + free-trial config for an invite's paid subscription plans. When
 * enabled, enrolling registers a recurring mandate (UPI Autopay / card) and the
 * subscription auto-renews; trialDays > 0 grants access now and takes the first
 * charge after the trial. Persisted to setting_json.setting.AUTOPAY_SETTING and
 * read at enrollment time.
 */
const AutopaySettingsCard = ({ form }: AutopaySettingsCardProps) => {
    const { t } = useTranslation('manageStudentsAutopaySettingsCard');
    const enabled = form.watch('autopaySettings.enabled');
    const trialDays = form.watch('autopaySettings.trialDays');
    const authEnabled = form.watch('autopaySettings.authEnabled');
    const planType = form.watch('selectedPlan')?.type?.toLowerCase();

    // Autopay only applies to recurring (subscription) plans — hide otherwise.
    if (planType !== 'subscription') {
        return null;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-2xl font-bold">
                    <ArrowsClockwise size={22} />
                    {t('title')}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <FormField
                    control={form.control}
                    name="autopaySettings.enabled"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <div className="flex items-center justify-between gap-4">
                                    <div className="w-full">
                                        <div className="text-base font-semibold">
                                            {t('autoRenew.label')}
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span>{t('autoRenew.description')}</span>
                                            <Switch
                                                id="enable-autopay-switch"
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </FormControl>
                        </FormItem>
                    )}
                />

                {enabled && (
                    <div className="mt-4 border-t pt-4">
                        <span className="text-sm font-medium">{t('trial.label')}</span>
                        <FormField
                            control={form.control}
                            name="autopaySettings.trialDays"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            min={0}
                                            className="mt-2 w-40"
                                            placeholder={t('trial.placeholder')}
                                            value={field.value ?? 0}
                                            onChange={(e) =>
                                                field.onChange(
                                                    e.target.value === ''
                                                        ? 0
                                                        : Number(e.target.value)
                                                )
                                            }
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <div className="mt-1 text-xs text-muted-foreground">
                            {t('trial.helpText')}
                        </div>

                        <div className="mt-4 border-t pt-4">
                            <FormField
                                control={form.control}
                                name="autopaySettings.authEnabled"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="w-full">
                                                    <div className="text-base font-semibold">
                                                        {t('authCharge.label')}
                                                    </div>
                                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                        <span>{t('authCharge.description')}</span>
                                                        <Switch
                                                            id="enable-auth-charge-switch"
                                                            checked={field.value ?? true}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            {authEnabled !== false && (
                                <div className="mt-4">
                                    <span className="text-sm font-medium">{t('authAmount.label')}</span>
                                    <FormField
                                        control={form.control}
                                        name="autopaySettings.authAmount"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        step="0.01"
                                                        className="mt-2 w-40"
                                                        placeholder={t('authAmount.placeholder')}
                                                        value={field.value ?? ''}
                                                        onChange={(e) =>
                                                            field.onChange(
                                                                e.target.value === ''
                                                                    ? null
                                                                    : Number(e.target.value)
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        {t('authAmount.helpText')}
                                    </div>

                                    <FormField
                                        control={form.control}
                                        name="autopaySettings.authRefundable"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <div className="mt-4 flex items-center justify-between gap-4">
                                                        <div className="w-full">
                                                            <div className="text-sm font-medium">
                                                                {t('authRefundable.label')}
                                                            </div>
                                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                                <span>{t('authRefundable.description')}</span>
                                                                <Switch
                                                                    id="refund-auth-switch"
                                                                    checked={field.value ?? false}
                                                                    onCheckedChange={field.onChange}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            )}

                            {authEnabled === false && (trialDays ?? 0) > 0 && (
                                <div className="mt-2 text-xs text-warning-600">
                                    {t('authRequiredWarning')}
                                </div>
                            )}
                        </div>

                        <div className="mt-4 border-t pt-4">
                            <span className="text-sm font-medium">{t('maxAmount.label')}</span>
                            <FormField
                                control={form.control}
                                name="autopaySettings.maxAmount"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={0}
                                                className="mt-2 w-40"
                                                placeholder={t('maxAmount.placeholder')}
                                                value={field.value ?? ''}
                                                onChange={(e) =>
                                                    field.onChange(
                                                        e.target.value === ''
                                                            ? null
                                                            : Number(e.target.value)
                                                    )
                                                }
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <div className="mt-1 text-xs text-muted-foreground">
                                {t('maxAmount.helpText')}
                            </div>
                        </div>

                        <div className="mt-4 border-t pt-4">
                            <span className="text-sm font-medium">{t('gracePeriod.label')}</span>
                            <FormField
                                control={form.control}
                                name="autopaySettings.gracePeriodDays"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={0}
                                                className="mt-2 w-40"
                                                placeholder={t('gracePeriod.placeholder')}
                                                value={field.value ?? ''}
                                                onChange={(e) =>
                                                    field.onChange(
                                                        e.target.value === ''
                                                            ? null
                                                            : Number(e.target.value)
                                                    )
                                                }
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <div className="mt-1 text-xs text-muted-foreground">
                                {t('gracePeriod.helpText')}
                            </div>
                        </div>

                        <div className="mt-4">
                            <span className="text-sm font-medium">{t('totalDuration.label')}</span>
                            <FormField
                                control={form.control}
                                name="autopaySettings.totalDurationMonths"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={1}
                                                className="mt-2 w-40"
                                                placeholder={t('totalDuration.placeholder')}
                                                value={field.value ?? ''}
                                                onChange={(e) =>
                                                    field.onChange(
                                                        e.target.value === ''
                                                            ? null
                                                            : Number(e.target.value)
                                                    )
                                                }
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <div className="mt-1 text-xs text-muted-foreground">
                                {t('totalDuration.helpText')}
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default AutopaySettingsCard;
