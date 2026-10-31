import { useTranslation } from 'react-i18next';
import { FilePdf, GoogleDriveLogo, LinkSimple, YoutubeLogo } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * What kind of freebie a link is — a card can point at an uploaded PDF, a
 * YouTube video or playlist, a Google Drive file/folder, or any other page.
 */
export const freebieKind = (url: string): 'youtube' | 'drive' | 'pdf' | 'link' => {
    let host = '';
    let path = url;
    try {
        const u = new URL(url);
        host = u.hostname.toLowerCase();
        path = u.pathname;
    } catch {
        /* a site page route — falls through to the extension check */
    }
    if (/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host)) return 'youtube';
    if (/(^|\.)(drive|docs)\.google\.com$/.test(host)) return 'drive';
    if (/\.pdf$/i.test(path)) return 'pdf';
    return 'link';
};

const KIND_ICON = {
    youtube: { Icon: YoutubeLogo, className: 'text-danger-500' },
    drive: { Icon: GoogleDriveLogo, className: 'text-success-600' },
    pdf: { Icon: FilePdf, className: 'text-danger-600' },
    link: { Icon: LinkSimple, className: 'text-neutral-500' },
} as const;

export const FreebieKindIcon = ({ url }: { url: string }) => {
    const { t } = useTranslation('freebieDownloads');
    const kind = freebieKind(url);
    const { Icon, className } = KIND_ICON[kind];
    return (
        <span title={t(`kind.${kind}`)} className="shrink-0">
            <Icon weight="fill" className={cn('size-3.5', className)} aria-label={t(`kind.${kind}`)} />
        </span>
    );
};
