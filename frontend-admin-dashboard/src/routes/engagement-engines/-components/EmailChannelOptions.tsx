import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { DEFAULT_EMAIL_TYPE, type ChannelConfig, type EmailSender } from '../-types';
import { EMAIL_MODES, type EmailMode } from '../-types/templates';
import { useEmailSenders } from '../-hooks';

/** Unset = the default sender if the institute has it, else its first verified one, else its first. */
function defaultSender(senders: EmailSender[]): string | undefined {
    return (
        senders.find((s) => s.type === DEFAULT_EMAIL_TYPE)?.type ??
        senders.find((s) => s.verified)?.type ??
        senders[0]?.type
    );
}

/**
 * EMAIL-only settings in the create wizard: which of the institute's senders the mail goes out
 * from, how drafts are written (free, approved template only, or template plus one AI line), and
 * whether this engine writes to people who never contacted us (cold outreach — every template must
 * then tell people how to stop).
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
    const { data: senders = [], isLoading, isError } = useEmailSenders();

    // No sender chosen yet (new engine, or one saved before the picker): store the sender it
    // would use anyway, so the choice is visible and saved. A saved sender that is gone is left
    // alone — the card's setup banner asks for another one.
    useEffect(() => {
        if (value.emailType || !senders.length) return;
        const pick = defaultSender(senders);
        if (pick) onChange({ emailType: pick });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [senders, value.emailType]);

    const senderLabel = (s: EmailSender) => {
        const base = s.name ? `${s.name} (${s.email})` : s.email || s.type;
        return s.verified ? base : `${base} · ${t('wizard.senderNotVerified')}`;
    };

    return (
        <div className="flex flex-col gap-3 border-t border-neutral-200 pt-3">
            <div>
                <label className="mb-1 block font-medium text-neutral-700">
                    <span className="text-body">{t('wizard.senderTitle')}</span>
                </label>
                {isLoading ? (
                    <p className="text-neutral-500">
                        <span className="text-caption">{t('wizard.senderLoading')}</span>
                    </p>
                ) : isError ? (
                    <p className="text-danger-600" role="alert">
                        <span className="text-caption">{t('wizard.senderLoadFailed')}</span>
                    </p>
                ) : senders.length === 0 ? (
                    <p className="text-neutral-500">
                        <span className="text-caption">{t('wizard.senderEmpty')}</span>
                    </p>
                ) : (
                    <>
                        <Select
                            value={value.emailType ?? ''}
                            onValueChange={(v) => onChange({ emailType: v })}
                        >
                            <SelectTrigger aria-label={t('wizard.senderTitle')}>
                                <SelectValue placeholder={t('wizard.senderPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {senders.map((s) => (
                                    <SelectItem key={s.type} value={s.type}>
                                        {senderLabel(s)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="mt-1 text-neutral-500">
                            <span className="text-caption">{t('wizard.senderHint')}</span>
                        </p>
                    </>
                )}
            </div>
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
