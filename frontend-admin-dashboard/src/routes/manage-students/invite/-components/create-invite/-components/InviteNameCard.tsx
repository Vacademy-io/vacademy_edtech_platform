import { UseFormReturn } from 'react-hook-form';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField, FormItem, FormControl } from '@/components/ui/form';
import { AddressBook } from '@phosphor-icons/react';
import { MyInput } from '@/components/design-system/input';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useTranslation } from 'react-i18next';

interface DiscountSettingsDialogProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

const InviteNameCard = ({ form }: DiscountSettingsDialogProps) => {
    const { t } = useTranslation('manageStudentsInviteNameCard');
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <AddressBook size={20} />
                    <span className="text-2xl font-bold">
                        {t('title', {
                            term: getTerminology(OtherTerms.Invite, SystemTerms.Invite),
                        })}
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="-mt-1">
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field: { onChange, value, ...field } }) => (
                        <FormItem>
                            <FormControl>
                                <MyInput
                                    inputType="text"
                                    label={t('title', {
                                        term: getTerminology(OtherTerms.Invite, SystemTerms.Invite),
                                    })}
                                    inputPlaceholder={t('placeholder', {
                                        term: getTerminology(
                                            OtherTerms.Invite,
                                            SystemTerms.Invite
                                        ).toLowerCase(),
                                    })}
                                    input={value}
                                    onChangeFunction={onChange}
                                    required={false}
                                    size="large"
                                    className="w-full"
                                    {...field}
                                />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </CardContent>
        </Card>
    );
};

export default InviteNameCard;
