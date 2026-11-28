import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { EvalezyScanQuality, EvalezySettings } from '@/types/assessment-settings';

interface ToggleRowProps {
    label: string;
    description: string;
    checked: boolean;
    disabled?: boolean;
    onCheckedChange: (checked: boolean) => void;
}

const ToggleRow = ({ label, description, checked, disabled, onCheckedChange }: ToggleRowProps) => (
    <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
            <Label className="text-body font-medium">{label}</Label>
            <p className="text-caption text-neutral-500">{description}</p>
        </div>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
);

/** How copies get into Evalezy: the camera, uploads, scan quality, and the mail when checked. */
export const EvalezyCopySettings = ({
    settings,
    onChange,
    disabled,
}: {
    settings: EvalezySettings;
    onChange: (next: EvalezySettings) => void;
    disabled?: boolean;
}) => {
    const { t } = useTranslation('settingsEvalezyCard');
    const patch = (next: Partial<EvalezySettings>) => onChange({ ...settings, ...next });

    return (
        <div className="flex flex-col gap-4">
            <ToggleRow
                label={t('camera.label')}
                description={t('camera.description')}
                checked={settings.allowCamera}
                disabled={disabled}
                onCheckedChange={(allowCamera) => patch({ allowCamera })}
            />
            <ToggleRow
                label={t('upload.label')}
                description={t('upload.description')}
                checked={settings.allowUpload}
                disabled={disabled}
                onCheckedChange={(allowUpload) => patch({ allowUpload })}
            />
            <ToggleRow
                label={t('notifyEmail.label')}
                description={t('notifyEmail.description')}
                checked={settings.notifyEmail}
                disabled={disabled}
                onCheckedChange={(notifyEmail) => patch({ notifyEmail })}
            />
            <div className="flex flex-col gap-2">
                <Label className="text-body font-medium">{t('quality.label')}</Label>
                <p className="text-caption text-neutral-500">{t('quality.description')}</p>
                <Select
                    value={settings.scanQuality}
                    disabled={disabled}
                    onValueChange={(scanQuality) =>
                        patch({ scanQuality: scanQuality as EvalezyScanQuality })
                    }
                >
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="STANDARD">{t('quality.standard')}</SelectItem>
                        <SelectItem value="HIGH">{t('quality.high')}</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
};
