import { useEffect, useRef, useState } from 'react';
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import convert from 'color-convert';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Separator } from '@/components/ui/separator';
import { useTheme } from '@/providers/theme/theme-provider';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { handleUpdateInstituteDashboard } from '@/routes/dashboard/-services/dashboard-services';
import { getThemeRoleSettings, saveThemeRoleSettings } from '@/services/theme-role-settings';
import { getStudentDisplaySettings } from '@/services/student-display-settings';
import type {
    NavRoleColors,
    StudentUiType,
    UiCorners,
    UiDensity,
    UiGradient,
} from '@/types/theme-role-settings';
import { UI_AXIS_DEFAULTS } from '@/types/theme-role-settings';
import {
    UiAxisPicker,
    CornerPreview,
    DensityPreview,
    GradientPreview,
    SkinPreview,
    type AxisOption,
} from './UiAxisPicker';
import { navPresets } from '@/constants/themes/nav-presets';
import {
    PRESET_THEMES,
    CUSTOM_THEME_ID,
    getThemeShades,
    isCustomThemeCode,
} from '@/constants/themes/preset-themes';
import { FONT_CHOICES, DEFAULT_FONT_KEY } from '@/constants/themes/fonts';
import { rampHexFromHex, SHADES } from '@/lib/theme-ramp';
import { resolveFontStack } from '@/utils/font';

const toHex = (h: number, s: number, l: number) => `#${convert.hsl.hex([h, s, l])}`;
const WHITE_HEX = toHex(0, 0, 100);

/* ------------------------------------------------------------------ */
/* Learner presentation axes                                           */
/* ------------------------------------------------------------------ */
/* The preview numbers below MUST track the token values in the learner
   app's styles/ui-axes.css. They are duplicated here (rather than
   imported) because the two apps share no package — the same
   copy-by-convention the theme.json / theme-ramp.ts files already use.
   If you change an axis's tokens there, update the previews here. */

const CORNER_OPTIONS = (t: TFunction): ReadonlyArray<AxisOption<UiCorners>> => [
    {
        value: 'sharp',
        label: t('learnerUi.corners.sharp'),
        preview: <CornerPreview radiusPx={2} />,
    },
    {
        value: 'rounded',
        label: t('learnerUi.corners.rounded'),
        description: t('common.defaultSuffix'),
        preview: <CornerPreview radiusPx={8} />,
    },
    {
        value: 'pill',
        label: t('learnerUi.corners.pill'),
        preview: <CornerPreview radiusPx={16} />,
    },
];

const DENSITY_OPTIONS = (t: TFunction): ReadonlyArray<AxisOption<UiDensity>> => [
    {
        value: 'compact',
        label: t('learnerUi.density.compact'),
        preview: <DensityPreview padPx={6} gapPx={4} />,
    },
    {
        value: 'default',
        label: t('learnerUi.density.default'),
        description: t('common.defaultSuffix'),
        preview: <DensityPreview padPx={8} gapPx={6} />,
    },
    {
        value: 'comfortable',
        label: t('learnerUi.density.comfortable'),
        preview: <DensityPreview padPx={12} gapPx={9} />,
    },
];

const GRADIENT_OPTIONS = (
    t: TFunction,
    brandHex: string
): ReadonlyArray<AxisOption<UiGradient>> => {
    const ramp = rampHexFromHex(brandHex);
    return [
        {
            value: 'flat',
            label: t('learnerUi.gradient.flat'),
            preview: <GradientPreview from={ramp['50']} to={ramp['50']} />,
        },
        {
            value: 'subtle',
            label: t('learnerUi.gradient.subtle'),
            preview: <GradientPreview from={ramp['50']} to={WHITE_HEX} />,
        },
        {
            value: 'full',
            label: t('learnerUi.gradient.full'),
            description: t('common.defaultSuffix'),
            preview: <GradientPreview from={ramp['100']} to={ramp['50']} />,
        },
    ];
};

