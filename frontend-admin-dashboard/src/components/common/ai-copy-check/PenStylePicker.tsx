import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipToggleGroup } from '@/components/design-system/chips';
import { cn } from '@/lib/utils';
import {
    DEFAULT_PEN_STYLE,
    type PenFont,
    type PenInk,
    type PenSize,
    type PenStyle,
} from '@/types/assessment-settings';

const INKS: PenInk[] = ['RED', 'BLUE', 'GREEN', 'BLACK'];
const FONTS: PenFont[] = ['KALAM', 'PATRICK_HAND', 'ARCHITECTS_DAUGHTER'];
const SIZES: PenSize[] = ['SMALL', 'MEDIUM', 'LARGE'];

/** The nearest design tokens to the inks ai_service draws with (pen_style.py). */
const INK_SWATCH: Record<PenInk, string> = {
    RED: 'bg-danger-600',
    BLUE: 'bg-info-700',
    GREEN: 'bg-success-700',
    BLACK: 'bg-neutral-900',
    PURPLE: 'bg-neutral-700',
};
const INK_TEXT: Record<PenInk, string> = {
    RED: 'text-danger-600',
    BLUE: 'text-info-700',
    GREEN: 'text-success-700',
    BLACK: 'text-neutral-900',
    PURPLE: 'text-neutral-700',
};

const SAMPLE_SCALE: Record<PenSize, string> = {
    SMALL: 'text-body',
    MEDIUM: 'text-subtitle',
    LARGE: 'text-h3',
};

/** The same faces ai_service writes with (copy_check/fonts). */
const SAMPLE_FONT: Record<PenFont, string> = {
    KALAM: 'font-hand-kalam',
    PATRICK_HAND: 'font-hand-patrick',
    ARCHITECTS_DAUGHTER: 'font-hand-architects',
};

// Kalam is loaded for the whole app (index.html); the other two only once a
// picker is shown, so no other page pays for them.
const EXTRA_FONTS_HREF =
    'https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Architects+Daughter&display=swap';
const EXTRA_FONTS_LINK_ID = 'pen-style-picker-fonts';

const loadExtraFonts = () => {
    if (typeof document === 'undefined' || document.getElementById(EXTRA_FONTS_LINK_ID)) return;
    const link = document.createElement('link');
    link.id = EXTRA_FONTS_LINK_ID;
    link.rel = 'stylesheet';
    link.href = EXTRA_FONTS_HREF;
    document.head.appendChild(link);
};

/** Fill in anything missing from a saved pen with the usual pen. */
export const normalizePenStyle = (raw?: Partial<PenStyle> | null): PenStyle => ({
    ink: INKS.includes(raw?.ink as PenInk) ? (raw!.ink as PenInk) : DEFAULT_PEN_STYLE.ink,
    font: FONTS.includes(raw?.font as PenFont) ? (raw!.font as PenFont) : DEFAULT_PEN_STYLE.font,
    size: SIZES.includes(raw?.size as PenSize) ? (raw!.size as PenSize) : DEFAULT_PEN_STYLE.size,
});

/**
 * Ink colour, handwriting and size of the AI's pen on a checked copy, with a
 * sample line in the chosen ink. Used in Settings → Assessment (the institute's
 * pen) and when a teacher re-draws one copy.
 */
export const PenStylePicker = ({
    value,
    onChange,
    disabled,
    showHeading = true,
}: {
    value: PenStyle;
    onChange: (value: PenStyle) => void;
    disabled?: boolean;
    showHeading?: boolean;
}) => {
    const { t } = useTranslation('copyCheckReview');
    useEffect(loadExtraFonts, []);
    const set = (patch: Partial<PenStyle>) => !disabled && onChange({ ...value, ...patch });

    return (
        <div className={cn('flex flex-col gap-3', disabled && 'pointer-events-none opacity-60')}>
            {showHeading && (
                <div className="flex flex-col gap-0.5">
                    <p className="text-body font-medium text-neutral-800">{t('penStyle.title')}</p>
                    <p className="text-caption text-neutral-500">{t('penStyle.hint')}</p>
                </div>
            )}

            <div className="flex flex-col gap-1.5">
                <p className="text-caption font-medium text-neutral-600">{t('penStyle.ink')}</p>
                <div
                    className="flex flex-wrap gap-2"
                    role="radiogroup"
                    aria-label={t('penStyle.ink')}
                >
                    {INKS.map((ink) => (
                        <button
                            key={ink}
                            type="button"
                            role="radio"
                            aria-checked={value.ink === ink}
                            onClick={() => set({ ink })}
                            className={cn(
                                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption transition-colors',
                                value.ink === ink
                                    ? 'border-primary-400 bg-primary-50 text-neutral-800'
                                    : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                            )}
                        >
                            <span
                                className={cn('size-3 rounded-full', INK_SWATCH[ink])}
                                aria-hidden
                            />
                            {t(`penStyle.inks.${ink}`)}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-1.5">
                <p className="text-caption font-medium text-neutral-600">{t('penStyle.font')}</p>
                <ChipToggleGroup
                    size="sm"
                    variant="outline"
                    ariaLabel={t('penStyle.font')}
                    value={value.font}
                    onChange={(font) => set({ font })}
                    options={FONTS.map((font) => ({
                        value: font,
                        label: t(`penStyle.fonts.${font}`),
                    }))}
                />
            </div>

            <div className="flex flex-col gap-1.5">
                <p className="text-caption font-medium text-neutral-600">{t('penStyle.size')}</p>
                <ChipToggleGroup
                    size="sm"
                    variant="outline"
                    ariaLabel={t('penStyle.size')}
                    value={value.size}
                    onChange={(size) => set({ size })}
                    options={SIZES.map((size) => ({
                        value: size,
                        label: t(`penStyle.sizes.${size}`),
                    }))}
                />
            </div>

            <div className="rounded-md border border-neutral-200 bg-white px-3 py-2">
                {/* Plain string, not cn(): tailwind-merge reads text-body / text-h3
                    as a colour and drops them next to the ink class. */}
                <p
                    className={`${SAMPLE_FONT[value.font]} ${SAMPLE_SCALE[value.size]} ${INK_TEXT[value.ink]}`}
                >
                    {t('penStyle.sample')}
                </p>
            </div>
        </div>
    );
};

export default PenStylePicker;
