import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    CalendarBlank,
    Check,
    Copy,
    CurrencyCircleDollar,
    DotsThreeVertical,
    LinkSimple,
    PencilSimple,
    QrCode,
    Star,
    Trash,
    UserCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { UtmBuilderDialog } from '@/components/common/utm/utm-builder-dialog';
import { copyTextToClipboard } from '@/lib/clipboard';
import { formatDateTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { InviteLinkDataInterface } from '@/schemas/study-library/invite-links-schema';
import { InviteQrDialog } from './invite-qr-dialog';
import { InvitePaymentSummaryLine, findPaymentSummary } from './invite-payment-summary';
import { ConfigurePaymentDialog } from './configure-payment-dialog';

interface InviteLinkCardProps {
    invite: InviteLinkDataInterface;
    /** The batch this card is rendered under — picks which payment summary to show. */
    packageSessionId: string;
    /** Full learner-portal URL for this invite, built by the parent. */
    inviteUrl: string;
    onEdit: () => void;
    onDelete: () => void;
    onMakeDefault: () => void;
    isMakingDefault: boolean;
}

const stripScheme = (url: string) => url.replace(/^https?:\/\//, '');

/**
 * Who did it, for the meta line. The backend resolves ids to names in one
 * batched call; when that lookup failed the raw id still identifies the admin,
 * so it is shown instead. Null when nothing was recorded (rows that predate
 * the column) — the line then simply omits the "by …" part.
 */
const actorLabel = (name?: string | null, userId?: string | null): string | null => {
    if (name && name.trim()) return name.trim();
    if (userId && userId.trim()) return userId.trim();
    return null;
};

/**
 * One invite link inside the course-details "Invite Links" dialog.
 *
 * The card itself stays quiet — name, tags, provenance, the link — and every
 * action lives behind the ⋮ menu (copy short URL, QR code, UTM generator,
 * edit, delete), with "Make default" as the one action kept in the open since
 * it is the decision an admin makes most often here.
 *
 * The short URL and UTM items are always offered, unlike the other share
 * surfaces: both gates (the course-page "view short invite links" display
 * setting and the institute UTM switch) default to OFF, which hid them from
 * every institute that never went looking for the toggles.
 */
export const InviteLinkCard = ({
    invite,
    packageSessionId,
    inviteUrl,
    onEdit,
    onDelete,
    onMakeDefault,
    isMakingDefault,
}: InviteLinkCardProps) => {
    const { t } = useTranslation('studyLibraryCourseDetailsInviteDetailsComponent');
    const [linkCopied, setLinkCopied] = useState(false);
    const [qrOpen, setQrOpen] = useState(false);
    const [utmOpen, setUtmOpen] = useState(false);
    const [paymentOpen, setPaymentOpen] = useState(false);

    const isDefault = invite.tag === 'DEFAULT';
    const shortUrl = invite.short_url || null;

    const createdBy = actorLabel(invite.created_by_name, invite.created_by_user_id);

    // The card is rendered per batch, so show that batch's payment option.
    const payment = findPaymentSummary(invite, packageSessionId);

    const copyLink = useCallback(async () => {
        const didCopy = await copyTextToClipboard(inviteUrl);
        if (!didCopy) {
            toast.error(t('copyFailed'));
            return;
        }
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
    }, [inviteUrl, t]);

    // The menu unmounts on select, so the only feedback a copy from it can
    // give is a toast — and the toast carries the address so it can be read.
    const copyShortUrl = useCallback(async () => {
        if (!shortUrl) return;
        const didCopy = await copyTextToClipboard(shortUrl);
        if (!didCopy) {
            toast.error(t('copyFailed'));
            return;
        }
        toast.success(t('shortUrlCopied', { url: stripScheme(shortUrl) }));
    }, [shortUrl, t]);

    return (
        // Own TooltipProvider: the app mounts one in the sidebar layout, but a
        // card that dies with "must be used within TooltipProvider" the moment
        // it is rendered anywhere else (a test, a future list page) is fragile.
        // Radix providers nest without side effects.
        <TooltipProvider delayDuration={200}>
            <div
                className={cn(
                    'flex flex-col gap-3 rounded-lg border bg-white p-4 transition-colors',
                    isDefault ? 'border-primary-200' : 'border-neutral-200'
                )}
            >
                {/* Header: identity on the left, "Make default" + ⋮ on the right. */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-subtitle font-semibold text-neutral-700">
                                {invite.name}
                            </span>
                            {isDefault && (
                                <Badge
                                    variant="outline"
                                    className="gap-1 border-primary-200 bg-primary-50 text-primary-500 shadow-none"
                                >
                                    <Star weight="fill" className="size-3" />
                                    {t('defaultTag')}
                                </Badge>
                            )}
                            {invite.invite_code && (
                                <Badge
                                    variant="outline"
                                    className="border-neutral-200 bg-neutral-50 font-mono font-normal text-neutral-600 shadow-none"
                                >
                                    {invite.invite_code}
                                </Badge>
                            )}
                        </div>

                        {/* Provenance: created when, and by whom when an actor was recorded. */}
                        <dl className="flex flex-col gap-0.5 text-caption text-neutral-500">
                            <div className="flex flex-wrap items-center gap-x-1.5">
                                <dt className="flex items-center gap-1">
                                    <CalendarBlank className="size-3.5" />
                                    {t('meta.created')}
                                </dt>
                                <dd className="text-neutral-700">
                                    {invite.created_at
                                        ? formatDateTime(invite.created_at)
                                        : t('meta.unknownDate')}
                                </dd>
                                {createdBy && (
                                    <>
                                        <dt className="flex items-center gap-1">
                                            <span aria-hidden="true">·</span>
                                            <UserCircle className="size-3.5" />
                                            {t('meta.by')}
                                        </dt>
                                        <dd className="text-neutral-700">{createdBy}</dd>
                                    </>
                                )}
                            </div>
                            {payment && (
                                <div className="flex flex-wrap items-center gap-x-1.5">
                                    <dt className="flex items-center gap-1">
                                        <CurrencyCircleDollar className="size-3.5" />
                                        {t('payment.label')}
                                    </dt>
                                    <dd className="min-w-0 text-neutral-700">
                                        <InvitePaymentSummaryLine summary={payment} />
                                    </dd>
                                </div>
                            )}
                        </dl>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        {!isDefault && (
                            <MyButton
                                type="button"
                                scale="small"
                                buttonType="secondary"
                                disabled={isMakingDefault}
                                onClick={onMakeDefault}
                                className="flex items-center gap-1"
                            >
                                <Star className="size-3.5" />
                                {t('makeDefault')}
                            </MyButton>
                        )}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <MyButton
                                    type="button"
                                    scale="small"
                                    buttonType="secondary"
                                    layoutVariant="icon"
                                    aria-label={t('actions')}
                                >
                                    <DotsThreeVertical weight="bold" className="size-4" />
                                </MyButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    disabled={!shortUrl}
                                    onSelect={copyShortUrl}
                                >
                                    <LinkSimple className="me-2 size-4 shrink-0" />
                                    <span className="flex min-w-0 flex-col">
                                        <span>{t('menu.copyShortUrl')}</span>
                                        <span className="truncate text-caption text-neutral-500">
                                            {shortUrl
                                                ? stripScheme(shortUrl)
                                                : t('shortUrlUnavailable')}
                                        </span>
                                    </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    onSelect={() => setQrOpen(true)}
                                >
                                    <QrCode className="me-2 size-4" />
                                    {t('menu.qrCode')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    onSelect={() => setUtmOpen(true)}
                                >
                                    <LinkSimple className="me-2 size-4" />
                                    {t('menu.utmGenerator')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    disabled={!payment}
                                    onSelect={() => setPaymentOpen(true)}
                                >
                                    <CurrencyCircleDollar className="me-2 size-4" />
                                    {t('menu.configurePayment')}
                                </DropdownMenuItem>
                                <DropdownMenuItem className="cursor-pointer" onSelect={onEdit}>
                                    <PencilSimple className="me-2 size-4" />
                                    {t('edit')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className="cursor-pointer text-danger-600 focus:bg-danger-50 focus:text-danger-600"
                                    onSelect={onDelete}
                                >
                                    <Trash className="me-2 size-4" />
                                    {t('delete')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                {/* The full invite URL. The anchor opens it; the icon copies it. */}
                <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                    <LinkSimple className="size-4 shrink-0 text-neutral-400" />
                    <a
                        href={inviteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={inviteUrl}
                        className="min-w-0 flex-1 truncate text-body text-neutral-600 hover:text-primary-500 hover:underline"
                    >
                        {inviteUrl}
                    </a>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <MyButton
                                type="button"
                                scale="small"
                                buttonType="secondary"
                                layoutVariant="icon"
                                onClick={copyLink}
                                aria-label={t('copyLink')}
                            >
                                {linkCopied ? (
                                    <Check className="size-3.5 text-success-600" />
                                ) : (
                                    <Copy className="size-3.5" />
                                )}
                            </MyButton>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            {linkCopied ? t('copied') : t('copyLink')}
                        </TooltipContent>
                    </Tooltip>
                </div>

                {/* Dialogs live beside the menu, not inside it: a Radix dropdown
                    unmounts its content on close and would take them with it. */}
                <InviteQrDialog
                    open={qrOpen}
                    onOpenChange={setQrOpen}
                    inviteName={invite.name}
                    inviteUrl={inviteUrl}
                    shortUrl={shortUrl}
                />
                {/* Mounted only while open: its form, queries and plan picker are
                    per card, and a list of cards should not hold them all idle. */}
                {paymentOpen && (
                    <ConfigurePaymentDialog
                        open={paymentOpen}
                        onOpenChange={setPaymentOpen}
                        invite={invite}
                        packageSessionId={packageSessionId}
                    />
                )}
                <UtmBuilderDialog
                    open={utmOpen}
                    onOpenChange={setUtmOpen}
                    baseUrl={inviteUrl}
                    sourceType="ENROLL_INVITE"
                    entityName={invite.name}
                />
            </div>
        </TooltipProvider>
    );
};

export default InviteLinkCard;
