import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DownloadSimple,
    Eye,
    File,
    FileDoc,
    FileImage,
    FilePdf,
    FilePpt,
    FileXls,
    FileZip,
    EnvelopeSimple,
    Paperclip,
    X,
    type Icon,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getEmailAttachmentBlob, type EmailAttachment } from '../../-services/email-inbox-api';

/** Images up to this size get a thumbnail on the card; larger ones show the file icon. */
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

/** Raster images render through <img> only; SVG too (an <img> never runs its scripts). */
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)$/i;

type Kind = 'pdf' | 'image' | 'doc' | 'sheet' | 'slides' | 'archive' | 'email' | 'other';

function kindOf(a: EmailAttachment): Kind {
    const type = a.contentType.toLowerCase();
    const name = a.filename.toLowerCase();
    if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (IMAGE_TYPES.test(type)) return 'image';
    if (type === 'message/rfc822' || name.endsWith('.eml')) return 'email';
    if (/(word|opendocument\.text|rtf)/.test(type) || /\.(docx?|odt|rtf)$/.test(name)) return 'doc';
    if (/(excel|spreadsheet|csv)/.test(type) || /\.(xlsx?|ods|csv)$/.test(name)) return 'sheet';
    if (/(powerpoint|presentation)/.test(type) || /\.(pptx?|odp)$/.test(name)) return 'slides';
    if (
        /(zip|compressed|x-rar|x-7z|gzip|x-tar)/.test(type) ||
        /\.(zip|rar|7z|gz|tar)$/.test(name)
    ) {
        return 'archive';
    }
    return 'other';
}

const KIND_ICON: Record<Kind, { icon: Icon; tone: string }> = {
    pdf: { icon: FilePdf, tone: 'text-danger-600' },
    image: { icon: FileImage, tone: 'text-info-600' },
    doc: { icon: FileDoc, tone: 'text-info-600' },
    sheet: { icon: FileXls, tone: 'text-success-600' },
    slides: { icon: FilePpt, tone: 'text-warning-600' },
    archive: { icon: FileZip, tone: 'text-neutral-600' },
    email: { icon: EnvelopeSimple, tone: 'text-neutral-600' },
    other: { icon: File, tone: 'text-neutral-600' },
};

const canPreview = (a: EmailAttachment) => {
    const kind = kindOf(a);
    return kind === 'pdf' || kind === 'image';
};

export function formatBytes(size: number, locale: string): string {
    if (!Number.isFinite(size) || size < 0) return '';
    const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
    let value = size;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: units[unit],
        unitDisplay: 'short',
        maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
    }).format(value);
}

// Bytes are fetched once per (message, part) and shared by the thumbnail, preview and download.
const blobCache = new Map<string, Promise<Blob>>();

function loadBlob(messageId: string, instituteId: string, a: EmailAttachment): Promise<Blob> {
    const key = `${messageId}:${a.id}`;
    let pending = blobCache.get(key);
    if (!pending) {
        pending = getEmailAttachmentBlob(messageId, instituteId, a.id).then((blob) =>
            // Re-type from what we decided it is, never from the sender's declared type: a PDF
            // preview must open the PDF viewer, nothing else.
            kindOf(a) === 'pdf' ? new Blob([blob], { type: 'application/pdf' }) : blob
        );
        pending.catch(() => blobCache.delete(key));
        blobCache.set(key, pending);
    }
    return pending;
}

function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

interface ListProps {
    messageId: string;
    instituteId: string;
    attachments: EmailAttachment[];
}

/** Gmail-style attachment cards under an email: thumbnail/icon, name, size; click to open. */
export function EmailAttachmentList({ messageId, instituteId, attachments }: ListProps) {
    const { t } = useTranslation('communicationEmailThread');
    const [previewing, setPreviewing] = useState<EmailAttachment | null>(null);

    if (attachments.length === 0) return null;

    const download = async (a: EmailAttachment) => {
        try {
            saveBlob(await loadBlob(messageId, instituteId, a), a.filename);
        } catch {
            toast.error(t('downloadFailed', { name: a.filename }));
        }
    };

    return (
        <section
            className="mt-4 border-t border-neutral-200 pt-3"
            aria-label={t('attachmentsLabel')}
        >
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                <Paperclip size={14} />
                {t('attachmentCount', { count: attachments.length })}
            </p>
            <ul className="flex flex-wrap gap-3">
                {attachments.map((a) => (
                    <li key={a.id}>
                        <AttachmentCard
                            messageId={messageId}
                            instituteId={instituteId}
                            attachment={a}
                            onOpen={() => (canPreview(a) ? setPreviewing(a) : download(a))}
                            onDownload={() => download(a)}
                        />
                    </li>
                ))}
            </ul>
            <AttachmentViewer
                messageId={messageId}
                instituteId={instituteId}
                attachment={previewing}
                onClose={() => setPreviewing(null)}
                onDownload={download}
            />
        </section>
    );
}

