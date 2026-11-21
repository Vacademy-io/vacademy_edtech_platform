import { ColumnDef } from '@tanstack/react-table';
import { CheckCircle, XCircle, MinusCircle } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';

export interface ReportTableData {
    index: number;
    username: string;
    attendanceStatus: string | null;
}
export interface RegistrationTableData {
    index: number;
    username: string;
    phoneNumber: string;
    email: string;
}

/** PRESENT / ABSENT / anything else (unmarked) as an icon + label, shared by every attendance table. */
export const AttendanceStatusCell = ({ status, t }: { status: string | null; t: TFunction }) => {
    const normalized = status ? status.toString().toUpperCase() : '';
    if (normalized === 'PRESENT') {
        return (
            <div className="flex items-center gap-2 text-success-600">
                <CheckCircle size={20} weight="fill" />
                <span>{t('present')}</span>
            </div>
        );
    }
    if (normalized === 'ABSENT') {
        return (
            <div className="flex items-center gap-2 text-danger-600">
                <XCircle size={20} weight="fill" />
                <span>{t('absent')}</span>
            </div>
        );
    }
    return (
        <div className="flex items-center gap-2 text-gray-400">
            <MinusCircle size={20} weight="fill" />
            <span>{t('unmarked')}</span>
        </div>
    );
};

export const buildReportColumns = (t: TFunction): ColumnDef<ReportTableData>[] => [
    {
        accessorKey: 'index',
        header: t('srNo'),
    },
    {
        accessorKey: 'username',
        header: t('membersName'),
    },
    {
        accessorKey: 'attendanceStatus',
        header: t('attendanceStatus'),
        cell: ({ row }) => <AttendanceStatusCell status={row.original.attendanceStatus} t={t} />,
    },
];
export const buildRegistrationColumns = (t: TFunction): ColumnDef<RegistrationTableData>[] => [
    {
        accessorKey: 'index',
        header: t('srNo'),
    },
    {
        accessorKey: 'username',
        header: t('membersName'),
    },
    {
        accessorKey: 'phoneNumber',
        header: t('membersPhoneNumber'),
    },
    {
        accessorKey: 'email',
        header: t('membersEmail'),
    },
];

export const REPORT_WIDTH: Record<string, string> = {
    index: 'w-[20px]',
    username: 'w-[120px]',
    attendanceStatus: 'w-[150px]',
};
export const REGISTRATION_WIDTH: Record<string, string> = {
    index: 'w-[20px]',
    username: 'w-[150px]',
    phoneNumber: 'w-[150px]',
    email: 'w-[150px]',
};
