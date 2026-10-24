import { useEffect, useId, useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ColorPickerField } from '../ColorPickerField';

/** globalSettings.theme as stored: hand- or AI-written JSON. */
type Theme = Record<string, unknown>;

export interface SitePaletteCardProps {
    /**
     * globalSettings.theme; it has a `palette` object or a `contentMaxWidth`
     * (the card is only mounted then). Without a palette only the width shows.
     */
    theme: Theme;
    /** Replaces globalSettings.theme with `next`; spread `theme` to keep its other keys. */
    onThemeChange: (next: Theme) => void;
}

/** The learner's palette names (-utils/catalogue-palette.ts PALETTE_KEYS), in its order. */
const PALETTE_KEYS = [
    'text',
    'body',
    'muted',
    'muted2',
    'primary',
    'gold',
    'accent',
    'olive',
    'cream',
    'canvas',
    'sand',
    'border',
    'borderStrong',
    'accentOnDark',
    'bodyOnDark',
    'outline',
] as const;

/** Content width limits the learner accepts (px, gutters excluded). */
export const CONTENT_WIDTH_MIN = 320;
export const CONTENT_WIDTH_MAX = 2400;

const isObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

/** The palette's colour keys: known names in the learner's order, then any other text value as authored. */
export const paletteColorKeys = (palette: Record<string, unknown>): string[] => {
    const set = Object.keys(palette).filter((k) => typeof palette[k] === 'string');
    const known: string[] = PALETTE_KEYS.filter((k) => set.includes(k));
    return [...known, ...set.filter((k) => !known.includes(k))];
};

/** The stored width as the learner reads it ("1152" and 1152.4 → 1152); '' when unset or unreadable. */
export const storedContentWidth = (raw: unknown): string => {
    const n = typeof raw === 'string' && raw.trim() ? Number(raw) : raw;
    return typeof n === 'number' && Number.isFinite(n) ? String(Math.round(n)) : '';
};

/** "1152" (or "1152px") → 1152; null when not a whole number in range. '' → undefined (use the default width). */
export const parseContentWidth = (text: string): number | undefined | null => {
    const trimmed = text.trim().replace(/\s*px$/i, '');
    if (!trimmed) return text.trim() ? null : undefined;
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return n >= CONTENT_WIDTH_MIN && n <= CONTENT_WIDTH_MAX ? n : null;
};

/**
 * Global Settings → the site's own colours (theme.palette) and content width
 * (theme.contentMaxWidth). Mounted when either exists. Each edit
 * changes one key and keeps the rest of the theme and palette; the brand
 * colour also writes theme.primaryColor, so buttons and the palette agree.
 */
export const SitePaletteCard: FC<SitePaletteCardProps> = ({ theme, onThemeChange }) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const hasPalette = isObject(theme.palette);
    const palette = isObject(theme.palette) ? theme.palette : {};
    const storedWidth = storedContentWidth(theme.contentMaxWidth);
    const [widthText, setWidthText] = useState(storedWidth);
    useEffect(() => setWidthText(storedWidth), [storedWidth]);
    const widthInvalid = parseContentWidth(widthText) === null;
    // Left with a value that cannot be saved: say so (the old width stays).
    const [notSaved, setNotSaved] = useState(false);
    const widthHintId = useId();

    const setColor = (key: string, color: string) =>
        onThemeChange({
            ...theme,
            ...(key === 'primary' ? { primaryColor: color } : {}),
            palette: { ...palette, [key]: color },
        });

    const commitWidth = () => {
        const next = parseContentWidth(widthText);
        setNotSaved(next === null);
        if (next === null) return;
        // "1100px" is saved as 1100: show it the way it is stored.
        setWidthText(String(next ?? ''));
        if (String(next ?? '') === storedWidth) return;
        const nextTheme = { ...theme };
        if (next === undefined) delete nextTheme.contentMaxWidth;
        else nextTheme.contentMaxWidth = next;
        onThemeChange(nextTheme);
    };

    return (
        <div className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            {hasPalette && (
                <>
                    <div className="space-y-1">
                        <h4 className="font-medium text-neutral-700">
                            {t('global.palette.heading')}
                        </h4>
                        <p className="text-caption text-neutral-500">{t('global.palette.hint')}</p>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        {paletteColorKeys(palette).map((key) => (
                            <ColorPickerField
                                key={key}
                                label={
                                    (PALETTE_KEYS as readonly string[]).includes(key)
                                        ? t(`global.palette.keys.${key}`)
                                        : t('global.palette.otherKey', { key })
                                }
                                value={String(palette[key])}
                                onChange={(c) => setColor(key, c)}
                            />
                        ))}
                    </div>

                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <Label htmlFor="site-palette-apply">
                                {t('global.palette.applyToTokens')}
                            </Label>
                            <p className="text-caption text-neutral-500">
                                {t('global.palette.applyToTokensHint')}
                            </p>
                        </div>
                        <Switch
                            id="site-palette-apply"
                            checked={palette.applyToTokens === true}
                            onCheckedChange={(c) =>
                                onThemeChange({
                                    ...theme,
                                    palette: { ...palette, applyToTokens: c },
                                })
                            }
                        />
                    </div>
                </>
            )}

            <div className="space-y-1">
                <Label htmlFor="site-content-width">{t('global.palette.contentWidth')}</Label>
                <div className="flex items-center gap-2">
                    <Input
                        id="site-content-width"
                        type="text"
                        inputMode="numeric"
                        value={widthText}
                        placeholder={t('global.palette.contentWidthDefault')}
                        onChange={(e) => {
                            setWidthText(e.target.value);
                            setNotSaved(false);
                        }}
                        onBlur={commitWidth}
                        aria-invalid={widthInvalid || undefined}
                        aria-describedby={widthHintId}
                        onKeyDown={(e) => e.key === 'Enter' && commitWidth()}
                        className="w-32"
                    />
                    <span className="text-caption text-neutral-500">px</span>
                </div>
                <p
                    id={widthHintId}
                    role={notSaved ? 'alert' : undefined}
                    className={`text-caption ${widthInvalid ? 'text-danger-600' : 'text-neutral-500'}`}
                >
                    {t(notSaved ? 'global.palette.contentWidthNotSaved' : 'global.palette.contentWidthHint', {
                        min: CONTENT_WIDTH_MIN,
                        max: CONTENT_WIDTH_MAX,
                    })}
                </p>
            </div>
        </div>
    );
};
