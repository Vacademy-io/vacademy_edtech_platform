import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * Global Settings → Course page (globalSettings.courseDetails): which parts of
 * a course's public page show. Every part is on by default, so only `false` is
 * stored; other courseDetails keys (layout, appBanner…) are kept as they are.
 */

const isObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

/** The parts this card switches, as courseDetails keys. */
const PARTS = ['content', 'contentHeading', 'series'] as const;
type Part = (typeof PARTS)[number];

/** courseDetails.seriesLimit: how many "Part of" chips show, 1–SERIES_LIMIT_MAX; empty = all. */
const SERIES_LIMIT_MAX = 50;
const storedLimit = (v: unknown): string =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 ? String(v) : '';

interface CoursePageSettingsCardProps {
    value: unknown;
    onChange: (next: Record<string, unknown>) => void;
}

export const CoursePageSettingsCard = ({ value, onChange }: CoursePageSettingsCardProps) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const current = isObject(value) ? value : {};
    const [limitText, setLimitText] = useState(() => storedLimit(current.seriesLimit));

    const setPart = (part: Part, on: boolean) => {
        // On is the default: drop the key rather than store `true`.
        const rest = { ...current };
        delete rest[part];
        onChange(on ? rest : { ...rest, [part]: false });
    };

    const setLimit = (text: string) => {
        const digits = text.replace(/\D/g, '').slice(0, 2);
        setLimitText(digits);
        const n = Number(digits);
        const rest = { ...current };
        delete rest.seriesLimit;
        // Empty or out of range: every step shows (no key stored).
        onChange(digits && n >= 1 && n <= SERIES_LIMIT_MAX ? { ...rest, seriesLimit: n } : rest);
    };

    return (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <h4 className="font-medium text-neutral-700">{t('global.coursePage.heading')}</h4>
            <p className="text-caption text-neutral-500">{t('global.coursePage.hint')}</p>
            {PARTS.map((part) => {
                const id = `course-page-${part}`;
                return (
                    <div key={part} className="flex items-start justify-between gap-3">
                        <div>
                            <Label htmlFor={id} className="text-xs font-medium">
                                {t(`global.coursePage.${part}`)}
                            </Label>
                            <p className="text-caption text-neutral-500">
                                {t(`global.coursePage.${part}Hint`)}
                            </p>
                        </div>
                        <Switch
                            id={id}
                            checked={current[part] !== false}
                            onCheckedChange={(on) => setPart(part, on)}
                        />
                    </div>
                );
            })}
            {current.series !== false && (
                <div className="space-y-1">
                    <Label htmlFor="course-page-series-limit" className="text-xs font-medium">
                        {t('global.coursePage.seriesLimit')}
                    </Label>
                    <Input
                        id="course-page-series-limit"
                        type="text"
                        inputMode="numeric"
                        value={limitText}
                        placeholder={t('global.coursePage.seriesLimitAll')}
                        onChange={(e) => setLimit(e.target.value)}
                        aria-describedby="course-page-series-limit-hint"
                        className="w-32"
                    />
                    <p id="course-page-series-limit-hint" className="text-caption text-neutral-500">
                        {t('global.coursePage.seriesLimitHint')}
                    </p>
                </div>
            )}
        </div>
    );
};
