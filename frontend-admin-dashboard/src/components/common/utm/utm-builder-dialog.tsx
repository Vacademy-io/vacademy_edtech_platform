import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { copyTextToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import {
    ArrowCounterClockwise,
    ArrowSquareOut,
    Check,
    Copy,
    QrCode,
    Warning,
} from '@phosphor-icons/react';
import {
    SUGGESTED_MEDIUMS,
    UTM_KEYS,
    SUGGESTED_SOURCES,
    buildUtmUrl,
    getRecentUtmValues,
    normalizeUtmValue,
    normalizeUtmValueLive,
    readUtmFromUrl,
    rememberUtmValues,
    stripUtmFromUrl,
    type UtmKey,
    type UtmSourceType,
    type UtmValues,
} from '@/lib/utm';
import { useUtmBuilderEnabled } from '@/hooks/use-utm-builder-enabled';

export interface UtmBuilderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The surface's normal shareable link, with or without existing UTM tags. */
    baseUrl: string;
    /** Which surface this came from — shown in the header and used for the QR filename. */
    sourceType: UtmSourceType;
    /** Human name of the specific thing being shared (campaign, session, course…). */
    entityName?: string;
}

const QR_ELEMENT_ID = 'utm-builder-qr-code';

/**
 * Download the rendered QR as a PNG.
 *
 * `react-qr-code` emits an SVG with no margin of its own. A QR with no quiet
 * zone is one many scanners will not read at all, so the canvas is drawn larger
 * than the image and the code centred inside it — the white border IS the quiet
 * zone, not decoration.
 */
const downloadQr = (fileName: string, onError: () => void) => {
    const svg = document.getElementById(QR_ELEMENT_ID);
    if (!svg) {
        onError();
        return;
    }
    const QUIET_ZONE = 32;
    const RENDER_SIZE = 512;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
        canvas.width = RENDER_SIZE + QUIET_ZONE * 2;
        canvas.height = RENDER_SIZE + QUIET_ZONE * 2;
        if (!ctx) {
            onError();
            return;
        }
        // Canvas colour keyword, not a CSS token — a transparent PNG dropped on
        // a dark background is unreadable to a scanner.
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, QUIET_ZONE, QUIET_ZONE, RENDER_SIZE, RENDER_SIZE);

        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `${fileName}.png`;
        link.click();
    };
    img.onerror = onError;
    // unescape/encodeURIComponent so non-ASCII in the URL survives btoa.
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
};

/** Rendered in order. Source and medium are what GA actually reports on. */
const FIELDS: Array<{ key: UtmKey; required: boolean }> = [
    { key: 'utm_source', required: true },
    { key: 'utm_medium', required: true },
    { key: 'utm_campaign', required: false },
    { key: 'utm_content', required: false },
    { key: 'utm_term', required: false },
];

