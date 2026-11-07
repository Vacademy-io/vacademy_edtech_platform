/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import type { TFunction } from 'i18next';
import { ColumnDef, Row } from '@tanstack/react-table';
import { CaretUp, CaretDown } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { MyDropdown } from '@/components/design-system/dropdown';
import { StudentTable } from '@/types/student-table-types';
import { AssessmentStatusOptions } from '../-components/AssessmentStatusOptions';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { StatusChips } from '@/components/design-system/chips';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// These column-definition arrays are built by factory functions that take a
// `t` (TFunction, from `useTranslation('homeworkCreationStudentColumns')`)
// rather than being plain module-scope constants, so header labels and
// status text stay reactive to language switches. Every call site builds the
// columns inside the component with `buildXxx(t)`.

interface CustomTableMeta {
    onSort?: (columnId: string, direction: string) => void;
}

const DetailsCell = ({ row }: { row: Row<StudentTable> }) => {
    const { setSelectedStudent } = useStudentSidebar();

    return (
        <SidebarTrigger
            onClick={() => {
                setSelectedStudent(row.original);
            }}
        >
            <ArrowSquareOut className="size-10 cursor-pointer text-neutral-600" />
        </SidebarTrigger>
    );
};

const buildCheckboxColumn = (): ColumnDef<StudentTable> => ({
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
});

const buildDetailsColumn = (t: TFunction): ColumnDef<StudentTable> => ({
    id: 'details',
    header: t('columns.details'),
    cell: ({ row }) => <DetailsCell row={row} />,
});

const buildFullNameColumn = (t: TFunction): ColumnDef<StudentTable> => ({
    accessorKey: 'full_name',
    header: (props) => {
        const meta = props.table.options.meta as CustomTableMeta;
        return (
            <div className="relative">
                <MyDropdown
                    dropdownList={[
                        { value: 'ASC', label: t('sort.ascending') },
                        { value: 'DESC', label: t('sort.descending') },
                    ]}
                    onSelect={(value) => {
                        meta.onSort?.('full_name', value);
                    }}
                >
                    <button className="flex w-full cursor-pointer items-center justify-between">
                        <div>{t('columns.name')}</div>
                        <div>
                            <CaretUp />
                            <CaretDown />
                        </div>
                    </button>
                </MyDropdown>
            </div>
        );
    },
});

// Displays the student's evaluation status. `mappedStatus` ('evaluated' /
// 'pending') still drives StatusChips' icon/color lookup, but the visible
// label is now passed explicitly as translated text via `children` — without
// it, StatusChips falls back to rendering the raw internal status string.
const buildEvaluationStatusColumn = (t: TFunction): ColumnDef<StudentTable> => ({
    accessorKey: 'evaluation_status',
    header: t('columns.evaluationStatus'),
    cell: ({ row }) => {
        const status = row.original.status || 'evaluated';
        const statusMapping: Record<string, ActivityStatus> = {
            EVALUATED: 'evaluated',
            PENDING: 'pending',
        };

        const mappedStatus = statusMapping[status] || 'evaluated';
        const statusLabel = mappedStatus === 'pending' ? t('status.pending') : t('status.evaluated');
        return <StatusChips status={mappedStatus}>{statusLabel}</StatusChips>;
    },
});

export const buildAssessmentStatusStudentAttemptedColumnsInternal = (
    t: TFunction
): ColumnDef<StudentTable>[] => [
    buildCheckboxColumn(),
    buildDetailsColumn(t),
    buildFullNameColumn(t),
    {
        accessorKey: 'package_session_id',
        header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
    },
    {
        accessorKey: 'attempt_date',
        header: t('columns.attemptDate'),
    },
    {
        accessorKey: 'start_time',
        header: t('columns.startTime'),
    },
    {
        accessorKey: 'end_time',
        header: t('columns.endTime'),
    },
    {
        accessorKey: 'duration',
        header: t('columns.duration'),
    },
    {
        accessorKey: 'score',
        header: t('columns.score'),
    },
    buildEvaluationStatusColumn(t),
    {
        id: 'options',
        header: '',
        cell: ({ row }) => (
            <AssessmentStatusOptions student={row.original} studentType="Attempted" />
        ),
    },
];

export const buildAssessmentStatusStudentOngoingColumnsInternal = (
    t: TFunction
): ColumnDef<StudentTable>[] => [
    buildCheckboxColumn(),
    buildDetailsColumn(t),
    buildFullNameColumn(t),
    {
        accessorKey: 'start_time',
        header: t('columns.startTime'),
    },
    {
        id: 'options',
        header: '',
        cell: ({ row }) => <AssessmentStatusOptions student={row.original} studentType="Ongoing" />,
    },
];

