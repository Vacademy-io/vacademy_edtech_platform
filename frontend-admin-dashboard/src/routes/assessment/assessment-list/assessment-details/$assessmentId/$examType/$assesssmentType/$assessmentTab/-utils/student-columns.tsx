/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import { ColumnDef, Row } from '@tanstack/react-table';
import { CaretUp, CaretDown, WarningCircle } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { MyDropdown } from '@/components/design-system/dropdown';
import { StudentTable } from '@/types/student-table-types';
import { AssessmentStatusOptions } from '../-components/AssessmentStatusOptions';
import { SubmissionFileCell } from '../-components/SubmissionFileCell';
import { MarkingCell } from '../-components/submission-review/MarkingCell';
import { ResultCell } from '../-components/submission-review/ResultCell';
import { OpenCell, OpenScoreCell, pageAttemptIds } from '../-components/submission-review/OpenCell';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { useSidebar } from '@/components/ui/sidebar';
import { useSubmissionsSidePanel, type SubmissionsSidePanel } from '../-components/submission-review/side-view-store';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useTranslation } from 'react-i18next';

// NOTE: this module exports plain, module-scope-evaluated `ColumnDef[]` arrays
// (not functions), and their `header`/`cell` slots are always invoked by
// TanStack Table's `flexRender`, which renders them as real React components
// (`<Comp {...props} />`). That gives every header/cell definition below a
// valid hook context, so translated strings are pulled via small named
// components using `useTranslation('assessmentStudentColumns')` rather than
// the i18next singleton — this keeps the labels reactive to language
// switches and keeps every call site of the exported arrays unchanged.

interface CustomTableMeta {
    onSort?: (columnId: string, direction: string) => void;
    /** Rows already listed on previous pages, so row 1 of page 2 reads 11, not 1. */
    pageOffset?: number;
}

// Row number that counts across pages rather than restarting at 1 on each one — which is
// what makes it readable as a position, the way the printed result sheet's "#" column is.
const SerialCell = ({
    row,
    table,
}: {
    row: Row<StudentTable>;
    table: { options: { meta?: CustomTableMeta } };
}) => {
    const offset = (table.options.meta as CustomTableMeta)?.pageOffset ?? 0;
    return <span className="text-body text-neutral-500">{offset + row.index + 1}</span>;
};

/**
 * Which side view a click opens. The Name cell opens the learner ("student"); any other
 * cell of an Attempted row opens that attempt's submission ("submission"), which links on
 * to the learner. Rows with no attempt (Pending, Ongoing) only have the learner.
 */
const useClickHandlers = (opens: SubmissionsSidePanel = 'student') => {
    const { setSelectedStudent, selectedStudent } = useStudentSidebar();
    const { setOpen, open } = useSidebar();
    const { panel, setPanel } = useSubmissionsSidePanel();

    // Opens the detail sidebar on the click itself. This used to sit behind a 250ms
    // setTimeout so that a double-click could cancel it, which made every row in the
    // table feel unresponsive. `event.detail > 1` is the second click of a double-click
    // — ignoring it stops a fast double-click from opening the panel and then
    // immediately toggling it shut again.
    const handleClick = (event: React.MouseEvent, row: Row<StudentTable>) => {
        if (event.detail > 1) return;
        const target: SubmissionsSidePanel =
            opens === 'submission' && (row.original as StudentTable & { attempt_id?: string }).attempt_id
                ? 'submission'
                : 'student';
        if (selectedStudent?.id != row.original.id || panel !== target) {
            setSelectedStudent(row.original);
            setPanel(target);
            setOpen(true);
        } else {
            setOpen(!open);
        }
    };

    return { handleClick };
};

const CreateClickableCell = ({
    row,
    columnId,
    opens,
}: {
    row: Row<StudentTable>;
    columnId: string;
    opens?: SubmissionsSidePanel;
}) => {
    const { handleClick } = useClickHandlers(opens);

    return (
        <div onClick={(event) => handleClick(event, row)} className="cursor-pointer">
            {row.getValue(columnId)}
        </div>
    );
};

