import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getAssessmentSettings } from '@/services/assessment-settings';
import type { CopyCheckConfig, LanguageFeedback } from '@/types/assessment-settings';

/** Longest marking instructions the AI is given (the server keeps the same cap). */
export const INSTRUCTIONS_MAX = 2000;

export interface CopyCheckSettingsValue {
    subject: string;
    level: string;
    instructions: string;
    languageFeedback: LanguageFeedback;
}

export const EMPTY_COPY_CHECK_SETTINGS: CopyCheckSettingsValue = {
    subject: '',
    level: '',
    instructions: '',
    languageFeedback: 'OFF',
};

/** The value as sent with a batch; blanks clear the assessment's own setting. */
export const toCopyCheckConfig = (value: CopyCheckSettingsValue): CopyCheckConfig => ({
    subject: value.subject.trim() || null,
    level: value.level.trim() || null,
    instructions: value.instructions.trim() || null,
    language_feedback: value.languageFeedback,
});

/**
 * How the AI checks the copies: the subject and class it marks as, the
 * institute's own marking instructions, and whether spelling and grammar
 * errors are highlighted with corrections (never deducted). `withPaper` adds
 * the subject and class, which belong to one assessment, not to the institute.
 */
export const CopyCheckSettingsFields = ({
    value,
    onChange,
    disabled,
    withPaper = true,
}: {
    value: CopyCheckSettingsValue;
    onChange: (value: CopyCheckSettingsValue) => void;
    disabled?: boolean;
    withPaper?: boolean;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const set = (patch: Partial<CopyCheckSettingsValue>) => onChange({ ...value, ...patch });
    return (
        <div className="flex flex-col gap-3">
            {withPaper && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                        <span className="text-body font-medium text-neutral-800">
                            {t('aiSettings.subject')}
                        </span>
                        <Input
                            value={value.subject}
                            maxLength={60}
                            placeholder={t('aiSettings.subjectPlaceholder')}
                            onChange={(e) => set({ subject: e.target.value })}
                            disabled={disabled}
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-body font-medium text-neutral-800">
                            {t('aiSettings.level')}
                        </span>
                        <Input
                            value={value.level}
                            maxLength={60}
                            placeholder={t('aiSettings.levelPlaceholder')}
                            onChange={(e) => set({ level: e.target.value })}
                            disabled={disabled}
                        />
                    </label>
                </div>
            )}
            <label className="flex flex-col gap-1">
                <span className="text-body font-medium text-neutral-800">
                    {t('aiSettings.instructions')}
                </span>
                <Textarea
                    value={value.instructions}
                    maxLength={INSTRUCTIONS_MAX}
                    rows={4}
                    placeholder={t('aiSettings.instructionsPlaceholder')}
                    onChange={(e) => set({ instructions: e.target.value })}
                    disabled={disabled}
                />
                <span className="text-caption text-neutral-500">
                    {withPaper
                        ? t('aiSettings.instructionsHint')
                        : t('aiSettings.instructionsDefaultHint')}
                    {' · '}
                    {value.instructions.length}/{INSTRUCTIONS_MAX}
                </span>
            </label>
            <label className="flex items-start justify-between gap-3 rounded-md border border-neutral-200 p-3">
                <span className="flex flex-col">
                    <span className="text-body font-medium text-neutral-800">
                        {t('aiSettings.language')}
                    </span>
                    <span className="text-caption text-neutral-500">
                        {t('aiSettings.languageHint')}
                    </span>
                </span>
                <Switch
                    checked={value.languageFeedback === 'HIGHLIGHT'}
                    onCheckedChange={(on) => set({ languageFeedback: on ? 'HIGHLIGHT' : 'OFF' })}
                    disabled={disabled}
                />
            </label>
        </div>
    );
};

/**
 * The settings for a batch, each time the dialog opens: the assessment's own
 * (as last sent), with the institute's instructions and language choice
 * (Settings → Assessment) where it has none. Until those answer - or if they
 * cannot - the fields are empty; what the teacher has typed is never overwritten.
 */
export const useCopyCheckSettings = (
    open: boolean,
    loadAssessmentConfig: () => Promise<CopyCheckConfig>
): [CopyCheckSettingsValue, (value: CopyCheckSettingsValue) => void] => {
    const [value, setValue] = useState<CopyCheckSettingsValue>(EMPTY_COPY_CHECK_SETTINGS);
    const touched = useRef(false);
    const load = useRef(loadAssessmentConfig);
    load.current = loadAssessmentConfig;

    useEffect(() => {
        if (!open) return;
        touched.current = false;
        setValue(EMPTY_COPY_CHECK_SETTINGS);
        let cancelled = false;
        Promise.allSettled([load.current(), getAssessmentSettings(true)]).then(
            ([own, institute]) => {
                if (cancelled || touched.current) return;
                const mine = own.status === 'fulfilled' ? own.value ?? {} : {};
                const defaults =
                    institute.status === 'fulfilled' ? institute.value.aiCopyCheck : undefined;
                setValue({
                    subject: mine.subject ?? '',
                    level: mine.level ?? '',
                    instructions: mine.instructions ?? defaults?.instructions ?? '',
                    languageFeedback: mine.language_feedback ?? defaults?.languageFeedback ?? 'OFF',
                });
            }
        );
        return () => {
            cancelled = true;
        };
    }, [open]);

    const choose = (next: CopyCheckSettingsValue) => {
        touched.current = true;
        setValue(next);
    };
    return [value, choose];
};

export default CopyCheckSettingsFields;