const SKIN_OPTIONS = (
    t: TFunction,
    brandHex: string
): ReadonlyArray<AxisOption<StudentUiType>> => {
    const ramp = rampHexFromHex(brandHex);
    return [
        {
            value: 'default',
            label: t('learnerUi.skin.default'),
            description: t('common.defaultSuffix'),
            preview: <SkinPreview radiusPx={8} accent={brandHex} />,
        },
        {
            value: 'vibrant',
            label: t('learnerUi.skin.vibrant'),
            preview: <SkinPreview radiusPx={12} accent={ramp['300']} />,
        },
        {
            value: 'play',
            label: t('learnerUi.skin.play'),
            preview: <SkinPreview radiusPx={20} accent={brandHex} bold />,
        },
        {
            value: 'cleanerPlay',
            label: t('learnerUi.skin.cleanerPlay'),
            preview: <SkinPreview radiusPx={12} accent={ramp['200']} />,
        },
        {
            value: 'corporate',
            label: t('learnerUi.skin.corporate'),
            // Modern B2B register: 10px geometry, a raised white surface with a
            // soft shadow (layering rather than outlines), and a solid brand
            // bar for the primary action. Matches the learner skin as revised
            // on 2026-09-25 — the earlier 4px/slate preview described the old
            // 2012-era direction.
            preview: <SkinPreview radiusPx={10} accent={brandHex} elevated />,
        },
    ];
};
const CUSTOM_NAV_ID = 'custom';

const buildNavColorFields = (
    t: TFunction
): Array<{ key: keyof NavRoleColors; label: string }> => [
    { key: 'surface', label: t('sidebar.colorFields.surface') },
    { key: 'surfaceHover', label: t('sidebar.colorFields.surfaceHover') },
    { key: 'active', label: t('sidebar.colorFields.active') },
    { key: 'activeText', label: t('sidebar.colorFields.activeText') },
    { key: 'text', label: t('sidebar.colorFields.text') },
];

const buildLightNavPreview = (brandHex: string): NavRoleColors => ({
    surface: toHex(0, 0, 100),
    surfaceHover: toHex(210, 40, 96),
    active: rampHexFromHex(brandHex)['50'],
    activeText: brandHex,
    text: toHex(222.2, 20, 20),
});

// Charcoal-rail-ish seed (active item = the real brand color) so switching to
// Custom starts from something real, not black-on-black.
const buildDefaultCustomNav = (brandHex: string): NavRoleColors => ({
    surface: toHex(220, 10, 13),
    surfaceHover: toHex(220, 10, 18),
    active: brandHex,
    activeText: toHex(0, 0, 100),
    text: toHex(220, 8, 65),
});

const buildShadeRampPreview = (hex: string): string[] => {
    try {
        const ramp = rampHexFromHex(hex);
        return SHADES.map((shade) => ramp[shade]);
    } catch {
        return [];
    }
};

const buildDefaultSecondaryHex = (brandHex: string): string => {
    const [h, s, l] = convert.hex.hsl(brandHex.replace('#', ''));
    return toHex(((h - 24) % 360 + 360) % 360, Math.max(s - 25, 20), Math.min(l + 15, 80));
};
const buildDefaultTertiaryHex = (brandHex: string): string => {
    const [h, s, l] = convert.hex.hsl(brandHex.replace('#', ''));
    return toHex(((h + 48) % 360 + 360) % 360, Math.max(s - 35, 15), Math.min(l + 25, 88));
};

const buildBackgroundSuggestions = (
    brandHex: string,
    t: TFunction
): Array<{ hex: string; label: string }> => {
    let brand50 = WHITE_HEX;
    let brand100 = WHITE_HEX;
    try {
        const ramp = rampHexFromHex(brandHex);
        brand50 = ramp['50'];
        brand100 = ramp['100'];
    } catch {
        // fall through to neutrals
    }
    return [
        { hex: WHITE_HEX, label: t('background.suggestions.white') },
        { hex: brand50, label: t('background.suggestions.brandTint') },
        { hex: brand100, label: t('background.suggestions.brandTintDeeper') },
        { hex: toHex(40, 33, 97), label: t('background.suggestions.warmCream') },
        { hex: toHex(210, 20, 97), label: t('background.suggestions.coolGrey') },
    ];
};

const BACKGROUND_MIN_LIGHTNESS = 88;
const isBackgroundTooDark = (hex: string): boolean => {
    try {
        const [, , l] = convert.hex.hsl(hex.replace('#', ''));
        return l < BACKGROUND_MIN_LIGHTNESS;
    } catch {
        return false;
    }
};

/**
 * The full institute appearance editor — brand color (presets + custom), font,
 * page background, secondary/tertiary accents, and sidebar color. Self-
 * contained: reads the institute record + THEME_SETTING on mount, live-previews
 * every choice, and on Save persists both institute_theme_code and the role
 * settings. Rendered by Settings > Appearance and (via a button) from the
 * profile dialog.
 */
