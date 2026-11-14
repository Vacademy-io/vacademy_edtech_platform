import { forwardRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { UseFormReturn } from 'react-hook-form';
import { BellRinging } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import MultiEmailInput, {
    MultiEmailInputHandle,
} from '@/routes/audience-manager/list/-components/audience-invite/components/MultiEmailInput';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';

interface TeamNotificationsCardProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

/**
 * Team Notifications for an invite link — the enroll-invite twin of the audience
 * campaign's Team Notifications box. Every address listed here is mailed when a
 * learner fills this invite's enrollment form. Persisted to
 * setting_json.setting.NOTIFICATION_SETTING.TO_NOTIFY (comma-separated).
 *
 * Forwards the MultiEmailInput handle so the dialog can flush a half-typed
 * address into the list at submit time — the input's `blur` doesn't reliably
 * fire first when the submit button is clicked (Safari/Firefox on macOS).
 */
const TeamNotificationsCard = forwardRef<MultiEmailInputHandle, TeamNotificationsCardProps>(
    ({ form }, ref) => {
        const { t } = useTranslation('manageStudentsTeamNotificationsCard');
        return (
            <Card className="mb-4">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <div>
                            <div className="flex items-center gap-2">
                                <BellRinging size={22} />
                                <CardTitle className="text-2xl font-bold">
                                    {t('title')}
                                </CardTitle>
                            </div>
                            <span className="text-sm text-gray-600">{t('description')}</span>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <FormField
                        control={form.control}
                        name="teamNotificationEmails"
                        render={({ field, fieldState }) => (
                            <FormItem>
                                <FormControl>
                                    <MultiEmailInput
                                        ref={ref}
                                        value={field.value ?? []}
                                        onChange={field.onChange}
                                        placeholder={t('emailInput.placeholder')}
                                        error={fieldState.error?.message}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </CardContent>
            </Card>
        );
    }
);

TeamNotificationsCard.displayName = 'TeamNotificationsCard';

export default TeamNotificationsCard;
