import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { BookOpenText, Books, Info, Plus, UploadSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { StatusChip } from '@/components/design-system/status-chips';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getInstituteId } from '@/constants/helper';
import { PUBLISHER_INSTITUTE_ID } from '../../-constants';
import { useLibraryCatalogue, useLibraryTaxonomy } from '../../-hooks';
import type { CatalogueFilters, LibraryListing, LibraryTaxonomy } from '../../-types/library';
import { LibraryCover } from './LibraryCover';
import { TaxonomyPicker, findBoard, findExam, type TaxonomySelection } from './TaxonomyPicker';

const formatCount = (n: number) => new Intl.NumberFormat('en-IN').format(n);

const isNumeric = (value: string | null | undefined): value is string =>
    Boolean(value) && Number.isFinite(Number(value));

/** Exam-level listings carry this instead of a class; it is not worth a chip. */
const EXAM_LEVEL = 'UG';

/** "Class 10" for a class level, the level itself ("Class 5th to 12th") otherwise. */
const levelLabel = (t: TFunction, level: string | null): string | null =>
    level && level !== EXAM_LEVEL
        ? isNumeric(level)
            ? t('classLabel', { number: level })
            : level
        : null;

/** The board or exam a listing is filed under, by display name rather than key. */
const boardLabel = (taxonomy: LibraryTaxonomy | undefined, board: string | null): string | null => {
    if (!board || !taxonomy) return board;
    return (
        taxonomy.boards.find((b) => b.key === board)?.name ??
        taxonomy.exams.find((e) => e.key === board)?.name ??
        board
    );
};

/** One line of honest numbers, skipping anything we don't have. */
const describeSize = (t: TFunction, library: LibraryListing): string =>
    [
        library.sources
            ? t('describeSize.sources', {
                  count: library.sources,
                  formatted: formatCount(library.sources),
              })
            : null,
        library.pages
            ? t('describeSize.pages', {
                  count: library.pages,
                  formatted: formatCount(library.pages),
              })
            : null,
        library.language,
    ]
        .filter(Boolean)
        .join(' · ');

const LibraryGridCard = ({
    library,
    taxonomy,
    onOpen,
}: {
    library: LibraryListing;
    taxonomy?: LibraryTaxonomy;
    onOpen: () => void;
}) => {
    const { t } = useTranslation('knowledgeBaseLibraryBrowser');
    return (
        <button
            type="button"
            onClick={onOpen}
            className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white text-start transition-all hover:-translate-y-0.5 hover:border-primary-400 hover:shadow-md"
        >
            <div className="h-28 w-full overflow-hidden bg-neutral-50">
                <LibraryCover
                    fileId={library.cover_file_id}
                    alt={library.cover_alt}
                    title={library.title}
                />
            </div>
            <div className="flex flex-1 flex-col gap-2 p-4">
                <p className="break-words text-body font-semibold text-neutral-700">
                    {library.title}
                </p>
                <p className="line-clamp-2 break-words text-caption text-neutral-500">
                    {library.summary}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-caption text-neutral-400">
                    {[
                        library.subject,
                        levelLabel(t, library.level),
                        boardLabel(taxonomy, library.board),
                    ]
                        .filter(Boolean)
                        .map((chip) => (
                            <span key={chip} className="rounded-sm bg-neutral-50 px-1.5 py-0.5">
                                {chip}
                            </span>
                        ))}
                </div>
                <p className="text-caption text-neutral-400">{describeSize(t, library)}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                    <StatusChip
                        status="SUCCESS"
                        text={t('card.free')}
                        textSize="text-caption"
                        showIcon={false}
                    />
                    {library.curriculum_kind === 'SYLLABUS' && (
                        <StatusChip
                            status="INFO"
                            text={t('card.syllabus')}
                            textSize="text-caption"
                            showIcon={false}
                        />
                    )}
                </div>
            </div>
        </button>
    );
};

const CardGrid = ({
    libraries,
    taxonomy,
    onOpen,
}: {
    libraries: LibraryListing[];
    taxonomy?: LibraryTaxonomy;
    onOpen: (library: LibraryListing) => void;
}) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {libraries.map((library) => (
            <LibraryGridCard
                key={library.knowledge_base_id}
                library={library}
                taxonomy={taxonomy}
                onOpen={() => onOpen(library)}
            />
        ))}
    </div>
);

/** Class-numbered books grouped "Class 6", "Class 7"…, then anything else. */
const groupByClass = (libraries: LibraryListing[]): Array<[string | null, LibraryListing[]]> => {
    const groups = new Map<string | null, LibraryListing[]>();
    for (const library of libraries) {
        const key = isNumeric(library.level) ? library.level : null;
        groups.set(key, [...(groups.get(key) ?? []), library]);
    }
    const bySubject = (a: LibraryListing, b: LibraryListing) =>
        `${a.subject ?? ''} ${a.title}`.localeCompare(`${b.subject ?? ''} ${b.title}`);
    return Array.from(groups.entries())
        .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : Number(a) - Number(b)))
        .map(([key, items]) => [key, items.sort(bySubject)]);
};

