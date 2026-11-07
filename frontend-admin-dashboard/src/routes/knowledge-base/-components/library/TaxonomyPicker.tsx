import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Exam, GraduationCap } from '@phosphor-icons/react';
import { MyDropdown } from '@/components/design-system/dropdown';
import { cn } from '@/lib/utils';
import type {
    LibraryTaxonomy,
    TaxonomyBoard,
    TaxonomyClass,
    TaxonomyExam,
    TaxonomySubject,
} from '../../-types/library';

export type Track = 'board' | 'exam';

/** What the teacher has picked. Keys are taxonomy keys, not display names. */
export interface TaxonomySelection {
    track: Track;
    board?: string;
    exam?: string;
    cls?: string;
    subject?: string;
    medium?: string;
}

interface TaxonomyPickerProps {
    taxonomy: LibraryTaxonomy;
    value: TaxonomySelection;
    onChange: (next: TaxonomySelection) => void;
    className?: string;
}

export const findBoard = (taxonomy: LibraryTaxonomy, key?: string): TaxonomyBoard | undefined =>
    key ? taxonomy.boards.find((b) => b.key === key) : undefined;

export const findExam = (taxonomy: LibraryTaxonomy, key?: string): TaxonomyExam | undefined =>
    key ? taxonomy.exams.find((e) => e.key === key) : undefined;

export const findClass = (board?: TaxonomyBoard, cls?: string): TaxonomyClass | undefined =>
    board && cls ? board.classes.find((c) => c.class === cls) : undefined;

/**
 * One filter chip. A count of zero is still offered — the teacher should see
 * that ICSE Class 9 Physics is a real choice that has not been loaded yet,
 * rather than wonder whether the board exists at all — but it reads muted so
 * the loaded material stands out.
 */
const Chip = ({
    label,
    count,
    active,
    onClick,
    title,
}: {
    label: string;
    count?: number;
    active: boolean;
    onClick: () => void;
    title?: string;
}) => (
    <button
        type="button"
        onClick={onClick}
        title={title}
        aria-pressed={active}
        className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption transition-colors',
            active
                ? 'border-primary-500 bg-primary-50 font-medium text-primary-500'
                : count === 0
                  ? 'border-dashed border-neutral-200 text-neutral-400 hover:border-neutral-300'
                  : 'border-neutral-200 text-neutral-600 hover:border-primary-300'
        )}
    >
        {label}
        {count !== undefined && count > 0 && (
            <span
                className={cn(
                    'rounded-full px-1.5 text-caption leading-4',
                    active ? 'bg-primary-100 text-primary-600' : 'bg-neutral-100 text-neutral-500'
                )}
            >
                {count}
            </span>
        )}
    </button>
);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-caption text-neutral-400">{label}</span>
        {children}
    </div>
);

/**
 * Board → Class → Subject, or Exam → Subject.
 *
 * Every board, class and subject in the taxonomy is offered, whether loaded
 * or not, with a count where something is. National boards are chips; the
 * long tail of state boards sits in one dropdown so the row stays readable.
 */
