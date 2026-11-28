import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { DownloadSimple } from '@phosphor-icons/react';
import {
    type RenderSettings,
    type RenderResolution,
    type RenderFps,
    type CaptionSize,
    type CaptionPosition,
    type CaptionStyle,
    type CaptionFontFamily,
    type CaptionPreset,
    DEFAULT_RENDER_SETTINGS,
} from '../-services/video-generation';
import {
    applyCaptionPresetToRender,
    detectCaptionPresetFromRender,
    CAPTION_PRESET_ORDER,
    CAPTION_PRESET_LABELS,
} from '@/components/ai-video-editor/utils/caption-presets';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'video-render-settings';
const NS = 'videoApiStudioRenderSettingsDialog';

// Cheap #RRGGBB → rgba(...) helper for the preview's background-opacity
// composition. Falls back to the raw hex if the input is malformed (so the
// preview never crashes on a hand-edited custom color).
function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    // Capture groups guaranteed by the regex; non-null assertions placate
    // TS's "string | undefined" widening for `RegExpExecArray` indices.
    return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}

const CAPTION_PREVIEW_FONT_FAMILY: Record<CaptionFontFamily, string | undefined> = {
    system: undefined,
    inter: 'Inter, sans-serif',
    montserrat: 'Montserrat, sans-serif',
    'noto-sans': '"Noto Sans", sans-serif',
    'fira-code': '"Fira Code", monospace',
};

const CAPTION_PREVIEW_SIZE_REM: Record<CaptionSize, number> = {
    S: 0.625, // 10px
    M: 0.8125, // 13px
    L: 1, // 16px
};

/**
 * Static-frame preview of what the caption overlay will look like.
 * Cheap "see-before-you-render" so users don't burn a 30 min render
 * just to discover the captions are unreadable. No real render needed
 * — placeholder narration text + the user's live settings on a dark
 * canvas matching the chosen orientation.
 */
// The sample text is a realistic mid-length narration string — long enough
// that the user can judge font sizing and wrapping at "Large", short enough
// to fit two lines in landscape. Shorter samples ("Sample text") under-tested
// the wrap behavior and led to surprises at render time. Translated catalogs
// should aim for a similar length. The karaoke preview highlights the first
// word, split on the first space so this works for any locale's translation
// without needing separately-maintained "first word" / "rest" keys.
function CaptionPreview({
    settings,
    isPortrait,
}: {
    settings: RenderSettings;
    isPortrait: boolean;
}) {
    const { t } = useTranslation(NS);
    const previewSample = t('captionPreview.sampleText');
    const firstSpaceIdx = previewSample.indexOf(' ');
    const previewSampleFirstWord =
        firstSpaceIdx === -1 ? previewSample : previewSample.slice(0, firstSpaceIdx);
    const previewSampleRest = firstSpaceIdx === -1 ? '' : previewSample.slice(firstSpaceIdx);

    const bgRgba = hexToRgba(settings.captionBgColor, settings.captionBgOpacity / 100);
    const fontFamily = CAPTION_PREVIEW_FONT_FAMILY[settings.captionFontFamily];
    // 1080p target → preview is ~1/4 scale. Scale the stroke width down
    // accordingly (0→0, 1–4→1px, 5–8→2px, 9–12→3px) so heavy outlines
    // still look heavy and zero stays clean.
    const previewStroke =
        settings.captionTextStrokeWidth > 0
            ? Math.max(1, Math.ceil(settings.captionTextStrokeWidth / 4))
            : 0;

    return (
        <div
            className={cn(
                'relative mx-auto overflow-hidden rounded-md bg-neutral-900 ring-1 ring-neutral-800',
                isPortrait ? 'aspect-[9/16] h-48' : 'aspect-video h-36'
            )}
            aria-label={t('captionPreview.ariaLabel')}
        >
            {/* Subtle gradient stripes mimic a "real" frame so the caption
                isn't floating in a flat box — easier to judge contrast. */}
            <div
                aria-hidden
                className="absolute inset-0"
                style={{
                    background:
                        'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.02) 100%)',
                }}
            />
            <div
                className={cn(
                    'absolute inset-x-2 flex justify-center',
                    settings.captionPosition === 'top' ? 'top-3' : 'bottom-3'
                )}
            >
                <span
                    className="inline-block max-w-full rounded px-1.5 py-0.5 text-center leading-snug"
                    style={{
                        color: settings.captionTextColor,
                        backgroundColor: bgRgba,
                        fontWeight: settings.captionFontWeight,
                        fontFamily,
                        fontSize: `${CAPTION_PREVIEW_SIZE_REM[settings.captionSize]}rem`,
                        WebkitTextStroke:
                            previewStroke > 0
                                ? `${previewStroke}px ${settings.captionTextStrokeColor}`
                                : undefined,
                    }}
                >
                    {settings.captionStyle === 'karaoke' ? (
                        <>
                            <span style={{ color: settings.captionHighlightColor }}>
                                {previewSampleFirstWord}
                            </span>
                            {previewSampleRest}
                        </>
                    ) : (
                        previewSample
                    )}
                </span>
            </div>
        </div>
    );
}

