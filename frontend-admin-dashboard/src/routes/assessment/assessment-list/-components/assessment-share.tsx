import { Copy, DownloadSimple, Info, QrCode, WarningCircle } from '@phosphor-icons/react';
import QRCode from 'react-qr-code';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
    copyToClipboard,
    handleDownloadQRCode,
} from '../../create-assessment/$assessmentId/$examtype/-utils/helper';

/**
 * Sharing for one assessment — the join link and its QR code — used from the
 * card's ⋮ menu. The link opens the learner registration page, which only
 * accepts learners for an Open Test (PUBLIC); a Closed Test (PRIVATE) is taken
 * by its assigned learners from their app, so every surface here says so.
 */

/** The QR element id handleDownloadQRCode looks up — unchanged from the old card. */
export const assessmentQrId = (joinCode: string) => `qr-code-svg-assessment-list-${joinCode}`;

/** Title + explanation of why a Closed Test's link does not work, and how to change it. */
function PrivateLinkExplanation() {
    const { t } = useTranslation('assessmentScheduleTestDetails');
    return (
        <div className="flex flex-col gap-1">
            <span className="font-semibold text-warning-700">{t('privateLink.title')}</span>
            <span>{t('privateLink.body')}</span>
        </div>
    );
}

/** ⓘ next to the Private badge on a card. */
export function PrivateLinkInfo() {
    const { t } = useTranslation('assessmentScheduleTestDetails');
    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className="inline-flex size-6 items-center justify-center rounded-full text-warning-600 hover:bg-warning-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-warning-300"
                        aria-label={t('privateLink.ariaLabel')}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Info size={16} weight="bold" />
                    </button>
                </TooltipTrigger>
                {/* Explicit surface: the shared TooltipContent paints bg-primary, which the
                    admin theme does not define, so a long text would float unreadable. */}
                <TooltipContent className="max-w-sm rounded-lg border border-warning-200 bg-white p-3 text-caption text-neutral-700 shadow-lg">
                    <PrivateLinkExplanation />
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

const copyJoinLink = async (joinLink: string, isPrivate: boolean, t: (key: string) => string) => {
    await copyToClipboard(joinLink);
    if (isPrivate) toast.warning(t('share.copiedPrivate'), { duration: 6000 });
    else toast.success(t('share.copied'));
};

/** "Copy join link" and "Show QR code" for the ⋮ menu. The QR dialog is rendered by the parent. */
export function JoinLinkMenuItems({
    joinLink,
    isPrivate,
    onShowQr,
}: {
    joinLink: string;
    isPrivate: boolean;
    onShowQr: () => void;
}) {
    const { t } = useTranslation('assessmentScheduleTestDetails');
    return (
        <>
            {/* stopPropagation: the menu sits inside a clickable card, and a click
                that bubbles to it would navigate away. */}
            <DropdownMenuItem
                className="cursor-pointer gap-2"
                onClick={(e) => {
                    e.stopPropagation();
                    void copyJoinLink(joinLink, isPrivate, t);
                }}
            >
                <Copy size={16} />
                {t('share.copyLink')}
            </DropdownMenuItem>
            <DropdownMenuItem
                className="cursor-pointer gap-2"
                onClick={(e) => {
                    e.stopPropagation();
                    onShowQr();
                }}
            >
                <QrCode size={16} />
                {t('share.qrCode')}
            </DropdownMenuItem>
        </>
    );
}

/** The join link with copy, its QR code with download, and the Closed Test warning. */
export function JoinLinkQrDialog({
    open,
    onOpenChange,
    joinLink,
    qrId,
    isPrivate,
    assessmentName,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    joinLink: string;
    qrId: string;
    isPrivate: boolean;
    assessmentName: string;
}) {
    const { t } = useTranslation('assessmentScheduleTestDetails');
    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={t('qrDialog.title')}
            dialogWidth="max-w-md"
        >
            <div
                className="flex flex-col items-center gap-4 p-4"
                onClick={(e) => e.stopPropagation()}
            >
                <p className="w-full text-center text-body font-semibold text-neutral-900">
                    {assessmentName}
                </p>
                {isPrivate ? (
                    <div className="flex w-full gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-caption text-warning-700">
                        <WarningCircle size={18} weight="fill" className="shrink-0" />
                        <PrivateLinkExplanation />
                    </div>
                ) : (
                    <p className="w-full text-center text-caption text-neutral-500">
                        {t('qrDialog.description')}
                    </p>
                )}
                <div className="rounded-lg border border-neutral-200 bg-white p-3">
                    <QRCode value={joinLink} className="size-44" id={qrId} />
                </div>
                <div className="flex w-full items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                    <span
                        className="min-w-0 flex-1 truncate text-sm text-neutral-700"
                        title={joinLink}
                    >
                        {joinLink}
                    </span>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="shrink-0 gap-1.5"
                        onClick={() => copyJoinLink(joinLink, isPrivate, t)}
                    >
                        <Copy size={14} />
                        {t('qrDialog.copy')}
                    </MyButton>
                </div>
                <MyButton
                    type="button"
                    scale="medium"
                    buttonType="primary"
                    className="w-full gap-1.5"
                    onClick={() => handleDownloadQRCode(qrId)}
                >
                    <DownloadSimple size={16} />
                    {t('qrDialog.download')}
                </MyButton>
            </div>
        </MyDialog>
    );
}
