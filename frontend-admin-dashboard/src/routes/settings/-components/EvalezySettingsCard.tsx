import { useTranslation } from 'react-i18next';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { EvalezyScanQuality, EvalezySettings } from '@/types/assessment-settings';

/** Where admins open Evalezy on the web; the mobile app deep-links the same host. */
export const EVALEZY_WEB_URL = 'https://evalezy.vacademy.io';

interface ToggleRowProps {
    label: string;
    description: string;
    checked: boolean;
    disabled?: boolean;
    onCheckedChange: (checked: boolean) => void;
}

const ToggleRow = ({ label, description, checked, disabled, onCheckedChange }: ToggleRowProps) => (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="flex flex-col gap-1">
            <Label className="text-sm font-medium">{label}</Label>
            <p className="text-xs text-gray-500">{description}</p>
        </div>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
);

/**
 * Settings → Assessment → Evalezy app. The institute's whole control over the
 * simple copy-check app: whether its admins may use it, how copies get in, and
 * the scan size. How the AI marks comes from the AI copy checking card above.
 */
const EvalezySettingsCard = ({
    settings,
    onChange,
}: {
    settings: EvalezySettings;
    onChange: (next: EvalezySettings) => void;
}) => {
    const { t } = useTranslation('settingsEvalezyCard');
    const patch = (next: Partial<EvalezySettings>) => onChange({ ...settings, ...next });
    const off = !settings.enabled;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t('header.title')}</CardTitle>
                <CardDescription>
                    {t('header.description')}{' '}
                    <a
                        href={EVALEZY_WEB_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary-500 hover:underline"
                    >
                        {t('header.open')}
                        <ArrowSquareOut size={14} />
                    </a>
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <ToggleRow
                    label={t('enabled.label')}
                    description={t('enabled.description')}
                    checked={settings.enabled}
                    onCheckedChange={(enabled) => patch({ enabled })}
                />
                <ToggleRow
                    label={t('camera.label')}
                    description={t('camera.description')}
                    checked={settings.allowCamera}
                    disabled={off}
                    onCheckedChange={(allowCamera) => patch({ allowCamera })}
                />
                <ToggleRow
                    label={t('upload.label')}
                    description={t('upload.description')}
                    checked={settings.allowUpload}
                    disabled={off}
                    onCheckedChange={(allowUpload) => patch({ allowUpload })}
                />
                <ToggleRow
                    label={t('notifyEmail.label')}
                    description={t('notifyEmail.description')}
                    checked={settings.notifyEmail}
                    disabled={off}
                    onCheckedChange={(notifyEmail) => patch({ notifyEmail })}
                />
                <div className="flex flex-col gap-2 rounded-lg border p-4">
                    <Label className="text-sm font-medium">{t('quality.label')}</Label>
                    <p className="text-xs text-gray-500">{t('quality.description')}</p>
                    <Select
                        value={settings.scanQuality}
                        disabled={off}
                        onValueChange={(scanQuality) =>
                            patch({ scanQuality: scanQuality as EvalezyScanQuality })
                        }
                    >
                        <SelectTrigger className="w-full max-w-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="STANDARD">{t('quality.standard')}</SelectItem>
                            <SelectItem value="HIGH">{t('quality.high')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
    );
};

export default EvalezySettingsCard;
