import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpenText } from '@phosphor-icons/react';
import { MyDropdown } from '@/components/design-system/dropdown';
import type { DropdownItem } from '@/components/design-system/utils/types/dropdown-types';
import { cn } from '@/lib/utils';
import { useLibraryCatalogue, useLibraryTaxonomy } from '../../-hooks';
import type { KnowledgeBase } from '../../-types';
import type { CatalogueFilters, LibraryTaxonomy } from '../../-types/library';
import { classLabel } from './curriculum';

interface CurriculumPickerProps {
    /** Curriculum knowledge bases only (see curriculumOnly). */
    knowledgeBases: KnowledgeBase[];
    onPick: (kb: KnowledgeBase) => void;
    className?: string;
}

// Dropdown values: a board or an exam, never both.
const BOARD = 'board:';
const EXAM = 'exam:';

/**
 * Board → Class → Subject, or Exam → Subject, then the book if more than one.
 *
 * Deliberately dropdowns and nothing else: a teacher building a Class 11
 * Chemistry test should not have to know what a "knowledge base" is. The
 * choices come from the library taxonomy, filtered to what has books behind
 * it, so "CBSE" and "UP Board" are offered and answered with the NCERT
 * textbooks they prescribe; the server resolves that (see
 * ai_service/app/services/kb/taxonomy.py). When the choice is unambiguous
 * (one book for that subject) it is picked immediately.
 */
