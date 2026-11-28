import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkle, Warning } from '@phosphor-icons/react';
import { getInstituteId } from '@/constants/helper';
import { useEditPrompt } from '../-hooks';
import { useBriefCheck } from '../-hooks/templates';
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

// enquiryFollowUp / scheduleDemo come first: they read as UTILITY, which Meta's per-person
// marketing cap (error 131049) does not block.
const PURPOSE_KEYS = [
    'enquiryFollowUp',
    'scheduleDemo',
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
    engineId,
    channel,
    mode,
    defaultLanguage,
    busy,
    onClose,
    onGenerate,
}: {
    engineId: string;
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
    // W1: a thin brief gets specific questions; the answers are added to the brief as an amendment,
    // because the AI may only use facts and links that are in the brief.
    const qc = useQueryClient();
    const brief = useBriefCheck(engineId);
    const amend = useEditPrompt();
    const [answers, setAnswers] = useState<Record<number, string>>({});
    const answered = Object.values(answers).some((a) => a.trim());
    const addAnswers = () => {
        const qs = brief.data?.questions ?? [];
        const text = qs
            .map((q, i) => (answers[i]?.trim() ? `${q}\n${answers[i]!.trim()}` : ''))
            .filter(Boolean)
            .join('\n\n');
        if (!text) return;
        amend.mutate(
            { engineId, deltaText: text },
            {
                onSuccess: () => {
                    setAnswers({});
                    qc.invalidateQueries({
                        queryKey: ['engagementBriefCheck', getInstituteId() || '', engineId],
                    });
                },
            }
        );
    };

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
                {brief.data?.weak && (
                    <div className="flex flex-col gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3">
                        <p className="flex items-start gap-2 text-warning-700">
                            <Warning size={16} className="mt-0.5 shrink-0" />
                            <span className="text-caption">{t('brief.weak')}</span>
                        </p>
                        {brief.data.questions.map((q, i) => (
                            <div key={q} className="flex flex-col gap-1">
                                <label className="text-caption text-neutral-700">{q}</label>
                                <Input
                                    value={answers[i] ?? ''}
                                    maxLength={500}
                                    onChange={(e) => setAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                                />
                            </div>
                        ))}
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            className="w-fit"
                            disable={!answered || amend.isPending}
                            onClick={addAnswers}
                        >
                            {amend.isPending ? t('brief.adding') : t('brief.addToBrief')}
                        </MyButton>
                    </div>
                )}
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
