import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { ChannelConfig } from '../-types';
import { EMAIL_MODES, type EmailMode } from '../-types/templates';

/**
 * EMAIL-only settings in the create wizard: how drafts are written (free, approved template only,
 * or template plus one AI line), and whether this engine writes to people who never contacted us
 * (cold outreach — every template must then tell people how to stop).
 */
export function EmailChannelOptions({
    value,
    onChange,
}: {
    value: ChannelConfig;
    onChange: (patch: Partial<ChannelConfig>) => void;
}) {
    const { t } = useTranslation('engagementEnginesTemplates');
    const mode: EmailMode = value.mode ?? 'FREE_WRITE';
    return (
        <div className="flex flex-col gap-3 border-t border-neutral-200 pt-3">
            <div>
                <label className="mb-1 block font-medium text-neutral-700">
                    <span className="text-body">{t('wizard.modeTitle')}</span>
                </label>
                <Select value={mode} onValueChange={(v) => onChange({ mode: v as EmailMode })}>
                    <SelectTrigger aria-label={t('wizard.modeTitle')}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {EMAIL_MODES.map((m) => (
                            <SelectItem key={m} value={m}>
                                {t(`wizard.modes.${m}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="mt-1 text-neutral-500">
                    <span className="text-caption">{t(`email.modes.${mode}`)}</span>
                </p>
            </div>
            <label className="flex items-start justify-between gap-3">
                <span className="flex flex-col">
                    <span className="font-medium text-neutral-700">
                        <span className="text-body">{t('wizard.coldTitle')}</span>
                    </span>
                    <span className="text-neutral-500">
                        <span className="text-caption">{t('wizard.coldHint')}</span>
                    </span>
                </span>
                <Switch
                    aria-label={t('wizard.coldTitle')}
                    checked={!!value.coldOutreach}
                    onCheckedChange={(v) => onChange({ coldOutreach: v })}
                />
            </label>
        </div>
    );
}