export const buildAssessmentStatusStudentPendingColumnsInternal = (
    t: TFunction
): ColumnDef<StudentTable>[] => [
    buildCheckboxColumn(),
    buildDetailsColumn(t),
    buildFullNameColumn(t),
    {
        id: 'options',
        header: '',
        cell: ({ row }) => <AssessmentStatusOptions student={row.original} studentType="Pending" />,
    },
];

export const buildAssessmentStatusStudentAttemptedColumnsExternal = (
    t: TFunction
): ColumnDef<StudentTable>[] => [
    buildCheckboxColumn(),
    buildDetailsColumn(t),
    buildFullNameColumn(t),
    {
        accessorKey: 'attempt_date',
        header: t('columns.attemptDate'),
    },
    {
        accessorKey: 'start_time',
        header: t('columns.startTime'),
    },
    {
        accessorKey: 'end_time',
        header: t('columns.endTime'),
    },
    {
        accessorKey: 'duration',
        header: t('columns.duration'),
    },
    {
        accessorKey: 'score',
        header: t('columns.score'),
    },
    buildEvaluationStatusColumn(t),
    {
        id: 'options',
        header: '',
        cell: ({ row }) => (
            <AssessmentStatusOptions student={row.original} studentType="Attempted" />
        ),
    },
];

export const buildAssessmentStatusStudentOngoingColumnsExternal = (
    t: TFunction
): ColumnDef<StudentTable>[] => [
    buildCheckboxColumn(),
    buildDetailsColumn(t),
    buildFullNameColumn(t),
    {
        accessorKey: 'start_time',
        header: t('columns.startTime'),
    },
    {
        id: 'options',
        header: '',
        cell: ({ row }) => <AssessmentStatusOptions student={row.original} studentType="Ongoing" />,
    },
];

export const buildAssessmentStatusStudentPendingColumnsExternal = (
    t: TFunction
): ColumnDef<StudentTable>[] => [
    buildCheckboxColumn(),
    buildDetailsColumn(t),
    buildFullNameColumn(t),
    {
        id: 'options',
        header: '',
        cell: ({ row }) => <AssessmentStatusOptions student={row.original} studentType="Pending" />,
    },
];

export const buildAssessmentStatusStudentQuestionResponseInternal = (
    t: TFunction
): ColumnDef<StudentTable>[] => [
    buildFullNameColumn(t),
    {
        accessorKey: 'package_session_id',
        header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
    },
    {
        accessorKey: 'institute_enrollment_id',
        header: t('columns.enrollmentNumber'),
    },
    {
        accessorKey: 'gender',
        header: t('columns.gender'),
    },
    {
        accessorKey: 'responseTime',
        header: t('columns.responseTime'),
    },
];

export const buildAssessmentStatusStudentQuestionResponseExternal = (
    t: TFunction
): ColumnDef<StudentTable>[] => [
    buildFullNameColumn(t),
    {
        accessorKey: 'gender',
        header: t('columns.gender'),
    },
    {
        accessorKey: 'responseTime',
        header: t('columns.responseTime'),
    },
];

export const buildStudentInternalOrCloseQuestionWise = (
    t: TFunction
): ColumnDef<StudentTable>[] => [
    buildFullNameColumn(t),
    {
        accessorKey: 'package_session_id',
        header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
    },
    {
        accessorKey: 'registration_id',
        header: t('columns.enrollmentNumber'),
    },
    {
        accessorKey: 'response_time_in_seconds',
        header: t('columns.responseTime'),
    },
];

export const buildStudentExternalQuestionWise = (t: TFunction): ColumnDef<StudentTable>[] => [
    buildFullNameColumn(t),
    {
        accessorKey: 'response_time_in_seconds',
        header: t('columns.responseTime'),
    },
];

export const buildStep3ParticipantsListColumn = (t: TFunction): ColumnDef<StudentTable>[] => [
    buildFullNameColumn(t),
    {
        accessorKey: 'package_session_id',
        header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
    },
    {
        accessorKey: 'institute_enrollment_id',
        header: t('columns.enrollmentNumber'),
    },
    {
        accessorKey: 'gender',
        header: t('columns.gender'),
    },
    {
        accessorKey: 'mobile_number',
        header: t('columns.phoneNumber'),
    },
    {
        accessorKey: 'email',
        header: t('columns.emailId'),
    },
    {
        accessorKey: 'city',
        header: t('columns.city'),
    },
    {
        accessorKey: 'region',
        header: t('columns.state'),
    },
];

export const buildStep3ParticipantsListIndividualStudentColumn = (
    t: TFunction
): ColumnDef<StudentTable>[] => [
    buildFullNameColumn(t),
    {
        accessorKey: 'mobile_number',
        header: t('columns.phoneNumber'),
    },
    {
        accessorKey: 'email',
        header: t('columns.emailId'),
    },
];
