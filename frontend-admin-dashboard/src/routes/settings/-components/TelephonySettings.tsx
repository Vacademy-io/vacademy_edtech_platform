import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Phone } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { TelephonyProviderCards } from '@/routes/settings/telephony/-components/telephony-provider-cards';

/**
 * Settings → Calling tab. Thin shell around the provider-aware tabbed cards that
 * live under routes/settings/telephony/-components — same components, just
 * rendered inside the unified Settings page tab framework instead of as a
 * standalone route. Which tabs show depends on the active provider's
 * capabilities (see TelephonyProviderCards).
 */
export default function TelephonySettings() {
    const { t } = useTranslation('settingsTelephony');
    const navigate = useNavigate();
    return (
        <div className="flex w-full flex-col gap-5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-900">{t('title')}</h1>
                    <p className="text-sm text-neutral-500">{t('description')}</p>
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => navigate({ to: '/audience-manager/call-log' })}
                >
                    <Phone className="mr-1" /> {t('openCallLog')}
                </MyButton>
            </div>
            <TelephonyProviderCards />
        </div>
    );
}