function AttachmentCard({
    messageId,
    instituteId,
    attachment: a,
    onOpen,
    onDownload,
}: {
    messageId: string;
    instituteId: string;
    attachment: EmailAttachment;
    onOpen: () => void;
    onDownload: () => void;
}) {
    const { t, i18n } = useTranslation('communicationEmailThread');
    const kind = kindOf(a);
    const { icon: KindIcon, tone } = KIND_ICON[kind];
    const thumbnail = useThumbnail(
        messageId,
        instituteId,
        a,
        kind === 'image' && a.size >= 0 && a.size <= THUMBNAIL_MAX_BYTES
    );
    const size = formatBytes(a.size, i18n.language);

    return (
        <div className="group relative w-44 overflow-hidden rounded-md border border-neutral-200 bg-white transition-shadow hover:shadow-md">
            <button
                type="button"
                onClick={onOpen}
                className="block w-full text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                title={a.filename}
            >
                <div className="flex h-24 items-center justify-center overflow-hidden bg-neutral-100">
                    {thumbnail ? (
                        <img src={thumbnail} alt="" className="size-full object-cover" />
                    ) : (
                        <KindIcon size={40} weight="duotone" className={tone} />
                    )}
                </div>
                <div className="flex items-center gap-2 border-t border-neutral-200 px-2 py-1.5">
                    <KindIcon size={16} weight="fill" className={cn('shrink-0', tone)} />
                    <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-neutral-800">
                            {a.filename}
                        </p>
                        {size && <p className="text-2xs text-neutral-500">{size}</p>}
                    </div>
                </div>
            </button>
            {/* Hover actions, as in Gmail: preview (when we can) and download. */}
            <div className="absolute end-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                {canPreview(a) && (
                    <CardAction label={t('preview')} onClick={onOpen}>
                        <Eye size={14} weight="bold" />
                    </CardAction>
                )}
                <CardAction label={t('download')} onClick={onDownload}>
                    <DownloadSimple size={14} weight="bold" />
                </CardAction>
            </div>
        </div>
    );
}

function CardAction({
    label,
    onClick,
    children,
}: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={label}
            aria-label={label}
            className="flex size-7 items-center justify-center rounded-full bg-neutral-800/75 text-white hover:bg-neutral-900"
        >
            {children}
        </button>
    );
}

/** Object URL of an image attachment for its card, revoked on unmount. */
function useThumbnail(
    messageId: string,
    instituteId: string,
    a: EmailAttachment,
    enabled: boolean
) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let created: string | null = null;
        loadBlob(messageId, instituteId, a)
            .then((blob) => {
                if (cancelled) return;
                created = URL.createObjectURL(blob);
                setUrl(created);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
            if (created) URL.revokeObjectURL(created);
        };
        // a.id identifies the attachment within the message.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messageId, instituteId, a.id, enabled]);
    return url;
}

/** Full-screen viewer for an image or PDF, with the file's name and a download button. */
function AttachmentViewer({
    messageId,
    instituteId,
    attachment,
    onClose,
    onDownload,
}: {
    messageId: string;
    instituteId: string;
    attachment: EmailAttachment | null;
    onClose: () => void;
    onDownload: (a: EmailAttachment) => void;
}) {
    const { t, i18n } = useTranslation('communicationEmailThread');
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setUrl(null);
        setFailed(false);
        if (!attachment) return;
        let cancelled = false;
        let created: string | null = null;
        loadBlob(messageId, instituteId, attachment)
            .then((blob) => {
                if (cancelled) return;
                created = URL.createObjectURL(blob);
                setUrl(created);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
            if (created) URL.revokeObjectURL(created);
        };
    }, [attachment, messageId, instituteId]);

    const kind = attachment ? kindOf(attachment) : 'other';
    const { icon: KindIcon, tone } = KIND_ICON[kind];

    return (
        <Dialog open={!!attachment} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="dialog-no-close-icon flex h-5/6 w-11/12 max-w-6xl flex-col gap-0 overflow-hidden rounded-lg p-0">
                <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-4 py-2.5">
                    <KindIcon size={20} weight="fill" className={cn('shrink-0', tone)} />
                    <div className="min-w-0 flex-1">
                        <DialogTitle className="truncate text-sm font-medium text-neutral-900">
                            {attachment?.filename}
                        </DialogTitle>
                        <DialogDescription className="text-2xs text-neutral-500">
                            {attachment ? formatBytes(attachment.size, i18n.language) : ''}
                        </DialogDescription>
                    </div>
                    {attachment && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => onDownload(attachment)}
                            className="gap-1.5"
                        >
                            <DownloadSimple size={14} weight="bold" />
                            {t('download')}
                        </MyButton>
                    )}
                    <MyButton
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        onClick={onClose}
                        aria-label={t('close')}
                        title={t('close')}
                    >
                        <X size={16} weight="bold" />
                    </MyButton>
                </header>
                <div className="flex min-h-0 flex-1 items-center justify-center bg-neutral-100">
                    {failed ? (
                        <p className="text-sm text-neutral-600">{t('previewFailed')}</p>
                    ) : !url ? (
                        <Skeleton className="size-2/3 rounded-md" />
                    ) : kind === 'pdf' ? (
                        <iframe
                            title={attachment?.filename ?? 'pdf'}
                            src={url}
                            className="size-full border-0"
                        />
                    ) : (
                        <img
                            src={url}
                            alt={attachment?.filename ?? ''}
                            className="max-h-full max-w-full object-contain p-4"
                        />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