export function UtmBuilderDialog({
    open,
    onOpenChange,
    baseUrl,
    sourceType,
    entityName,
}: UtmBuilderDialogProps) {
    const { t } = useTranslation('commonUtmBuilder');
    const { settings } = useUtmBuilderEnabled();
    const [values, setValues] = useState<UtmValues>({});
    const [showQr, setShowQr] = useState(false);
    const [copied, setCopied] = useState(false);
    const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // A link an institute already shared must not silently change shape, so the
    // base is always the surface's own URL with any stale utm_* stripped — and
    // whatever it already carried pre-fills the form instead of being lost.
    const cleanBase = useMemo(() => stripUtmFromUrl(baseUrl), [baseUrl]);

    useEffect(() => {
        if (!open) return;
        const existing = readUtmFromUrl(baseUrl);
        setValues({
            utm_source: existing.utm_source ?? settings.defaultSource ?? '',
            utm_medium: existing.utm_medium ?? settings.defaultMedium ?? '',
            utm_campaign: existing.utm_campaign ?? '',
            utm_content: existing.utm_content ?? '',
            utm_term: existing.utm_term ?? '',
        });
        setShowQr(false);
        setCopied(false);
        // `settings` is a fresh object on every render of the hook's consumer,
        // so depending on it would reset the form under the user's cursor.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, baseUrl]);

    useEffect(
        () => () => {
            if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
        },
        []
    );

    // Build from FULLY normalised values, not the live ones held in state.
    // Otherwise the URL depends on blur having fired: an admin who types
    // "diwali sale " and clicks Copy straight away — or presses Enter — would
    // copy a trailing hyphen and get a second, near-identical row in their
    // campaign report. Browsers do blur on mousedown, but relying on event
    // ordering for data correctness is not worth it.
    const generatedUrl = useMemo(() => {
        const finalised: UtmValues = {};
        for (const key of UTM_KEYS) {
            const value = values[key];
            if (value) finalised[key] = normalizeUtmValue(value);
        }
        return buildUtmUrl(cleanBase, finalised);
    }, [cleanBase, values]);

    const missingRequired = !values.utm_source?.trim() || !values.utm_medium?.trim();
    const missingCampaign = settings.requireCampaign && !values.utm_campaign?.trim();
    const canGenerate = Boolean(cleanBase) && !missingRequired && !missingCampaign;

    const suggestionsFor = (key: UtmKey): string[] => {
        const institute =
            key === 'utm_source' ? settings.sources : key === 'utm_medium' ? settings.mediums : [];
        const suggested =
            key === 'utm_source'
                ? [...SUGGESTED_SOURCES]
                : key === 'utm_medium'
                  ? [...SUGGESTED_MEDIUMS]
                  : [];
        // Institute list first — it is the house style; the generic suggestions
        // follow so a new institute is not staring at an empty list.
        return Array.from(new Set([...institute, ...getRecentUtmValues(key), ...suggested])).filter(
            Boolean
        );
    };

    // While typing: no trim, so an interior space survives long enough to
    // become a hyphen. On blur: the full normalisation, which also trims.
    const update = (key: UtmKey, raw: string) => {
        setValues((prev) => ({ ...prev, [key]: normalizeUtmValueLive(raw) }));
        setCopied(false);
    };

    const finalise = (key: UtmKey) => {
        setValues((prev) => ({ ...prev, [key]: normalizeUtmValue(prev[key] ?? '') }));
    };

    const handleCopy = async () => {
        if (!canGenerate) return;
        const ok = await copyTextToClipboard(generatedUrl);
        if (!ok) {
            toast.error(t('toast.copyFailed'));
            return;
        }
        // Remember the finalised spelling, so the suggestion list cannot offer
        // a half-typed variant back to the admin next time.
        rememberUtmValues(readUtmFromUrl(generatedUrl));
        setCopied(true);
        toast.success(t('toast.copied'));
        if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
        copyResetTimer.current = setTimeout(() => setCopied(false), 2000);
    };

    const handleReset = () => {
        setValues({
            utm_source: settings.defaultSource ?? '',
            utm_medium: settings.defaultMedium ?? '',
            utm_campaign: '',
            utm_content: '',
            utm_term: '',
        });
        setCopied(false);
    };

    const footer = (
        <>
            <MyButton
                type="button"
                scale="medium"
                buttonType="text"
                onClick={handleReset}
                className="mr-auto"
            >
                <ArrowCounterClockwise size={16} className="mr-1" />
                {t('actions.reset')}
            </MyButton>
            <MyButton
                type="button"
                scale="medium"
                buttonType="secondary"
                disable={!canGenerate}
                onClick={() => setShowQr((prev) => !prev)}
            >
                <QrCode size={16} className="mr-1" />
                {showQr ? t('actions.hideQr') : t('actions.showQr')}
            </MyButton>
            <MyButton
                type="button"
                scale="medium"
                buttonType="secondary"
                disable={!canGenerate}
                onClick={() => window.open(generatedUrl, '_blank', 'noopener')}
            >
                <ArrowSquareOut size={16} className="mr-1" />
                {t('actions.open')}
            </MyButton>
            <MyButton
                type="button"
                scale="medium"
                buttonType="primary"
                disable={!canGenerate}
                onClick={handleCopy}
            >
                {copied ? (
                    <Check size={16} className="mr-1" />
                ) : (
                    <Copy size={16} className="mr-1" />
                )}
                {copied ? t('actions.copied') : t('actions.copy')}
            </MyButton>
        </>
    );

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={t('title')}
            dialogWidth="max-w-2xl"
            footer={footer}
        >
            <div className="flex flex-col gap-5">
                <p className="text-body text-neutral-500">
                    {entityName
                        ? t('subtitleFor', {
                              surface: t(`surface.${sourceType}`),
                              name: entityName,
                          })
                        : t('subtitle', { surface: t(`surface.${sourceType}`) })}
                </p>

                {/* Destination — read-only. The admin is tagging a link the
                    surface owns; letting them edit it here would produce a URL
                    that no longer reaches the thing they are sharing. */}
                <div className="flex flex-col gap-1">
                    <span className="text-caption text-neutral-500">{t('destination.label')}</span>
                    <p className="break-all rounded-md bg-neutral-50 px-3 py-2 font-mono text-caption text-neutral-600">
                        {cleanBase || t('destination.missing')}
                    </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    {FIELDS.map(({ key, required }) => {
                        const listId = `utm-suggest-${key}`;
                        const options = suggestionsFor(key);
                        return (
                            <div
                                key={key}
                                className={cn(
                                    'flex flex-col gap-1',
                                    key === 'utm_campaign' && 'sm:col-span-2'
                                )}
                            >
                                <MyInput
                                    inputType="text"
                                    label={t(`fields.${key}.label`)}
                                    required={
                                        required ||
                                        (key === 'utm_campaign' && settings.requireCampaign)
                                    }
                                    inputPlaceholder={t(`fields.${key}.placeholder`)}
                                    input={values[key] ?? ''}
                                    onChangeFunction={(e) => update(key, e.target.value)}
                                    onBlur={() => finalise(key)}
                                    list={options.length ? listId : undefined}
                                    // MyInput's size variants cap the field at
                                    // sm:w-60; `w-full` alone loses to that at
                                    // ≥640px, so the sm: variant has to be
                                    // overridden explicitly.
                                    className="w-full sm:w-full"
                                />
                                {options.length > 0 && (
                                    <datalist id={listId}>
                                        {options.map((option) => (
                                            <option key={option} value={option} />
                                        ))}
                                    </datalist>
                                )}
                                <p className="text-caption text-neutral-400">
                                    {t(`fields.${key}.hint`)}
                                </p>
                            </div>
                        );
                    })}
                </div>

                {/* Preview — the point of the dialog. Shown even when incomplete
                    so the admin can see what is still missing. */}
                <div className="flex flex-col gap-1">
                    <span className="text-caption text-neutral-500">{t('preview.label')}</span>
                    <p
                        className={cn(
                            'max-h-24 overflow-y-auto break-all rounded-md border px-3 py-2 font-mono text-caption',
                            canGenerate
                                ? 'border-primary-200 bg-primary-50 text-neutral-700'
                                : 'border-neutral-200 bg-neutral-50 text-neutral-400'
                        )}
                    >
                        {generatedUrl || t('preview.empty')}
                    </p>
                    {(missingRequired || missingCampaign) && (
                        <p className="flex items-center gap-1 text-caption text-warning-600">
                            <Warning size={14} className="shrink-0" />
                            {missingRequired
                                ? t('validation.sourceMediumRequired')
                                : t('validation.campaignRequired')}
                        </p>
                    )}
                </div>

                {showQr && canGenerate && (
                    <div className="flex flex-col items-center gap-3 rounded-md border border-neutral-200 bg-white p-4">
                        <div className="bg-white p-3">
                            <QRCode
                                id={QR_ELEMENT_ID}
                                value={generatedUrl}
                                size={160}
                                className="size-40"
                            />
                        </div>
                        <MyButton
                            type="button"
                            scale="small"
                            buttonType="secondary"
                            onClick={() =>
                                downloadQr(
                                    `utm-${sourceType.toLowerCase()}-${
                                        values.utm_campaign || values.utm_source || 'link'
                                    }`,
                                    () => toast.error(t('toast.qrFailed'))
                                )
                            }
                        >
                            {t('actions.downloadQr')}
                        </MyButton>
                    </div>
                )}
            </div>
        </MyDialog>
    );
}

export default UtmBuilderDialog;
