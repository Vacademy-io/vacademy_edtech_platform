import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ColorPickerField } from './ColorPickerField';
import { ImageUploadField } from './ImageUploadField';
import { CATALOGUE_FONTS } from '../-utils/catalogue-fonts';
import type {
    ComponentStyle,
    TypographyStyle,
    AnimationConfig,
    AnimationEntrance,
    Component,
    SectionLayoutStyle,
    GlassConfig,
    GlowConfig,
    BorderGradientConfig,
    BackgroundLayer,
    OverlayPreset,
    DividerConfig,
    SectionDividers,
} from '../-types/editor-types';
import { ORNAMENT_PRESETS } from '../-utils/catalogue-decorations';
import type { OrnamentConfig } from '../-utils/catalogue-decorations';

interface StyleEditorProps {
    style: ComponentStyle;
    onChange: (style: ComponentStyle) => void;
}

/* ─── Collapsible Section ─────────────────────────────────────────────── */

const Section = ({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border-b border-gray-100 pb-3">
            <button
                onClick={() => setOpen(!open)}
                className="flex w-full items-center gap-1.5 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700"
            >
                {open ? <CaretDown className="size-3.5" /> : <CaretRight className="size-3.5" />}
                {title}
            </button>
            {open && <div className="flex flex-col gap-3 pl-1 pt-1">{children}</div>}
        </div>
    );
};

/* ─── Preset Button Row ───────────────────────────────────────────────── */

