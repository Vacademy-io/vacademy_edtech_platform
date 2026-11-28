import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { CopyCheckConfig, LanguageFeedback } from '@/types/assessment-settings';

/** Longest marking instructions the AI is given (the server keeps the same cap). */
export const INSTRUCTIONS_MAX = 2000;

export interface CopyCheckSettingsValue {
    subject: string;
    level: string;
    instructions: string;
    languageFeedback: LanguageFeedback;
}

/** A test that has made no choice yet: no instructions, spelling and grammar check ON. */
export const EMPTY_COPY_CHECK_SETTINGS: CopyCheckSettingsValue = {
    subject: '',
    level: '',
    instructions: '',
    languageFeedback: 'HIGHLIGHT',
};

/** The value as sent with a batch; blanks clear the assessment's own setting. */
export const toCopyCheckConfig = (value: CopyCheckSettingsValue): CopyCheckConfig => ({
    subject: value.subject.trim() || null,
    level: value.level.trim() || null,
    instructions: value.instructions.trim() || null,
    language_feedback: value.languageFeedback,
});

/**
 * How the AI checks one test's copies: the subject and class it marks as, the
 * test's own marking instructions, and whether spelling and grammar errors are
 * highlighted with corrections (never deducted). All of it belongs to the test.
 * `withPaper` false leaves out the subject and class.
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
                    // Same size as the Subject / Class inputs above (the base Textarea is 16px on phones).
                    className="text-sm"
                    placeholder={t('aiSettings.instructionsPlaceholder')}
                    onChange={(e) => set({ instructions: e.target.value })}
                    disabled={disabled}
                />
                <span className="text-caption text-neutral-500">
                    {t('aiSettings.instructionsHint')}
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
 * The test's own settings, read each time the dialog opens (as last saved or
 * sent). A test that has made no choice gets no instructions and the spelling
 * and grammar check ON. Until they answer - or if they cannot - the fields hold
 * those defaults; what the teacher has typed is never overwritten.
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
        Promise.allSettled([load.current()]).then(([own]) => {
            if (cancelled || touched.current) return;
            const mine = own.status === 'fulfilled' ? own.value ?? {} : {};
            setValue({
                subject: mine.subject ?? '',
                level: mine.level ?? '',
                instructions: mine.instructions ?? '',
                languageFeedback:
                    mine.language_feedback ?? EMPTY_COPY_CHECK_SETTINGS.languageFeedback,
            });
        });
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