export const CurriculumPicker = ({ knowledgeBases, onPick, className }: CurriculumPickerProps) => {
    const { t } = useTranslation('knowledgeBaseCurriculum');
    const { data: taxonomy } = useLibraryTaxonomy();

    const [track, setTrack] = useState<string>(''); // "board:CBSE" | "exam:JEE_MAIN"
    const [cls, setCls] = useState<string>('');
    const [subject, setSubject] = useState<string>('');

    const boardKey = track.startsWith(BOARD) ? track.slice(BOARD.length) : '';
    const examKey = track.startsWith(EXAM) ? track.slice(EXAM.length) : '';
    const board = taxonomy?.boards.find((b) => b.key === boardKey);
    const exam = taxonomy?.exams.find((e) => e.key === examKey);

    const trackOptions = useMemo(() => buildTrackOptions(taxonomy, t), [taxonomy, t]);

    // One board with books (NCERT for now) needs no choosing.
    useEffect(() => {
        if (!track && trackOptions.length === 1 && !trackOptions[0]!.subItems) {
            setTrack(trackOptions[0]!.value);
        }
    }, [track, trackOptions]);

    const classes = useMemo(
        () => (board ? board.classes.filter((c) => c.libraries > 0) : []),
        [board]
    );
    const subjects = useMemo(() => {
        if (exam) return exam.subjects.filter((s) => s.libraries > 0);
        const node = board?.classes.find((c) => c.class === cls);
        return node ? node.subjects.filter((s) => s.libraries > 0) : [];
    }, [board, exam, cls]);

    // The server resolves the selection (aliases, exam class ranges) to
    // listings; the picker only maps those back to the bases it was handed.
    const filters: CatalogueFilters | null = useMemo(() => {
        if (exam) return { exam: exam.key, subject: subject || undefined, limit: 500 };
        if (board && cls)
            return { board: board.key, level: cls, subject: subject || undefined, limit: 500 };
        return null;
    }, [board, exam, cls, subject]);
    const { data: catalogue } = useLibraryCatalogue(filters ?? {}, {
        enabled: Boolean(filters && subject),
    });

    const books = useMemo(() => {
        if (!catalogue || !subject) return [];
        const byId = new Map(knowledgeBases.map((kb) => [kb.id, kb]));
        return catalogue.libraries
            .map((l) => byId.get(l.knowledge_base_id))
            .filter((kb): kb is KnowledgeBase => Boolean(kb));
    }, [catalogue, knowledgeBases, subject]);

    // Exactly one book for the subject: that is the answer, hand it over —
    // once per selection, so a parent re-render (the bases list polling)
    // cannot open the wizard a second time.
    const autoPicked = useRef<string>('');
    useEffect(() => {
        const key = JSON.stringify(filters);
        if (!subject || !catalogue || books.length !== 1 || autoPicked.current === key) return;
        autoPicked.current = key;
        onPick(books[0]!);
        // onPick is a fresh closure each render in the callers; keying on it
        // would re-run this on every parent render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subject, catalogue, books, filters]);

    const trackLabel = board?.name ?? exam?.name ?? '';

    return (
        <div className={cn('flex flex-col gap-3', className)}>
            <div className={cn('grid gap-3', exam ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
                <div className="flex flex-col gap-1">
                    <span className="text-caption text-neutral-600">{t('boardOrExam')}</span>
                    <MyDropdown
                        currentValue={trackLabel}
                        dropdownList={trackOptions}
                        placeholder={taxonomy ? t('choose') : t('loading')}
                        handleChange={(v) => {
                            setTrack(v);
                            setCls('');
                            setSubject('');
                        }}
                        disable={!taxonomy || trackOptions.length <= 1}
                        contentClassName="max-h-72 overflow-y-auto"
                    />
                </div>
                {!exam && (
                    <div className="flex flex-col gap-1">
                        <span className="text-caption text-neutral-600">{t('class')}</span>
                        <MyDropdown
                            // MyDropdown prints currentValue verbatim when closed,
                            // so hand it the label ("Class 11"), not the value ("11").
                            currentValue={cls ? classLabel(cls, t) : ''}
                            dropdownList={classes.map((c) => ({
                                label: classLabel(c.class, t),
                                value: c.class,
                            }))}
                            placeholder={t('choose')}
                            handleChange={(v) => {
                                setCls(v);
                                setSubject('');
                            }}
                            disable={!board}
                        />
                    </div>
                )}
                <div className="flex flex-col gap-1">
                    <span className="text-caption text-neutral-600">{t('subject')}</span>
                    <MyDropdown
                        currentValue={subject}
                        dropdownList={subjects.map((s) => ({ label: s.name, value: s.name }))}
                        placeholder={t('choose')}
                        handleChange={setSubject}
                        disable={exam ? false : !cls}
                    />
                </div>
            </div>

            {books.length > 1 && (
                <div className="flex flex-col gap-2">
                    <span className="text-caption text-neutral-600">{t('whichBook')}</span>
                    {books.map((kb) => (
                        <button
                            key={kb.id}
                            type="button"
                            onClick={() => onPick(kb)}
                            className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:border-primary-400 hover:bg-primary-50"
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <BookOpenText className="size-4 shrink-0 text-primary-500" />
                                <span className="truncate text-body font-medium text-neutral-700">
                                    {kb.curriculum?.book ?? kb.name}
                                </span>
                                {/* An exam spans classes, so say which one each book is. */}
                                {exam && kb.curriculum?.class && (
                                    <span className="shrink-0 text-caption text-neutral-500">
                                        · {classLabel(kb.curriculum.class, t)}
                                    </span>
                                )}
                            </span>
                            <span className="shrink-0 text-caption text-neutral-500">
                                {t('chapters', {
                                    count: kb.stats?.sources ?? kb.source_count ?? 0,
                                })}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * National boards flat, then state boards and exams as submenus — only
 * entries that have at least one book, because this picker exists to pick a
 * book, not to browse what is coming.
 */
const buildTrackOptions = (
    taxonomy: LibraryTaxonomy | undefined,
    t: (key: string) => string
): DropdownItem[] => {
    if (!taxonomy) return [];
    const withBooks = taxonomy.boards.filter((b) => b.libraries > 0);
    const national = withBooks.filter((b) => b.kind === 'NATIONAL');
    const state = withBooks.filter((b) => b.kind === 'STATE');
    const exams = taxonomy.exams.filter((e) => e.libraries > 0);

    const items: DropdownItem[] = national.map((b) => ({ label: b.name, value: BOARD + b.key }));
    if (state.length > 0) {
        items.push({
            label: t('stateBoards'),
            value: 'group:state',
            subItems: state.map((b) => ({ label: b.name, value: BOARD + b.key })),
        });
    }
    if (exams.length > 0) {
        items.push({
            label: t('competitiveExams'),
            value: 'group:exam',
            subItems: exams.map((e) => ({ label: e.name, value: EXAM + e.key })),
        });
    }
    return items;
};
