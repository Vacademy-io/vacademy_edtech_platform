import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    DndContext,
    DragEndEvent,
    DragStartEvent,
    DragOverlay,
    useSensor,
    useSensors,
    PointerSensor,
    useDraggable,
    useDroppable,
} from '@dnd-kit/core';
import {
    CaretDown,
    CaretUp,
    Trash,
    Eye,
    EyeSlash,
    Plus,
    TextT,
    Code,
    Rows,
    Layout,
    SquareHalf,
    SquareHalfBottom,
    DotsSixVertical,
    List,
    PuzzlePiece,
    ChartBar,
    Quotes,
    Question,
    PlayCircle,
    Megaphone,
    Sparkle,
    ListNumbers,
    Image,
    Monitor,
    DeviceTablet,
    DeviceMobile,
    X,
} from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { renderComponentPreview } from '../../-components/ComponentPreviews';
import { getComponentTemplate } from '../../-utils/component-templates';
import { ImageUploadField } from '../../-components/ImageUploadField';
import { RichTextField } from '../../-components/RichTextField';
import { ComponentDesignPanel, buildComponentStyle } from '../../-components/ComponentDesignPanel';
import type { Component } from '../../-types/editor-types';
import type { PageJson } from '../-types/product-page-types';

// ─── Supported component types for the product page palette ──────────────────

type ProductPageType =
    | 'header'
    | 'heroSection'
    | 'productCourseGrid'
    | 'textBlock'
    | 'imageBlock'
    | 'htmlBlock'
    | 'footer'
    | 'statsHighlights'
    | 'testimonialSection'
    | 'faqSection'
    | 'videoEmbed'
    | 'ctaBanner'
    | 'featureGrid'
    | 'stepsProcess'
    | 'marquee';

type PaletteGroup = 'layout' | 'course' | 'content' | 'marketing';

type PaletteEntry = {
    type: ProductPageType;
    label: string;
    icon: React.ReactNode;
    description: string;
    group: PaletteGroup;
};

/**
 * Built from `t` (not a module-level constant) so labels/descriptions stay
 * translated. `group` is an internal id used only for filtering — its
 * display text is looked up separately via `buildGroupLabels`.
 */
const buildComponentPalette = (t: TFunction): PaletteEntry[] => [
    { type: 'header', label: t('palette.header.label'), icon: <SquareHalf className="size-4" />, description: t('palette.header.description'), group: 'layout' },
    { type: 'heroSection', label: t('palette.heroSection.label'), icon: <Layout className="size-4" />, description: t('palette.heroSection.description'), group: 'layout' },
    { type: 'footer', label: t('palette.footer.label'), icon: <SquareHalfBottom className="size-4" />, description: t('palette.footer.description'), group: 'layout' },
    { type: 'productCourseGrid', label: t('palette.productCourseGrid.label'), icon: <Rows className="size-4" />, description: t('palette.productCourseGrid.description'), group: 'course' },
    { type: 'textBlock', label: t('palette.textBlock.label'), icon: <TextT className="size-4" />, description: t('palette.textBlock.description'), group: 'content' },
    { type: 'imageBlock', label: t('palette.imageBlock.label'), icon: <Image className="size-4" />, description: t('palette.imageBlock.description'), group: 'content' },
    { type: 'videoEmbed', label: t('palette.videoEmbed.label'), icon: <PlayCircle className="size-4" />, description: t('palette.videoEmbed.description'), group: 'content' },
    { type: 'htmlBlock', label: t('palette.htmlBlock.label'), icon: <Code className="size-4" />, description: t('palette.htmlBlock.description'), group: 'content' },
    { type: 'statsHighlights', label: t('palette.statsHighlights.label'), icon: <ChartBar className="size-4" />, description: t('palette.statsHighlights.description'), group: 'marketing' },
    { type: 'testimonialSection', label: t('palette.testimonialSection.label'), icon: <Quotes className="size-4" />, description: t('palette.testimonialSection.description'), group: 'marketing' },
    { type: 'faqSection', label: t('palette.faqSection.label'), icon: <Question className="size-4" />, description: t('palette.faqSection.description'), group: 'marketing' },
    { type: 'ctaBanner', label: t('palette.ctaBanner.label'), icon: <Megaphone className="size-4" />, description: t('palette.ctaBanner.description'), group: 'marketing' },
    { type: 'featureGrid', label: t('palette.featureGrid.label'), icon: <Sparkle className="size-4" />, description: t('palette.featureGrid.description'), group: 'marketing' },
    { type: 'stepsProcess', label: t('palette.stepsProcess.label'), icon: <ListNumbers className="size-4" />, description: t('palette.stepsProcess.description'), group: 'marketing' },
    { type: 'marquee', label: t('palette.marquee.label'), icon: <List className="size-4" />, description: t('palette.marquee.description'), group: 'marketing' },
];

const GROUP_IDS: PaletteGroup[] = ['layout', 'course', 'content', 'marketing'];

const buildGroupLabels = (t: TFunction): Record<PaletteGroup, string> => ({
    layout: t('groups.layout'),
    course: t('groups.course'),
    content: t('groups.content'),
    marketing: t('groups.marketing'),
});

const SINGLE_ONLY = new Set<ProductPageType>(['header', 'footer', 'productCourseGrid', 'heroSection']);

// ─── Migrate old product-page format → catalogue component format ─────────────

const TYPE_MAP: Record<string, string> = {
    Header: 'header',
    HeroBanner: 'heroSection',
    CourseGrid: 'productCourseGrid',
    TextBlock: 'textBlock',
    ImageBanner: 'imageBlock',
    HTML: 'htmlBlock',
    Footer: 'footer',
    StatsHighlights: 'statsHighlights',
    TestimonialSection: 'testimonialSection',
    FaqSection: 'faqSection',
    VideoEmbed: 'videoEmbed',
    CtaBanner: 'ctaBanner',
    FeatureGrid: 'featureGrid',
    StepsProcess: 'stepsProcess',
    FilterBar: '__REMOVE__',
};

const migrateComponent = (c: Component): Component | null => {
    const newType = TYPE_MAP[c.type];
    if (newType === '__REMOVE__') return null;
    if (!newType) return c; // already new format

    const p = c.props as Record<string, unknown>;

    switch (c.type) {
        case 'Header':
            return { ...c, type: 'header', props: { logo: '', title: p['title'] ?? '', navigation: [], authLinks: [] } };
        case 'HeroBanner': {
            const collage = (p['collageImages'] as string[] | undefined) ?? [];
            return {
                ...c, type: 'heroSection',
                props: {
                    layout: 'split',
                    backgroundColor: p['backgroundColor'] ?? '#F8FAFC',  // design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb
                    left: {
                        title: p['title'] ?? '',
                        description: p['subtitle'] ?? '',
                        button: { enabled: p['buttonEnabled'] ?? false, text: p['buttonText'] ?? 'Enroll Now', action: 'navigate', target: '' },
                    },
                    right: { image: '', alt: '', imageCollage: collage },
                    styles: { padding: '40px', roundedEdges: true, textAlign: 'left' },
                },
            };
        }
        case 'CourseGrid':
            return { ...c, type: 'productCourseGrid', props: { columns: p['columns'] ?? 3, showPrice: p['showPrice'] ?? true, showBadge: p['showBadge'] ?? true, showFilters: true } };
        case 'TextBlock':
            return { ...c, type: 'textBlock', props: { content: p['content'] ?? '', alignment: 'left', maxWidth: '800px' } };
        case 'ImageBanner':
            return { ...c, type: 'imageBlock', props: { src: '', alt: p['altText'] ?? '', linkUrl: p['linkUrl'] ?? '', alignment: 'center', maxWidth: '100%' } };
        case 'HTML':
            return { ...c, type: 'htmlBlock', props: { html: p['html'] ?? '' } };
        case 'Footer': {
            const sections = (p['sections'] as Array<{ title: string; links: Array<{ label: string; url: string }> }> | undefined) ?? [];
            return {
                ...c, type: 'footer',
                props: {
                    leftSection: { title: p['brandName'] ?? '', text: p['brandTagline'] ?? '', socials: [] },
                    rightSection1: sections[0] ? { title: sections[0].title, links: sections[0].links.map((l) => ({ label: l.label, url: l.url })) } : undefined,
                    rightSection2: sections[1] ? { title: sections[1].title, links: sections[1].links.map((l) => ({ label: l.label, url: l.url })) } : undefined,
                    bottomNote: p['copyrightText'] ?? '',
                },
            };
        }
        case 'StatsHighlights':
            return { ...c, type: 'statsHighlights', props: { ...p, styles: {} } };
        case 'TestimonialSection':
            return {
                ...c, type: 'testimonialSection',
                props: {
                    headerText: p['headerText'] ?? '',
                    description: p['description'] ?? '',
                    layout: p['layout'] === 'scroll' ? 'grid-scroll' : 'grid-scroll',
                    testimonials: ((p['testimonials'] as Array<{ name: string; role: string; feedback: string }> | undefined) ?? []).map((item) => ({ author: item.name, role: item.role, content: item.feedback, avatar: '' })),
                    styles: {},
                },
            };
        case 'FaqSection':
            return { ...c, type: 'faqSection', props: { ...p } };
        case 'VideoEmbed':
            return { ...c, type: 'videoEmbed', props: { ...p, autoplay: false } };
        case 'CtaBanner':
            return {
                ...c, type: 'ctaBanner',
                props: {
                    heading: p['heading'] ?? '',
                    subheading: p['subheading'] ?? '',
                    backgroundColor: p['backgroundColor'] ?? '#1e40af',  // design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb
                    textColor: p['textColor'] ?? '#ffffff',  // design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb
                    layout: 'centered',
                    button: {
                        enabled: (p['button'] as Record<string, unknown>)?.['enabled'] ?? false,
                        text: (p['button'] as Record<string, unknown>)?.['text'] ?? 'Enroll Now',
                        action: 'navigate',
                        target: (p['button'] as Record<string, unknown>)?.['url'] ?? '',
                        style: 'solid',
                    },
                },
            };
        case 'FeatureGrid':
            return {
                ...c, type: 'featureGrid',
                props: {
                    headerText: p['headerText'] ?? '',
                    subheading: p['subheading'] ?? '',
                    columns: p['columns'] ?? 3,
                    features: p['features'] ?? [],
                    style: p['style'] ?? 'cards',
                    iconSize: 'large',
                    backgroundColor: '#ffffff',  // design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb
                },
            };
        case 'StepsProcess':
            return {
                ...c, type: 'stepsProcess',
                props: {
                    headerText: p['headerText'] ?? '',
                    subheading: p['subheading'] ?? '',
                    layout: p['layout'] ?? 'horizontal',
                    steps: ((p['steps'] as Array<{ title: string; description: string }> | undefined) ?? []).map((s, i) => ({ number: String(i + 1), title: s.title, description: s.description })),
                    connectorStyle: 'line',
                    backgroundColor: '#ffffff',  // design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb
                    accentColor: p['accentColor'] ?? '',
                },
            };
        default:
            return c;
    }
};