// Duration cell that flags a near-zero attempt time. A "0.00 min" duration means
// the learner submitted almost instantly — usually a non-attempt or auto-submit,
// which a teacher scanning submissions should be able to spot at a glance.
const DurationCell = ({ row, opens }: { row: Row<StudentTable>; opens?: SubmissionsSidePanel }) => {
    const { t } = useTranslation('assessmentStudentColumns');
    const { handleClick } = useClickHandlers(opens);
    const value = String(row.getValue('duration') ?? '');
    const minutes = parseFloat(value);
    const isInstant = !Number.isNaN(minutes) && minutes <= 0;

    return (
        <div
            onClick={(event) => handleClick(event, row)}
            className="flex cursor-pointer items-center gap-1"
        >
            <span>{value}</span>
            {isInstant && (
                <span
                    title={t('tooltip.instantSubmit')}
                    className="inline-flex items-center text-warning-600"
                >
                    <WarningCircle size={16} weight="fill" />
                </span>
            )}
        </div>
    );
};

// Avatar tints. Picked from the learner's own name so the same person keeps the same
// colour on every page — a random or index-based tint would reshuffle on each fetch and
// destroy the recognisability the avatar exists for in the first place.
const AVATAR_TINTS = [
    'bg-primary-100 text-primary-600',
    'bg-info-100 text-info-600',
    'bg-warning-100 text-warning-700',
    'bg-success-100 text-success-700',
    'bg-danger-100 text-danger-600',
];

const initialsOf = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase() || '?';