export const TaxonomyPicker = ({ taxonomy, value, onChange, className }: TaxonomyPickerProps) => {
    const { t } = useTranslation('knowledgeBaseLibraryBrowser');

    const nationalBoards = useMemo(
        () => taxonomy.boards.filter((b) => b.kind === 'NATIONAL'),
        [taxonomy]
    );
    const stateBoards = useMemo(
        () => taxonomy.boards.filter((b) => b.kind === 'STATE'),
        [taxonomy]
    );

    const board = findBoard(taxonomy, value.board);
    const exam = findExam(taxonomy, value.exam);
    const cls = findClass(board, value.cls);
    const selectedState = stateBoards.find((b) => b.key === value.board);

    const setTrack = (track: Track) => {
        if (track === value.track) return;
        // Coming back to boards lands on a shelf with books on it; an exam is
        // always an explicit choice.
        const board =
            track === 'board'
                ? (taxonomy.boards.find((b) => b.libraries > 0) ?? taxonomy.boards[0])?.key
                : undefined;
        onChange({ track, board, medium: value.medium });
    };
    const setBoard = (key: string) =>
        onChange({ track: 'board', board: key, medium: value.medium });
    const setExam = (key: string) => onChange({ track: 'exam', exam: key, medium: value.medium });
    const setClass = (c?: string) => onChange({ ...value, cls: c, subject: undefined });
    const setSubject = (s?: string) => onChange({ ...value, subject: s });
    const setMedium = (m?: string) => onChange({ ...value, medium: m });

    const subjectRow = (
        subjects: TaxonomySubject[] | undefined,
        allCount: number | undefined,
        show: boolean
    ) =>
        show && subjects ? (
            <Row label={t('picker.subject')}>
                <Chip
                    label={t('picker.all')}
                    count={allCount}
                    active={!value.subject}
                    onClick={() => setSubject(undefined)}
                />
                {subjects.map((s) => (
                    <Chip
                        key={s.name}
                        label={s.name}
                        count={s.libraries}
                        active={value.subject === s.name}
                        onClick={() => setSubject(value.subject === s.name ? undefined : s.name)}
                        title={s.libraries === 0 ? t('picker.comingSoon') : undefined}
                    />
                ))}
            </Row>
        ) : null;

    return (
        <div
            className={cn(
                'flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4',
                className
            )}
        >
            {/* Track */}
            <div className="inline-flex w-fit rounded-lg bg-neutral-50 p-1" role="tablist">
                {(
                    [
                        { key: 'board', label: t('picker.trackBoard'), Icon: GraduationCap },
                        { key: 'exam', label: t('picker.trackExam'), Icon: Exam },
                    ] as const
                ).map(({ key, label, Icon }) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={value.track === key}
                        onClick={() => setTrack(key)}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium transition-colors',
                            value.track === key
                                ? 'bg-white text-primary-500 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                        )}
                    >
                        <Icon className="size-4" />
                        {label}
                    </button>
                ))}
            </div>

            {value.track === 'board' && (
                <>
                    <Row label={t('picker.board')}>
                        {nationalBoards.map((b) => (
                            <Chip
                                key={b.key}
                                label={b.name}
                                count={b.libraries}
                                active={value.board === b.key}
                                onClick={() => setBoard(b.key)}
                                title={b.full_name}
                            />
                        ))}
                        <MyDropdown
                            currentValue={
                                selectedState
                                    ? t('picker.stateBoardSelected', { name: selectedState.name })
                                    : ''
                            }
                            placeholder={t('picker.stateBoard')}
                            dropdownList={stateBoards.map((b) => ({
                                label:
                                    b.libraries > 0
                                        ? t('picker.optionWithCount', {
                                              name: b.name,
                                              count: b.libraries,
                                          })
                                        : b.name,
                                value: b.key,
                            }))}
                            handleChange={setBoard}
                            className={cn(
                                'h-auto min-w-0 rounded-full border px-3 py-1 text-caption',
                                selectedState
                                    ? 'border-primary-500 bg-primary-50 font-medium text-primary-500'
                                    : 'border-neutral-200 text-neutral-600 hover:border-primary-300'
                            )}
                            contentClassName="max-h-72 overflow-y-auto"
                        />
                    </Row>

                    {board && (
                        <Row label={t('picker.class')}>
                            <Chip
                                label={t('picker.all')}
                                count={board.libraries}
                                active={!value.cls}
                                onClick={() => setClass(undefined)}
                            />
                            {board.classes.map((c) => (
                                <Chip
                                    key={c.class}
                                    label={c.class}
                                    count={c.libraries}
                                    active={value.cls === c.class}
                                    onClick={() =>
                                        setClass(value.cls === c.class ? undefined : c.class)
                                    }
                                    title={
                                        c.libraries === 0
                                            ? t('picker.comingSoon')
                                            : t('classLabel', { number: c.class })
                                    }
                                />
                            ))}
                        </Row>
                    )}

                    {subjectRow(cls?.subjects, cls?.libraries, Boolean(board && cls))}
                </>
            )}

            {value.track === 'exam' && (
                <>
                    <Row label={t('picker.exam')}>
                        {taxonomy.exams.map((e) => (
                            <Chip
                                key={e.key}
                                label={e.name}
                                count={e.libraries}
                                active={value.exam === e.key}
                                onClick={() => setExam(e.key)}
                                title={e.full_name}
                            />
                        ))}
                    </Row>
                    {subjectRow(exam?.subjects, exam?.libraries, Boolean(exam))}
                </>
            )}

            <Row label={t('picker.medium')}>
                <Chip
                    label={t('picker.all')}
                    active={!value.medium}
                    onClick={() => setMedium(undefined)}
                />
                {taxonomy.mediums.map((m) => (
                    <Chip
                        key={m}
                        label={m}
                        active={value.medium === m}
                        onClick={() => setMedium(value.medium === m ? undefined : m)}
                    />
                ))}
            </Row>
        </div>
    );
};