/** The picker selection as catalogue query parameters. */
const toFilters = (value: TaxonomySelection, search: string): CatalogueFilters => ({
    ...(value.track === 'exam' ? { exam: value.exam } : { board: value.board, level: value.cls }),
    subject: value.subject,
    language: value.medium,
    q: search || undefined,
    limit: 500,
});

/** Where the teacher lands: the first board with something in it, all classes. */
const initialSelection = (taxonomy: LibraryTaxonomy): TaxonomySelection => ({
    track: 'board',
    board: (taxonomy.boards.find((b) => b.libraries > 0) ?? taxonomy.boards[0])?.key,
});

interface LibraryBrowserProps {
    /** Opens the "create your own knowledge base" flow, offered when a shelf is empty. */
    onAddOwn?: () => void;
}

/**
 * Browse the libraries Vacademy publishes.
 *
 * A teacher arrives thinking "CBSE, Class 10, Science", not "which knowledge
 * bases exist" — so the shop is organised the way a syllabus is: pick a
 * board (or an entrance exam), a class, a subject, and the books for it
 * appear. Every board and class is offered even before its books are loaded,
 * and the server answers CBSE and the NCERT-adopting state boards with the
 * NCERT books they prescribe.
 */
export const LibraryBrowser = ({ onAddOwn }: LibraryBrowserProps) => {
    const { t } = useTranslation('knowledgeBaseLibraryBrowser');
    const navigate = useNavigate();
    const [selection, setSelection] = useState<TaxonomySelection | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    const { data: taxonomy, isError: taxonomyFailed } = useLibraryTaxonomy(selection?.medium);

    // The first taxonomy to arrive decides the landing shelf; later refetches
    // (per medium) must not yank the teacher's selection away.
    useEffect(() => {
        if (taxonomy && !selection) setSelection(initialSelection(taxonomy));
    }, [taxonomy, selection]);

    // Debounced so typing a title does not fire a request per keystroke.
    useEffect(() => {
        const handle = setTimeout(() => setDebouncedSearch(search), search ? 300 : 0);
        return () => clearTimeout(handle);
    }, [search]);

    // An exam track with no exam picked yet is a prompt, not a query — an
    // unconstrained catalogue would be the wrong answer to "which exam?".
    const awaitingPick = Boolean(
        selection && (selection.track === 'exam' ? !selection.exam : !selection.board)
    );
    const filters = useMemo(
        () => (selection && !awaitingPick ? toFilters(selection, debouncedSearch) : null),
        [selection, awaitingPick, debouncedSearch]
    );
    const { data: catalogue, isPlaceholderData } = useLibraryCatalogue(filters ?? {}, {
        enabled: Boolean(filters),
        keepPrevious: true,
    });
    // Libraries with no board (STEM) have no shelf in the picker; they get
    // their own strip below so they are never lost.
    const { data: everything } = useLibraryCatalogue({ limit: 500 });
    const otherLibraries = useMemo(
        () => (everything?.libraries ?? []).filter((l) => !l.board),
        [everything]
    );

    const libraries = catalogue?.libraries;
    const groups = useMemo(() => (libraries ? groupByClass(libraries) : []), [libraries]);

    const board = taxonomy && selection ? findBoard(taxonomy, selection.board) : undefined;
    const exam = taxonomy && selection ? findExam(taxonomy, selection.exam) : undefined;

    // "CBSE prescribes NCERT textbooks" — shown when what came back was
    // answered by a different board than the one picked.
    const aliasNote = useMemo(() => {
        if (!libraries?.length) return null;
        const sourceBoards = Array.from(
            new Set(libraries.map((l) => l.board).filter((b): b is string => Boolean(b)))
        );
        if (board) {
            const foreign = sourceBoards.filter((b) => b !== board.key && b !== board.name);
            if (foreign.length === 0) return null;
            return t(
                board.alias_kind === 'OVERLAPS' ? 'aliasNote.boardOverlap' : 'aliasNote.board',
                {
                    board: board.name,
                    source: foreign.join(', '),
                }
            );
        }
        if (exam) {
            // The exam's own syllabus / past papers need no explanation; the
            // note is for the NCERT books it is built on.
            const borrowed = libraries.filter((l) => l.board && l.board !== exam.key);
            const foreign = Array.from(
                new Set(borrowed.map((l) => l.board).filter((b): b is string => Boolean(b)))
            );
            const classes = Array.from(
                new Set(borrowed.map((l) => l.level).filter(isNumeric))
            ).sort((a, b) => Number(a) - Number(b));
            if (foreign.length === 0 || classes.length === 0) return null;
            return t('aliasNote.exam', {
                exam: exam.name,
                source: foreign.join(', '),
                classes: classes.join(', '),
            });
        }
        return null;
    }, [libraries, board, exam, t]);

    const selectionLabel = useMemo(() => {
        if (!selection) return '';
        const parts = [
            exam?.name ?? board?.name,
            selection.cls ? t('classLabel', { number: selection.cls }) : null,
            selection.subject,
            selection.medium,
        ].filter(Boolean);
        return parts.join(' · ');
    }, [selection, board, exam, t]);

    const open = (library: LibraryListing) =>
        navigate({
            to: '/knowledge-base/library/$kbId',
            params: { kbId: library.knowledge_base_id },
        });

    const canPublish = getInstituteId() === PUBLISHER_INSTITUTE_ID;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-2xl text-body text-neutral-500">{t('intro')}</p>
                {canPublish && (
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => navigate({ to: '/knowledge-base/publish' })}
                    >
                        <UploadSimple className="mr-1 size-4" />
                        {t('manageLibrary')}
                    </MyButton>
                )}
            </div>

            {taxonomy && selection ? (
                <TaxonomyPicker taxonomy={taxonomy} value={selection} onChange={setSelection} />
            ) : taxonomyFailed ? (
                <Card className="p-4 text-body text-neutral-500">{t('picker.unavailable')}</Card>
            ) : (
                <Skeleton className="h-40 w-full rounded-xl" />
            )}

            {awaitingPick && (
                <Card className="flex flex-col items-center gap-2 p-8 text-center">
                    <Books className="size-6 text-neutral-300" />
                    <p className="text-body text-neutral-600">{t('picker.pickExam')}</p>
                </Card>
            )}

            {selection && !awaitingPick && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-subtitle font-semibold text-neutral-700">
                            {libraries
                                ? t('results.count', {
                                      count: libraries.length,
                                      selection: selectionLabel,
                                  })
                                : selectionLabel}
                        </p>
                        {aliasNote && (
                            <p className="flex items-start gap-1.5 text-caption text-neutral-500">
                                <Info className="mt-0.5 size-3.5 shrink-0 text-primary-500" />
                                {aliasNote}
                            </p>
                        )}
                    </div>
                    <MyInput
                        inputType="text"
                        input={search}
                        onChangeFunction={(e) => setSearch(e.target.value)}
                        inputPlaceholder={t('searchPlaceholder')}
                        className="w-full sm:w-64"
                    />
                </div>
            )}

            {selection && !awaitingPick && !libraries && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-64 w-full rounded-xl" />
                    ))}
                </div>
            )}

            {libraries?.length === 0 && (
                <Card className="flex flex-col items-center gap-2 p-10 text-center">
                    <Books className="size-7 text-neutral-300" />
                    <p className="text-body text-neutral-600">
                        {debouncedSearch
                            ? t('empty.noneMatch')
                            : t('empty.notLoaded', { selection: selectionLabel })}
                    </p>
                    <p className="max-w-md text-caption text-neutral-400">
                        {debouncedSearch ? t('empty.widenSearch') : t('empty.onItsWay')}
                    </p>
                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                        {debouncedSearch ? (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setSearch('')}
                            >
                                {t('clearFilters')}
                            </MyButton>
                        ) : (
                            onAddOwn && (
                                <MyButton buttonType="secondary" scale="small" onClick={onAddOwn}>
                                    <Plus className="mr-1 size-4" />
                                    {t('empty.addOwn')}
                                </MyButton>
                            )
                        )}
                    </div>
                </Card>
            )}

            {libraries && libraries.length > 0 && (
                <div
                    className={cn(
                        'flex flex-col gap-6 transition-opacity',
                        isPlaceholderData && 'opacity-60'
                    )}
                >
                    {groups.map(([cls, items]) => (
                        <section key={cls ?? 'other'} className="flex flex-col gap-3">
                            {groups.length > 1 && (
                                <h3 className="text-body font-semibold text-neutral-600">
                                    {cls
                                        ? t('classLabel', { number: cls })
                                        : t('otherLibrariesHeading')}
                                </h3>
                            )}
                            <CardGrid libraries={items} taxonomy={taxonomy} onOpen={open} />
                        </section>
                    ))}
                </div>
            )}

            {otherLibraries.length > 0 && !debouncedSearch && (
                <section className="flex flex-col gap-3 border-t border-neutral-100 pt-5">
                    <h3 className="text-body font-semibold text-neutral-600">
                        {t('otherLibrariesHeading')}
                    </h3>
                    <CardGrid libraries={otherLibraries} taxonomy={taxonomy} onOpen={open} />
                </section>
            )}

            {libraries && libraries.length > 0 && (
                <p className="flex items-center gap-1.5 text-caption text-neutral-400">
                    <BookOpenText size={14} />
                    {t('footerNote')}
                </p>
            )}
        </div>
    );
};
