import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import {
    UserIdentifier,
    saveUserIdentifierSetting,
    useUserIdentifierSetting,
    userIdentifierQueryKey,
} from '@/services/user-identifier-setting';

export default function UserIdentifierSettings() {
    const { t } = useTranslation('settingsUserIdentifier');
    const queryClient = useQueryClient();

    const { data: savedIdentifier, isLoading } = useUserIdentifierSetting();

    const [selected, setSelected] = useState<UserIdentifier>('EMAIL');

    useEffect(() => {
        if (savedIdentifier) setSelected(savedIdentifier);
    }, [savedIdentifier]);

    const mutation = useMutation({
        mutationFn: saveUserIdentifierSetting,
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            queryClient.invalidateQueries({ queryKey: userIdentifierQueryKey() });
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message || t('toasts.saveError'));
        },
    });

    if (isLoading) return <div className="p-4">{t('loading')}</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{t('header.title')}</CardTitle>
                <CardDescription>{t('header.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <RadioGroup
                    value={selected}
                    onValueChange={(val) => setSelected(val as UserIdentifier)}
                    className="space-y-4"
                >
                    <div className="flex items-start gap-3 rounded-lg border p-4">
                        <RadioGroupItem value="EMAIL" id="identifier-email" className="mt-0.5" />
                        <div className="space-y-1">
                            <Label htmlFor="identifier-email" className="cursor-pointer font-semibold">
                                {t('options.email.label')}
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                {t('options.email.description')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 rounded-lg border p-4">
                        <RadioGroupItem value="PHONE" id="identifier-phone" className="mt-0.5" />
                        <div className="space-y-1">
                            <Label htmlFor="identifier-phone" className="cursor-pointer font-semibold">
                                {t('options.phone.label')}
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                {t('options.phone.description')}
                            </p>
                        </div>
                    </div>
                </RadioGroup>

                <div className="flex justify-end border-t pt-4">
                    <MyButton
                        buttonType="primary"
                        onClick={() => mutation.mutate(selected)}
                        disabled={mutation.isPending}
                    >
                        {mutation.isPending ? t('saveButton.saving') : t('saveButton.save')}
                    </MyButton>
                </div>
            </CardContent>
        </Card>
    );
}
