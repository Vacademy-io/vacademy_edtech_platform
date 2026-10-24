import { useMemo, useState } from 'react';
import { Export } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import { StudentFilterRequest } from '@/types/student-table-types';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    buildStudentsCsv,
    downloadCsv,
    fetchAllStudentsForExport,
    getStudentExportColumns,
    type ExportColumn,
} from '../../../-utils/student-export';

interface ExportColumnsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    appliedFilters: StudentFilterRequest;
    totalElements: number;
}

export const ExportColumnsDialog = ({
    open,
    onOpenChange,
    appliedFilters,
    totalElements,
}: ExportColumnsDialogProps) => {
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const { t } = useTranslation(['manageStudentsExportUtil']);

    // Recompute on open so column labels always reflect the latest naming
    // settings (Course/Level/Session/Learner custom terms).
    const columns = useMemo(() => getStudentExportColumns(t), [open, t]);
    const groupedColumns = useMemo(() => {
        const groups = new Map<string, ExportColumn[]>();
        columns.forEach((col) => {
            const list = groups.get(col.group) ?? [];
            list.push(col);
            groups.set(col.group, list);
        });
        return Array.from(groups.entries());
    }, [columns]);

    const [selected, setSelected] = useState<Record<string, boolean>>(() =>
        columns.reduce<Record<string, boolean>>((acc, col) => {
            acc[col.id] = col.defaultSelected;
            return acc;
        }, {})
    );
    const [isExporting, setIsExporting] = useState(false);

    const selectedCount = useMemo(
        () => columns.filter((col) => selected[col.id]).length,
        [columns, selected]
    );
    const allSelected = selectedCount === columns.length;

    const toggleColumn = (id: string) => {
        setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
    };

    const toggleAll = () => {
        const next = !allSelected;
        setSelected(
            columns.reduce<Record<string, boolean>>((acc, col) => {
                acc[col.id] = next;
                return acc;
            }, {})
        );
    };

    const handleExport = async () => {
        const chosen = columns.filter((col) => selected[col.id]);
        if (chosen.length === 0) {
            toast.error('Select at least one column to export');
            return;
        }
        setIsExporting(true);
        try {
            const students = await fetchAllStudentsForExport(appliedFilters, totalElements);
            if (students.length === 0) {
                toast.error('No data to export for the current filters');
                return;
            }
            const csv = buildStudentsCsv(students, chosen, {
                getBatch: (packageSessionId) =>
                    getDetailsFromPackageSessionId({ packageSessionId }),
            });
            downloadCsv(`students_export_${new Date().toISOString().split('T')[0]}.csv`, csv);
            toast.success(`Exported ${students.length} record(s)`);
            onOpenChange(false);
        } catch {
            toast.error('Error exporting CSV');
        } finally {
            setIsExporting(false);
        }
    };

    const footer = (
        <div className="flex w-full items-center justify-between gap-2">
            <span className="text-xs text-neutral-500">{selectedCount} column(s) selected</span>
            <div className="flex items-center gap-2">
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onClick={() => onOpenChange(false)}
                    disable={isExporting}
                >
                    Cancel
                </MyButton>
                <MyButton
                    buttonType="primary"
                    scale="small"
                    onClick={handleExport}
                    disable={isExporting || selectedCount === 0}
                    className="flex items-center gap-1.5"
                >
                    <Export className="size-4" />
                    Export
                </MyButton>
            </div>
        </div>
    );

    return (
        <MyDialog
            heading="Export Data"
            open={open}
            onOpenChange={onOpenChange}
            footer={footer}
            dialogWidth="max-w-2xl"
        >
            {isExporting ? (
                <div className="flex flex-col items-center gap-2 py-10">
                    <DashboardLoader />
                    <p className="animate-pulse text-xs text-neutral-500">Preparing your export...</p>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                        <p className="text-sm text-neutral-600">
                            Choose the columns to include in the CSV.
                        </p>
                        <button
                            type="button"
                            onClick={toggleAll}
                            className="text-xs font-medium text-primary-500 hover:text-primary-600"
                        >
                            {allSelected ? 'Clear all' : 'Select all'}
                        </button>
                    </div>

                    {groupedColumns.map(([group, cols]) => (
                        <div key={group} className="flex flex-col gap-2">
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                                {group}
                            </h4>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {cols.map((col) => (
                                    <label
                                        key={col.id}
                                        className={cn(
                                            'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 transition-colors',
                                            selected[col.id]
                                                ? 'border-primary-200 bg-primary-50'
                                                : 'border-neutral-200 hover:bg-neutral-50'
                                        )}
                                    >
                                        <Checkbox
                                            checked={!!selected[col.id]}
                                            onCheckedChange={() => toggleColumn(col.id)}
                                        />
                                        <span className="truncate text-sm text-neutral-700">
                                            {col.label}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </MyDialog>
    );
};
