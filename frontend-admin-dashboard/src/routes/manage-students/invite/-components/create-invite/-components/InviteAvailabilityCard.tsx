import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { UseFormReturn } from 'react-hook-form';
import { CalendarBlank } from '@phosphor-icons/react';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { useTranslation } from 'react-i18next';

interface InviteAvailabilityCardProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

/**
 * Lets the admin bound when an invite link accepts enrollments (start/end date) and author a
 * rich-text message shown to learners when it doesn't. Dates map to enroll_invite.start_date /
 * end_date; the message is stored in setting_json under setting.AVAILABILITY_SETTING. Leaving a
 * date empty keeps that side of the window open.
 */
const InviteAvailabilityCard = ({ form }: InviteAvailabilityCardProps) => {
    const { t } = useTranslation('manageStudentsInviteAvailabilityCard');
    return (
        <Card className="mb-4">
            <CardHeader>
                <div className="flex items-center gap-2">
                    <div>
                        <div className="flex items-center gap-2">
                            <CalendarBlank size={22} />
                            <CardTitle className="text-2xl font-bold">
                                {t('title')}
                            </CardTitle>
                        </div>
                        <span className="text-sm text-gray-600">
                            {t('description')}
                        </span>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 sm:flex-row">
                    <FormField
                        control={form.control}
                        name="availabilityStartDate"
                        render={({ field }) => (
                            <FormItem className="flex-1">
                                <FormLabel>{t('startDate.label')}</FormLabel>
                                <FormControl>
                                    <Input
                                        type="date"
                                        value={field.value ?? ''}
                                        onChange={field.onChange}
                                        onBlur={field.onBlur}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="availabilityEndDate"
                        render={({ field }) => (
                            <FormItem className="flex-1">
                                <FormLabel>{t('endDate.label')}</FormLabel>
                                <FormControl>
                                    <Input
                                        type="date"
                                        value={field.value ?? ''}
                                        onChange={field.onChange}
                                        onBlur={field.onBlur}
                                        min={form.watch('availabilityStartDate') || undefined}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
                <FormField
                    control={form.control}
                    name="unavailableMessage"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t('unavailableMessage.label')}</FormLabel>
                            <FormControl>
                                <RichTextEditor
                                    value={field.value}
                                    onChange={field.onChange}
                                    onBlur={field.onBlur}
                                    minHeight={120}
                                    placeholder={t('unavailableMessage.placeholder')}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </CardContent>
        </Card>
    );
};

export default InviteAvailabilityCard;
