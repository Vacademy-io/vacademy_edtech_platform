import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
    Check,
    Copy,
    DownloadSimple,
    Printer,
    QrCode,
    ShieldCheck,
    SpinnerGap,
    Warning,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { CampaignItem } from '../../-services/get-campaigns-list';
import createCampaignLink from '../../-utils/createCampaignLink';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useShortLink } from '@/hooks/use-short-link';
import { useAudienceShortLinksEnabled } from '@/hooks/use-audience-short-links-enabled';
import { SHORT_LINK_SOURCE } from '@/services/short-link';
import { copyTextToClipboard } from '@/lib/clipboard';

interface ShareQrDialogProps {
    isOpen: boolean;
    onClose: () => void;
    campaign: CampaignItem;
    /** Set for enquiry forms so the link targets /enquiry-response instead. */
    isEnquiry?: boolean;
}

/**
 * Error correction level. Q recovers 25% of the symbol, which is what survives
 * a print smudge, a lamination crease or a thumb over one corner — the ways a
 * QR on a standee actually fails. H would be sturdier still but pushes the
 * campaign URL to version 12 (65x65 modules), and finer modules scan worse
 * from a distance, which is the more common failure for a poster.
 */
const QR_ERROR_CORRECTION = 'Q';

/**
 * Quiet zone, in modules. The spec requires 4 and scanners genuinely need it:
 * a QR rendered flush to its own edge is unreadable once it sits on a coloured
 * background. qrcode.react defaults this to 0, so it must be passed explicitly
 * on every symbol we render — preview, download and print alike.
 */
const QR_MARGIN_MODULES = 4;

/** Pixel size of the downloadable PNG — large enough for an A4 print at 300dpi. */
const QR_DOWNLOAD_PX = 1024;

/** Pixel size of the on-screen preview. */
const QR_PREVIEW_PX = 216;

// The QR is rasterised and leaves the app as a file, so its colours have to be
// literal — a downloaded PNG can't resolve our --token CSS variables, and a QR
// needs true black on true white for the widest scanner compatibility.
const QR_FG_COLOR = '#000000'; // design-lint-ignore: baked into the exported image, see comment above
const QR_BG_COLOR = '#FFFFFF'; // design-lint-ignore: baked into the exported image, see comment above

// The print sheet renders in a blank `window.open` document that loads none of
// our stylesheets, so its CSS has to be self-contained literal values — a
// `--token` var would resolve to nothing and the poster would print unstyled.
const PRINT_INK_COLOR = '#111827'; // design-lint-ignore: standalone print document, see comment above
const PRINT_MUTED_COLOR = '#6b7280'; // design-lint-ignore: standalone print document, see comment above
const PRINT_PAPER_COLOR = '#ffffff'; // design-lint-ignore: standalone print document, see comment above

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/** Strip characters a filesystem (or a browser's download shelf) will mangle. */
const toFileSlug = (value: string, fallback: string) => {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return slug || fallback;
};

