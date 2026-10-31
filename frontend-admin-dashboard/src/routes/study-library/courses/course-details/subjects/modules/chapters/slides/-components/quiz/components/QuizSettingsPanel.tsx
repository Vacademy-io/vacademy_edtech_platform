import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';

export interface QuizSettings {
    timeLimitEnabled: boolean;
    timeLimitMinutes: number;
    marksPerQuestion: number;
    negativeMarkingEnabled: boolean;
    negativeMarking: number;
    partialMarking: boolean;
    passPercentageEnabled: boolean;
    passPercentage: number;
    reAttemptCountEnabled: boolean;
    reAttemptCount: number;
}

interface QuizSettingsPanelProps {
    settings: QuizSettings;
    onChange: (settings: QuizSettings) => void;
    onSave: () => void;
    isSaving: boolean;
}

const QuizSettingsPanel = ({ settings, onChange, onSave, isSaving }: QuizSettingsPanelProps) => {
    const { t } = useTranslation('studyLibraryQuizSettingsPanel');
    const update = (patch: Partial<QuizSettings>) => onChange({ ...settings, ...patch });

    return (
        <div className="flex flex-wrap items-center gap-4 border-b border-neutral-200 bg-neutral-50 px-6 py-3 text-sm">
            {/* Time Limit */}
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    id="qs-time-limit"
                    className="accent-primary-500"
                    checked={settings.timeLimitEnabled}
                    onChange={(e) => update({ timeLimitEnabled: e.target.checked })}
                />
                <label htmlFor="qs-time-limit" className="font-medium text-neutral-700 select-none cursor-pointer">
                    {t('timeLimit')}
                </label>
                {settings.timeLimitEnabled && (
                    <div className="flex items-center gap-1">
                        <MyInput
                            inputType="number"
                            input={String(settings.timeLimitMinutes)}
                            onChangeFunction={(e) =>
                                update({ timeLimitMinutes: Math.max(1, parseInt(e.target.value) || 1) })
                            }
                            className="!w-16 text-center"
                            inputPlaceholder="30"
                        />
                        <span className="text-neutral-500">{t('minutesAbbrev')}</span>
                    </div>
                )}
            </div>

            <div className="h-4 w-px bg-neutral-300" />

            {/* Marks per Question */}
            <div className="flex items-center gap-2">
                <label className="font-medium text-neutral-700">{t('marksPerQuestion')}</label>
                <MyInput
                    inputType="number"
                    input={String(settings.marksPerQuestion)}
                    onChangeFunction={(e) =>
                        update({ marksPerQuestion: Math.max(0.25, parseFloat(e.target.value) || 1) })
                    }
                    className="!w-16 text-center"
                    inputPlaceholder="1"
                />
            </div>

            <div className="h-4 w-px bg-neutral-300" />

            {/* Negative Marking */}
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    id="qs-neg-marking"
                    className="accent-primary-500"
                    checked={settings.negativeMarkingEnabled}
                    onChange={(e) => update({ negativeMarkingEnabled: e.target.checked })}
                />
                <label htmlFor="qs-neg-marking" className="font-medium text-neutral-700 select-none cursor-pointer">
                    {t('negativeMarking')}
                </label>
                {settings.negativeMarkingEnabled && (
                    <MyInput
                        inputType="number"
                        input={String(settings.negativeMarking)}
                        onChangeFunction={(e) =>
                            update({ negativeMarking: Math.max(0, parseFloat(e.target.value) || 0) })
                        }
                        className="!w-16 text-center"
                        inputPlaceholder="0.25"
                    />
                )}
            </div>

            <div className="h-4 w-px bg-neutral-300" />

            {/* Partial Marking — multiple-correct questions earn a share per correct option */}
            <div className="flex items-center gap-2" title={t('partialMarkingHint')}>
                <input
                    type="checkbox"
                    id="qs-partial-marking"
                    className="accent-primary-500"
                    checked={settings.partialMarking}
                    onChange={(e) => update({ partialMarking: e.target.checked })}
                />
                <label htmlFor="qs-partial-marking" className="font-medium text-neutral-700 select-none cursor-pointer">
                    {t('partialMarking')}
                </label>
            </div>

            <div className="h-4 w-px bg-neutral-300" />

            {/* Pass Percentage */}
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    id="qs-pass-pct"
                    className="accent-primary-500"
                    checked={settings.passPercentageEnabled}
                    onChange={(e) => update({ passPercentageEnabled: e.target.checked })}
                />
                <label htmlFor="qs-pass-pct" className="font-medium text-neutral-700 select-none cursor-pointer">
                    {t('passPercentage')}
                </label>
                {settings.passPercentageEnabled && (
                    <div className="flex items-center gap-1">
                        <MyInput
                            inputType="number"
                            input={String(settings.passPercentage)}
                            onChangeFunction={(e) =>
                                update({ passPercentage: Math.min(100, Math.max(1, parseInt(e.target.value) || 50)) })
                            }
                            className="!w-16 text-center"
                            inputPlaceholder="50"
                        />
                        <span className="text-neutral-500">%</span>
                    </div>
                )}
            </div>

            <div className="h-4 w-px bg-neutral-300" />

            {/* Re-attempt Count */}
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    id="qs-reattempt"
                    className="accent-primary-500"
                    checked={settings.reAttemptCountEnabled}
                    onChange={(e) => update({ reAttemptCountEnabled: e.target.checked })}
                />
                <label htmlFor="qs-reattempt" className="font-medium text-neutral-700 select-none cursor-pointer">
                    {t('attempts')}
                </label>
                {settings.reAttemptCountEnabled && (
                    <MyInput
                        inputType="number"
                        input={String(settings.reAttemptCount)}
                        onChangeFunction={(e) =>
                            update({ reAttemptCount: Math.max(1, parseInt(e.target.value) || 1) })
                        }
                        className="!w-16 text-center"
                        inputPlaceholder="3"
                    />
                )}
            </div>

            <div className="ml-auto">
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="small"
                    layoutVariant="default"
                    onClick={onSave}
                    disabled={isSaving}
                >
                    {isSaving ? t('savingEllipsis') : t('saveSettings')}
                </MyButton>
            </div>
        </div>
    );
};

export default QuizSettingsPanel;
