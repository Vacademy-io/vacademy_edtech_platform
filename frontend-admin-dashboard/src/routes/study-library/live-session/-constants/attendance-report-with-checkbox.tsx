import { ColumnDef } from '@tanstack/react-table';
import { CheckCircle, XCircle, MinusCircle } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { Checkbox } from '@/components/ui/checkbox';

export interface AttendanceReportTableData {
    index: number;
    username: string;
    attendanceStatus: string | null;
    studentId: string;
    isSelected?: boolean;
}

export const attendanceReportColumnsWithCheckbox = (
    t: TFunction,
    selectedStudentIds: string[],
    onSelectStudent: (studentId: string, isSelected: boolean) => void,
    onSelectAll: () => void,
    onClearAll: () => void,
    isAllSelected: boolean,
    isIndeterminate: boolean
): ColumnDef<AttendanceReportTableData>[] => [
    {
        id: 'select',
        header: ({ table }) => (
            <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={(checked) => {
                        if (checked) {
                            onSelectAll();
                        } else {
                            onClearAll();
                        }
                    }}
                    ref={(el) => {
                        if (el) (el as unknown as HTMLInputElement).indeterminate = isIndeterminate;
                    }}
                    onClick={(e) => e.stopPropagation()}
                />
                <span className="text-sm font-medium">{t('select')}</span>
            </div>
        ),
        cell: ({ row }) => (
            <div onClick={(e) => e.stopPropagation()}>
                <Checkbox
                    checked={selectedStudentIds.includes(row.original.studentId)}
                    onCheckedChange={(checked) =>
                        onSelectStudent(row.original.studentId, checked as boolean)
                    }
                    onClick={(e) => e.stopPropagation()}
                />
            </div>
        ),
        enableSorting: false,
        enableHiding: false,
    },
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
        cell: ({ row }) => {
            const raw = row.original.attendanceStatus;
            const status = raw ? raw.toString().toUpperCase() : '';
            if (status === 'PRESENT') {
                return (
                    <div className="flex items-center gap-2 text-success-600">
                        <CheckCircle size={20} weight="fill" />
                        <span>{t('present')}</span>
                    </div>
                );
            }
            if (status === 'ABSENT') {
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
        },
    },
];

export const ATTENDANCE_REPORT_WIDTH: Record<string, string> = {
    select: 'w-[80px]',
    index: 'w-[60px]',
    username: 'w-[150px]',
    attendanceStatus: 'w-[150px]',
};