const triggerDownload = (href: string, filename: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/**
 * "Share QR" for an audience form.
 *
 * Offers both addresses for the same form: the campaign's own long URL and a
 * `u.<domain>/s/<code>` short link, which is the one that fits in a WhatsApp
 * message or gets read aloud. The short link is get-or-create'd once per
 * campaign and cached, so the code an admin shares today is the code they share
 * next month.
 *
 * **The QR encodes the long URL by default, and that default matters.** A short
 * link is a redirect somebody can later switch off in media_service, and a
 * printed QR outlives the poster run — encode the destination directly and there
 * is nothing in the middle that can expire. The toggle is there because a
 * shorter payload also means a lower-version, coarser-module symbol that scans
 * better from a distance; the dialog states the trade-off rather than deciding
 * it silently.
 */
export const ShareQrDialog = ({ isOpen, onClose, campaign, isEnquiry }: ShareQrDialogProps) => {
    const { t } = useTranslation('audienceManagerShareQrDialog');
    const { instituteDetails } = useInstituteDetailsStore();
    const [copied, setCopied] = useState(false);
    const [shortCopied, setShortCopied] = useState(false);
    const [encodeShortLinkInQr, setEncodeShortLinkInQr] = useState(false);
    const { enabled: shortLinksEnabled, isResolved: shortLinksResolved } =
        useAudienceShortLinksEnabled();

    // Full-size canvas, kept out of the layout. It is what "Download PNG"
    // reads: rasterising the 216px preview instead would hand people a blurry
    // code that fails to scan the moment it is enlarged for print.
    const exportCanvasRef = useRef<HTMLCanvasElement>(null);
    const previewSvgRef = useRef<SVGSVGElement>(null);

    // The card's ⋮ menu renders this dialog UNCONDITIONALLY (only `isOpen`
    // flips), so it never unmounts and its state would otherwise survive a
    // close. That would quietly break the guarantee the panel below states: the
    // second and every later open would start with the short link already
    // encoded, and a poster run could go out depending on a revocable redirect
    // that nobody chose this time. Opting into a short-link QR has to be a
    // deliberate decision on every single open.
    useEffect(() => {
        if (!isOpen) {
            setEncodeShortLinkInQr(false);
            setCopied(false);
            setShortCopied(false);
        }
    }, [isOpen]);

    const campaignId = campaign.id || campaign.campaign_id || campaign.audience_id || '';
    const campaignName = campaign.campaign_name || t('defaults.campaignName');

    const formUrl = useMemo(
        () => createCampaignLink(campaignId, instituteDetails?.learner_portal_base_url, isEnquiry),
        [campaignId, instituteDetails?.learner_portal_base_url, isEnquiry]
    );

    // Fetched on open rather than behind another click: opening this dialog is
    // already an explicit "I want to share this" action, and get-or-create is
    // idempotent, so re-opening costs nothing and returns the same code.
    const {
        shortUrl,
        isLoading: isShortening,
        isError: shortLinkFailed,
    } = useShortLink({
        source: isEnquiry
            ? SHORT_LINK_SOURCE.ENQUIRY_CAMPAIGN
            : SHORT_LINK_SOURCE.AUDIENCE_CAMPAIGN,
        sourceId: campaignId,
        destinationUrl: formUrl,
        instituteId: instituteDetails?.id,
        // Gated on `shortLinksResolved` too — this INSERTs a row, and the switch
        // reads optimistically ON while loading, so an opted-out institute could
        // otherwise mint a link just by opening this dialog quickly.
        enabled: isOpen && !!formUrl && shortLinksEnabled && shortLinksResolved,
    });

    // Everything the QR touches — preview, PNG, SVG and the print sheet — reads
    // this single value, so the downloaded artefact can never disagree with the
    // symbol the admin was looking at.
    // ONE source of truth for "is a redirect baked into this code?". The value
    // the symbol encodes and the panel that explains it must never be derived
    // separately — a QR that says "never expires" over a revocable short link is
    // the single worst thing this dialog could do. Gated on the institute switch
    // as well as the toggle, so an institute that turned short links off can
    // never end up with one in a printed QR.
    const qrUsesShortLink = shortLinksEnabled && encodeShortLinkInQr && !!shortUrl;
    const qrValue = qrUsesShortLink && shortUrl ? shortUrl : formUrl;

    const fileSlug = useMemo(
        () => toFileSlug(campaignName, t('defaults.fileSlug')),
        [campaignName, t]
    );

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(formUrl);
            setCopied(true);
            toast.success(t('toasts.linkCopied'));
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error(t('toasts.copyFailed'));
        }
    }, [formUrl, t]);

    const handleCopyShort = useCallback(async () => {
        if (!shortUrl) return;
        const didCopy = await copyTextToClipboard(shortUrl);
        if (!didCopy) {
            toast.error(t('toasts.copyFailed'));
            return;
        }
        setShortCopied(true);
        toast.success(t('toasts.shortLinkCopied'));
        setTimeout(() => setShortCopied(false), 2000);
    }, [shortUrl, t]);

    const handleDownloadPng = useCallback(() => {
        const canvas = exportCanvasRef.current;
        if (!canvas) {
            toast.error(t('toasts.downloadFailed'));
            return;
        }
        try {
            triggerDownload(canvas.toDataURL('image/png'), `${fileSlug}-qr.png`);
            toast.success(t('toasts.downloaded'));
        } catch {
            toast.error(t('toasts.downloadFailed'));
        }
    }, [fileSlug, t]);

    const handleDownloadSvg = useCallback(() => {
        const svg = previewSvgRef.current;
        if (!svg) {
            toast.error(t('toasts.downloadFailed'));
            return;
        }
        try {
            // Clone before resizing: mutating the live node would resize the
            // preview the user is looking at.
            const clone = svg.cloneNode(true) as SVGSVGElement;
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('width', String(QR_DOWNLOAD_PX));
            clone.setAttribute('height', String(QR_DOWNLOAD_PX));
            const markup = new XMLSerializer().serializeToString(clone);
            // Blob rather than a base64 data: URI — btoa() throws on any
            // non-Latin-1 character, which a translated <title> would carry.
            const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            triggerDownload(url, `${fileSlug}-qr.svg`);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast.success(t('toasts.downloaded'));
        } catch {
            toast.error(t('toasts.downloadFailed'));
        }
    }, [fileSlug, t]);

    const handlePrint = useCallback(() => {
        const svg = previewSvgRef.current;
        if (!svg) {
            toast.error(t('toasts.printFailed'));
            return;
        }
        const printWindow = window.open('', '_blank', 'width=900,height=1000');
        if (!printWindow) {
            // Almost always a popup blocker; say so rather than failing silently.
            toast.error(t('toasts.popupBlocked'));
            return;
        }

        const clone = svg.cloneNode(true) as SVGSVGElement;
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', '340');
        clone.setAttribute('height', '340');
        const svgMarkup = new XMLSerializer().serializeToString(clone);

        // Self-contained document: inline SVG and inline CSS only, so nothing
        // has to load before the print dialog opens.
        printWindow.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(campaignName)}</title>
<style>
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: ${PRINT_INK_COLOR};
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .sheet { text-align: center; max-width: 520px; padding: 24px; }
  .eyebrow { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: ${PRINT_MUTED_COLOR}; margin: 0 0 10px; }
  h1 { font-size: 26px; line-height: 1.25; margin: 0 0 24px; }
  .frame { display: inline-block; padding: 18px; border: 2px solid ${PRINT_INK_COLOR}; border-radius: 14px; background: ${PRINT_PAPER_COLOR}; }
  .frame svg { display: block; }
  .cta { font-size: 17px; font-weight: 600; margin: 22px 0 6px; }
  .url { font-size: 11px; color: ${PRINT_MUTED_COLOR}; word-break: break-all; margin: 0; }
  @media print { body { min-height: auto; } }
</style>
</head>
<body>
  <div class="sheet">
    <p class="eyebrow">${escapeHtml(t('print.eyebrow'))}</p>
    <h1>${escapeHtml(campaignName)}</h1>
    <div class="frame">${svgMarkup}</div>
    <p class="cta">${escapeHtml(t('print.cta'))}</p>
    <p class="url">${escapeHtml(qrValue)}</p>
  </div>
</body>
</html>`);
        printWindow.document.close();
        printWindow.focus();
        // Let the inline SVG lay out before the (blocking) print dialog opens.
        printWindow.setTimeout(() => printWindow.print(), 250);
    }, [campaignName, qrValue, t]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-dialog-tall w-dialog-md overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <QrCode className="size-5" />
                        {t('dialogTitle')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialogDescription', { campaignName })}
                    </DialogDescription>
                </DialogHeader>

                {!formUrl ? (
                    <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-4 text-center text-sm text-neutral-500">
                        {t('missingLink')}
                    </p>
                ) : (
                    <div className="mt-2 flex flex-col gap-5">
                        {/* Preview */}
                        <div className="flex flex-col items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 px-4 py-6">
                            <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
                                <QRCodeSVG
                                    ref={previewSvgRef}
                                    value={qrValue}
                                    size={QR_PREVIEW_PX}
                                    level={QR_ERROR_CORRECTION}
                                    marginSize={QR_MARGIN_MODULES}
                                    fgColor={QR_FG_COLOR}
                                    bgColor={QR_BG_COLOR}
                                    title={t('qrTitle', { campaignName })}
                                />
                            </div>
                            <p className="text-center text-sm font-medium text-neutral-700">
                                {t('scanPrompt')}
                            </p>
                        </div>

                        {/* Link */}
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-neutral-600">
                                {t('linkLabel')}
                            </span>
                            <div className="flex items-center gap-2">
                                <Input
                                    readOnly
                                    value={formUrl}
                                    onFocus={(e) => e.currentTarget.select()}
                                    className="h-9 flex-1 bg-neutral-50 text-xs text-neutral-700"
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-9 shrink-0 gap-1.5"
                                    onClick={handleCopy}
                                >
                                    {copied ? (
                                        <Check className="size-3.5 text-success-600" />
                                    ) : (
                                        <Copy className="size-3.5" />
                                    )}
                                    {copied ? t('actions.copied') : t('actions.copyLink')}
                                </Button>
                            </div>
                        </div>

                        {/* Short link — the one that fits in an SMS or gets read
                            aloud. Falls back to a plain note if the shortener is
                            unreachable; the long link above always works. Hidden
                            entirely when the institute switched short links off. */}
                        {shortLinksEnabled && (
                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs font-medium text-neutral-600">
                                    {t('shortLink.label')}
                                </span>
                                {shortLinkFailed ? (
                                    <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                                        {t('shortLink.unavailable')}
                                    </p>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <Input
                                            readOnly
                                            value={shortUrl ?? ''}
                                            placeholder={t('shortLink.generating')}
                                            onFocus={(e) => e.currentTarget.select()}
                                            className="h-9 flex-1 bg-neutral-50 text-xs text-neutral-700"
                                        />
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-9 shrink-0 gap-1.5"
                                            disabled={!shortUrl}
                                            onClick={handleCopyShort}
                                        >
                                            {isShortening ? (
                                                <SpinnerGap className="size-3.5 animate-spin" />
                                            ) : shortCopied ? (
                                                <Check className="size-3.5 text-success-600" />
                                            ) : (
                                                <Copy className="size-3.5" />
                                            )}
                                            {shortCopied
                                                ? t('actions.copied')
                                                : t('actions.copyShortLink')}
                                        </Button>
                                    </div>
                                )}
                                {shortUrl && (
                                    <label className="mt-1 flex items-start gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
                                        <Switch
                                            checked={encodeShortLinkInQr}
                                            onCheckedChange={setEncodeShortLinkInQr}
                                            aria-label={t('shortLink.useInQr')}
                                        />
                                        <span className="flex flex-col gap-0.5">
                                            <span className="text-xs font-semibold text-neutral-800">
                                                {t('shortLink.useInQr')}
                                            </span>
                                            <span className="text-xs leading-relaxed text-neutral-600">
                                                {t('shortLink.useInQrHint')}
                                            </span>
                                        </span>
                                    </label>
                                )}
                            </div>
                        )}

                        {/* Downloads */}
                        <div className="flex flex-wrap gap-2">
                            <Button
                                size="sm"
                                className="h-9 gap-1.5 bg-primary-500 text-white shadow-sm hover:bg-primary-600"
                                onClick={handleDownloadPng}
                            >
                                <DownloadSimple className="size-4" />
                                {t('actions.downloadPng')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 gap-1.5"
                                onClick={handleDownloadSvg}
                            >
                                <DownloadSimple className="size-4" />
                                {t('actions.downloadSvg')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 gap-1.5"
                                onClick={handlePrint}
                            >
                                <Printer className="size-4" />
                                {t('actions.print')}
                            </Button>
                        </div>

                        {/* What this particular code depends on. The wording has
                            to follow the toggle: telling someone their QR can
                            never expire while it in fact encodes a revocable
                            redirect is the one thing this panel must not do. */}
                        {qrUsesShortLink ? (
                            <div className="flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 p-3">
                                <Warning className="mt-0.5 size-4 shrink-0 text-warning-600" />
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs font-semibold text-warning-700">
                                        {t('shortLinkInQr.title')}
                                    </span>
                                    <span className="text-xs leading-relaxed text-neutral-600">
                                        {t('shortLinkInQr.body')}
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-start gap-2.5 rounded-lg border border-success-100 bg-success-50 p-3">
                                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success-600" />
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs font-semibold text-success-700">
                                        {t('noExpiry.title')}
                                    </span>
                                    <span className="text-xs leading-relaxed text-neutral-600">
                                        {t('noExpiry.body')}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Off-layout full-resolution canvas backing "Download PNG".
                    Collapsed to zero size rather than `hidden` (display:none), so the
                    canvas is guaranteed to have painted by the time toDataURL reads it. */}
                {formUrl && (
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute size-0 overflow-hidden"
                    >
                        <QRCodeCanvas
                            ref={exportCanvasRef}
                            value={qrValue}
                            size={QR_DOWNLOAD_PX}
                            level={QR_ERROR_CORRECTION}
                            marginSize={QR_MARGIN_MODULES}
                            fgColor={QR_FG_COLOR}
                            bgColor={QR_BG_COLOR}
                        />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default ShareQrDialog;