// Name cell: initials avatar over name + username. The submissions API carries no avatar
// URL, so the initials chip is the identity anchor — it makes a row scannable as a person
// rather than as one more string in a wall of text.
const StudentIdentityCell = ({ row }: { row: Row<StudentTable> }) => {
    const { handleClick } = useClickHandlers();
    const name = String(row.getValue('full_name') ?? '');
    const username = String(row.original.username ?? '');
    const tint =
        AVATAR_TINTS[
            [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_TINTS.length
        ];

    return (
        <div
            onClick={(event) => handleClick(event, row)}
            className="flex cursor-pointer items-center gap-2.5"
        >
            <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-caption font-semibold ${tint}`}
            >
                {initialsOf(name)}
            </span>
            {/* Capped, not just min-w-0: on institutes where the username IS an email
                address, an uncapped cell stretches the column to fit the longest address
                on the page and shoves everything else off-screen. */}
            <span className="flex min-w-0 max-w-[220px] flex-col leading-tight">{/* design-lint-ignore: pixel cap so email-style usernames truncate */}
                <span className="truncate font-medium text-neutral-700">{name}</span>
                {username && (
                    <span className="truncate text-caption text-neutral-400">{username}</span>
                )}
            </span>
        </div>
    );
};

// Score and Result cells for the Attempted tables live in ../-components/submission-review
// (OpenScoreCell opens the Submission page; ResultCell knows "Released, changed").

// Reusable ASC/DESC sortable column header. `sortKey` is the frontend column id
// the parent's `meta.onSort` maps to a backend sort key (studentName, score,
// duration, attemptDate). Keeps the caret UI consistent across columns.
const SortableHeader = ({
    props,
    label,
    sortKey,
}: {
    props: { table: { options: { meta?: CustomTableMeta } } };
    label: string;
    sortKey: string;
}) => {
    const meta = props.table.options.meta as CustomTableMeta;
    return (
        <div className="relative">
            <MyDropdown
                dropdownList={['ASC', 'DESC']}
                onSelect={(value) => meta.onSort?.(sortKey, value)}
            >
                <button className="flex w-full cursor-pointer items-center justify-between">
                    <div>{label}</div>
                    <div>
                        <CaretUp />
                        <CaretDown />
                    </div>
                </button>
            </MyDropdown>
        </div>
    );
};

// Translated sortable "Name" header — replaces the near-identical inline
// header render function that used to be duplicated across every column
// array below (all of them sort the same `full_name` field with the same
// dropdown UI, so they now share this one wrapper for the translated label).
const NameHeaderCell = (props: { table: { options: { meta?: CustomTableMeta } } }) => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <SortableHeader props={props} label={t('columns.name')} sortKey="full_name" />;
};

const AttemptDateHeaderCell = (props: { table: { options: { meta?: CustomTableMeta } } }) => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <SortableHeader props={props} label={t('columns.attemptDate')} sortKey="attempt_date" />;
};

const DurationHeaderCell = (props: { table: { options: { meta?: CustomTableMeta } } }) => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <SortableHeader props={props} label={t('columns.duration')} sortKey="duration" />;
};

const ScoreHeaderCell = (props: { table: { options: { meta?: CustomTableMeta } } }) => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <SortableHeader props={props} label={t('columns.score')} sortKey="score" />;
};

const StartTimeHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.startTime')}</>;
};

const EndTimeHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.endTime')}</>;
};

// W1 (submission review): "Marking" and "Result" replace the three-state chip, and an
// "Open" column (plus the Score cell) opens the Submission page. The Name cell opens the
// student side view; the row's other cells open the submission side view.
const MarkingHeaderCell = () => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    return <>{t('columns.marking')}</>;
};

const ResultHeaderCell = () => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    return <>{t('columns.result')}</>;
};

const OpenHeaderCell = () => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    return <span className="sr-only">{t('columns.open')}</span>;
};

const markingColumn: ColumnDef<StudentTable> = {
    accessorKey: 'evaluation_status',
    header: MarkingHeaderCell,
    cell: ({ row }) => <MarkingCell row={row} />,
};

const attemptedScoreColumn: ColumnDef<StudentTable> = {
    accessorKey: 'score',
    header: ScoreHeaderCell,
    cell: ({ row, table }) => <OpenScoreCell row={row} table={table} />,
};

const attemptedResultColumn: ColumnDef<StudentTable> = {
    accessorKey: 'result_status',
    header: ResultHeaderCell,
    cell: ({ row }) => <ResultCell row={row} />,
};

const openColumn: ColumnDef<StudentTable> = {
    id: 'open',
    header: OpenHeaderCell,
    cell: ({ row, table }) => <OpenCell row={row} table={table} />,
};

const EnrollmentNumberHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.enrollmentNumber')}</>;
};

const GenderHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.gender')}</>;
};

const ResponseTimeHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.responseTime')}</>;
};

const PhoneNumberHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.phoneNumber')}</>;
};

const EmailIdHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.emailId')}</>;
};

const CityHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.city')}</>;
};

const StateHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.state')}</>;
};

const SubmissionHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.submission')}</>;
};

// Only shown for MANUAL evaluation assessments (spliced in by
// getAllColumnsForTable): whether the attempt has a submitted answer-sheet
// file, with an on-behalf upload when it doesn't.
export const assessmentSubmissionFileColumn: ColumnDef<StudentTable> = {
    id: 'submission_file',
    header: SubmissionHeaderCell,
    cell: ({ row }) => (
        <SubmissionFileCell
            attemptId={row.original.attempt_id}
            studentName={row.original.full_name}
        />
    ),
};

export const assessmentStatusStudentAttemptedColumnsInternal: ColumnDef<StudentTable>[] = [
    {
        id: 'checkbox',
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllRowsSelected()}
                onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                className="border-neutral-400 bg-white text-neutral-600"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none"
            />
        ),
    },
    {
        id: 'serial',
        header: '#',
        cell: ({ row, table }) => <SerialCell row={row} table={table} />,
    },
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
        cell: ({ row }) => <StudentIdentityCell row={row} />,
    },
    {
        accessorKey: 'package_session_id',
        header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="package_session_id" />,
    },
    {
        accessorKey: 'attempt_date',
        header: AttemptDateHeaderCell,
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="attempt_date" />,
    },
    {
        accessorKey: 'start_time',
        header: StartTimeHeaderCell,
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="start_time" />,
    },
    {
        accessorKey: 'end_time',
        header: EndTimeHeaderCell,
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="end_time" />,
    },
    {
        accessorKey: 'duration',
        header: DurationHeaderCell,
        cell: ({ row }) => <DurationCell row={row} opens="submission" />,
    },
    // Marking replaces the evaluation chip (it keeps the evaluated-copy eye button).
    markingColumn,
    attemptedScoreColumn,
    attemptedResultColumn,
    openColumn,

    // Contact columns, mirroring what this tab's own CSV export already carries. Appended
    // rather than placed next to the name so Score and the status chips stay where people
    // are used to scanning for them.
    {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="email" />,
    },
    {
        accessorKey: 'mobile_number',
        header: 'Phone Number',
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="mobile_number" />,
    },
    {
        accessorKey: 'username',
        header: 'Username',
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="username" />,
    },
    {
        id: 'options',
        header: 'Actions',
        cell: ({ row, table }) => (
            <AssessmentStatusOptions
                student={row.original}
                studentType="Attempted"
                getPageAttemptIds={() => pageAttemptIds(table)}
            />
        ),
    },
];

export const assessmentStatusStudentOngoingColumnsInternal: ColumnDef<StudentTable>[] = [
    {
        id: 'checkbox',
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllRowsSelected()}
                onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                className="border-neutral-400 bg-white text-neutral-600"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none"
            />
        ),
    },
    {
        id: 'serial',
        header: '#',
        cell: ({ row, table }) => <SerialCell row={row} table={table} />,
    },
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
        cell: ({ row }) => <StudentIdentityCell row={row} />,
    },
    {
        accessorKey: 'start_time',
        header: StartTimeHeaderCell,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="start_time" />,
    },
    // Contact columns, mirroring what this tab's own CSV export already carries. Appended
    // rather than placed next to the name so Score and the status chips stay where people
    // are used to scanning for them.
    {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="email" />,
    },
    {
        accessorKey: 'mobile_number',
        header: 'Phone Number',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="mobile_number" />,
    },
    {
        accessorKey: 'username',
        header: 'Username',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="username" />,
    },
    {
        id: 'options',
        header: 'Actions',
        cell: ({ row }) => <AssessmentStatusOptions student={row.original} studentType="Ongoing" />,
    },
];

export const assessmentStatusStudentPendingColumnsInternal: ColumnDef<StudentTable>[] = [
    {
        id: 'checkbox',
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllRowsSelected()}
                onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                className="border-neutral-400 bg-white text-neutral-600"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none"
            />
        ),
    },
    {
        id: 'serial',
        header: '#',
        cell: ({ row, table }) => <SerialCell row={row} table={table} />,
    },
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
        cell: ({ row }) => <StudentIdentityCell row={row} />,
    },
    // Contact columns, mirroring what this tab's own CSV export already carries. Appended
    // rather than placed next to the name so Score and the status chips stay where people
    // are used to scanning for them.
    {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="email" />,
    },
    {
        accessorKey: 'mobile_number',
        header: 'Phone Number',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="mobile_number" />,
    },
    {
        accessorKey: 'username',
        header: 'Username',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="username" />,
    },
    {
        id: 'options',
        header: 'Actions',
        cell: ({ row }) => <AssessmentStatusOptions student={row.original} studentType="Pending" />,
    },
];

/**
 * Pending for BATCH selection — the learners enrolled in an assigned batch who never
 * attempted. Unlike the other Pending lists (Individual Selection, External), these rows
 * come from their batch enrollment rather than an assessment registration, so they carry
 * batch and contact details. Those are the whole point of the list: it exists to chase
 * people who have not sat the test, and a bare column of names cannot do that.
 *
 * Deliberately NOT merged into the two sets above — their rows have no contact details to
 * show, and empty columns read as missing data rather than as "not applicable here".
 */
export const assessmentStatusStudentNotAttemptedColumns: ColumnDef<StudentTable>[] = [
    {
        id: 'checkbox',
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllRowsSelected()}
                onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                className="border-neutral-400 bg-white text-neutral-600"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none"
            />
        ),
    },
    {
        id: 'serial',
        header: '#',
        cell: ({ row, table }) => <SerialCell row={row} table={table} />,
    },
    {
        accessorKey: 'full_name',
        header: (props) => {
            const meta = props.table.options.meta as CustomTableMeta;
            return (
                <div className="relative">
                    <MyDropdown
                        dropdownList={['ASC', 'DESC']}
                        onSelect={(value) => {
                            meta.onSort?.('full_name', value);
                        }}
                    >
                        <button className="flex w-full cursor-pointer items-center justify-between">
                            <div>Name</div>
                            <div>
                                <CaretUp />
                                <CaretDown />
                            </div>
                        </button>
                    </MyDropdown>
                </div>
            );
        },
        cell: ({ row }) => <StudentIdentityCell row={row} />,
    },
    // Same columns, in the same order, as the "not attempted" CSV export — the tab and
    // its export answer one question and must not look like they disagree.
    {
        accessorKey: 'package_session_id',
        header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
        cell: ({ row }) => <CreateClickableCell row={row} columnId="package_session_id" />,
    },
    {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="email" />,
    },
    {
        accessorKey: 'mobile_number',
        header: 'Phone Number',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="mobile_number" />,
    },
    {
        accessorKey: 'username',
        header: 'Username',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="username" />,
    },
    {
        id: 'options',
        header: 'Actions',
        cell: ({ row }) => <AssessmentStatusOptions student={row.original} studentType="Pending" />,
    },
];

export const assessmentStatusStudentAttemptedColumnsExternal: ColumnDef<StudentTable>[] = [
    {
        id: 'checkbox',
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllRowsSelected()}
                onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                className="border-neutral-400 bg-white text-neutral-600"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none"
            />
        ),
    },
    {
        id: 'serial',
        header: '#',
        cell: ({ row, table }) => <SerialCell row={row} table={table} />,
    },
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
        cell: ({ row }) => <StudentIdentityCell row={row} />,
    },
    {
        accessorKey: 'attempt_date',
        header: AttemptDateHeaderCell,
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="attempt_date" />,
    },
    {
        accessorKey: 'start_time',
        header: StartTimeHeaderCell,
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="start_time" />,
    },
    {
        accessorKey: 'end_time',
        header: EndTimeHeaderCell,
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="end_time" />,
    },
    {
        accessorKey: 'duration',
        header: DurationHeaderCell,
        cell: ({ row }) => <DurationCell row={row} opens="submission" />,
    },
    markingColumn,
    attemptedScoreColumn,
    attemptedResultColumn,
    openColumn,

    // Contact columns, mirroring what this tab's own CSV export already carries. Appended
    // rather than placed next to the name so Score and the status chips stay where people
    // are used to scanning for them.
    {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="email" />,
    },
    {
        accessorKey: 'mobile_number',
        header: 'Phone Number',
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="mobile_number" />,
    },
    {
        accessorKey: 'username',
        header: 'Username',
        cell: ({ row }) => <CreateClickableCell opens="submission" row={row} columnId="username" />,
    },
    {
        id: 'options',
        header: 'Actions',
        cell: ({ row, table }) => (
            <AssessmentStatusOptions
                student={row.original}
                studentType="Attempted"
                getPageAttemptIds={() => pageAttemptIds(table)}
            />
        ),
    },
];

export const assessmentStatusStudentOngoingColumnsExternal: ColumnDef<StudentTable>[] = [
    {
        id: 'checkbox',
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllRowsSelected()}
                onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                className="border-neutral-400 bg-white text-neutral-600"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none"
            />
        ),
    },
    {
        id: 'serial',
        header: '#',
        cell: ({ row, table }) => <SerialCell row={row} table={table} />,
    },
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
        cell: ({ row }) => <StudentIdentityCell row={row} />,
    },
    {
        accessorKey: 'start_time',
        header: StartTimeHeaderCell,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="start_time" />,
    },
    // Contact columns, mirroring what this tab's own CSV export already carries. Appended
    // rather than placed next to the name so Score and the status chips stay where people
    // are used to scanning for them.
    {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="email" />,
    },
    {
        accessorKey: 'mobile_number',
        header: 'Phone Number',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="mobile_number" />,
    },
    {
        accessorKey: 'username',
        header: 'Username',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="username" />,
    },
    {
        id: 'options',
        header: 'Actions',
        cell: ({ row }) => <AssessmentStatusOptions student={row.original} studentType="Ongoing" />,
    },
];

export const assessmentStatusStudentPendingColumnsExternal: ColumnDef<StudentTable>[] = [
    {
        id: 'checkbox',
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllRowsSelected()}
                onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                className="border-neutral-400 bg-white text-neutral-600"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none"
            />
        ),
    },
    {
        id: 'serial',
        header: '#',
        cell: ({ row, table }) => <SerialCell row={row} table={table} />,
    },
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
        cell: ({ row }) => <StudentIdentityCell row={row} />,
    },
    // Contact columns, mirroring what this tab's own CSV export already carries. Appended
    // rather than placed next to the name so Score and the status chips stay where people
    // are used to scanning for them.
    {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="email" />,
    },
    {
        accessorKey: 'mobile_number',
        header: 'Phone Number',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="mobile_number" />,
    },
    {
        accessorKey: 'username',
        header: 'Username',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="username" />,
    },
    {
        id: 'options',
        header: 'Actions',
        cell: ({ row }) => <AssessmentStatusOptions student={row.original} studentType="Pending" />,
    },
];

export const assessmentStatusStudentQuestionResponseInternal: ColumnDef<StudentTable>[] = [
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
    },
    {
        accessorKey: 'package_session_id',
        header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
    },
    {
        accessorKey: 'institute_enrollment_id',
        header: EnrollmentNumberHeaderCell,
    },
    {
        accessorKey: 'gender',
        header: GenderHeaderCell,
    },
    {
        accessorKey: 'responseTime',
        header: ResponseTimeHeaderCell,
    },
];

export const assessmentStatusStudentQuestionResponseExternal: ColumnDef<StudentTable>[] = [
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
    },
    {
        accessorKey: 'gender',
        header: GenderHeaderCell,
    },
    {
        accessorKey: 'responseTime',
        header: ResponseTimeHeaderCell,
    },
];

export const studentInternalOrCloseQuestionWise: ColumnDef<StudentTable>[] = [
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
    },
    {
        accessorKey: 'package_session_id',
        header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
    },
    {
        accessorKey: 'registration_id',
        header: EnrollmentNumberHeaderCell,
    },
    {
        accessorKey: 'response_time_in_seconds',
        header: ResponseTimeHeaderCell,
    },
];

export const studentExternalQuestionWise: ColumnDef<StudentTable>[] = [
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
    },
    {
        accessorKey: 'response_time_in_seconds',
        header: ResponseTimeHeaderCell,
    },
];

export const step3ParticipantsListColumn: ColumnDef<StudentTable>[] = [
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
    },
    {
        accessorKey: 'package_session_id',
        header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
    },
    {
        accessorKey: 'institute_enrollment_id',
        header: EnrollmentNumberHeaderCell,
    },
    {
        accessorKey: 'gender',
        header: GenderHeaderCell,
    },
    {
        accessorKey: 'mobile_number',
        header: PhoneNumberHeaderCell,
    },
    {
        accessorKey: 'email',
        header: EmailIdHeaderCell,
    },
    {
        accessorKey: 'city',
        header: CityHeaderCell,
    },
    {
        accessorKey: 'region',
        header: StateHeaderCell,
    },
];

export const step3ParticipantsListIndividualStudentColumn: ColumnDef<StudentTable>[] = [
    {
        accessorKey: 'full_name',
        header: NameHeaderCell,
    },
    {
        accessorKey: 'mobile_number',
        header: PhoneNumberHeaderCell,
    },
    {
        accessorKey: 'email',
        header: EmailIdHeaderCell,
    },
];
