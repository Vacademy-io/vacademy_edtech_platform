import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AndroidLogo, AppleLogo, CaretLeft, DeviceMobile } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { cn } from '@/lib/utils';
import { requestAdminAppLink, type AdminAppPlatform } from '@/services/adminApp';

/**
 * "Get the Admin app" flow launched from the Assist Dock rail. Two steps:
 * pick a platform (Android / iOS), then enter a phone number to which the
 * store link is sent over WhatsApp (from the Vidyayatan account).
 */
export function AdminAppViewer({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation('adminAppViewer');
    const [platform, setPlatform] = useState<AdminAppPlatform | null>(null);
    const [phone, setPhone] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);

    // Reset the flow whenever the dialog is (re)opened.
    useEffect(() => {
        if (open) {
            setPlatform(null);
            setPhone('');
            setError(null);
            setSending(false);
        }
    }, [open]);

    // Meta wants the number in international format, digits only. Assume India
    // (+91) for bare 10-digit inputs; otherwise use the digits as entered.
    const normalizePhone = (raw: string): string | null => {
        const digits = raw.replace(/[^\d]/g, '');
        if (digits.length === 10) return `91${digits}`;
        if (digits.length >= 11 && digits.length <= 15) return digits;
        return null;
    };

    const handleSend = async () => {
        if (!platform) return;
        const normalized = normalizePhone(phone);
        if (!normalized) {
            setError(t('invalidMobileNumber'));
            return;
        }
        setError(null);
        setSending(true);
        try {
            await requestAdminAppLink(platform, normalized);
            toast.success(t('linkSentToast'));
            onClose();
        } catch {
            toast.error(t('linkSendFailedToast'));
        } finally {
            setSending(false);
        }
    };

    const heading = platform ? t('sendTheAppLink') : t('getTheAdminApp');

    return (
        <MyDialog
            heading={heading}
            open={open}
            onOpenChange={(v) => !v && onClose()}
            dialogWidth="max-w-md"
        >
            {!platform ? (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col items-center gap-2 text-center">
                        <span className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                            <DeviceMobile size={26} weight="duotone" />
                        </span>
                        <p className="text-body text-neutral-600">
                            {t('installAppDescription')}
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <PlatformChoice
                            label={t('android')}
                            icon={<AndroidLogo size={28} weight="duotone" />}
                            onClick={() => setPlatform('ANDROID')}
                        />
                        <PlatformChoice
                            label={t('ios')}
                            icon={<AppleLogo size={28} weight="duotone" />}
                            onClick={() => setPlatform('IOS')}
                        />
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2 rounded-md bg-primary-50 px-3 py-2 text-primary-600">
                        {platform === 'ANDROID' ? (
                            <AndroidLogo size={20} weight="duotone" />
                        ) : (
                            <AppleLogo size={20} weight="duotone" />
                        )}
                        <span className="text-body font-medium">
                            {t('appNameSuffix', {
                                platformName: platform === 'ANDROID' ? t('android') : t('ios'),
                            })}
                        </span>
                    </div>
                    <MyInput
                        inputType="tel"
                        label={t('mobileNumberLabel')}
                        required
                        input={phone}
                        onChangeFunction={(e) => {
                            setPhone(e.target.value);
                            if (error) setError(null);
                        }}
                        inputPlaceholder={t('mobileNumberPlaceholder')}
                        error={error}
                        className="w-full"
                    />
                    <p className="text-caption text-neutral-500">{t('sendOverWhatsappNote')}</p>
                    <div className="flex items-center justify-between gap-3 pt-1">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => {
                                setPlatform(null);
                                setError(null);
                            }}
                            disable={sending}
                        >
                            <span className="flex items-center gap-1">
                                <CaretLeft size={14} /> {t('back')}
                            </span>
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={handleSend}
                            disable={sending || phone.trim().length === 0}
                        >
                            {sending ? t('sending') : t('sendLink')}
                        </MyButton>
                    </div>
                </div>
            )}
        </MyDialog>
    );
}

function PlatformChoice({
    label,
    icon,
    onClick,
}: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex flex-1 flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-5 text-neutral-600 transition-colors',
                'hover:border-primary-500 hover:bg-primary-50/40 hover:text-primary-600'
            )}
        >
            {icon}
            <span className="text-body font-medium">{label}</span>
        </button>
    );
}
