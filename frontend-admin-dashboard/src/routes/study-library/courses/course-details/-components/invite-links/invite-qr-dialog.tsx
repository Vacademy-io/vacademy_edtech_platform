import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Copy, DownloadSimple, ShieldCheck, Warning } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import { copyTextToClipboard } from '@/lib/clipboard';

interface InviteQrDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    inviteName: string;
    /** The invite's full learner-portal URL. Always available. */
    inviteUrl: string;
    /** The invite's short link, when the institute has one minted for it. */
    shortUrl?: string | null;
}

/**
 * Same QR geometry as the audience ShareQrDialog, for the same reasons: level Q
 * survives a smudged print, a 4-module quiet zone is what scanners need and
 * qrcode.react defaults it to 0, and 1024px is enough for an A4 poster.
 */
const QR_ERROR_CORRECTION = 'Q';
const QR_MARGIN_MODULES = 4;
const QR_DOWNLOAD_PX = 1024;
const QR_PREVIEW_PX = 200;

// Baked into the exported PNG, which cannot resolve our CSS tokens; a QR also
// needs true black on true white for the widest scanner compatibility.
const QR_FG_COLOR = '#000000'; // design-lint-ignore: rasterised into the download, see comment above
const QR_BG_COLOR = '#FFFFFF'; // design-lint-ignore: rasterised into the download, see comment above

const toFileSlug = (value: string, fallback: string) => {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return slug || fallback;
};

/**
 * QR code for one enroll invite.
 *
 * Encodes the full invite URL by default. The short link is offered as an
 * opt-in because it is a redirect that can later be retired in media_service,
 * and a printed QR outlives the poster run — the dialog states that trade-off
 * instead of deciding it silently. The choice resets on every open so a
 * poster never inherits a previous session's toggle.
 */
export const InviteQrDialog = ({
    open,
    onOpenChange,
    inviteName,
    inviteUrl,
    shortUrl,
}: InviteQrDialogProps) => {
    const { t } = useTranslation('studyLibraryCourseDetailsInviteDetailsComponent');
    const [encodeShortUrl, setEncodeShortUrl] = useState(false);
    const [copied, setCopied] = useState(false);
    const exportCanvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!open) {
            setEncodeShortUrl(false);
            setCopied(false);
        }
    }, [open]);

    const usesShortUrl = encodeShortUrl && !!shortUrl;
    const qrValue = usesShortUrl && shortUrl ? shortUrl : inviteUrl;
    const fileSlug = useMemo(() => toFileSlug(inviteName, 'invite'), [inviteName]);

    const handleCopy = useCallback(async () => {
        const didCopy = await copyTextToClipboard(qrValue);
        if (!didCopy) {
            toast.error(t('copyFailed'));
            return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [qrValue, t]);

    const handleDownloadPng = useCallback(() => {
        const canvas = exportCanvasRef.current;
        if (!canvas) {
            toast.error(t('qr.downloadFailed'));
            return;
        }
        try {
            const link = document.createElement('a');
            link.href = canvas.toDataURL('image/png');
            link.download = `${fileSlug}-qr.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            toast.success(t('qr.downloaded'));
        } catch {
            toast.error(t('qr.downloadFailed'));
        }
    }, [fileSlug, t]);

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={t('qr.title')}
            dialogWidth="w-dialog-md"
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={handleCopy}
                        className="flex items-center gap-2"
                    >
                        {copied ? (
                            <Check className="size-4 text-success-600" />
                        ) : (
                            <Copy className="size-4" />
                        )}
                        {copied ? t('copied') : t('qr.copyLink')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={handleDownloadPng}
                        className="flex items-center gap-2"
                    >
                        <DownloadSimple className="size-4" />
                        {t('qr.downloadPng')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                <p className="text-body text-neutral-600">
                    {t('qr.description', { name: inviteName })}
                </p>

                <div className="flex flex-col items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-6">
                    <div className="rounded-md border border-neutral-200 bg-white p-3 shadow-sm">
                        <QRCodeSVG
                            value={qrValue}
                            size={QR_PREVIEW_PX}
                            level={QR_ERROR_CORRECTION}
                            marginSize={QR_MARGIN_MODULES}
                            fgColor={QR_FG_COLOR}
                            bgColor={QR_BG_COLOR}
                            title={t('qr.title')}
                        />
                    </div>
                    <p className="max-w-full break-all text-center text-caption text-neutral-500">
                        {qrValue}
                    </p>
                </div>

                {shortUrl && (
                    <label className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3">
                        <Switch
                            checked={encodeShortUrl}
                            onCheckedChange={setEncodeShortUrl}
                            aria-label={t('qr.useShortUrl')}
                        />
                        <span className="flex flex-col gap-0.5">
                            <span className="text-body font-semibold text-neutral-700">
                                {t('qr.useShortUrl')}
                            </span>
                            <span className="text-caption leading-relaxed text-neutral-600">
                                {t('qr.useShortUrlHint')}
                            </span>
                        </span>
                    </label>
                )}

                {usesShortUrl ? (
                    <div className="flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 p-3">
                        <Warning className="mt-0.5 size-4 shrink-0 text-warning-600" />
                        <span className="text-caption leading-relaxed text-neutral-700">
                            {t('qr.shortUrlWarning')}
                        </span>
                    </div>
                ) : (
                    <div className="flex items-start gap-2.5 rounded-lg border border-success-100 bg-success-50 p-3">
                        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success-600" />
                        <span className="text-caption leading-relaxed text-neutral-700">
                            {t('qr.fullUrlNote')}
                        </span>
                    </div>
                )}

                {/* Full-resolution canvas backing "Download PNG". Zero-sized rather
                    than hidden so it has painted by the time toDataURL reads it. */}
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
            </div>
        </MyDialog>
    );
};

export default InviteQrDialog;