const PresetRow = ({ options, value, onChange, label }: { options: { label: string; value: string }[]; value?: string; onChange: (v: string) => void; label?: string }) => {
    const { t } = useTranslation('managePagesStyleEditor');
    // A stored value outside the presets (hand-authored JSON, engine defaults
    // like sticky top 88) still needs a selected state — show it as a chip so
    // the row never looks "Off" while the field is actually set.
    const opts = value && !options.some((o) => o.value === value)
        ? [...options, { label: t('presetRow.custom', { value }), value }]
        : options;
    return (
    <div>
        {label && <Label className="mb-1 text-xs">{label}</Label>}
        <div className="flex flex-wrap gap-1">
            {opts.map((o) => (
                <button
                    key={o.value}
                    onClick={() => onChange(o.value)}
                    className={`rounded px-2 py-1 text-caption font-medium transition-colors ${
                        value === o.value
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    </div>
    );
};

/* ─── Spacing presets ─────────────────────────────────────────────────── */

// Pure numeric pixel magnitudes shown verbatim in every locale (like a raw
// CSS value) — nothing here is language-bearing text, so no t() needed.
const SPACING_PRESETS = [
    { label: '0', value: '0px' },
    { label: '8', value: '8px' },
    { label: '16', value: '16px' },
    { label: '24', value: '24px' },
    { label: '32', value: '32px' },
    { label: '48', value: '48px' },
    { label: '64', value: '64px' },
    { label: '80', value: '80px' },
];

const buildShadowPresets = (t: TFunction) => [
    { label: t('borderShadow.boxShadow.options.none'), value: 'none' },
    { label: t('borderShadow.boxShadow.options.sm'), value: 'sm' },
    { label: t('borderShadow.boxShadow.options.md'), value: 'md' },
    { label: t('borderShadow.boxShadow.options.lg'), value: 'lg' },
    { label: t('borderShadow.boxShadow.options.xl'), value: 'xl' },
    { label: t('borderShadow.boxShadow.options.xxl'), value: '2xl' },
];

// Pure pixel magnitudes — see SPACING_PRESETS note above.
const FONT_SIZE_PRESETS = [
    { label: '14', value: '14px' },
    { label: '16', value: '16px' },
    { label: '18', value: '18px' },
    { label: '20', value: '20px' },
    { label: '24', value: '24px' },
    { label: '30', value: '30px' },
    { label: '36', value: '36px' },
    { label: '48', value: '48px' },
];

const buildFontWeightPresets = (t: TFunction) => [
    { label: t('typography.fontWeight.options.regular'), value: '400' },
    { label: t('typography.fontWeight.options.medium'), value: '500' },
    { label: t('typography.fontWeight.options.semi'), value: '600' },
    { label: t('typography.fontWeight.options.bold'), value: '700' },
    { label: t('typography.fontWeight.options.extra'), value: '800' },
];

// Derived from the shared registry (catalogue-fonts.ts, byte-synced with the
// learner app) so every option here is a face the learner ACTUALLY loads —
// previously choices like Playfair silently fell back to system fonts.
// Font names themselves (f.label) are proper nouns and stay untranslated;
// only the "(serif)" annotation is UI text.
const buildFontFamilies = (t: TFunction) => [
    { label: t('typography.fontFamily.default'), value: '' },
    ...CATALOGUE_FONTS.map((f) => ({
        label: f.serif ? t('typography.fontFamily.serifSuffix', { label: f.label }) : f.label,
        value: f.stack,
    })),
];

const buildEntranceTypes = (t: TFunction) => [
    { label: t('animation.entrance.options.none'), value: 'none' },
    { label: t('animation.entrance.options.fadeIn'), value: 'fadeIn' },
    { label: t('animation.entrance.options.fadeUp'), value: 'fadeInUp' },
    { label: t('animation.entrance.options.fadeDown'), value: 'fadeInDown' },
    { label: t('animation.entrance.options.fadeLeft'), value: 'fadeInLeft' },
    { label: t('animation.entrance.options.fadeRight'), value: 'fadeInRight' },
    { label: t('animation.entrance.options.scaleUp'), value: 'scaleUp' },
    { label: t('animation.entrance.options.slideUp'), value: 'slideUp' },
];

const buildHoverTypes = (t: TFunction) => [
    { label: t('animation.hover.options.none'), value: 'none' },
    { label: t('animation.hover.options.lift'), value: 'lift' },
    { label: t('animation.hover.options.glow'), value: 'glow' },
    { label: t('animation.hover.options.scale'), value: 'scale' },
    { label: t('animation.hover.options.brighten'), value: 'brighten' },
];

/* ─── Premium-effect presets (curated, token-driven — theme-safe) ────── */

const buildBorderGradientPresets = (
    t: TFunction,
): Array<{ id: string; label: string; value?: BorderGradientConfig }> => [
    { id: '', label: t('premiumEffects.borderGradient.options.off') },
    {
        id: 'primary',
        label: t('premiumEffects.borderGradient.options.primary'),
        value: { from: 'hsl(var(--primary-400))', to: 'hsl(var(--primary-200))', angle: 135 },
    },
    {
        id: 'primary-bold',
        label: t('premiumEffects.borderGradient.options.bold'),
        value: { from: 'hsl(var(--primary-500))', to: 'hsl(var(--primary-200))', angle: 135, width: '2px' },
    },
    {
        id: 'aurora',
        label: t('premiumEffects.borderGradient.options.aurora'),
        value: { from: 'hsl(var(--primary-400))', to: 'hsl(258 90% 66%)', angle: 120 },
    },
];

const buildMeshPresets = (
    t: TFunction,
): Array<{ id: string; label: string; layers?: BackgroundLayer[] }> => [
    { id: '', label: t('premiumEffects.meshBackground.options.off') },
    {
        id: 'mesh-soft',
        label: t('premiumEffects.meshBackground.options.soft'),
        layers: [
            { type: 'radial', color: 'hsl(var(--primary-200) / 0.45)', posX: '85%', posY: '0%', size: '60%' },
            { type: 'radial', color: 'hsl(var(--primary-100) / 0.5)', posX: '0%', posY: '100%', size: '55%' },
        ],
    },
    {
        id: 'mesh-bold',
        label: t('premiumEffects.meshBackground.options.bold'),
        layers: [
            { type: 'radial', color: 'hsl(var(--primary-400) / 0.35)', posX: '80%', posY: '10%', size: '55%' },
            { type: 'radial', color: 'hsl(var(--primary-200) / 0.45)', posX: '10%', posY: '90%', size: '60%' },
        ],
    },
    {
        id: 'aurora',
        label: t('premiumEffects.meshBackground.options.aurora'),
        layers: [
            { type: 'radial', color: 'hsl(var(--primary-400) / 0.3)', posX: '20%', posY: '0%', size: '50%' },
            { type: 'radial', color: 'hsl(258 90% 66% / 0.22)', posX: '80%', posY: '20%', size: '55%' },
            { type: 'radial', color: 'hsl(199 89% 48% / 0.18)', posX: '50%', posY: '100%', size: '60%' },
        ],
    },
];

/** Which curated preset (if any) the stored value corresponds to. */
const activeBorderGradientId = (
    value: BorderGradientConfig | undefined,
    presets: Array<{ id: string; label: string; value?: BorderGradientConfig }>,
): string => {
    if (!value) return '';
    const match = presets.find(
        (p) => p.value && JSON.stringify(p.value) === JSON.stringify(value),
    );
    return match?.id ?? 'custom';
};

const activeMeshId = (
    layers: BackgroundLayer[] | undefined,
    presets: Array<{ id: string; label: string; layers?: BackgroundLayer[] }>,
): string => {
    if (!layers?.length) return '';
    const match = presets.find(
        (p) => p.layers && JSON.stringify(p.layers) === JSON.stringify(layers),
    );
    return match?.id ?? 'custom';
};

const activeOrnamentId = (ornaments?: OrnamentConfig[]): string => {
    if (!ornaments?.length) return '';
    const match = ORNAMENT_PRESETS.find(
        (p) => JSON.stringify(p.ornaments) === JSON.stringify(ornaments),
    );
    return match?.id ?? 'custom';
};

/* ─── Main StyleEditor ────────────────────────────────────────────────── */

export const StyleEditor = ({ style, onChange }: StyleEditorProps) => {
    const { t } = useTranslation('managePagesStyleEditor');

    const update = (partial: Partial<ComponentStyle>) => {
        onChange({ ...style, ...partial });
    };

    const updateTypography = (partial: Partial<TypographyStyle>) => {
        onChange({ ...style, typography: { ...style.typography, ...partial } });
    };

    const updateAnimation = (partial: Partial<AnimationConfig>) => {
        onChange({ ...style, animation: { ...style.animation, ...partial } });
    };

    const updateLayout = (partial: Partial<SectionLayoutStyle>) => {
        const merged = { ...style.layout, ...partial };
        // Dropping every value returns the component to legacy single-node
        // rendering — important for back-compat, so scrub empty objects.
        const cleaned = Object.fromEntries(
            Object.entries(merged).filter(([, v]) => v !== undefined && v !== '' && v !== null),
        );
        onChange({ ...style, layout: Object.keys(cleaned).length ? (cleaned as SectionLayoutStyle) : undefined });
    };

    const shadowPresets = buildShadowPresets(t);
    const fontWeightPresets = buildFontWeightPresets(t);
    const fontFamilies = buildFontFamilies(t);
    const entranceTypes = buildEntranceTypes(t);
    const hoverTypes = buildHoverTypes(t);
    const borderGradientPresets = buildBorderGradientPresets(t);
    const meshPresets = buildMeshPresets(t);

    return (
        <div className="flex flex-col gap-1">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {t('design.heading')}
            </div>

            {/* ─── Spacing ─────────────────────────────────────────── */}
            <Section title={t('sections.spacing')} defaultOpen={false}>
                <PresetRow
                    label={t('spacing.paddingTop')}
                    options={SPACING_PRESETS}
                    value={style.paddingTop}
                    onChange={(v) => update({ paddingTop: v })}
                />
                <PresetRow
                    label={t('spacing.paddingBottom')}
                    options={SPACING_PRESETS}
                    value={style.paddingBottom}
                    onChange={(v) => update({ paddingBottom: v })}
                />
                <PresetRow
                    label={t('spacing.paddingLeft')}
                    options={SPACING_PRESETS}
                    value={style.paddingLeft}
                    onChange={(v) => update({ paddingLeft: v })}
                />
                <PresetRow
                    label={t('spacing.paddingRight')}
                    options={SPACING_PRESETS}
                    value={style.paddingRight}
                    onChange={(v) => update({ paddingRight: v })}
                />
                <PresetRow
                    label={t('spacing.marginTop')}
                    options={SPACING_PRESETS}
                    value={style.marginTop}
                    onChange={(v) => update({ marginTop: v })}
                />
                <PresetRow
                    label={t('spacing.marginBottom')}
                    options={SPACING_PRESETS}
                    value={style.marginBottom}
                    onChange={(v) => update({ marginBottom: v })}
                />
            </Section>

            {/* ─── Layout & Width (section shell) ──────────────────── */}
            <Section title={t('sections.layoutWidth')}>
                <p className="text-caption text-gray-500">
                    {t('layoutWidth.description')}
                </p>
                <PresetRow
                    label={t('layoutWidth.contentWidth.label')}
                    options={[
                        { label: t('layoutWidth.contentWidth.options.off'), value: '' },
                        { label: t('layoutWidth.contentWidth.options.text'), value: 'text' },
                        { label: t('layoutWidth.contentWidth.options.narrow'), value: 'narrow' },
                        { label: t('layoutWidth.contentWidth.options.default'), value: 'default' },
                        { label: t('layoutWidth.contentWidth.options.wide'), value: 'wide' },
                        { label: t('layoutWidth.contentWidth.options.full'), value: 'full' },
                    ]}
                    value={style.layout?.width ?? (style.layout ? 'default' : '')}
                    onChange={(v) =>
                        v === ''
                            ? onChange({ ...style, layout: undefined })
                            : updateLayout({ width: v as SectionLayoutStyle['width'] })
                    }
                />
                {style.layout && (
                    <>
                        <div>
                            <Label className="mb-1 text-xs">{t('layoutWidth.customMaxWidth.label')}</Label>
                            <Input
                                value={style.layout?.contentMaxWidth ?? ''}
                                placeholder={t('layoutWidth.customMaxWidth.placeholder')}
                                onChange={(e) => updateLayout({ contentMaxWidth: e.target.value || undefined })}
                                className="h-8 text-xs"
                            />
                        </div>
                        <PresetRow
                            label={t('layoutWidth.overlapTop.label')}
                            options={[
                                { label: t('layoutWidth.overlapTop.options.none'), value: '' },
                                { label: '-40px', value: '-40px' },
                                { label: '-80px', value: '-80px' },
                                { label: '-120px', value: '-120px' },
                            ]}
                            value={style.layout?.overlapTop ?? ''}
                            onChange={(v) => updateLayout({ overlapTop: v || undefined })}
                        />
                        <PresetRow
                            label={t('layoutWidth.zIndex.label')}
                            options={[
                                { label: t('layoutWidth.zIndex.options.auto'), value: '' },
                                { label: '1', value: '1' },
                                { label: '2', value: '2' },
                                { label: '3', value: '3' },
                            ]}
                            value={style.layout?.zIndex !== undefined ? String(style.layout.zIndex) : ''}
                            onChange={(v) => updateLayout({ zIndex: v === '' ? undefined : Number(v) })}
                        />
                        <p className="text-caption text-gray-400">
                            {t('layoutWidth.overlapHint')}
                        </p>
                    </>
                )}
                <PresetRow
                    label={t('layoutWidth.minHeight.label')}
                    options={[
                        { label: t('layoutWidth.minHeight.options.off'), value: '' },
                        { label: '60vh', value: '60vh' },
                        { label: '80vh', value: '80vh' },
                        { label: t('layoutWidth.minHeight.options.fullScreen'), value: '100svh' },
                    ]}
                    value={style.minHeight ?? ''}
                    onChange={(v) => update({ minHeight: v || undefined, ...(v ? {} : { contentAlign: undefined }) })}
                />
                {style.minHeight && (
                    <PresetRow
                        label={t('layoutWidth.verticalAlign.label')}
                        options={[
                            { label: t('layoutWidth.verticalAlign.options.top'), value: 'start' },
                            { label: t('layoutWidth.verticalAlign.options.center'), value: 'center' },
                            { label: t('layoutWidth.verticalAlign.options.bottom'), value: 'end' },
                        ]}
                        value={style.contentAlign ?? 'start'}
                        onChange={(v) => update({ contentAlign: v === 'start' ? undefined : (v as ComponentStyle['contentAlign']) })}
                    />
                )}
                <PresetRow
                    label={t('layoutWidth.sticky.label')}
                    options={[
                        { label: t('layoutWidth.sticky.options.off'), value: '' },
                        { label: t('layoutWidth.sticky.options.top80'), value: '80' },
                        { label: t('layoutWidth.sticky.options.top96'), value: '96' },
                        { label: t('layoutWidth.sticky.options.top120'), value: '120' },
                    ]}
                    value={style.sticky?.enabled ? String(style.sticky.top ?? 88) : ''}
                    onChange={(v) => update({ sticky: v ? { enabled: true, top: Number(v) } : undefined })}
                />
                {style.sticky?.enabled && (
                    <p className="text-caption text-gray-400">
                        {t('layoutWidth.sticky.hint')}
                    </p>
                )}
            </Section>

            {/* ─── Background ──────────────────────────────────────── */}
            <Section title={t('sections.background')}>
                <ColorPickerField
                    label={t('background.color.label')}
                    value={style.backgroundColor || '#ffffff'} // design-lint-ignore: color-editor default seed
                    onChange={(c) => update({ backgroundColor: c })}
                />
                <ImageUploadField slot="background"
                    label={t('background.image.label')}
                    value={style.backgroundImage || ''}
                    onChange={(url) => update({ backgroundImage: url })}
                    placeholder={t('background.image.placeholder')}
                />
                {style.backgroundImage && (
                    <>
                        <PresetRow
                            label={t('background.size.label')}
                            options={[
                                { label: t('background.size.options.cover'), value: 'cover' },
                                { label: t('background.size.options.contain'), value: 'contain' },
                                { label: t('background.size.options.auto'), value: 'auto' },
                            ]}
                            value={style.backgroundSize || 'cover'}
                            onChange={(v) => update({ backgroundSize: v as 'cover' | 'contain' | 'auto' })}
                        />
                        <ColorPickerField
                            label={t('background.overlayColor.label')}
                            value={style.backgroundOverlay || 'rgba(0,0,0,0)'}
                            onChange={(c) => update({ backgroundOverlay: c, overlayPreset: undefined })}
                        />
                    </>
                )}
                {/* Gradient toggle */}
                <div>
                    <Label className="mb-1 text-xs">{t('background.gradient.label')}</Label>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                if (style.gradient) {
                                    update({ gradient: undefined });
                                } else {
                                    update({
                                        gradient: {
                                            type: 'linear',
                                            angle: 180,
                                            stops: [
                                                { color: '#3B82F6', position: 0 }, // design-lint-ignore: gradient preset seed
                                                { color: '#8B5CF6', position: 100 }, // design-lint-ignore: gradient preset seed
                                            ],
                                        },
                                    });
                                }
                            }}
                            className={`rounded px-2 py-1 text-caption font-medium ${
                                style.gradient ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                            }`}
                        >
                            {style.gradient ? t('background.gradient.enabled') : t('background.gradient.off')}
                        </button>
                    </div>
                </div>
                {style.gradient && (
                    <div className="flex flex-col gap-2 rounded border border-gray-100 bg-gray-50 p-2">
                        <PresetRow
                            label={t('background.gradient.type.label')}
                            options={[
                                { label: t('background.gradient.type.options.linear'), value: 'linear' },
                                { label: t('background.gradient.type.options.radial'), value: 'radial' },
                            ]}
                            value={style.gradient.type}
                            onChange={(v) => update({ gradient: { ...style.gradient!, type: v as 'linear' | 'radial' } })}
                        />
                        {style.gradient.type === 'linear' && (
                            <div>
                                <Label className="text-xs">{t('background.gradient.angle.label', { angle: style.gradient.angle ?? 180 })}</Label>
                                <input
                                    type="range"
                                    min={0}
                                    max={360}
                                    value={style.gradient.angle ?? 180}
                                    onChange={(e) =>
                                        update({ gradient: { ...style.gradient!, angle: Number(e.target.value) } })
                                    }
                                    className="w-full"
                                />
                            </div>
                        )}
                        {style.gradient.stops.map((stop, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <ColorPickerField
                                    label={t('background.gradient.stop.label', { index: i + 1 })}
                                    value={stop.color}
                                    onChange={(c) => {
                                        const newStops = [...style.gradient!.stops];
                                        newStops[i] = { ...newStops[i]!, color: c };
                                        update({ gradient: { ...style.gradient!, stops: newStops } });
                                    }}
                                />
                                <div className="flex-shrink-0">
                                    <Label className="text-xs">{stop.position}%</Label>
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        value={stop.position}
                                        onChange={(e) => {
                                            const newStops = [...style.gradient!.stops];
                                            newStops[i] = { ...newStops[i]!, position: Number(e.target.value) };
                                            update({ gradient: { ...style.gradient!, stops: newStops } });
                                        }}
                                        className="w-20"
                                    />
                                </div>
                            </div>
                        ))}
                        {style.gradient.stops.length < 4 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs"
                                onClick={() => {
                                    const newStops = [...style.gradient!.stops, { color: '#10B981', position: 50 }]; // design-lint-ignore: gradient preset seed
                                    update({ gradient: { ...style.gradient!, stops: newStops } });
                                }}
                            >
                                {t('background.gradient.addStop')}
                            </Button>
                        )}
                    </div>
                )}
            </Section>

            {/* ─── Border & Shadow ─────────────────────────────────── */}
            <Section title={t('sections.borderShadow')}>
                <div>
                    <Label className="mb-1 text-xs">{t('borderShadow.borderWidth.label')}</Label>
                    <div className="flex flex-wrap gap-1">
                        {['0', '1px', '2px', '3px', '4px'].map((v) => (
                            <button
                                key={v}
                                onClick={() => update({ borderWidth: v })}
                                className={`rounded px-2 py-1 text-caption font-medium ${
                                    (style.borderWidth || '0') === v
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                {v}
                            </button>
                        ))}
                    </div>
                </div>
                {style.borderWidth && style.borderWidth !== '0' && (
                    <>
                        <ColorPickerField
                            label={t('borderShadow.borderColor.label')}
                            value={style.borderColor || '#E5E7EB'} // design-lint-ignore: color-editor default seed
                            onChange={(c) => update({ borderColor: c })}
                        />
                        <PresetRow
                            label={t('borderShadow.borderStyle.label')}
                            options={[
                                { label: t('borderShadow.borderStyle.options.solid'), value: 'solid' },
                                { label: t('borderShadow.borderStyle.options.dashed'), value: 'dashed' },
                                { label: t('borderShadow.borderStyle.options.dotted'), value: 'dotted' },
                            ]}
                            value={style.borderStyle || 'solid'}
                            onChange={(v) => update({ borderStyle: v as 'solid' | 'dashed' | 'dotted' })}
                        />
                    </>
                )}
                <div>
                    <Label className="mb-1 text-xs">{t('borderShadow.borderRadius.label')}</Label>
                    <div className="flex flex-wrap gap-1">
                        {[
                            { label: t('borderShadow.borderRadius.options.none'), value: '0' },
                            { label: '4px', value: '4px' },
                            { label: '8px', value: '8px' },
                            { label: '12px', value: '12px' },
                            { label: '16px', value: '16px' },
                            { label: '24px', value: '24px' },
                            { label: t('borderShadow.borderRadius.options.full'), value: '9999px' },
                        ].map((o) => (
                            <button
                                key={o.value}
                                onClick={() => update({ borderRadius: o.value })}
                                className={`rounded px-2 py-1 text-caption font-medium ${
                                    style.borderRadius === o.value
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                </div>
                <PresetRow
                    label={t('borderShadow.boxShadow.label')}
                    options={shadowPresets}
                    value={style.boxShadow || 'none'}
                    onChange={(v) => update({ boxShadow: v as ComponentStyle['boxShadow'] })}
                />
            </Section>

            {/* ─── Effects ─────────────────────────────────────────── */}
            {/* ─── Premium Effects (engine: glass/glow/borderGradient/layers) ── */}
            <Section title={t('sections.premiumEffects')}>
                <PresetRow
                    label={t('premiumEffects.glassSurface.label')}
                    options={[
                        { label: t('premiumEffects.glassSurface.options.off'), value: '' },
                        { label: t('premiumEffects.glassSurface.options.subtle'), value: 'sm' },
                        { label: t('premiumEffects.glassSurface.options.medium'), value: 'md' },
                        { label: t('premiumEffects.glassSurface.options.strong'), value: 'lg' },
                    ]}
                    value={style.glass?.blur ?? ''}
                    onChange={(v) =>
                        update({ glass: v ? { ...style.glass, blur: v as GlassConfig['blur'] } : undefined })
                    }
                />
                <PresetRow
                    label={t('premiumEffects.glow.label')}
                    options={[
                        { label: t('premiumEffects.glow.options.off'), value: '' },
                        { label: t('premiumEffects.glow.options.soft'), value: 'sm' },
                        { label: t('premiumEffects.glow.options.medium'), value: 'md' },
                        { label: t('premiumEffects.glow.options.bold'), value: 'lg' },
                    ]}
                    value={style.glow?.intensity ?? ''}
                    onChange={(v) =>
                        update({ glow: v ? { ...style.glow, intensity: v as GlowConfig['intensity'] } : undefined })
                    }
                />
                <PresetRow
                    label={t('premiumEffects.borderGradient.label')}
                    options={borderGradientPresets.map((p) => ({ label: p.label, value: p.id }))}
                    value={activeBorderGradientId(style.borderGradient, borderGradientPresets)}
                    onChange={(v) => {
                        const preset = borderGradientPresets.find((p) => p.id === v);
                        update({ borderGradient: preset?.value ?? undefined });
                    }}
                />
                {style.borderGradient && (
                    <p className="text-caption text-gray-400">
                        {t('premiumEffects.borderGradient.hint')}
                    </p>
                )}
                <PresetRow
                    label={t('premiumEffects.meshBackground.label')}
                    options={meshPresets.map((p) => ({ label: p.label, value: p.id }))}
                    value={activeMeshId(style.backgroundLayers, meshPresets)}
                    onChange={(v) => {
                        const preset = meshPresets.find((p) => p.id === v);
                        update({ backgroundLayers: preset?.layers ?? undefined });
                    }}
                />
                {!!style.backgroundImage && !style.backgroundLayers?.length && !style.gradient && !style.borderGradient && (
                    <PresetRow
                        label={t('premiumEffects.imageOverlay.label')}
                        options={[
                            { label: t('premiumEffects.imageOverlay.options.off'), value: '' },
                            { label: t('premiumEffects.imageOverlay.options.scrim'), value: 'scrim-dark' },
                            { label: t('premiumEffects.imageOverlay.options.bottom'), value: 'scrim-bottom' },
                            { label: t('premiumEffects.imageOverlay.options.light'), value: 'scrim-light' },
                            { label: t('premiumEffects.imageOverlay.options.brand'), value: 'brand-tint' },
                        ]}
                        value={style.overlayPreset ?? ''}
                        onChange={(v) =>
                            // Mutually exclusive with the legacy Overlay Color
                            // (both together would double-darken the image).
                            update({
                                overlayPreset: v ? (v as OverlayPreset) : undefined,
                                backgroundOverlay: v ? undefined : style.backgroundOverlay,
                            })
                        }
                    />
                )}
            </Section>

            {/* ─── Decorations (ornaments + section-edge dividers) ─── */}
            <Section title={t('sections.decorations')}>
                <PresetRow
                    label={t('decorations.ornaments.label')}
                    options={[
                        { label: t('decorations.ornaments.off'), value: '' },
                        ...ORNAMENT_PRESETS.map((p) => ({ label: p.label, value: p.id })),
                    ]}
                    value={activeOrnamentId(style.ornaments)}
                    onChange={(v) => {
                        const preset = ORNAMENT_PRESETS.find((p) => p.id === v);
                        update({ ornaments: preset ? preset.ornaments : undefined });
                    }}
                />
                <p className="text-caption text-gray-500">
                    {t('decorations.ornamentsHint')}
                </p>
                {(['top', 'bottom'] as const).map((edge) => (
                    <PresetRow
                        key={edge}
                        label={edge === 'top' ? t('decorations.divider.labelTop') : t('decorations.divider.labelBottom')}
                        options={[
                            { label: t('decorations.divider.options.off'), value: '' },
                            { label: t('decorations.divider.options.wave'), value: 'wave' },
                            { label: t('decorations.divider.options.angle'), value: 'angle' },
                            { label: t('decorations.divider.options.curve'), value: 'curve' },
                        ]}
                        value={style.dividers?.[edge]?.shape ?? ''}
                        onChange={(v) => {
                            const next: SectionDividers = { ...style.dividers };
                            if (v) {
                                // Seed height from the other edge so the shared
                                // Height row's selection is true for both edges
                                const other = next[edge === 'top' ? 'bottom' : 'top'];
                                next[edge] = { ...next[edge], shape: v as DividerConfig['shape'], height: next[edge]?.height ?? other?.height };
                            } else delete next[edge];
                            update({ dividers: next.top || next.bottom ? next : undefined });
                        }}
                    />
                ))}
                {(style.dividers?.top || style.dividers?.bottom) && (
                    <>
                        <PresetRow
                            label={t('decorations.dividerHeight.label')}
                            options={[
                                { label: t('decorations.dividerHeight.options.s'), value: '48' },
                                { label: t('decorations.dividerHeight.options.m'), value: '72' },
                                { label: t('decorations.dividerHeight.options.l'), value: '96' },
                            ]}
                            value={String(style.dividers?.bottom?.height ?? style.dividers?.top?.height ?? 72)}
                            onChange={(v) => {
                                const h = Number(v);
                                const next: SectionDividers = { ...style.dividers };
                                if (next.top) next.top = { ...next.top, height: h };
                                if (next.bottom) next.bottom = { ...next.bottom, height: h };
                                update({ dividers: next });
                            }}
                        />
                        <p className="text-caption text-gray-500">
                            {t('decorations.dividerHeight.hint')}
                        </p>
                    </>
                )}
            </Section>

            <Section title={t('sections.effects')}>
                <div>
                    <Label className="mb-1 text-xs">{t('effects.opacity.label', { percent: Math.round((style.opacity ?? 1) * 100) })}</Label>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round((style.opacity ?? 1) * 100)}
                        onChange={(e) => update({ opacity: Number(e.target.value) / 100 })}
                        className="w-full"
                    />
                </div>
                <div>
                    <Label className="mb-1 text-xs">{t('effects.maxWidth.label')}</Label>
                    {style.layout ? (
                        <p className="text-caption text-gray-500">
                            {t('effects.maxWidth.layoutHint')}
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-1">
                            {[
                                { label: t('effects.maxWidth.options.none'), value: '' },
                                { label: '800px', value: '800px' },
                                { label: '1024px', value: '1024px' },
                                { label: '1200px', value: '1200px' },
                                { label: '1400px', value: '1400px' },
                                { label: '100%', value: '100%' },
                            ].map((o) => (
                                <button
                                    key={o.value}
                                    onClick={() => update({ maxWidth: o.value || undefined })}
                                    className={`rounded px-2 py-1 text-caption font-medium ${
                                        (style.maxWidth || '') === o.value
                                            ? 'bg-blue-100 text-blue-700'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                >
                                    {o.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div>
                    <Label className="mb-1 text-xs">{t('effects.minHeight.label')}</Label>
                    <Input
                        value={style.minHeight || ''}
                        onChange={(e) => {
                            const v = e.target.value;
                            // Clearing min-height orphans contentAlign (engine only
                            // emits it alongside minHeight) — drop both together
                            update({ minHeight: v || undefined, ...(v ? {} : { contentAlign: undefined }) });
                        }}
                        placeholder={t('effects.minHeight.placeholder')}
                        className="h-8 text-xs"
                    />
                </div>
                <div>
                    <Label className="mb-1 text-xs">{t('effects.customClass.label')}</Label>
                    <Input
                        value={style.customClass || ''}
                        onChange={(e) => update({ customClass: e.target.value || undefined })}
                        placeholder={t('effects.customClass.placeholder')}
                        className="h-8 text-xs"
                    />
                </div>
            </Section>

            {/* ─── Typography ──────────────────────────────────────── */}
            <Section title={t('sections.typography')}>
                <div>
                    <Label className="mb-1 text-xs">{t('typography.fontFamily.label')}</Label>
                    <select
                        value={style.typography?.fontFamily || ''}
                        onChange={(e) => updateTypography({ fontFamily: e.target.value || undefined })}
                        className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs"
                    >
                        {fontFamilies.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                    </select>
                </div>
                <PresetRow
                    label={t('typography.fontSize.label')}
                    options={FONT_SIZE_PRESETS}
                    value={style.typography?.fontSize}
                    onChange={(v) => updateTypography({ fontSize: v })}
                />
                <PresetRow
                    label={t('typography.fontWeight.label')}
                    options={fontWeightPresets}
                    value={style.typography?.fontWeight}
                    onChange={(v) => updateTypography({ fontWeight: v as TypographyStyle['fontWeight'] })}
                />
                <div>
                    <Label className="mb-1 text-xs">{t('typography.lineHeight.label', { value: style.typography?.lineHeight || '1.5' })}</Label>
                    <input
                        type="range"
                        min={100}
                        max={250}
                        step={10}
                        value={Math.round(parseFloat(style.typography?.lineHeight || '1.5') * 100)}
                        onChange={(e) => updateTypography({ lineHeight: (Number(e.target.value) / 100).toFixed(1) })}
                        className="w-full"
                    />
                </div>
                <div>
                    <Label className="mb-1 text-xs">{t('typography.letterSpacing.label')}</Label>
                    <div className="flex flex-wrap gap-1">
                        {[
                            { label: t('typography.letterSpacing.options.tight'), value: '-0.02em' },
                            { label: t('typography.letterSpacing.options.normal'), value: '0' },
                            { label: t('typography.letterSpacing.options.wide'), value: '0.05em' },
                            { label: t('typography.letterSpacing.options.wider'), value: '0.1em' },
                        ].map((o) => (
                            <button
                                key={o.value}
                                onClick={() => updateTypography({ letterSpacing: o.value })}
                                className={`rounded px-2 py-1 text-caption font-medium ${
                                    (style.typography?.letterSpacing || '0') === o.value
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                </div>
                <ColorPickerField
                    label={t('typography.textColor.label')}
                    value={style.typography?.textColor || '#000000'} // design-lint-ignore: color-editor default seed
                    onChange={(c) => updateTypography({ textColor: c })}
                />
                <PresetRow
                    label={t('typography.textAlign.label')}
                    options={[
                        { label: t('typography.textAlign.options.left'), value: 'left' },
                        { label: t('typography.textAlign.options.center'), value: 'center' },
                        { label: t('typography.textAlign.options.right'), value: 'right' },
                    ]}
                    value={style.typography?.textAlign}
                    onChange={(v) => updateTypography({ textAlign: v as TypographyStyle['textAlign'] })}
                />
                <PresetRow
                    label={t('typography.textTransform.label')}
                    options={[
                        { label: t('typography.textTransform.options.none'), value: 'none' },
                        { label: t('typography.textTransform.options.upper'), value: 'uppercase' },
                        { label: t('typography.textTransform.options.lower'), value: 'lowercase' },
                        { label: t('typography.textTransform.options.title'), value: 'capitalize' },
                    ]}
                    value={style.typography?.textTransform}
                    onChange={(v) => updateTypography({ textTransform: v as TypographyStyle['textTransform'] })}
                />
            </Section>

            {/* ─── Animation ───────────────────────────────────────── */}
            <Section title={t('sections.animation')}>
                <div>
                    <Label className="mb-1 text-xs">{t('animation.entrance.label')}</Label>
                    <select
                        value={style.animation?.entrance?.type || 'none'}
                        onChange={(e) =>
                            updateAnimation({
                                entrance: {
                                    ...style.animation?.entrance,
                                    type: e.target.value as AnimationEntrance['type'],
                                },
                            })
                        }
                        className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs"
                    >
                        {entranceTypes.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>
                {style.animation?.entrance?.type && style.animation.entrance.type !== 'none' && (
                    <>
                        <PresetRow
                            label={t('animation.stagger.label')}
                            options={[
                                { label: t('animation.stagger.options.off'), value: '' },
                                { label: t('animation.stagger.options.fast'), value: '60' },
                                { label: t('animation.stagger.options.normal'), value: '100' },
                                { label: t('animation.stagger.options.slow'), value: '160' },
                            ]}
                            value={String(style.animation.entrance.stagger?.interval ?? '')}
                            onChange={(v) =>
                                updateAnimation({
                                    entrance: {
                                        ...style.animation!.entrance!,
                                        stagger: v ? { interval: Number(v) } : undefined,
                                    },
                                })
                            }
                        />
                        <div>
                            <Label className="mb-1 text-xs">
                                {t('animation.duration.label', { ms: style.animation.entrance.duration ?? 600 })}
                            </Label>
                            <input
                                type="range"
                                min={200}
                                max={2000}
                                step={100}
                                value={style.animation.entrance.duration ?? 600}
                                onChange={(e) =>
                                    updateAnimation({
                                        entrance: { ...style.animation!.entrance!, duration: Number(e.target.value) },
                                    })
                                }
                                className="w-full"
                            />
                        </div>
                        <div>
                            <Label className="mb-1 text-xs">
                                {t('animation.delay.label', { ms: style.animation.entrance.delay ?? 0 })}
                            </Label>
                            <input
                                type="range"
                                min={0}
                                max={1000}
                                step={50}
                                value={style.animation.entrance.delay ?? 0}
                                onChange={(e) =>
                                    updateAnimation({
                                        entrance: { ...style.animation!.entrance!, delay: Number(e.target.value) },
                                    })
                                }
                                className="w-full"
                            />
                        </div>
                        <PresetRow
                            label={t('animation.easing.label')}
                            options={[
                                { label: t('animation.easing.options.ease'), value: 'ease' },
                                { label: t('animation.easing.options.easeIn'), value: 'ease-in' },
                                { label: t('animation.easing.options.easeOut'), value: 'ease-out' },
                                { label: t('animation.easing.options.easeInOut'), value: 'ease-in-out' },
                            ]}
                            value={style.animation.entrance.easing || 'ease-out'}
                            onChange={(v) =>
                                updateAnimation({
                                    entrance: { ...style.animation!.entrance!, easing: v as 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' },
                                })
                            }
                        />
                    </>
                )}
                <PresetRow
                    label={t('animation.hover.label')}
                    options={hoverTypes}
                    value={style.animation?.hover?.type || 'none'}
                    onChange={(v) => updateAnimation({ hover: { type: v as 'none' | 'lift' | 'glow' | 'scale' | 'brighten' } })}
                />
            </Section>

            {/* ─── Responsive Visibility ───────────────────────────── */}
            <Section title={t('sections.visibility')}>
                <div className="flex flex-col gap-2">
                    {(['desktop', 'tablet', 'mobile'] as const).map((vp) => (
                        <label key={vp} className="flex items-center gap-2 text-xs">
                            <input
                                type="checkbox"
                                checked={style.visibility?.[vp] !== false}
                                onChange={(e) =>
                                    update({
                                        visibility: {
                                            ...style.visibility,
                                            [vp]: e.target.checked,
                                        },
                                    })
                                }
                                className="rounded"
                            />
                            <span className="capitalize">{t(`visibility.viewports.${vp}`)}</span>
                        </label>
                    ))}
                </div>
            </Section>
        </div>
    );
};
