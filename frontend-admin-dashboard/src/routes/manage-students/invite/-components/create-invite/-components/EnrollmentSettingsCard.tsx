import { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField, FormItem, FormControl } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { WarningCircle } from '@phosphor-icons/react';
import { Textarea } from '@/components/ui/textarea';

interface DiscountSettingsDialogProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

const EnrollmentSettingsCard = ({ form }: DiscountSettingsDialogProps) => {
    const { t } = useTranslation('manageStudentsEnrollmentSettingsCard');
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-2xl font-bold">{t('title')}</CardTitle>
            </CardHeader>
            <CardContent>
                <FormField
                    control={form.control}
                    name="requireApproval"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <div className="flex items-center justify-between gap-4">
                                    <div className="w-full">
                                        <div className="text-base font-semibold">
                                            {t('requireApproval.label')}
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span>{t('requireApproval.description')}</span>
                                            <Switch
                                                id="require-approval-switch"
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </div>
                                        {/* Conditional warning and message template */}
                                        {field.value && (
                                            <div className="mt-4 flex flex-col">
                                                <div className="mb-2 flex items-center gap-2 rounded-xl border p-3 text-xs font-medium">
                                                    <WarningCircle size={18} />
                                                    {t('warning')}
                                                </div>
                                                <span>{t('messageTemplate.label')}</span>
                                                <FormField
                                                    control={form.control}
                                                    name="messageTemplate"
                                                    render={({ field: templateField }) => (
                                                        <FormItem>
                                                            <Select
                                                                value={
                                                                    templateField.value ||
                                                                    'standard'
                                                                }
                                                                onValueChange={(val) => {
                                                                    templateField.onChange(val);
                                                                    if (val !== 'custom') {
                                                                        form.setValue(
                                                                            'customMessage',
                                                                            undefined
                                                                        );
                                                                    }
                                                                }}
                                                            >
                                                                <FormControl>
                                                                    <SelectTrigger className="mt-2 w-full">
                                                                        <SelectValue
                                                                            placeholder={t(
                                                                                'messageTemplate.placeholder'
                                                                            )}
                                                                        />
                                                                    </SelectTrigger>
                                                                </FormControl>
                                                                <SelectContent>
                                                                    <SelectItem value="standard">
                                                                        {t(
                                                                            'messageTemplate.options.standard'
                                                                        )}
                                                                    </SelectItem>
                                                                    <SelectItem value="review">
                                                                        {t(
                                                                            'messageTemplate.options.review'
                                                                        )}
                                                                    </SelectItem>
                                                                    <SelectItem value="custom">
                                                                        {t(
                                                                            'messageTemplate.options.custom'
                                                                        )}
                                                                    </SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </FormItem>
                                                    )}
                                                />
                                                <span className="mt-2">
                                                    {t('approvalMessage.label')}
                                                </span>
                                                <FormField
                                                    control={form.control}
                                                    name="customMessage"
                                                    render={({ field: msgField }) => {
                                                        const template =
                                                            form.watch('messageTemplate') ||
                                                            'standard';
                                                        let value = msgField.value;
                                                        let disabled = false;
                                                        if (template === 'standard') {
                                                            value = t(
                                                                'approvalMessage.templates.standard'
                                                            );
                                                            disabled = true;
                                                        } else if (template === 'review') {
                                                            value = t(
                                                                'approvalMessage.templates.review'
                                                            );
                                                            disabled = true;
                                                        } else if (template === 'custom') {
                                                            disabled = false;
                                                        }
                                                        return (
                                                            <Textarea
                                                                className="mt-3 min-h-24"
                                                                value={value || ''}
                                                                onChange={(e) =>
                                                                    msgField.onChange(
                                                                        e.target.value
                                                                    )
                                                                }
                                                                disabled={disabled}
                                                                placeholder={t(
                                                                    'approvalMessage.placeholder'
                                                                )}
                                                            />
                                                        );
                                                    }}
                                                />
                                                <span className="-mb-2 mt-3 text-xs text-neutral-500">
                                                    {t('markdownHint')}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </FormControl>
                        </FormItem>
                    )}
                />
            </CardContent>
        </Card>
    );
};

export default EnrollmentSettingsCard;
