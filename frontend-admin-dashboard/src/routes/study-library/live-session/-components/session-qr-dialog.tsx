/**
 * The join-link QR code, on demand.
 *
 * Every session card used to render a live 64px `<QRCode>` plus a download
 * button inline, so a page of ten sessions painted ten QR codes nobody had
 * asked for — and printed the raw join URL next to each one. Both now live
 * behind the card's ⋮ menu, which is where the mock puts them and where they
 * cost nothing until wanted.
 */
import QRCode from 'react-qr-code';
import { Copy, DownloadSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { copyToClipboard } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/helper';
import { handleDownloadQRCode } from '@/routes/homework-creation/create-assessment/$assessmentId/$examtype/-utils/helper';

interface SessionQrDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    joinLink: string;
    sessionId: string;
    heading: string;
    /** 'private' | 'public' — a private link only opens for an enrolled learner. */
    accessLevel?: string | null;
}

export default function SessionQrDialog({
    open,
    onOpenChange,
    joinLink,
    sessionId,
    heading,
    accessLevel,
}: SessionQrDialogProps) {
    const isPrivate = (accessLevel ?? '').toLowerCase() === 'private';
    const { t } = useTranslation('studyLibraryLiveSessionCard');
    const { t: tHelper } = useTranslation('homeworkCreationCreateAssessmentHelper');
    // handleDownloadQRCode serialises the SVG by id, so the node has to be in
    // the DOM — which it only is while this dialog is open.
    const qrElementId = `qr-code-svg-live-session-${sessionId}`;

    return (
        <MyDialog heading={heading} open={open} onOpenChange={onOpenChange} className="max-w-md">
            <div
                className="flex flex-col items-center gap-4 p-5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                    <QRCode value={joinLink} className="size-44" id={qrElementId} />
                </div>

                <div className="flex w-full items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                    <span
                        className="min-w-0 flex-1 truncate text-xs text-neutral-600"
                        title={joinLink}
                    >
                        {joinLink}
                    </span>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        layoutVariant="icon"
                        className="shrink-0 bg-white"
                        onClick={() => copyToClipboard(joinLink)}
                        aria-label={t('actions.copyJoinLink')}
                    >
                        <Copy size={14} />
                    </MyButton>
                </div>

                {/* A private session's link is an embed URL that only opens for a
                    learner already enrolled in one of its batches. Sharing it
                    outside that group silently fails, so say so here rather than
                    letting someone discover it after sending it out. */}
                {isPrivate ? (
                    <p className="w-full text-xs font-medium text-danger-600">
                        {t('privateLinkWarning')}
                    </p>
                ) : null}

                <MyButton
                    type="button"
                    scale="medium"
                    buttonType="primary"
                    className="w-full"
                    onClick={() => handleDownloadQRCode(qrElementId, tHelper)}
                >
                    <DownloadSimple size={16} className="mr-2" />
                    {t('actions.downloadQrCode')}
                </MyButton>
            </div>
        </MyDialog>
    );
}
