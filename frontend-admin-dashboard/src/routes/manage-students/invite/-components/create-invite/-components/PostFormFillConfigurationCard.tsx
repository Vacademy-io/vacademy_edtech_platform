import { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';

interface PostFormFillConfigurationCardProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

const PostFormFillConfigurationCard = ({ form }: PostFormFillConfigurationCardProps) => {
    const { t } = useTranslation('manageStudentsPostFormFillConfigurationCard');
    return (
        <Card className="shadow-none rounded-sm bg-neutral-50/50">
            <CardHeader className="border-b bg-neutral-100/50 p-4">
                <CardTitle className="text-base font-semibold text-neutral-800">
                    {t('title')}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 p-4">
                <div className="grid grid-cols-1 gap-6">
                    <FormField
                        control={form.control}
                        name="postformfillConfiguration.redirectPath"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('redirectPath.label')}</FormLabel>
                                <FormControl>
                                    <Input placeholder={t('redirectPath.placeholder')} {...field} />
                                </FormControl>
                                <p className="text-xs text-neutral-500">
                                    {t('redirectPath.helpText')}
                                </p>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="postformfillConfiguration.showLoginButton"
                        render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                <div className="space-y-0.5">
                                    <FormLabel className="text-sm font-semibold">{t('showLoginButton.label')}</FormLabel>
                                    <p className="text-xs text-neutral-500">
                                        {t('showLoginButton.helpText')}
                                    </p>
                                </div>
                                <FormControl>
                                    <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="postformfillConfiguration.content"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('content.label')}</FormLabel>
                                <FormControl>
                                    <Textarea rows={4} placeholder={t('content.placeholder')} {...field} />
                                </FormControl>
                                <p className="text-xs text-neutral-500">
                                    {t('content.helpText')}
                                </p>
                                <p className="text-xs text-neutral-500">
                                    {t('content.tokensPrefix')} <code>{'{{courseName}}'}</code> {t('content.tokensJoiner')} <code>{'{{amount}}'}</code>. {t('content.tokensSuffix')}
                                </p>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="postformfillConfiguration.collectBillingContactDetails"
                        render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                <div className="space-y-0.5">
                                    <FormLabel className="text-sm font-semibold">{t('collectBillingContactDetails.label')}</FormLabel>
                                    <p className="text-xs text-neutral-500">
                                        {t('collectBillingContactDetails.helpText')}
                                    </p>
                                </div>
                                <FormControl>
                                    <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    {form.watch('postformfillConfiguration.collectBillingContactDetails') && (
                        <div className="space-y-4 rounded-lg border border-dashed p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                                {t('billingContactFields.heading')}
                            </p>
                            <p className="text-xs text-neutral-500">
                                {t('billingContactFields.helpText')}
                            </p>

                            {(['name', 'email', 'role'] as const).map((key) => (
                                <div
                                    key={key}
                                    className="grid grid-cols-1 gap-3 rounded-md border bg-white p-3 sm:grid-cols-12"
                                >
                                    <FormField
                                        control={form.control}
                                        name={`postformfillConfiguration.billingContactFields.${key}.label` as const}
                                        render={({ field }) => (
                                            <FormItem className="sm:col-span-6">
                                                <FormLabel className="text-xs">
                                                    {t('billingContactFields.fieldLabelTemplate', {
                                                        field: t(`billingContactFields.fieldNames.${key}`),
                                                    })}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input placeholder={t('billingContactFields.fieldLabelPlaceholder')} {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name={`postformfillConfiguration.billingContactFields.${key}.required` as const}
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between gap-2 sm:col-span-6">
                                                <FormLabel className="text-xs">{t('billingContactFields.required')}</FormLabel>
                                                <FormControl>
                                                    <Switch
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />

                                    {key === 'role' && (
                                        <FormField
                                            control={form.control}
                                            name="postformfillConfiguration.billingContactFields.role.options"
                                            render={({ field }) => (
                                                <FormItem className="sm:col-span-12">
                                                    <FormLabel className="text-xs">{t('billingContactFields.options.label')}</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            placeholder={t('billingContactFields.options.placeholder')}
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <p className="text-xs text-neutral-500">
                                                        {t('billingContactFields.options.helpText')}
                                                    </p>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default PostFormFillConfigurationCard;
