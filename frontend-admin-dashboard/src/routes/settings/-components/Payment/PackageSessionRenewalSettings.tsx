/**
 * Institute-level payment behaviour — the PAYMENT_SETTING.data toggles.
 *
 * Both flags live in the SAME settings blob, which is why they share one card and
 * one Save button: two cards each PUTting the whole blob would silently revert
 * each other's flag.
 *
 *  - packageSessionRenewalSchedulerEnabled — opts the institute into the daily
 *    package-session renewal/expiry scan (PackageSessionScheduler, 04:00).
 *  - planChangeEnabled — master switch for learner-facing plan switching. Off means
 *    learners never see a "change plan" affordance, whatever the per-option and
 *    per-plan flags say; those decide WHICH plans are switchable, this decides
 *    whether the feature is exposed at all.
 *
 * Everything here is opt-IN: an absent flag means off.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import { ArrowsClockwise } from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useTranslation } from 'react-i18next';

const SETTING_KEY = 'PAYMENT_SETTING';
const RENEWAL_FLAG = 'packageSessionRenewalSchedulerEnabled';
const PLAN_CHANGE_FLAG = 'planChangeEnabled';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

type PaymentSettingData = Record<string, unknown>;

const fetchPaymentSetting = async (): Promise<PaymentSettingData> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: SETTING_KEY },
    });
    // GET returns the SettingDto ({key, name, data}); its content sits one
    // level down at response.data.data (same as OnboardingSettings.tsx).
    return (response.data?.data as PaymentSettingData) ?? {};
};

// Saves the WHOLE data object (current state with the toggled flag patched in)
// so any other PAYMENT_SETTING fields added later are preserved on save.
const savePaymentSetting = async (data: PaymentSettingData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Payment Setting', setting_data: data },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

export default function PackageSessionRenewalSettings() {
    const { t } = useTranslation('settingsPackageSessionRenewal');
    const queryClient = useQueryClient();
    const [settingData, setSettingData] = useState<PaymentSettingData>({});
    const [hasChanges, setHasChanges] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['payment-setting'],
        queryFn: fetchPaymentSetting,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (data) {
            setSettingData(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: savePaymentSetting,
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['payment-setting'] });
        },
        onError: () => {
            toast.error(t('toasts.saveError'));
        },
    });

    const enabled = settingData[RENEWAL_FLAG] === true;
    const planChangeEnabled = settingData[PLAN_CHANGE_FLAG] === true;

    const handleToggle = (value: boolean) => {
        setSettingData((prev) => ({ ...prev, [RENEWAL_FLAG]: value }));
        setHasChanges(true);
    };

    const handlePlanChangeToggle = (value: boolean) => {
        setSettingData((prev) => ({ ...prev, [PLAN_CHANGE_FLAG]: value }));
        setHasChanges(true);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <ArrowsClockwise className="size-5" />
                    {t('title')}
                </CardTitle>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="text-body text-neutral-500">{t('loading')}</div>
                ) : (
                    <div className="space-y-4">
                        <div className="flex items-start gap-3">
                            <Switch
                                id="package-session-renewal-enabled"
                                checked={enabled}
                                onCheckedChange={handleToggle}
                            />
                            <div>
                                <Label
                                    htmlFor="package-session-renewal-enabled"
                                    className="cursor-pointer"
                                >
                                    {enabled ? t('toggle.enabled') : t('toggle.disabled')}
                                </Label>
                                <p className="mt-0.5 text-xs text-neutral-500">
                                    {t('renewal.hint')}
                                </p>
                            </div>
                        </div>

                        {/* Master switch for learner-facing plan switching. Off means the
                            "change plan" affordance never renders, whatever individual
                            options and plans are flagged as switchable. */}
                        <div className="flex items-start gap-3 border-t border-neutral-200 pt-4">
                            <Switch
                                id="plan-change-enabled"
                                checked={planChangeEnabled}
                                onCheckedChange={handlePlanChangeToggle}
                            />
                            <div>
                                <Label htmlFor="plan-change-enabled" className="cursor-pointer">
                                    {planChangeEnabled
                                        ? t('planChange.enabled')
                                        : t('planChange.disabled')}
                                </Label>
                                <p className="mt-0.5 text-xs text-neutral-500">
                                    {planChangeEnabled
                                        ? t('planChange.hintOn')
                                        : t('planChange.hintOff')}
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-end border-t border-neutral-200 pt-4">
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={() => save(settingData)}
                                disable={saving || !hasChanges}
                            >
                                {saving ? t('button.saving') : t('button.save')}
                            </MyButton>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