function loadSettings(): RenderSettings {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return { ...DEFAULT_RENDER_SETTINGS, ...JSON.parse(saved) };
    } catch {
        /* ignore */
    }
    return DEFAULT_RENDER_SETTINGS;
}

function saveSettings(s: RenderSettings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// ---------------------------------------------------------------------------
// Toggle-button helper
// ---------------------------------------------------------------------------

function ToggleGroup<T extends string | number>({
    options,
    value,
    onChange,
    labels,
}: {
    options: T[];
    value: T;
    onChange: (v: T) => void;
    labels?: Record<string, string>;
}) {
    return (
        <div className="flex gap-1">
            {options.map((opt) => (
                <button
                    key={String(opt)}
                    type="button"
                    onClick={() => onChange(opt)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                        value === opt
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border bg-background text-muted-foreground hover:bg-muted'
                    }`}
                >
                    {labels?.[String(opt)] ?? String(opt)}
                </button>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface RenderSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (settings: RenderSettings) => void;
    isPortrait?: boolean;
    /**
     * Optional initial settings. When provided, takes precedence over the
     * localStorage `loadSettings()` default. The video editor passes its
     * `captionSettings` (mapped to RenderSettings shape) so what the user
     * previewed on the editor canvas is what the MP4 will use.
     *
     * Only the caption-related fields are typically supplied; missing fields
     * fall back to the loaded localStorage defaults so resolution / fps /
     * watermark stay sticky across renders.
     */
    initialSettings?: Partial<RenderSettings>;
}

export function RenderSettingsDialog({
    open,
    onOpenChange,
    onConfirm,
    isPortrait = false,
    initialSettings,
}: RenderSettingsDialogProps) {
    const { t } = useTranslation(NS);
    const [settings, setSettings] = useState<RenderSettings>(() => ({
        ...loadSettings(),
        ...(initialSettings ?? {}),
    }));

    // Reload from localStorage when dialog opens, then overlay initialSettings
    // so the caller's preview values always win. Re-derives on every open so
    // a settings change between two dialog opens is picked up.
    useEffect(() => {
        if (open) setSettings({ ...loadSettings(), ...(initialSettings ?? {}) });
    }, [open, initialSettings]);

    const update = <K extends keyof RenderSettings>(key: K, val: RenderSettings[K]) =>
        setSettings((prev) => ({ ...prev, [key]: val }));

    const handleConfirm = () => {
        saveSettings(settings);
        onConfirm(settings);
        onOpenChange(false);
    };

    const resolutionLabel = (r: RenderResolution) => {
        const dimensions =
            r === '720p'
                ? isPortrait
                    ? '720×1280'
                    : '1280×720'
                : isPortrait
                  ? '1080×1920'
                  : '1920×1080';
        return t('resolution.optionLabel', { resolution: r, dimensions });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    'flex flex-col sm:max-w-md',
                    'max-h-[90vh]' // design-lint-ignore: cap to viewport so the body scrolls on short screens
                )}
            >
                <DialogHeader>
                    <DialogTitle>{t('dialog.title')}</DialogTitle>
                    <DialogDescription>{t('dialog.description')}</DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-2">
                    {/* Resolution */}
                    <div className="space-y-2">
                        <Label className="text-xs font-medium">{t('resolution.label')}</Label>
                        <ToggleGroup<RenderResolution>
                            options={['720p', '1080p']}
                            value={settings.resolution}
                            onChange={(v) => update('resolution', v)}
                            labels={{
                                '720p': resolutionLabel('720p'),
                                '1080p': resolutionLabel('1080p'),
                            }}
                        />
                    </div>

                    {/* FPS */}
                    <div className="space-y-2">
                        <Label className="text-xs font-medium">{t('fps.label')}</Label>
                        <ToggleGroup<RenderFps>
                            options={[15, 20, 25, 30, 45, 60]}
                            value={settings.fps}
                            onChange={(v) => update('fps', v)}
                            labels={{
                                '15': t('fps.optionLabel', { fps: 15 }),
                                '20': t('fps.optionLabel', { fps: 20 }),
                                '25': t('fps.optionLabel', { fps: 25 }),
                                '30': t('fps.optionLabel', { fps: 30 }),
                                '45': t('fps.optionLabel', { fps: 45 }),
                                '60': t('fps.optionLabel', { fps: 60 }),
                            }}
                        />
                    </div>

                    <hr className="border-border" />

                    {/* Captions toggle */}
                    <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">{t('captions.label')}</Label>
                        <Switch
                            checked={settings.captions}
                            onCheckedChange={(v) => update('captions', v)}
                        />
                    </div>

                    {/* Caption options (visible when captions enabled) */}
                    {settings.captions && (
                        <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
                            {/* Live preview at the top — updates instantly as the
                                user tweaks the controls below. Static placeholder
                                text + the user's settings; no real render needed. */}
                            <CaptionPreview settings={settings} isPortrait={isPortrait} />

                            {/* Style preset chips — single click to apply a known
                                style pack. Settings tweaked past every named preset
                                show a "Custom" indicator instead. */}
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">
                                    {t('stylePreset.label')}
                                </Label>
                                <div className="flex flex-wrap gap-1">
                                    {(() => {
                                        const active: CaptionPreset =
                                            detectCaptionPresetFromRender(settings);
                                        return (
                                            <>
                                                {CAPTION_PRESET_ORDER.map((p) => (
                                                    <button
                                                        key={p}
                                                        type="button"
                                                        onClick={() =>
                                                            setSettings(
                                                                applyCaptionPresetToRender(
                                                                    p,
                                                                    settings
                                                                )
                                                            )
                                                        }
                                                        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                                                            active === p
                                                                ? 'bg-primary text-primary-foreground border-primary'
                                                                : 'border-border bg-background text-muted-foreground hover:bg-muted'
                                                        }`}
                                                    >
                                                        {CAPTION_PRESET_LABELS[p]}
                                                    </button>
                                                ))}
                                                {active === 'custom' && (
                                                    <span
                                                        className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
                                                        title={t('stylePreset.customTooltip')}
                                                    >
                                                        {t('stylePreset.customBadge')}
                                                    </span>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* Position */}
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">
                                    {t('position.label')}
                                </Label>
                                <ToggleGroup<CaptionPosition>
                                    options={['top', 'bottom']}
                                    value={settings.captionPosition}
                                    onChange={(v) => update('captionPosition', v)}
                                    labels={{
                                        top: t('position.top'),
                                        bottom: t('position.bottom'),
                                    }}
                                />
                            </div>

                            {/* Size */}
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">
                                    {t('size.label')}
                                </Label>
                                <ToggleGroup<CaptionSize>
                                    options={['S', 'M', 'L']}
                                    value={settings.captionSize}
                                    onChange={(v) => update('captionSize', v)}
                                    labels={{
                                        S: t('size.small'),
                                        M: t('size.medium'),
                                        L: t('size.large'),
                                    }}
                                />
                            </div>

                            {/* Text color */}
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">
                                    {t('textColor.label')}
                                </Label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={settings.captionTextColor}
                                        onChange={(e) => update('captionTextColor', e.target.value)}
                                        className="size-8 cursor-pointer rounded border border-border p-0.5"
                                    />
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {settings.captionTextColor}
                                    </span>
                                </div>
                            </div>

                            {/* Background color + opacity */}
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">
                                    {t('background.label')}
                                </Label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={settings.captionBgColor}
                                        onChange={(e) => update('captionBgColor', e.target.value)}
                                        className="size-8 cursor-pointer rounded border border-border p-0.5"
                                    />
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {settings.captionBgColor}
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">
                                    {t('background.opacityLabel', {
                                        value: settings.captionBgOpacity,
                                    })}
                                </Label>
                                <Slider
                                    min={0}
                                    max={100}
                                    step={5}
                                    value={[settings.captionBgOpacity]}
                                    onValueChange={([v]) =>
                                        v !== undefined && update('captionBgOpacity', v)
                                    }
                                    className="w-full"
                                />
                            </div>

                            {/* Display mode (phrase vs karaoke per-word highlight) */}
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">
                                    {t('displayMode.label')}
                                </Label>
                                <ToggleGroup<CaptionStyle>
                                    options={['phrase', 'karaoke']}
                                    value={settings.captionStyle}
                                    onChange={(v) => update('captionStyle', v)}
                                    labels={{
                                        phrase: t('displayMode.phrase'),
                                        karaoke: t('displayMode.karaoke'),
                                    }}
                                />
                            </div>

                            {/* Font family + weight */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label className="text-xs text-muted-foreground">
                                        {t('font.label')}
                                    </Label>
                                    <select
                                        value={settings.captionFontFamily}
                                        onChange={(e) =>
                                            update(
                                                'captionFontFamily',
                                                e.target.value as CaptionFontFamily
                                            )
                                        }
                                        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                                    >
                                        <option value="system">{t('font.system')}</option>
                                        {/* Font names below are proper nouns (actual font
                                            family names), not translated. */}
                                        <option value="inter">Inter</option>
                                        <option value="montserrat">Montserrat</option>
                                        <option value="noto-sans">Noto Sans</option>
                                        <option value="fira-code">Fira Code</option>
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs text-muted-foreground">
                                        {t('weight.label')}
                                    </Label>
                                    <select
                                        value={settings.captionFontWeight}
                                        onChange={(e) =>
                                            update('captionFontWeight', Number(e.target.value))
                                        }
                                        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                                    >
                                        {[400, 500, 600, 700, 800, 900].map((w) => (
                                            <option key={w} value={w}>
                                                {w}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Text stroke (outline) */}
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">
                                    {t('textOutline.label', {
                                        width: settings.captionTextStrokeWidth,
                                    })}
                                </Label>
                                <div className="flex items-center gap-2">
                                    <Slider
                                        min={0}
                                        max={12}
                                        step={1}
                                        value={[settings.captionTextStrokeWidth]}
                                        onValueChange={([v]) =>
                                            v !== undefined && update('captionTextStrokeWidth', v)
                                        }
                                        className="flex-1"
                                    />
                                    <input
                                        type="color"
                                        value={settings.captionTextStrokeColor}
                                        onChange={(e) =>
                                            update('captionTextStrokeColor', e.target.value)
                                        }
                                        className="size-8 cursor-pointer rounded border border-border p-0.5"
                                        title={t('textOutline.colorTitle')}
                                    />
                                </div>
                            </div>

                            {/* Karaoke highlight color */}
                            {settings.captionStyle === 'karaoke' && (
                                <div className="space-y-1.5">
                                    <Label className="text-xs text-muted-foreground">
                                        {t('highlightColor.label')}
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="color"
                                            value={settings.captionHighlightColor}
                                            onChange={(e) =>
                                                update('captionHighlightColor', e.target.value)
                                            }
                                            className="size-8 cursor-pointer rounded border border-border p-0.5"
                                        />
                                        <span className="font-mono text-xs text-muted-foreground">
                                            {settings.captionHighlightColor}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <hr className="border-border" />

                    {/* Watermark toggle */}
                    <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">{t('watermark.label')}</Label>
                        <Switch
                            checked={settings.watermark}
                            onCheckedChange={(v) => update('watermark', v)}
                        />
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('actions.cancel')}
                    </Button>
                    <Button onClick={handleConfirm} className="gap-2">
                        <DownloadSimple className="size-4" />
                        {t('actions.startRender')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
