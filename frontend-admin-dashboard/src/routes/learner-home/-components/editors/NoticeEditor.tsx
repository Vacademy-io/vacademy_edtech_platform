import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { CheckIssue, NoticeConfig, NoticeTone } from '../../-types/learner-home-types';
import { LIMITS } from '../../-utils/publish-checks';
import { ImageRefField } from '../shared/ImageRefField';
import { CtaEditor, SwitchField, TextField } from '../shared/fields';

const TONES: NoticeTone[] = ['NEUTRAL', 'INFO', 'SUCCESS', 'WARNING'];

export function NoticeEditor({
    blockKey,
    config,
    onChange,
    issues,
}: {
    blockKey: string;
    config: NoticeConfig;
    onChange: (next: NoticeConfig) => void;
    issues: CheckIssue[];
}) {
    const { t } = useTranslation('learnerHome');
    return (
        <div className="space-y-4">
            <TextField
                id={`${blockKey}-title`}
                label={t('notice.title')}
                value={config.title}
                onChange={(title) => onChange({ ...config, title })}
                max={LIMITS.notice.title}
                issues={issues}
                path="config.title"
            />
            <TextField
                id={`${blockKey}-body`}
                label={t('notice.body')}
                hint={t('notice.bodyHint')}
                value={config.body}
                onChange={(body) => onChange({ ...config, body })}
                max={LIMITS.notice.body}
                issues={issues}
                path="config.body"
                multiline
            />
            <ImageRefField
                id={`${blockKey}-img`}
                label={t('notice.image')}
                slot="card"
                value={config.image}
                onChange={(image) => onChange({ ...config, image })}
                issues={issues}
                path="config.image"
            />
            <CtaEditor
                id={`${blockKey}-button`}
                label={t('notice.button')}
                value={config.button}
                onChange={(button) => onChange({ ...config, button })}
                issues={issues}
                path="config.button"
                addLabel={t('notice.addButton')}
                removeLabel={t('notice.removeButton')}
            />
            <div className="space-y-1">
                <Label htmlFor={`${blockKey}-tone`}>{t('notice.tone')}</Label>
                <Select
                    value={config.tone}
                    onValueChange={(tone) => onChange({ ...config, tone: tone as NoticeTone })}
                >
                    <SelectTrigger id={`${blockKey}-tone`} className="w-56">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {TONES.map((tone) => (
                            <SelectItem key={tone} value={tone}>
                                {t(`notice.tones.${tone}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <SwitchField
                id={`${blockKey}-dismissible`}
                label={t('notice.dismissible')}
                checked={config.dismissible}
                onChange={(dismissible) => onChange({ ...config, dismissible })}
            />
            <SwitchField
                id={`${blockKey}-ack`}
                label={t('notice.requireAck')}
                hint={t('notice.requireAckHint')}
                checked={config.require_ack}
                onChange={(require_ack) => onChange({ ...config, require_ack })}
            />
            {config.require_ack && (
                <TextField
                    id={`${blockKey}-ack-label`}
                    label={t('notice.ackLabel')}
                    value={config.ack_label}
                    onChange={(ack_label) => onChange({ ...config, ack_label })}
                    max={LIMITS.notice.ackLabel}
                    issues={issues}
                    path="config.ack_label"
                />
            )}
        </div>
    );
}
