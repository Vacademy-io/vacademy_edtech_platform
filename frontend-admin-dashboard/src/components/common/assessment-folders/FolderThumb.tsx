import { Folder } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/** The folder's image, or a folder glyph when it has none. */
export const FolderThumb = ({
    imageUrl,
    className,
    iconSize = 18,
}: {
    imageUrl?: string | null;
    className?: string;
    iconSize?: number;
}) => (
    <span
        className={cn(
            'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary-50 text-primary-500',
            className
        )}
    >
        {imageUrl ? (
            <img src={imageUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
            <Folder size={iconSize} weight="duotone" />
        )}
    </span>
);
