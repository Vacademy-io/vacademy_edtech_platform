/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import { ColumnDef, Row } from '@tanstack/react-table';
import { CaretUp, CaretDown, WarningCircle } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { MyDropdown } from '@/components/design-system/dropdown';
import { StudentTable } from '@/types/student-table-types';
import { AssessmentStatusOptions } from '../-components/AssessmentStatusOptions';
import { SubmissionFileCell } from '../-components/SubmissionFileCell';
import { EvaluationStatusCell } from '../-components/EvaluationStatusCell';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { StatusChips } from '@/components/design-system/chips';
import { useSidebar } from '@/components/ui/sidebar';
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

const useClickHandlers = () => {
    const { setSelectedStudent, selectedStudent } = useStudentSidebar();
    const { setOpen, open } = useSidebar();

    // Opens the detail sidebar on the click itself. This used to sit behind a 250ms
    // setTimeout so that a double-click could cancel it, which made every row in the
    // table feel unresponsive. `event.detail > 1` is the second click of a double-click
    // — ignoring it stops a fast double-click from opening the panel and then
    // immediately toggling it shut again.
    const handleClick = (event: React.MouseEvent, row: Row<StudentTable>) => {
        if (event.detail > 1) return;
        if (selectedStudent?.id != row.original.id) {
            setSelectedStudent(row.original);
            setOpen(true);
        } else {
            setOpen(!open);
        }
    };

    return { handleClick };
};

const CreateClickableCell = ({ row, columnId }: { row: Row<StudentTable>; columnId: string }) => {
    const { handleClick } = useClickHandlers();

    return (
        <div onClick={(event) => handleClick(event, row)} className="cursor-pointer">
            {row.getValue(columnId)}
        </div>
    );
};

// Duration cell that flags a near-zero attempt time. A "0.00 min" duration means
// the learner submitted almost instantly — usually a non-attempt or auto-submit,
// which a teacher scanning submissions should be able to spot at a glance.
const DurationCell = ({ row }: { row: Row<StudentTable> }) => {
    const { t } = useTranslation('assessmentStudentColumns');
    const { handleClick } = useClickHandlers();
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

// Score arrives pre-formatted as "18.00 / 20". Splitting it lets the mark carry the weight
// and the denominator recede, so a column of scores can be compared at a glance.
const ScoreCell = ({ row }: { row: Row<StudentTable> }) => {
    const { handleClick } = useClickHandlers();
    const raw = String(row.getValue('score') ?? '');
    const separator = raw.indexOf(' / ');

    return (
        <div
            onClick={(event) => handleClick(event, row)}
            className="cursor-pointer whitespace-nowrap"
        >
            {separator === -1 ? (
                raw
            ) : (
                <>
                    {/* The achieved mark carries the accent, the denominator recedes — but
                        only once something has actually been awarded. Painting a zero green
                        reads as "good" on an ungraded or blank attempt. */}
                    <span
                        className={
                            parseFloat(raw) > 0
                                ? 'font-semibold text-primary-500'
                                : 'font-semibold text-neutral-700'
                        }
                    >
                        {raw.slice(0, separator)}
                    </span>
                    <span className="text-neutral-400">{raw.slice(separator)}</span>
                </>
            )}
        </div>
    );
};

// Result Status chip.
//
// This used to call <StatusChips status="released" />, but `released` is not one of
// ActivityStatusData's keys, so StatusChips bailed out on its `if (!statusData) return
// null` guard and the column rendered *empty* for every released submission. This file
// is @ts-nocheck'd, so the invalid status string was never typechecked. Map onto
// statuses that actually exist and pass the label explicitly.
//
// Also replaces a second, hand-rolled copy on the external column set that used raw
// bg-green-100 / bg-gray-100 palette colours instead of the design system.
const ResultStatusCell = ({ row }: { row: Row<StudentTable> }) => {
    const { t } = useTranslation('assessmentStudentColumns');
    const status = row.original.result_status;
    if (status !== 'RELEASED' && status !== 'PENDING') {
        return <span className="text-body text-neutral-400">{t('status.notAvailable')}</span>;
    }
    const isReleased = status === 'RELEASED';
    return (
        <StatusChips status={isReleased ? 'success' : 'inactive'} className="whitespace-nowrap">
            {isReleased ? t('status.released') : t('status.notReleased')}
        </StatusChips>
    );
};

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

const EvaluationStatusHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.evaluationStatus')}</>;
};

const ResultStatusHeaderCell = () => {
    const { t } = useTranslation('assessmentStudentColumns');
    return <>{t('columns.resultStatus')}</>;
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
        cell: ({ row }) => <CreateClickableCell row={row} columnId="package_session_id" />,
    },
    {
        accessorKey: 'attempt_date',
        header: AttemptDateHeaderCell,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="attempt_date" />,
    },
    {
        accessorKey: 'start_time',
        header: StartTimeHeaderCell,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="start_time" />,
    },
    {
        accessorKey: 'end_time',
        header: EndTimeHeaderCell,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="end_time" />,
    },
    {
        accessorKey: 'duration',
        header: DurationHeaderCell,
        cell: ({ row }) => <DurationCell row={row} />,
    },
    {
        accessorKey: 'evaluation_status',
        header: EvaluationStatusHeaderCell,
        // Chip + (manual evaluation only) an eye button to open the evaluated copy.
        cell: ({ row }) => <EvaluationStatusCell row={row} />,
    },
    {
        accessorKey: 'score',
        header: ScoreHeaderCell,
        cell: ({ row }) => <ScoreCell row={row} />,
    },
    {
        accessorKey: 'result_status',
        header: ResultStatusHeaderCell,
        cell: ({ row }) => <ResultStatusCell row={row} />,
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
        cell: ({ row }) => (
            <AssessmentStatusOptions student={row.original} studentType="Attempted" />
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
        cell: ({ row }) => <CreateClickableCell row={row} columnId="attempt_date" />,
    },
    {
        accessorKey: 'start_time',
        header: StartTimeHeaderCell,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="start_time" />,
    },
    {
        accessorKey: 'end_time',
        header: EndTimeHeaderCell,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="end_time" />,
    },
    {
        accessorKey: 'duration',
        header: DurationHeaderCell,
        cell: ({ row }) => <DurationCell row={row} />,
    },
    {
        accessorKey: 'score',
        header: ScoreHeaderCell,
        cell: ({ row }) => <ScoreCell row={row} />,
    },
    {
        accessorKey: 'result_status',
        header: ResultStatusHeaderCell,
        cell: ({ row }) => <ResultStatusCell row={row} />,
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
        cell: ({ row }) => (
            <AssessmentStatusOptions student={row.original} studentType="Attempted" />
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
