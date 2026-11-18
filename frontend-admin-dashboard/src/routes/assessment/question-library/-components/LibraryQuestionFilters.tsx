import { cn } from '@/lib/utils';
import { type LibraryTag, type LibraryTagKind } from '../-services/question-library-services';

const kindTone: Record<LibraryTagKind, string> = {
    CONCEPT: 'border-primary-200 text-primary-500',
    PYQ: 'border-warning-200 text-warning-600',
    SOURCE: 'border-info-200 text-info-600',
};

/** One small chip for a tag, coloured by its kind. */
export const LibraryTagChip = ({
    tag,
    selected = false,
    onClick,
    count,
}: {
    tag: LibraryTag;
    selected?: boolean;
    onClick?: () => void;
    count?: number | null;
}) => {
    const className = cn(
        'inline-flex max-w-xs items-center gap-1 truncate rounded-full border bg-white px-2 py-0.5 text-caption',
        kindTone[tag.kind] ?? 'border-neutral-200 text-neutral-600',
        selected && 'bg-primary-50 font-semibold ring-1 ring-primary-400'
    );
    const body = (
        <>
            <span className="truncate">{tag.tag_name}</span>
            {count != null && <span className="text-neutral-400">{count}</span>}
        </>
    );
    return onClick ? (
        <button type="button" onClick={onClick} aria-pressed={selected} className={className}>
            {body}
        </button>
    ) : (
        <span className={className}>{body}</span>
    );
};
