import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from '@phosphor-icons/react';
import { ChipToggleGroup } from '@/components/design-system/chips';
import { MyButton } from '@/components/design-system/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import {
    DEFAULT_PEN_STYLE,
    type PenFont,
    type PenInk,
    type PenInkName,
    type PenSize,
    type PenStyle,
} from '@/types/assessment-settings';
import { PenPreviewDialog } from './PenPreviewDialog';

const INKS: PenInkName[] = ['RED', 'BLUE', 'GREEN', 'BLACK'];
const FONTS: PenFont[] = [
    'DAWNING_OF_A_NEW_DAY',
    'COVERED_BY_YOUR_GRACE',
    'OVER_THE_RAINBOW',
    'CAVEAT',
    'CEDARVILLE_CURSIVE',
    'KALAM',
    'PATRICK_HAND',
    'ARCHITECTS_DAUGHTER',
];
const HEX_INK = /^#[0-9a-fA-F]{6}$/;
const isHexInk = (ink: unknown): ink is `#${string}` =>
    typeof ink === 'string' && HEX_INK.test(ink);
// Where the browser's colour picker opens before a colour has been chosen.
const CUSTOM_INK_START = '#1f3fa0'; // design-lint-ignore: starting value of a colour input
const SIZES: PenSize[] = ['SMALL', 'MEDIUM', 'LARGE'];

/** The nearest design tokens to the inks ai_service draws with (pen_style.py). */
const INK_SWATCH: Record<PenInkName, string> = {
    RED: 'bg-danger-600',
    BLUE: 'bg-info-700',
    GREEN: 'bg-success-700',
    BLACK: 'bg-neutral-900',
    PURPLE: 'bg-neutral-700',
};
const INK_TEXT: Record<PenInkName, string> = {
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
    DAWNING_OF_A_NEW_DAY: 'font-hand-dawning',
    COVERED_BY_YOUR_GRACE: 'font-hand-covered',
    OVER_THE_RAINBOW: 'font-hand-rainbow',
    CAVEAT: 'font-hand-caveat',
    CEDARVILLE_CURSIVE: 'font-hand-cedarville',
    KALAM: 'font-hand-kalam',
    PATRICK_HAND: 'font-hand-patrick',
    ARCHITECTS_DAUGHTER: 'font-hand-architects',
};

// Kalam is loaded for the whole app (index.html); the others only once a
// picker is shown, so no other page pays for them.
const EXTRA_FONTS_HREF =
    'https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Architects+Daughter&family=Dawning+of+a+New+Day&family=Covered+By+Your+Grace&family=Over+the+Rainbow&family=Caveat&family=Cedarville+Cursive&display=swap';
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
    ink:
        INKS.includes(raw?.ink as PenInkName) || isHexInk(raw?.ink)
            ? (raw!.ink as PenInk)
            : DEFAULT_PEN_STYLE.ink,
    font: FONTS.includes(raw?.font as PenFont) ? (raw!.font as PenFont) : DEFAULT_PEN_STYLE.font,
    size: SIZES.includes(raw?.size as PenSize) ? (raw!.size as PenSize) : DEFAULT_PEN_STYLE.size,
    darkness:
        typeof raw?.darkness === 'number' && Number.isFinite(raw.darkness)
            ? Math.max(0, Math.min(100, Math.round(raw.darkness)))
            : DEFAULT_PEN_STYLE.darkness,
});

/**
 * Ink colour, darkness, handwriting and size of the AI's pen on a checked copy, with
 * a sample line and a full-page preview. Used in Settings → Assessment (the
 * institute's pen) and when a teacher re-draws one copy.
 */
export const PenStylePicker = ({
    value,
    onChange,
    disabled,
    showHeading = true,
    showPreview = true,
    saveHint = false,
}: {
    value: PenStyle;
    onChange: (value: PenStyle) => void;
    disabled?: boolean;
    showHeading?: boolean;
    showPreview?: boolean;
    /** Say that the choice takes effect once saved (the Settings page, which saves as a whole). */
    saveHint?: boolean;
}) => {
    const { t } = useTranslation('copyCheckReview');
    useEffect(loadExtraFonts, []);
    const set = (patch: Partial<PenStyle>) => !disabled && onChange({ ...value, ...patch });
    const [previewOpen, setPreviewOpen] = useState(false);
    const customInk = isHexInk(value.ink) ? value.ink : null;
    // A colour the teacher picks has no token, so these two are the one place it is inline.
    const customSwatch = { backgroundColor: customInk ?? undefined }; // design-lint-ignore: user-chosen pen colour
    const customText = { color: customInk ?? undefined }; // design-lint-ignore: user-chosen pen colour

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
                    <label
                        className={cn(
                            'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption transition-colors',
                            customInk
                                ? 'border-primary-400 bg-primary-50 text-neutral-800'
                                : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                        )}
                    >
                        <input
                            type="color"
                            className="sr-only"
                            value={customInk ?? CUSTOM_INK_START}
                            onChange={(e) => set({ ink: e.target.value as PenInk })}
                        />
                        <span
                            className={cn(
                                'size-3 rounded-full',
                                !customInk && 'border border-neutral-300'
                            )}
                            style={customSwatch}
                            aria-hidden
                        />
                        {t('penStyle.customInk')}
                    </label>
                </div>
            </div>

            <div className="flex flex-col gap-1.5">
                <p className="text-caption font-medium text-neutral-600">
                    {t('penStyle.darkness')}
                </p>
                <div className="flex items-center gap-3">
                    <span className="text-caption text-neutral-500">
                        {t('penStyle.darknessLight')}
                    </span>
                    <Slider
                        className="max-w-60"
                        min={0}
                        max={100}
                        step={5}
                        value={[value.darkness]}
                        aria-label={t('penStyle.darkness')}
                        onValueChange={([darkness]) => set({ darkness })}
                    />
                    <span className="text-caption text-neutral-500">
                        {t('penStyle.darknessDark')}
                    </span>
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
                    className={`${SAMPLE_FONT[value.font]} ${SAMPLE_SCALE[value.size]} ${
                        customInk ? '' : INK_TEXT[value.ink as PenInkName]
                    }`}
                    style={customText}
                >
                    {t('penStyle.sample')}
                </p>
            </div>

            {showPreview && (
                <>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="w-fit gap-1.5"
                        onClick={() => setPreviewOpen(true)}
                    >
                        <Eye size={16} />
                        {t('penStyle.previewButton')}
                    </MyButton>
                    {saveHint && (
                        <p className="text-caption text-neutral-500">{t('penStyle.saveHint')}</p>
                    )}
                    {previewOpen && (
                        <PenPreviewDialog
                            value={value}
                            saveHint={saveHint}
                            onChange={onChange}
                            onClose={() => setPreviewOpen(false)}
                        />
                    )}
                </>
            )}
        </div>
    );
};

export default PenStylePicker;
