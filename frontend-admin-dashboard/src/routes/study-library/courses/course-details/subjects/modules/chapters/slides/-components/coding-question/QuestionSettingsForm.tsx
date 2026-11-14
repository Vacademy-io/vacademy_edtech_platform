import { useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { LANGUAGE_REGISTRY, ALL_LANG_IDS, type LangId } from '../constants/code-editor';
import type { CodingQuestionConfig } from '../utils/code-editor-types';
import { useTranslation } from 'react-i18next';

interface Props {
    question: CodingQuestionConfig;
    onChange: (next: CodingQuestionConfig) => void;
    disabled?: boolean;
}

export function QuestionSettingsForm({ question, onChange, disabled }: Props) {
    const { t } = useTranslation('studyLibraryQuestionSettingsForm');
    const toggleLang = useCallback(
        (lang: LangId, checked: boolean) => {
            let next = checked
                ? Array.from(new Set([...question.allowedLanguages, lang]))
                : question.allowedLanguages.filter((l) => l !== lang);
            // Always keep at least one language enabled.
            if (next.length === 0) next = [lang];
            onChange({ ...question, allowedLanguages: next });
        },
        [question, onChange]
    );

    const setNumber = useCallback(
        (key: 'sessionTimeMinutes' | 'maxPoints', raw: string) => {
            const v = raw.trim() === '' ? null : Number(raw);
            if (key === 'sessionTimeMinutes') {
                onChange({
                    ...question,
                    sessionTimeMinutes: v === null || Number.isNaN(v) || v <= 0 ? null : v,
                });
            } else {
                onChange({
                    ...question,
                    maxPoints: v === null || Number.isNaN(v) || v < 0 ? 0 : v,
                });
            }
        },
        [question, onChange]
    );

    const setLimit = useCallback(
        (key: 'cpuSeconds' | 'memoryKb', raw: string) => {
            const v = Number(raw);
            if (Number.isNaN(v) || v <= 0) return;
            onChange({
                ...question,
                perRunLimits: { ...question.perRunLimits, [key]: v },
            });
        },
        [question, onChange]
    );

    return (
        <div className="space-y-5">
            <section>
                <Label className="mb-2 block text-sm font-semibold">{t('allowedLanguages.label')}</Label>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {ALL_LANG_IDS.map((lang) => {
                        const def = LANGUAGE_REGISTRY[lang];
                        const checked = question.allowedLanguages.includes(lang);
                        return (
                            <label
                                key={lang}
                                className="flex cursor-pointer items-center gap-2 rounded border p-2 hover:bg-accent"
                            >
                                <Checkbox
                                    checked={checked}
                                    onCheckedChange={(v) => toggleLang(lang, v === true)}
                                    disabled={disabled}
                                />
                                <span className="flex-1 text-sm">{def.label}</span>
                                <Badge variant="outline" className="text-[10px]">
                                    {def.executor}
                                </Badge>
                            </label>
                        );
                    })}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                    {t('allowedLanguages.runtimeNote')}
                </p>
            </section>

            <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                    <Label className="text-sm font-semibold">{t('sessionTimer.label')}</Label>
                    <Input
                        type="number"
                        min={0}
                        value={question.sessionTimeMinutes ?? ''}
                        placeholder={t('sessionTimer.placeholder')}
                        onChange={(e) => setNumber('sessionTimeMinutes', e.target.value)}
                        disabled={disabled}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                        {t('sessionTimer.hint')}
                    </p>
                </div>
                <div>
                    <Label className="text-sm font-semibold">{t('maxPoints.label')}</Label>
                    <Input
                        type="number"
                        min={0}
                        value={question.maxPoints}
                        onChange={(e) => setNumber('maxPoints', e.target.value)}
                        disabled={disabled}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                        {t('maxPoints.hint')}
                    </p>
                </div>
            </section>

            <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                    <Label className="text-sm font-semibold">{t('cpuTime.label')}</Label>
                    <Input
                        type="number"
                        min={1}
                        max={20}
                        step={0.5}
                        value={question.perRunLimits.cpuSeconds}
                        onChange={(e) => setLimit('cpuSeconds', e.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div>
                    <Label className="text-sm font-semibold">{t('memory.label')}</Label>
                    <Input
                        type="number"
                        min={16_000}
                        step={1000}
                        value={question.perRunLimits.memoryKb}
                        onChange={(e) => setLimit('memoryKb', e.target.value)}
                        disabled={disabled}
                    />
                </div>
            </section>
        </div>
    );
}
