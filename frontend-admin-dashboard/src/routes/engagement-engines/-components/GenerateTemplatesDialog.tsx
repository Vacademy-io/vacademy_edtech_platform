import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { GenerateMode, GenerateOptions, TemplateLanguage } from '../-types/templates';

const PURPOSE_KEYS = [
    'firstTouch',
    'followUp',
    'missedClass',
    'reEngage',
    'reminder',
    'eventInvite',
    'custom',
] as const;
type PurposeKey = (typeof PURPOSE_KEYS)[number];

const LANGUAGES: TemplateLanguage[] = ['en', 'hi', 'hinglish'];

/**
 * "Generate with AI" options shared by WhatsApp and email templates: purpose, how many, language,
 * and an optional steer. For REGENERATE the count is fixed at one.
 */
export function GenerateTemplatesDialog({
    channel,
    mode,
    defaultLanguage,
    busy,
    onClose,
    onGenerate,
}: {
    channel: 'WHATSAPP' | 'EMAIL';
    mode: GenerateMode;
    defaultLanguage?: string;
    busy: boolean;
    onClose: () => void;
    onGenerate: (options: GenerateOptions) => void;
}) {
    const { t } = useTranslation('engagementEnginesTemplates');
    const maxCount = channel === 'WHATSAPP' ? 3 : 5;
    const [purposeKey, setPurposeKey] = useState<PurposeKey | ''>('');
    const [customPurpose, setCustomPurpose] = useState('');
    const [count, setCount] = useState(String(Math.min(3, maxCount)));
    const [language, setLanguage] = useState<TemplateLanguage>(
        LANGUAGES.includes(defaultLanguage as TemplateLanguage) ? (defaultLanguage as TemplateLanguage) : 'en'
    );
    const [feedback, setFeedback] = useState('');

    const purpose =
        purposeKey === 'custom' ? customPurpose.trim() : purposeKey ? t(`generate.purposes.${purposeKey}`) : '';
    const invalid = purposeKey === 'custom' && !customPurpose.trim();

    const heading =
        mode === 'REGENERATE'
            ? t('generate.headingRegenerate')
            : mode === 'MORE_LIKE_THIS'
              ? t('generate.headingMoreLikeThis')
              : t(channel === 'WHATSAPP' ? 'generate.headingWhatsapp' : 'generate.headingEmail');

    const submit = () =>
        onGenerate({
            purpose: purpose || undefined,
            count: mode === 'REGENERATE' ? 1 : Number(count),
            language,
            feedback: feedback.trim() || undefined,
        });

    return (
        <MyDialog heading={heading} open onOpenChange={(o) => !o && onClose()} dialogWidth="max-w-lg">
            <div className="flex flex-col gap-4 p-1">
                <p className="text-caption text-neutral-500">{t('generate.intro')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                        <label className="mb-1 block text-caption text-neutral-500">
                            {t('generate.purposeLabel')}
                        </label>
                        <Select value={purposeKey} onValueChange={(v) => setPurposeKey(v as PurposeKey)}>
                            <SelectTrigger aria-label={t('generate.purposeLabel')}>
                                <SelectValue placeholder={t('generate.purposeAny')} />
                            </SelectTrigger>
                            <SelectContent>
                                {PURPOSE_KEYS.map((k) => (
                                    <SelectItem key={k} value={k}>
                                        {t(`generate.purposes.${k}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {purposeKey === 'custom' && (
                            <Input
                                className="mt-2"
                                value={customPurpose}
                                maxLength={120}
                                placeholder={t('generate.customPlaceholder')}
                                onChange={(e) => setCustomPurpose(e.target.value)}
                            />
                        )}
                    </div>
                    {mode !== 'REGENERATE' && (
                        <div>
                            <label className="mb-1 block text-caption text-neutral-500">
                                {t('generate.countLabel')}
                            </label>
                            <Select value={count} onValueChange={setCount}>
                                <SelectTrigger aria-label={t('generate.countLabel')}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Array.from({ length: maxCount }, (_, i) => String(i + 1)).map((n) => (
                                        <SelectItem key={n} value={n}>
                                            {n}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div>
                        <label className="mb-1 block text-caption text-neutral-500">
                            {t('generate.languageLabel')}
                        </label>
                        <Select value={language} onValueChange={(v) => setLanguage(v as TemplateLanguage)}>
                            <SelectTrigger aria-label={t('generate.languageLabel')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {LANGUAGES.map((l) => (
                                    <SelectItem key={l} value={l}>
                                        {t(`generate.languages.${l}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div>
                    <label className="mb-1 block text-caption text-neutral-500">
                        {t('generate.feedbackLabel')}
                    </label>
                    <Textarea
                        rows={3}
                        value={feedback}
                        maxLength={500}
                        placeholder={t('generate.feedbackPlaceholder')}
                        onChange={(e) => setFeedback(e.target.value)}
                    />
                </div>
                <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
                    <MyButton buttonType="secondary" scale="small" onClick={onClose}>
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton buttonType="primary" scale="small" disable={busy || invalid} onClick={submit}>
                        <Sparkle className="me-1 size-4" />
                        {busy ? t('generate.generating') : t('generate.submit')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
}
