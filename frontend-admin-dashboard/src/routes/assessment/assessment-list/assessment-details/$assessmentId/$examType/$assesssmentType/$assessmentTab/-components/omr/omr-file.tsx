import { useQuery } from '@tanstack/react-query';
import { getPublicUrl } from '@/services/upload_file';
import { cn } from '@/lib/utils';

/** Signed URLs last a day; a sheet's images never change, so one fetch per file is enough. */
const URL_STALE_MS = 30 * 60 * 1000;

export const useOmrFileUrl = (fileId: string | null | undefined) =>
    useQuery({
        queryKey: ['OMR_FILE_URL', fileId],
        queryFn: () => getPublicUrl(fileId),
        enabled: !!fileId,
        staleTime: URL_STALE_MS,
    });

/** A media-service image (the name-box crop) shown inline; nothing while it loads. */
export const OmrFileImage = ({
    fileId,
    alt,
    className,
}: {
    fileId: string | null | undefined;
    alt: string;
    className?: string;
}) => {
    const { data: url } = useOmrFileUrl(fileId);
    if (!fileId || !url) return null;
    return (
        <img
            src={url}
            alt={alt}
            loading="lazy"
            className={cn('rounded border border-neutral-200 bg-white object-contain', className)}
        />
    );
};

/**
 * Open a media-service file in a new tab. The tab is opened before the URL is
 * fetched so the browser still treats it as a click, not a popup.
 */
export const openOmrFile = async (fileId: string): Promise<boolean> => {
    const tab = window.open('', '_blank');
    const url = await getPublicUrl(fileId);
    if (!url) {
        tab?.close();
        return false;
    }
    if (tab) {
        tab.opener = null;
        tab.location.href = url;
    } else {
        window.open(url, '_blank', 'noopener');
    }
    return true;
};