export const normalizePageJson = (json: PageJson): PageJson => ({
    ...json,
    components: (json.components ?? [])
        .map((c) => migrateComponent(c as Component))
        .filter((c): c is Component => c !== null),
});

// ─── Property Editors ─────────────────────────────────────────────────────────

type EditorProps = { props: Record<string, any>; onChange: (p: Record<string, any>) => void };

const ColorField = ({ label, value, defaultValue, onChange }: {
    label: string; value?: string; defaultValue: string; onChange: (v: string) => void;
}) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    return (
        <div className="space-y-1">
            <Label className="text-xs text-neutral-500">{label}</Label>
            <div className="flex items-center gap-2">
                <input type="color" value={value || defaultValue} onChange={(e) => onChange(e.target.value)} className="size-7 cursor-pointer rounded border border-neutral-200" />
                <Input value={value || defaultValue} onChange={(e) => onChange(e.target.value)} className="h-7 font-mono text-xs" />
                {value && value !== defaultValue && (
                    <button type="button" onClick={() => onChange(defaultValue)} className="shrink-0 text-2xs text-neutral-400 hover:text-neutral-600">{t('colorField.reset')}</button>
                )}
            </div>
        </div>
    );
};

const buildHeroLayouts = (t: TFunction) => [
    { id: 'split', label: t('heroLayouts.split.label'), preview: '▐░░░░░░░▌▐░░░░░▌', description: t('heroLayouts.split.description') },
    { id: 'centered', label: t('heroLayouts.centered.label'), preview: '░░░░░▐░░░░░▌░░░░░', description: t('heroLayouts.centered.description') },
] as const;

const HeroSectionEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const heroLayouts = useMemo(() => buildHeroLayouts(t), [t]);
    const layout: string = p['layout'] ?? 'split';
    const collage: string[] = (p['right']?.imageCollage ?? []).filter(Boolean);
    const tags: string[] = p['left']?.tags ?? [];
    const updateLeft = (k: string, v: unknown) => onChange({ ...p, left: { ...p['left'], [k]: v } });
    const updateBtn = (k: string, v: unknown) => onChange({ ...p, left: { ...p['left'], button: { ...p['left']?.button, [k]: v } } });
    const setCollage = (imgs: string[]) => onChange({ ...p, right: { ...p['right'], imageCollage: imgs, image: '' } });
    const updateCollageSlot = (i: number, url: string) => {
        const next = [...collage];
        if (url) { next[i] = url; } else { next.splice(i, 1); }
        setCollage(next);
    };

    return (
        <div className="space-y-3">
            {/* Layout preset */}
            <div className="space-y-1.5">
                <p className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('heroEditor.layoutLabel')}</p>
                <div className="grid grid-cols-2 gap-2">
                    {heroLayouts.map((opt) => (
                        <button
                            key={opt.id}
                            type="button"
                            onClick={() => onChange({ ...p, layout: opt.id })}
                            className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2.5 text-center transition-all ${
                                layout === opt.id
                                    ? 'border-primary-400 bg-primary-50'
                                    : 'border-neutral-200 hover:border-neutral-300'
                            }`}
                        >
                            <span className="font-mono text-2xs tracking-widest text-neutral-400">{opt.preview}</span>
                            <span className={`text-xs font-semibold ${layout === opt.id ? 'text-primary-600' : 'text-neutral-600'}`}>{opt.label}</span>
                            <span className="text-2xs text-neutral-400">{opt.description}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Colors */}
            <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('common.sectionColors')}</p>
                <ColorField label={t('common.background')} value={p['backgroundColor']} defaultValue="#F8FAFC" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                <ColorField label={t('common.textColor')} value={p['textColor']} defaultValue="#111827" onChange={(v) => onChange({ ...p, textColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
            </div>

            {/* Tags */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label className="text-xs text-neutral-500">{t('heroEditor.tags')}</Label>
                    <button type="button" onClick={() => updateLeft('tags', [...tags, ''])} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                        <Plus className="size-3" /> {t('heroEditor.addTag')}
                    </button>
                </div>
                {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag, i) => (
                            <div key={i} className="flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 pl-2 pr-1 py-0.5">
                                <input
                                    value={tag}
                                    onChange={(e) => { const nextTags = [...tags]; nextTags[i] = e.target.value; updateLeft('tags', nextTags); }}
                                    placeholder={t('heroEditor.tagPlaceholder')}
                                    className="w-14 bg-transparent text-xs focus:outline-none"
                                />
                                <button type="button" onClick={() => updateLeft('tags', tags.filter((_, j) => j !== i))} className="shrink-0 text-neutral-300 hover:text-danger-500"><X className="size-3" /></button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('common.heading')}</Label>
                <Input value={p['left']?.title || ''} onChange={(e) => updateLeft('title', e.target.value)} placeholder={t('heroEditor.headingPlaceholder')} />
            </div>

            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('common.subheading')}</Label>
                <Input value={p['left']?.subheading || ''} onChange={(e) => updateLeft('subheading', e.target.value)} placeholder={t('heroEditor.subheadingPlaceholder')} />
            </div>

            <RichTextField label={t('common.description')} value={p['left']?.description || ''} onChange={(v) => updateLeft('description', v)} placeholder={t('heroEditor.descriptionPlaceholder')} />

            {/* CTA Button */}
            <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={p['left']?.button?.enabled ?? false} onChange={(e) => updateBtn('enabled', e.target.checked)} className="size-4 accent-primary-500" />
                    <span className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('common.ctaButton')}</span>
                </label>
                {p['left']?.button?.enabled && (
                    <div className="space-y-2 pt-1">
                        <Input value={p['left']?.button?.text || ''} onChange={(e) => updateBtn('text', e.target.value)} placeholder={t('heroEditor.ctaTextPlaceholder')} className="h-7 text-xs" />
                        <Input value={p['left']?.button?.target || ''} onChange={(e) => updateBtn('target', e.target.value)} placeholder={t('heroEditor.ctaUrlPlaceholder')} className="h-7 text-xs" />
                        <ColorField label={t('common.buttonBackground')} value={p['left']?.button?.bgColor} defaultValue="#4F46E5" onChange={(v) => updateBtn('bgColor', v)} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                        <ColorField label={t('common.buttonTextColor')} value={p['left']?.button?.textColor} defaultValue="#FFFFFF" onChange={(v) => updateBtn('textColor', v)} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                    </div>
                )}
            </div>

            {/* Right side image (only for split layout) */}
            {layout === 'split' && (
                <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 space-y-3">
                    <Label className="text-xs font-semibold text-neutral-500">{t('heroEditor.rightSideImage')}</Label>
                    <div className="space-y-1.5">
                        <Label className="text-xs text-neutral-400">{t('heroEditor.singleImage')}</Label>
                        <ImageUploadField label="" value={p['right']?.image || ''} onChange={(url) => onChange({ ...p, right: { ...p['right'], image: url, imageCollage: [] } })} />
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs text-neutral-400">{t('heroEditor.photoCollage')}</Label>
                            {collage.length < 5 && (
                                <button type="button" onClick={() => setCollage([...collage, ''])} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                                    <Plus className="size-3" /> {t('common.add')}
                                </button>
                            )}
                        </div>
                        <p className="text-2xs text-neutral-400">{t('heroEditor.collageHint')}</p>
                        {collage.map((url, i) => (
                            <ImageUploadField key={i} label={t('heroEditor.photoLabel', { number: i + 1 })} value={url} onChange={(u) => updateCollageSlot(i, u)} />
                        ))}
                    </div>
                </div>
            )}

            {/* Background image for centered layout */}
            {layout === 'centered' && (
                <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 space-y-2">
                    <Label className="text-xs font-semibold text-neutral-500">{t('heroEditor.backgroundImageOptional')}</Label>
                    <ImageUploadField slot="background" label="" value={p['backgroundImage'] || ''} onChange={(url) => onChange({ ...p, backgroundImage: url })} />
                    <p className="text-2xs text-neutral-400">{t('heroEditor.backgroundImageHint')}</p>
                </div>
            )}
        </div>
    );
};

const HeaderEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const navigation: Array<{ label: string; url?: string; route?: string }> = p['navigation'] ?? [];
    const cta = (p['ctaButton'] as Record<string, unknown>) ?? {};
    const updateCta = (k: string, v: unknown) => onChange({ ...p, ctaButton: { ...cta, [k]: v } });

    return (
        <div className="space-y-3">
            {/* Colors */}
            <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('common.sectionColors')}</p>
                <ColorField label={t('common.background')} value={p['backgroundColor']} defaultValue="#4F46E5" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                <ColorField label={t('headerEditor.navLinkColor')} value={p['textColor']} defaultValue="#FFFFFF" onChange={(v) => onChange({ ...p, textColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
            </div>

            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('headerEditor.siteTitle')}</Label>
                <Input value={p['title'] || ''} onChange={(e) => onChange({ ...p, title: e.target.value })} placeholder={t('headerEditor.siteTitlePlaceholder')} />
            </div>
            <ImageUploadField slot="logo" label={t('headerEditor.logo')} value={p['logo'] || ''} onChange={(url) => onChange({ ...p, logo: url })} />

            {/* Nav Links */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label className="text-xs text-neutral-500">{t('headerEditor.navLinks')}</Label>
                    {navigation.length < 6 && (
                        <button type="button" onClick={() => onChange({ ...p, navigation: [...navigation, { label: '', url: '' }] })} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                            <Plus className="size-3" /> {t('headerEditor.addLink')}
                        </button>
                    )}
                </div>
                {navigation.map((nav, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <Input value={nav.label} onChange={(e) => { const nextNav = [...navigation]; nextNav[i] = { ...nextNav[i]!, label: e.target.value }; onChange({ ...p, navigation: nextNav }); }} placeholder={t('common.labelPlaceholder')} className="h-7 text-xs" />
                        <Input value={nav.url || nav.route || ''} onChange={(e) => { const nextNav = [...navigation]; nextNav[i] = { ...nextNav[i]!, url: e.target.value }; onChange({ ...p, navigation: nextNav }); }} placeholder={t('common.urlOrSectionPlaceholder')} className="h-7 text-xs" />
                        <button type="button" onClick={() => onChange({ ...p, navigation: navigation.filter((_, j) => j !== i) })} className="shrink-0 text-neutral-300 hover:text-danger-500"><X className="size-3.5" /></button>
                    </div>
                ))}
            </div>

            {/* CTA Button */}
            <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
                    <input type="checkbox" checked={(cta.enabled as boolean) ?? false} onChange={(e) => updateCta('enabled', e.target.checked)} className="size-4 accent-primary-500" />
                    <span className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('common.ctaButton')}</span>
                </label>
                {!!(cta.enabled) && (
                    <div className="space-y-2 pt-1">
                        <Input value={(cta.text as string) || ''} onChange={(e) => updateCta('text', e.target.value)} placeholder={t('common.enrollNowPlaceholder')} className="h-7 text-xs" />
                        <Input value={(cta.url as string) || ''} onChange={(e) => updateCta('url', e.target.value)} placeholder={t('common.urlOrSectionPlaceholder')} className="h-7 text-xs" />
                        <ColorField label={t('common.buttonBackground')} value={cta.bgColor as string} defaultValue="#FFFFFF" onChange={(v) => updateCta('bgColor', v)} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                        <ColorField label={t('common.buttonTextColor')} value={cta.textColor as string} defaultValue="#4F46E5" onChange={(v) => updateCta('textColor', v)} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                    </div>
                )}
            </div>
        </div>
    );
};

const FooterEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const updateLeft = (k: string, v: unknown) => onChange({ ...p, leftSection: { ...p['leftSection'], [k]: v } });
    const sections = [p['rightSection1'], p['rightSection2'], p['rightSection3']].filter(Boolean) as Array<{ title: string; links: Array<{ label: string; url: string }> }>;
    const setSection = (i: number, val: { title: string; links: Array<{ label: string; url: string }> } | undefined) => {
        const keys = ['rightSection1', 'rightSection2', 'rightSection3'] as const;
        onChange({ ...p, [keys[i]!]: val });
    };
    const addSection = () => {
        const empty = { title: '', links: [] };
        if (!p['rightSection1']) onChange({ ...p, rightSection1: empty });
        else if (!p['rightSection2']) onChange({ ...p, rightSection2: empty });
        else if (!p['rightSection3']) onChange({ ...p, rightSection3: empty });
    };

    return (
        <div className="space-y-3">
            <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('common.sectionColors')}</p>
                <ColorField label={t('common.background')} value={p['backgroundColor']} defaultValue="#F9FAFB" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                <ColorField label={t('common.textColor')} value={p['textColor']} defaultValue="#374151" onChange={(v) => onChange({ ...p, textColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
            </div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('footerEditor.brandName')}</Label>
                <Input value={p['leftSection']?.title || ''} onChange={(e) => updateLeft('title', e.target.value)} placeholder={t('headerEditor.siteTitlePlaceholder')} />
            </div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('footerEditor.brandTagline')}</Label>
                <Input value={p['leftSection']?.text || ''} onChange={(e) => updateLeft('text', e.target.value)} placeholder={t('footerEditor.brandTaglinePlaceholder')} />
            </div>
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label className="text-xs text-neutral-500">{t('footerEditor.linkSections')}</Label>
                    {sections.length < 3 && (
                        <button type="button" onClick={addSection} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                            <Plus className="size-3" /> {t('common.add')}
                        </button>
                    )}
                </div>
                {sections.map((sec, si) => (
                    <div key={si} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                            <Input value={sec.title} onChange={(e) => setSection(si, { ...sec, title: e.target.value })} placeholder={t('footerEditor.sectionTitlePlaceholder')} className="h-7 text-xs font-medium" />
                            <button type="button" onClick={() => setSection(si, undefined)} className="shrink-0 text-neutral-300 hover:text-danger-500"><X className="size-3.5" /></button>
                        </div>
                        {sec.links.map((lnk, li) => (
                            <div key={li} className="flex items-center gap-1.5 pl-2">
                                <Input value={lnk.label} onChange={(e) => { const nextLinks = [...sec.links]; nextLinks[li] = { ...nextLinks[li]!, label: e.target.value }; setSection(si, { ...sec, links: nextLinks }); }} placeholder={t('common.labelPlaceholder')} className="h-6 text-xs" />
                                <Input value={lnk.url} onChange={(e) => { const nextLinks = [...sec.links]; nextLinks[li] = { ...nextLinks[li]!, url: e.target.value }; setSection(si, { ...sec, links: nextLinks }); }} placeholder={t('common.urlPlaceholder')} className="h-6 text-xs" />
                                <button type="button" onClick={() => setSection(si, { ...sec, links: sec.links.filter((_, j) => j !== li) })} className="shrink-0 text-neutral-300 hover:text-danger-500"><X className="size-3" /></button>
                            </div>
                        ))}
                        <button type="button" onClick={() => setSection(si, { ...sec, links: [...sec.links, { label: '', url: '' }] })} className="flex items-center gap-1 ps-2 text-2xs text-primary-600 hover:underline">
                            <Plus className="size-2.5" /> {t('footerEditor.addLink')}
                        </button>
                    </div>
                ))}
            </div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('footerEditor.copyrightNote')}</Label>
                <Input value={p['bottomNote'] || ''} onChange={(e) => onChange({ ...p, bottomNote: e.target.value })} placeholder={t('footerEditor.copyrightPlaceholder', { year: new Date().getFullYear() })} />
            </div>
        </div>
    );
};

const ProductCourseGridEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const layoutPresets = [
        { key: 'grid3', label: t('courseGridEditor.layoutGrid3'), cols: 3 },
        { key: 'grid4', label: t('courseGridEditor.layoutGrid4'), cols: 4 },
        { key: 'list', label: t('courseGridEditor.layoutList'), cols: 1 },
    ] as const;
    const toggles = [
        { key: 'showFilters', label: t('courseGridEditor.showFilters') },
        { key: 'showPrice', label: t('courseGridEditor.showPrice') },
        { key: 'showBadge', label: t('courseGridEditor.showBadge') },
    ] as const;
    return (
        <div className="space-y-3">
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('courseGridEditor.sectionTitle')}</Label>
                <Input value={p['title'] as string || ''} onChange={(e) => onChange({ ...p, title: e.target.value })} placeholder={t('courseGridEditor.sectionTitlePlaceholder')} />
            </div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('courseGridEditor.layoutPreset')}</Label>
                <div className="flex gap-1.5">
                    {layoutPresets.map(({ key, label, cols }) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => onChange({ ...p, columns: cols, layout: key === 'list' ? 'list' : 'grid' })}
                            className={`flex-1 rounded border py-1.5 text-xs font-medium transition-colors ${
                                (key === 'list' ? (p['layout'] === 'list' || p['columns'] === 1) : p['columns'] === cols && p['layout'] !== 'list')
                                    ? 'border-primary-400 bg-primary-50 text-primary-600'
                                    : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="flex flex-col gap-2">
                {toggles.map(({ key, label }) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
                        <input type="checkbox" checked={p[key] ?? true} onChange={(e) => onChange({ ...p, [key]: e.target.checked })} className="size-4 accent-primary-500" />
                        {label}
                    </label>
                ))}
            </div>
            <ColorField label={t('common.backgroundColor')} value={p['backgroundColor']} defaultValue="#F8FAFC" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
        </div>
    );
};

const TextBlockEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    return (
        <div className="space-y-3">
            <RichTextField label={t('common.content')} value={p['content'] || ''} onChange={(v) => onChange({ ...p, content: v })} placeholder={t('textBlockEditor.contentPlaceholder')} />
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('common.alignment')}</Label>
                <select value={p['alignment'] || 'left'} onChange={(e) => onChange({ ...p, alignment: e.target.value })} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none">
                    <option value="left">{t('common.alignLeft')}</option>
                    <option value="center">{t('common.alignCenter')}</option>
                    <option value="right">{t('common.alignRight')}</option>
                </select>
            </div>
            <ColorField label={t('common.backgroundColor')} value={p['backgroundColor']} defaultValue="#FFFFFF" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
        </div>
    );
};

const ImageBlockEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    return (
        <div className="space-y-3">
            <ImageUploadField label={t('common.image')} value={p['src'] || ''} onChange={(url) => onChange({ ...p, src: url })} />
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('imageBlockEditor.altText')}</Label>
                <Input value={p['alt'] || ''} onChange={(e) => onChange({ ...p, alt: e.target.value })} placeholder={t('imageBlockEditor.altTextPlaceholder')} />
            </div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('imageBlockEditor.linkUrlOptional')}</Label>
                <Input value={p['linkUrl'] || ''} onChange={(e) => onChange({ ...p, linkUrl: e.target.value })} placeholder="https://…" />
            </div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('common.alignment')}</Label>
                <select value={p['alignment'] || 'center'} onChange={(e) => onChange({ ...p, alignment: e.target.value })} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none">
                    <option value="left">{t('common.alignLeft')}</option>
                    <option value="center">{t('common.alignCenter')}</option>
                    <option value="right">{t('common.alignRight')}</option>
                </select>
            </div>
        </div>
    );
};

const HtmlBlockEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    return (
        <div className="space-y-3">
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('htmlBlockEditor.html')}</Label>
                <textarea rows={6} value={p['html'] || ''} onChange={(e) => onChange({ ...p, html: e.target.value })} placeholder="<div>Custom content</div>" className="w-full rounded-md border border-neutral-200 px-3 py-2 font-mono text-xs focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-300" />
            </div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('htmlBlockEditor.cssScoped')}</Label>
                <textarea rows={4} value={p['css'] || ''} onChange={(e) => onChange({ ...p, css: e.target.value })} placeholder=".my-band { background: var(--primary-50); }" className="w-full rounded-md border border-neutral-200 px-3 py-2 font-mono text-xs focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-300" />
            </div>
        </div>
    );
};

const StatsHighlightsEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const stats: Array<{ label: string; value: string }> = p['stats'] ?? [];
    return (
        <div className="space-y-3">
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.heading')}</Label><Input value={p['headerText'] || ''} onChange={(e) => onChange({ ...p, headerText: e.target.value })} placeholder={t('statsEditor.headingPlaceholder')} /></div>
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.description')}</Label><Input value={p['description'] || ''} onChange={(e) => onChange({ ...p, description: e.target.value })} /></div>
            <div className="space-y-2">
                <div className="flex items-center justify-between"><Label className="text-xs text-neutral-500">{t('statsEditor.stats')}</Label><button type="button" onClick={() => onChange({ ...p, stats: [...stats, { label: '', value: '' }] })} className="flex items-center gap-1 text-xs text-primary-600 hover:underline"><Plus className="size-3" /> {t('common.add')}</button></div>
                {stats.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <Input value={s.value} onChange={(e) => { const nextStats = [...stats]; nextStats[i] = { ...nextStats[i]!, value: e.target.value }; onChange({ ...p, stats: nextStats }); }} placeholder={t('statsEditor.valuePlaceholder')} className="h-7 text-xs" />
                        <Input value={s.label} onChange={(e) => { const nextStats = [...stats]; nextStats[i] = { ...nextStats[i]!, label: e.target.value }; onChange({ ...p, stats: nextStats }); }} placeholder={t('statsEditor.labelPlaceholder')} className="h-7 text-xs" />
                        <button type="button" onClick={() => onChange({ ...p, stats: stats.filter((_, j) => j !== i) })} className="text-neutral-300 hover:text-danger-500"><X className="size-3.5" /></button>
                    </div>
                ))}
            </div>
            <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('common.sectionColors')}</p>
                <ColorField label={t('common.background')} value={p['backgroundColor']} defaultValue="#FFFFFF" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                <ColorField label={t('common.textColor')} value={p['textColor']} defaultValue="#111827" onChange={(v) => onChange({ ...p, textColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
            </div>
        </div>
    );
};

const TestimonialSectionEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const testimonials: Array<{ author: string; role: string; content: string; avatar: string }> = p['testimonials'] ?? [];
    return (
        <div className="space-y-3">
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.heading')}</Label><Input value={p['headerText'] || ''} onChange={(e) => onChange({ ...p, headerText: e.target.value })} placeholder={t('testimonialEditor.headingPlaceholder')} /></div>
            <div className="space-y-2">
                <div className="flex items-center justify-between"><Label className="text-xs text-neutral-500">{t('testimonialEditor.testimonials')}</Label><button type="button" onClick={() => onChange({ ...p, testimonials: [...testimonials, { author: '', role: '', content: '', avatar: '' }] })} className="flex items-center gap-1 text-xs text-primary-600 hover:underline"><Plus className="size-3" /> {t('common.add')}</button></div>
                {testimonials.map((item, i) => (
                    <div key={i} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-2">
                        <div className="flex items-center gap-1">
                            <Input value={item.author} onChange={(e) => { const nextItems = [...testimonials]; nextItems[i] = { ...nextItems[i]!, author: e.target.value }; onChange({ ...p, testimonials: nextItems }); }} placeholder={t('testimonialEditor.namePlaceholder')} className="h-7 text-xs" />
                            <Input value={item.role} onChange={(e) => { const nextItems = [...testimonials]; nextItems[i] = { ...nextItems[i]!, role: e.target.value }; onChange({ ...p, testimonials: nextItems }); }} placeholder={t('testimonialEditor.rolePlaceholder')} className="h-7 text-xs" />
                            <button type="button" onClick={() => onChange({ ...p, testimonials: testimonials.filter((_, j) => j !== i) })} className="shrink-0 text-neutral-300 hover:text-danger-500"><X className="size-3.5" /></button>
                        </div>
                        <textarea rows={2} value={item.content} onChange={(e) => { const nextItems = [...testimonials]; nextItems[i] = { ...nextItems[i]!, content: e.target.value }; onChange({ ...p, testimonials: nextItems }); }} placeholder={t('testimonialEditor.feedbackPlaceholder')} className="w-full rounded-md border border-neutral-200 px-3 py-2 text-xs focus:outline-none" />
                    </div>
                ))}
            </div>
            <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('common.sectionColors')}</p>
                <ColorField label={t('common.background')} value={p['backgroundColor']} defaultValue="#F9FAFB" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                <ColorField label={t('common.textColor')} value={p['textColor']} defaultValue="#111827" onChange={(v) => onChange({ ...p, textColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
            </div>
        </div>
    );
};

const FaqSectionEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const faqs: Array<{ question: string; answer: string }> = p['faqs'] ?? [];
    return (
        <div className="space-y-3">
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.heading')}</Label><Input value={p['headerText'] || ''} onChange={(e) => onChange({ ...p, headerText: e.target.value })} placeholder={t('faqEditor.headingPlaceholder')} /></div>
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.subheading')}</Label><Input value={p['subheading'] || ''} onChange={(e) => onChange({ ...p, subheading: e.target.value })} /></div>
            <div className="space-y-2">
                <div className="flex items-center justify-between"><Label className="text-xs text-neutral-500">{t('faqEditor.questions')}</Label><button type="button" onClick={() => onChange({ ...p, faqs: [...faqs, { question: '', answer: '' }] })} className="flex items-center gap-1 text-xs text-primary-600 hover:underline"><Plus className="size-3" /> {t('common.add')}</button></div>
                {faqs.map((faq, i) => (
                    <div key={i} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                            <Input value={faq.question} onChange={(e) => { const nextFaqs = [...faqs]; nextFaqs[i] = { ...nextFaqs[i]!, question: e.target.value }; onChange({ ...p, faqs: nextFaqs }); }} placeholder={t('faqEditor.questionPlaceholder')} className="h-7 flex-1 text-xs font-medium" />
                            <button type="button" onClick={() => onChange({ ...p, faqs: faqs.filter((_, j) => j !== i) })} className="shrink-0 text-neutral-300 hover:text-danger-500"><X className="size-3.5" /></button>
                        </div>
                        <textarea rows={2} value={faq.answer} onChange={(e) => { const nextFaqs = [...faqs]; nextFaqs[i] = { ...nextFaqs[i]!, answer: e.target.value }; onChange({ ...p, faqs: nextFaqs }); }} placeholder={t('faqEditor.answerPlaceholder')} className="w-full rounded-md border border-neutral-200 px-3 py-2 text-xs focus:outline-none" />
                    </div>
                ))}
            </div>
            <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('common.sectionColors')}</p>
                <ColorField label={t('common.background')} value={p['backgroundColor']} defaultValue="#F9FAFB" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                <ColorField label={t('common.textColor')} value={p['textColor']} defaultValue="#111827" onChange={(v) => onChange({ ...p, textColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
            </div>
        </div>
    );
};

const VideoEmbedEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    return (
        <div className="space-y-3">
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('videoEmbedEditor.videoUrl')}</Label><Input value={p['url'] || ''} onChange={(e) => onChange({ ...p, url: e.target.value })} placeholder="https://youtube.com/watch?v=…" /></div>
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.title')}</Label><Input value={p['title'] || ''} onChange={(e) => onChange({ ...p, title: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('videoEmbedEditor.caption')}</Label><Input value={p['caption'] || ''} onChange={(e) => onChange({ ...p, caption: e.target.value })} /></div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('videoEmbedEditor.aspectRatio')}</Label>
                <select value={p['aspectRatio'] || '16:9'} onChange={(e) => onChange({ ...p, aspectRatio: e.target.value })} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none">
                    <option value="16:9">16:9</option><option value="4:3">4:3</option><option value="1:1">1:1</option>
                </select>
            </div>
            <ColorField label={t('common.backgroundColor')} value={p['backgroundColor']} defaultValue="#000000" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
        </div>
    );
};

const CtaBannerEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const btn = p['button'] ?? {};
    const updateBtn = (k: string, v: unknown) => onChange({ ...p, button: { ...btn, [k]: v } });
    return (
        <div className="space-y-3">
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.heading')}</Label><Input value={p['heading'] || ''} onChange={(e) => onChange({ ...p, heading: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.subheading')}</Label><Input value={p['subheading'] || ''} onChange={(e) => onChange({ ...p, subheading: e.target.value })} /></div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('common.backgroundColor')}</Label>
                <div className="flex items-center gap-2"><input type="color" value={p['backgroundColor'] || '#1e40af'} onChange={(e) => onChange({ ...p, backgroundColor: e.target.value })} className="size-7 cursor-pointer rounded border border-neutral-200" /><Input value={p['backgroundColor'] || '#1e40af'} onChange={(e) => onChange({ ...p, backgroundColor: e.target.value })} className="h-7 font-mono text-xs" /></div> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
            </div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('common.textColor')}</Label>
                <div className="flex items-center gap-2"><input type="color" value={p['textColor'] || '#ffffff'} onChange={(e) => onChange({ ...p, textColor: e.target.value })} className="size-7 cursor-pointer rounded border border-neutral-200" /><Input value={p['textColor'] || '#ffffff'} onChange={(e) => onChange({ ...p, textColor: e.target.value })} className="h-7 font-mono text-xs" /></div> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
                <input type="checkbox" checked={btn.enabled ?? false} onChange={(e) => updateBtn('enabled', e.target.checked)} className="size-4 accent-primary-500" />
                {t('ctaBannerEditor.showButton')}
            </label>
            {btn.enabled && <Input value={btn.text || ''} onChange={(e) => updateBtn('text', e.target.value)} placeholder={t('common.enrollNowPlaceholder')} />}
        </div>
    );
};

const FeatureGridEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const features: Array<{ icon: string; title: string; description: string }> = p['features'] ?? [];
    return (
        <div className="space-y-3">
            <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('common.sectionColors')}</p>
                <ColorField label={t('common.background')} value={p['backgroundColor']} defaultValue="#FFFFFF" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                <ColorField label={t('common.textColor')} value={p['textColor']} defaultValue="#111827" onChange={(v) => onChange({ ...p, textColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
            </div>
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.heading')}</Label><Input value={p['headerText'] || ''} onChange={(e) => onChange({ ...p, headerText: e.target.value })} placeholder={t('featureGridEditor.headingPlaceholder')} /></div>
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.subheading')}</Label><Input value={p['subheading'] || ''} onChange={(e) => onChange({ ...p, subheading: e.target.value })} /></div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('featureGridEditor.columns')}</Label>
                <select value={p['columns'] ?? 3} onChange={(e) => onChange({ ...p, columns: parseInt(e.target.value) })} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none">
                    <option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
                </select>
            </div>
            <div className="space-y-2">
                <div className="flex items-center justify-between"><Label className="text-xs text-neutral-500">{t('featureGridEditor.features')}</Label><button type="button" onClick={() => onChange({ ...p, features: [...features, { icon: '✨', title: '', description: '' }] })} className="flex items-center gap-1 text-xs text-primary-600 hover:underline"><Plus className="size-3" /> {t('common.add')}</button></div>
                {features.map((feature, i) => (
                    <div key={i} className="rounded-lg border border-neutral-200 bg-neutral-50 p-2 space-y-1.5">
                        <div className="flex items-center gap-2">
                            <Input value={feature.icon} onChange={(e) => { const nextFeatures = [...features]; nextFeatures[i] = { ...nextFeatures[i]!, icon: e.target.value }; onChange({ ...p, features: nextFeatures }); }} placeholder={t('featureGridEditor.iconEmojiPlaceholder')} className="h-7 w-16 text-center text-xs" />
                            <Input value={feature.title} onChange={(e) => { const nextFeatures = [...features]; nextFeatures[i] = { ...nextFeatures[i]!, title: e.target.value }; onChange({ ...p, features: nextFeatures }); }} placeholder={t('common.title')} className="h-7 flex-1 text-xs" />
                            <button type="button" onClick={() => onChange({ ...p, features: features.filter((_, j) => j !== i) })} className="shrink-0 text-neutral-300 hover:text-danger-500"><X className="size-3.5" /></button>
                        </div>
                        <Input value={feature.description} onChange={(e) => { const nextFeatures = [...features]; nextFeatures[i] = { ...nextFeatures[i]!, description: e.target.value }; onChange({ ...p, features: nextFeatures }); }} placeholder={t('common.description')} className="h-7 text-xs" />
                    </div>
                ))}
            </div>
        </div>
    );
};

const StepsProcessEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const steps: Array<{ number: string; title: string; description: string }> = p['steps'] ?? [];
    return (
        <div className="space-y-3">
            <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('common.sectionColors')}</p>
                <ColorField label={t('common.background')} value={p['backgroundColor']} defaultValue="#FFFFFF" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                <ColorField label={t('common.textColor')} value={p['textColor']} defaultValue="#111827" onChange={(v) => onChange({ ...p, textColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
            </div>
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.heading')}</Label><Input value={p['headerText'] || ''} onChange={(e) => onChange({ ...p, headerText: e.target.value })} placeholder={t('stepsEditor.headingPlaceholder')} /></div>
            <div className="space-y-1"><Label className="text-xs text-neutral-500">{t('common.subheading')}</Label><Input value={p['subheading'] || ''} onChange={(e) => onChange({ ...p, subheading: e.target.value })} /></div>
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('stepsEditor.layout')}</Label>
                <select value={p['layout'] || 'horizontal'} onChange={(e) => onChange({ ...p, layout: e.target.value })} className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none">
                    <option value="horizontal">{t('stepsEditor.horizontal')}</option><option value="vertical">{t('stepsEditor.vertical')}</option>
                </select>
            </div>
            <div className="space-y-2">
                <div className="flex items-center justify-between"><Label className="text-xs text-neutral-500">{t('stepsEditor.steps')}</Label><button type="button" onClick={() => onChange({ ...p, steps: [...steps, { number: String(steps.length + 1), title: '', description: '' }] })} className="flex items-center gap-1 text-xs text-primary-600 hover:underline"><Plus className="size-3" /> {t('common.add')}</button></div>
                {steps.map((step, i) => (
                    <div key={i} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                            <Input value={step.title} onChange={(e) => { const nextSteps = [...steps]; nextSteps[i] = { ...nextSteps[i]!, title: e.target.value }; onChange({ ...p, steps: nextSteps }); }} placeholder={t('stepsEditor.stepTitlePlaceholder')} className="h-7 flex-1 text-xs font-medium" />
                            <button type="button" onClick={() => onChange({ ...p, steps: steps.filter((_, j) => j !== i) })} className="shrink-0 text-neutral-300 hover:text-danger-500"><X className="size-3.5" /></button>
                        </div>
                        <textarea rows={2} value={step.description} onChange={(e) => { const nextSteps = [...steps]; nextSteps[i] = { ...nextSteps[i]!, description: e.target.value }; onChange({ ...p, steps: nextSteps }); }} placeholder={t('common.descriptionEllipsisPlaceholder')} className="w-full rounded-md border border-neutral-200 px-3 py-2 text-xs focus:outline-none" />
                    </div>
                ))}
            </div>
        </div>
    );
};

const buildMarqueeIconOptions = (t: TFunction) => [
    { value: '', label: t('marqueeEditor.icons.none') },
    { value: '⭐', label: `⭐ ${t('marqueeEditor.icons.star')}` },
    { value: '✓', label: `✓ ${t('marqueeEditor.icons.check')}` },
    { value: '🎓', label: `🎓 ${t('marqueeEditor.icons.graduate')}` },
    { value: '🏆', label: `🏆 ${t('marqueeEditor.icons.trophy')}` },
    { value: '🚀', label: `🚀 ${t('marqueeEditor.icons.rocket')}` },
    { value: '💡', label: `💡 ${t('marqueeEditor.icons.bulb')}` },
    { value: '📚', label: `📚 ${t('marqueeEditor.icons.books')}` },
    { value: '🔥', label: `🔥 ${t('marqueeEditor.icons.fire')}` },
    { value: '✨', label: `✨ ${t('marqueeEditor.icons.sparkle')}` },
    { value: '◆', label: `◆ ${t('marqueeEditor.icons.diamond')}` },
    { value: '●', label: `● ${t('marqueeEditor.icons.circle')}` },
    { value: '|', label: `| ${t('marqueeEditor.icons.pipe')}` },
];

const MarqueeEditor = ({ props: p, onChange }: EditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const marqueeIconOptions = useMemo(() => buildMarqueeIconOptions(t), [t]);
    const speedOptions = [
        { key: 'slow', label: t('marqueeEditor.speedSlow') },
        { key: 'medium', label: t('marqueeEditor.speedMedium') },
        { key: 'fast', label: t('marqueeEditor.speedFast') },
    ] as const;
    const items: Array<{ icon: string; text: string }> = p['items'] ?? [
        { icon: '⭐', text: t('marqueeEditor.defaultItem1') },
        { icon: '⭐', text: t('marqueeEditor.defaultItem2') },
    ];

    const addItem = () => onChange({ ...p, items: [...items, { icon: p['defaultIcon'] ?? '⭐', text: t('marqueeEditor.newItem') }] });
    const removeItem = (i: number) => onChange({ ...p, items: items.filter((_, j) => j !== i) });
    const updateItem = (i: number, field: 'icon' | 'text', val: string) => {
        const next = [...items];
        next[i] = { ...next[i]!, [field]: val };
        onChange({ ...p, items: next });
    };

    return (
        <div className="space-y-4">
            {/* Appearance */}
            <div className="space-y-3 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('marqueeEditor.appearance')}</p>
                <ColorField label={t('common.background')} value={p['backgroundColor']} defaultValue="#1e1b4b" onChange={(v) => onChange({ ...p, backgroundColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                <ColorField label={t('common.textColor')} value={p['textColor']} defaultValue="#ffffff" onChange={(v) => onChange({ ...p, textColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                <ColorField label={t('marqueeEditor.iconColor')} value={p['iconColor']} defaultValue="#facc15" onChange={(v) => onChange({ ...p, iconColor: v })} /> {/* design-lint-ignore: default flows into native input[type=color], which requires a literal #rrggbb */}
                <div className="space-y-1">
                    <Label className="text-xs text-neutral-500">{t('marqueeEditor.fontSize')}</Label>
                    <div className="flex gap-1">
                        {(['xs', 'sm', 'base', 'lg', 'xl'] as const).map((s) => (
                            <button key={s} type="button"
                                onClick={() => onChange({ ...p, fontSize: s })}
                                className={`flex-1 rounded border py-0.5 text-2xs font-medium transition-colors ${(p['fontSize'] ?? 'sm') === s ? 'border-primary-400 bg-primary-50 text-primary-600' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'}`}>
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Motion */}
            <div className="space-y-3 rounded-lg border border-neutral-100 bg-neutral-50/50 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('marqueeEditor.motion')}</p>
                <div className="space-y-1">
                    <Label className="text-xs text-neutral-500">{t('marqueeEditor.speed')}</Label>
                    <div className="flex gap-1">
                        {speedOptions.map(({ key, label }) => (
                            <button key={key} type="button"
                                onClick={() => onChange({ ...p, speed: key })}
                                className={`flex-1 rounded border py-1 text-xs font-medium transition-colors ${(p['speed'] ?? 'medium') === key ? 'border-primary-400 bg-primary-50 text-primary-600' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'}`}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-neutral-500">{t('marqueeEditor.direction')}</Label>
                    <div className="flex gap-1">
                        {(['left', 'right'] as const).map((dir) => (
                            <button key={dir} type="button"
                                onClick={() => onChange({ ...p, direction: dir })}
                                className={`flex-1 rounded border py-1 text-xs font-medium transition-colors ${(p['direction'] ?? 'left') === dir ? 'border-primary-400 bg-primary-50 text-primary-600' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'}`}>
                                {dir === 'left' ? `← ${t('marqueeEditor.directionLeft')}` : `→ ${t('marqueeEditor.directionRight')}`}
                            </button>
                        ))}
                    </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
                    <input type="checkbox" checked={p['pauseOnHover'] !== false} onChange={(e) => onChange({ ...p, pauseOnHover: e.target.checked })} className="size-4 accent-primary-500" />
                    {t('marqueeEditor.pauseOnHover')}
                </label>
            </div>

            {/* Default icon for new items */}
            <div className="space-y-1">
                <Label className="text-xs text-neutral-500">{t('marqueeEditor.defaultSeparatorIcon')}</Label>
                <select value={p['defaultIcon'] ?? '⭐'} onChange={(e) => onChange({ ...p, defaultIcon: e.target.value })} className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs focus:outline-none">
                    {marqueeIconOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>

            {/* Items */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label className="text-xs text-neutral-500">{t('marqueeEditor.items')}</Label>
                    <button type="button" onClick={addItem} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">
                        <Plus className="size-3" /> {t('marqueeEditor.addItem')}
                    </button>
                </div>
                {items.map((item, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <select
                            value={item.icon}
                            onChange={(e) => updateItem(i, 'icon', e.target.value)}
                            className="w-16 shrink-0 rounded border border-neutral-200 bg-white px-1.5 py-1 text-xs focus:outline-none"
                        >
                            {marqueeIconOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                        <Input
                            value={item.text}
                            onChange={(e) => updateItem(i, 'text', e.target.value)}
                            placeholder={t('marqueeEditor.itemTextPlaceholder')}
                            className="h-7 flex-1 text-xs"
                        />
                        <button type="button" onClick={() => removeItem(i)} className="shrink-0 text-neutral-300 hover:text-danger-500">
                            <X className="size-3.5" />
                        </button>
                    </div>
                ))}
                {items.length === 0 && (
                    <p className="text-2xs text-neutral-400">{t('marqueeEditor.noItemsYet')}</p>
                )}
            </div>
        </div>
    );
};

const PropEditorDispatch = ({ component, onChange }: { component: Component; onChange: (c: Component) => void }) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const update = (props: Record<string, unknown>) => onChange({ ...component, props });
    const p = component.props;
    switch (component.type) {
        case 'heroSection': return <HeroSectionEditor props={p} onChange={update} />;
        case 'header': return <HeaderEditor props={p} onChange={update} />;
        case 'footer': return <FooterEditor props={p} onChange={update} />;
        case 'productCourseGrid': return <ProductCourseGridEditor props={p} onChange={update} />;
        case 'textBlock': return <TextBlockEditor props={p} onChange={update} />;
        case 'imageBlock': return <ImageBlockEditor props={p} onChange={update} />;
        case 'htmlBlock': return <HtmlBlockEditor props={p} onChange={update} />;
        case 'statsHighlights': return <StatsHighlightsEditor props={p} onChange={update} />;
        case 'testimonialSection': return <TestimonialSectionEditor props={p} onChange={update} />;
        case 'faqSection': return <FaqSectionEditor props={p} onChange={update} />;
        case 'videoEmbed': return <VideoEmbedEditor props={p} onChange={update} />;
        case 'ctaBanner': return <CtaBannerEditor props={p} onChange={update} />;
        case 'featureGrid': return <FeatureGridEditor props={p} onChange={update} />;
        case 'stepsProcess': return <StepsProcessEditor props={p} onChange={update} />;
        case 'marquee': return <MarqueeEditor props={p} onChange={update} />;
        default: return <p className="text-xs text-neutral-400">{t('common.noEditorFor', { type: component.type })}</p>;
    }
};

// ─── DnD palette item ─────────────────────────────────────────────────────────

const DraggablePaletteItem = ({
    type, label, icon, description, disabled, onAdd,
}: {
    type: string; label: string; icon: React.ReactNode; description: string;
    disabled: boolean; onAdd: () => void;
}) => {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `palette-${type}`,
        data: { type },
        disabled,
    });

    return (
        <div
            ref={setNodeRef}
            className={`group flex items-center gap-2 rounded-lg border p-2 transition-all ${
                disabled
                    ? 'cursor-not-allowed border-neutral-100 bg-neutral-50 opacity-40'
                    : isDragging
                    ? 'border-blue-300 bg-blue-50 opacity-70'
                    : 'cursor-grab border-neutral-200 bg-white hover:border-primary-200 hover:bg-primary-50/30'
            }`}
            {...attributes}
            {...listeners}
        >
            <DotsSixVertical className="size-3.5 shrink-0 text-neutral-300" />
            <span className="shrink-0 text-neutral-500">{icon}</span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-neutral-700">{label}</div>
                <div className="truncate text-2xs text-neutral-400">{description}</div>
            </div>
            {!disabled && (
                <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={onAdd}
                    className="shrink-0 rounded p-0.5 text-neutral-300 opacity-0 transition-opacity hover:text-primary-600 group-hover:opacity-100"
                >
                    <Plus className="size-3.5" />
                </button>
            )}
        </div>
    );
};

const PalettePanel = ({ existingTypes, onAdd }: { existingTypes: Set<string>; onAdd: (type: ProductPageType) => void }) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const componentPalette = useMemo(() => buildComponentPalette(t), [t]);
    const groupLabels = useMemo(() => buildGroupLabels(t), [t]);
    return (
        <div className="flex flex-1 flex-col gap-0 overflow-y-auto p-3">
            {GROUP_IDS.map((group) => {
                const items = componentPalette.filter((p) => p.group === group);
                return (
                    <div key={group} className="mb-3">
                        <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-neutral-400">{groupLabels[group]}</div>
                        <div className="space-y-1">
                            {items.map((item) => (
                                <DraggablePaletteItem
                                    key={item.type}
                                    type={item.type}
                                    label={item.label}
                                    icon={item.icon}
                                    description={item.description}
                                    disabled={SINGLE_ONLY.has(item.type) && existingTypes.has(item.type)}
                                    onAdd={() => onAdd(item.type)}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

const LayersPanelLocal = ({ components, selectedId, onSelect, onToggle }: {
    components: Component[]; selectedId: string | null;
    onSelect: (id: string) => void; onToggle: (id: string) => void;
}) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const componentPalette = useMemo(() => buildComponentPalette(t), [t]);
    const paletteMap = Object.fromEntries(componentPalette.map((p) => [p.type, p]));
    return (
        <div className="flex flex-1 flex-col overflow-y-auto p-2">
            {components.length === 0 ? (
                <p className="mt-4 text-center text-xs text-neutral-400">{t('layersPanel.noComponentsYet')}</p>
            ) : (
                components.map((c, i) => {
                    const info = paletteMap[c.type];
                    return (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => onSelect(c.id)}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${c.id === selectedId ? 'bg-primary-50 text-primary-700' : 'hover:bg-neutral-50'}`}
                        >
                            <span className="w-5 shrink-0 text-center text-2xs font-mono text-neutral-300">{i + 1}</span>
                            <span className="shrink-0 text-neutral-400">{info?.icon ?? <PuzzlePiece className="size-3.5" />}</span>
                            <span className="flex-1 truncate text-xs font-medium text-neutral-700">{info?.label ?? c.type}</span>
                            <button
                                type="button"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); onToggle(c.id); }}
                                className="shrink-0 text-neutral-300 hover:text-neutral-600"
                            >
                                {c.enabled ? <Eye className="size-3.5" /> : <EyeSlash className="size-3.5 text-neutral-200" />}
                            </button>
                        </button>
                    );
                })
            )}
        </div>
    );
};

// ─── Canvas ───────────────────────────────────────────────────────────────────

const CanvasItem = ({
    component, isSelected, isFirst, isLast,
    onClick, onMoveUp, onMoveDown, onToggleEnabled, onRemove,
}: {
    component: Component; isSelected: boolean; isFirst: boolean; isLast: boolean;
    onClick: () => void; onMoveUp: () => void; onMoveDown: () => void;
    onToggleEnabled: () => void; onRemove: () => void;
}) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    return (
        <div
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className={`group relative cursor-pointer transition-all ${!component.enabled ? 'opacity-40' : ''}`}
        >
            {/* Hover outline (light blue) */}
            {!isSelected && (
                <div
                    className="pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    style={{ boxShadow: 'inset 0 0 0 2px hsl(var(--info-300))' }}
                />
            )}
            {/* Selection outline (solid blue) */}
            {isSelected && (
                <div
                    className="pointer-events-none absolute inset-0 z-10"
                    style={{ boxShadow: 'inset 0 0 0 3px hsl(var(--info-500))' }}
                />
            )}

            {/* Inline toolbar — always visible on hover, more actions when selected */}
            <div
                className={`absolute end-2 top-2 z-20 flex items-center gap-0.5 rounded-lg border bg-white shadow-md transition-opacity duration-100 ${
                    isSelected ? 'border-blue-100 opacity-100' : 'border-neutral-100 opacity-0 group-hover:opacity-100'
                } px-1 py-0.5`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
            >
                <button type="button" disabled={isFirst} onClick={onMoveUp} title={t('canvas.moveUp')}
                    className="flex size-6 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-25">
                    <CaretUp className="size-3.5" />
                </button>
                <button type="button" disabled={isLast} onClick={onMoveDown} title={t('canvas.moveDown')}
                    className="flex size-6 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-25">
                    <CaretDown className="size-3.5" />
                </button>
                {isSelected && (
                    <>
                        <div className="mx-0.5 h-3.5 w-px bg-neutral-200" />
                        <button type="button" onClick={onToggleEnabled} title={component.enabled ? t('canvas.hideComponent') : t('canvas.showComponent')}
                            className={`flex size-6 items-center justify-center rounded transition-colors ${
                                component.enabled ? 'text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700' : 'text-neutral-200 hover:bg-neutral-50 hover:text-neutral-500'
                            }`}>
                            {component.enabled ? <Eye className="size-3.5" /> : <EyeSlash className="size-3.5" />}
                        </button>
                        <button type="button" onClick={onRemove} title={t('canvas.removeComponent')}
                            className="flex size-6 items-center justify-center rounded text-neutral-300 transition-colors hover:bg-red-50 hover:text-red-500">
                            <Trash className="size-3.5" />
                        </button>
                    </>
                )}
            </div>

            {/* Hidden badge */}
            {!component.enabled && (
                <div className="absolute start-2 top-2 z-10 rounded bg-neutral-800/60 px-1.5 py-0.5 text-2xs font-medium text-white">{t('canvas.hiddenBadge')}</div>
            )}

            <div style={{ pointerEvents: 'none', ...buildComponentStyle(component.style) }}>
                {renderComponentPreview(component)}
            </div>
        </div>
    );
};

const VIEWPORT_WIDTHS = { desktop: 860, tablet: 768, mobile: 375 } as const;

const ProductCanvas = ({
    components, selectedId, onSelect, viewport, onViewportChange,
    onMoveUp, onMoveDown, onToggleEnabled, onRemove,
}: {
    components: Component[]; selectedId: string | null;
    onSelect: (id: string | null) => void;
    viewport: 'desktop' | 'tablet' | 'mobile';
    onViewportChange: (v: 'desktop' | 'tablet' | 'mobile') => void;
    onMoveUp: (id: string) => void;
    onMoveDown: (id: string) => void;
    onToggleEnabled: (id: string) => void;
    onRemove: (id: string) => void;
}) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const { setNodeRef, isOver } = useDroppable({ id: 'canvas-drop-zone' });
    const viewportLabels: Record<'desktop' | 'tablet' | 'mobile', string> = {
        desktop: t('canvas.viewportDesktop'),
        tablet: t('canvas.viewportTablet'),
        mobile: t('canvas.viewportMobile'),
    };
    return (
        <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b bg-white px-3 py-2">
                <span className="text-xs text-neutral-400">
                    {components.length === 0 ? t('canvas.emptyHint') : t('canvas.componentCountHint', { count: components.length })}
                </span>
                <div className="ml-auto flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-0.5">
                    {(['desktop', 'tablet', 'mobile'] as const).map((v) => {
                        const Icon = v === 'desktop' ? Monitor : v === 'tablet' ? DeviceTablet : DeviceMobile;
                        return (
                            <button key={v} onClick={() => onViewportChange(v)} className={`flex size-6 items-center justify-center rounded transition-colors ${viewport === v ? 'bg-white text-primary-600 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`} title={viewportLabels[v]}>
                                <Icon className="size-3.5" />
                            </button>
                        );
                    })}
                </div>
            </div>
            <div ref={setNodeRef} className={`flex-1 overflow-auto p-6 transition-colors ${isOver ? 'bg-blue-50' : ''}`} onClick={() => onSelect(null)}>
                <div
                    className={`relative mx-auto bg-white shadow-lg transition-all ${isOver ? 'ring-2 ring-blue-400' : ''}`}
                    style={{ maxWidth: VIEWPORT_WIDTHS[viewport], minHeight: '100%' }}
                >
                    {components.length === 0 ? (
                        <div className="flex h-full min-h-96 flex-col items-center justify-center">
                            <div className="rounded-xl border-2 border-dashed border-neutral-200 px-12 py-16 text-center">
                                <Layout className="mx-auto mb-3 size-10 text-neutral-200" />
                                <p className="text-sm font-medium text-neutral-400">{t('canvas.pageEmptyTitle')}</p>
                                <p className="mt-1 text-xs text-neutral-300">{t('canvas.pageEmptyHint')}</p>
                            </div>
                        </div>
                    ) : (
                        components.map((comp, idx) => (
                            <CanvasItem
                                key={comp.id}
                                component={comp}
                                isSelected={comp.id === selectedId}
                                isFirst={idx === 0}
                                isLast={idx === components.length - 1}
                                onClick={() => onSelect(comp.id)}
                                onMoveUp={() => onMoveUp(comp.id)}
                                onMoveDown={() => onMoveDown(comp.id)}
                                onToggleEnabled={() => onToggleEnabled(comp.id)}
                                onRemove={() => onRemove(comp.id)}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Right panel ──────────────────────────────────────────────────────────────

const RightPanel = ({
    selectedComponent, selectedIndex, totalComponents, globalSettings,
    onUpdateComponent, onMoveUp, onMoveDown, onToggleEnabled, onRemove, onUpdateGlobal,
}: {
    selectedComponent: Component | null; selectedIndex: number; totalComponents: number;
    globalSettings: { primaryColor: string; logoFileId: string };
    onUpdateComponent: (c: Component) => void;
    onMoveUp: () => void; onMoveDown: () => void;
    onToggleEnabled: () => void; onRemove: () => void;
    onUpdateGlobal: (s: { primaryColor: string; logoFileId: string }) => void;
}) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const componentPalette = useMemo(() => buildComponentPalette(t), [t]);
    const info = selectedComponent
        ? componentPalette.find((p) => p.type === selectedComponent.type)
        : null;

    if (!selectedComponent) {
        return (
            <div className="flex h-full flex-col">
                <div className="border-b px-4 py-3 text-sm font-semibold text-neutral-700">{t('rightPanel.pageSettings')}</div>
                <div className="flex-1 space-y-4 overflow-y-auto p-4">
                    <div className="space-y-1">
                        <Label className="text-xs text-neutral-500">{t('rightPanel.brandColor')}</Label>
                        <div className="flex items-center gap-2">
                            <input type="color" value={globalSettings.primaryColor} onChange={(e) => onUpdateGlobal({ ...globalSettings, primaryColor: e.target.value })} className="size-7 cursor-pointer rounded border border-neutral-200" />
                            <Input value={globalSettings.primaryColor} onChange={(e) => onUpdateGlobal({ ...globalSettings, primaryColor: e.target.value })} className="h-7 font-mono text-xs" />
                        </div>
                    </div>
                    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-2xs text-neutral-400">
                        {t('rightPanel.selectComponentHint')}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            <div className="border-b px-4 py-3">
                <div className="flex items-center gap-2">
                    <span className="text-primary-400">{info?.icon}</span>
                    <span className="text-sm font-semibold text-neutral-800">{info?.label ?? selectedComponent.type}</span>
                </div>
                {info?.description && <p className="mt-0.5 text-2xs text-neutral-400">{info.description}</p>}
            </div>
            <div className="flex items-center gap-1 border-b px-3 py-2">
                <button type="button" disabled={selectedIndex <= 0} onClick={onMoveUp} className="flex size-7 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-400 hover:bg-neutral-50 disabled:opacity-30" title={t('canvas.moveUp')}><CaretUp className="size-3.5" /></button>
                <button type="button" disabled={selectedIndex >= totalComponents - 1} onClick={onMoveDown} className="flex size-7 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-400 hover:bg-neutral-50 disabled:opacity-30" title={t('canvas.moveDown')}><CaretDown className="size-3.5" /></button>
                <button type="button" onClick={onToggleEnabled} className={`flex size-7 items-center justify-center rounded border bg-white transition-colors ${selectedComponent.enabled ? 'border-neutral-200 text-success-500' : 'border-neutral-200 text-neutral-300'}`} title={selectedComponent.enabled ? t('rightPanel.hide') : t('rightPanel.show')}>
                    {selectedComponent.enabled ? <Eye className="size-3.5" /> : <EyeSlash className="size-3.5" />}
                </button>
                <div className="flex-1" />
                <button type="button" onClick={onRemove} className="flex size-7 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-300 hover:border-danger-200 hover:bg-danger-50 hover:text-danger-500" title={t('rightPanel.remove')}><Trash className="size-3.5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
                <PropEditorDispatch component={selectedComponent} onChange={onUpdateComponent} />
                <div className="mt-4 border-t border-neutral-100 pt-3">
                    <p className="mb-2 px-1 text-2xs font-semibold uppercase tracking-wider text-neutral-400">{t('rightPanel.design')}</p>
                    <ComponentDesignPanel
                        style={selectedComponent.style}
                        onChange={(newStyle) => onUpdateComponent({ ...selectedComponent, style: newStyle })}
                    />
                </div>
            </div>
        </div>
    );
};

// ─── Main export ──────────────────────────────────────────────────────────────

interface PageDesignEditorProps {
    pageJson: PageJson;
    onChange: (updated: PageJson) => void;
}

export const PageDesignEditor = ({ pageJson, onChange }: PageDesignEditorProps) => {
    const { t } = useTranslation('managePagesPageDesignEditor');
    const { t: tTemplates } = useTranslation('managePagesComponentTemplates');
    const componentPalette = useMemo(() => buildComponentPalette(t), [t]);
    const normalized = React.useMemo(() => normalizePageJson(pageJson), [pageJson]);
    const { components, globalSettings } = normalized;

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [sidebarTab, setSidebarTab] = useState<'add' | 'layers'>('add');
    const [activeDragType, setActiveDragType] = useState<string | null>(null);
    const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    const selectedIndex = selectedId ? components.findIndex((c) => c.id === selectedId) : -1;
    const selectedComponent = selectedIndex >= 0 ? (components[selectedIndex] ?? null) : null;
    const existingTypes = new Set(components.map((c) => c.type));

    const emit = useCallback((components: Component[]) => onChange({ ...normalized, components }), [normalized, onChange]);

    const addComponent = useCallback((type: ProductPageType) => {
        const newComp = getComponentTemplate(type, tTemplates);
        emit([...components, newComp]);
        setSelectedId(newComp.id);
        setSidebarTab('layers');
    }, [components, emit, tTemplates]);

    const removeComponent = useCallback((id: string) => {
        if (selectedId === id) setSelectedId(null);
        emit(components.filter((c) => c.id !== id));
    }, [components, emit, selectedId]);

    const moveComponent = useCallback((index: number, direction: 'up' | 'down') => {
        const next = [...components];
        const swap = direction === 'up' ? index - 1 : index + 1;
        if (swap < 0 || swap >= next.length) return;
        [next[index], next[swap]] = [next[swap]!, next[index]!];
        emit(next);
    }, [components, emit]);

    const updateComponent = useCallback((updated: Component) => {
        emit(components.map((c) => (c.id === updated.id ? updated : c)));
    }, [components, emit]);

    const toggleEnabled = useCallback((id: string) => {
        emit(components.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
    }, [components, emit]);

    const handleDragStart = useCallback((event: DragStartEvent) => {
        setActiveDragType((event.active.data.current?.type as string) ?? null);
    }, []);

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (over?.id === 'canvas-drop-zone' && active.data.current?.type) {
            addComponent(active.data.current.type as ProductPageType);
        }
        setActiveDragType(null);
    }, [addComponent]);

    return (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex h-full">
                {/* Left sidebar */}
                <div className="flex w-60 shrink-0 flex-col overflow-hidden border-r bg-white">
                    <div className="flex shrink-0 border-b">
                        <button onClick={() => setSidebarTab('add')} className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${sidebarTab === 'add' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-neutral-500 hover:text-neutral-700'}`}>
                            <PuzzlePiece className="size-3.5" /> {t('sidebar.addTab')}
                        </button>
                        <button onClick={() => setSidebarTab('layers')} className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${sidebarTab === 'layers' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-neutral-500 hover:text-neutral-700'}`}>
                            <List className="size-3.5" /> {t('sidebar.layersTab')}
                        </button>
                    </div>
                    <div className="flex flex-1 flex-col overflow-hidden">
                        {sidebarTab === 'add' && <PalettePanel existingTypes={existingTypes} onAdd={addComponent} />}
                        {sidebarTab === 'layers' && <LayersPanelLocal components={components} selectedId={selectedId} onSelect={setSelectedId} onToggle={toggleEnabled} />}
                    </div>
                </div>

                {/* Center canvas */}
                <div className="flex flex-1 flex-col overflow-hidden bg-gray-100">
                    <ProductCanvas
                        components={components}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        viewport={viewport}
                        onViewportChange={setViewport}
                        onMoveUp={(id) => { const idx = components.findIndex((c) => c.id === id); moveComponent(idx, 'up'); }}
                        onMoveDown={(id) => { const idx = components.findIndex((c) => c.id === id); moveComponent(idx, 'down'); }}
                        onToggleEnabled={toggleEnabled}
                        onRemove={removeComponent}
                    />
                </div>

                {/* Right property panel */}
                <div className="flex w-80 shrink-0 flex-col overflow-hidden border-l bg-white">
                    <RightPanel
                        selectedComponent={selectedComponent}
                        selectedIndex={selectedIndex}
                        totalComponents={components.length}
                        globalSettings={globalSettings}
                        onUpdateComponent={updateComponent}
                        onMoveUp={() => moveComponent(selectedIndex, 'up')}
                        onMoveDown={() => moveComponent(selectedIndex, 'down')}
                        onToggleEnabled={() => selectedComponent && toggleEnabled(selectedComponent.id)}
                        onRemove={() => selectedComponent && removeComponent(selectedComponent.id)}
                        onUpdateGlobal={(s) => onChange({ ...normalized, globalSettings: s })}
                    />
                </div>
            </div>

            <DragOverlay dropAnimation={null}>
                {activeDragType && (
                    <div className="pointer-events-none z-popover-above-modal rounded-lg border-2 border-blue-400 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 shadow-xl">
                        + {componentPalette.find((p) => p.type === activeDragType)?.label ?? activeDragType}
                    </div>
                )}
            </DragOverlay>
        </DndContext>
    );
};
