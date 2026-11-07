import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    saveSubOrgAdminExitCascadeSetting,
    subOrgAdminExitCascadeQueryKey,
    useSubOrgAdminExitCascadeSetting,
} from '@/services/suborg-admin-exit-cascade-setting';

/** Whether a sub-org's staff lose access once its last active admin has left. Off by default. */
export default function SubOrgAdminExitCascadeSettings() {
    const { t } = useTranslation('settingsSubOrgAdminExitCascade');
    const queryClient = useQueryClient();
    const term = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);

    const { data: saved, isLoading } = useSubOrgAdminExitCascadeSetting();
    const [enabled, setEnabled] = useState(false);

    useEffect(() => {
        if (saved) setEnabled(saved.enabled);
    }, [saved]);

    const mutation = useMutation({
        mutationFn: saveSubOrgAdminExitCascadeSetting,
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            queryClient.invalidateQueries({ queryKey: subOrgAdminExitCascadeQueryKey() });
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message || t('toasts.saveError'));
        },
    });

    if (isLoading) return <div className="p-4">{t('loading')}</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{t('header.title', { term })}</CardTitle>
                <CardDescription>{t('header.description', { term })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                    <div className="space-y-1">
                        <Label htmlFor="suborg-admin-exit-cascade" className="font-semibold">
                            {t('enabled.label')}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            {t('enabled.description', { term })}
                        </p>
                    </div>
                    <Switch
                        id="suborg-admin-exit-cascade"
                        checked={enabled}
                        onCheckedChange={setEnabled}
                    />
                </div>

                <div className="flex justify-end border-t pt-4">
                    <MyButton
                        buttonType="primary"
                        onClick={() => mutation.mutate({ enabled })}
                        disabled={mutation.isPending}
                    >
                        {mutation.isPending ? t('saveButton.saving') : t('saveButton.save')}
                    </MyButton>
                </div>
            </CardContent>
        </Card>
    );
}
