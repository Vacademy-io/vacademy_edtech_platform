import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleNotch, ImageBroken } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { ScanFileKind, ScanRotation } from '../-services/scan-station-services';
import { thumbUrl } from '../-lib/thumb-source';

const ROTATION_CLASS: Record<ScanRotation, string> = {
    0: '',
    90: 'rotate-90',
    180: 'rotate-180',
    270: '-rotate-90',
};

/**
 * One scanned page as a small picture, turned the way it will sit in the copy.
 * Loads only once it scrolls into view.
 */
export const PageThumb = ({
    fileId,
    kind,
    pageIndex,
    rotation = 0,
    label,
    size = 'md',
    muted = false,
    className,
}: {
    fileId: string;
    kind: ScanFileKind;
    pageIndex: number;
    rotation?: ScanRotation;
    /** Alt text and caption. */
    label: string;
    size?: 'md' | 'lg';
    /** Dimmed (a page being left out). */
    muted?: boolean;
    className?: string;
}) => {
    const { t } = useTranslation('scanStation');
    const box = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [src, setSrc] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const el = box.current;
        if (!el || visible) return;
        if (typeof IntersectionObserver === 'undefined') {
            setVisible(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '200px' }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [visible]);

    useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        setFailed(false);
        thumbUrl(fileId, kind, pageIndex)
            .then((url) => {
                if (!cancelled) setSrc(url);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [visible, fileId, kind, pageIndex]);

    return (
        <div
            ref={box}
            className={cn(
                'flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-neutral-50',
                size === 'lg' ? 'h-80 w-60' : 'h-28 w-20',
                muted && 'opacity-50',
                className
            )}
            title={label}
        >
            {src ? (
                <img
                    src={src}
                    alt={label}
                    loading="lazy"
                    className={cn(
                        'max-h-full max-w-full object-contain transition-transform',
                        ROTATION_CLASS[rotation]
                    )}
                />
            ) : failed ? (
                <span className="flex flex-col items-center gap-1 p-1 text-center text-2xs text-neutral-500">
                    <ImageBroken size={18} />
                    {t('thumb.failed')}
                </span>
            ) : (
                <CircleNotch size={16} className="animate-spin text-neutral-400" />
            )}
        </div>
    );
};

export default PageThumb;
