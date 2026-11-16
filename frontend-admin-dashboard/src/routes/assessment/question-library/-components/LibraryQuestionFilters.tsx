import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
    LIBRARY_TAG_KINDS,
    type LibraryTag,
    type LibraryTagKind,
} from '../-services/question-library-services';
import { DIFFICULTIES } from './library-constants';

const ALL = 'ALL';

/** All / Easy / Medium / Hard with how many questions each has. */
export const DifficultyTabs = ({
    value,
    onChange,
    counts,
}: {
    /** '' for all. */
    value: string;
    onChange: (value: string) => void;
    /** Missing counts hide the numbers (they are unknown, not zero). */
    counts?: Record<string, number>;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const total = counts ? DIFFICULTIES.reduce((sum, level) => sum + (counts[level] ?? 0), 0) : 0;
    const label = (text: string, count?: number) => (
        <span className="flex items-center gap-1">
            {text}
            {counts && (
                <span className="rounded-full bg-neutral-100 px-1.5 text-caption text-neutral-500">
                    {count ?? 0}
                </span>
            )}
        </span>
    );
    return (
        <Tabs value={value || ALL} onValueChange={(next) => onChange(next === ALL ? '' : next)}>
            <TabsList className="h-auto flex-wrap justify-start">
                <TabsTrigger value={ALL}>{label(t('filters.allLevels'), total)}</TabsTrigger>
                {DIFFICULTIES.map((level) => (
                    <TabsTrigger key={level} value={level}>
                        {label(t(`difficulty.${level}`), counts?.[level])}
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    );
};

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

/**
 * The tags used in the open course or topic, grouped by kind. One tag filters at a time:
 * picking another replaces it, picking the same one clears it.
 */
export const TagFilter = ({
    tags,
    selected,
    onSelect,
}: {
    tags: LibraryTag[];
    selected: string;
    onSelect: (tagId: string) => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    if (tags.length === 0) return null;
    return (
        <div className="flex flex-col gap-2">
            {LIBRARY_TAG_KINDS.map((kind) => {
                const ofKind = tags.filter((tag) => tag.kind === kind);
                if (ofKind.length === 0) return null;
                return (
                    <div key={kind} className="flex flex-wrap items-center gap-2">
                        <span className="w-20 shrink-0 text-caption font-semibold text-neutral-500">
                            {t(`tags.kind.${kind}`)}
                        </span>
                        {ofKind.map((tag) => (
                            <LibraryTagChip
                                key={tag.tag_id}
                                tag={tag}
                                count={tag.question_count}
                                selected={selected === tag.tag_id}
                                onClick={() => onSelect(selected === tag.tag_id ? '' : tag.tag_id)}
                            />
                        ))}
                    </div>
                );
            })}
        </div>
    );
};