export const ThemeEditor = ({ onSaved }: { onSaved?: () => void }) => {
    const { t } = useTranslation('settingsThemeEditor');
    const queryClient = useQueryClient();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { setPrimaryColor, getPrimaryColorCode } = useTheme();
    const NAV_COLOR_FIELDS = buildNavColorFields(t);

    const [selectedTheme, setSelectedTheme] = useState(PRESET_THEMES[0]?.code || 'primary');
    const [customBrandHex, setCustomBrandHex] = useState<string | null>(null);
    const [fontFamily, setFontFamily] = useState<string | null>(null);
    const [backgroundOverride, setBackgroundOverride] = useState<string | null>(null);
    const [secondaryOverride, setSecondaryOverride] = useState<string | null>(null);
    const [tertiaryOverride, setTertiaryOverride] = useState<string | null>(null);
    const [selectedNavPresetId, setSelectedNavPresetId] = useState(navPresets[0]!.id);
    const [customNav, setCustomNav] = useState<NavRoleColors | null>(null);
    // Learner presentation axes + skin. These configure the LEARNER app only;
    // the admin's own chrome deliberately does not ride them.
    const [density, setDensity] = useState<UiDensity>(UI_AXIS_DEFAULTS.density);
    const [corners, setCorners] = useState<UiCorners>(UI_AXIS_DEFAULTS.corners);
    const [gradient, setGradient] = useState<UiGradient>(UI_AXIS_DEFAULTS.gradient);
    const [skin, setSkin] = useState<StudentUiType>(UI_AXIS_DEFAULTS.skin);
    // Legacy skin location (STUDENT_DISPLAY_SETTINGS.ui.type). Held in a ref
    // rather than state because it is only ever a seed for `skin` — it must not
    // re-render or re-trigger the hydration effect.
    const legacySkinRef = useRef<StudentUiType | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Hydrate from the saved brand code + THEME_SETTING on mount.
    useEffect(() => {
        const savedCode = instituteDetails?.institute_theme_code || 'primary';
        if (isCustomThemeCode(savedCode)) {
            setSelectedTheme(CUSTOM_THEME_ID);
            setCustomBrandHex(savedCode);
        } else {
            setSelectedTheme(savedCode);
        }

        let cancelled = false;
        // Both blobs are needed together: `skin` falls back to the legacy
        // STUDENT_DISPLAY_SETTINGS.ui.type when THEME_SETTING has none, so the
        // seed must be resolved BEFORE the theme roles are applied. Awaiting
        // them as a pair avoids the race where THEME_SETTING lands first and
        // reads an unset seed. The legacy read is allowed to fail (-> null
        // seed, saved/default skin wins) without failing the whole hydration.
        Promise.all([
            getThemeRoleSettings(),
            getStudentDisplaySettings().catch(() => null),
        ]).then(([saved, legacy]) => {
            if (cancelled) return;
            legacySkinRef.current = legacy?.ui?.type ?? null;
            setSecondaryOverride(saved?.roles?.secondary ?? null);
            setTertiaryOverride(saved?.roles?.tertiary ?? null);
            setBackgroundOverride(saved?.roles?.background ?? null);
            setFontFamily(saved?.roles?.fontFamily ?? null);
            setDensity(saved?.roles?.density ?? UI_AXIS_DEFAULTS.density);
            setCorners(saved?.roles?.corners ?? UI_AXIS_DEFAULTS.corners);
            setGradient(saved?.roles?.gradient ?? UI_AXIS_DEFAULTS.gradient);
            // Skin moved here from STUDENT_DISPLAY_SETTINGS.ui.type. Institutes
            // configured before the move only have it there, so seed from the
            // legacy value when THEME_SETTING has none — otherwise opening this
            // tab and saving would silently reset their skin to default.
            setSkin(saved?.roles?.skin ?? legacySkinRef.current ?? UI_AXIS_DEFAULTS.skin);
            if (!saved?.roles?.nav) {
                setSelectedNavPresetId('match-brand');
                return;
            }
            const brandHex = getPrimaryColorCode();
            const matched = navPresets.find((preset) => {
                const built = preset.build(brandHex);
                return (
                    built &&
                    built.surface.toLowerCase() === saved.roles!.nav!.surface.toLowerCase()
                );
            });
            if (matched) {
                setSelectedNavPresetId(matched.id);
            } else {
                setSelectedNavPresetId(CUSTOM_NAV_ID);
                setCustomNav(saved.roles!.nav!);
            }
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instituteDetails?.institute_theme_code]);

    const handleThemeSelect = (code: string) => {
        setSelectedTheme(code);
        setPrimaryColor(code);
    };

    // Custom brand hex: institute_theme_code is a free string and both theme
    // providers branch on a leading '#', so a hex renders through the same path
    // a preset does.
    const handleCustomBrandSelect = (hex: string) => {
        setSelectedTheme(CUSTOM_THEME_ID);
        setCustomBrandHex(hex);
        setPrimaryColor(hex);
    };

    // Live-preview the font immediately so the whole editor re-renders in it.
    const handleFontSelect = (key: string | null) => {
        setFontFamily(key);
        const stack = resolveFontStack(key ?? DEFAULT_FONT_KEY);
        if (stack) {
            document.documentElement.style.setProperty('--app-font-family', stack);
            document.body.style.fontFamily = stack;
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const brandHex = getPrimaryColorCode();
            const brandCode =
                selectedTheme === CUSTOM_THEME_ID
                    ? (customBrandHex ?? brandHex)
                    : selectedTheme;

            const nav =
                selectedNavPresetId === CUSTOM_NAV_ID
                    ? (customNav ?? buildDefaultCustomNav(brandHex))
                    : (navPresets.find((p) => p.id === selectedNavPresetId) ?? navPresets[0]!).build(
                          brandHex
                      );

            await saveThemeRoleSettings({
                version: 3,
                mode: selectedNavPresetId === CUSTOM_NAV_ID ? 'custom' : nav ? 'preset' : 'legacy',
                roles: {
                    ...(nav ? { nav } : {}),
                    ...(secondaryOverride ? { secondary: secondaryOverride } : {}),
                    ...(tertiaryOverride ? { tertiary: tertiaryOverride } : {}),
                    ...(backgroundOverride ? { background: backgroundOverride } : {}),
                    ...(fontFamily ? { fontFamily } : {}),
                    // Axes are always written (never conditionally spread):
                    // they are enums with a meaningful default, so omitting
                    // "default" would make it impossible to move an institute
                    // BACK to default once they had picked something else.
                    density,
                    corners,
                    gradient,
                    skin,
                },
            });

            // Persist the brand code onto the institute record — what every
            // other admin and every learner reads. Build the full update payload
            // from current details so nothing else changes.
            await handleUpdateInstituteDashboard(
                {
                    instituteProfilePictureUrl: '',
                    instituteProfilePictureId:
                        instituteDetails?.institute_logo_file_id ?? undefined,
                    instituteName: instituteDetails?.institute_name ?? '',
                    instituteType: instituteDetails?.type ?? '',
                    instituteEmail: instituteDetails?.email ?? '',
                    institutePhoneNumber: instituteDetails?.phone ?? '',
                    instituteWebsite: instituteDetails?.website_url ?? '',
                    instituteAddress: instituteDetails?.address ?? '',
                    instituteCountry: instituteDetails?.country ?? '',
                    instituteState: instituteDetails?.state ?? '',
                    instituteCity: instituteDetails?.city ?? '',
                    institutePinCode: instituteDetails?.pin_code ?? '',
                    instituteThemeCode: brandCode,
                },
                instituteDetails?.id
            );
            queryClient.invalidateQueries({ queryKey: ['GET_BOTH_INSTITUTE_APIS'] });
            toast.success(t('toasts.themeUpdated'), { className: 'success-toast', duration: 2000 });
            onSaved?.();
        } catch (error) {
            console.error('Failed to save theme', error);
            toast.error(t('toasts.saveFailed'), {
                className: 'error-toast',
                duration: 2500,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const brandHexForPreview = customBrandHex ?? getPrimaryColorCode();

    return (
        <div className="flex flex-col gap-6">
            {/* Brand color */}
            <section>
                <h2 className="mb-1 text-lg font-semibold">{t('brandColor.heading')}</h2>
                <p className="mb-4 text-sm text-neutral-500">{t('brandColor.description')}</p>
                <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {PRESET_THEMES.map((theme) => {
                        const shades = getThemeShades(theme.code);
                        return (
                            <button
                                type="button"
                                key={theme.code}
                                onClick={() => handleThemeSelect(theme.code)}
                                className={cn(
                                    'overflow-hidden rounded-lg shadow-sm transition-shadow hover:shadow-md',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                                    selectedTheme === theme.code
                                        ? 'ring-2 ring-primary-500 ring-offset-2'
                                        : 'ring-1 ring-gray-200'
                                )}
                                aria-label={t('brandColor.selectThemeAriaLabel', { name: theme.name })}
                                aria-pressed={selectedTheme === theme.code}
                            >
                                <div className="flex flex-col">
                                    {shades.map((shade, i) => (
                                        // design-lint-ignore: data-driven palette swatch
                                        <div
                                            key={i}
                                            className="h-5"
                                            style={{ backgroundColor: shade }} /* design-lint-ignore: data-driven swatch */
                                        />
                                    ))}
                                </div>
                            </button>
                        );
                    })}

                    {(() => {
                        const isCustom = selectedTheme === CUSTOM_THEME_ID;
                        const ramp = buildShadeRampPreview(brandHexForPreview);
                        return (
                            <button
                                type="button"
                                onClick={() => handleCustomBrandSelect(brandHexForPreview)}
                                className={cn(
                                    'relative overflow-hidden rounded-lg shadow-sm transition-shadow hover:shadow-md',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                                    isCustom
                                        ? 'ring-2 ring-primary-500 ring-offset-2'
                                        : 'ring-1 ring-gray-200'
                                )}
                                aria-label={t('brandColor.customAriaLabel')}
                                aria-pressed={isCustom}
                            >
                                <div className="flex flex-col">
                                    {[...ramp].reverse().map((shade, i) => (
                                        // design-lint-ignore: live preview of institute-chosen hex
                                        <div
                                            key={i}
                                            className="h-5"
                                            style={{ backgroundColor: shade }} /* design-lint-ignore: data-driven swatch */
                                        />
                                    ))}
                                </div>
                                <span className="absolute inset-x-0 bottom-0 bg-white/85 py-1 text-center text-xs font-medium text-neutral-700">
                                    {t('brandColor.custom')}
                                </span>
                            </button>
                        );
                    })()}
                </div>

                {selectedTheme === CUSTOM_THEME_ID && (
                    <div className="mt-3 flex items-center gap-2">
                        {/* design-lint-ignore: native color input — user-chosen data, not a token */}
                        <input
                            type="color"
                            value={customBrandHex ?? getPrimaryColorCode()}
                            onChange={(e) => handleCustomBrandSelect(e.target.value)}
                            className="h-8 w-8 cursor-pointer rounded border border-gray-200 p-0"
                            aria-label={t('brandColor.customBrandColorAriaLabel')}
                        />
                        <MyInput
                            inputType="text"
                            input={customBrandHex ?? getPrimaryColorCode()}
                            onChangeFunction={(e) => handleCustomBrandSelect(e.target.value)}
                            size="small"
                            className="w-28 font-mono text-xs"
                            inputPlaceholder={t('hexColorPlaceholder')}
                        />
                    </div>
                )}
            </section>

            <Separator />

            {/* Font */}
            <section>
                <h2 className="mb-1 text-lg font-semibold">{t('font.heading')}</h2>
                <p className="mb-4 text-sm text-neutral-500">{t('font.description')}</p>
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {FONT_CHOICES.map((font) => {
                        const active = (fontFamily ?? DEFAULT_FONT_KEY) === font.key;
                        return (
                            <button
                                type="button"
                                key={font.key}
                                onClick={() => handleFontSelect(font.key)}
                                className={cn(
                                    'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                    active
                                        ? 'border-primary-500 ring-1 ring-primary-500'
                                        : 'border-gray-200 hover:border-gray-300'
                                )}
                                aria-pressed={active}
                            >
                                {/* design-lint-ignore: renders in the actual candidate font */}
                                <span
                                    className="text-lg"
                                    style={{ fontFamily: font.previewFamily }} /* design-lint-ignore: renders in the candidate font */
                                >
                                    {t('font.specimen')}
                                </span>
                                <span className="text-sm font-medium text-neutral-800">
                                    {font.label}
                                    {font.note ? (
                                        <span className="ml-1 text-xs font-normal text-neutral-400">
                                            · {font.note}
                                        </span>
                                    ) : null}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </section>

            <Separator />

            {/* ── Learner presentation axes ─────────────────────────────────
                These configure the LEARNER app only. The admin dashboard's own
                chrome deliberately does not ride them, so the previews are
                scale models rather than live-applied styling. */}
            <section>
                <h2 className="mb-1 text-lg font-semibold">{t('learnerUi.heading')}</h2>
                <p className="mb-4 text-sm text-neutral-500">{t('learnerUi.description')}</p>

                <div className="mb-6">
                    <h3 className="mb-1 text-sm font-medium">{t('learnerUi.corners.label')}</h3>
                    <p className="mb-3 text-xs text-neutral-500">
                        {t('learnerUi.corners.help')}
                    </p>
                    <UiAxisPicker
                        ariaLabel={t('learnerUi.corners.label')}
                        value={corners}
                        onChange={setCorners}
                        options={CORNER_OPTIONS(t)}
                    />
                </div>

                <div className="mb-6">
                    <h3 className="mb-1 text-sm font-medium">{t('learnerUi.density.label')}</h3>
                    <p className="mb-3 text-xs text-neutral-500">
                        {t('learnerUi.density.help')}
                    </p>
                    <UiAxisPicker
                        ariaLabel={t('learnerUi.density.label')}
                        value={density}
                        onChange={setDensity}
                        options={DENSITY_OPTIONS(t)}
                    />
                </div>

                <div className="mb-6">
                    <h3 className="mb-1 text-sm font-medium">{t('learnerUi.gradient.label')}</h3>
                    <p className="mb-3 text-xs text-neutral-500">
                        {t('learnerUi.gradient.help')}
                    </p>
                    <UiAxisPicker
                        ariaLabel={t('learnerUi.gradient.label')}
                        value={gradient}
                        onChange={setGradient}
                        options={GRADIENT_OPTIONS(t, brandHexForPreview)}
                    />
                </div>

                <div>
                    <h3 className="mb-1 text-sm font-medium">{t('learnerUi.skin.label')}</h3>
                    <p className="mb-3 text-xs text-neutral-500">{t('learnerUi.skin.help')}</p>
                    <UiAxisPicker
                        ariaLabel={t('learnerUi.skin.label')}
                        value={skin}
                        onChange={setSkin}
                        options={SKIN_OPTIONS(t, brandHexForPreview)}
                    />
                </div>
            </section>

            <Separator />

            {/* Page background */}
            <section>
                <h2 className="mb-1 text-lg font-semibold">{t('background.heading')}</h2>
                <p className="mb-4 text-sm text-neutral-500">{t('background.description')}</p>
                <div className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-medium">
                            {backgroundOverride ? t('background.custom') : t('background.whiteDefault')}
                        </span>
                        {backgroundOverride && (
                            <button
                                type="button"
                                onClick={() => setBackgroundOverride(null)}
                                className="text-xs font-medium text-primary-500 hover:underline"
                            >
                                {t('background.resetToWhite')}
                            </button>
                        )}
                    </div>
                    <div className="mb-3 flex flex-wrap gap-2">
                        {buildBackgroundSuggestions(brandHexForPreview, t).map(({ hex, label }) => {
                            const isWhite = hex.toLowerCase() === WHITE_HEX.toLowerCase();
                            const isActive = isWhite
                                ? backgroundOverride === null
                                : backgroundOverride?.toLowerCase() === hex.toLowerCase();
                            return (
                                <button
                                    type="button"
                                    key={label}
                                    onClick={() => setBackgroundOverride(isWhite ? null : hex)}
                                    className={cn(
                                        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                        isActive
                                            ? 'border-primary-500 text-primary-500'
                                            : 'border-gray-200 text-neutral-600 hover:border-gray-300'
                                    )}
                                    aria-pressed={isActive}
                                >
                                    {/* design-lint-ignore: computed brand-derived tint swatch */}
                                    <span
                                        className="size-4 rounded border border-gray-200"
                                        style={{ backgroundColor: hex }} /* design-lint-ignore: brand-derived tint swatch */
                                    />
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex items-center gap-2">
                        {/* design-lint-ignore: native color input — user-chosen data, not a token */}
                        <input
                            type="color"
                            value={backgroundOverride ?? WHITE_HEX}
                            onChange={(e) => setBackgroundOverride(e.target.value)}
                            className="h-8 w-8 cursor-pointer rounded border border-gray-200 p-0"
                            aria-label={t('background.colorAriaLabel')}
                        />
                        <MyInput
                            inputType="text"
                            input={backgroundOverride ?? WHITE_HEX}
                            onChangeFunction={(e) => setBackgroundOverride(e.target.value)}
                            size="small"
                            className="w-28 font-mono text-xs"
                            inputPlaceholder={t('hexColorPlaceholder')}
                        />
                    </div>
                    {backgroundOverride && isBackgroundTooDark(backgroundOverride) && (
                        <p className="mt-2 text-xs text-warning-600">
                            {t('background.tooDarkWarning')}
                        </p>
                    )}
                    {/* design-lint-ignore: computed per-institute canvas preview */}
                    <div
                        className="mt-3 rounded-md border border-gray-200 p-3"
                        style={{ backgroundColor: backgroundOverride ?? WHITE_HEX }} /* design-lint-ignore: per-institute canvas preview */
                    >
                        <div className="rounded-md bg-white p-2 shadow-sm">
                            <div className="text-xs font-medium text-neutral-800">
                                {t('background.cardPreviewTitle')}
                            </div>
                            <div className="text-xs text-neutral-500">
                                {t('background.cardPreviewSubtitle')}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <Separator />

            {/* Secondary & tertiary */}
            <section>
                <h2 className="mb-1 text-lg font-semibold">{t('accentColors.heading')}</h2>
                <p className="mb-4 text-sm text-neutral-500">{t('accentColors.description')}</p>
                <div className="flex flex-col gap-4">
                    {(
                        [
                            {
                                key: 'secondary' as const,
                                label: t('accentColors.secondaryLabel'),
                                value: secondaryOverride,
                                setValue: setSecondaryOverride,
                                buildDefault: buildDefaultSecondaryHex,
                            },
                            {
                                key: 'tertiary' as const,
                                label: t('accentColors.tertiaryLabel'),
                                value: tertiaryOverride,
                                setValue: setTertiaryOverride,
                                buildDefault: buildDefaultTertiaryHex,
                            },
                        ]
                    ).map(({ key, label, value, setValue, buildDefault }) => {
                        const isOverridden = value != null;
                        const currentHex = value ?? buildDefault(brandHexForPreview);
                        const ramp = buildShadeRampPreview(currentHex);
                        return (
                            <div key={key} className="rounded-lg border border-gray-200 p-3">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-sm font-medium">{label}</span>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setValue(isOverridden ? null : buildDefault(brandHexForPreview))
                                        }
                                        className="text-xs font-medium text-primary-500 hover:underline"
                                    >
                                        {isOverridden
                                            ? t('accentColors.resetToAuto')
                                            : t('accentColors.customize')}
                                    </button>
                                </div>
                                {isOverridden && (
                                    <div className="mb-2 flex items-center gap-2">
                                        {/* design-lint-ignore: native color input — user-chosen data */}
                                        <input
                                            type="color"
                                            value={currentHex}
                                            onChange={(e) => setValue(e.target.value)}
                                            className="h-8 w-8 cursor-pointer rounded border border-gray-200 p-0"
                                            aria-label={t('accentColors.colorAriaLabel', { label })}
                                        />
                                        <MyInput
                                            inputType="text"
                                            input={currentHex}
                                            onChangeFunction={(e) => setValue(e.target.value)}
                                            size="small"
                                            className="w-28 font-mono text-xs"
                                            inputPlaceholder={t('hexColorPlaceholder')}
                                        />
                                    </div>
                                )}
                                <div className="flex overflow-hidden rounded-md">
                                    {ramp.map((swatch, i) => (
                                        // design-lint-ignore: computed per-institute ramp preview
                                        <div
                                            key={i}
                                            className="h-5 flex-1"
                                            style={{ backgroundColor: swatch }} /* design-lint-ignore: per-institute ramp preview */
                                        />
                                    ))}
                                </div>
                                {!isOverridden && (
                                    <p className="mt-1 text-xs text-neutral-400">
                                        {t('accentColors.autoDerived')}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            <Separator />

            {/* Sidebar color */}
            <section>
                <h2 className="mb-1 text-lg font-semibold">{t('sidebar.heading')}</h2>
                <p className="mb-4 text-sm text-neutral-500">{t('sidebar.description')}</p>
                <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {navPresets.map((preset) => (
                        <button
                            type="button"
                            key={preset.id}
                            onClick={() => setSelectedNavPresetId(preset.id)}
                            className={cn(
                                'flex flex-col gap-2 rounded-lg p-3 text-left shadow-sm transition-shadow hover:shadow-md',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                selectedNavPresetId === preset.id
                                    ? 'ring-2 ring-primary-500 ring-offset-2'
                                    : 'ring-1 ring-gray-200'
                            )}
                            aria-pressed={selectedNavPresetId === preset.id}
                            aria-label={t('sidebar.selectPresetAriaLabel', { label: preset.label })}
                        >
                            <span className="text-sm font-medium">{preset.label}</span>
                            <span className="text-xs text-neutral-500">{preset.description}</span>
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => {
                            setSelectedNavPresetId(CUSTOM_NAV_ID);
                            setCustomNav((prev) => prev ?? buildDefaultCustomNav(getPrimaryColorCode()));
                        }}
                        className={cn(
                            'flex flex-col gap-2 rounded-lg p-3 text-left shadow-sm transition-shadow hover:shadow-md',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                            selectedNavPresetId === CUSTOM_NAV_ID
                                ? 'ring-2 ring-primary-500 ring-offset-2'
                                : 'ring-1 ring-gray-200'
                        )}
                        aria-pressed={selectedNavPresetId === CUSTOM_NAV_ID}
                        aria-label={t('sidebar.selectCustomAriaLabel')}
                    >
                        <span className="text-sm font-medium">{t('sidebar.custom')}</span>
                        <span className="text-xs text-neutral-500">{t('sidebar.customDescription')}</span>
                    </button>
                </div>

                {selectedNavPresetId === CUSTOM_NAV_ID && (
                    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-gray-200 p-3">
                        {NAV_COLOR_FIELDS.map(({ key, label }) => {
                            const current = customNav ?? buildDefaultCustomNav(getPrimaryColorCode());
                            return (
                                <div key={key} className="flex items-center justify-between gap-3">
                                    <span className="text-sm text-neutral-700">{label}</span>
                                    <div className="flex items-center gap-2">
                                        {/* design-lint-ignore: native color input — user-chosen data */}
                                        <input
                                            type="color"
                                            value={current[key]}
                                            onChange={(e) =>
                                                setCustomNav({ ...current, [key]: e.target.value })
                                            }
                                            className="h-8 w-8 cursor-pointer rounded border border-gray-200 p-0"
                                            aria-label={t('sidebar.colorAriaLabel', { label })}
                                        />
                                        <MyInput
                                            inputType="text"
                                            input={current[key]}
                                            onChangeFunction={(e) =>
                                                setCustomNav({ ...current, [key]: e.target.value })
                                            }
                                            size="small"
                                            className="w-28 font-mono text-xs"
                                            inputPlaceholder={t('hexColorPlaceholder')}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Live sidebar mockup — self-contained, never the real sidebar. */}
                {(() => {
                    const brandHex = getPrimaryColorCode();
                    const nav =
                        selectedNavPresetId === CUSTOM_NAV_ID
                            ? (customNav ?? buildDefaultCustomNav(brandHex))
                            : ((navPresets.find((p) => p.id === selectedNavPresetId) ?? navPresets[0]!).build(
                                  brandHex
                              ) ?? buildLightNavPreview(brandHex));
                    return (
                        // design-lint-ignore: computed per-institute nav colors
                        <div
                            className="mt-3 w-48 rounded-lg p-2 shadow-sm"
                            style={{ backgroundColor: nav.surface }} /* design-lint-ignore: per-institute nav preview */
                        >
                            {[
                                t('sidebar.previewLabels.dashboard'),
                                t('sidebar.previewLabels.courses'),
                                t('sidebar.previewLabels.learners'),
                            ].map((label, i) => (
                                <div
                                    key={label}
                                    className="mb-1 rounded-md px-2 py-1.5 text-xs font-medium"
                                    // design-lint-ignore: computed per-institute nav colors
                                    style={
                                        i === 0
                                            ? { backgroundColor: nav.active, color: nav.activeText }
                                            : { color: nav.text }
                                    }
                                >
                                    {label}
                                </div>
                            ))}
                        </div>
                    );
                })()}
            </section>

            <div className="flex justify-end">
                <MyButton
                    type="button"
                    scale="large"
                    buttonType="primary"
                    layoutVariant="default"
                    onClick={handleSave}
                    disable={isSaving}
                >
                    {isSaving ? t('save.saving') : t('save.save')}
                </MyButton>
            </div>
        </div>
    );
};

export default ThemeEditor;
